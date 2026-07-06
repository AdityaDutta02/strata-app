import { NextResponse } from 'next/server'
import { getViewer, unauthorized } from '../../../lib/auth'
import { dbList } from '../../../lib/db'
import { errorResponse } from '../../../lib/api-helpers'
import type { JobRow } from '../../../lib/types'

export async function GET(request: Request): Promise<NextResponse> {
  const viewer = getViewer(request)
  if (!viewer) return unauthorized()
  if (viewer.isAnon) return NextResponse.json({ jobs: [] })
  try {
    const url = new URL(request.url)
    const projectId = url.searchParams.get('projectId')
    const filters: Record<string, string> = { viewer_id: viewer.viewerId }
    if (projectId) filters.project_id = projectId
    const jobs = await dbList<JobRow>('jobs', filters, viewer.token)
    return NextResponse.json({ jobs })
  } catch (err) {
    return errorResponse(err, 'GET /api/jobs')
  }
}
