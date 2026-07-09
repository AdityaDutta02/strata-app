// lib/jobs/onboarding.ts — the standalone (no project) chain: avatar_create + voice_clone,
// triggered from POST /api/onboard. First avatar+voice per workspace is comped (0cr).
import type { Viewer } from '../auth'
import { dbGet, dbInsert, dbList, dbUpdate } from '../db'
import { r2Download, r2PresignedGetUrl } from '../storage-r2'
import { withRetry } from '../retry'
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
  const attempts = (err as { attempts?: number }).attempts
  const attemptsText = attempts ? ` — failed after ${attempts} attempt${attempts === 1 ? '' : 's'}` : ''
  return causeText ? `${err.message}${attemptsText} (${causeText})` : `${err.message}${attemptsText}`
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
  const freshAvatar = await dbGet<AvatarRow>('avatars', avatar.id, token)
  const freshVoice = await dbGet<VoiceRow>('voices', voice.id, token)
  return { avatar: freshAvatar, voice: freshVoice, jobs }
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
    let created
    if (isMockMode(token)) {
      created = await heygen.createAvatar({ type: 'url', url: `mock://r2/${key}` }, viewerId, token)
    } else {
      // Training footage was uploaded directly from the browser to our own R2 bucket (see
      // /api/uploads/r2-presign) — this never touches Terminal AI storage, so there is no
      // dependency on that host's reliability here.
      const buffer = await step('Downloading footage from storage', () => withRetry(() => r2Download(key), { baseDelayMs: 300 }))
      if (buffer.byteLength > HEYGEN_ASSET_MAX_BYTES) throw new JobValidationError(footageTooLargeMessage(buffer.byteLength))
      const contentType = key.toLowerCase().endsWith('.webm') ? 'video/webm' : 'video/mp4'
      const asset = await step('Uploading footage to HeyGen', () =>
        withRetry(() => heygen.uploadAsset(buffer, contentType, 'training.mp4', viewerId, token)),
      )
      created = await step('Creating HeyGen avatar', () =>
        withRetry(() => heygen.createAvatar({ type: 'asset_id', asset_id: asset.assetId }, viewerId, token)),
      )
    }
    await dbUpdate<AvatarRow>('avatars', avatar.id, { heygen_avatar_id: created.avatarId }, token)
    // Group id lives in the job's output_json — the live DB predates the avatars-table
    // columns for it and the platform does not apply ALTER migrations (dev ask filed).
    const currentJob = await dbGet<JobRow>('jobs', job.id, token)
    await dbUpdate<JobRow>(
      'jobs',
      job.id,
      {
        status: 'processing',
        provider_job_id: created.avatarId,
        output_json: { ...currentJob.output_json, heygenGroupId: created.groupId ?? null },
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
  let status
  try {
    status = await heygen.avatarStatus(job.provider_job_id, job.viewer_id, token)
  } catch (err) {
    // Without this, a status-check failure (bad id, transient HeyGen error) left the job
    // silently stuck in "processing" forever — nothing else ever surfaced it, and this
    // platform has no runtime logs to diagnose it from. Fail loudly instead.
    const message = describeError(err)
    await failJob(job, token, `Checking HeyGen avatar status — ${message}`)
    if (avatarId) await dbUpdate<AvatarRow>('avatars', avatarId, { status: 'failed', error: `Checking HeyGen avatar status — ${message}` }, token)
    return true
  }
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
    let fishVoiceId: string
    if (isMockMode(token)) {
      fishVoiceId = await fish.cloneVoice(`mock://r2/${key}`, voice.name, viewerId, token)
    } else {
      const buffer = await step('Downloading voice sample from storage', () => withRetry(() => r2Download(key), { baseDelayMs: 300 }))
      fishVoiceId = await step('Cloning voice with Fish Audio', () =>
        withRetry(() => fish.cloneVoiceFromBuffer(buffer, voice.name, viewerId, token)),
      )
    }
    let kitsVoiceId: string | null = null
    try {
      const url = isMockMode(token) ? `mock://r2/${key}` : r2PresignedGetUrl(key)
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
    const message = err instanceof JobValidationError ? err.message : describeError(err)
    await failJob(job, token, message)
    await dbUpdate<VoiceRow>('voices', voice.id, { status: 'failed', error: message }, token)
  }
}
