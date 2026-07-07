import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getViewer, unauthorized } from '../../../lib/auth'
import { dbInsert, dbList } from '../../../lib/db'
import { errorResponse } from '../../../lib/api-helpers'
import { logger } from '../../../lib/logger'
import type { ProjectRow } from '../../../lib/types'

const createProjectSchema = z.object({
  title: z.string().trim().min(1).max(200),
  script: z.string().trim().max(200_000).default(''),
  format: z.enum(['short', 'long']).default('short'),
  language: z.string().trim().min(2).max(10).default('en'),
  voiceMode: z.enum(['tts', 'swap']).default('tts'),
})

export async function GET(request: Request): Promise<NextResponse> {
  const viewer = getViewer(request)
  if (!viewer) return unauthorized()
  if (viewer.isAnon) return NextResponse.json({ projects: [] })
  try {
    const projects = await dbList<ProjectRow>('projects', { viewer_id: viewer.viewerId }, viewer.token)
    return NextResponse.json({ projects })
  } catch (err) {
    return errorResponse(err, 'GET /api/projects')
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const viewer = getViewer(request)
  if (!viewer) return unauthorized()
  if (viewer.isAnon) return unauthorized('Anonymous viewers cannot create projects')
  try {
    const body = createProjectSchema.parse(await request.json())
    const project = await dbInsert<ProjectRow>(
      'projects',
      {
        viewer_id: viewer.viewerId,
        title: body.title,
        script: body.script,
        format: body.format,
        language: body.language,
        voice_mode: body.voiceMode,
        stage: 'script',
        status: 'draft',
        resolution: '720p',
        credits_spent: 0,
      },
      viewer.token,
    )
    logger.info({ msg: 'project created', projectId: project.id, viewerId: viewer.viewerId })
    return NextResponse.json({ project }, { status: 201 })
  } catch (err) {
    return errorResponse(err, 'POST /api/projects')
  }
}
