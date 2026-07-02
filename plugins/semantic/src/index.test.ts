// 계약 검증: fake embedder를 주입해 무거운 모델 없이 훅을 직접 돌린다.
// 훅 배선(등록순 파이프·void 강제 등)은 cli의 runtime.test.ts가 이미 검증하므로,
// 여기선 이 plugin이 보는 것만 — ctx = {dir, query, read} — 손으로 조립해 훅을 부른다.
// 축은 셋: (1) afterCreate가 격리 구역에만 부산물을 쓰나, (2) afterQuery가 lexical을
// 절대 안 죽이고 의미적 이웃만 뒤에 보태나(union + floor), (3) deprecated·삭제·차원
// 불일치 벡터를 거르나.

import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bodyHash, Pantry, type PluginContext } from '@pantrykb/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSemanticPlugin } from './index.js'
import type { Embedder } from './embedder.js'
import { readVec } from './store.js'

let root: string

function makePantry() {
  let n = 0
  return new Pantry({
    root,
    now: () => new Date('2026-03-20T10:00:00.000Z'),
    newId: () => `id${n++}`,
  })
}

/** plugin이 실제로 보는 ctx를 조립한다: 격리 구역 dir + 순정 read-only 동사. */
function ctxFor(pantry: Pantry): PluginContext {
  return {
    dir: join(root, '.pantry', 'plugins', 'semantic'),
    query: (input) => pantry.query(input),
    read: (id) => pantry.read(id),
  }
}

/**
 * 결정적 fake embedder. 각 axis(동의어 그룹)의 등장 여부를 좌표로 하는 벡터를
 * 만들고 L2 정규화한다. 그룹으로 묶으면 lexical로는 안 겹치는 두 단어(예: gamma/beta)를
 * 같은 축에 올려 "벡터로만 이웃"인 상황을 결정적으로 재현할 수 있다 — 실제 e5의
 * 의미적 근접을 fake가 흉내 내는 유일한 지점. query/document 프리픽스는 무시한다.
 */
function fakeEmbedder(axes: string[][], model = 'fake-v1'): Embedder {
  const vec = (text: string): number[] => {
    const low = text.toLowerCase()
    const raw = axes.map((group) => (group.some((w) => low.includes(w)) ? 1 : 0))
    const norm = Math.hypot(...raw) || 1
    return raw.map((x) => x / norm)
  }
  return {
    model,
    embedDocuments: (texts) => Promise.resolve(texts.map(vec)),
    embedQuery: (text) => Promise.resolve(vec(text)),
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pantry-sem-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('semantic plugin', () => {
  it('afterCreate writes a vector byproduct only inside the isolation dir', async () => {
    const pantry = makePantry()
    const ctx = ctxFor(pantry)
    const plugin = createSemanticPlugin(fakeEmbedder([['alpha']]))
    const file = await pantry.create({ slug: 'a', body: 'alpha note' })
    await plugin.hooks!.afterCreate!(ctx, { slug: 'a', body: 'alpha note' }, file)

    const names = await readdir(join(ctx.dir, 'vec'))
    expect(names).toEqual([`${file.id}.json`])
    // 순정 디렉토리(root)엔 .md만 — 부산물이 새지 않았다.
    const rootNames = await readdir(root)
    expect(rootNames.filter((n) => n.endsWith('.json'))).toEqual([])
  })

  it('afterQuery keeps lexical hits and appends semantic neighbors after them', async () => {
    const pantry = makePantry()
    const ctx = ctxFor(pantry)
    // gamma와 beta를 한 축(동의어 그룹)에 올린다 → 질의 "gamma"의 벡터가 "beta only"와 가깝다.
    const plugin = createSemanticPlugin(fakeEmbedder([['gamma', 'beta']]))
    const lex = await pantry.create({ slug: 'lex', body: 'gamma beta' }) // 질의어 gamma → lexical hit
    const sem = await pantry.create({ slug: 'sem', body: 'beta only' }) // gamma 없음 → 벡터로만 걸림
    for (const f of [lex, sem]) await plugin.hooks!.afterCreate!(ctx, { slug: f.frontmatter.slug, body: f.body }, f)

    const input = { text: 'gamma' }
    const lexical = await pantry.query(input)
    const hits = await plugin.hooks!.afterQuery!(ctx, input, lexical)
    const ids = hits.map((h) => h.id)
    // lexical hit(lex)이 맨 앞에 그대로, 의미적 이웃(sem)이 뒤에 붙는다.
    expect(ids[0]).toBe(lex.id)
    expect(ids).toContain(sem.id)
    expect(ids.indexOf(lex.id)).toBeLessThan(ids.indexOf(sem.id))
  })

  it('does not duplicate a note that is already a lexical hit', async () => {
    const pantry = makePantry()
    const ctx = ctxFor(pantry)
    const plugin = createSemanticPlugin(fakeEmbedder([['shared']]))
    const a = await pantry.create({ slug: 'a', body: 'shared word' })
    await plugin.hooks!.afterCreate!(ctx, { slug: 'a', body: a.body }, a)

    const input = { text: 'shared' }
    const hits = await plugin.hooks!.afterQuery!(ctx, input, await pantry.query(input))
    expect(hits.filter((h) => h.id === a.id)).toHaveLength(1)
  })

  it('filters out deprecated neighbors unless includeDeprecated', async () => {
    const pantry = makePantry()
    const ctx = ctxFor(pantry)
    const plugin = createSemanticPlugin(fakeEmbedder([['topic']]))
    const dep = await pantry.create({ slug: 'dep', body: 'topic here' })
    await plugin.hooks!.afterCreate!(ctx, { slug: 'dep', body: dep.body }, dep)
    await pantry.deprecate(dep.id)

    // 질의어 자체는 아무 노트와도 lexical로 안 겹치게 둔다 → dep은 순전히 벡터 이웃 후보.
    const hidden = await plugin.hooks!.afterQuery!(ctx, { text: 'topic' }, [])
    expect(hidden.map((h) => h.id)).not.toContain(dep.id)

    const shown = await plugin.hooks!.afterQuery!(ctx, { text: 'topic', includeDeprecated: true }, [])
    expect(shown.map((h) => h.id)).toContain(dep.id)
  })

  it('afterFix re-embeds so the stored vector tracks the new body', async () => {
    const pantry = makePantry()
    const ctx = ctxFor(pantry)
    // 두 축: 'topic'과 'other'. 처음엔 topic으로 임베딩됐다가 fix로 other로 옮긴다.
    const plugin = createSemanticPlugin(fakeEmbedder([['topic'], ['other']]))
    const f = await pantry.create({ slug: 'f', body: 'about topic' })
    await plugin.hooks!.afterCreate!(ctx, { slug: 'f', body: f.body }, f)

    // fix 전: 질의 'topic'의 이웃, 'other'의 이웃 아님.
    expect((await plugin.hooks!.afterQuery!(ctx, { text: 'topic' }, [])).map((h) => h.id)).toContain(f.id)
    expect((await plugin.hooks!.afterQuery!(ctx, { text: 'other' }, [])).map((h) => h.id)).not.toContain(f.id)

    const fixed = await pantry.fix(f.id, 'about other')
    await plugin.hooks!.afterFix!(ctx, fixed)

    // fix 후: 축이 뒤집힌다 — 이제 'other'의 이웃, 'topic'의 이웃 아님.
    expect((await plugin.hooks!.afterQuery!(ctx, { text: 'other' }, [])).map((h) => h.id)).toContain(f.id)
    expect((await plugin.hooks!.afterQuery!(ctx, { text: 'topic' }, [])).map((h) => h.id)).not.toContain(f.id)
    // 저장된 hash도 새 본문을 가리킨다(content-address가 거짓말하지 않는다).
    const rec = await readVec(ctx.dir, f.id)
    expect(rec!.hash).toBe(bodyHash('about other'))
  })

  it('afterDelete removes the orphan vector', async () => {
    const pantry = makePantry()
    const ctx = ctxFor(pantry)
    const plugin = createSemanticPlugin(fakeEmbedder([['x']]))
    const f = await pantry.create({ slug: 'x', body: 'x note' })
    await plugin.hooks!.afterCreate!(ctx, { slug: 'x', body: f.body }, f)
    expect(await readdir(join(ctx.dir, 'vec'))).toHaveLength(1)

    await plugin.hooks!.afterDelete!(ctx, f.id)
    expect(await readdir(join(ctx.dir, 'vec'))).toHaveLength(0)
  })

  it('init backfills notes that have no vector yet, and is idempotent', async () => {
    const pantry = makePantry()
    const ctx = ctxFor(pantry)
    const plugin = createSemanticPlugin(fakeEmbedder([['alpha'], ['beta']]))
    // 세 노트를 순정으로만 만든다(afterCreate 안 돌림) → 벡터 0인 "옛 CLI KB" 재현.
    await pantry.create({ slug: 'a', body: 'alpha one' })
    await pantry.create({ slug: 'b', body: 'beta two' })
    await pantry.create({ slug: 'c', body: 'alpha beta three' })

    const first = (await plugin.commands!.init!.run([], ctx)) as {
      scanned: number
      embedded: number
      skipped: number
    }
    expect(first).toMatchObject({ scanned: 3, embedded: 3, skipped: 0 })
    expect(await readdir(join(ctx.dir, 'vec'))).toHaveLength(3)

    // 재실행은 전부 스킵(멱등) — 같은 model·hash라 다시 임베딩하지 않는다.
    const second = (await plugin.commands!.init!.run([], ctx)) as { embedded: number; skipped: number }
    expect(second).toMatchObject({ embedded: 0, skipped: 3 })

    // 그리고 backfill된 벡터로 afterQuery가 실제로 이웃을 찾는다.
    const hits = await plugin.hooks!.afterQuery!(ctx, { text: 'alpha' }, [])
    expect(hits.length).toBeGreaterThan(0)
  })

  it('init re-embeds when the model changed', async () => {
    const pantry = makePantry()
    const ctx = ctxFor(pantry)
    const f = await pantry.create({ slug: 'a', body: 'topic here' })
    // 옛 모델로 먼저 임베딩.
    await createSemanticPlugin(fakeEmbedder([['topic']], 'old-model')).hooks!.afterCreate!(
      ctx,
      { slug: 'a', body: f.body },
      f,
    )
    // 새 모델의 init은 hash가 같아도 model이 달라 재임베딩한다(스킵 아님).
    const newPlugin = createSemanticPlugin(fakeEmbedder([['topic']], 'new-model'))
    const res = (await newPlugin.commands!.init!.run([], ctx)) as { embedded: number; skipped: number }
    expect(res).toMatchObject({ embedded: 1, skipped: 0 })
    expect((await readVec(ctx.dir, f.id))!.model).toBe('new-model')
  })

  it('init paginates past the core query limit (>20 notes)', async () => {
    const pantry = makePantry()
    const ctx = ctxFor(pantry)
    const plugin = createSemanticPlugin(fakeEmbedder([['n']]))
    // 순정 query의 DEFAULT_LIMIT=20을 넘겨, init이 offset으로 끝까지 훑는지 본다.
    for (let i = 0; i < 25; i++) await pantry.create({ slug: `n${i}`, body: `note ${i}` })
    const res = (await plugin.commands!.init!.run([], ctx)) as { scanned: number; embedded: number }
    expect(res).toMatchObject({ scanned: 25, embedded: 25 })
    expect(await readdir(join(ctx.dir, 'vec'))).toHaveLength(25)
  })

  it('ignores vectors from a different model (dimension/quality mismatch)', async () => {
    const pantry = makePantry()
    const ctx = ctxFor(pantry)
    // 노트는 옛 모델로 임베딩됐는데 현재 embedder는 새 모델 → 벡터를 못 믿어 무시.
    const oldPlugin = createSemanticPlugin(fakeEmbedder([['topic']], 'old-model'))
    const stale = await pantry.create({ slug: 'stale', body: 'topic here' })
    await oldPlugin.hooks!.afterCreate!(ctx, { slug: 'stale', body: stale.body }, stale)

    const newPlugin = createSemanticPlugin(fakeEmbedder([['topic']], 'new-model'))
    const hits = await newPlugin.hooks!.afterQuery!(ctx, { text: 'topic' }, [])
    expect(hits.map((h) => h.id)).not.toContain(stale.id)
  })
})
