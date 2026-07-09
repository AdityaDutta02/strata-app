import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getViewer, unauthorized } from '../../../../lib/auth'
import { dbGet, dbUpdate } from '../../../../lib/db'
import { errorResponse, notFound } from '../../../../lib/api-helpers'
import { logger } from '../../../../lib/logger'
import type { ProjectRow } from '../../../../lib/types'

const patchProjectSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  script: z.string().trim().max(200_000).optional(),
  stage: z.enum(['script', 'voice', 'video', 'render', 'publish']).optional(),
  format: z.enum(['vertical', 'horizontal']).optional(),
  language: z.string().trim().min(2).max(10).optional(),
  voiceId: z.string().uuid().nullable().optional(),
  avatarId: z.string().uuid().nullable().optional(),
  voiceMode: z.enum(['tts', 'swap']).optional(),
})

async function loadOwnedProject(id: string, viewerId: string, token: string): Promise<ProjectRow | null> {
  const project = await dbGet<ProjectRow>('projects', id, token).catch(() => null)
  if (!project || project.viewer_id !== viewerId) return null
  return project
}

export async function GET(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const viewer = getViewer(request)
  if (!viewer) return unauthorized()
  try {
    const project = await loadOwnedProject(params.id, viewer.viewerId, viewer.token)
    if (!project) return notFound('Project not found')
    return NextResponse.json({ project })
  } catch (err) {
    return errorResponse(err, 'GET /api/projects/[id]')
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const viewer = getViewer(request)
  if (!viewer) return unauthorized()
  try {
    const existing = await loadOwnedProject(params.id, viewer.viewerId, viewer.token)
    if (!existing) return notFound('Project not found')
    const body = patchProjectSchema.parse(await request.json())
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.title !== undefined) patch.title = body.title
    if (body.script !== undefined) patch.script = body.script
    if (body.stage !== undefined) patch.stage = body.stage
    if (body.format !== undefined) patch.format = body.format
    if (body.language !== undefined) patch.language = body.language
    if (body.voiceId !== undefined) patch.voice_id = body.voiceId
    if (body.avatarId !== undefined) patch.avatar_id = body.avatarId
    if (body.voiceMode !== undefined) patch.voice_mode = body.voiceMode

    const project = await dbUpdate<ProjectRow>('projects', params.id, patch, viewer.token)
    logger.info({ msg: 'project updated', projectId: params.id, viewerId: viewer.viewerId })
    return NextResponse.json({ project })
  } catch (err) {
    return errorResponse(err, 'PATCH /api/projects/[id]')
  }
}

// Soft delete: `status` is a free-text column with no DB constraint, so 'archived' is a
// value the app treats as hidden without needing a schema migration. Nothing is destroyed —
// same principle as avatar removal.
export async function DELETE(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const viewer = getViewer(request)
  if (!viewer) return unauthorized()
  try {
    const existing = await loadOwnedProject(params.id, viewer.viewerId, viewer.token)
    if (!existing) return notFound('Project not found')
    await dbUpdate<ProjectRow>('projects', params.id, { status: 'archived' }, viewer.token)
    logger.info({ msg: 'project archived (soft delete)', projectId: params.id, viewerId: viewer.viewerId })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse(err, 'DELETE /api/projects/[id]')
  }
}
