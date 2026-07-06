import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { logger } from '../../../../lib/logger'

// HeyGen webhook receiver. HeyGen callbacks are unauthenticated by the app-embed-token model
// used everywhere else in this codebase (there is no viewer session tied to a provider
// callback), so we cannot safely call db.ts/storage.ts here without a token to forward to the
// Terminal AI gateway. Instead: verify the HMAC signature (defense against spoofed callbacks,
// when HEYGEN_WEBHOOK_SECRET is configured), log receipt for observability, and return 200
// immediately. The actual state transition still happens through /api/jobs/tick — either the
// client's own polling (GET /api/jobs?projectId=... every few seconds while status=processing)
// or the 5-minute delayed-task watchdog created when the HeyGen job started — both of which
// carry a real embed/task token. If HEYGEN_WEBHOOK_SECRET is not configured we skip
// verification entirely and rely purely on tick polling, per BUILD-SPEC-MVP.
function verifySignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const expectedBuf = new Uint8Array(Buffer.from(expected, 'utf8'))
  const providedBuf = new Uint8Array(Buffer.from(signatureHeader, 'utf8'))
  if (expectedBuf.length !== providedBuf.length) return false
  return timingSafeEqual(expectedBuf, providedBuf)
}

export async function POST(request: Request): Promise<NextResponse> {
  const rawBody = await request.text()
  const secret = process.env.HEYGEN_WEBHOOK_SECRET

  if (secret) {
    const signature = request.headers.get('x-heygen-signature') ?? request.headers.get('signature')
    if (!verifySignature(rawBody, signature, secret)) {
      logger.warn({ msg: 'heygen webhook signature verification failed' })
      return NextResponse.json({ error: 'Invalid signature', code: 'UNAUTHORIZED' }, { status: 401 })
    }
  } else {
    logger.info({ msg: 'heygen webhook received without HEYGEN_WEBHOOK_SECRET configured; relying on tick polling' })
  }

  let payload: unknown = {}
  try {
    payload = JSON.parse(rawBody)
  } catch {
    // HeyGen sends non-JSON pings occasionally; ignore parse failures, still ack 200.
  }
  logger.info({ msg: 'heygen webhook received', payload })
  return NextResponse.json({ ok: true })
}
