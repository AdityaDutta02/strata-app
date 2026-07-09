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

let downloadImpl: (key: string) => Promise<Buffer>
const r2DownloadMock = vi.fn((key: string) => downloadImpl(key))
vi.mock('../storage-r2', () => ({
  r2Download: (key: string) => r2DownloadMock(key),
  r2PresignedGetUrl: vi.fn((key: string) => `https://r2.example.com/${key}`),
}))

const heygenUploadAsset = vi.fn(async (_buffer: Buffer, ..._rest: unknown[]) => ({ assetId: 'asset-1', url: 'https://files.heygen.ai/asset-1.mp4' }))
const heygenCreateAvatar = vi.fn(async () => ({ avatarId: 'heygen-avatar-1', groupId: 'group-1', needsConsent: false }))
vi.mock('../providers/heygen', () => ({
  uploadAsset: (...args: unknown[]) => heygenUploadAsset(...(args as [Buffer])),
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
  downloadImpl = async (key: string) => Buffer.from(`bytes-for-${key}`)
  viewer = { token: TOKEN, viewerId: VIEWER_ID, isAnon: false, isSandbox: false }
  await bootstrapWorkspace(VIEWER_ID, TOKEN)
})

describe('runAvatarTraining (via createOnboardingJobs)', () => {
  it('downloads training footage straight from R2 (no Terminal AI storage hop) and uploads it to HeyGen', async () => {
    const { avatar } = await createOnboardingJobs(viewer, {
      name: 'Presenter',
      avatarUploadKey: 'training/viewer-onboarding-test/video.mp4',
      voiceUploadKey: 'training/viewer-onboarding-test/audio.wav',
    })
    expect(avatar.status).toBe('ready')
    expect(r2DownloadMock).toHaveBeenCalledWith('training/viewer-onboarding-test/video.mp4')
    expect(heygenUploadAsset).toHaveBeenCalledTimes(1)
    expect(heygenUploadAsset.mock.calls[0]![0]).toEqual(Buffer.from('bytes-for-training/viewer-onboarding-test/video.mp4'))
    expect(heygenCreateAvatar).toHaveBeenCalledWith({ type: 'asset_id', asset_id: 'asset-1' }, VIEWER_ID, TOKEN)
  })

  it('retry re-downloads the same R2 key and can succeed after an earlier failure', async () => {
    downloadImpl = async () => {
      throw Object.assign(new Error('fetch failed'), {
        cause: Object.assign(new Error('EAI_AGAIN'), { code: 'EAI_AGAIN' }),
      })
    }
    const { avatar, jobs } = await createOnboardingJobs(viewer, {
      name: 'Presenter',
      avatarUploadKey: 'training/viewer-onboarding-test/video.mp4',
      voiceUploadKey: 'training/viewer-onboarding-test/audio.wav',
    })
    expect(avatar.status).toBe('failed')

    downloadImpl = async (key: string) => Buffer.from(`bytes-for-${key}`)
    const avatarJob = jobs.find((j) => j.type === 'avatar_create') as JobRow
    await retryAvatarTraining(avatarJob, avatar, viewer)

    const retried = jobs.find((j) => j.type === 'avatar_create') as JobRow
    expect(retried).toBeTruthy()
  })

  it('retries a transient download failure and still succeeds', async () => {
    let videoAttempts = 0
    downloadImpl = async (key: string) => {
      if (!key.includes('video.mp4')) return Buffer.from(`bytes-for-${key}`)
      videoAttempts += 1
      if (videoAttempts < 2) {
        const err = new Error('fetch failed')
        ;(err as unknown as { cause: unknown }).cause = Object.assign(new Error('EAI_AGAIN'), { code: 'EAI_AGAIN' })
        throw err
      }
      return Buffer.from(`bytes-for-${key}`)
    }
    const { avatar } = await createOnboardingJobs(viewer, {
      name: 'Presenter',
      avatarUploadKey: 'training/viewer-onboarding-test/video.mp4',
      voiceUploadKey: 'training/viewer-onboarding-test/audio.wav',
    })
    expect(avatar.status).toBe('ready')
    expect(videoAttempts).toBe(2)
  })

  it('fails clearly with a labeled step + attempt count when retries are exhausted', async () => {
    downloadImpl = async () => {
      const err = new Error('fetch failed')
      ;(err as unknown as { cause: unknown }).cause = Object.assign(new Error('EAI_AGAIN'), { code: 'EAI_AGAIN' })
      throw err
    }
    const { avatar } = await createOnboardingJobs(viewer, {
      name: 'Presenter',
      avatarUploadKey: 'training/viewer-onboarding-test/video.mp4',
      voiceUploadKey: 'training/viewer-onboarding-test/audio.wav',
    })
    expect(avatar.status).toBe('failed')
    expect(avatar.error).toMatch(/Downloading footage from storage/)
    expect(avatar.error).toMatch(/EAI_AGAIN/)
  })
})
