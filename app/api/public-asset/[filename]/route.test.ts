import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, HEAD } from './route'
import { publicAssetUrl } from '../../../../lib/public-asset'

describe('public-asset proxy route', () => {
  beforeEach(() => {
    process.env.APP_ASSET_SECRET = 'test-secret'
    process.env.APP_PUBLIC_URL = 'https://app.example.com/'
  })
  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.APP_ASSET_SECRET
    delete process.env.APP_PUBLIC_URL
  })

  function signedUrl(filename: string): string {
    // Upstream is a GET-only presigned URL that 403s on HEAD (S3 verb binding).
    return publicAssetUrl('https://storage.internal/bucket/key.mp4?X-Amz-Signature=abc', 60, filename)
  }

  it('answers HEAD with 200 video/mp4 WITHOUT touching upstream', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const res = await HEAD(new Request(signedUrl('training.mp4'), { method: 'HEAD' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('video/mp4')
    expect(res.headers.get('content-disposition')).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('streams GET as video/mp4 regardless of upstream octet-stream content-type', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('BYTES', { status: 200, headers: { 'content-type': 'application/octet-stream', 'content-length': '5' } }),
    )
    const res = await GET(new Request(signedUrl('training.mp4'), { method: 'GET' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('video/mp4')
    expect(res.headers.get('content-disposition')).toBeNull()
    expect(await res.text()).toBe('BYTES')
  })

  it('rejects a tampered signature with 403', async () => {
    const res = await HEAD(new Request('https://app.example.com/api/public-asset/training.mp4?u=x&exp=9999999999&sig=bad', { method: 'HEAD' }))
    expect(res.status).toBe(403)
  })
})
