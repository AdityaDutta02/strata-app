import { NextResponse } from 'next/server'
import { getViewer, unauthorized } from '../../../../../lib/auth'
import { dbGet, dbInsert, dbUpdate } from '../../../../../lib/db'
import { retryAvatarTraining } from '../../../../../lib/jobs/onboarding'
import { errorResponse } from '../../../../../lib/api-helpers'
import { logger } from '../../../../../lib/logger'
import type { AvatarRow, JobRow } from '../../../../../lib/types'

// Re-runs HeyGen training for a FAILED avatar using the already-uploaded footage.
// No new charge: the original avatar_create job carried the (comped or paid) reservation.

export async function POST(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const viewer = getViewer(request)
  if (!viewer) return unauthorized()
  try {
    const avatar = await dbGet<AvatarRow>('avatars', params.id, viewer.token).catch(() => null)
    if (!avatar || avatar.viewer_id !== viewer.viewerId) {
      return NextResponse.json({ error: 'Avatar not found' }, { status: 404 })
    }
    if (avatar.status !== 'failed') {
      return NextResponse.json({ error: 'Only failed avatars can be retried' }, { status: 400 })
    }
    if (!avatar.training_video_key) {
      return NextResponse.json({ error: 'No training footage on file — onboard again' }, { status: 400 })
    }
    await dbUpdate<AvatarRow>('avatars', avatar.id, { status: 'training', error: null, consent_url: null }, viewer.token)
    const job = await dbInsert<JobRow>(
      'jobs',
      {
        viewer_id: viewer.viewerId,
        type: 'avatar_create',
        status: 'queued',
        input_json: { avatarId: avatar.id, retry: true },
        output_json: {},
        credits_reserved: 0,
        credits_charged: 0,
      },
      viewer.token,
    )
    await retryAvatarTraining(job, { ...avatar, status: 'training' }, viewer)
    const fresh = await dbGet<AvatarRow>('avatars', avatar.id, viewer.token)
    logger.info({ msg: 'avatar training retried', avatarId: avatar.id, viewerId: viewer.viewerId })
    return NextResponse.json({ avatar: fresh })
  } catch (err) {
    return errorResponse(err, 'POST /api/avatars/[id]/retry')
  }
}
