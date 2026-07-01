import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Pantry } from './pantry.js'

let root: string

// 결정적 시계·id: 테스트가 파일명·타임스탬프를 고정할 수 있게 주입한다.
function makePantry(opts?: { at?: string; ids?: string[] }) {
  const at = opts?.at ?? '2026-03-20T10:00:00.000Z'
  const ids = [...(opts?.ids ?? ['aaaaaaaa', 'bbbbbbbb', 'cccccccc'])]
  return new Pantry({
    root,
    now: () => new Date(at),
    newId: () => ids.shift() ?? 'zzzzzzzz',
  })
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pantry-test-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('create', () => {
  it('writes YYYY-MM-DD-slug-id.md and stamps createdAt', async () => {
    const p = makePantry({ ids: ['abcde123'] })
    const file = await p.create({ slug: 'parse-yaml', body: 'body text' })
    expect(file.id).toBe('2026-03-20-parse-yaml-abcde123')
    expect(file.frontmatter.createdAt).toBe('2026-03-20T10:00:00.000Z')

    const onDisk = await readFile(join(root, `${file.id}.md`), 'utf8')
    expect(onDisk).toContain('slug: parse-yaml')
    expect(onDisk).toContain('body text')
  })

  it('rejects a bad slug before touching disk', async () => {
    const p = makePantry()
    await expect(p.create({ slug: 'Bad Slug', body: 'x' })).rejects.toThrow(/slug/)
    expect(await readdir(root)).toEqual([])
  })
})

describe('read', () => {
  it('round-trips a created ingredient and returns null for unknown id', async () => {
    const p = makePantry({ ids: ['id1'] })
    const created = await p.create({ slug: 's', body: '# hi\n\ncontent\n' })
    const read = await p.read(created.id)
    expect(read?.body).toBe('# hi\n\ncontent\n')
    expect(await p.read('nope')).toBeNull()
  })
})

describe('query', () => {
  it('ranks by body BM25 and returns id handles', async () => {
    const p = makePantry({ ids: ['a1', 'a2', 'a3'] })
    await p.create({ slug: 'one', body: 'yaml parsing policy decisions' })
    await p.create({ slug: 'two', body: 'yaml only mentioned once' })
    await p.create({ slug: 'three', body: 'nothing relevant here' })

    const hits = await p.query({ text: 'yaml policy' })
    expect(hits[0]?.id).toContain('-one-')
    expect(hits.map((h) => h.id).some((id) => id.includes('-three-'))).toBe(false)
    expect(hits[0]?.snippet).toBeTruthy()
  })

  it('hides deprecated by default, shows with includeDeprecated', async () => {
    const p = makePantry({ ids: ['a1'] })
    const f = await p.create({ slug: 'old', body: 'deprecated yaml note' })
    await p.deprecate(f.id)

    expect(await p.query({ text: 'yaml' })).toHaveLength(0)
    expect(await p.query({ text: 'yaml', includeDeprecated: true })).toHaveLength(1)
  })

  it('attaches content-address only when hash requested', async () => {
    const p = makePantry({ ids: ['a1'] })
    await p.create({ slug: 's', body: 'hashable body' })
    expect((await p.query({ text: 'hashable' }))[0]?.hash).toBeUndefined()
    expect((await p.query({ text: 'hashable', hash: true }))[0]?.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('empty text enumerates all visible notes by id (random plugin contract)', async () => {
    const p = makePantry({ ids: ['b', 'a'] })
    await p.create({ slug: 'z', body: 'one' })
    await p.create({ slug: 'y', body: 'two' })
    const hits = await p.query({ text: '' })
    expect(hits).toHaveLength(2)
    expect(hits.map((h) => h.id)).toEqual([...hits.map((h) => h.id)].sort())
  })

  it('paginates with offset and limit', async () => {
    const p = makePantry({ ids: ['a', 'b', 'c'] })
    await p.create({ slug: 'one', body: 'shared word' })
    await p.create({ slug: 'two', body: 'shared word' })
    await p.create({ slug: 'three', body: 'shared word' })
    const page = await p.query({ text: 'shared', offset: 1, limit: 1 })
    expect(page).toHaveLength(1)
  })
})

describe('fix', () => {
  it('overwrites body but preserves frontmatter', async () => {
    const p = makePantry({ ids: ['a1'] })
    const f = await p.create({ slug: 's', body: 'teh typo' })
    const fixed = await p.fix(f.id, 'the typo')
    expect(fixed.body).toBe('the typo')
    expect(fixed.frontmatter.createdAt).toBe(f.frontmatter.createdAt)
    expect((await p.read(f.id))?.body).toBe('the typo')
  })

  it('throws for unknown id', async () => {
    await expect(makePantry().fix('nope', 'x')).rejects.toThrow(/no such/)
  })
})

describe('deprecate', () => {
  it('stamps deprecatedAt without touching body, and is idempotent', async () => {
    const p = makePantry({ at: '2026-03-20T10:00:00.000Z', ids: ['a1'] })
    const f = await p.create({ slug: 's', body: 'keep me' })
    await p.deprecate(f.id)
    const read = await p.read(f.id)
    expect(read?.frontmatter.deprecatedAt).toBe('2026-03-20T10:00:00.000Z')
    expect(read?.body).toBe('keep me')
    await expect(p.deprecate(f.id)).resolves.toBeUndefined() // 멱등
  })
})

describe('delete', () => {
  it('removes the file and is idempotent for missing ids', async () => {
    const p = makePantry({ ids: ['a1'] })
    const f = await p.create({ slug: 's', body: 'gone soon' })
    await p.delete(f.id)
    expect(await p.read(f.id)).toBeNull()
    await expect(p.delete(f.id)).resolves.toBeUndefined()
    await expect(p.delete('never-existed')).resolves.toBeUndefined()
  })
})
