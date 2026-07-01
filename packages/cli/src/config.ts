// pantry 전역 설정. KB 경로와 활성 plugin 목록(등록순)을 담는다.
// config 파일은 KB 바깥 고정된 자리(사용자 홈)에 산다 — KB 경로 자체를 여기서 정하므로
// KB 안에 있을 수 없고, 재생성 불가능한 1차 입력이라 부산물도 아니다.
//
// 1인 1pantry 단일 설계다. 다른 KB 지정은 PANTRY_CONFIG 환경변수 override로만 연다(디버깅용).

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** 활성 plugin 하나. 이름과 사람이 쓴 한 줄 설명 — pantry엔 둘 다 불투명한 핸들. */
export type PluginEntry = {
  pkg: string
  description: string
}

export type Config = {
  /** .md들이 사는 KB 루트. */
  root: string
  /** 활성 plugin 목록. 등록 순서가 곧 훅 체인 순서다. */
  plugins: PluginEntry[]
}

/** config 파일 경로. PANTRY_CONFIG로 override 가능(디버깅용). 기본은 ~/.config/pantry/config.json. */
export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.PANTRY_CONFIG) return env.PANTRY_CONFIG
  const base = env.XDG_CONFIG_HOME ?? join(homedir(), '.config')
  return join(base, 'pantry', 'config.json')
}

/** KB 루트의 기본값. 명시 전까지 ~/.pantry. */
function defaultRoot(env: NodeJS.ProcessEnv): string {
  return env.PANTRY_ROOT ?? join(homedir(), '.pantry')
}

function empty(env: NodeJS.ProcessEnv): Config {
  return { root: defaultRoot(env), plugins: [] }
}

/** config를 읽는다. 파일이 없으면 기본값(빈 plugin 목록 + 기본 root). */
export async function load(env: NodeJS.ProcessEnv = process.env): Promise<Config> {
  const path = configPath(env)
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (err) {
    if (isNotFound(err)) return empty(env)
    throw err
  }
  const parsed = JSON.parse(text) as Partial<Config>
  // 필드가 빠져 있어도 기본값으로 메워 항상 완전한 Config를 돌려준다.
  return {
    root: parsed.root ?? defaultRoot(env),
    plugins: parsed.plugins ?? [],
  }
}

/** config를 쓴다. 부모 디렉토리를 보장한다. */
export async function save(config: Config, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const path = configPath(env)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT'
}
