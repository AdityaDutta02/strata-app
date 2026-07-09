import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// --- Fake db.ts (in-memory) -------------------------------------------------
vi.mock('./db', () => {
  const tables = new Map<string, Map<string, Record<string, unknown>>>()
  let counter = 0

  function table(name: string): Map<string, Record<string, unknown>> {
    let t = tables.get(name)
    if (!t) {
      t = new Map()
      tables.set(name, t)
    }
    return t
  }

  function matches(row: Record<string, unknown>, filters: Record<string, string>): boolean {
    return Object.entries(filters).every(([key, value]) => String(row[key]) === value)
  }

  return {
    __reset: () => {
      tables.clear()
      counter = 0
    },
    __seed: (name: string, row: Record<string, unknown>) => {
      const id = (row.id as string) ?? `${name}-seed-${++counter}`
      const full = { id, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...row }
      table(name).set(id, full)
      return full
    },
    dbList: vi.fn(async (name: string, filters: Record<string, string> = {}) => {
      return Array.from(table(name).values()).filter((row) => matches(row, filters))
    }),
    dbGet: vi.fn(async (name: string, id: string) => {
      const row = table(name).get(id)
      if (!row) throw new Error(`not found: ${name}/${id}`)
      return row
    }),
    dbInsert: vi.fn(async (name: string, row: Record<string, unknown>) => {
      const id = `${name}-${++counter}`
      const full = { id, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...row }
      table(name).set(id, full)
      return full
    }),
    dbUpdate: vi.fn(async (name: string, id: string, patch: Record<string, unknown>) => {
      const existing = table(name).get(id)
      if (!existing) throw new Error(`not found: ${name}/${id}`)
      const updated = { ...existing, ...patch }
      table(name).set(id, updated)
      return updated
    }),
    dbDelete: vi.fn(async (name: string, id: string) => {
      table(name).delete(id)
    }),
  }
})

// --- Fake storage.ts / email-sdk.ts / task-sdk.ts ---------------------------
vi.mock('./storage', () => ({
  storageUpload: vi.fn(async (key: string) => ({ key })),
  getPresignedUploadUrl: vi.fn(async (key: string) => ({ url: `https://upload.example.com/${key}`, key, expiresIn: 900, maxBytes: 500_000_000 })),
  getPresignedDownloadUrl: vi.fn(async (key: string) => ({ url: `https://download.example.com/${key}`, expiresIn: 900 })),
}))
vi.mock('./email-sdk', () => ({
  sendEmail: vi.fn(async () => ({ sent: true, messageId: 'mock-message' })),
}))
vi.mock('./task-sdk', () => ({
  createDelayedTask: vi.fn(async () => ({ id: 'task-1', nextRunAt: new Date().toISOString(), oneShot: true as const })),
}))

// --- Fake providers ----------------------------------------------------------
type VideoStatusResult = { status: 'processing' | 'ready' | 'failed'; videoUrl?: string; error?: string }
type AvatarStatusResult = { status: 'training' | 'ready' | 'failed'; error?: string }
const heygenCreateVideo = vi.fn(async () => 'provider-video-1')
const heygenVideoStatus = vi.fn(async (): Promise<VideoStatusResult> => ({ status: 'processing' }))
const heygenCreateAvatar = vi.fn(async () => ({ avatarId: 'provider-avatar-1', groupId: 'provider-group-1' }))
const heygenUploadAsset = vi.fn(async () => ({ assetId: 'provider-asset-1', url: 'https://files.heygen.ai/provider-asset-1.mp4' }))
const heygenAvatarStatus = vi.fn(async (): Promise<AvatarStatusResult> => ({ status: 'training' }))
vi.mock('./providers/heygen', () => ({
  createVideo: (...args: unknown[]) => heygenCreateVideo(...(args as [])),
  videoStatus: (...args: unknown[]) => heygenVideoStatus(...(args as [])),
  createAvatar: (...args: unknown[]) => heygenCreateAvatar(...(args as [])),
  uploadAsset: (...args: unknown[]) => heygenUploadAsset(...(args as [])),
  avatarStatus: (...args: unknown[]) => heygenAvatarStatus(...(args as [])),
}))

const fishTts = vi.fn(async () => Buffer.from('fake-audio-bytes'))
const fishCloneVoice = vi.fn(async () => 'fish-voice-1')
vi.mock('./providers/fish', () => ({
  tts: (...args: unknown[]) => fishTts(...(args as [])),
  cloneVoice: (...args: unknown[]) => fishCloneVoice(...(args as [])),
}))

const kitsConvert = vi.fn(async () => Buffer.from('fake-swapped-audio'))
const kitsCreateTargetVoice = vi.fn(async () => 'kits-voice-1')
vi.mock('./providers/kits', () => ({
  convert: (...args: unknown[]) => kitsConvert(...(args as [])),
  createTargetVoice: (...args: unknown[]) => kitsCreateTargetVoice(...(args as [])),
}))

const groqTranscribe = vi.fn(async () => ({
  text: 'Hello world.',
  words: [
    { word: 'Hello', start: 0, end: 0.4 },
    { word: 'world.', start: 0.4, end: 0.8 },
  ],
}))
vi.mock('./providers/groq', () => ({
  transcribe: (...args: unknown[]) => groqTranscribe(...(args as [])),
}))

const researchFindSources = vi.fn(async (lines: string[]) =>
  lines.map((_, i) => ({ url: `https://example.com/${i}`, title: `Source ${i}`, snippet: '', cueType: 'none', direction: 'Hold shot.' })),
)
vi.mock('./providers/research', () => ({
  findSources: (...args: unknown[]) => researchFindSources(args[0] as string[]),
}))

import { dbGet, dbList } from './db'
import { bootstrapWorkspace } from './credits'
import { createVideoGeneration, createVoiceGeneration, tick } from './jobs'
import type { Viewer } from './auth'
import type { AvatarRow, JobRow, ProjectRow, VoiceRow, WorkspaceRow } from './types'

const TOKEN = 'test-token'
const VIEWER_ID = 'viewer-jobs-test'

interface DbTestModule {
  __reset: () => void
  __seed: (name: string, row: Record<string, unknown>) => Record<string, unknown>
}

let db: DbTestModule
let viewer: Viewer
let workspace: WorkspaceRow
let avatar: AvatarRow
let voice: VoiceRow
let project: ProjectRow

beforeEach(async () => {
  process.env.PROVIDER_MOCK = '1' // route lib/providers/mock.ts's isMockMode() true everywhere
  db = (await import('./db')) as unknown as DbTestModule
  db.__reset()
  vi.clearAllMocks()
  heygenVideoStatus.mockResolvedValue({ status: 'processing' as const })
  heygenCreateVideo.mockResolvedValue('provider-video-1')
  // createVideoGeneration re-downloads the approved voiceover from storage (a real cross-request
  // hop in production) via the mocked getPresignedDownloadUrl's fake https://download.example.com
  // URL — stub global fetch so that read succeeds instead of hitting a real, unresolvable host.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.startsWith('https://download.example.com/')) {
        return new Response(new Uint8Array(Buffer.from('fake-voiceover-bytes')), { status: 200 })
      }
      throw new Error(`unexpected fetch in test: ${String(url)}`)
    }),
  )

  viewer = { token: TOKEN, viewerId: VIEWER_ID, isAnon: false, isSandbox: false }
  workspace = await bootstrapWorkspace(VIEWER_ID, TOKEN)
  avatar = db.__seed('avatars', { viewer_id: VIEWER_ID, name: 'Avatar', status: 'ready', heygen_avatar_id: 'heygen-avatar-1' }) as unknown as AvatarRow
  voice = db.__seed('voices', { viewer_id: VIEWER_ID, name: 'Voice', status: 'ready', fish_voice_id: 'fish-voice-1', kits_voice_id: 'kits-voice-1' }) as unknown as VoiceRow
  project = db.__seed('projects', {
    viewer_id: VIEWER_ID,
    title: 'Test Project',
    stage: 'video',
    status: 'draft',
    script: 'Hello world. This is a test script.',
    format: 'vertical',
    language: 'en',
    voice_id: voice.id,
    avatar_id: avatar.id,
    voice_mode: 'tts',
    credits_spent: 0,
  }) as unknown as ProjectRow
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function getJobsForProject(): Promise<JobRow[]> {
  return dbList<JobRow>('jobs', { project_id: project.id }, TOKEN)
}

/** Runs the two-step flow (voice, then video) exactly as the frontend does: generate + approve
 *  voice, refetch the project, then generate video off the approved voiceover. */
async function generateVoiceThenVideo(): Promise<{ voiceJob: JobRow; videoJob: JobRow }> {
  const { job: voiceJob } = await createVoiceGeneration(project, viewer, {})
  const projectAfterVoice = await dbGet<ProjectRow>('projects', project.id, TOKEN)
  const { job: videoJob } = await createVideoGeneration(projectAfterVoice, viewer, {})
  return { voiceJob, videoJob }
}

describe('createVoiceGeneration + createVideoGeneration', () => {
  it('reserves credits per step, runs the voice stage synchronously, and starts the video job', async () => {
    const { voiceJob, videoJob } = await generateVoiceThenVideo()

    expect(voiceJob.status).toBe('ready')
    expect(voiceJob.credits_charged).toBe(voiceJob.credits_reserved)
    expect(videoJob.status).toBe('processing')
    expect(videoJob.provider_job_id).toBe('provider-video-1')
    expect(fishTts).toHaveBeenCalledTimes(1)
    expect(heygenCreateVideo).toHaveBeenCalledTimes(1)

    const refreshedWorkspace = await dbGet<WorkspaceRow>('workspaces', workspace.id, TOKEN)
    const expectedReserve = 1 * 1 + 1 * 40 // 1-minute script: voice_gen(1) + video_gen(40)
    expect(refreshedWorkspace.credits_balance).toBe(workspace.credits_balance - expectedReserve)
  })

  it('creates exactly one job row per pipeline stage (voice, video, transcribe, notes)', async () => {
    await generateVoiceThenVideo()
    const jobs = await getJobsForProject()
    expect(jobs.map((j) => j.type).sort()).toEqual(['notes', 'transcribe', 'video_gen', 'voice_gen'])
  })
})

describe('tick — chains video -> transcribe -> notes and completes the project', () => {
  it('advances a ready video job through transcription and notes to project.status=ready', async () => {
    await generateVoiceThenVideo()
    heygenVideoStatus.mockResolvedValue({ status: 'ready' as const, videoUrl: 'https://provider.example.com/video.mp4' })

    const result = await tick({ viewerId: VIEWER_ID, token: TOKEN })
    expect(result.advanced).toBe(1)

    const jobs = await getJobsForProject()
    const videoJob = jobs.find((j) => j.type === 'video_gen')
    const transcribeJob = jobs.find((j) => j.type === 'transcribe')
    const notesJob = jobs.find((j) => j.type === 'notes')
    expect(videoJob?.status).toBe('ready')
    expect(transcribeJob?.status).toBe('ready')
    expect(notesJob?.status).toBe('ready')
    expect(groqTranscribe).toHaveBeenCalledTimes(1)
    expect(researchFindSources).toHaveBeenCalledTimes(1)

    const refreshedProject = await dbGet<ProjectRow>('projects', project.id, TOKEN)
    expect(refreshedProject.status).toBe('ready')
    expect(refreshedProject.stage).toBe('publish')

    const notesPdfAsset = (await dbList('assets', { project_id: project.id }, TOKEN)).find(
      (a) => (a as { kind: string }).kind === 'notes_pdf',
    )
    expect(notesPdfAsset).toBeDefined()
  })

  it('is idempotent: re-entrant tick calls do not re-process an already-ready job', async () => {
    await generateVoiceThenVideo()
    heygenVideoStatus.mockResolvedValue({ status: 'ready' as const, videoUrl: 'https://provider.example.com/video.mp4' })

    await tick({ viewerId: VIEWER_ID, token: TOKEN })
    expect(groqTranscribe).toHaveBeenCalledTimes(1)

    const second = await tick({ viewerId: VIEWER_ID, token: TOKEN })
    expect(second.advanced).toBe(0)
    // No new work should have happened — still exactly one transcribe call.
    expect(groqTranscribe).toHaveBeenCalledTimes(1)
    expect(heygenVideoStatus).toHaveBeenCalledTimes(1)
  })

  it('leaves a still-processing video job untouched and reports zero advanced', async () => {
    await generateVoiceThenVideo()
    heygenVideoStatus.mockResolvedValue({ status: 'processing' as const })

    const result = await tick({ viewerId: VIEWER_ID, token: TOKEN })
    expect(result.advanced).toBe(0)
    const jobs = await getJobsForProject()
    expect(jobs.find((j) => j.type === 'video_gen')?.status).toBe('processing')
  })
})

describe('provider failure -> refund', () => {
  it('refunds the video job\'s reservation and cascades cancellation + refund to siblings when HeyGen createVideo throws', async () => {
    heygenCreateVideo.mockRejectedValue(new Error('HeyGen is down'))

    await generateVoiceThenVideo()

    const jobs = await getJobsForProject()
    const voiceJob = jobs.find((j) => j.type === 'voice_gen')
    const videoJob = jobs.find((j) => j.type === 'video_gen')
    const transcribeJob = jobs.find((j) => j.type === 'transcribe')
    const notesJob = jobs.find((j) => j.type === 'notes')

    expect(voiceJob?.status).toBe('ready') // voice stage had already completed before video start failed
    expect(videoJob?.status).toBe('failed')
    expect(videoJob?.error).toContain('HeyGen is down')
    expect(transcribeJob?.status).toBe('cancelled')
    expect(notesJob?.status).toBe('cancelled')

    const refreshedProject = await dbGet<ProjectRow>('projects', project.id, TOKEN)
    expect(refreshedProject.status).toBe('failed')

    // The video job's reservation (40 cr) must come back via a refund ledger row.
    const refreshedWorkspace = await dbGet<WorkspaceRow>('workspaces', workspace.id, TOKEN)
    const voiceCharged = voiceJob?.credits_charged ?? 0
    expect(refreshedWorkspace.credits_balance).toBe(workspace.credits_balance - voiceCharged)
  })

  it('refunds via a video-status failure reported mid-poll, not just start failures', async () => {
    await generateVoiceThenVideo()
    heygenVideoStatus.mockResolvedValue({ status: 'failed' as const, error: 'render error' })

    await tick({ viewerId: VIEWER_ID, token: TOKEN })

    const jobs = await getJobsForProject()
    const videoJob = jobs.find((j) => j.type === 'video_gen')
    expect(videoJob?.status).toBe('failed')
    expect(videoJob?.error).toBe('render error')

    const refreshedProject = await dbGet<ProjectRow>('projects', project.id, TOKEN)
    expect(refreshedProject.status).toBe('failed')
  })
})
