// .md의 앞머리 frontmatter 코덱. yaml 의존성을 두지 않는다 —
// 순정이 아는 필드는 셋뿐이고(slug/createdAt/deprecatedAt) 값은 전부 안전한
// 스칼라(slug=[a-z0-9-], 타임스탬프=ISN)라 인용·중첩·리스트가 필요 없다.
// "앱이 죽어도 데이터는 산다": 사람이 열고 grep이 훑을 최소 텍스트 형태를 고른다.

import type { NutFile, NutFrontmatter } from './types.js'

const FENCE = '---'

/**
 * frontmatter + 본문 → .md 파일 텍스트. 키 순서는 상태의 안정성을 위해 고정.
 * 본문은 손대지 않고 그대로 쓴다(개행 보정 없음) — parse와 정확히 왕복해야
 * content-address(bodyHash)가 create의 인메모리 본문과 read의 디스크 본문 사이에서
 * 흔들리지 않는다. 왕복 안정성이 POSIX 개행 관례보다 우선한다.
 */
export function serialize(fm: NutFrontmatter, body: string): string {
  const lines = [`slug: ${fm.slug}`, `createdAt: ${fm.createdAt}`]
  if (fm.deprecatedAt !== undefined) lines.push(`deprecatedAt: ${fm.deprecatedAt}`)
  return `${FENCE}\n${lines.join('\n')}\n${FENCE}\n${body}`
}

/**
 * .md 파일 텍스트 → { frontmatter, body }. id는 호출자가 파일명에서 준다.
 * frontmatter 블록이 없거나 slug/createdAt이 없으면 시끄럽게 throw —
 * 순정 디렉토리엔 순정이 쓴 .md만 있다는 계약을 깨는 파일이면 알아야 한다.
 */
export function parse(id: string, text: string): NutFile {
  const lines = text.split('\n')
  if (lines[0]?.trim() !== FENCE) {
    throw new Error(`missing frontmatter fence in ${id}`)
  }
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === FENCE) {
      end = i
      break
    }
  }
  if (end === -1) throw new Error(`unterminated frontmatter in ${id}`)

  const fm: Partial<NutFrontmatter> = {}
  for (let i = 1; i < end; i++) {
    const line = lines[i]!
    if (line.trim() === '') continue
    const sep = line.indexOf(':')
    if (sep === -1) throw new Error(`malformed frontmatter line in ${id}: ${JSON.stringify(line)}`)
    const key = line.slice(0, sep).trim()
    const value = line.slice(sep + 1).trim()
    if (key === 'slug') fm.slug = value
    else if (key === 'createdAt') fm.createdAt = value
    else if (key === 'deprecatedAt') fm.deprecatedAt = value
    // 모르는 키는 조용히 무시 — 순정 계약 밖 필드가 섞여도 셋만 읽는다.
  }
  if (fm.slug === undefined) throw new Error(`frontmatter missing slug in ${id}`)
  if (fm.createdAt === undefined) throw new Error(`frontmatter missing createdAt in ${id}`)

  // 닫는 fence 다음 줄부터가 본문. serialize가 fence 뒤에 개행 하나를 두므로 end+1.
  const body = lines.slice(end + 1).join('\n')
  return {
    id,
    frontmatter: fm as NutFrontmatter,
    body,
  }
}
