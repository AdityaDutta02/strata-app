import { describe, expect, it } from 'vitest'
import { UnsupportedFileTypeError, buildUploadKey, extensionOf } from './upload-key'

describe('extensionOf', () => {
  it('extracts simple extensions case-insensitively', () => {
    expect(extensionOf('Sequence 03.MP4')).toBe('mp4')
    expect(extensionOf('notes.txt')).toBe('txt')
  })

  it('handles messy names with brackets, spaces and dot runs', () => {
    expect(extensionOf('[Clear Tech Narrator]This ......akes..mp3')).toBe('mp3')
  })

  it('returns empty string when there is no extension', () => {
    expect(extensionOf('README')).toBe('')
    expect(extensionOf('archive.')).toBe('')
  })
})

describe('buildUploadKey', () => {
  it('produces a key free of the original filename (no traversal sequences)', () => {
    const key = buildUploadKey('viewer-1', 'voice_training', '[Clear Tech Narrator]This ......akes..mp3', 1234)
    expect(key).toBe('strata/viewer-1/uploads/voice_training/1234.mp3')
    expect(key).not.toContain('..')
  })

  it('accepts whitelisted video extensions for avatar training', () => {
    expect(buildUploadKey('v', 'avatar_training', 'Sequence 03.mp4', 99)).toBe(
      'strata/v/uploads/avatar_training/99.mp4',
    )
  })

  it('rejects extensions outside the kind whitelist', () => {
    expect(() => buildUploadKey('v', 'avatar_training', 'song.mp3', 1)).toThrow(UnsupportedFileTypeError)
    expect(() => buildUploadKey('v', 'script', 'video.mp4', 1)).toThrow(UnsupportedFileTypeError)
    expect(() => buildUploadKey('v', 'recording', 'no-extension', 1)).toThrow(UnsupportedFileTypeError)
  })
})
