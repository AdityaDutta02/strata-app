import { beforeEach, describe, expect, it, vi } from 'vitest'

// In-memory fake for lib/db.ts's dbList/dbGet/dbInsert/dbUpdate — good enough to exercise the
// ledger-append invariants in lib/credits.ts without a real Terminal AI gateway.
vi.mock('./db', () => {
  const tables = new Map<string, Map<string, Record<string, unknown>>>()

  function table(name: string): Map<string, Record<string, unknown>> {
    let t = tables.get(name)
    if (!t) {
      t = new Map()
      tables.set(name, t)
    }
    return t
  }

  function matches(row: Record<string, unknown>, filters: Record<string, string>): boolean {
    return Object.entries(filters).every(([key, value]) => String(row[key]) === value)
  }

  return {
    __reset: () => tables.clear(),
    dbList: vi.fn(async (name: string, filters: Record<string, string> = {}) => {
      return Array.from(table(name).values()).filter((row) => matches(row, filters))
    }),
    dbGet: vi.fn(async (name: string, id: string) => {
      const row = table(name).get(id)
      if (!row) throw new Error(`not found: ${name}/${id}`)
      return row
    }),
    dbInsert: vi.fn(async (name: string, row: Record<string, unknown>) => {
      const id = row.id ?? `${name}-${table(name).size + 1}-${Math.random().toString(36).slice(2, 8)}`
      const full = { id, created_at: new Date().toISOString(), ...row }
      table(name).set(id as string, full)
      return full
    }),
    dbUpdate: vi.fn(async (name: string, id: string, patch: Record<string, unknown>) => {
      const existing = table(name).get(id)
      if (!existing) throw new Error(`not found: ${name}/${id}`)
      const updated = { ...existing, ...patch }
      table(name).set(id, updated)
      return updated
    }),
    dbDelete: vi.fn(async (name: string, id: string) => {
      table(name).delete(id)
    }),
  }
})

import { dbList } from './db'
import {
  CreditError,
  RATES,
  TRIAL_GRANT_CREDITS,
  bootstrapWorkspace,
  chargeComped,
  estimateGeneration,
  estimateMinutes,
  reserveCredits,
  refundCredits,
} from './credits'
import type { CreditLedgerRow, WorkspaceRow } from './types'

const TOKEN = 'test-token'

interface DbMockModule {
  __reset: () => void
}

beforeEach(async () => {
  const mockModule = (await import('./db')) as unknown as DbMockModule
  mockModule.__reset()
})

async function ledgerFor(workspaceId: string): Promise<CreditLedgerRow[]> {
  return dbList<CreditLedgerRow>('credit_ledger', { workspace_id: workspaceId }, TOKEN)
}

describe('estimateMinutes', () => {
  it('rounds up to the next whole minute at 1000 chars/min', () => {
    expect(estimateMinutes('a'.repeat(1000), 'short')).toBe(1)
    expect(estimateMinutes('a'.repeat(1001), 'short')).toBe(2)
    expect(estimateMinutes('a'.repeat(2500), 'long')).toBe(3)
  })

  it('has a floor of 1 minute, even for an empty script', () => {
    expect(estimateMinutes('', 'short')).toBe(1)
    expect(estimateMinutes('   ', 'short')).toBe(1)
  })
})

describe('estimateGeneration', () => {
  it('matches the documented full-chain rate of 41 cr/min for tts (1 + 40)', () => {
    const { minutes, credits } = estimateGeneration('a'.repeat(1000), 'short', 'tts')
    expect(minutes).toBe(1)
    expect(credits).toBe(41)
  })

  it('uses the voice_swap rate (4 cr/min) instead of voice_gen for swap mode', () => {
    const { credits } = estimateGeneration('a'.repeat(1000), 'short', 'swap')
    expect(credits).toBe(4 + 40)
  })
})

describe('bootstrapWorkspace', () => {
  it('grants the 205cr trial exactly once and is idempotent on repeat calls', async () => {
    const first = await bootstrapWorkspace('viewer-1', TOKEN)
    expect(first.credits_balance).toBe(TRIAL_GRANT_CREDITS)
    expect(first.trial_granted).toBe(true)

    const second = await bootstrapWorkspace('viewer-1', TOKEN)
    expect(second.id).toBe(first.id)
    expect(second.credits_balance).toBe(TRIAL_GRANT_CREDITS)

    const ledger = await ledgerFor(first.id)
    expect(ledger).toHaveLength(1)
    expect(ledger[0]!.type).toBe('trial_grant')
    expect(ledger[0]!.balance_after).toBe(TRIAL_GRANT_CREDITS)
  })
})

describe('credit ledger invariants', () => {
  let workspace: WorkspaceRow

  beforeEach(async () => {
    workspace = await bootstrapWorkspace('viewer-invariants', TOKEN)
  })

  it('reserveCredits debits the balance and appends an append-only ledger row with correct balance_after', async () => {
    const before = workspace.credits_balance
    const after = await reserveCredits(workspace, 50, TOKEN, { note: 'test reserve' })
    expect(after).toBe(before - 50)
    expect(workspace.credits_balance).toBe(after)

    const ledger = await ledgerFor(workspace.id)
    const debitRow = ledger.find((row) => row.type === 'debit')
    expect(debitRow).toBeDefined()
    expect(debitRow?.delta).toBe(-50)
    expect(debitRow?.balance_after).toBe(after)
  })

  it('never reserves more than the current balance (no start if reserved > balance)', async () => {
    const tooMuch = workspace.credits_balance + 1
    await expect(reserveCredits(workspace, tooMuch, TOKEN)).rejects.toBeInstanceOf(CreditError)
    // balance must be untouched
    expect(workspace.credits_balance).toBe(TRIAL_GRANT_CREDITS)
  })

  it('never allows the balance to go negative', async () => {
    await reserveCredits(workspace, workspace.credits_balance, TOKEN)
    expect(workspace.credits_balance).toBe(0)
    await expect(reserveCredits(workspace, 1, TOKEN)).rejects.toBeInstanceOf(CreditError)
    expect(workspace.credits_balance).toBe(0)
  })

  it('refunds a failed job\'s reservation with a refund ledger row, restoring the balance', async () => {
    const afterReserve = await reserveCredits(workspace, 41, TOKEN, { jobId: 'job-1', note: 'reserve' })
    const afterRefund = await refundCredits(workspace, 41, TOKEN, { jobId: 'job-1', note: 'refund: job failed' })
    expect(afterRefund).toBe(afterReserve + 41)
    expect(afterRefund).toBe(TRIAL_GRANT_CREDITS)

    const ledger = await ledgerFor(workspace.id)
    const refundRow = ledger.find((row) => row.type === 'refund')
    expect(refundRow).toBeDefined()
    expect(refundRow?.delta).toBe(41)
    expect(refundRow?.job_id).toBe('job-1')
  })

  it('every ledger row satisfies balance_after = previous balance_after + delta, in order', async () => {
    await reserveCredits(workspace, 10, TOKEN)
    await reserveCredits(workspace, 5, TOKEN)
    await refundCredits(workspace, 5, TOKEN)

    const ledger = await ledgerFor(workspace.id)
    const sorted = [...ledger].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    let runningBalance = 0
    for (const row of sorted) {
      runningBalance += row.delta
      expect(row.balance_after).toBe(runningBalance)
    }
  })

  it('records a zero-delta comped charge without moving the balance', async () => {
    const before = workspace.credits_balance
    const after = await chargeComped(workspace, TOKEN, { note: 'first avatar comped' })
    expect(after).toBe(before)

    const ledger = await ledgerFor(workspace.id)
    const compedRow = ledger.find((row) => row.note === 'first avatar comped')
    expect(compedRow?.delta).toBe(0)
  })
})

describe('RATES', () => {
  it('matches the documented per-unit credit rates', () => {
    expect(RATES.voice_gen).toBe(1)
    expect(RATES.voice_swap).toBe(4)
    expect(RATES.video_gen).toBe(40)
    expect(RATES.voice_clone).toBe(25)
    expect(RATES.avatar_create).toBe(50)
  })
})
