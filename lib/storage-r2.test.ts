import { describe, expect, it, vi, beforeEach } from 'vitest'

describe('storage-r2', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
    process.env.R2_ACCOUNT_ID = 'acct-1'
    process.env.R2_ACCESS_KEY_ID = 'key-1'
    process.env.R2_SECRET_ACCESS_KEY = 'secret-1'
    process.env.R2_BUCKET = 'strata-bucket'
  })

  it('r2Upload PUTs to the correct R2 URL with a signed Authorization header', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { r2Upload } = await import('./storage-r2')
    await r2Upload('training/foo.mp4', Buffer.from('bytes'), 'video/mp4')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit & { headers: Record<string, string> }]
    expect(url).toBe('https://acct-1.r2.cloudflarestorage.com/strata-bucket/training/foo.mp4')
    expect(init.method).toBe('PUT')
    expect(init.headers['Content-Type']).toBe('video/mp4')
    expect(init.headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=key-1\//)
    expect(init.headers['x-amz-content-sha256']).toHaveLength(64)
  })

  it('r2Download GETs the correct R2 URL and returns the body as a Buffer', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array(Buffer.from('hello world')), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { r2Download } = await import('./storage-r2')
    const result = await r2Download('training/foo.mp4')

    expect(result.toString()).toBe('hello world')
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit & { headers: Record<string, string> }]
    expect(url).toBe('https://acct-1.r2.cloudflarestorage.com/strata-bucket/training/foo.mp4')
    expect(init.headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=key-1\//)
  })

  it('throws a clear error on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('access denied', { status: 403 })))
    const { r2Download } = await import('./storage-r2')
    await expect(r2Download('training/foo.mp4')).rejects.toThrow(/R2 download failed: 403/)
  })

  it('throws a clear error when R2 env vars are missing', async () => {
    delete process.env.R2_BUCKET
    const { r2Upload } = await import('./storage-r2')
    await expect(r2Upload('k', Buffer.from('x'), 'video/mp4')).rejects.toThrow(/R2_BUCKET/)
  })

  it('r2PresignedPutUrl returns a query-signed URL for the given key', async () => {
    const { r2PresignedPutUrl } = await import('./storage-r2')
    const url = r2PresignedPutUrl('training/foo.mp4', 900)
    expect(url).toMatch(/^https:\/\/acct-1\.r2\.cloudflarestorage\.com\/strata-bucket\/training\/foo\.mp4\?/)
    expect(url).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256')
    expect(url).toContain('X-Amz-Credential=key-1%2F')
    expect(url).toContain('X-Amz-Expires=900')
    expect(url).toContain('X-Amz-Signature=')
  })

  it('r2PresignedGetUrl returns a query-signed URL for the given key', async () => {
    const { r2PresignedGetUrl } = await import('./storage-r2')
    const url = r2PresignedGetUrl('training/foo.mp4')
    expect(url).toMatch(/^https:\/\/acct-1\.r2\.cloudflarestorage\.com\/strata-bucket\/training\/foo\.mp4\?/)
    expect(url).toContain('X-Amz-Signature=')
  })
})
