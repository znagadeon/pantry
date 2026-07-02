// 벡터 부산물 I/O. 전부 격리 구역(ctx.dir = .pantry/plugins/semantic/) 안에서만 산다 —
// 이 밖은 쓰지 않는다("순정 디렉토리는 언제나 .md만"). plugin을 끄고 이 구역을 통째로
// 지워도 nut은 멀쩡하다: 벡터는 재생성 가능한 파생 상태다.
//
// 노트당 파일 하나(vec/{id}.json). afterCreate는 하나만 증분으로 쓰고, query는
// 디렉토리를 full-scan 한다 — 인덱스를 안 쌓는 순정 query와 같은 결. ~10만 규모에서
// 감수하는 트레이드오프이고, 답답해지면 그건 이 plugin을 고칠 신호지 순정이 아니다.

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** 저장되는 벡터 레코드. model·hash가 캐시 무효화의 두 축이다. */
export type VecRecord = {
  /** 이 벡터를 만든 모델. 다르면 차원이 안 맞아 코사인을 못 잰다 → 무시. */
  model: string
  /** core bodyHash(본문 content-address). 본문이 바뀌면 달라져 재임베딩 트리거. */
  hash: string
  /** L2 정규화된 임베딩. */
  vector: number[]
}

/** 격리 구역 안 벡터 디렉토리. id → vec/{id}.json. */
function vecDir(dir: string): string {
  return join(dir, 'vec')
}

function vecPath(dir: string, id: string): string {
  return join(vecDir(dir), `${id}.json`)
}

/** 벡터 하나를 격리 구역에 쓴다. 부모 디렉토리를 보장한다. */
export async function writeVec(dir: string, id: string, rec: VecRecord): Promise<void> {
  await mkdir(vecDir(dir), { recursive: true })
  await writeFile(vecPath(dir, id), JSON.stringify(rec), 'utf8')
}

/** 벡터 하나를 읽는다. 없거나 깨졌으면 null(부산물은 언제든 재생성 가능하므로 관대하게). */
export async function readVec(dir: string, id: string): Promise<VecRecord | null> {
  let text: string
  try {
    text = await readFile(vecPath(dir, id), 'utf8')
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
  try {
    return JSON.parse(text) as VecRecord
  } catch {
    return null // 깨진 부산물은 없는 것으로 친다.
  }
}

/** 벡터 하나를 지운다(afterDelete의 orphan 정리). 없으면 조용히 넘어간다. */
export async function deleteVec(dir: string, id: string): Promise<void> {
  await rm(vecPath(dir, id), { force: true })
}

/** 저장된 모든 (id, 벡터). 디렉토리가 없으면 빈 배열. query가 full-scan으로 쓴다. */
export async function readAllVecs(dir: string): Promise<{ id: string; rec: VecRecord }[]> {
  let names: string[]
  try {
    names = await readdir(vecDir(dir))
  } catch (err) {
    if (isNotFound(err)) return []
    throw err
  }
  const jsons = names.filter((n) => n.endsWith('.json'))
  const out: { id: string; rec: VecRecord }[] = []
  for (const name of jsons) {
    const id = name.slice(0, -'.json'.length)
    const rec = await readVec(dir, id)
    if (rec) out.push({ id, rec })
  }
  return out
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT'
}
