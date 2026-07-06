// lib/providers/fish.ts — Fish Audio TTS voice cloning + text-to-speech.
// Docs: https://docs.fish.audio (POST /model to clone a voice, POST /v1/tts to synthesize).
// Env: FISH_AUDIO_API_KEY.
import { logProviderCall } from './audit'
import { isMockMode, mockAudioBuffer } from './mock'
import { ProviderError, providerTimeout } from './provider-error'

const BASE = 'https://api.fish.audio'

// S2.1 Pro is Fish Audio's current recommended production model. `s2.1-pro-free`
// is the identical model served at $0 (fair use, no TTFA/DPA guarantees) — per
// https://docs.fish.audio/developer-guide/models-pricing/models-overview.
// The model is selected via the `model` request header on POST /v1/tts.
const TTS_MODEL = 's2.1-pro-free'

function apiKey(): string {
  const key = process.env.FISH_AUDIO_API_KEY
  if (!key) throw new ProviderError('fish', 'FISH_AUDIO_API_KEY is not configured')
  return key
}

/** Reads an error response body (truncated) so failures carry Fish Audio's diagnostic message. */
async function errorDetail(res: Response): Promise<string> {
  const body = await res.text().catch(() => '')
  return body ? `: ${body.slice(0, 300)}` : ''
}

/** Clones a voice from a sample audio recording. Returns Fish Audio's voice model id. */
export async function cloneVoice(audioUrl: string, name: string, viewerId: string, token: string): Promise<string> {
  await logProviderCall(viewerId, 'fish.cloneVoice', { audioUrl, name }, token)
  if (isMockMode(token)) {
    return `mock-fish-voice-${Buffer.from(name).toString('hex').slice(0, 12)}`
  }
  const sampleRes = await fetch(audioUrl, { signal: providerTimeout() })
  if (!sampleRes.ok) throw new ProviderError('fish', `failed to fetch training sample: ${sampleRes.status}`, sampleRes.status)
  const sampleBuffer = new Uint8Array(await sampleRes.arrayBuffer())
  const sampleType = sampleRes.headers.get('content-type') ?? 'audio/wav'
  const sampleName = sampleType.includes('mpeg') || sampleType.includes('mp3') ? 'sample.mp3' : 'sample.wav'

  const form = new FormData()
  form.append('type', 'tts')
  form.append('title', name)
  form.append('visibility', 'private')
  form.append('voices', new Blob([sampleBuffer], { type: sampleType }), sampleName)

  const res = await fetch(`${BASE}/model`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}` },
    body: form,
    signal: providerTimeout(),
  })
  if (!res.ok) throw new ProviderError('fish', `cloneVoice failed: ${res.status}${await errorDetail(res)}`, res.status)
  const body = (await res.json()) as { _id?: string; id?: string; state?: string }
  if (body.state === 'failed') throw new ProviderError('fish', 'cloneVoice: model training failed')
  const voiceId = body._id ?? body.id
  if (!voiceId) throw new ProviderError('fish', 'cloneVoice: missing voice id in response')
  return voiceId
}

/** Synthesizes speech for `text` with S2.1 Pro (free tier) using a previously cloned voice. Returns an MP3 buffer. */
export async function tts(text: string, fishVoiceId: string, viewerId: string, token: string): Promise<Buffer> {
  await logProviderCall(viewerId, 'fish.tts', { textLength: text.length, fishVoiceId }, token)
  if (isMockMode(token)) {
    return mockAudioBuffer()
  }
  const res = await fetch(`${BASE}/v1/tts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
      model: TTS_MODEL,
    },
    body: JSON.stringify({ text, reference_id: fishVoiceId, format: 'mp3' }),
    signal: providerTimeout(),
  })
  if (!res.ok) throw new ProviderError('fish', `tts failed: ${res.status}${await errorDetail(res)}`, res.status)
  return Buffer.from(await res.arrayBuffer())
}
