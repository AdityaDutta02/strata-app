// lib/notes-pdf.ts — renders the editor-notes JSON into a downloadable PDF via pdf-lib.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { NotesLine } from './types'

export interface NotesPdfMeta {
  title: string
  format?: string
  language?: string
  generatedAt?: string
}

const PAGE_SIZE: [number, number] = [612, 792] // US Letter, points
const MARGIN = 54
const LINE_HEIGHT = 14
const BODY_SIZE = 10
const TITLE_SIZE = 18
const META_SIZE = 9

function formatTimecode(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const mm = Math.floor(total / 60)
  const ss = total % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

/** Wraps `text` to fit within `maxWidth` points using `font`'s width metrics at `size`. */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const wrapped: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      wrapped.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) wrapped.push(current)
  return wrapped.length > 0 ? wrapped : ['']
}

interface Cursor {
  page: PDFPage
  y: number
}

/** Renders editor notes into a single- or multi-page PDF: title, project meta, then one block
 *  per timed line ([mm:ss] line text / optional direction / optional source title + URL). */
export async function renderNotesPdf(meta: NotesPdfMeta, lines: NotesLine[]): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold)
  const contentWidth = PAGE_SIZE[0] - MARGIN * 2

  let cursor: Cursor = { page: doc.addPage(PAGE_SIZE), y: PAGE_SIZE[1] - MARGIN }

  function ensureSpace(neededHeight: number): void {
    if (cursor.y - neededHeight < MARGIN) {
      cursor = { page: doc.addPage(PAGE_SIZE), y: PAGE_SIZE[1] - MARGIN }
    }
  }

  function drawLine(text: string, opts: { size: number; f: PDFFont; color?: ReturnType<typeof rgb>; indent?: number }): void {
    ensureSpace(LINE_HEIGHT)
    cursor.page.drawText(text, {
      x: MARGIN + (opts.indent ?? 0),
      y: cursor.y,
      size: opts.size,
      font: opts.f,
      color: opts.color ?? rgb(0, 0, 0),
    })
    cursor.y -= LINE_HEIGHT
  }

  drawLine(meta.title || 'Untitled project', { size: TITLE_SIZE, f: boldFont })
  cursor.y -= 6

  const metaParts = [
    meta.format ? `Format: ${meta.format}` : null,
    meta.language ? `Language: ${meta.language}` : null,
    `Generated: ${meta.generatedAt ?? new Date().toISOString()}`,
  ].filter((part): part is string => Boolean(part))
  if (metaParts.length > 0) {
    drawLine(metaParts.join('  |  '), { size: META_SIZE, f: font, color: rgb(0.4, 0.4, 0.4) })
    cursor.y -= 10
  }

  for (const line of lines) {
    const timecode = `[${formatTimecode(line.t0)}-${formatTimecode(line.t1)}]`
    const wrapped = wrapText(`${timecode} ${line.line}`, font, BODY_SIZE, contentWidth)
    for (const wrappedLine of wrapped) {
      drawLine(wrappedLine, { size: BODY_SIZE, f: font })
    }
    if (line.direction) {
      const wrappedDirection = wrapText(`Direction: ${line.direction}`, font, BODY_SIZE - 1, contentWidth - 12)
      for (const wrappedLine of wrappedDirection) {
        drawLine(wrappedLine, { size: BODY_SIZE - 1, f: font, color: rgb(0.3, 0.3, 0.5), indent: 12 })
      }
    }
    if (line.source) {
      const sourceText = `Source: ${line.source.title} — ${line.source.url}`
      const wrappedSource = wrapText(sourceText, font, BODY_SIZE - 1, contentWidth - 12)
      for (const wrappedLine of wrappedSource) {
        drawLine(wrappedLine, { size: BODY_SIZE - 1, f: font, color: rgb(0.2, 0.4, 0.2), indent: 12 })
      }
    }
    cursor.y -= 6
  }

  const bytes = await doc.save()
  return Buffer.from(bytes)
}
