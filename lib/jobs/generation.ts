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
import { JobValidationError, downloadBytes, failJob, markJobReady, scheduleWatchdog, storeAsset } from './shared'
import type { AssetRow, AvatarRow, JobRow, JobType, NotesLine, ProjectRow, VoiceRow } from '../types'

export interface GenerateBody {
  recordingKey?: string
}

export async function createGeneration(project: ProjectRow, viewer: Viewer, body: GenerateBody): Promise<{ generationJobs: JobRow[] }> {
  const { token, viewerId } = viewer
  if (!project.script.trim()) throw new JobValidationError('Project script is empty')
  if (!project.avatar_id) throw new JobValidationError('Project has no avatar selected')
  if (project.voice_mode === 'tts' && !project.voice_id) throw new JobValidationError('Project has no voice selected')
  if (project.voice_mode === 'swap' && !body.recordingKey) throw new JobValidationError('recordingKey is required for voice swap')

  const workspace = await bootstrapWorkspace(viewerId, token)
  const { minutes } = estimateGeneration(project.script, project.format, project.voice_mode)
  const voiceRate = project.voice_mode === 'swap' ? RATES.voice_swap : RATES.voice_gen
  const voiceCredits = minutes * voiceRate
  const videoCredits = minutes * RATES.video_gen

  await reserveCredits(workspace, voiceCredits + videoCredits, token, { note: `generation for project ${project.id}` })
  await dbUpdate<ProjectRow>(
    'projects',
    project.id,
    { credits_spent: (project.credits_spent ?? 0) + voiceCredits + videoCredits },
    token,
  )

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
  await dbInsert<JobRow>(
    'jobs',
    { viewer_id: viewerId, project_id: project.id, type: 'video_gen', status: 'queued', input_json: {}, output_json: {}, credits_reserved: videoCredits, credits_charged: 0 },
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

  try {
    await runVoiceJob(voiceJob, project, viewer)
  } catch (err) {
    logger.error({ msg: 'unexpected error starting voice job', jobId: voiceJob.id, err })
  }

  const generationJobs = await dbList<JobRow>('jobs', { project_id: project.id }, token)
  return { generationJobs }
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
    await startVideoJob(project, audioAsset, viewer)
  } catch (err) {
    await failJob(job, token, err instanceof Error ? err.message : String(err), { cascadeProject: true })
  }
}

async function startVideoJob(project: ProjectRow, audioAsset: AssetRow, viewer: Viewer): Promise<void> {
  const { token, viewerId } = viewer
  const [videoJob] = await dbList<JobRow>('jobs', { project_id: project.id, type: 'video_gen' }, token)
  if (!videoJob) return
  const avatar = project.avatar_id ? await dbGet<AvatarRow>('avatars', project.avatar_id, token).catch(() => null) : null
  if (!isMockMode(token) && !avatar?.heygen_avatar_id) {
    await failJob(videoJob, token, 'Selected avatar has no trained HeyGen avatar id', { cascadeProject: true })
    return
  }
  try {
    // HeyGen's workers can't reliably fetch the platform's presigned URLs, so the audio
    // is pushed to HeyGen's own asset store (≤32MB — ample for TTS mp3) and referenced
    // by its HeyGen-hosted URL.
    const { url: audioUrl } = await getPresignedDownloadUrl(audioAsset.storage_key, token)
    let heygenAudioUrl = audioUrl
    if (!isMockMode(token)) {
      const audioRes = await fetch(audioUrl, { signal: providerTimeout() })
      if (!audioRes.ok) throw new Error(`failed to read voiceover audio: ${audioRes.status}`)
      const audioBuffer = Buffer.from(await audioRes.arrayBuffer())
      const asset = await heygen.uploadAsset(audioBuffer, 'audio/mpeg', 'voiceover.mp3', viewerId, token)
      heygenAudioUrl = asset.url
    }
    const providerJobId = await heygen.createVideo(
      avatar?.heygen_avatar_id ?? 'mock',
      heygenAudioUrl,
      viewerId,
      token,
      project.resolution === '1080p' ? '1080p' : '720p',
    )
    await dbUpdate<JobRow>('jobs', videoJob.id, { status: 'processing', provider_job_id: providerJobId }, token)
    await scheduleWatchdog({ ...videoJob, status: 'processing', provider_job_id: providerJobId }, token)
  } catch (err) {
    await failJob(videoJob, token, err instanceof Error ? err.message : String(err), { cascadeProject: true })
  }
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
