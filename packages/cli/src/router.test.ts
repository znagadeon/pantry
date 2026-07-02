import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Plugin } from '@pantrykb/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Io } from './router.js'
import { run } from './router.js'

let dir: string
let out: string[]
let env: NodeJS.ProcessEnv

const randomPlugin: Plugin = {
  name: '@p/random',
  commands: {
    random: {
      description: '무작위 하나',
      run: async (_a, ctx) => {
        const hits = await ctx.query({ text: '' })
        return hits.length === 0 ? null : ctx.read(hits[0]!.id)
      },
    },
  },
}

function makeIo(stdin = ''): Io {
  return {
    stdout: (t) => out.push(t),
    readStdin: () => Promise.resolve(stdin),
    env,
    importer: (pkg) => {
      if (pkg === '@p/random') return Promise.resolve({ default: randomPlugin })
      throw new Error(`no stub for ${pkg}`)
    },
  }
}

/** stdout에 쌓인 마지막 JSON 덩어리를 파싱. */
function lastJson(): unknown {
  return JSON.parse(out[out.length - 1]!)
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pantry-cli-'))
  out = []
  env = { PANTRY_CONFIG: join(dir, 'config.json'), PANTRY_ROOT: join(dir, 'kb') }
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('router end-to-end', () => {
  it('create reads body from --body and emits the file as JSON', async () => {
    await run(['create', '--slug', 'parse-yaml', '--body', 'hello body'], makeIo())
    const file = lastJson() as { id: string; body: string }
    expect(file.id).toContain('-parse-yaml-')
    expect(file.body).toBe('hello body')
  })

  it('create falls back to stdin when --body is absent', async () => {
    await run(['create', '--slug', 's'], makeIo('from stdin'))
    expect((lastJson() as { body: string }).body).toBe('from stdin')
  })

  it('query returns ranked handles for positional text', async () => {
    await run(['create', '--slug', 'a', '--body', 'yaml policy'], makeIo())
    await run(['create', '--slug', 'b', '--body', 'unrelated'], makeIo())
    out = []
    await run(['query', 'yaml', 'policy'], makeIo())
    const hits = lastJson() as { id: string }[]
    expect(hits).toHaveLength(1)
    expect(hits[0]!.id).toContain('-a-')
  })

  it('query --hash attaches content-address', async () => {
    await run(['create', '--slug', 'a', '--body', 'hashme'], makeIo())
    out = []
    await run(['query', 'hashme', '--hash'], makeIo())
    expect((lastJson() as { hash: string }[])[0]!.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('read of unknown id throws', async () => {
    await expect(run(['read', 'nope'], makeIo())).rejects.toThrow(/no such/)
  })

  it('deprecate hides from default query', async () => {
    await run(['create', '--slug', 'a', '--body', 'yaml'], makeIo())
    const created = lastJson() as { id: string }
    await run(['deprecate', created.id], makeIo())
    out = []
    await run(['query', 'yaml'], makeIo())
    expect(lastJson()).toEqual([])
  })

  it('config set/get root round-trips', async () => {
    await run(['config', 'set', 'root', '/custom/kb'], makeIo())
    out = []
    await run(['config', 'get', 'root'], makeIo())
    expect(lastJson()).toBe('/custom/kb')
  })

  it('plugin add/list/remove manages the ordered list', async () => {
    await run(['plugin', 'add', '@p/random', '무작위 하나'], makeIo())
    out = []
    await run(['plugin', 'list'], makeIo())
    expect(lastJson()).toEqual([{ pkg: '@p/random', description: '무작위 하나' }])
    await run(['plugin', 'remove', '@p/random'], makeIo())
    out = []
    await run(['plugin', 'list'], makeIo())
    expect(lastJson()).toEqual([])
  })

  it('plugin run dispatches to the packaged command', async () => {
    await run(['plugin', 'add', '@p/random', 'r'], makeIo())
    await run(['create', '--slug', 'only', '--body', 'the one note'], makeIo())
    out = []
    await run(['plugin', 'run', '@p/random', 'random'], makeIo())
    expect((lastJson() as { body: string }).body).toBe('the one note')
  })

  it('unknown command throws with usage', async () => {
    await expect(run(['frobnicate'], makeIo())).rejects.toThrow(/unknown command/)
  })
})
