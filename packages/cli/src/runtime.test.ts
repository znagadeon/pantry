import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pantry, type Plugin } from '@pantry/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PluginEntry } from './config.js'
import { buildRuntime, type Importer } from './runtime.js'

let root: string

function makePantry() {
  let n = 0
  return new Pantry({
    root,
    now: () => new Date('2026-03-20T10:00:00.000Z'),
    newId: () => `id${n++}`,
  })
}

/** 주입 importer: pkg명 → 미리 만든 Plugin. 실제 npm 설치 없이 훅 배선만 검증. */
function importerFor(map: Record<string, Plugin>): Importer {
  return (pkg) => {
    const plugin = map[pkg]
    if (!plugin) throw new Error(`no stub for ${pkg}`)
    return Promise.resolve({ default: plugin })
  }
}

function entries(...pkgs: string[]): PluginEntry[] {
  return pkgs.map((pkg) => ({ pkg, description: pkg }))
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pantry-rt-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('Runtime hook wiring', () => {
  it('chains beforeCreate in registration order (pipe: prev output → next input)', async () => {
    const first: Plugin = {
      name: 'first',
      hooks: { beforeCreate: (_c, i) => ({ ...i, body: `${i.body} [first]` }) },
    }
    const second: Plugin = {
      name: 'second',
      hooks: { beforeCreate: (_c, i) => ({ ...i, body: `${i.body} [second]` }) },
    }
    const rt = await buildRuntime(
      makePantry(),
      { root, plugins: entries('first', 'second') },
      importerFor({ first, second }),
    )
    const file = await rt.create({ slug: 's', body: 'base' })
    expect(file.body).toBe('base [first] [second]')
  })

  it('beforeCreate throw aborts loudly and never writes', async () => {
    const guard: Plugin = {
      name: 'guard',
      hooks: {
        beforeCreate: () => {
          throw new Error('nope')
        },
      },
    }
    const pantry = makePantry()
    const rt = await buildRuntime(pantry, { root, plugins: entries('guard') }, importerFor({ guard }))
    await expect(rt.create({ slug: 's', body: 'x' })).rejects.toThrow('nope')
    expect(await pantry.query({ text: '' })).toHaveLength(0)
  })

  it('afterQuery reranks/augments in order (result → result)', async () => {
    const rev: Plugin = {
      name: 'rev',
      hooks: { afterQuery: (_c, _i, hits) => [...hits].reverse() },
    }
    const pantry = makePantry()
    await pantry.create({ slug: 'a', body: 'alpha shared' })
    await pantry.create({ slug: 'b', body: 'beta shared shared' }) // 더 높은 점수
    const plain = await pantry.query({ text: 'shared' })
    const rt = await buildRuntime(pantry, { root, plugins: entries('rev') }, importerFor({ rev }))
    const reranked = await rt.query({ text: 'shared' })
    expect(reranked.map((h) => h.id)).toEqual([...plain.map((h) => h.id)].reverse())
  })

  it('afterCreate cannot change the core result (void) but sees dir in its context', async () => {
    let seenDir = ''
    const spy: Plugin = {
      name: 'spy',
      hooks: {
        afterCreate: (ctx) => {
          seenDir = ctx.dir
        },
      },
    }
    const rt = await buildRuntime(makePantry(), { root, plugins: entries('spy') }, importerFor({ spy }))
    await rt.create({ slug: 's', body: 'x' })
    expect(seenDir).toBe(join(root, '.pantry', 'plugins', 'spy'))
  })

  it("plugin ctx.query is raw core — it does not re-enter another plugin's afterQuery", async () => {
    // caller가 afterQuery로 hits를 오염시켜도, 옆 plugin이 ctx.query로 본 결과엔 안 묻는다.
    let sawViaCtx = -1
    const poison: Plugin = {
      name: 'poison',
      hooks: { afterQuery: (_c, _i, hits) => hits.slice(0, 0) }, // 전부 지움
    }
    const reader: Plugin = {
      name: 'reader',
      commands: {
        count: {
          description: 'ctx.query 결과 개수',
          run: async (_a, ctx) => {
            sawViaCtx = (await ctx.query({ text: 'shared' })).length
            return sawViaCtx
          },
        },
      },
    }
    const pantry = makePantry()
    await pantry.create({ slug: 'a', body: 'shared' })
    const rt = await buildRuntime(
      pantry,
      { root, plugins: entries('poison', 'reader') },
      importerFor({ poison, reader }),
    )
    await rt.runPluginCommand('reader', 'count', [])
    expect(sawViaCtx).toBe(1) // poison의 afterQuery가 ctx.query엔 안 걸린다
  })

  it('runPluginCommand throws for inactive plugin or unknown command', async () => {
    const p: Plugin = { name: 'p', commands: { c: { description: 'x', run: () => 1 } } }
    const rt = await buildRuntime(makePantry(), { root, plugins: entries('p') }, importerFor({ p }))
    await expect(rt.runPluginCommand('nope', 'c', [])).rejects.toThrow(/not active/)
    await expect(rt.runPluginCommand('p', 'nope', [])).rejects.toThrow(/no command/)
    expect(await rt.runPluginCommand('p', 'c', [])).toBe(1)
  })

  it('dispatches by pkg handle, not plugin.name (they can differ)', async () => {
    // 실제 random plugin처럼 pkg(@scope/plugin-x) ≠ name(x). dispatch는 pkg로.
    const plugin: Plugin = { name: 'randy', commands: { go: { description: 'x', run: () => 42 } } }
    const rt = await buildRuntime(
      makePantry(),
      { root, plugins: [{ pkg: '@scope/plugin-randy', description: 'd' }] },
      importerFor({ '@scope/plugin-randy': plugin }),
    )
    expect(await rt.runPluginCommand('@scope/plugin-randy', 'go', [])).toBe(42)
    await expect(rt.runPluginCommand('randy', 'go', [])).rejects.toThrow(/not active/) // name으론 안 걸림
  })

  it('afterFix runs after fix and sees the new body (void, cannot change core result)', async () => {
    let seenBody = ''
    const spy: Plugin = {
      name: 'spy',
      hooks: { afterFix: (_c, result) => void (seenBody = result.body) },
    }
    const pantry = makePantry()
    const f = await pantry.create({ slug: 's', body: 'typo' })
    const rt = await buildRuntime(pantry, { root, plugins: entries('spy') }, importerFor({ spy }))
    const fixed = await rt.fix(f.id, 'fixed')
    expect(fixed.body).toBe('fixed') // 코어 결과 그대로
    expect(seenBody).toBe('fixed') // 훅은 새 본문을 본다
  })

  it('beforeDelete guard can abort delete', async () => {
    const guard: Plugin = {
      name: 'guard',
      hooks: {
        beforeDelete: () => {
          throw new Error('has inbound links')
        },
      },
    }
    const pantry = makePantry()
    const f = await pantry.create({ slug: 's', body: 'x' })
    const rt = await buildRuntime(pantry, { root, plugins: entries('guard') }, importerFor({ guard }))
    await expect(rt.delete(f.id)).rejects.toThrow(/inbound links/)
    expect(await pantry.read(f.id)).not.toBeNull() // 여전히 산다
  })
})
