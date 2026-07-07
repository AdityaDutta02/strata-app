import { NextResponse } from 'next/server'
import { getViewer, unauthorized } from '../../../../lib/auth'
import { getPresignedUploadUrl, storageUpload } from '../../../../lib/storage'
import { UnsupportedFileTypeError, buildUploadKey, type UploadKind } from '../../../../lib/upload-key'
import { errorResponse } from '../../../../lib/api-helpers'
import { logger } from '../../../../lib/logger'

// Server-side upload relay — fallback for browsers whose direct presigned PUT to object
// storage is blocked (CORS / mixed content). Bytes flow browser → this route → storage,
// so no cross-origin request happens in the browser. ≤45MB goes through the gateway
// proxy (ClamAV-scanned); larger files are PUT server-side against a presigned URL
// (2GB storage limit) — same pattern the job engine uses for rendered assets.

const PROXY_MAX_BYTES = 45 * 1024 * 1024
const MAX_RELAY_BYTES = 800 * 1024 * 1024 // sanity cap; storage itself allows 2GB
const KINDS: readonly UploadKind[] = ['script', 'avatar_training', 'voice_training', 'recording']

export async function POST(request: Request): Promise<NextResponse> {
  const viewer = getViewer(request)
  if (!viewer) return unauthorized()
  if (viewer.isAnon) return unauthorized('Anonymous viewers cannot upload')
  try {
    const url = new URL(request.url)
    const kind = url.searchParams.get('kind') as UploadKind | null
    const filename = url.searchParams.get('filename') ?? ''
    if (!kind || !KINDS.includes(kind)) {
      return NextResponse.json({ error: 'Invalid upload kind' }, { status: 400 })
    }
    const contentType = request.headers.get('content-type') ?? 'application/octet-stream'
    const buffer = Buffer.from(await request.arrayBuffer())
    if (buffer.byteLength === 0) return NextResponse.json({ error: 'Empty upload' }, { status: 400 })
    if (buffer.byteLength > MAX_RELAY_BYTES) {
      return NextResponse.json(
        { error: 'File is too large (800MB max) — please compress the recording.' },
        { status: 413 },
      )
    }
    const key = buildUploadKey(viewer.viewerId, kind, filename, Date.now())
    if (buffer.byteLength <= PROXY_MAX_BYTES) {
      await storageUpload(key, buffer, contentType, viewer.token)
    } else {
      const presigned = await getPresignedUploadUrl(key, contentType, buffer.byteLength, viewer.token)
      const putRes = await fetch(presigned.url, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: new Uint8Array(buffer),
      })
      if (!putRes.ok) throw new Error(`server-side presigned PUT failed: ${putRes.status}`)
    }
    logger.info({ msg: 'upload relayed', viewerId: viewer.viewerId, kind, key, bytes: buffer.byteLength })
    return NextResponse.json({ key, originalFilename: filename })
  } catch (err) {
    if (err instanceof UnsupportedFileTypeError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    return errorResponse(err, 'POST /api/uploads/relay')
  }
}
