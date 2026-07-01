import { describe, expect, it } from 'vitest'
import { bm25, type Scorable } from './bm25.js'
import { tokenize } from './tokenize.js'

function doc(id: string, text: string): Scorable {
  return { id, tokens: tokenize(text) }
}

describe('bm25', () => {
  it('returns empty for empty corpus or empty query', () => {
    expect(bm25([], ['x'])).toEqual([])
    expect(bm25([doc('a', 'hello')], [])).toEqual([])
  })

  it('ranks docs with more query-term overlap higher (OR + partial)', () => {
    const corpus = [
      doc('both', 'yaml parser policy'),
      doc('one', 'yaml only here'),
      doc('none', 'unrelated text'),
    ]
    const ranked = bm25(corpus, tokenize('yaml policy'))
    const ids = ranked.map((r) => r.id)
    expect(ids[0]).toBe('both') // 두 단어 다 겹쳐 위로
    expect(ids).toContain('one') // 한 단어만 겹쳐도 매칭(OR)
    expect(ids).not.toContain('none') // 안 겹치면 탈락
  })

  it('rewards rarer terms via idf', () => {
    // "rare"는 한 문서에만, "common"은 모든 문서에. rare 매칭이 더 높은 점수.
    const corpus = [
      doc('a', 'common common rare'),
      doc('b', 'common common common'),
      doc('c', 'common common common'),
    ]
    const rare = bm25(corpus, tokenize('rare'))[0]!
    const common = bm25(corpus, tokenize('common')).find((r) => r.id === 'a')!
    expect(rare.score).toBeGreaterThan(common.score)
  })

  it('is deterministic: ties break by id', () => {
    const corpus = [doc('b', 'yaml'), doc('a', 'yaml')]
    expect(bm25(corpus, tokenize('yaml')).map((r) => r.id)).toEqual(['a', 'b'])
  })
})
