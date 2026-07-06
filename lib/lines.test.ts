import { describe, expect, it } from 'vitest'
import { splitIntoLines } from './lines'
import type { WordTiming } from './types'

function words(pairs: Array<[string, number, number]>): WordTiming[] {
  return pairs.map(([word, start, end]) => ({ word, start, end }))
}

describe('splitIntoLines', () => {
  it('returns an empty array for no words', () => {
    expect(splitIntoLines([])).toEqual([])
  })

  it('breaks a line at sentence-ending punctuation', () => {
    const input = words([
      ['Hello', 0, 0.3],
      ['world.', 0.3, 0.6],
      ['Second', 0.7, 1.0],
      ['sentence.', 1.0, 1.4],
    ])
    const lines = splitIntoLines(input)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toEqual({ t0: 0, t1: 0.6, text: 'Hello world.' })
    expect(lines[1]).toEqual({ t0: 0.7, t1: 1.4, text: 'Second sentence.' })
  })

  it('force-closes a line once it reaches the max word count even without punctuation', () => {
    const longRun = words(
      Array.from({ length: 20 }, (_, i) => [`word${i}`, i, i + 0.5] as [string, number, number]),
    )
    const lines = splitIntoLines(longRun)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines[0]!.text.split(' ')).toHaveLength(15)
  })

  it('flushes a trailing partial line with no terminal punctuation', () => {
    const input = words([
      ['no', 0, 0.2],
      ['period', 0.2, 0.5],
    ])
    const lines = splitIntoLines(input)
    expect(lines).toHaveLength(1)
    expect(lines[0]!.text).toBe('no period')
  })

  it('preserves timing bounds from the first and last word in each line', () => {
    const input = words([
      ['a', 1.5, 1.8],
      ['b.', 1.8, 2.2],
    ])
    const [line] = splitIntoLines(input)
    expect(line!.t0).toBe(1.5)
    expect(line!.t1).toBe(2.2)
  })
})
