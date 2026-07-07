import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getViewer, unauthorized } from '../../../../lib/auth'
import { getPresignedUploadUrl } from '../../../../lib/storage'
import { UnsupportedFileTypeError, buildUploadKey } from '../../../../lib/upload-key'
import { errorResponse } from '../../../../lib/api-helpers'
import { logger } from '../../../../lib/logger'

const presignSchema = z.object({
  kind: z.enum(['script', 'avatar_training', 'voice_training', 'recording']),
  filename: z.string().trim().min(1).max(300),
  contentType: z.string().trim().min(1).max(200),
  sizeBytes: z.number().int().positive().max(500 * 1024 * 1024),
})

export async function POST(request: Request): Promise<NextResponse> {
  const viewer = getViewer(request)
  if (!viewer) return unauthorized()
  if (viewer.isAnon) return unauthorized('Anonymous viewers cannot upload')
  try {
    const body = presignSchema.parse(await request.json())
    const key = buildUploadKey(viewer.viewerId, body.kind, body.filename, Date.now())
    try {
      const presigned = await getPresignedUploadUrl(key, body.contentType, body.sizeBytes, viewer.token)
      logger.info({ msg: 'upload presigned', viewerId: viewer.viewerId, kind: body.kind, key })
      return NextResponse.json({ ...presigned, originalFilename: body.filename })
    } catch (gatewayErr) {
      // Gateway 4xx here means the key/type/size was refused despite our validation —
      // surface a user-actionable message instead of the raw status.
      const message = gatewayErr instanceof Error ? gatewayErr.message : String(gatewayErr)
      logger.error({ msg: 'presign rejected by gateway', viewerId: viewer.viewerId, key, err: message })
      if (/failed: 4\d\d/.test(message)) {
        return NextResponse.json(
          { error: 'This file was refused by storage — check the file type and size, then retry.' },
          { status: 400 },
        )
      }
      throw gatewayErr
    }
  } catch (err) {
    if (err instanceof UnsupportedFileTypeError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    return errorResponse(err, 'POST /api/uploads/presign')
  }
}
