import { NextResponse } from 'next/server'
import { getViewer, unauthorized } from '../../../lib/auth'
import { dbList } from '../../../lib/db'
import { errorResponse } from '../../../lib/api-helpers'
import type { VoiceRow } from '../../../lib/types'

export async function GET(request: Request): Promise<NextResponse> {
  const viewer = getViewer(request)
  if (!viewer) return unauthorized()
  if (viewer.isAnon) return NextResponse.json({ voices: [] })
  try {
    const voices = await dbList<VoiceRow>('voices', { viewer_id: viewer.viewerId }, viewer.token)
    return NextResponse.json({ voices })
  } catch (err) {
    return errorResponse(err, 'GET /api/voices')
  }
}
