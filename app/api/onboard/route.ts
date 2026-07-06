import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getViewer, unauthorized } from '../../../lib/auth'
import { createOnboardingJobs } from '../../../lib/jobs'
import { errorResponse } from '../../../lib/api-helpers'
import { logger } from '../../../lib/logger'

const onboardSchema = z.object({
  name: z.string().trim().min(1).max(200),
  avatarUploadKey: z.string().trim().min(1),
  voiceUploadKey: z.string().trim().min(1),
})

export async function POST(request: Request): Promise<NextResponse> {
  const viewer = getViewer(request)
  if (!viewer) return unauthorized()
  if (viewer.isAnon) return unauthorized('Anonymous viewers cannot onboard')
  try {
    const body = onboardSchema.parse(await request.json())
    const result = await createOnboardingJobs(viewer, body)
    logger.info({ msg: 'onboarding jobs created', viewerId: viewer.viewerId, avatarId: result.avatar.id, voiceId: result.voice.id })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return errorResponse(err, 'POST /api/onboard')
  }
}
