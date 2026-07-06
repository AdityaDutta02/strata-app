// lib/providers/mock.ts — shared mock-mode detection + deterministic fixture bytes.
// Mock mode is entered when PROVIDER_MOCK=1 (server env, e.g. CI / preview deploys) OR when
// the caller's embed token is a sandboxed Agent Preview run (lib/terminal-ai.ts `isSandbox`).
import { isSandbox } from '../terminal-ai'

export function isMockMode(token: string | null | undefined): boolean {
  return process.env.PROVIDER_MOCK === '1' || isSandbox(token)
}

// Minimal-but-structurally-valid placeholder bytes. We do not depend on public/fixtures/*
// existing on disk (that directory is owned by the frontend agent) — these are generated
// inline so mock mode works standalone in any environment, including test runners.

/** A ~0.1s silent WAV file — small, valid RIFF/WAVE container. */
export function mockAudioBuffer(): Buffer {
  const sampleRate = 8000
  const numSamples = 800
  const dataSize = numSamples * 2
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(1, 22) // mono
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataSize, 40)
  return buffer
}

/** A minimal MP4 "ftyp" box only — not a playable video, but a stable, deterministic
 *  placeholder for mock-mode asset storage. */
export function mockVideoBuffer(): Buffer {
  const ftyp = Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, // size, 'ftyp'
    0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00, // 'isom', minor version
    0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x31, // compatible brands
  ])
  return ftyp
}

export const MOCK_TRANSCRIPT_WORDS = [
  { word: 'Welcome', start: 0.0, end: 0.4 },
  { word: 'to', start: 0.4, end: 0.55 },
  { word: 'Strata,', start: 0.55, end: 1.0 },
  { word: 'a', start: 1.0, end: 1.1 },
  { word: 'mock', start: 1.1, end: 1.4 },
  { word: 'transcript.', start: 1.4, end: 2.0 },
  { word: 'This', start: 2.2, end: 2.4 },
  { word: 'is', start: 2.4, end: 2.5 },
  { word: 'sample', start: 2.5, end: 2.8 },
  { word: 'deterministic', start: 2.8, end: 3.3 },
  { word: 'output.', start: 3.3, end: 3.8 },
]
