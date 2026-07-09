// lib/jobs/generation.ts — the per-project chain: voice -> video -> transcribe -> notes.
import type { Viewer } from '../auth'
import { dbGet, dbInsert, dbList, dbUpdate } from '../db'
import { getPresignedDownloadUrl } from '../storage'
import { sendEmail } from '../email-sdk'
import { logger } from '../logger'
import { RATES, bootstrapWorkspace, estimateGeneration, reserveCredits } from '../credits'
import { splitIntoLines } from '../lines'
import { renderNotesPdf } from '../notes-pdf'
import * as heygen from '../providers/heygen'
import * as fish from '../providers/fish'
import * as kits from '../providers/kits'
import * as groq from '../providers/groq'
import { findSources } from '../providers/research'
import { isMockMode, mockAudioBuffer, mockVideoBuffer } from '../providers/mock'
import { providerTimeout } from '../providers/provider-error'
import { withRetry } from '../retry'
import { JobValidationError, downloadBytes, failJob, markJobReady, scheduleWatchdog, storeAsset } from './shared'
import type { AssetRow, AvatarRow, JobRow, JobType, NotesLine, ProjectRow, VoiceRow } from '../types'

// undici throws a bare `TypeError: fetch failed` and hides the real reason in `.cause` —
// same unwrapping as the onboarding pipeline, so failures here are diagnosable too.
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

async function step<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof JobValidationError) throw err
    throw new JobValidationError(`${label} — ${describeError(err)}`)
  }
}

export interface GenerateVoiceBody {
  recordingKey?: string
}

/** Step 1 of the (now explicit two-step) generation flow: voice only. The user reviews and
 *  approves the voiceover before any HeyGen credits are spent on video — previously voice and
 *  video ran back-to-back with no pause, so a bad voiceover or unapproved avatar consent could
 *  only be discovered after video generation had already started. */
export async function createVoiceGeneration(project: ProjectRow, viewer: Viewer, body: GenerateVoiceBody): Promise<{ job: JobRow }> {
  const { token, viewerId } = viewer
  if (!project.script.trim()) throw new JobValidationError('Project script is empty')
  if (project.voice_mode === 'tts' && !project.voice_id) throw new JobValidationError('Project has no voice selected')
  if (project.voice_mode === 'swap' && !body.recordingKey) throw new JobValidationError('recordingKey is required for voice swap')

  const workspace = await bootstrapWorkspace(viewerId, token)
  const { minutes } = estimateGeneration(project.script, project.format, project.voice_mode)
  const voiceRate = project.voice_mode === 'swap' ? RATES.voice_swap : RATES.voice_gen
  const voiceCredits = minutes * voiceRate

  await reserveCredits(workspace, voiceCredits, token, { note: `voice generation for project ${project.id}` })
  await dbUpdate<ProjectRow>('projects', project.id, { credits_spent: (project.credits_spent ?? 0) + voiceCredits }, token)

  const voiceJobType: JobType = project.voice_mode === 'swap' ? 'voice_swap' : 'voice_gen'
  const voiceJob = await dbInsert<JobRow>(
    'jobs',
    {
      viewer_id: viewerId,
      project_id: project.id,
      type: voiceJobType,
      status: 'queued',
      input_json: { recordingKey: body.recordingKey ?? null },
      output_json: {},
      credits_reserved: voiceCredits,
      credits_charged: 0,
    },
    token,
  )

  await dbUpdate<ProjectRow>('projects', project.id, { status: 'processing' }, token)
  await runVoiceJob(voiceJob, project, viewer)

  const fresh = await dbGet<JobRow>('jobs', voiceJob.id, token)
  return { job: fresh }
}

async function runVoiceJob(job: JobRow, project: ProjectRow, viewer: Viewer): Promise<void> {
  const { token, viewerId } = viewer
  await dbUpdate<JobRow>('jobs', job.id, { status: 'processing' }, token)
  try {
    let audioBuffer: Buffer
    if (job.type === 'voice_swap') {
      const recordingKey = job.input_json.recordingKey as string | null
      if (!recordingKey) throw new JobValidationError('Missing recordingKey for voice swap')
      const voice = project.voice_id ? await dbGet<VoiceRow>('voices', project.voice_id, token).catch(() => null) : null
      if (!isMockMode(token) && !voice?.kits_voice_id) {
        throw new JobValidationError('Selected voice has no Kits.ai target trained')
      }
      const { url: recordingUrl } = await getPresignedDownloadUrl(recordingKey, token)
      audioBuffer = await kits.convert(recordingUrl, voice?.kits_voice_id ?? 'mock', viewerId, token)
    } else {
      const voice = project.voice_id ? await dbGet<VoiceRow>('voices', project.voice_id, token) : null
      if (!isMockMode(token) && !voice?.fish_voice_id) {
        throw new JobValidationError('Selected voice has no Fish Audio clone trained')
      }
      audioBuffer = await fish.tts(project.script, voice?.fish_voice_id ?? 'mock', viewerId, token)
    }
    const audioAsset = await storeAsset({
      viewerId,
      projectId: project.id,
      jobId: job.id,
      kind: 'audio',
      buffer: audioBuffer,
      contentType: 'audio/wav',
      filename: 'voice.wav',
      token,
    })
    await markJobReady(job, { audioAssetId: audioAsset.id }, token)
  } catch (err) {
    await failJob(job, token, err instanceof Error ? err.message : String(err))
  }
}

const CONSENT_GROUP_RE = /Avatar group '([^']+)'/

/** HeyGen enforces consent at video-render time regardless of whether the create-avatar
 *  response flagged it as required — so this can surface on the very first video attempt for
 *  an avatar that looked "ready". Detects that specific error, requests the consent URL, and
 *  stores + emails it so the user has a concrete next step instead of a dead-end error. */
async function handleConsentRequired(
  err: unknown,
  videoJob: JobRow,
  avatarName: string | undefined,
  viewerId: string,
  token: string,
): Promise<string | null> {
  if (!(err instanceof Error) || !err.message.includes('avatar_consent_required')) return null
  const groupId = err.message.match(CONSENT_GROUP_RE)?.[1]
  if (!groupId) return null
  try {
    const { url } = await heygen.requestConsent(groupId, viewerId, token)
    await dbUpdate<JobRow>('jobs', videoJob.id, { output_json: { consentUrl: url } }, token)
    try {
      await sendEmail(
        'Strata: avatar consent approval needed',
        `<p>Your avatar${avatarName ? ` "${avatarName}"` : ''} needs a one-time consent approval before video can be generated.</p><p><a href="${url}">Open the consent page</a> (the person in the training footage must approve).</p>`,
        token,
      )
    } catch (emailErr) {
      logger.warn({ msg: 'consent email failed (video gen)', err: String(emailErr) })
    }
    return url
  } catch (consentErr) {
    logger.warn({ msg: 'consent url request failed (video gen)', err: String(consentErr) })
    return null
  }
}

function aspectRatioForFormat(format: ProjectRow['format']): '9:16' | '16:9' {
  return format === 'horizontal' ? '16:9' : '9:16'
}

/** Starts (or retries) HeyGen video generation for `videoJob`, given the voiceover bytes
 *  directly — never re-downloads them from Terminal AI storage, which is why this hop used
 *  to fail with an unrecoverable "fetch failed" (same platform storage flakiness the
 *  onboarding pipeline hit). */
async function startVideoJob(project: ProjectRow, videoJob: JobRow, audioBuffer: Buffer, viewer: Viewer): Promise<void> {
  const { token, viewerId } = viewer
  const avatar = project.avatar_id ? await dbGet<AvatarRow>('avatars', project.avatar_id, token).catch(() => null) : null
  if (!isMockMode(token) && !avatar?.heygen_avatar_id) {
    await failJob(videoJob, token, 'Selected avatar has no trained HeyGen avatar id', { cascadeProject: true })
    return
  }
  try {
    let heygenAudioUrl = 'mock://audio'
    if (!isMockMode(token)) {
      const asset = await step('Uploading voiceover to HeyGen', () =>
        withRetry(() => heygen.uploadAsset(audioBuffer, 'audio/mpeg', 'voiceover.mp3', viewerId, token)),
      )
      heygenAudioUrl = asset.url
    }
    const providerJobId = await step('Starting HeyGen video generation', () =>
      withRetry(() =>
        heygen.createVideo(
          avatar?.heygen_avatar_id ?? 'mock',
          heygenAudioUrl,
          viewerId,
          token,
          videoJob.input_json.resolution === '1080p' ? '1080p' : '720p',
          aspectRatioForFormat(project.format),
        ),
      ),
    )
    await dbUpdate<JobRow>('jobs', videoJob.id, { status: 'processing', provider_job_id: providerJobId }, token)
    await scheduleWatchdog({ ...videoJob, status: 'processing', provider_job_id: providerJobId }, token)
  } catch (err) {
    const consentUrl = await handleConsentRequired(err, videoJob, avatar?.name, viewerId, token)
    const message = consentUrl
      ? 'This avatar needs one-time consent approval before video can render — open the consent link below, approve, then click Retry.'
      : err instanceof JobValidationError
        ? err.message
        : describeError(err)
    await failJob(videoJob, token, message, { cascadeProject: true })
  }
}

/** Finds the project's most recently completed voiceover — the one the user approved. */
async function findApprovedVoiceover(project: ProjectRow, token: string): Promise<AssetRow> {
  const jobs = await dbList<JobRow>('jobs', { project_id: project.id }, token)
  const voiceJob = jobs
    .filter((j) => (j.type === 'voice_gen' || j.type === 'voice_swap') && j.status === 'ready')
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0]
  const audioAssetId = voiceJob?.output_json.audioAssetId as string | undefined
  if (!audioAssetId) throw new JobValidationError('Generate and approve a voiceover before generating video')
  return dbGet<AssetRow>('assets', audioAssetId, token)
}

async function readVoiceoverBuffer(audioAsset: AssetRow, token: string): Promise<Buffer> {
  return step('Reading voiceover from storage', () =>
    withRetry(async () => {
      const { url } = await getPresignedDownloadUrl(audioAsset.storage_key, token)
      const res = await fetch(url, { signal: providerTimeout() })
      if (!res.ok) throw new Error(`failed to read voiceover audio: ${res.status}`)
      return Buffer.from(await res.arrayBuffer())
    }),
  )
}

export interface GenerateVideoBody {
  /** Render quality — 720p standard, 1080p optional. Carried in the video job's
   *  input_json (the live projects table has no resolution column). */
  resolution?: '720p' | '1080p'
}

/** Step 2 of the generation flow: video + transcribe + notes, using the already-approved
 *  voiceover. Requires an avatar already attached to the project (set at creation time) and a
 *  ready voice_gen/voice_swap job. */
export async function createVideoGeneration(project: ProjectRow, viewer: Viewer, body: GenerateVideoBody): Promise<{ job: JobRow }> {
  const { token, viewerId } = viewer
  if (!project.avatar_id) throw new JobValidationError('Project has no avatar selected')
  const audioAsset = await findApprovedVoiceover(project, token)

  const workspace = await bootstrapWorkspace(viewerId, token)
  const { minutes } = estimateGeneration(project.script, project.format, project.voice_mode)
  const videoCredits = minutes * RATES.video_gen
  await reserveCredits(workspace, videoCredits, token, { note: `video generation for project ${project.id}` })
  await dbUpdate<ProjectRow>('projects', project.id, { credits_spent: (project.credits_spent ?? 0) + videoCredits }, token)

  const videoJob = await dbInsert<JobRow>(
    'jobs',
    { viewer_id: viewerId, project_id: project.id, type: 'video_gen', status: 'queued', input_json: { resolution: body.resolution ?? '720p' }, output_json: {}, credits_reserved: videoCredits, credits_charged: 0 },
    token,
  )
  await dbInsert<JobRow>(
    'jobs',
    { viewer_id: viewerId, project_id: project.id, type: 'transcribe', status: 'queued', input_json: {}, output_json: {}, credits_reserved: 0, credits_charged: 0 },
    token,
  )
  await dbInsert<JobRow>(
    'jobs',
    { viewer_id: viewerId, project_id: project.id, type: 'notes', status: 'queued', input_json: {}, output_json: {}, credits_reserved: 0, credits_charged: 0 },
    token,
  )
  await dbUpdate<ProjectRow>('projects', project.id, { status: 'processing', stage: 'video' }, token)

  const audioBuffer = await readVoiceoverBuffer(audioAsset, token)
  await startVideoJob(project, videoJob, audioBuffer, viewer)

  const fresh = await dbGet<JobRow>('jobs', videoJob.id, token)
  return { job: fresh }
}

/** Retries a failed video_gen job using the project's already-approved voiceover — no need
 *  to redo TTS. Re-reserves the failed job's credits (refunded on the earlier failure) into
 *  a fresh job row, mirroring the avatar-training retry pattern. */
export async function retryVideoGeneration(project: ProjectRow, viewer: Viewer): Promise<void> {
  const { token, viewerId } = viewer
  const videoJobs = await dbList<JobRow>('jobs', { project_id: project.id, type: 'video_gen' }, token)
  const failedVideoJob = videoJobs
    .filter((j) => j.status === 'failed')
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0]
  if (!failedVideoJob) throw new JobValidationError('No failed video job to retry')

  const audioAsset = await findApprovedVoiceover(project, token)
  const audioBuffer = await readVoiceoverBuffer(audioAsset, token)

  if (failedVideoJob.credits_reserved > 0) {
    const workspace = await bootstrapWorkspace(viewerId, token)
    await reserveCredits(workspace, failedVideoJob.credits_reserved, token, { note: `retry video generation for project ${project.id}` })
  }
  const newVideoJob = await dbInsert<JobRow>(
    'jobs',
    {
      viewer_id: viewerId,
      project_id: project.id,
      type: 'video_gen',
      status: 'queued',
      input_json: failedVideoJob.input_json,
      output_json: {},
      credits_reserved: failedVideoJob.credits_reserved,
      credits_charged: 0,
    },
    token,
  )
  await dbUpdate<ProjectRow>('projects', project.id, { status: 'processing' }, token)
  await startVideoJob(project, newVideoJob, audioBuffer, viewer)
}

export async function pollVideoJob(job: JobRow, token: string): Promise<boolean> {
  if (job.status !== 'processing' || !job.provider_job_id) return false
  const status = await heygen.videoStatus(job.provider_job_id, job.viewer_id, token)
  if (status.status === 'processing') {
    await scheduleWatchdog(job, token)
    return false
  }
  if (status.status === 'failed') {
    await failJob(job, token, status.error ?? 'HeyGen video generation failed', { cascadeProject: true })
    return true
  }
  const buffer = isMockMode(token) || !status.videoUrl || status.videoUrl.startsWith('mock://')
    ? mockVideoBuffer()
    : await downloadBytes(status.videoUrl)
  const videoAsset = await storeAsset({
    viewerId: job.viewer_id,
    projectId: job.project_id,
    jobId: job.id,
    kind: 'video',
    buffer,
    contentType: 'video/mp4',
    filename: 'video.mp4',
    token,
  })
  await markJobReady(job, { videoAssetId: videoAsset.id, videoUrl: status.videoUrl }, token)
  if (job.project_id) {
    await dbUpdate<ProjectRow>('projects', job.project_id, { stage: 'render' }, token)
    await chainToTranscribe(job.project_id, videoAsset, job.viewer_id, token)
  }
  return true
}

async function chainToTranscribe(projectId: string, videoAsset: AssetRow, viewerId: string, token: string): Promise<void> {
  const [transcribeJob] = await dbList<JobRow>('jobs', { project_id: projectId, type: 'transcribe' }, token)
  if (!transcribeJob || transcribeJob.status !== 'queued') return
  await dbUpdate<JobRow>('jobs', transcribeJob.id, { status: 'processing' }, token)
  try {
    const buffer = isMockMode(token) ? mockAudioBuffer() : await downloadAssetBytes(videoAsset, token)
    const result = await groq.transcribe(buffer, viewerId, token)
    const transcriptAsset = await storeAsset({
      viewerId,
      projectId,
      jobId: transcribeJob.id,
      kind: 'transcript',
      buffer: Buffer.from(JSON.stringify(result, null, 2)),
      contentType: 'application/json',
      filename: 'transcript.json',
      token,
    })
    await markJobReady(transcribeJob, { transcriptAssetId: transcriptAsset.id }, token)
    const project = await dbGet<ProjectRow>('projects', projectId, token)
    await chainToNotes(project, result.words, viewerId, token)
  } catch (err) {
    await failJob(transcribeJob, token, err instanceof Error ? err.message : String(err), { cascadeProject: true })
  }
}

async function downloadAssetBytes(asset: AssetRow, token: string): Promise<Buffer> {
  const { url } = await getPresignedDownloadUrl(asset.storage_key, token)
  return downloadBytes(url)
}

async function chainToNotes(
  project: ProjectRow,
  words: { word: string; start: number; end: number }[],
  viewerId: string,
  token: string,
): Promise<void> {
  const [notesJob] = await dbList<JobRow>('jobs', { project_id: project.id, type: 'notes' }, token)
  if (!notesJob || notesJob.status !== 'queued') return
  await dbUpdate<JobRow>('jobs', notesJob.id, { status: 'processing' }, token)
  try {
    const timedLines = splitIntoLines(words)
    const sources = await findSources(timedLines.map((l) => l.text), project.script.slice(0, 400), viewerId, token)
    const notesLines: NotesLine[] = timedLines.map((line, i) => {
      const source = sources[i]
      return {
        t0: line.t0,
        t1: line.t1,
        line: line.text,
        cueType: source?.cueType,
        direction: source?.direction,
        source: source?.url ? { url: source.url, title: source.title || source.url } : undefined,
      }
    })
    const notesJsonAsset = await storeAsset({
      viewerId,
      projectId: project.id,
      jobId: notesJob.id,
      kind: 'notes',
      buffer: Buffer.from(JSON.stringify(notesLines, null, 2)),
      contentType: 'application/json',
      filename: 'notes.json',
      token,
    })
    const pdfBuffer = await renderNotesPdf({ title: project.title, format: project.format, language: project.language }, notesLines)
    const pdfAsset = await storeAsset({
      viewerId,
      projectId: project.id,
      jobId: notesJob.id,
      kind: 'notes_pdf',
      buffer: pdfBuffer,
      contentType: 'application/pdf',
      filename: 'notes.pdf',
      token,
    })
    await markJobReady(notesJob, { notesAssetId: notesJsonAsset.id, notesPdfAssetId: pdfAsset.id }, token)
    await dbUpdate<ProjectRow>('projects', project.id, { status: 'ready', stage: 'publish' }, token)
    try {
      await sendEmail('Your Strata video is ready', `<p>Your project "${project.title}" has finished rendering and is ready to review.</p>`, token)
    } catch (err) {
      logger.warn({ msg: 'best-effort ready notification email failed', projectId: project.id, err })
    }
  } catch (err) {
    await failJob(notesJob, token, err instanceof Error ? err.message : String(err), { cascadeProject: true })
  }
}
