import { NextResponse } from 'next/server'
import { verifyPublicAsset } from '../../../../lib/public-asset'
import { logger } from '../../../../lib/logger'

// Streams a storage object to external providers via OUR public https origin. Access is
// gated by an expiring HMAC signature over an EMBEDDED presigned upstream URL — minted
// while a valid viewer token was in hand, so this route needs no credential of its own.
// The path segment is a cosmetic media filename (e.g. training.mp4): some providers
// validate the URL's extension before downloading. Providers may probe with HEAD first.

async function serve(request: Request, method: 'GET' | 'HEAD'): Promise<Response> {
  const url = new URL(request.url)
  const upstreamUrl = verifyPublicAsset(
    url.searchParams.get('u') ?? '',
    Number(url.searchParams.get('exp')),
    url.searchParams.get('sig') ?? '',
  )
  if (!upstreamUrl) return NextResponse.json({ error: 'Invalid or expired signature' }, { status: 403 })
  try {
    const upstream = await fetch(upstreamUrl, { method })
    if (!upstream.ok || (method === 'GET' && !upstream.body)) {
      logger.error({ msg: 'public-asset upstream fetch failed', status: upstream.status, method })
      return NextResponse.json({ error: 'Asset unavailable' }, { status: 502 })
    }
    // Never trust upstream content-type on our first-party origin: only passive media
    // types pass through; anything else is served as a download. nosniff + CSP sandbox
    // ensure no active content can execute even if a type slips through.
    const SAFE_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'audio/mpeg', 'audio/wav', 'audio/mp4']
    const upstreamType = (upstream.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
    const contentType = SAFE_TYPES.includes(upstreamType) ? upstreamType : 'application/octet-stream'
    return new Response(method === 'HEAD' ? null : upstream.body, {
      status: 200,
      headers: {
        'content-type': contentType,
        ...(contentType === 'application/octet-stream'
          ? { 'content-disposition': 'attachment; filename="asset"' }
          : {}),
        ...(upstream.headers.get('content-length')
          ? { 'content-length': upstream.headers.get('content-length') as string }
          : {}),
        'accept-ranges': 'none',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
        'cache-control': 'private, max-age=0',
      },
    })
  } catch (err) {
    logger.error({ msg: 'public-asset error', err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Asset unavailable' }, { status: 502 })
  }
}

export async function GET(request: Request): Promise<Response> {
  return serve(request, 'GET')
}

// Providers (HeyGen) probe with HEAD before downloading — must not 405.
export async function HEAD(request: Request): Promise<Response> {
  return serve(request, 'HEAD')
}
