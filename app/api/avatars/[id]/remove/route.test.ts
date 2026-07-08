import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../../lib/db', () => {
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
    dbGet: vi.fn(async (name: string, id: string) => {
      const row = table(name).get(id)
      if (!row) throw new Error(`not found: ${name}/${id}`)
      return row
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

import { POST } from './route'
import { dbList } from '../../../../../lib/db'
import type { JobRow } from '../../../../../lib/types'

interface DbTestModule {
  __reset: () => void
  __seed: (name: string, row: Record<string, unknown>) => Record<string, unknown>
}

const VIEWER = 'viewer-1'

function makeRequest(): Request {
  return new Request('http://localhost/api/avatars/a1/remove', {
    method: 'POST',
    headers: { 'x-embed-token': `header.${Buffer.from(JSON.stringify({ userId: VIEWER })).toString('base64')}.sig` },
  })
}

let db: DbTestModule

beforeEach(async () => {
  db = (await import('../../../../../lib/db')) as unknown as DbTestModule
  db.__reset()
})

describe('POST /api/avatars/[id]/remove', () => {
  it('hides the avatar and its paired voice, returns 200', async () => {
    db.__seed('avatars', { id: 'a1', viewer_id: VIEWER, name: 'Presenter', status: 'ready' })
    db.__seed('voices', { id: 'v1', viewer_id: VIEWER, name: 'Presenter', status: 'ready' })
    db.__seed('jobs', { viewer_id: VIEWER, type: 'avatar_create', input_json: { avatarId: 'a1' }, output_json: {} })
    db.__seed('jobs', { viewer_id: VIEWER, type: 'voice_clone', input_json: { voiceId: 'v1' }, output_json: {} })

    const res = await POST(makeRequest(), { params: { id: 'a1' } })
    expect(res.status).toBe(200)

    const avatarJobs = await dbList<JobRow>('jobs', { viewer_id: VIEWER, type: 'avatar_create' }, VIEWER)
    const voiceJobs = await dbList<JobRow>('jobs', { viewer_id: VIEWER, type: 'voice_clone' }, VIEWER)
    expect(avatarJobs[0].output_json.hidden).toBe(true)
    expect(voiceJobs[0].output_json.hidden).toBe(true)
  })

  it('404s when the avatar does not belong to the caller', async () => {
    db.__seed('avatars', { id: 'a1', viewer_id: 'someone-else', name: 'Presenter', status: 'ready' })
    const res = await POST(makeRequest(), { params: { id: 'a1' } })
    expect(res.status).toBe(404)
  })
})
