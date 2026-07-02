// 순정 동사. 코어 동작은 멍청하다 — 시키면 .md를 쓰고/읽고/플래그를 찍을 뿐,
// 무엇을 deprecate할지·중복인지는 판단하지 않는다(판단은 소비자 몫).
//
// 순정이 존재하는 전부는 KB 디렉토리 하나와 그 안의 .md들이다. 인덱스·캐시는 없다 —
// query는 매번 full-scan lexical(부산물 없이 답할 최대치). 시계와 id 생성기는
// 주입받아 코어를 결정적으로 유지한다(테스트가 시점·id를 고정할 수 있게).

import { randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { bm25, type Scorable } from './bm25.js'
import { parse, serialize } from './frontmatter.js'
import { tokenize } from './tokenize.js'
import type {
  CreateInput,
  NutFile,
  NutFrontmatter,
  QueryHit,
  QueryInput,
} from './types.js'
import { assertSlug, bodyHash, nutId } from './util.js'

const EXT = '.md'
const DEFAULT_LIMIT = 20
const SNIPPET_RADIUS = 60

export type PantryConfig = {
  /** .md들이 사는 KB 루트. config가 KB 밖 고정 자리에서 이 경로를 준다. */
  root: string
  /**
   * 현재 시각. 주입 가능 — 코어가 시계를 직접 읽지 않아 결정적으로 남는다.
   * createdAt/deprecatedAt 타임스탬프와 파일명 날짜 조각의 유일한 출처.
   */
  now?: () => Date
  /** unique_id 생성기. 파일명 충돌을 막는 짧은 랜덤 꼬리. 주입 가능(테스트 고정용). */
  newId?: () => string
}

/** 기본 unique_id: base36 랜덤 8자. [a-z0-9]라 파일시스템·wikilink 타겟에 안전. */
function defaultNewId(): string {
  // 8 base36 chars ≈ 41 bits. ~10만 노트 규모에서 충돌 확률 무시 가능.
  return [...randomBytes(8)].map((b) => (b % 36).toString(36)).join('')
}

export class Pantry {
  private readonly root: string
  private readonly now: () => Date
  private readonly newId: () => string

  constructor(config: PantryConfig) {
    this.root = config.root
    this.now = config.now ?? (() => new Date())
    this.newId = config.newId ?? defaultNewId
  }

  /** 본문+slug를 받아 .md를 쓴다. createdAt을 찍고, 본문은 들여다보지 않는다. */
  async create(input: CreateInput): Promise<NutFile> {
    assertSlug(input.slug)
    const now = this.now()
    const createdAt = now.toISOString()
    const date = createdAt.slice(0, 10) // YYYY-MM-DD
    const id = nutId(date, input.slug, this.newId())

    const frontmatter: NutFrontmatter = { slug: input.slug, createdAt }
    const file: NutFile = { id, frontmatter, body: input.body }

    await mkdir(this.root, { recursive: true })
    // wx: 이미 있으면 실패 — id 충돌을 조용히 덮어쓰지 않는다(불변 계약).
    await writeFile(this.pathOf(id), serialize(frontmatter, input.body), { flag: 'wx' })
    return file
  }

  /** full-scan 본문 BM25. 파일명(=id)을 관련도순으로. deprecated 기본 숨김. */
  async query(input: QueryInput): Promise<QueryHit[]> {
    const files = await this.readAll()
    const visible = input.includeDeprecated
      ? files
      : files.filter((f) => f.frontmatter.deprecatedAt === undefined)

    const queryTokens = tokenize(input.text)
    const offset = input.offset ?? 0
    const limit = input.limit ?? DEFAULT_LIMIT

    // 빈 쿼리는 전체 열거(id 사전순). random plugin이 이 계약에 기댄다.
    let ranked: { id: string; score: number }[]
    if (queryTokens.length === 0) {
      ranked = [...visible]
        .map((f) => ({ id: f.id, score: 0 }))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    } else {
      const corpus: Scorable[] = visible.map((f) => ({ id: f.id, tokens: tokenize(f.body) }))
      ranked = bm25(corpus, queryTokens)
    }

    const byId = new Map(visible.map((f) => [f.id, f]))
    const page = ranked.slice(offset, offset + limit)
    return page.map(({ id, score }): QueryHit => {
      const file = byId.get(id)!
      const hit: QueryHit = { id, score }
      const snippet = snippetOf(file.body, queryTokens)
      if (snippet !== undefined) hit.snippet = snippet
      if (input.hash) hit.hash = bodyHash(file.body)
      return hit
    })
  }

  /** id로 nut 하나를 펼친다. 없으면 null. */
  async read(id: string): Promise<NutFile | null> {
    let text: string
    try {
      text = await readFile(this.pathOf(id), 'utf8')
    } catch (err) {
      if (isNotFound(err)) return null
      throw err
    }
    return parse(id, text)
  }

  /** 오타 교정. 의미 보존, 물리적 덮어쓰기 허용. frontmatter는 그대로 둔다. */
  async fix(id: string, body: string): Promise<NutFile> {
    const existing = await this.read(id)
    if (existing === null) throw new Error(`no such note: ${id}`)
    await writeFile(this.pathOf(id), serialize(existing.frontmatter, body), 'utf8')
    return { ...existing, body }
  }

  /** deprecatedAt을 찍는다. 본문엔 손대지 않는다. */
  async deprecate(id: string): Promise<void> {
    const existing = await this.read(id)
    if (existing === null) throw new Error(`no such note: ${id}`)
    if (existing.frontmatter.deprecatedAt !== undefined) return // 멱등
    const frontmatter: NutFrontmatter = {
      ...existing.frontmatter,
      deprecatedAt: this.now().toISOString(),
    }
    await writeFile(this.pathOf(id), serialize(frontmatter, existing.body), 'utf8')
  }

  /** 물리적 소멸. 없으면 조용히 넘어간다(delete는 멱등). */
  async delete(id: string): Promise<void> {
    try {
      await unlink(this.pathOf(id))
    } catch (err) {
      if (isNotFound(err)) return
      throw err
    }
  }

  private pathOf(id: string): string {
    return join(this.root, id + EXT)
  }

  /** KB 루트의 모든 .md를 파싱해 돌려준다. 루트가 없으면 빈 배열. */
  private async readAll(): Promise<NutFile[]> {
    let names: string[]
    try {
      names = await readdir(this.root)
    } catch (err) {
      if (isNotFound(err)) return []
      throw err
    }
    const mds = names.filter((n) => n.endsWith(EXT))
    const files = await Promise.all(
      mds.map(async (name) => {
        const id = name.slice(0, -EXT.length)
        const text = await readFile(join(this.root, name), 'utf8')
        return parse(id, text)
      }),
    )
    return files
  }
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT'
}

/**
 * 매칭 근처 본문 스니펫. 첫 쿼리 토큰이 본문에 나타나는 지점 주변을 잘라 준다.
 * 순정의 스니펫은 "어디가 걸렸나"를 힌트로 줄 뿐 본문 전체가 아니다 — 전체는 read의 몫.
 */
function snippetOf(body: string, queryTokens: string[]): string | undefined {
  if (queryTokens.length === 0) return undefined
  const hay = body.normalize('NFC').toLowerCase()
  let at = -1
  for (const t of queryTokens) {
    const idx = hay.indexOf(t)
    if (idx !== -1 && (at === -1 || idx < at)) at = idx
  }
  if (at === -1) return undefined
  const start = Math.max(0, at - SNIPPET_RADIUS)
  const end = Math.min(body.length, at + SNIPPET_RADIUS)
  // 공백을 접어 한 줄 스니펫으로. 잘린 양끝엔 생략 표시.
  const core = body.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${core}${end < body.length ? '…' : ''}`
}
