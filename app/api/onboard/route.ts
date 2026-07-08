import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getViewer, unauthorized } from '../../../lib/auth'
import { dbList } from '../../../lib/db'
import { createOnboardingJobs } from '../../../lib/jobs'
import { latestJob, isHidden } from '../../../lib/jobs/visibility'
import { errorResponse } from '../../../lib/api-helpers'
import { logger } from '../../../lib/logger'
import type { AvatarRow } from '../../../lib/types'

const onboardSchema = z.object({
  name: z.string().trim().min(1).max(200),
  avatarUploadKey: z.string().trim().min(1),
  voiceUploadKey: z.string().trim().min(1),
})

export async function POST(request: Request): Promise<NextResponse> {
  const viewer = getViewer(request)
  if (!viewer) return unauthorized()
  if (viewer.isAnon) return unauthorized('Anonymous viewers cannot onboard')
  try {
    const body = onboardSchema.parse(await request.json())

    // Uploads are presigned per-viewer (training/{viewerId}/...) at /api/uploads/r2-presign.
    // Reject any key that doesn't belong to this viewer — otherwise a caller could pass
    // someone else's key and have our server read + train on their private footage (IDOR).
    const prefix = `training/${viewer.viewerId}/`
    if (!body.avatarUploadKey.startsWith(prefix) || !body.voiceUploadKey.startsWith(prefix)) {
      return NextResponse.json({ error: 'Upload key does not belong to this viewer' }, { status: 403 })
    }

    const existingAvatars = await dbList<AvatarRow>('avatars', { viewer_id: viewer.viewerId }, viewer.token)
    for (const existing of existingAvatars) {
      const job = await latestJob('avatar_create', 'avatarId', existing.id, viewer.viewerId, viewer.token)
      if (!isHidden(job)) {
        return NextResponse.json({ error: 'Remove your current avatar before training a new one' }, { status: 409 })
      }
    }

    const result = await createOnboardingJobs(viewer, body)
    logger.info({ msg: 'onboarding jobs created', viewerId: viewer.viewerId, avatarId: result.avatar.id, voiceId: result.voice.id })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return errorResponse(err, 'POST /api/onboard')
  }
}
