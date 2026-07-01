// 순정 동사. 코어 동작은 멍청하다 — 시키면 .md를 쓰고/읽고/플래그를 찍을 뿐,
// 무엇을 deprecate할지·중복인지는 판단하지 않는다(판단은 소비자 몫).
//
// 아직 골격이다. 파일 I/O·plugin 훅 체인·BM25 랭킹은 후속 커밋에서 채운다.

import type {
  CreateInput,
  IngredientFile,
  QueryHit,
  QueryInput,
} from './types.js'

export type PantryConfig = {
  /** .md들이 사는 KB 루트. config가 KB 밖 고정 자리에서 이 경로를 준다. */
  root: string
}

export class Pantry {
  constructor(private readonly config: PantryConfig) {}

  /** 본문+slug를 받아 .md를 쓴다. createdAt을 찍고, 본문은 들여다보지 않는다. */
  async create(_input: CreateInput): Promise<IngredientFile> {
    throw new Error('not implemented')
  }

  /** full-scan 본문 BM25. 파일명(=id)을 관련도순으로. deprecated 기본 숨김. */
  async query(_input: QueryInput): Promise<QueryHit[]> {
    throw new Error('not implemented')
  }

  /** id로 ingredient 하나를 펼친다. 없으면 null. */
  async read(_id: string): Promise<IngredientFile | null> {
    throw new Error('not implemented')
  }

  /** 오타 교정. 의미 보존, 물리적 덮어쓰기 허용. */
  async fix(_id: string, _body: string): Promise<IngredientFile> {
    throw new Error('not implemented')
  }

  /** deprecatedAt을 찍는다. 본문엔 손대지 않는다. */
  async deprecate(_id: string): Promise<void> {
    throw new Error('not implemented')
  }

  /** 물리적 소멸. */
  async delete(_id: string): Promise<void> {
    throw new Error('not implemented')
  }
}
