import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getViewer, unauthorized } from '../../../../../lib/auth'
import { dbGet } from '../../../../../lib/db'
import { createGeneration } from '../../../../../lib/jobs'
import { errorResponse, notFound } from '../../../../../lib/api-helpers'
import { logger } from '../../../../../lib/logger'
import type { ProjectRow } from '../../../../../lib/types'

const generateSchema = z.object({
  recordingKey: z.string().trim().min(1).optional(),
  resolution: z.enum(['720p', '1080p']).optional(),
})

export async function POST(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const viewer = getViewer(request)
  if (!viewer) return unauthorized()
  if (viewer.isAnon) return unauthorized('Anonymous viewers cannot generate')
  try {
    const project = await dbGet<ProjectRow>('projects', params.id, viewer.token).catch(() => null)
    if (!project || project.viewer_id !== viewer.viewerId) return notFound('Project not found')

    const rawBody: unknown = await request.json().catch(() => ({}))
    const body = generateSchema.parse(rawBody)

    const result = await createGeneration(project, viewer, body)
    logger.info({ msg: 'generation started', projectId: project.id, viewerId: viewer.viewerId, jobCount: result.generationJobs.length })
    return NextResponse.json(result, { status: 202 })
  } catch (err) {
    return errorResponse(err, 'POST /api/projects/[id]/generate')
  }
}
