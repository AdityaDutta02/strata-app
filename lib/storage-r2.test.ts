import { describe, expect, it, vi, beforeEach } from 'vitest'

const send = vi.fn()
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({ send })),
  PutObjectCommand: vi.fn((input: unknown) => ({ input, __type: 'put' })),
  GetObjectCommand: vi.fn((input: unknown) => ({ input, __type: 'get' })),
}))

describe('storage-r2', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.R2_ACCOUNT_ID = 'acct-1'
    process.env.R2_ACCESS_KEY_ID = 'key-1'
    process.env.R2_SECRET_ACCESS_KEY = 'secret-1'
    process.env.R2_BUCKET = 'strata-bucket'
  })

  it('r2Upload sends a PutObjectCommand with the bucket, key, body and content type', async () => {
    send.mockResolvedValue({})
    const { r2Upload } = await import('./storage-r2')
    await r2Upload('training/foo.mp4', Buffer.from('bytes'), 'video/mp4')
    expect(send).toHaveBeenCalledTimes(1)
    const cmd = send.mock.calls[0]![0] as { input: Record<string, unknown> }
    expect(cmd.input).toMatchObject({ Bucket: 'strata-bucket', Key: 'training/foo.mp4', ContentType: 'video/mp4' })
  })

  it('r2Download reads the body stream into a Buffer', async () => {
    const { Readable } = await import('stream')
    const body = Readable.from([Buffer.from('hello '), Buffer.from('world')])
    send.mockResolvedValue({ Body: body })
    const { r2Download } = await import('./storage-r2')
    const result = await r2Download('training/foo.mp4')
    expect(result.toString()).toBe('hello world')
    const cmd = send.mock.calls[0]![0] as { input: Record<string, unknown> }
    expect(cmd.input).toMatchObject({ Bucket: 'strata-bucket', Key: 'training/foo.mp4' })
  })

  it('throws a clear error when R2 env vars are missing', async () => {
    delete process.env.R2_BUCKET
    vi.resetModules()
    const { r2Upload } = await import('./storage-r2')
    await expect(r2Upload('k', Buffer.from('x'), 'video/mp4')).rejects.toThrow(/R2_BUCKET/)
  })
})
