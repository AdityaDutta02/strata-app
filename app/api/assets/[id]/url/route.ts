import { NextResponse } from 'next/server'
import { getViewer, unauthorized } from '../../../../../lib/auth'
import { dbGet } from '../../../../../lib/db'
import { getPresignedDownloadUrl } from '../../../../../lib/storage'
import { publicAssetUrl } from '../../../../../lib/public-asset'
import { errorResponse, notFound } from '../../../../../lib/api-helpers'
import type { AssetRow } from '../../../../../lib/types'

export async function GET(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const viewer = getViewer(request)
  if (!viewer) return unauthorized()
  try {
    const asset = await dbGet<AssetRow>('assets', params.id, viewer.token).catch(() => null)
    if (!asset || asset.viewer_id !== viewer.viewerId) return notFound('Asset not found')
    const presigned = await getPresignedDownloadUrl(asset.storage_key, viewer.token)
    // Terminal AI's storage always serves presigned GETs as application/octet-stream
    // regardless of what content-type was set on upload — the browser can't sniff duration
    // out of an <audio>/<video> tag pointed straight at it. Wrap it through our own
    // public-asset proxy (already built for this exact problem on the HeyGen side), which
    // derives the correct content-type from the filename we control.
    const filename = asset.storage_key.split('/').pop() ?? 'asset'
    const url = publicAssetUrl(presigned.url, presigned.expiresIn, filename)
    return NextResponse.json({ url, expiresIn: presigned.expiresIn, kind: asset.kind })
  } catch (err) {
    return errorResponse(err, 'GET /api/assets/[id]/url')
  }
}
