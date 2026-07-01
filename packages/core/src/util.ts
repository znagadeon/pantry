// 결정적 primitive들. 상태 0, 순수함수 — 순정 코어의 성역.

import { createHash } from 'node:crypto'

const SLUG_RE = /^[a-z0-9-]+$/

/** slug 계약: 소문자 알파벳·숫자·하이픈만. 위반은 시끄럽게 throw. */
export function assertSlug(slug: string): void {
  if (!SLUG_RE.test(slug)) {
    throw new Error(`slug must match [a-z0-9-]: got ${JSON.stringify(slug)}`)
  }
}

/**
 * 본문 content-address. 본문만 해싱한다(frontmatter 제외) —
 * deprecated 플래그가 찍혀도 내용은 안 변하므로 주소를 흔들면 안 된다.
 * SHA-256은 버전 안정(비암호학 해시와 달리) — 위성이 저장·비교하는 계약이라 필수.
 */
export function bodyHash(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex')
}

/**
 * 파일명(=id) 조립. `YYYY-MM-DD-{slug}-{id}`. 확장자는 붙이지 않는다(id는 확장자 제외).
 * date는 호출자가 주입한다(코어는 시계를 직접 읽지 않아 결정적으로 남는다).
 */
export function ingredientId(date: string, slug: string, uniqueId: string): string {
  assertSlug(slug)
  return `${date}-${slug}-${uniqueId}`
}
