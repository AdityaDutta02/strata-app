import { NextResponse } from 'next/server'
import { getViewer, unauthorized } from '../../../lib/auth'
import { bootstrapWorkspace } from '../../../lib/credits'
import { errorResponse } from '../../../lib/api-helpers'
import { logger } from '../../../lib/logger'

export async function GET(request: Request): Promise<NextResponse> {
  const viewer = getViewer(request)
  if (!viewer) return unauthorized()
  if (viewer.isAnon) {
    return NextResponse.json({ workspace: null, isAnon: true })
  }
  try {
    const workspace = await bootstrapWorkspace(viewer.viewerId, viewer.token)
    logger.info({ msg: 'GET /api/me', viewerId: viewer.viewerId })
    return NextResponse.json({ workspace, isAnon: false })
  } catch (err) {
    return errorResponse(err, 'GET /api/me')
  }
}
