import { NextResponse } from 'next/server'
import { getViewer, unauthorized } from '../../../../../../lib/auth'
import { dbGet } from '../../../../../../lib/db'
import { retryVideoGeneration } from '../../../../../../lib/jobs'
import { errorResponse, notFound } from '../../../../../../lib/api-helpers'
import { logger } from '../../../../../../lib/logger'
import type { ProjectRow } from '../../../../../../lib/types'

// Retries a failed video_gen job using the project's already-generated voiceover — no
// wasted TTS re-spend, and no dependency on client-side estimate state the way a full
// re-generate would need.
export async function POST(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const viewer = getViewer(request)
  if (!viewer) return unauthorized()
  if (viewer.isAnon) return unauthorized('Anonymous viewers cannot generate')
  try {
    const project = await dbGet<ProjectRow>('projects', params.id, viewer.token).catch(() => null)
    if (!project || project.viewer_id !== viewer.viewerId) return notFound('Project not found')

    await retryVideoGeneration(project, viewer)
    logger.info({ msg: 'video generation retried', projectId: project.id, viewerId: viewer.viewerId })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse(err, 'POST /api/projects/[id]/generate/retry-video')
  }
}
