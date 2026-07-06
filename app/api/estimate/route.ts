import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getViewer, unauthorized } from '../../../lib/auth'
import { estimateGeneration } from '../../../lib/credits'
import { errorResponse } from '../../../lib/api-helpers'

const estimateSchema = z.object({
  script: z.string().trim().max(200_000),
  format: z.enum(['short', 'long']).default('short'),
  mode: z.enum(['tts', 'swap']).default('tts'),
})

export async function POST(request: Request): Promise<NextResponse> {
  const viewer = getViewer(request)
  if (!viewer) return unauthorized()
  try {
    const body = estimateSchema.parse(await request.json())
    const { minutes, credits } = estimateGeneration(body.script, body.format, body.mode)
    return NextResponse.json({ minutes, credits })
  } catch (err) {
    return errorResponse(err, 'POST /api/estimate')
  }
}
