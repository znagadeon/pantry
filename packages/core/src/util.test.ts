import { describe, expect, it } from 'vitest'
import { assertSlug, bodyHash, ingredientId } from './util.js'

describe('assertSlug', () => {
  it('accepts lowercase alphanumeric and hyphens', () => {
    expect(() => assertSlug('mcp-server-policy')).not.toThrow()
  })

  it('rejects uppercase, spaces, and non-ascii', () => {
    expect(() => assertSlug('MCP')).toThrow()
    expect(() => assertSlug('mcp server')).toThrow()
    expect(() => assertSlug('서버')).toThrow()
    expect(() => assertSlug('')).toThrow()
  })
})

describe('bodyHash', () => {
  it('is deterministic and body-only', () => {
    const h = bodyHash('hello')
    expect(h).toBe(bodyHash('hello'))
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(bodyHash('hello')).not.toBe(bodyHash('world'))
  })
})

describe('ingredientId', () => {
  it('assembles date-slug-id and validates the slug', () => {
    expect(ingredientId('2026-03-20', 'parse-yaml', 'abcde')).toBe('2026-03-20-parse-yaml-abcde')
    expect(() => ingredientId('2026-03-20', 'Bad Slug', 'abcde')).toThrow()
  })
})
