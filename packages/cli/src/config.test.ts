import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configPath, load, save } from './config.js'

let dir: string
let env: NodeJS.ProcessEnv

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pantry-cfg-'))
  env = { PANTRY_CONFIG: join(dir, 'config.json'), PANTRY_ROOT: join(dir, 'kb') }
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('config', () => {
  it('PANTRY_CONFIG overrides the path', () => {
    expect(configPath(env)).toBe(join(dir, 'config.json'))
  })

  it('returns defaults when the file is absent', async () => {
    const cfg = await load(env)
    expect(cfg.root).toBe(join(dir, 'kb'))
    expect(cfg.plugins).toEqual([])
  })

  it('round-trips through save/load', async () => {
    await save({ root: '/tmp/x', plugins: [{ pkg: '@p/random', description: '무작위' }] }, env)
    const cfg = await load(env)
    expect(cfg.root).toBe('/tmp/x')
    expect(cfg.plugins).toEqual([{ pkg: '@p/random', description: '무작위' }])
  })

  it('fills missing fields from a partial file', async () => {
    await writeFile(join(dir, 'config.json'), JSON.stringify({ root: '/only/root' }), 'utf8')
    const cfg = await load(env)
    expect(cfg.root).toBe('/only/root')
    expect(cfg.plugins).toEqual([])
  })
})
