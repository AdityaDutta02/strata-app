// lib/providers/provider-error.ts — shared typed error for all provider clients.
export class ProviderError extends Error {
  provider: string
  status?: number

  constructor(provider: string, message: string, status?: number) {
    super(message)
    this.name = 'ProviderError'
    this.provider = provider
    this.status = status
  }
}

/** 60s timeout signal shared by every outbound provider fetch. */
export function providerTimeout(): AbortSignal {
  return AbortSignal.timeout(60_000)
}
