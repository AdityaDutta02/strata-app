import { NextResponse } from 'next/server'
import { getViewer, unauthorized } from '../../../../../lib/auth'
import { dbGet } from '../../../../../lib/db'
import { getPresignedDownloadUrl } from '../../../../../lib/storage'
import { errorResponse, notFound } from '../../../../../lib/api-helpers'
import type { AssetRow } from '../../../../../lib/types'

export async function GET(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const viewer = getViewer(request)
  if (!viewer) return unauthorized()
  try {
    const asset = await dbGet<AssetRow>('assets', params.id, viewer.token).catch(() => null)
    if (!asset || asset.viewer_id !== viewer.viewerId) return notFound('Asset not found')
    const presigned = await getPresignedDownloadUrl(asset.storage_key, viewer.token)
    return NextResponse.json({ url: presigned.url, expiresIn: presigned.expiresIn, kind: asset.kind })
  } catch (err) {
    return errorResponse(err, 'GET /api/assets/[id]/url')
  }
}
