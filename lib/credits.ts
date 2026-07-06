// lib/credits.ts — credit wallet: rates, estimation, and ledger-append helpers.
//
// Invariants enforced here (unit-tested in lib/credits.test.ts, per BUILD-SPEC-MVP §"Credit rates"):
//  - credit_ledger is append-only (we only ever INSERT, never UPDATE/DELETE a ledger row)
//  - every ledger row's balance_after === (balance before) + delta
//  - workspaces.credits_balance is always a cache of the latest ledger row's balance_after
//  - a reservation never starts if the requested amount exceeds the current balance
//  - the workspace balance never goes negative
//  - a failed job always produces a `refund` ledger row for whatever it had reserved
import { dbGet, dbInsert, dbList, dbUpdate } from './db'
import { logger } from './logger'
import type { CreditLedgerRow, ProjectFormat, WorkspaceRow } from './types'

export class CreditError extends Error {
  code = 'INSUFFICIENT_CREDITS' as const
  constructor(message = 'Insufficient credits') {
    super(message)
    this.name = 'CreditError'
  }
}

/** Credit rates — BUILD-SPEC-MVP §"Credit rates". */
export const RATES = {
  voice_gen: 1, // cr/min
  voice_swap: 4, // cr/min
  video_gen: 40, // cr/min
  voice_clone: 25, // cr one-time
  avatar_create: 50, // cr one-time
} as const

export const TRIAL_GRANT_CREDITS = 205

const CHARS_PER_MINUTE = 1000

/** Whole-minute round-up estimate, minimum 1 minute. `format` is accepted for forward
 *  compatibility with future per-format pacing but the MVP formula is chars/1000, uniform
 *  across formats. */
export function estimateMinutes(script: string, format: ProjectFormat): number {
  void format
  const chars = script.trim().length
  if (chars === 0) return 1
  return Math.max(1, Math.ceil(chars / CHARS_PER_MINUTE))
}

export interface CreditEstimate {
  minutes: number
  credits: number
}

/** Full-chain estimate (voice + video; transcribe/notes are bundled at no extra cost). */
export function estimateGeneration(script: string, format: ProjectFormat, voiceMode: 'tts' | 'swap'): CreditEstimate {
  const minutes = estimateMinutes(script, format)
  const voiceRate = voiceMode === 'swap' ? RATES.voice_swap : RATES.voice_gen
  const credits = minutes * voiceRate + minutes * RATES.video_gen
  return { minutes, credits }
}

async function appendLedger(
  workspace: WorkspaceRow,
  delta: number,
  type: CreditLedgerRow['type'],
  token: string,
  opts: { jobId?: string; note?: string } = {},
): Promise<number> {
  const balanceAfter = workspace.credits_balance + delta
  if (balanceAfter < 0) {
    throw new CreditError('Ledger movement would make balance negative')
  }
  await dbInsert<CreditLedgerRow>(
    'credit_ledger',
    {
      workspace_id: workspace.id,
      delta,
      type,
      job_id: opts.jobId ?? null,
      note: opts.note ?? '',
      balance_after: balanceAfter,
    },
    token,
  )
  await dbUpdate<WorkspaceRow>('workspaces', workspace.id, { credits_balance: balanceAfter }, token)
  workspace.credits_balance = balanceAfter
  logger.info({ msg: 'credit ledger appended', workspaceId: workspace.id, delta, type, balanceAfter, jobId: opts.jobId })
  return balanceAfter
}

/** Debits `amountCredits` from the workspace. Throws CreditError (never reserves) if the
 *  amount exceeds the current balance — callers should surface this as HTTP 402. */
export async function reserveCredits(
  workspace: WorkspaceRow,
  amountCredits: number,
  token: string,
  opts: { jobId?: string; note?: string } = {},
): Promise<number> {
  if (amountCredits > workspace.credits_balance) {
    throw new CreditError(`Insufficient credits: need ${amountCredits}, have ${workspace.credits_balance}`)
  }
  if (amountCredits <= 0) return workspace.credits_balance
  return appendLedger(workspace, -amountCredits, 'debit', token, opts)
}

/** Credits back `amountCredits` — used when a reserved job fails or is cancelled before
 *  it consumed its reservation. */
export async function refundCredits(
  workspace: WorkspaceRow,
  amountCredits: number,
  token: string,
  opts: { jobId?: string; note?: string } = {},
): Promise<number> {
  if (amountCredits <= 0) return workspace.credits_balance
  return appendLedger(workspace, amountCredits, 'refund', token, opts)
}

/** Records a zero-cost (comped) debit for audit purposes without moving the balance. Used for
 *  the first onboarding avatar+voice, which are free but should still show in the ledger. */
export async function chargeComped(
  workspace: WorkspaceRow,
  token: string,
  opts: { jobId?: string; note?: string } = {},
): Promise<number> {
  return appendLedger(workspace, 0, 'debit', token, { ...opts, note: opts.note ?? 'comped' })
}

/** Idempotent: creates the workspace + trial grant on first touch, otherwise returns the
 *  existing row untouched. Safe to call on every request. */
export async function bootstrapWorkspace(viewerId: string, token: string): Promise<WorkspaceRow> {
  const existing = await dbList<WorkspaceRow>('workspaces', { viewer_id: viewerId }, token)
  const first = existing[0]
  if (first) return first

  const created = await dbInsert<WorkspaceRow>(
    'workspaces',
    {
      viewer_id: viewerId,
      name: 'My workspace',
      credits_balance: 0,
      trial_credits_left: 0,
      trial_granted: false,
      first_avatar_comped: false,
    },
    token,
  )

  // Re-check right before granting — dbInsert has no unique-constraint guard on our side, so a
  // concurrent request could have created + granted already between the list and the insert.
  const recheck = await dbList<WorkspaceRow>('workspaces', { viewer_id: viewerId }, token)
  const workspace = recheck.find((w) => w.id !== created.id) ?? created
  if (workspace.trial_granted) return workspace

  await appendLedger(workspace, TRIAL_GRANT_CREDITS, 'trial_grant', token, { note: 'trial grant' })
  await dbUpdate<WorkspaceRow>(
    'workspaces',
    workspace.id,
    { trial_granted: true, trial_credits_left: TRIAL_GRANT_CREDITS },
    token,
  )
  workspace.trial_granted = true
  workspace.trial_credits_left = TRIAL_GRANT_CREDITS
  logger.info({ msg: 'workspace bootstrapped with trial grant', workspaceId: workspace.id, viewerId })
  return workspace
}

export async function getWorkspace(viewerId: string, token: string): Promise<WorkspaceRow | null> {
  const rows = await dbList<WorkspaceRow>('workspaces', { viewer_id: viewerId }, token)
  return rows[0] ?? null
}

export async function refreshWorkspace(workspaceId: string, token: string): Promise<WorkspaceRow> {
  return dbGet<WorkspaceRow>('workspaces', workspaceId, token)
}
