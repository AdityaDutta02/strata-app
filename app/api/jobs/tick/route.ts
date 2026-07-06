import { NextResponse } from 'next/server'
import { getViewer } from '../../../../lib/auth'
import { tick } from '../../../../lib/jobs'
import { errorResponse } from '../../../../lib/api-helpers'
import { logger } from '../../../../lib/logger'

interface TickBody {
  jobId?: string
  projectId?: string
}

function isTickBody(value: unknown): value is TickBody {
  return typeof value === 'object' && value !== null
}

/** Delayed-task watchdog callback + on-demand pump. Accepts either a task-execution token
 *  (5-min watchdog / HeyGen webhook re-check) or a normal viewer embed token (client polling
 *  a "processing" project). Either way we only need SOME valid token to authenticate the
 *  downstream db.ts calls — Terminal AI's gateway re-verifies it. */
export async function POST(request: Request): Promise<NextResponse> {
  const token = request.headers.get('x-embed-token')
  if (!token) {
    logger.warn({ msg: 'jobs/tick called without an embed token' })
    return NextResponse.json({ error: 'Missing embed token', code: 'UNAUTHORIZED' }, { status: 401 })
  }
  const viewer = getViewer(request)
  try {
    const rawBody: unknown = await request.json().catch(() => ({}))
    const body = isTickBody(rawBody) ? rawBody : {}
    const result = await tick({ viewerId: viewer?.viewerId, jobId: body.jobId, token })
    logger.info({ msg: 'jobs/tick pumped', jobId: body.jobId, viewerId: viewer?.viewerId, ...result })
    return NextResponse.json(result)
  } catch (err) {
    return errorResponse(err, 'POST /api/jobs/tick')
  }
}
