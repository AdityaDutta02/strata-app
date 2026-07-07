import { NextResponse } from 'next/server'
import { verifyPublicAsset } from '../../../../lib/public-asset'
import { logger } from '../../../../lib/logger'

// Streams a storage object to external providers via OUR public https origin. Access is
// gated by an expiring HMAC signature over an EMBEDDED presigned upstream URL — minted
// while a valid viewer token was in hand, so this route needs no credential of its own.
// The path segment is a cosmetic media filename (e.g. training.mp4): some providers
// validate the URL's extension before downloading. Providers may probe with HEAD first.

// Content-type is derived from the filename WE control in the path, never from the
// upstream response: S3 stores often serve objects as application/octet-stream, and
// providers (HeyGen) reject a video URL that answers with octet-stream/attachment.
// Restricting to this media allowlist keeps first-party XSS impossible (only passive
// media types pass; nosniff + CSP sandbox back it up); anything else is a download.
const MEDIA_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
}

function contentTypeForName(filename: string): { contentType: string; attachment: boolean } {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  const media = MEDIA_TYPES[ext]
  return media ? { contentType: media, attachment: false } : { contentType: 'application/octet-stream', attachment: true }
}

function baseHeaders(contentType: string, attachment: boolean, contentLength?: string | null): HeadersInit {
  return {
    'content-type': contentType,
    ...(attachment ? { 'content-disposition': 'attachment; filename="asset"' } : {}),
    ...(contentLength ? { 'content-length': contentLength } : {}),
    'accept-ranges': 'none',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    'cache-control': 'private, max-age=0',
  }
}

async function serve(request: Request, method: 'GET' | 'HEAD'): Promise<Response> {
  const url = new URL(request.url)
  const upstreamUrl = verifyPublicAsset(
    url.searchParams.get('u') ?? '',
    Number(url.searchParams.get('exp')),
    url.searchParams.get('sig') ?? '',
  )
  if (!upstreamUrl) return NextResponse.json({ error: 'Invalid or expired signature' }, { status: 403 })

  const filename = decodeURIComponent(url.pathname.split('/').pop() ?? 'asset')
  const { contentType, attachment } = contentTypeForName(filename)

  // HEAD is a provider reachability probe. Do NOT forward it upstream: the embedded
  // presigned URL is signed for GET only, so a HEAD against it returns 403 (verb bound
  // into the S3 signature) — which would surface as a 502 and read to the provider as
  // "could not download the file". Answer HEAD from our own metadata; the GET below is
  // authoritative and does the real fetch + stream.
  if (method === 'HEAD') {
    return new Response(null, { status: 200, headers: baseHeaders(contentType, attachment) })
  }

  try {
    const upstream = await fetch(upstreamUrl, { method: 'GET' })
    if (!upstream.ok || !upstream.body) {
      logger.error({ msg: 'public-asset upstream fetch failed', status: upstream.status })
      return NextResponse.json({ error: 'Asset unavailable' }, { status: 502 })
    }
    return new Response(upstream.body, {
      status: 200,
      headers: baseHeaders(contentType, attachment, upstream.headers.get('content-length')),
    })
  } catch (err) {
    logger.error({ msg: 'public-asset error', err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Asset unavailable' }, { status: 502 })
  }
}

export async function GET(request: Request): Promise<Response> {
  return serve(request, 'GET')
}

// Providers (HeyGen) probe with HEAD before downloading — must not 405, and must not 502.
export async function HEAD(request: Request): Promise<Response> {
  return serve(request, 'HEAD')
}
