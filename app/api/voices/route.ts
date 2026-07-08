import { NextResponse } from 'next/server'
import { getViewer, unauthorized } from '../../../lib/auth'
import { dbList } from '../../../lib/db'
import { errorResponse } from '../../../lib/api-helpers'
import { latestJob, isHidden } from '../../../lib/jobs/visibility'
import type { VoiceRow } from '../../../lib/types'

export async function GET(request: Request): Promise<NextResponse> {
  const viewer = getViewer(request)
  if (!viewer) return unauthorized()
  if (viewer.isAnon) return NextResponse.json({ voices: [] })
  try {
    const rows = await dbList<VoiceRow>('voices', { viewer_id: viewer.viewerId }, viewer.token)
    const visible: VoiceRow[] = []
    for (const voice of rows) {
      const job = await latestJob('voice_clone', 'voiceId', voice.id, viewer.viewerId, viewer.token)
      if (!isHidden(job)) visible.push(voice)
    }
    return NextResponse.json({ voices: visible })
  } catch (err) {
    return errorResponse(err, 'GET /api/voices')
  }
}
