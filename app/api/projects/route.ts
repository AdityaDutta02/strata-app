import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getViewer, unauthorized } from '../../../lib/auth'
import { dbInsert, dbList } from '../../../lib/db'
import { errorResponse } from '../../../lib/api-helpers'
import { isHidden } from '../../../lib/jobs/visibility'
import { logger } from '../../../lib/logger'
import type { AvatarRow, JobRow, ProjectRow } from '../../../lib/types'

const createProjectSchema = z.object({
  title: z.string().trim().min(1).max(200),
  script: z.string().trim().max(200_000).default(''),
  format: z.enum(['vertical', 'horizontal']).default('vertical'),
  language: z.string().trim().min(2).max(10).default('en'),
  voiceMode: z.enum(['tts', 'swap']).default('tts'),
})

export async function GET(request: Request): Promise<NextResponse> {
  const viewer = getViewer(request)
  if (!viewer) return unauthorized()
  if (viewer.isAnon) return NextResponse.json({ projects: [] })
  try {
    const projects = await dbList<ProjectRow>('projects', { viewer_id: viewer.viewerId }, viewer.token)
    return NextResponse.json({ projects: projects.filter((p) => p.status !== 'archived') })
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

    // MVP caps a viewer at one active avatar — attach it automatically at creation time
    // instead of asking the user to pick one later (there's nothing to pick between).
    const avatars = await dbList<AvatarRow>('avatars', { viewer_id: viewer.viewerId }, viewer.token)
    const jobs = await dbList<JobRow>('jobs', { viewer_id: viewer.viewerId, type: 'avatar_create' }, viewer.token)
    const activeAvatar = avatars.find((avatar) => {
      const related = jobs
        .filter((j) => j.input_json.avatarId === avatar.id)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      return !isHidden(related[0] ?? null) && avatar.status === 'ready'
    })
    if (!activeAvatar) {
      return NextResponse.json({ error: 'Train an avatar before creating a project — go to the Avatars tab' }, { status: 400 })
    }

    const project = await dbInsert<ProjectRow>(
      'projects',
      {
        viewer_id: viewer.viewerId,
        title: body.title,
        script: body.script,
        format: body.format,
        language: body.language,
        voice_mode: body.voiceMode,
        avatar_id: activeAvatar.id,
        stage: 'script',
        status: 'draft',
        credits_spent: 0,
      },
      viewer.token,
    )
    logger.info({ msg: 'project created', projectId: project.id, viewerId: viewer.viewerId, avatarId: activeAvatar.id })
    return NextResponse.json({ project }, { status: 201 })
  } catch (err) {
    return errorResponse(err, 'POST /api/projects')
  }
}
