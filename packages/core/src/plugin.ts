// plugin 계약. plugin은 아래 객체를 default export하는 npm 패키지다.
// 불가침: 명령의 코어 의미(create는 .md 쓰기, query는 lexical). plugin은 파이프라인만 주무른다.

import type { CreateInput, IngredientFile, QueryHit, QueryInput } from './types.js'

/** 훅·plugin 명령이 받는 컨텍스트. */
export type PluginContext = {
  /** .pantry/plugins/{name}/ — 부산물은 이 밖에 쓰지 않는다. */
  dir: string
  /**
   * KB를 보는 read-only 동사. 생 fs 경로는 주지 않는다 —
   * plugin도 KB를 순정 동사로만 봐서 "코어 불가침"이 실행 경로에서도 지켜진다.
   */
  query: (input: QueryInput) => Promise<QueryHit[]>
  read: (id: string) => Promise<IngredientFile | null>
}

/** plugin이 `plugin run <pkg> <name>`으로 노출하는 새 명령. */
export type PluginCommand = {
  description: string
  run: (args: string[], ctx: PluginContext) => Promise<unknown> | unknown
}

/**
 * 훅. before/after의 비대칭이 핵심이다.
 * - before(create/delete만): 입력 변형 또는 throw로 abort. 파이프처럼 앞 출력이 뒤 입력.
 * - after: query/read는 출력 보강(result→result), create/delete/deprecate는 부산물만(→void).
 */
export type PluginHooks = {
  beforeCreate?: (ctx: PluginContext, input: CreateInput) => CreateInput | Promise<CreateInput>
  beforeDelete?: (ctx: PluginContext, id: string) => string | Promise<string>
  afterCreate?: (ctx: PluginContext, input: CreateInput, result: IngredientFile) => void | Promise<void>
  afterDelete?: (ctx: PluginContext, id: string) => void | Promise<void>
  afterDeprecate?: (ctx: PluginContext, id: string) => void | Promise<void>
  afterQuery?: (ctx: PluginContext, input: QueryInput, hits: QueryHit[]) => QueryHit[] | Promise<QueryHit[]>
  afterRead?: (ctx: PluginContext, id: string, note: IngredientFile) => IngredientFile | Promise<IngredientFile>
}

export type Plugin = {
  /** 격리 구역 이름이 된다: .pantry/plugins/{name}/ */
  name: string
  commands?: Record<string, PluginCommand>
  hooks?: PluginHooks
}
