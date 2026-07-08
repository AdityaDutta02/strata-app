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

import { GET } from './route'

interface DbTestModule {
  __reset: () => void
  __seed: (name: string, row: Record<string, unknown>) => Record<string, unknown>
}

const VIEWER = 'viewer-1'

function makeRequest(): Request {
  return new Request('http://localhost/api/voices', {
    headers: { 'x-embed-token': `header.${Buffer.from(JSON.stringify({ userId: VIEWER })).toString('base64')}.sig` },
  })
}

let db: DbTestModule

beforeEach(async () => {
  db = (await import('../../../lib/db')) as unknown as DbTestModule
  db.__reset()
})

describe('GET /api/voices', () => {
  it('excludes a voice whose latest voice_clone job is hidden', async () => {
    db.__seed('voices', { id: 'v1', viewer_id: VIEWER, name: 'Old', status: 'ready' })
    db.__seed('voices', { id: 'v2', viewer_id: VIEWER, name: 'Current', status: 'ready' })
    db.__seed('jobs', { viewer_id: VIEWER, type: 'voice_clone', input_json: { voiceId: 'v1' }, output_json: { hidden: true } })
    db.__seed('jobs', { viewer_id: VIEWER, type: 'voice_clone', input_json: { voiceId: 'v2' }, output_json: {} })

    const res = await GET(makeRequest())
    const body = (await res.json()) as { voices: Array<{ id: string }> }
    expect(body.voices.map((v) => v.id)).toEqual(['v2'])
  })
})
