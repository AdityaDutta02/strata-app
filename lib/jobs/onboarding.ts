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
import { JobValidationError, failJob, markJobReady, scheduleWatchdog } from './shared'
import type { AvatarRow, JobRow, VoiceRow, WorkspaceRow } from '../types'

export interface OnboardBody {
  name: string
  avatarUploadKey: string
  voiceUploadKey: string
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

async function runAvatarTraining(job: JobRow, avatar: AvatarRow, viewer: Viewer): Promise<void> {
  const { token, viewerId } = viewer
  await dbUpdate<JobRow>('jobs', job.id, { status: 'processing' }, token)
  try {
    const key = avatar.training_video_key
    if (!key) throw new JobValidationError('Missing training video upload')
    const { url } = await getPresignedDownloadUrl(key, token)
    const created = await heygen.createAvatar(url, viewerId, token)
    await dbUpdate<AvatarRow>(
      'avatars',
      avatar.id,
      { heygen_avatar_id: created.avatarId, heygen_group_id: created.groupId ?? null },
      token,
    )
    await dbUpdate<JobRow>('jobs', job.id, { status: 'processing', provider_job_id: created.avatarId }, token)
    await scheduleWatchdog({ ...job, provider_job_id: created.avatarId }, token)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
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
        const row = await dbGet<AvatarRow>('avatars', avatarId, token)
        if (!row.consent_url && row.heygen_group_id) {
          const { url } = await heygen.requestConsent(row.heygen_group_id, job.viewer_id, token)
          await dbUpdate<AvatarRow>('avatars', avatarId, { consent_url: url }, token)
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
