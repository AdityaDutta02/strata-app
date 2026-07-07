import { NextResponse } from 'next/server'
import { verifyPublicAsset } from '../../../lib/public-asset'
import { logger } from '../../../lib/logger'

// Streams a storage object to external providers via OUR public https origin. Access is
// gated by an expiring HMAC signature over an EMBEDDED presigned upstream URL — minted
// while a valid viewer token was in hand, so this route needs no credential of its own.

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const upstreamUrl = verifyPublicAsset(
    url.searchParams.get('u') ?? '',
    Number(url.searchParams.get('exp')),
    url.searchParams.get('sig') ?? '',
  )
  if (!upstreamUrl) return NextResponse.json({ error: 'Invalid or expired signature' }, { status: 403 })
  try {
    const upstream = await fetch(upstreamUrl)
    if (!upstream.ok || !upstream.body) {
      logger.error({ msg: 'public-asset upstream fetch failed', status: upstream.status })
      return NextResponse.json({ error: 'Asset unavailable' }, { status: 502 })
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
        ...(upstream.headers.get('content-length')
          ? { 'content-length': upstream.headers.get('content-length') as string }
          : {}),
        'cache-control': 'private, max-age=0',
      },
    })
  } catch (err) {
    logger.error({ msg: 'public-asset error', err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Asset unavailable' }, { status: 502 })
  }
}
