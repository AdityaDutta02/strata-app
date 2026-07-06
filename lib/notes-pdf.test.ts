import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { renderNotesPdf } from './notes-pdf'
import type { NotesLine } from './types'

describe('renderNotesPdf', () => {
  it('renders a non-empty PDF buffer with a title-only, no-lines project', async () => {
    const buffer = await renderNotesPdf({ title: 'Empty Project' }, [])
    expect(buffer).toBeInstanceOf(Buffer)
    expect(buffer.byteLength).toBeGreaterThan(0)
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-')
  })

  it('renders timed lines with directions and sources without throwing', async () => {
    const lines: NotesLine[] = [
      {
        t0: 0,
        t1: 4.2,
        line: 'This is the opening line of the script, long enough to force word wrapping across the page width.',
        cueType: 'chart',
        direction: 'Cut to a chart showing quarterly growth.',
        source: { url: 'https://example.com/article', title: 'Example News Article' },
      },
      { t0: 4.2, t1: 6.0, line: 'A short second line.' },
    ]
    const buffer = await renderNotesPdf({ title: 'My Project', format: 'short', language: 'en' }, lines)
    expect(buffer.byteLength).toBeGreaterThan(0)
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-')
  })

  it('adds additional pages when content overflows a single page', async () => {
    const manyLines: NotesLine[] = Array.from({ length: 80 }, (_, i) => ({
      t0: i,
      t1: i + 1,
      line: `Line number ${i} with enough text to take up vertical space on the page.`,
      direction: 'Hold on presenter.',
      source: { url: `https://example.com/${i}`, title: `Source ${i}` },
    }))
    const buffer = await renderNotesPdf({ title: 'Long Project' }, manyLines)
    const doc = await PDFDocument.load(new Uint8Array(buffer))
    expect(doc.getPageCount()).toBeGreaterThan(1)
  })
})
