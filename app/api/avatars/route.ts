import { NextResponse } from 'next/server'
import { getViewer, unauthorized } from '../../../lib/auth'
import { dbList } from '../../../lib/db'
import { errorResponse } from '../../../lib/api-helpers'
import type { AvatarRow, JobRow } from '../../../lib/types'

export async function GET(request: Request): Promise<NextResponse> {
  const viewer = getViewer(request)
  if (!viewer) return unauthorized()
  if (viewer.isAnon) return NextResponse.json({ avatars: [] })
  try {
    const rows = await dbList<AvatarRow>('avatars', { viewer_id: viewer.viewerId }, viewer.token)
    // Consent URLs live in the avatar_create job's output_json (the live DB predates the
    // avatars-table columns and the platform doesn't apply ALTER migrations). Merge the
    // latest job's consent info into each avatar for the UI.
    const jobs = await dbList<JobRow>('jobs', { viewer_id: viewer.viewerId, type: 'avatar_create' }, viewer.token)
    const avatars = rows.map((avatar) => {
      const related = jobs
        .filter((j) => j.input_json.avatarId === avatar.id && typeof j.output_json.consentUrl === 'string')
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      return { ...avatar, consent_url: (related[0]?.output_json.consentUrl as string | undefined) ?? null }
    })
    return NextResponse.json({ avatars })
  } catch (err) {
    return errorResponse(err, 'GET /api/avatars')
  }
}
