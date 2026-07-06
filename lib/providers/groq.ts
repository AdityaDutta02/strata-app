// lib/providers/groq.ts — Groq-hosted Whisper transcription with word timestamps.
// Docs: https://api.groq.com/openai/v1/audio/transcriptions, model whisper-large-v3-turbo,
// response_format=verbose_json with word-level timestamps. Env: GROQ_API_KEY.
import { logProviderCall } from './audit'
import { isMockMode, MOCK_TRANSCRIPT_WORDS } from './mock'
import { ProviderError, providerTimeout } from './provider-error'
import type { WordTiming } from '../types'

const BASE = 'https://api.groq.com/openai/v1/audio/transcriptions'
const MODEL = 'whisper-large-v3-turbo'

function apiKey(): string {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new ProviderError('groq', 'GROQ_API_KEY is not configured')
  return key
}

export interface TranscriptResult {
  text: string
  words: WordTiming[]
}

interface VerboseJsonWord {
  word: string
  start: number
  end: number
}

interface VerboseJsonResponse {
  text: string
  words?: VerboseJsonWord[]
}

export async function transcribe(audioBuffer: Buffer, viewerId: string, token: string): Promise<TranscriptResult> {
  await logProviderCall(viewerId, 'groq.transcribe', { bytes: audioBuffer.byteLength }, token)
  if (isMockMode(token)) {
    return {
      text: MOCK_TRANSCRIPT_WORDS.map((w) => w.word).join(' '),
      words: MOCK_TRANSCRIPT_WORDS,
    }
  }
  const form = new FormData()
  form.append('model', MODEL)
  form.append('response_format', 'verbose_json')
  form.append('timestamp_granularities[]', 'word')
  form.append('file', new Blob([new Uint8Array(audioBuffer)]), 'audio.wav')

  const res = await fetch(BASE, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}` },
    body: form,
    signal: providerTimeout(),
  })
  if (!res.ok) throw new ProviderError('groq', `transcribe failed: ${res.status}`, res.status)
  const body = (await res.json()) as VerboseJsonResponse
  return {
    text: body.text,
    words: (body.words ?? []).map((w) => ({ word: w.word, start: w.start, end: w.end })),
  }
}
