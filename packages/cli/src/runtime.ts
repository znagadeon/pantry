// plugin 로더 + 훅 배선. config의 활성 목록을 등록순으로 import해
// 순정 동사에 before/after 훅 체인을 두른 "확장된 pantry"를 만든다.
//
// 불가침: 코어 동작. 훅은 입·출력 파이프라인만 주무른다(before=입력 변형/abort,
// after=출력 보강 또는 부산물). 코어 결과 자체는 못 바꾼다 — 타입이 그걸 강제한다.
//
// plugin이 ctx로 보는 query/read는 훅을 안 두른 생 코어다. 옆 plugin의 훅을 타면
// 등록순 파이프가 그래프로 변질되므로("plugin 간 상호호출 없음"), 여기서 끊는다.

import { join } from 'node:path'

import type {
  CreateInput,
  IngredientFile,
  Pantry,
  Plugin,
  PluginContext,
  QueryHit,
  QueryInput,
} from '@pantrykb/core'
import type { Config, PluginEntry } from './config.js'

/** plugin 패키지를 default export까지 풀어 돌려주는 importer. 테스트가 주입 가능. */
export type Importer = (pkg: string) => Promise<{ default: Plugin }>

const defaultImporter: Importer = (pkg) => import(pkg) as Promise<{ default: Plugin }>

/** 활성 목록을 등록순으로 로드한다. entry와 실제 Plugin 객체를 짝지어 돌려준다. */
export async function loadPlugins(
  entries: PluginEntry[],
  importer: Importer = defaultImporter,
): Promise<{ entry: PluginEntry; plugin: Plugin }[]> {
  const loaded: { entry: PluginEntry; plugin: Plugin }[] = []
  for (const entry of entries) {
    const mod = await importer(entry.pkg)
    if (!mod.default) throw new Error(`plugin ${entry.pkg} has no default export`)
    loaded.push({ entry, plugin: mod.default })
  }
  return loaded
}

/** plugin의 격리 구역 경로. `.pantry/plugins/{name}/` — 부산물은 이 밖에 안 쓴다. */
function pluginDir(root: string, name: string): string {
  return join(root, '.pantry', 'plugins', name)
}

/**
 * plugin이 받는 컨텍스트. query/read는 훅을 안 두른 생 코어 동사다.
 * 이렇게 해야 plugin이 KB를 순정 read-only 동사로만 보고, 옆 plugin 훅과 얽히지 않는다.
 */
function contextFor(pantry: Pantry, root: string, name: string): PluginContext {
  return {
    dir: pluginDir(root, name),
    query: (input: QueryInput) => pantry.query(input),
    read: (id: string) => pantry.read(id),
  }
}

/**
 * 순정 pantry + 로드된 plugin들 → 훅을 두른 동사 묶음.
 * core 동작은 그대로 부르되 앞뒤로 등록순 훅 체인을 끼운다.
 */
export class Runtime {
  // pkg = 설치·dispatch용 npm 이름(plugin run <pkg>). plugin.name = 격리 구역 dir.
  // 둘은 일부러 다를 수 있다(예: pkg @pantrykb/plugin-random, name random) — 섞지 않는다.
  private readonly loaded: { pkg: string; plugin: Plugin; ctx: PluginContext }[]

  constructor(
    private readonly pantry: Pantry,
    private readonly root: string,
    plugins: { entry: PluginEntry; plugin: Plugin }[],
  ) {
    this.loaded = plugins.map(({ entry, plugin }) => ({
      pkg: entry.pkg,
      plugin,
      ctx: contextFor(pantry, root, plugin.name),
    }))
  }

  async create(input: CreateInput): Promise<IngredientFile> {
    // beforeCreate: 등록순 파이프. 앞 훅 출력이 뒤 훅 입력. throw면 abort(시끄럽게).
    let shaped = input
    for (const { plugin, ctx } of this.loaded) {
      if (plugin.hooks?.beforeCreate) shaped = await plugin.hooks.beforeCreate(ctx, shaped)
    }
    const result = await this.pantry.create(shaped)
    // afterCreate: 부산물만(void). 코어 결과는 못 바꾼다.
    for (const { plugin, ctx } of this.loaded) {
      if (plugin.hooks?.afterCreate) await plugin.hooks.afterCreate(ctx, shaped, result)
    }
    return result
  }

  async query(input: QueryInput): Promise<QueryHit[]> {
    // beforeQuery: 검색 text를 등록순 파이프로 shape(쿼리 확장·번역 등)하거나 abort.
    let shaped = input
    for (const { plugin, ctx } of this.loaded) {
      if (plugin.hooks?.beforeQuery) shaped = await plugin.hooks.beforeQuery(ctx, shaped)
    }
    let hits = await this.pantry.query(shaped)
    // afterQuery: 출력 보강. 반환값이 다음 훅 입력(result→result). shape된 input을 넘긴다.
    for (const { plugin, ctx } of this.loaded) {
      if (plugin.hooks?.afterQuery) hits = await plugin.hooks.afterQuery(ctx, shaped, hits)
    }
    return hits
  }

  async read(id: string): Promise<IngredientFile | null> {
    // beforeRead: id를 redirect하거나 abort. 등록순 파이프.
    let target = id
    for (const { plugin, ctx } of this.loaded) {
      if (plugin.hooks?.beforeRead) target = await plugin.hooks.beforeRead(ctx, target)
    }
    let note = await this.pantry.read(target)
    if (note === null) return null // 없는 노트엔 afterRead를 돌리지 않는다(보강할 대상이 없다).
    for (const { plugin, ctx } of this.loaded) {
      if (plugin.hooks?.afterRead) note = await plugin.hooks.afterRead(ctx, target, note)
    }
    return note
  }

  async fix(id: string, body: string): Promise<IngredientFile> {
    // beforeFix: body를 등록순 파이프로 shape하거나 throw로 abort. id는 정체성이라 안 넘긴다.
    // create와 대칭 — beforeCreate가 거는 body 변형이 fix에도 걸려야 plugin invariant가 안 샌다.
    let shaped = body
    for (const { plugin, ctx } of this.loaded) {
      if (plugin.hooks?.beforeFix) shaped = await plugin.hooks.beforeFix(ctx, id, shaped)
    }
    const result = await this.pantry.fix(id, shaped)
    // afterFix: 부산물만(void). 본문-파생 부산물(예: 벡터·hash)을 새 본문으로 갱신한다.
    for (const { plugin, ctx } of this.loaded) {
      if (plugin.hooks?.afterFix) await plugin.hooks.afterFix(ctx, result)
    }
    return result
  }

  async deprecate(id: string): Promise<void> {
    // beforeDeprecate: abort 가드(예: 링크 남은 노트 deprecate 막기) 또는 id redirect. 등록순 파이프.
    let target = id
    for (const { plugin, ctx } of this.loaded) {
      if (plugin.hooks?.beforeDeprecate) target = await plugin.hooks.beforeDeprecate(ctx, target)
    }
    await this.pantry.deprecate(target)
    // afterDeprecate: 부산물 정리(orphan 방지).
    for (const { plugin, ctx } of this.loaded) {
      if (plugin.hooks?.afterDeprecate) await plugin.hooks.afterDeprecate(ctx, target)
    }
  }

  async delete(id: string): Promise<void> {
    // beforeDelete: 주로 abort 가드(예: 링크 남은 노트 삭제 막기). 등록순 파이프.
    let target = id
    for (const { plugin, ctx } of this.loaded) {
      if (plugin.hooks?.beforeDelete) target = await plugin.hooks.beforeDelete(ctx, target)
    }
    await this.pantry.delete(target)
    for (const { plugin, ctx } of this.loaded) {
      if (plugin.hooks?.afterDelete) await plugin.hooks.afterDelete(ctx, target)
    }
  }

  /**
   * plugin이 추가한 명령을 패키지명 아래에 가둬 부른다.
   * top-level 병합이 없으니 "누구의 search가 이기나" 판단이 불필요 — 충돌 발생 불가능.
   */
  async runPluginCommand(pkg: string, name: string, args: string[]): Promise<unknown> {
    // dispatch는 등록 핸들(pkg)로 — PROMPT의 `plugin run <pkg>`가 npm 패키지명을 쓴다.
    const found = this.loaded.find((l) => l.pkg === pkg)
    if (!found) throw new Error(`plugin not active: ${pkg}`)
    const command = found.plugin.commands?.[name]
    if (!command) throw new Error(`plugin ${pkg} has no command: ${name}`)
    return command.run(args, found.ctx)
  }
}

/** config + pantry로 Runtime을 조립한다. 라우터가 부르는 진입점. */
export async function buildRuntime(
  pantry: Pantry,
  config: Config,
  importer: Importer = defaultImporter,
): Promise<Runtime> {
  const plugins = await loadPlugins(config.plugins, importer)
  return new Runtime(pantry, config.root, plugins)
}
