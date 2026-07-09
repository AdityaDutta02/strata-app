import { NextResponse } from 'next/server'
import { getViewer, unauthorized } from '../../../lib/auth'
import { dbList } from '../../../lib/db'
import { errorResponse } from '../../../lib/api-helpers'
import { isHidden } from '../../../lib/jobs/visibility'
import { tick } from '../../../lib/jobs'
import { logger } from '../../../lib/logger'
import type { AvatarRow, JobRow } from '../../../lib/types'

export async function GET(request: Request): Promise<NextResponse> {
  const viewer = getViewer(request)
  if (!viewer) return unauthorized()
  if (viewer.isAnon) return NextResponse.json({ avatars: [] })
  try {
    // Best-effort: advance any of this viewer's processing jobs on every poll, so status
    // doesn't depend solely on the watchdog delayed task (capped at 5 reschedules — a job
    // left open longer than ~25 minutes would otherwise never be checked again).
    try {
      await tick({ viewerId: viewer.viewerId, token: viewer.token })
    } catch (tickErr) {
      logger.warn({ msg: 'GET /api/avatars: opportunistic tick failed', viewerId: viewer.viewerId, err: String(tickErr) })
    }
    const rows = await dbList<AvatarRow>('avatars', { viewer_id: viewer.viewerId }, viewer.token)
    // Consent URLs and hidden (removed) state both live in the avatar_create job's
    // output_json (the live DB predates the avatars-table columns and the platform doesn't
    // apply ALTER migrations). Merge the latest job's info into each avatar for the UI, and
    // drop any avatar whose latest job was hidden via the remove action.
    const jobs = await dbList<JobRow>('jobs', { viewer_id: viewer.viewerId, type: 'avatar_create' }, viewer.token)
    const avatars = rows
      .map((avatar) => {
        const related = jobs
          .filter((j) => j.input_json.avatarId === avatar.id)
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        const latest = related[0] ?? null
        return {
          avatar: { ...avatar, consent_url: (latest?.output_json.consentUrl as string | undefined) ?? null },
          hidden: isHidden(latest),
        }
      })
      .filter((entry) => !entry.hidden)
      .map((entry) => entry.avatar)
    return NextResponse.json({ avatars })
  } catch (err) {
    return errorResponse(err, 'GET /api/avatars')
  }
}
