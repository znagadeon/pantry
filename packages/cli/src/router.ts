// argv → 순정 동사·메타 명령 라우팅. config를 읽어 Pantry를 세우고 plugin을 두른 뒤
// argv를 해당 동사로 넘긴다. 소비자가 AI라 데이터는 JSON으로, 실패는 시끄럽게 돌려준다.

import { Pantry } from '@pantrykb/core'
import * as config from './config.js'
import { buildRuntime, type Importer } from './runtime.js'

const USAGE = `pantry <command> [args]

verbs:
  create --slug <slug> [--body <text>]   새 .md 생성 (본문 생략 시 stdin)
  query <text...> [--limit N --offset N --hash --include-deprecated]
  read <id>                              id로 하나 펼침
  fix <id> [--body <text>]               오타 교정 (본문 생략 시 stdin)
  deprecate <id>                         deprecatedAt 찍기
  delete <id>                            물리적 소멸

meta:
  config get <key> | config set <key> <value>     (key: root)
  plugin add <pkg> <desc> | remove <pkg> | list | run <pkg> <cmd> [args]
`

/** 테스트가 stdin·stdout·env·importer를 주입할 수 있게 하는 IO 구멍. */
export type Io = {
  stdout: (text: string) => void
  readStdin: () => Promise<string>
  env: NodeJS.ProcessEnv
  importer?: Importer
}

const defaultIo: Io = {
  stdout: (text) => process.stdout.write(text),
  readStdin: readAllStdin,
  env: process.env,
}

export async function run(argv: string[], io: Io = defaultIo): Promise<void> {
  const [command, ...rest] = argv

  if (!command || command === '--help' || command === '-h') {
    io.stdout(USAGE)
    return
  }

  switch (command) {
    case 'create':
      return runCreate(rest, io)
    case 'query':
      return runQuery(rest, io)
    case 'read':
      return runRead(rest, io)
    case 'fix':
      return runFix(rest, io)
    case 'deprecate':
      return runDeprecate(rest, io)
    case 'delete':
      return runDelete(rest, io)
    case 'config':
      return runConfig(rest, io)
    case 'plugin':
      return runPlugin(rest, io)
    default:
      throw new Error(`unknown command: ${command}\n\n${USAGE}`)
  }
}

// ── 순정 동사 ────────────────────────────────────────────────────────────────

async function runCreate(args: string[], io: Io): Promise<void> {
  const { flags } = parseFlags(args)
  const slug = requireFlag(flags, 'slug')
  const body = flags.body ?? (await io.readStdin())
  const rt = await runtime(io)
  const file = await rt.create({ slug, body })
  emit(io, file)
}

async function runQuery(args: string[], io: Io): Promise<void> {
  const { flags, positionals } = parseFlags(args)
  const text = positionals.join(' ')
  const rt = await runtime(io)
  const hits = await rt.query({
    text,
    ...(flags.limit !== undefined ? { limit: intFlag(flags, 'limit') } : {}),
    ...(flags.offset !== undefined ? { offset: intFlag(flags, 'offset') } : {}),
    ...(flags.hash !== undefined ? { hash: true } : {}),
    ...(flags['include-deprecated'] !== undefined ? { includeDeprecated: true } : {}),
  })
  emit(io, hits)
}

async function runRead(args: string[], io: Io): Promise<void> {
  const id = requirePositional(args, 'id')
  const rt = await runtime(io)
  const note = await rt.read(id)
  if (note === null) throw new Error(`no such note: ${id}`)
  emit(io, note)
}

async function runFix(args: string[], io: Io): Promise<void> {
  const { flags, positionals } = parseFlags(args)
  const id = requirePositional(positionals, 'id')
  const body = flags.body ?? (await io.readStdin())
  const rt = await runtime(io)
  emit(io, await rt.fix(id, body))
}

async function runDeprecate(args: string[], io: Io): Promise<void> {
  const id = requirePositional(args, 'id')
  const rt = await runtime(io)
  await rt.deprecate(id)
  io.stdout(`deprecated ${id}\n`)
}

async function runDelete(args: string[], io: Io): Promise<void> {
  const id = requirePositional(args, 'id')
  const rt = await runtime(io)
  await rt.delete(id)
  io.stdout(`deleted ${id}\n`)
}

// ── 메타: config ─────────────────────────────────────────────────────────────

async function runConfig(args: string[], io: Io): Promise<void> {
  const [sub, key, ...rest] = args
  const cfg = await config.load(io.env)
  if (sub === 'get') {
    if (key === undefined) throw new Error('config get <key>')
    emit(io, configGet(cfg, key))
    return
  }
  if (sub === 'set') {
    if (key === undefined) throw new Error('config set <key> <value>')
    const value = rest.join(' ')
    await config.save(configSet(cfg, key, value), io.env)
    io.stdout(`set ${key}\n`)
    return
  }
  throw new Error('config get <key> | config set <key> <value>')
}

function configGet(cfg: config.Config, key: string): unknown {
  if (key === 'root') return cfg.root
  if (key === 'plugins') return cfg.plugins
  throw new Error(`unknown config key: ${key}`)
}

function configSet(cfg: config.Config, key: string, value: string): config.Config {
  // root만 set 가능. plugins는 plugin add/remove가 관리한다(등록순 보존).
  if (key === 'root') return { ...cfg, root: value }
  throw new Error(`config key not settable: ${key}`)
}

// ── 메타: plugin ─────────────────────────────────────────────────────────────

async function runPlugin(args: string[], io: Io): Promise<void> {
  const [sub, ...rest] = args
  switch (sub) {
    case 'add': {
      const [pkg, ...descParts] = rest
      if (!pkg) throw new Error('plugin add <pkg> <description>')
      const description = descParts.join(' ')
      if (!description) throw new Error('plugin add <pkg> <description>')
      const cfg = await config.load(io.env)
      if (cfg.plugins.some((p) => p.pkg === pkg)) throw new Error(`plugin already active: ${pkg}`)
      cfg.plugins.push({ pkg, description }) // 등록순 = 훅 체인 순서. append.
      await config.save(cfg, io.env)
      io.stdout(`added ${pkg}\n`)
      return
    }
    case 'remove': {
      const [pkg] = rest
      if (!pkg) throw new Error('plugin remove <pkg>')
      const cfg = await config.load(io.env)
      const next = cfg.plugins.filter((p) => p.pkg !== pkg)
      if (next.length === cfg.plugins.length) throw new Error(`plugin not active: ${pkg}`)
      await config.save({ ...cfg, plugins: next }, io.env)
      io.stdout(`removed ${pkg}\n`)
      return
    }
    case 'list': {
      const cfg = await config.load(io.env)
      emit(io, cfg.plugins)
      return
    }
    case 'run': {
      const [pkg, cmd, ...cmdArgs] = rest
      if (!pkg || !cmd) throw new Error('plugin run <pkg> <cmd> [args]')
      const rt = await runtime(io)
      emit(io, await rt.runPluginCommand(pkg, cmd, cmdArgs))
      return
    }
    default:
      throw new Error('plugin add <pkg> <desc> | remove <pkg> | list | run <pkg> <cmd> [args]')
  }
}

// ── 배선·유틸 ────────────────────────────────────────────────────────────────

async function runtime(io: Io) {
  const cfg = await config.load(io.env)
  const pantry = new Pantry({ root: cfg.root })
  return buildRuntime(pantry, cfg, io.importer)
}

/** 데이터 결과는 JSON으로. null도 그대로 직렬화(read 미스는 이 위에서 이미 걸린다). */
function emit(io: Io, value: unknown): void {
  io.stdout(`${JSON.stringify(value, null, 2)}\n`)
}

type Flags = Record<string, string | undefined>

/**
 * 최소 플래그 파서. `--key value`와 불리언 `--flag`(값 없는 다음이 또 플래그거나 끝),
 * 나머지는 positional. 값이 필요한 플래그와 불리언을 형태로 구분하지 않으므로,
 * 불리언(--hash 등)은 호출부에서 "존재 여부"로만 읽는다.
 */
function parseFlags(args: string[]): { flags: Flags; positionals: string[] } {
  const flags: Flags = {}
  const positionals: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = args[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next
        i++
      } else {
        flags[key] = '' // 불리언: 존재 표시만
      }
    } else {
      positionals.push(arg)
    }
  }
  return { flags, positionals }
}

function requireFlag(flags: Flags, key: string): string {
  const v = flags[key]
  if (v === undefined || v === '') throw new Error(`missing --${key}`)
  return v
}

function intFlag(flags: Flags, key: string): number {
  const n = Number(flags[key])
  if (!Number.isInteger(n) || n < 0) throw new Error(`--${key} must be a non-negative integer`)
  return n
}

function requirePositional(args: string[], name: string): string {
  const v = args.find((a) => !a.startsWith('--'))
  if (v === undefined) throw new Error(`missing <${name}>`)
  return v
}

/** stdin을 끝까지 읽는다. TTY(파이프 없음)면 즉시 빈 문자열 — 무한 대기 방지. */
function readAllStdin(): Promise<string> {
  if (process.stdin.isTTY) return Promise.resolve('')
  return new Promise((resolve, reject) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => (data += chunk))
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', reject)
  })
}
