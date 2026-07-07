// lib/upload-key.ts — storage-key construction for user uploads.
// Original filenames never enter the key: storage gateways reject traversal-ish
// sequences (e.g. "..") and exotic characters with a 400, so the key is built purely
// from viewer/kind/timestamp plus a whitelisted extension. Display names belong in
// asset metadata, not keys.

export type UploadKind = 'script' | 'avatar_training' | 'voice_training' | 'recording'

const ALLOWED_EXTENSIONS: Record<UploadKind, readonly string[]> = {
  script: ['txt', 'md'],
  avatar_training: ['mp4', 'mov', 'webm'],
  voice_training: ['mp3', 'wav', 'm4a'],
  recording: ['mp3', 'wav', 'm4a'],
}

export class UnsupportedFileTypeError extends Error {
  constructor(kind: UploadKind, ext: string) {
    super(
      `Unsupported file type ".${ext || '?'}" for ${kind.replace('_', ' ')} — allowed: ${ALLOWED_EXTENSIONS[
        kind
      ].join(', ')}`,
    )
    this.name = 'UnsupportedFileTypeError'
  }
}

/** Extracts a lowercase extension from a filename ('' when none). */
export function extensionOf(filename: string): string {
  const match = /\.([a-zA-Z0-9]{1,8})$/.exec(filename.trim())
  return match ? match[1]!.toLowerCase() : ''
}

/** Builds a gateway-safe storage key. Throws UnsupportedFileTypeError for bad extensions. */
export function buildUploadKey(viewerId: string, kind: UploadKind, filename: string, timestamp: number): string {
  const ext = extensionOf(filename)
  if (!ALLOWED_EXTENSIONS[kind].includes(ext)) throw new UnsupportedFileTypeError(kind, ext)
  return `strata/${viewerId}/uploads/${kind}/${timestamp}.${ext}`
}
