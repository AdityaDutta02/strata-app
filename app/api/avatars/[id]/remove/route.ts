import { NextResponse } from 'next/server'
import { getViewer, unauthorized } from '../../../../../lib/auth'
import { dbGet } from '../../../../../lib/db'
import { hideAvatarAndVoice } from '../../../../../lib/jobs/visibility'
import { errorResponse, notFound } from '../../../../../lib/api-helpers'
import { logger } from '../../../../../lib/logger'
import type { AvatarRow } from '../../../../../lib/types'

// Hides an avatar+its paired voice from the UI. Never deletes anything — HeyGen consent,
// provider ids, and the underlying rows all persist untouched.
export async function POST(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const viewer = getViewer(request)
  if (!viewer) return unauthorized()
  try {
    const avatar = await dbGet<AvatarRow>('avatars', params.id, viewer.token).catch(() => null)
    if (!avatar || avatar.viewer_id !== viewer.viewerId) return notFound('Avatar not found')
    await hideAvatarAndVoice(avatar.id, viewer.viewerId, viewer.token)
    logger.info({ msg: 'avatar removed (hidden)', avatarId: avatar.id, viewerId: viewer.viewerId })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse(err, 'POST /api/avatars/[id]/remove')
  }
}
