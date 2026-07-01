// pantry의 데이터 계약. 순정이 아는 유일한 형태는 .md 파일과 그 frontmatter다.

/** ingredient의 frontmatter. 상태만 담는다 — 내용은 본문(산문)이 진다. */
export type IngredientFrontmatter = {
  /** 사람이 읽는 라벨이자 파일명 조각. `[a-z0-9-]`만. 검색 매칭 필드가 아니다. */
  slug: string
  /** 정밀 타임스탬프. 불변. */
  createdAt: string
  /** 없으면 유효, 있으면 낡음. 이것만 사후 변한다(진실값 판정이지 내용 변경이 아니다). */
  deprecatedAt?: string
}

/** 디스크에서 읽어들인 ingredient 하나. id = 파일명(확장자 제외). */
export type IngredientFile = {
  /** 파일명(=id). `YYYY-MM-DD-{slug}-{unique_id}`. wikilink 타겟이자 read의 핸들. */
  id: string
  frontmatter: IngredientFrontmatter
  /** frontmatter 아래 마크다운 본문. content-address는 이것만 해싱한다. */
  body: string
}

/** query가 돌려주는 핸들 하나. 본문 전체가 아니라 "어느 노트가 관련 있나"만. */
export type QueryHit = {
  id: string
  /** BM25 관련도 점수. 내림차순 정렬의 기준. */
  score: number
  /** 매칭 근처 본문 스니펫(옵션). 본문 전체는 아니다. */
  snippet?: string
  /** `--hash`일 때만. 본문 SHA-256 content-address. 위성 캐시 무효화용. */
  hash?: string
}

export type CreateInput = {
  /** 마크다운 본문. pantry는 들여다보지 않는다. */
  body: string
  /** 명시적 slug. 본문에서 뽑지 않는다(판단은 소비자 몫). `[a-z0-9-]`만. */
  slug: string
}

export type QueryInput = {
  text: string
  /** 페이지네이션. */
  offset?: number
  limit?: number
  /** true면 deprecated도 노출. 기본 숨김. */
  includeDeprecated?: boolean
  /** true면 각 hit에 본문 content-address(hash)를 붙인다. */
  hash?: boolean
}
