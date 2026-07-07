import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { publicAssetUrl, verifyPublicAsset } from './public-asset'

const UPSTREAM = 'https://storage.internal:9000/bucket/key.mp4?X-Amz-Signature=abc123'

describe('public-asset signed proxy URLs', () => {
  beforeEach(() => {
    process.env.APP_ASSET_SECRET = 'test-secret'
    process.env.APP_PUBLIC_URL = 'https://app.example.com/'
  })
  afterEach(() => {
    delete process.env.APP_ASSET_SECRET
    delete process.env.APP_PUBLIC_URL
  })

  it('round-trips the embedded upstream URL when the signature is valid', () => {
    const url = new URL(publicAssetUrl(UPSTREAM, 60, 'training.mp4'))
    expect(url.origin + url.pathname).toBe('https://app.example.com/api/public-asset/training.mp4')
    const upstream = verifyPublicAsset(
      url.searchParams.get('u') ?? '',
      Number(url.searchParams.get('exp')),
      url.searchParams.get('sig') ?? '',
    )
    expect(upstream).toBe(UPSTREAM)
  })

  it('rejects expired and tampered inputs', () => {
    const url = new URL(publicAssetUrl(UPSTREAM, 60))
    const u = url.searchParams.get('u') ?? ''
    const exp = Number(url.searchParams.get('exp'))
    const sig = url.searchParams.get('sig') ?? ''
    expect(verifyPublicAsset(u, exp - 120, sig)).toBeNull()
    expect(verifyPublicAsset(u + 'x', exp, sig)).toBeNull()
    expect(verifyPublicAsset(u, exp, sig.replace(/.$/, sig.endsWith('0') ? '1' : '0'))).toBeNull()
  })
})
