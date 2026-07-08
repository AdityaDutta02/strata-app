import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { getViewer, unauthorized } from '../../../../lib/auth'
import { r2PresignedPutUrl } from '../../../../lib/storage-r2'
import { errorResponse } from '../../../../lib/api-helpers'

// Presigns a direct browser->R2 upload for avatar/voice training assets — these never touch
// Terminal AI storage at all, so the training pipeline has no dependency on that host.
const schema = z.object({
  kind: z.enum(['avatar_training', 'voice_training']),
  filename: z.string().trim().min(1),
  contentType: z.string().trim().min(1),
})

export async function POST(request: Request): Promise<NextResponse> {
  const viewer = getViewer(request)
  if (!viewer) return unauthorized()
  try {
    const body = schema.parse(await request.json())
    const key = `training/${viewer.viewerId}/${randomUUID()}-${body.filename}`
    const url = r2PresignedPutUrl(key)
    return NextResponse.json({ url, key })
  } catch (err) {
    return errorResponse(err, 'POST /api/uploads/r2-presign')
  }
}
