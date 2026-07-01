import { describe, expect, it } from 'vitest'
import { parse, serialize } from './frontmatter.js'

describe('frontmatter serialize/parse', () => {
  it('round-trips a minimal ingredient', () => {
    const fm = { slug: 'parse-yaml', createdAt: '2026-03-20T10:00:00.000Z' }
    const body = '# 제목\n\n본문이다.\n'
    const round = parse('2026-03-20-parse-yaml-abcde', serialize(fm, body))
    expect(round.frontmatter).toEqual(fm)
    expect(round.body).toBe(body)
  })

  it('carries deprecatedAt when present and omits it when absent', () => {
    const withDep = serialize(
      { slug: 's', createdAt: '2026-01-01T00:00:00.000Z', deprecatedAt: '2026-02-01T00:00:00.000Z' },
      'x',
    )
    expect(withDep).toContain('deprecatedAt:')
    const without = serialize({ slug: 's', createdAt: '2026-01-01T00:00:00.000Z' }, 'x')
    expect(without).not.toContain('deprecatedAt:')
  })

  it('preserves body that contains a --- fence line', () => {
    // 본문 안의 --- 는 닫는 fence 이후이므로 본문으로 살아남는다.
    const body = 'intro\n\n---\n\nmore\n'
    const round = parse('id', serialize({ slug: 's', createdAt: 't' }, body))
    expect(round.body).toBe(body)
  })

  it('stores body verbatim so content-address stays stable across round-trip', () => {
    // 개행 보정 없이 그대로 왕복 — bodyHash가 흔들리지 않는 근거.
    for (const body of ['no newline', 'trailing\n', 'multi\nline\n\n']) {
      expect(parse('id', serialize({ slug: 's', createdAt: 't' }, body)).body).toBe(body)
    }
  })

  it('throws on missing fence or required fields', () => {
    expect(() => parse('id', 'no fence here')).toThrow()
    expect(() => parse('id', '---\ncreatedAt: t\n---\nbody')).toThrow(/slug/)
    expect(() => parse('id', '---\nslug: s\n---\nbody')).toThrow(/createdAt/)
  })
})
