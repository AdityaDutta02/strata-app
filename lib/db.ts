// lib/db.ts — Terminal AI Database SDK (server-side only)
// Calls /db/* on the Terminal AI gateway using the embed token.
// IMPORTANT: The database is scoped per-APP, not per-user. All users of this app
// share the same tables. The embed token identifies the app for schema routing.
// If you need per-user data isolation, add a user_id column and filter on it.

const GATEWAY_URL = process.env.TERMINAL_AI_GATEWAY_URL!

// DB reads are rate limited per app+user (currently 600/min). On a 429 we back
// off and retry — honoring the gateway's Retry-After header — instead of failing
// the request. Without this, a burst of parallel reads (e.g. a dashboard
// fetching several tables at once) can surface transient 429s to the user.
async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(url, options)
    if (res.status !== 429) return res
    const retryAfter = parseInt(res.headers.get('Retry-After') ?? '0', 10)
    const delayMs = retryAfter > 0 ? retryAfter * 1000 : Math.pow(2, attempt + 1) * 1000
    await new Promise<void>((r) => setTimeout(r, delayMs))
  }
  return fetch(url, options)
}

async function dbRequest(method: string, path: string, body?: unknown, embedToken: string = ''): Promise<Response> {
  const res = await fetchWithRetry(`${GATEWAY_URL}/db/${path}`, {
    method,
    headers: { Authorization: `Bearer ${embedToken}`, 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error((err as { error: string }).error ?? `DB error ${res.status}`)
  }
  return res
}

export async function dbList<T = Record<string, unknown>>(table: string, filters: Record<string, string> = {}, embedToken: string): Promise<T[]> {
  const params = new URLSearchParams(filters)
  const res = await dbRequest('GET', `${table}?${params}`, undefined, embedToken)
  return res.json() as Promise<T[]>
}

export async function dbGet<T = Record<string, unknown>>(table: string, id: string, embedToken: string): Promise<T> {
  const res = await dbRequest('GET', `${table}/${id}`, undefined, embedToken)
  return res.json() as Promise<T>
}

export async function dbInsert<T = Record<string, unknown>>(table: string, row: Record<string, unknown>, embedToken: string): Promise<T> {
  const res = await dbRequest('POST', table, row, embedToken)
  return res.json() as Promise<T>
}

export async function dbUpdate<T = Record<string, unknown>>(table: string, id: string, patch: Record<string, unknown>, embedToken: string): Promise<T> {
  const res = await dbRequest('PATCH', `${table}/${id}`, patch, embedToken)
  return res.json() as Promise<T>
}

export async function dbDelete(table: string, id: string, embedToken: string): Promise<void> {
  await dbRequest('DELETE', `${table}/${id}`, undefined, embedToken)
}
