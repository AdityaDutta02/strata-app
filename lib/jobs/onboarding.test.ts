import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db', () => {
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
    dbList: vi.fn(async (name: string, filters: Record<string, string> = {}) =>
      Array.from(table(name).values()).filter((row) => matches(row, filters)),
    ),
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
  }
})

vi.mock('../email-sdk', () => ({ sendEmail: vi.fn(async () => ({ sent: true })) }))
vi.mock('../task-sdk', () => ({ createDelayedTask: vi.fn(async () => ({ id: 'task-1' })) }))

let downloadCalls = 0
vi.mock('../storage', () => ({
  getPresignedDownloadUrl: vi.fn(async (key: string) => {
    downloadCalls += 1
    return { url: `https://download.example.com/${key}`, expiresIn: 900 }
  }),
}))

const r2UploadMock = vi.fn(async () => undefined)
const r2DownloadMock = vi.fn(async () => Buffer.from('r2-bytes'))
vi.mock('../storage-r2', () => ({
  r2Upload: (...args: unknown[]) => r2UploadMock(...(args as [])),
  r2Download: (...args: unknown[]) => r2DownloadMock(...(args as [])),
}))

const heygenUploadAsset = vi.fn(async () => ({ assetId: 'asset-1', url: 'https://files.heygen.ai/asset-1.mp4' }))
const heygenCreateAvatar = vi.fn(async () => ({ avatarId: 'heygen-avatar-1', groupId: 'group-1' }))
vi.mock('../providers/heygen', () => ({
  uploadAsset: (...args: unknown[]) => heygenUploadAsset(...(args as [])),
  createAvatar: (...args: unknown[]) => heygenCreateAvatar(...(args as [])),
  avatarStatus: vi.fn(async () => ({ status: 'training' as const })),
  requestConsent: vi.fn(async () => ({ url: 'https://consent.example.com' })),
}))

const fishCloneVoiceFromBuffer = vi.fn(async () => 'fish-voice-1')
vi.mock('../providers/fish', () => ({
  cloneVoice: vi.fn(async () => 'fish-voice-1'),
  cloneVoiceFromBuffer: (...args: unknown[]) => fishCloneVoiceFromBuffer(...(args as [])),
}))
vi.mock('../providers/kits', () => ({ createTargetVoice: vi.fn(async () => 'kits-voice-1') }))

// A global fetch mock stands in for the raw download from Terminal AI storage inside the
// R2-copy step (createOnboardingJobs fetches the presigned URL directly). Keyed by URL so
// the avatar (video.mp4) and voice (audio.wav) downloads can be independently scripted —
// both training legs hit this same mock in one createOnboardingJobs call.
let fetchImpl: (url: string) => Promise<Response>
beforeEach(() => {
  fetchImpl = async () =>
    new Response(new Uint8Array(Buffer.from('source-bytes')), { status: 200, headers: { 'content-length': '12' } })
})
vi.stubGlobal(
  'fetch',
  vi.fn(async (...args: unknown[]) => fetchImpl(...(args as [string]))),
)

import { createOnboardingJobs, retryAvatarTraining } from './onboarding'
import { bootstrapWorkspace } from '../credits'
import type { Viewer } from '../auth'
import type { JobRow } from '../types'

interface DbTestModule {
  __reset: () => void
}

const TOKEN = 'test-token'
const VIEWER_ID = 'viewer-onboarding-test'
let viewer: Viewer

beforeEach(async () => {
  process.env.PROVIDER_MOCK = '' // exercise the real (non-mock) branch
  const db = (await import('../db')) as unknown as DbTestModule
  db.__reset()
  vi.clearAllMocks()
  downloadCalls = 0
  viewer = { token: TOKEN, viewerId: VIEWER_ID, isAnon: false, isSandbox: false }
  await bootstrapWorkspace(VIEWER_ID, TOKEN)
})

describe('runAvatarTraining (via createOnboardingJobs)', () => {
  it('copies footage to R2 once and uploads the R2 bytes to HeyGen', async () => {
    const { avatar, jobs } = await createOnboardingJobs(viewer, {
      name: 'Presenter',
      avatarUploadKey: 'uploads/video.mp4',
      voiceUploadKey: 'uploads/audio.wav',
    })
    expect(avatar.status).toBe('training')
    expect(r2UploadMock).toHaveBeenCalled()
    expect(heygenUploadAsset).toHaveBeenCalledTimes(1)
    // First attempt: no r2Key recorded yet, so the freshly-downloaded bytes are used directly
    // (r2Download is only consulted on a later retry, once r2Key is already recorded).
    expect(heygenUploadAsset.mock.calls[0][0]).toEqual(Buffer.from('source-bytes'))
    expect(heygenCreateAvatar).toHaveBeenCalledWith({ type: 'asset_id', asset_id: 'asset-1' }, VIEWER_ID, TOKEN)

    const avatarJob = jobs.find((j) => j.type === 'avatar_create') as JobRow
    expect(avatarJob.output_json.r2Key).toBeTruthy()
  })

  it('on retry, skips the Terminal AI storage download entirely once r2Key is recorded', async () => {
    const { avatar, jobs } = await createOnboardingJobs(viewer, {
      name: 'Presenter',
      avatarUploadKey: 'uploads/video.mp4',
      voiceUploadKey: 'uploads/audio.wav',
    })
    const initialDownloadCalls = downloadCalls
    expect(initialDownloadCalls).toBeGreaterThan(0)

    const avatarJob = jobs.find((j) => j.type === 'avatar_create') as JobRow
    await retryAvatarTraining(avatarJob, avatar, viewer)

    expect(downloadCalls).toBe(initialDownloadCalls) // no new Terminal-AI-storage download
    expect(r2DownloadMock).toHaveBeenCalled() // read from R2 instead
  })

  it('retries a transient download failure and still succeeds', async () => {
    let videoAttempts = 0
    fetchImpl = async (url: string) => {
      if (!url.includes('video.mp4')) {
        return new Response(new Uint8Array(Buffer.from('source-bytes')), { status: 200, headers: { 'content-length': '12' } })
      }
      videoAttempts += 1
      if (videoAttempts < 2) {
        const err = new Error('fetch failed')
        ;(err as unknown as { cause: unknown }).cause = Object.assign(new Error('EAI_AGAIN'), { code: 'EAI_AGAIN' })
        throw err
      }
      return new Response(new Uint8Array(Buffer.from('source-bytes')), { status: 200, headers: { 'content-length': '12' } })
    }
    const { avatar } = await createOnboardingJobs(viewer, {
      name: 'Presenter',
      avatarUploadKey: 'uploads/video.mp4',
      voiceUploadKey: 'uploads/audio.wav',
    })
    expect(avatar.status).toBe('training')
    expect(videoAttempts).toBe(2)
  })

  it('fails clearly with a labeled step + attempt count when retries are exhausted', async () => {
    fetchImpl = async (url: string) => {
      if (!url.includes('video.mp4')) {
        return new Response(new Uint8Array(Buffer.from('source-bytes')), { status: 200, headers: { 'content-length': '12' } })
      }
      const err = new Error('fetch failed')
      ;(err as unknown as { cause: unknown }).cause = Object.assign(new Error('EAI_AGAIN'), { code: 'EAI_AGAIN' })
      throw err
    }
    const { avatar } = await createOnboardingJobs(viewer, {
      name: 'Presenter',
      avatarUploadKey: 'uploads/video.mp4',
      voiceUploadKey: 'uploads/audio.wav',
    })
    expect(avatar.status).toBe('failed')
    expect(avatar.error).toMatch(/Copying footage to backup storage/)
    expect(avatar.error).toMatch(/EAI_AGAIN/)
  })
})
