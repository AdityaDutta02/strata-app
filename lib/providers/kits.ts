// lib/providers/kits.ts — Kits.ai voice swap/conversion client.
// Docs: https://docs.kits.ai — base URL https://arpeggi.io/api/kits/v1, Bearer auth.
//   POST /voice-conversions        multipart/form-data { voiceModelId, soundFile } → async job
//   GET  /voice-conversions/{id}   poll: status running|success|error|cancelled →
//                                  outputFileUrl (lossless) / lossyOutputFileUrl
// NOTE: the Voice Model API is read-only (GET /voice-models, GET /voice-models/{id}).
// There is NO API endpoint to create/train a custom voice model — training is only
// available through the Kits.ai web app, so createTargetVoice throws outside mock mode.
// Env: KITS_API_KEY.
import { logProviderCall } from './audit'
import { isMockMode, mockAudioBuffer } from './mock'
import { ProviderError, providerTimeout } from './provider-error'

const BASE = 'https://arpeggi.io/api/kits/v1'
const POLL_INTERVAL_MS = 3_000
// Overall budget for the async conversion job (each individual fetch keeps the 60s timeout).
const POLL_DEADLINE_MS = 5 * 60_000

/** Terminal + in-flight job states per the Kits.ai "Inference Job" type. */
type KitsJobStatus = 'running' | 'success' | 'error' | 'cancelled'

interface KitsConversionJob {
  id: number
  status: KitsJobStatus
  outputFileUrl: string | null
  lossyOutputFileUrl: string | null
}

function apiKey(): string {
  const key = process.env.KITS_API_KEY
  if (!key) throw new ProviderError('kits', 'KITS_API_KEY is not configured')
  return key
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Kits.ai accepts wav, mp3, or flac uploads; anything else is sent as wav. */
function soundFileNameFor(recordingUrl: string): { filename: string; mime: string } {
  const path = new URL(recordingUrl).pathname.toLowerCase()
  if (path.endsWith('.mp3')) return { filename: 'recording.mp3', mime: 'audio/mpeg' }
  if (path.endsWith('.flac')) return { filename: 'recording.flac', mime: 'audio/flac' }
  return { filename: 'recording.wav', mime: 'audio/wav' }
}

/**
 * Registers `audioUrl` as a swap target voice.
 *
 * CAPABILITY GAP: the current Kits.ai public API has no voice-model creation/training
 * endpoint (Voice Model API is GET-only). Custom voices must be trained in the Kits.ai
 * web app (https://app.kits.ai), after which their numeric model id can be used with
 * convert(). Outside mock mode this always throws so callers surface the limitation
 * instead of silently storing a bogus voice id.
 */
export async function createTargetVoice(audioUrl: string, name: string, viewerId: string, token: string): Promise<string> {
  await logProviderCall(viewerId, 'kits.createTargetVoice', { audioUrl, name }, token)
  if (isMockMode(token)) {
    return `mock-kits-voice-${Buffer.from(name).toString('hex').slice(0, 12)}`
  }
  throw new ProviderError(
    'kits',
    'Kits.ai does not support programmatic voice model training: the API only lists existing models (GET /voice-models). Train the voice in the Kits.ai web app and supply its numeric voiceModelId instead.',
    501,
  )
}

/** Converts a spoken recording onto the given target voice. Returns the converted audio bytes. */
export async function convert(recordingUrl: string, kitsVoiceId: string, viewerId: string, token: string): Promise<Buffer> {
  await logProviderCall(viewerId, 'kits.convert', { recordingUrl, kitsVoiceId }, token)
  if (isMockMode(token)) {
    return mockAudioBuffer()
  }

  // The API takes a binary upload (no URL variant), so fetch the recording first.
  const recordingRes = await fetch(recordingUrl, { signal: providerTimeout() })
  if (!recordingRes.ok) {
    throw new ProviderError('kits', `failed to fetch source recording: ${recordingRes.status}`, recordingRes.status)
  }
  const recordingBytes = await recordingRes.arrayBuffer()

  const { filename, mime } = soundFileNameFor(recordingUrl)
  const form = new FormData()
  form.append('voiceModelId', kitsVoiceId)
  form.append('soundFile', new Blob([recordingBytes], { type: mime }), filename)

  // multipart/form-data: fetch sets the Content-Type (with boundary) from the FormData body.
  const createRes = await fetch(`${BASE}/voice-conversions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}` },
    body: form,
    signal: providerTimeout(),
  })
  if (!createRes.ok) {
    const detail = (await createRes.text().catch(() => '')).slice(0, 200)
    throw new ProviderError('kits', `convert failed: ${createRes.status}${detail ? ` ${detail}` : ''}`, createRes.status)
  }
  const created = (await createRes.json()) as KitsConversionJob
  if (typeof created.id !== 'number') {
    throw new ProviderError('kits', 'convert: missing job id in response')
  }

  const job = await pollConversion(created.id)
  const outputUrl = job.outputFileUrl ?? job.lossyOutputFileUrl
  if (!outputUrl) throw new ProviderError('kits', 'convert: job succeeded but no output url in response')

  const audioRes = await fetch(outputUrl, { signal: providerTimeout() })
  if (!audioRes.ok) throw new ProviderError('kits', `failed to fetch converted audio: ${audioRes.status}`, audioRes.status)
  return Buffer.from(await audioRes.arrayBuffer())
}

/** Polls GET /voice-conversions/{id} until the job reaches a terminal status. */
async function pollConversion(jobId: number): Promise<KitsConversionJob> {
  const deadline = Date.now() + POLL_DEADLINE_MS
  for (;;) {
    const res = await fetch(`${BASE}/voice-conversions/${jobId}`, {
      headers: { Authorization: `Bearer ${apiKey()}` },
      signal: providerTimeout(),
    })
    if (!res.ok) throw new ProviderError('kits', `convert poll failed: ${res.status}`, res.status)
    const job = (await res.json()) as KitsConversionJob
    if (job.status === 'success') return job
    if (job.status === 'error' || job.status === 'cancelled') {
      throw new ProviderError('kits', `conversion job ${jobId} ended with status ${job.status}`)
    }
    if (Date.now() >= deadline) {
      throw new ProviderError('kits', `conversion job ${jobId} still running after ${POLL_DEADLINE_MS / 1000}s`)
    }
    await sleep(POLL_INTERVAL_MS)
  }
}
