// lib/providers/research.ts — per-line source research + cue suggestions via OpenRouter's
// `perplexity/sonar-pro` (web-search-grounded model). Docs: https://openrouter.ai/docs.
// Env: OPENROUTER_API_KEY. Lines are batched into a single call per project to control cost.
import { logProviderCall } from './audit'
import { isMockMode } from './mock'
import { ProviderError, providerTimeout } from './provider-error'

const BASE = 'https://openrouter.ai/api/v1/chat/completions'
const MODEL = 'perplexity/sonar-pro'

function apiKey(): string {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) throw new ProviderError('research', 'OPENROUTER_API_KEY is not configured')
  return key
}

export interface SourceResult {
  url: string
  title: string
  snippet: string
  cueType?: string
  direction?: string
}

interface RawResultRow {
  index?: number
  url?: string
  title?: string
  snippet?: string
  cueType?: string
  direction?: string
}

function buildPrompt(lines: string[], context: string): string {
  const numbered = lines.map((line, i) => `${i}. ${line}`).join('\n')
  return [
    `Project context: ${context || '(none provided)'}`,
    '',
    'For each numbered script line below, find the single most relevant recent news article or',
    'reference source, and suggest a short visual cue (one of: chart, lower-third, app-screen, none)',
    'plus a one-sentence director direction for how to present it on screen.',
    '',
    numbered,
    '',
    'Respond with ONLY a JSON array, one object per line, in the same order, each shaped exactly as:',
    '{"index": <number>, "url": "<source url>", "title": "<source title>", "snippet": "<1-sentence summary>",',
    ' "cueType": "<chart|lower-third|app-screen|none>", "direction": "<director note>"}',
  ].join('\n')
}

function parseResponse(content: string, count: number): SourceResult[] {
  let parsed: unknown
  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/)
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content)
  } catch (err) {
    throw new ProviderError('research', `failed to parse research response as JSON: ${String(err)}`)
  }
  if (!Array.isArray(parsed)) throw new ProviderError('research', 'research response was not a JSON array')

  const results: SourceResult[] = new Array(count).fill(null).map(() => ({
    url: '',
    title: '',
    snippet: '',
  }))
  for (const raw of parsed as RawResultRow[]) {
    const idx = typeof raw.index === 'number' ? raw.index : -1
    if (idx < 0 || idx >= count) continue
    results[idx] = {
      url: raw.url ?? '',
      title: raw.title ?? '',
      snippet: raw.snippet ?? '',
      cueType: raw.cueType,
      direction: raw.direction,
    }
  }
  return results
}

function mockResult(line: string, index: number): SourceResult {
  return {
    url: `https://example.com/mock-source-${index}`,
    title: `Mock source for line ${index + 1}`,
    snippet: line.slice(0, 80),
    cueType: 'none',
    direction: 'Hold on presenter; no additional cue needed.',
  }
}

/** Batched: one OpenRouter call covers every line in `lines`, in order. */
export async function findSources(
  lines: string[],
  context: string,
  viewerId: string,
  token: string,
): Promise<SourceResult[]> {
  await logProviderCall(viewerId, 'research.findSources', { lineCount: lines.length }, token)
  if (lines.length === 0) return []
  if (isMockMode(token)) {
    return lines.map((line, i) => mockResult(line, i))
  }

  const res = await fetch(BASE, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: buildPrompt(lines, context) }],
    }),
    signal: providerTimeout(),
  })
  if (!res.ok) throw new ProviderError('research', `findSources failed: ${res.status}`, res.status)
  const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const content = body.choices?.[0]?.message?.content ?? '[]'
  return parseResponse(content, lines.length)
}

/** Single-line convenience wrapper — prefer findSources() when researching a whole project. */
export async function findSource(line: string, context: string, viewerId: string, token: string): Promise<SourceResult> {
  const [result] = await findSources([line], context, viewerId, token)
  if (!result) throw new ProviderError('research', 'findSources returned no result for line')
  return result
}
