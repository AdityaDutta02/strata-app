import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getViewer, unauthorized } from '../../../../../lib/auth'
import { dbGet } from '../../../../../lib/db'
import { createVoiceGeneration } from '../../../../../lib/jobs'
import { errorResponse, notFound } from '../../../../../lib/api-helpers'
import { logger } from '../../../../../lib/logger'
import type { ProjectRow } from '../../../../../lib/types'

const generateVoiceSchema = z.object({
  recordingKey: z.string().trim().min(1).optional(),
})

// Step 1 of generation: voice only. The user reviews the result and explicitly continues to
// video (POST /generate) — no auto-chaining, so a bad voiceover or an avatar's consent
// requirement surfaces before any video credits are spent.
export async function POST(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const viewer = getViewer(request)
  if (!viewer) return unauthorized()
  if (viewer.isAnon) return unauthorized('Anonymous viewers cannot generate')
  try {
    const project = await dbGet<ProjectRow>('projects', params.id, viewer.token).catch(() => null)
    if (!project || project.viewer_id !== viewer.viewerId) return notFound('Project not found')

    const rawBody: unknown = await request.json().catch(() => ({}))
    const body = generateVoiceSchema.parse(rawBody)

    const result = await createVoiceGeneration(project, viewer, body)
    logger.info({ msg: 'voice generation started', projectId: project.id, viewerId: viewer.viewerId, jobId: result.job.id })
    return NextResponse.json({ job: result.job }, { status: 202 })
  } catch (err) {
    return errorResponse(err, 'POST /api/projects/[id]/generate-voice')
  }
}
