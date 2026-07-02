// plugin 계약. plugin은 아래 객체를 default export하는 npm 패키지다.
// 불가침: 명령의 코어 의미(create는 .md 쓰기, query는 lexical). plugin은 파이프라인만 주무른다.

import type { CreateInput, NutFile, QueryHit, QueryInput } from './types.js'

/** 훅·plugin 명령이 받는 컨텍스트. */
export type PluginContext = {
  /** .pantry/plugins/{name}/ — 부산물은 이 밖에 쓰지 않는다. */
  dir: string
  /**
   * KB를 보는 read-only 동사. 생 fs 경로는 주지 않는다 —
   * plugin도 KB를 순정 동사로만 봐서 "코어 불가침"이 실행 경로에서도 지켜진다.
   */
  query: (input: QueryInput) => Promise<QueryHit[]>
  read: (id: string) => Promise<NutFile | null>
}

/** plugin이 `plugin run <pkg> <name>`으로 노출하는 새 명령. */
export type PluginCommand = {
  description: string
  run: (args: string[], ctx: PluginContext) => Promise<unknown> | unknown
}

/**
 * 훅. 6개 동사 전부에 before/after가 대칭으로 있다 — 표면은 균일하게 열어두고,
 * 무엇을 할지는 plugin 작가의 상상에 맡긴다("똑똑함은 위 레이어로 민다"). core는
 * 등록된 체인을 멍청하게 돌릴 뿐이다. redirect든 veto든 관찰이든 plugin의 책임.
 *
 * 진짜 비대칭은 "어느 동사에 before가 있나"가 아니라 before/after의 방향이다:
 * - before: 입력을 shape하거나(input→input, 파이프처럼 앞 출력이 뒤 입력) throw로 abort.
 *   id만 받는 동사(read/deprecate/delete)의 before는 id를 redirect하거나 abort할 수 있다.
 * - after: 출력을 보강(query/read: result→result)하거나 부산물만 만진다
 *   (create/fix/deprecate/delete: →void). void는 코어 결과 불가침을 타입으로 강제한다.
 *
 * 순수 관찰(로깅·감사)은 before/after 어디서든 입력을 그대로 통과시키며 값만 본다.
 */
export type PluginHooks = {
  beforeCreate?: (ctx: PluginContext, input: CreateInput) => CreateInput | Promise<CreateInput>
  /**
   * fix 전 body 변형 또는 abort. id는 정체성(frontmatter 불변)이라 읽기용으로만 주고
   * body(string)만 반환한다. create와 대칭 — beforeCreate가 거는 body 변형이 fix엔 안 걸리면
   * "create된 노트는 변환, fix된 노트는 우회"로 plugin invariant가 노트 생애 안에서 샌다.
   */
  beforeFix?: (ctx: PluginContext, id: string, body: string) => string | Promise<string>
  /** query 전 검색 text 변형(예: 쿼리 확장·번역·동의어) 또는 abort. beforeCreate/Fix와 대칭. */
  beforeQuery?: (ctx: PluginContext, input: QueryInput) => QueryInput | Promise<QueryInput>
  /** read 전 id를 redirect(반환)하거나 abort. */
  beforeRead?: (ctx: PluginContext, id: string) => string | Promise<string>
  /** deprecate 전 abort 가드(예: 링크 남은 노트 deprecate 막기) 또는 id redirect. */
  beforeDeprecate?: (ctx: PluginContext, id: string) => string | Promise<string>
  beforeDelete?: (ctx: PluginContext, id: string) => string | Promise<string>
  afterCreate?: (ctx: PluginContext, input: CreateInput, result: NutFile) => void | Promise<void>
  /**
   * fix 뒤 부산물 갱신(→void, 코어 결과 불가침). result가 새 본문을 지녀 재파생(예: 재임베딩)에
   * 충분하다. 안 갱신하면 본문-파생 부산물(벡터·hash)이 옛 본문에 묶여 content-address가 거짓이 된다.
   */
  afterFix?: (ctx: PluginContext, result: NutFile) => void | Promise<void>
  afterDelete?: (ctx: PluginContext, id: string) => void | Promise<void>
  afterDeprecate?: (ctx: PluginContext, id: string) => void | Promise<void>
  afterQuery?: (ctx: PluginContext, input: QueryInput, hits: QueryHit[]) => QueryHit[] | Promise<QueryHit[]>
  afterRead?: (ctx: PluginContext, id: string, note: NutFile) => NutFile | Promise<NutFile>
}

export type Plugin = {
  /** 격리 구역 이름이 된다: .pantry/plugins/{name}/ */
  name: string
  commands?: Record<string, PluginCommand>
  hooks?: PluginHooks
}
