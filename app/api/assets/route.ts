import { NextResponse } from 'next/server'
import { getViewer, unauthorized } from '../../../lib/auth'
import { dbList } from '../../../lib/db'
import { errorResponse } from '../../../lib/api-helpers'
import type { AssetRow } from '../../../lib/types'

export async function GET(request: Request): Promise<NextResponse> {
  const viewer = getViewer(request)
  if (!viewer) return unauthorized()
  if (viewer.isAnon) return NextResponse.json({ assets: [] })
  try {
    const url = new URL(request.url)
    const projectId = url.searchParams.get('projectId')
    const filters: Record<string, string> = { viewer_id: viewer.viewerId }
    if (projectId) filters.project_id = projectId
    const assets = await dbList<AssetRow>('assets', filters, viewer.token)
    return NextResponse.json({ assets })
  } catch (err) {
    return errorResponse(err, 'GET /api/assets')
  }
}
