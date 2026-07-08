import { describe, expect, it, vi } from 'vitest'
import { withRetry } from './retry'

function errWithCode(code: string): Error {
  const err = new Error(`fetch failed`)
  ;(err as unknown as { cause: unknown }).cause = Object.assign(new Error(code), { code })
  return err
}

describe('withRetry', () => {
  it('returns the result on first success without retrying', async () => {
    const fn = vi.fn(async () => 'ok')
    const result = await withRetry(fn, { baseDelayMs: 1 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on a transient transport error and succeeds', async () => {
    let calls = 0
    const fn = vi.fn(async () => {
      calls += 1
      if (calls < 3) throw errWithCode('EAI_AGAIN')
      return 'ok'
    })
    const result = await withRetry(fn, { retries: 3, baseDelayMs: 1 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('gives up after exhausting retries and reports attempt count', async () => {
    const fn = vi.fn(async () => {
      throw errWithCode('ECONNRESET')
    })
    await expect(withRetry(fn, { retries: 3, baseDelayMs: 1 })).rejects.toMatchObject({
      message: expect.stringContaining('ECONNRESET'),
      attempts: 3,
    })
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('never retries a non-transport error', async () => {
    class JobValidationError extends Error {}
    const fn = vi.fn(async () => {
      throw new JobValidationError('bad input')
    })
    await expect(withRetry(fn, { retries: 3, baseDelayMs: 1 })).rejects.toThrow('bad input')
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
