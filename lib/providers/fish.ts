// lib/providers/fish.ts — Fish Audio TTS voice cloning + text-to-speech.
// Docs: https://api.fish.audio (POST /model to clone a voice, POST /v1/tts to synthesize).
// Env: FISH_AUDIO_API_KEY.
import { logProviderCall } from './audit'
import { isMockMode, mockAudioBuffer } from './mock'
import { ProviderError, providerTimeout } from './provider-error'

const BASE = 'https://api.fish.audio'

function apiKey(): string {
  const key = process.env.FISH_AUDIO_API_KEY
  if (!key) throw new ProviderError('fish', 'FISH_AUDIO_API_KEY is not configured')
  return key
}

/** Clones a voice from a sample audio recording. Returns Fish Audio's voice model id. */
export async function cloneVoice(audioUrl: string, name: string, viewerId: string, token: string): Promise<string> {
  await logProviderCall(viewerId, 'fish.cloneVoice', { audioUrl, name }, token)
  if (isMockMode(token)) {
    return `mock-fish-voice-${Buffer.from(name).toString('hex').slice(0, 12)}`
  }
  const form = new FormData()
  form.append('title', name)
  form.append('type', 'tts')
  const sampleRes = await fetch(audioUrl, { signal: providerTimeout() })
  if (!sampleRes.ok) throw new ProviderError('fish', `failed to fetch training sample: ${sampleRes.status}`, sampleRes.status)
  const sampleBuffer = new Uint8Array(await sampleRes.arrayBuffer())
  form.append('voices', new Blob([sampleBuffer]), 'sample.wav')

  const res = await fetch(`${BASE}/model`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}` },
    body: form,
    signal: providerTimeout(),
  })
  if (!res.ok) throw new ProviderError('fish', `cloneVoice failed: ${res.status}`, res.status)
  const body = (await res.json()) as { _id?: string; id?: string }
  const voiceId = body._id ?? body.id
  if (!voiceId) throw new ProviderError('fish', 'cloneVoice: missing voice id in response')
  return voiceId
}

/** Synthesizes speech for `text` using a previously cloned voice. Returns an MP3 buffer. */
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
    },
    body: JSON.stringify({ text, reference_id: fishVoiceId }),
    signal: providerTimeout(),
  })
  if (!res.ok) throw new ProviderError('fish', `tts failed: ${res.status}`, res.status)
  return Buffer.from(await res.arrayBuffer())
}
