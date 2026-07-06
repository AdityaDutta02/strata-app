import { NextResponse } from 'next/server'
import { getViewer, unauthorized } from '../../../lib/auth'
import { bootstrapWorkspace } from '../../../lib/credits'
import { dbList } from '../../../lib/db'
import { errorResponse } from '../../../lib/api-helpers'
import type { CreditLedgerRow } from '../../../lib/types'

export async function GET(request: Request): Promise<NextResponse> {
  const viewer = getViewer(request)
  if (!viewer) return unauthorized()
  if (viewer.isAnon) return NextResponse.json({ balance: 0, trialLeft: 0, ledger: [] })
  try {
    const workspace = await bootstrapWorkspace(viewer.viewerId, viewer.token)
    const ledger = await dbList<CreditLedgerRow>('credit_ledger', { workspace_id: workspace.id }, viewer.token)
    const sorted = [...ledger].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    return NextResponse.json({
      balance: workspace.credits_balance,
      trialLeft: workspace.trial_credits_left,
      ledger: sorted,
    })
  } catch (err) {
    return errorResponse(err, 'GET /api/wallet')
  }
}
