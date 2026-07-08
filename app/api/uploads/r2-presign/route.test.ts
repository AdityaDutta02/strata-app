import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../../lib/storage-r2', () => ({
  r2PresignedPutUrl: vi.fn((key: string) => `https://r2.example.com/${key}?signed=1`),
}))

import { POST } from './route'

const VIEWER = 'viewer-1'

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/uploads/r2-presign', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-embed-token': `header.${Buffer.from(JSON.stringify({ userId: VIEWER })).toString('base64')}.sig`,
    },
    body: JSON.stringify(body),
  })
}

describe('POST /api/uploads/r2-presign', () => {
  it('returns a presigned URL and a viewer-namespaced key', async () => {
    const res = await POST(makeRequest({ kind: 'avatar_training', filename: 'clip.mp4', contentType: 'video/mp4' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { url: string; key: string }
    expect(body.key).toMatch(new RegExp(`^training/${VIEWER}/`))
    expect(body.key).toMatch(/clip\.mp4$/)
    expect(body.url).toContain(body.key)
  })

  it('400s on an invalid kind', async () => {
    const res = await POST(makeRequest({ kind: 'not_a_kind', filename: 'clip.mp4', contentType: 'video/mp4' }))
    expect(res.status).toBe(400)
  })

  it('401s without an embed token', async () => {
    const res = await POST(
      new Request('http://localhost/api/uploads/r2-presign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'avatar_training', filename: 'clip.mp4', contentType: 'video/mp4' }),
      }),
    )
    expect(res.status).toBe(401)
  })
})
