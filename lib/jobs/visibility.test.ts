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
  return {
    __reset: () => {
      tables.clear()
      counter = 0
    },
    __seed: (name: string, row: Record<string, unknown>) => {
      const id = (row.id as string) ?? `${name}-${++counter}`
      const full = { id, created_at: new Date(Date.now() + counter).toISOString(), ...row }
      table(name).set(id, full)
      return full
    },
    dbList: vi.fn(async (name: string, filters: Record<string, string> = {}) =>
      Array.from(table(name).values()).filter((row) => Object.entries(filters).every(([k, v]) => String(row[k]) === v)),
    ),
    dbUpdate: vi.fn(async (name: string, id: string, patch: Record<string, unknown>) => {
      const existing = table(name).get(id)
      const updated = { ...existing, ...patch }
      table(name).set(id, updated)
      return updated
    }),
  }
})

import { latestJob, isHidden, hideAvatarAndVoice } from './visibility'

interface DbTestModule {
  __reset: () => void
  __seed: (name: string, row: Record<string, unknown>) => Record<string, unknown>
}

let db: DbTestModule
const VIEWER = 'viewer-1'
const TOKEN = 'token-1'

beforeEach(async () => {
  db = (await import('../db')) as unknown as DbTestModule
  db.__reset()
})

describe('latestJob / isHidden', () => {
  it('returns the most recently created matching job', async () => {
    db.__seed('jobs', { viewer_id: VIEWER, type: 'avatar_create', input_json: { avatarId: 'a1' }, output_json: {} })
    const second = db.__seed('jobs', { viewer_id: VIEWER, type: 'avatar_create', input_json: { avatarId: 'a1' }, output_json: { hidden: true } })
    const found = await latestJob('avatar_create', 'avatarId', 'a1', VIEWER, TOKEN)
    expect(found?.id).toBe(second.id)
    expect(isHidden(found)).toBe(true)
  })

  it('returns null when nothing matches', async () => {
    const found = await latestJob('avatar_create', 'avatarId', 'missing', VIEWER, TOKEN)
    expect(found).toBeNull()
    expect(isHidden(found)).toBe(false)
  })
})

describe('hideAvatarAndVoice', () => {
  it('hides the avatar job and the one currently-visible voice job', async () => {
    db.__seed('jobs', { viewer_id: VIEWER, type: 'avatar_create', input_json: { avatarId: 'a1' }, output_json: {} })
    db.__seed('voices', { id: 'v1', viewer_id: VIEWER, name: 'Voice' })
    db.__seed('jobs', { viewer_id: VIEWER, type: 'voice_clone', input_json: { voiceId: 'v1' }, output_json: {} })

    await hideAvatarAndVoice('a1', VIEWER, TOKEN)

    const avatarJob = await latestJob('avatar_create', 'avatarId', 'a1', VIEWER, TOKEN)
    const voiceJob = await latestJob('voice_clone', 'voiceId', 'v1', VIEWER, TOKEN)
    expect(isHidden(avatarJob)).toBe(true)
    expect(isHidden(voiceJob)).toBe(true)
  })

  it('is idempotent — calling twice does not throw', async () => {
    db.__seed('jobs', { viewer_id: VIEWER, type: 'avatar_create', input_json: { avatarId: 'a1' }, output_json: {} })
    db.__seed('voices', { id: 'v1', viewer_id: VIEWER, name: 'Voice' })
    db.__seed('jobs', { viewer_id: VIEWER, type: 'voice_clone', input_json: { voiceId: 'v1' }, output_json: {} })

    await hideAvatarAndVoice('a1', VIEWER, TOKEN)
    await expect(hideAvatarAndVoice('a1', VIEWER, TOKEN)).resolves.not.toThrow()
  })
})
