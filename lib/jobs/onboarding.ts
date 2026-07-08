// lib/jobs/onboarding.ts — the standalone (no project) chain: avatar_create + voice_clone,
// triggered from POST /api/onboard. First avatar+voice per workspace is comped (0cr).
import type { Viewer } from '../auth'
import { dbGet, dbInsert, dbList, dbUpdate } from '../db'
import { getPresignedDownloadUrl } from '../storage'
import { sendEmail } from '../email-sdk'
import { RATES, bootstrapWorkspace, chargeComped, getWorkspace, reserveCredits } from '../credits'
import * as heygen from '../providers/heygen'
import * as fish from '../providers/fish'
import * as kits from '../providers/kits'
import { logger } from '../logger'
import { isMockMode } from '../providers/mock'
import { JobValidationError, failJob, markJobReady, scheduleWatchdog } from './shared'
import type { AvatarRow, JobRow, VoiceRow, WorkspaceRow } from '../types'

export interface OnboardBody {
  name: string
  avatarUploadKey: string
  voiceUploadKey: string
}

// HeyGen's POST /v3/assets cap. Footage is uploaded to HeyGen's own store (see runAvatarTraining).
const HEYGEN_ASSET_MAX_BYTES = 32 * 1024 * 1024

function footageTooLargeMessage(bytes: number): string {
  const mb = Math.ceil(bytes / (1024 * 1024))
  return `Training footage is ${mb}MB. HeyGen accepts up to 32MB — please upload a shorter clip (a 30–90 second 720p clip is ideal for a digital twin).`
}

// undici throws a bare `TypeError: fetch failed` and hides the real reason (ECONNRESET,
// ENOTFOUND, timeout, TLS) in `.cause`. We have no runtime logs on this platform, so the
// job's error text is our only telemetry — unwrap the cause so failures are diagnosable.
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const cause = (err as { cause?: unknown }).cause
  let causeText = ''
  if (cause instanceof Error) causeText = cause.message
  else if (cause && typeof cause === 'object' && 'code' in cause) causeText = String((cause as { code: unknown }).code)
  else if (typeof cause === 'string') causeText = cause
  return causeText ? `${err.message} (${causeText})` : err.message
}

/** Runs a network step, re-throwing transport failures with a step label + unwrapped cause. */
async function step<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof JobValidationError) throw err
    throw new JobValidationError(`${label} — ${describeError(err)}`)
  }
}

export async function createOnboardingJobs(
  viewer: Viewer,
  body: OnboardBody,
): Promise<{ avatar: AvatarRow; voice: VoiceRow; jobs: JobRow[] }> {
  const { token, viewerId } = viewer
  const workspace = await bootstrapWorkspace(viewerId, token)
  const [existingAvatars, existingVoices] = await Promise.all([
    dbList<AvatarRow>('avatars', { viewer_id: viewerId }, token),
    dbList<VoiceRow>('voices', { viewer_id: viewerId }, token),
  ])
  const isComped = !workspace.first_avatar_comped && existingAvatars.length === 0 && existingVoices.length === 0

  const avatarCredits = isComped ? 0 : RATES.avatar_create
  const voiceCredits = isComped ? 0 : RATES.voice_clone
  if (!isComped) {
    await reserveCredits(workspace, avatarCredits + voiceCredits, token, { note: 'onboarding avatar+voice training' })
  }

  const avatar = await dbInsert<AvatarRow>(
    'avatars',
    { viewer_id: viewerId, name: body.name, status: 'training', training_video_key: body.avatarUploadKey },
    token,
  )
  const voice = await dbInsert<VoiceRow>(
    'voices',
    { viewer_id: viewerId, name: body.name, status: 'training', sample_key: body.voiceUploadKey },
    token,
  )

  const avatarJob = await dbInsert<JobRow>(
    'jobs',
    { viewer_id: viewerId, project_id: null, type: 'avatar_create', status: 'queued', input_json: { avatarId: avatar.id }, output_json: {}, credits_reserved: avatarCredits, credits_charged: 0 },
    token,
  )
  const voiceJob = await dbInsert<JobRow>(
    'jobs',
    { viewer_id: viewerId, project_id: null, type: 'voice_clone', status: 'queued', input_json: { voiceId: voice.id }, output_json: {}, credits_reserved: voiceCredits, credits_charged: 0 },
    token,
  )

  if (isComped) {
    const freshWorkspace = await getWorkspace(viewerId, token)
    if (freshWorkspace) {
      await chargeComped(freshWorkspace, token, { jobId: avatarJob.id, note: 'first avatar+voice comped' })
    }
    await dbUpdate<WorkspaceRow>('workspaces', workspace.id, { first_avatar_comped: true }, token)
  }

  await runAvatarTraining(avatarJob, avatar, viewer)
  await runVoiceCloneTraining(voiceJob, voice, viewer)

  const jobs = [await dbGet<JobRow>('jobs', avatarJob.id, token), await dbGet<JobRow>('jobs', voiceJob.id, token)]
  return { avatar, voice, jobs }
}

/** Re-runs HeyGen training for an existing avatar (used by the failed-avatar retry route). */
export async function retryAvatarTraining(job: JobRow, avatar: AvatarRow, viewer: Viewer): Promise<void> {
  return runAvatarTraining(job, avatar, viewer)
}

async function runAvatarTraining(job: JobRow, avatar: AvatarRow, viewer: Viewer): Promise<void> {
  const { token, viewerId } = viewer
  await dbUpdate<JobRow>('jobs', job.id, { status: 'processing' }, token)
  try {
    const key = avatar.training_video_key
    if (!key) throw new JobValidationError('Missing training video upload')
    const { url } = await getPresignedDownloadUrl(key, token)
    // HeyGen's render network CANNOT reach our platform subdomain, so any file URL on our
    // own origin fails with "Could not download the file". Instead, fetch the footage
    // container-side — the platform presigned URL IS reachable from inside the container
    // (the voice clone downloads its sample the same way) — and push the bytes to HeyGen's
    // OWN asset store. HeyGen then downloads nothing from us. This mirrors the video-gen
    // audio path (also HeyGen-hosted), which is why that path never hit this error.
    let created
    if (isMockMode(token)) {
      created = await heygen.createAvatar({ type: 'url', url }, viewerId, token)
    } else {
      const buffer = await step('Downloading training footage from storage', async () => {
        const res = await fetch(url, { signal: AbortSignal.timeout(5 * 60_000) })
        if (!res.ok) throw new JobValidationError(`Could not read training footage from storage (${res.status})`)
        const declared = Number(res.headers.get('content-length') ?? '0')
        if (declared > HEYGEN_ASSET_MAX_BYTES) throw new JobValidationError(footageTooLargeMessage(declared))
        return Buffer.from(await res.arrayBuffer())
      })
      if (buffer.byteLength > HEYGEN_ASSET_MAX_BYTES) throw new JobValidationError(footageTooLargeMessage(buffer.byteLength))
      const contentType = key.toLowerCase().endsWith('.webm') ? 'video/webm' : 'video/mp4'
      const asset = await step('Uploading footage to HeyGen', () =>
        heygen.uploadAsset(buffer, contentType, 'training.mp4', viewerId, token),
      )
      created = await step('Creating HeyGen avatar', () =>
        heygen.createAvatar({ type: 'asset_id', asset_id: asset.assetId }, viewerId, token),
      )
    }
    await dbUpdate<AvatarRow>('avatars', avatar.id, { heygen_avatar_id: created.avatarId }, token)
    // Group id lives in the job's output_json — the live DB predates the avatars-table
    // columns for it and the platform does not apply ALTER migrations (dev ask filed).
    await dbUpdate<JobRow>(
      'jobs',
      job.id,
      {
        status: 'processing',
        provider_job_id: created.avatarId,
        output_json: { ...job.output_json, heygenGroupId: created.groupId ?? null },
      },
      token,
    )
    await scheduleWatchdog({ ...job, provider_job_id: created.avatarId }, token)
  } catch (err) {
    const message = err instanceof JobValidationError ? err.message : describeError(err)
    await failJob(job, token, message)
    await dbUpdate<AvatarRow>('avatars', avatar.id, { status: 'failed', error: message }, token)
  }
}

export async function pollAvatarJob(job: JobRow, token: string): Promise<boolean> {
  if (job.status !== 'processing' || !job.provider_job_id) return false
  const avatarId = job.input_json.avatarId as string | undefined
  const status = await heygen.avatarStatus(job.provider_job_id, job.viewer_id, token)
  if (status.status === 'training') {
    // pending_consent never dead-ends: request the approval URL once, store it on the
    // avatar row (surfaced in the UI) and email it to the owner best-effort. Polling
    // continues and picks the training back up after approval.
    if (status.pendingConsent && avatarId) {
      try {
        const groupId = job.output_json.heygenGroupId as string | null | undefined
        const alreadyRequested = typeof job.output_json.consentUrl === 'string'
        if (!alreadyRequested && groupId) {
          const row = await dbGet<AvatarRow>('avatars', avatarId, token)
          const { url } = await heygen.requestConsent(groupId, job.viewer_id, token)
          await dbUpdate<JobRow>('jobs', job.id, { output_json: { ...job.output_json, consentUrl: url } }, token)
          try {
            await sendEmail(
              'Strata: avatar consent approval needed',
              `<p>Your avatar "${row.name}" needs a one-time consent approval before training can finish.</p><p><a href="${url}">Open the consent page</a> (the person in the training footage must approve).</p>`,
              token,
            )
          } catch (emailErr) {
            logger.warn({ msg: 'consent email failed', avatarId, err: String(emailErr) })
          }
        }
      } catch (consentErr) {
        logger.warn({ msg: 'consent url request failed', avatarId, err: String(consentErr) })
      }
    }
    await scheduleWatchdog(job, token)
    return false
  }
  if (status.status === 'failed') {
    await failJob(job, token, status.error ?? 'HeyGen avatar training failed')
    if (avatarId) await dbUpdate<AvatarRow>('avatars', avatarId, { status: 'failed', error: status.error ?? 'training failed' }, token)
    return true
  }
  await markJobReady(job, {}, token)
  if (avatarId) await dbUpdate<AvatarRow>('avatars', avatarId, { status: 'ready' }, token)
  return true
}

async function runVoiceCloneTraining(job: JobRow, voice: VoiceRow, viewer: Viewer): Promise<void> {
  const { token, viewerId } = viewer
  await dbUpdate<JobRow>('jobs', job.id, { status: 'processing' }, token)
  try {
    const key = voice.sample_key
    if (!key) throw new JobValidationError('Missing voice sample upload')
    const { url } = await getPresignedDownloadUrl(key, token)
    // The Fish Audio TTS clone (used by "Generate from script") is the required step.
    // Kits.ai does NOT support programmatic voice training (web-app only) — its
    // registration is best-effort: on failure the voice is still marked ready with
    // kits_voice_id null, and the voice-swap path degrades cleanly (generation.ts
    // rejects swap for voices without a Kits target). The owner can train the voice at
    // app.kits.ai and backfill the numeric model id into voices.kits_voice_id.
    const fishVoiceId = await fish.cloneVoice(url, voice.name, viewerId, token)
    let kitsVoiceId: string | null = null
    try {
      kitsVoiceId = await kits.createTargetVoice(url, voice.name, viewerId, token)
    } catch (kitsErr) {
      logger.warn({
        msg: 'kits target voice registration unavailable — TTS-only voice',
        voiceId: voice.id,
        err: kitsErr instanceof Error ? kitsErr.message : String(kitsErr),
      })
    }
    await dbUpdate<VoiceRow>('voices', voice.id, { fish_voice_id: fishVoiceId, kits_voice_id: kitsVoiceId, status: 'ready' }, token)
    await markJobReady({ ...job, status: 'processing' }, { fishVoiceId, kitsVoiceId }, token)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await failJob(job, token, message)
    await dbUpdate<VoiceRow>('voices', voice.id, { status: 'failed', error: message }, token)
  }
}
