// lib/lines.ts — pure function: splits a word-timed transcript into short, sentence-ish lines.
// No I/O, no provider calls — safe to unit test directly.
import type { TimedLine, WordTiming } from './types'

const MAX_WORDS_PER_LINE = 15
const SENTENCE_END = /[.!?]["')\]]?$/

/** Splits transcript words into timed lines. Breaks are preferred at sentence-ending
 *  punctuation; otherwise a line is force-closed once it reaches MAX_WORDS_PER_LINE words. */
export function splitIntoLines(words: WordTiming[]): TimedLine[] {
  const lines: TimedLine[] = []
  let current: WordTiming[] = []

  for (const word of words) {
    current.push(word)
    const atSentenceEnd = SENTENCE_END.test(word.word.trim())
    const atMaxLength = current.length >= MAX_WORDS_PER_LINE
    if (atSentenceEnd || atMaxLength) {
      lines.push(toLine(current))
      current = []
    }
  }
  if (current.length > 0) {
    lines.push(toLine(current))
  }
  return lines
}

function toLine(words: WordTiming[]): TimedLine {
  const first = words[0]
  const last = words[words.length - 1]
  if (!first || !last) throw new Error('toLine requires a non-empty word list')
  return {
    t0: first.start,
    t1: last.end,
    text: words.map((w) => w.word).join(' ').replace(/\s+([,.!?;:])/g, '$1').trim(),
  }
}
