import { describe, expect, it } from 'vitest'
import { tokenize } from './tokenize.js'

describe('tokenize', () => {
  it('lowercases and splits latin words on punctuation and space', () => {
    expect(tokenize('Hello, MCP-server!')).toEqual(['hello', 'mcp', 'server'])
  })

  it('normalizes unicode (NFD → NFC) so decomposed hangul matches', () => {
    const nfc = '정책'
    const nfd = nfc.normalize('NFD')
    expect(tokenize(nfd)).toEqual(tokenize(nfc))
  })

  it('produces bigrams for CJK runs', () => {
    // 정책적 → 정책, 책적
    expect(tokenize('정책적')).toEqual(['정책', '책적'])
  })

  it('keeps a lone CJK char as a unigram', () => {
    expect(tokenize('책 read')).toEqual(['책', 'read'])
  })

  it('separates latin and CJK runs at the boundary', () => {
    expect(tokenize('MCP서버')).toEqual(['mcp', '서버'])
  })

  it('lets "정책" query overlap "정책적" body via bigram', () => {
    const body = tokenize('mcp 서버 정책적 결정')
    expect(body).toContain('정책') // 부분 겹침의 근거
  })
})
