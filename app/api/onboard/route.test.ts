import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/db', () => {
  const tables = new Map<string, Map<string, Record<string, unknown>>>()
  let counter = 0
  function table(name: string) {
    let t = tables.get(name)
    if (!t) { t = new Map(); tables.set(name, t) }
    return t
  }
  return {
    __reset: () => { tables.clear(); counter = 0 },
    __seed: (name: string, row: Record<string, unknown>) => {
      const id = (row.id as string) ?? `${name}-${++counter}`
      const full = { id, created_at: new Date().toISOString(), ...row }
      table(name).set(id, full)
      return full
    },
    dbList: vi.fn(async (name: string, filters: Record<string, string> = {}) =>
      Array.from(table(name).values()).filter((row) => Object.entries(filters).every(([k, v]) => String(row[k]) === v)),
    ),
  }
})

import { POST } from './route'

interface DbTestModule {
  __reset: () => void
  __seed: (name: string, row: Record<string, unknown>) => Record<string, unknown>
}

const VIEWER = 'viewer-1'

function makeRequest(): Request {
  return new Request('http://localhost/api/onboard', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-embed-token': `header.${Buffer.from(JSON.stringify({ userId: VIEWER })).toString('base64')}.sig`,
    },
    body: JSON.stringify({ name: 'New Presenter', avatarUploadKey: 'uploads/v.mp4', voiceUploadKey: 'uploads/a.wav' }),
  })
}

let db: DbTestModule

beforeEach(async () => {
  db = (await import('../../../lib/db')) as unknown as DbTestModule
  db.__reset()
})

describe('POST /api/onboard — one-avatar cap', () => {
  it('rejects with 409 when the viewer already has an unhidden avatar', async () => {
    db.__seed('avatars', { viewer_id: VIEWER, name: 'Existing', status: 'ready' })
    db.__seed('jobs', { viewer_id: VIEWER, type: 'avatar_create', input_json: { avatarId: 'avatars-1' }, output_json: {} })

    const res = await POST(makeRequest())
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/Remove your current avatar/)
  })
})
