// lib/retry.ts — generic retry wrapper for transient transport failures.
// Only retries network-transport errors (DNS hiccups, connection resets, timeouts) — never
// validation errors, which represent bad input and will never succeed on retry.
const RETRYABLE_CODES = new Set(['EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EPIPE'])

interface RetryableError extends Error {
  attempts?: number
}

function errorCode(err: unknown): string | undefined {
  if (!(err instanceof Error)) return undefined
  const cause = (err as { cause?: unknown }).cause
  if (cause instanceof Error && 'code' in cause && typeof (cause as { code?: unknown }).code === 'string') {
    return (cause as { code: string }).code
  }
  if (err.message.includes('socket hang up')) return 'socket hang up'
  return undefined
}

function isRetryable(err: unknown): boolean {
  const code = errorCode(err)
  return code !== undefined && (RETRYABLE_CODES.has(code) || code === 'socket hang up')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface WithRetryOptions {
  retries?: number
  baseDelayMs?: number
}

/** Runs `fn`, retrying on transient transport errors with exponential backoff + jitter.
 *  Non-transport errors (e.g. JobValidationError) are thrown immediately, never retried. */
export async function withRetry<T>(fn: () => Promise<T>, opts: WithRetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 3
  const baseDelayMs = opts.baseDelayMs ?? 1000
  let lastErr: unknown
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (!isRetryable(err) || attempt === retries) break
      const jitter = Math.random() * baseDelayMs * 0.5
      await sleep(baseDelayMs * Math.pow(2, attempt - 1) + jitter)
    }
  }
  if (lastErr instanceof Error) {
    const code = errorCode(lastErr)
    const attempts = isRetryable(lastErr) ? retries : 1
    const withAttempts = new Error(code ? `${lastErr.message} (${code})` : lastErr.message) as RetryableError
    withAttempts.attempts = attempts
    withAttempts.name = lastErr.name
    throw withAttempts
  }
  throw lastErr
}
