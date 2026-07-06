import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getViewer, unauthorized } from '../../../../lib/auth'
import { getPresignedUploadUrl } from '../../../../lib/storage'
import { errorResponse } from '../../../../lib/api-helpers'
import { logger } from '../../../../lib/logger'

const presignSchema = z.object({
  kind: z.enum(['script', 'avatar_training', 'voice_training', 'recording']),
  filename: z.string().trim().min(1).max(300),
  contentType: z.string().trim().min(1).max(200),
  sizeBytes: z.number().int().positive().max(500 * 1024 * 1024),
})

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_')
}

export async function POST(request: Request): Promise<NextResponse> {
  const viewer = getViewer(request)
  if (!viewer) return unauthorized()
  if (viewer.isAnon) return unauthorized('Anonymous viewers cannot upload')
  try {
    const body = presignSchema.parse(await request.json())
    const key = `strata/${viewer.viewerId}/uploads/${body.kind}/${Date.now()}-${sanitizeFilename(body.filename)}`
    const presigned = await getPresignedUploadUrl(key, body.contentType, body.sizeBytes, viewer.token)
    logger.info({ msg: 'upload presigned', viewerId: viewer.viewerId, kind: body.kind, key })
    return NextResponse.json(presigned)
  } catch (err) {
    return errorResponse(err, 'POST /api/uploads/presign')
  }
}
