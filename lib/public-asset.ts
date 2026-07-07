// lib/public-asset.ts — signed, expiring URLs on OUR origin for handing storage objects to
// external providers (HeyGen digital-twin training). The platform's presigned URLs are not
// reliably reachable from outside the gateway, but the app's https origin is. The presigned
// URL is minted while we still hold a valid viewer token and is EMBEDDED in the signed
// query, so the proxy needs no credential at provider-fetch time. TTL is bounded by the
// presigned URL's own 15-minute validity.
import { createHmac, timingSafeEqual } from 'node:crypto'

function secret(): string {
  const value = process.env.APP_ASSET_SECRET
  if (!value) throw new Error('APP_ASSET_SECRET is not configured')
  return value
}

function publicBaseUrl(): string {
  const value = process.env.APP_PUBLIC_URL
  if (!value) throw new Error('APP_PUBLIC_URL is not configured')
  return value.replace(/\/$/, '')
}

function sign(encodedUpstream: string, expiresAtSec: number): string {
  return createHmac('sha256', secret()).update(`${encodedUpstream}\n${expiresAtSec}`).digest('hex')
}

/** Wraps an already-presigned storage URL in a signed URL on the app's public origin. */
export function publicAssetUrl(presignedUpstreamUrl: string, ttlSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  const u = Buffer.from(presignedUpstreamUrl, 'utf8').toString('base64url')
  const params = new URLSearchParams({ u, exp: String(exp), sig: sign(u, exp) })
  return `${publicBaseUrl()}/api/public-asset?${params.toString()}`
}

/** Verifies a proxy request and returns the embedded upstream URL, or null if invalid/expired. */
export function verifyPublicAsset(u: string, expiresAtSec: number, sig: string): string | null {
  if (!u || !Number.isFinite(expiresAtSec) || !sig) return null
  if (expiresAtSec * 1000 < Date.now()) return null
  const expected = sign(u, expiresAtSec)
  const a = new Uint8Array(Buffer.from(expected, 'utf8'))
  const b = new Uint8Array(Buffer.from(sig, 'utf8'))
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    return Buffer.from(u, 'base64url').toString('utf8')
  } catch {
    return null
  }
}
