// lib/providers/research.ts — per-line source research + cue suggestions via OpenRouter's
// `perplexity/sonar-pro` (web-search-grounded model). Docs: https://openrouter.ai/docs.
// OpenRouter standardizes real web-search citations as `message.annotations[]` entries of
// type `url_citation` (docs/features/web-search); we parse those and ground the model's
// per-line URLs against them rather than trusting model-emitted URLs alone.
// Env: OPENROUTER_API_KEY (required); OPENROUTER_SITE_URL / OPENROUTER_APP_TITLE (optional,
// sent as HTTP-Referer / X-Title attribution headers per OpenRouter docs).
// Lines are batched into a single call per project to control cost.
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

/** OpenRouter standardized web-search citation (message.annotations[], type "url_citation"). */
interface UrlCitationAnnotation {
  type?: string
  url_citation?: {
    url?: string
    title?: string
    content?: string
    start_index?: number
    end_index?: number
  }
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string
      annotations?: UrlCitationAnnotation[]
    }
  }>
}

interface Citation {
  url: string
  title: string
  content: string
}

/** Optional OpenRouter attribution headers (HTTP-Referer / X-Title), sent only when configured. */
function attributionHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
  const siteUrl = process.env.OPENROUTER_SITE_URL
  const appTitle = process.env.OPENROUTER_APP_TITLE
  if (siteUrl) headers['HTTP-Referer'] = siteUrl
  if (appTitle) headers['X-Title'] = appTitle
  return headers
}

function extractCitations(body: ChatCompletionResponse): Citation[] {
  const annotations = body.choices?.[0]?.message?.annotations ?? []
  const citations: Citation[] = []
  for (const annotation of annotations) {
    if (annotation.type !== 'url_citation') continue
    const cite = annotation.url_citation
    if (!cite?.url) continue
    citations.push({ url: cite.url, title: cite.title ?? '', content: cite.content ?? '' })
  }
  return citations
}

function normalizeUrl(raw: string): string {
  try {
    const parsed = new URL(raw)
    return `${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/$/, '')}`
  } catch {
    return raw.trim().toLowerCase()
  }
}

function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/**
 * Ground a model-emitted row URL against the REAL search citations returned in
 * message.annotations. Exact URL match wins; otherwise a same-host citation is
 * substituted (the model reliably picks the right source but often mangles paths).
 * Returns undefined when the row URL cannot be tied to any real citation.
 */
function resolveCitation(rowUrl: string, citations: Citation[]): Citation | undefined {
  if (!rowUrl) return undefined
  const normalized = normalizeUrl(rowUrl)
  const exact = citations.find((c) => normalizeUrl(c.url) === normalized)
  if (exact) return exact
  const host = hostOf(rowUrl)
  if (!host) return undefined
  return citations.find((c) => hostOf(c.url) === host)
}

/** Replace model-emitted URLs with real citation URLs wherever they can be grounded. */
function groundResults(results: SourceResult[], citations: Citation[]): SourceResult[] {
  if (citations.length === 0) return results
  return results.map((result) => {
    const citation = resolveCitation(result.url, citations)
    if (!citation) return result
    return {
      ...result,
      url: citation.url,
      title: result.title || citation.title,
      snippet: result.snippet || citation.content.slice(0, 200),
    }
  })
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
    'Only use URLs that appear in your actual web search results — never invent or guess a URL.',
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
      ...attributionHeaders(),
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: buildPrompt(lines, context) }],
    }),
    signal: providerTimeout(),
  })
  if (!res.ok) throw new ProviderError('research', `findSources failed: ${res.status}`, res.status)
  const body = (await res.json()) as ChatCompletionResponse
  const content = body.choices?.[0]?.message?.content ?? '[]'
  const results = parseResponse(content, lines.length)
  // Ground model-emitted URLs against the real url_citation annotations OpenRouter
  // returns for web-search-grounded models (Perplexity Sonar included).
  return groundResults(results, extractCitations(body))
}

/** Single-line convenience wrapper — prefer findSources() when researching a whole project. */
export async function findSource(line: string, context: string, viewerId: string, token: string): Promise<SourceResult> {
  const [result] = await findSources([line], context, viewerId, token)
  if (!result) throw new ProviderError('research', 'findSources returned no result for line')
  return result
}
