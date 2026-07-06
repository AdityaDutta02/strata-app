// lib/providers/kits.ts — Kits.ai voice swap/conversion.
// Docs: https://arpeggi.io/api/kits/v1 (voice-models to register a target voice,
// voice-conversions to swap an existing recording onto it). Env: KITS_API_KEY.
import { logProviderCall } from './audit'
import { isMockMode, mockAudioBuffer } from './mock'
import { ProviderError, providerTimeout } from './provider-error'

const BASE = 'https://arpeggi.io/api/kits/v1'

function apiKey(): string {
  const key = process.env.KITS_API_KEY
  if (!key) throw new ProviderError('kits', 'KITS_API_KEY is not configured')
  return key
}

/** Registers `audioUrl` as a swap target voice. Returns Kits.ai's voice model id. */
export async function createTargetVoice(audioUrl: string, name: string, viewerId: string, token: string): Promise<string> {
  await logProviderCall(viewerId, 'kits.createTargetVoice', { audioUrl, name }, token)
  if (isMockMode(token)) {
    return `mock-kits-voice-${Buffer.from(name).toString('hex').slice(0, 12)}`
  }
  const res = await fetch(`${BASE}/voice-models`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, sample_url: audioUrl }),
    signal: providerTimeout(),
  })
  if (!res.ok) throw new ProviderError('kits', `createTargetVoice failed: ${res.status}`, res.status)
  const body = (await res.json()) as { id?: string; voice_model_id?: string }
  const voiceId = body.id ?? body.voice_model_id
  if (!voiceId) throw new ProviderError('kits', 'createTargetVoice: missing voice id in response')
  return voiceId
}

/** Converts a spoken recording onto the given target voice. Returns the converted audio bytes. */
export async function convert(recordingUrl: string, kitsVoiceId: string, viewerId: string, token: string): Promise<Buffer> {
  await logProviderCall(viewerId, 'kits.convert', { recordingUrl, kitsVoiceId }, token)
  if (isMockMode(token)) {
    return mockAudioBuffer()
  }
  const createRes = await fetch(`${BASE}/voice-conversions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ voice_model_id: kitsVoiceId, sound_url: recordingUrl }),
    signal: providerTimeout(),
  })
  if (!createRes.ok) throw new ProviderError('kits', `convert failed: ${createRes.status}`, createRes.status)
  const body = (await createRes.json()) as { output_file_url?: string; lossless_output_file_url?: string }
  const outputUrl = body.lossless_output_file_url ?? body.output_file_url
  if (!outputUrl) throw new ProviderError('kits', 'convert: missing output url in response')
  const audioRes = await fetch(outputUrl, { signal: providerTimeout() })
  if (!audioRes.ok) throw new ProviderError('kits', `failed to fetch converted audio: ${audioRes.status}`, audioRes.status)
  return Buffer.from(await audioRes.arrayBuffer())
}
