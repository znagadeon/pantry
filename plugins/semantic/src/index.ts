// semantic plugin: 벡터 임베딩으로 lexical 검색을 보강한다.
// - afterCreate: 새 노트를 임베딩해 격리 구역에 부산물로 쟁인다.
// - afterQuery: 질의를 임베딩해 의미적 이웃을 찾고, lexical이 놓친 것을 합집합으로 보탠다.
// - afterDelete: orphan 벡터를 정리한다.
//
// 코어 불가침: lexical BM25는 항상 바닥에 깔린다. 이 plugin은 순수 벡터 검색으로
// 대체하지 않는다 — lexical hit은 순서·점수 그대로 두고, 그 뒤에 벡터 전용 후보만
// 덧붙인다(union + lexical floor). "순수 벡터는 포기, lexical은 성역"이 설계다.
//
// fix(의미보존 덮어쓰기)도 afterFix로 재임베딩한다 — 본문이 바뀌면 벡터·hash가 낡아
// content-address가 거짓이 되므로. semantic이 이 훅을 요구해 코어가 afterFix를 열었다.
// 진짜 내용 변화는 여전히 fix가 아니라 새 노트+deprecate로 다뤄진다.

import { bodyHash, type NutFile, type Plugin, type QueryHit } from '@pantrykb/core'
import { cosine, type Embedder, localEmbedder } from './embedder.js'
import { readAllVecs, readVec, writeVec, deleteVec, type VecRecord } from './store.js'

// 벡터 이웃을 몇 개까지 후보로 볼지. lexical에 없는 것만 추려 붙이므로
// 실제 추가분은 이보다 적다. 너무 크면 관련 낮은 노트가 꼬리에 붙는다.
const NEIGHBORS = 10
// 이 코사인 미만은 "이웃"으로 안 친다. 정규화 벡터라 [-1,1] 범위.
const MIN_SIMILARITY = 0.75

/** 노트 하나를 임베딩해 격리 구역에 벡터 레코드로 쓴다. create·fix가 공유. */
async function embed(embedder: Embedder, dir: string, note: NutFile): Promise<void> {
  const [vector] = await embedder.embedDocuments([note.body])
  if (!vector) return
  const rec: VecRecord = { model: embedder.model, hash: bodyHash(note.body), vector }
  await writeVec(dir, note.id, rec)
}

/**
 * 이 노트가 현재 모델로 이미 임베딩됐나. init 멱등의 판정 축은 (model, hash) 쌍 —
 * afterFix가 hash로 낡음을 재우는 것과 같은 계약이다. model이 다르면(모델 교체) hash가
 * 같아도 재임베딩하고, hash가 다르면(본문 변경) 재임베딩한다. 둘 다 맞을 때만 건너뛴다.
 */
async function isEmbedded(dir: string, id: string, model: string, body: string): Promise<boolean> {
  const rec = await readVec(dir, id)
  return rec !== null && rec.model === model && rec.hash === bodyHash(body)
}

/** embedder를 주입해 plugin을 만든다. 기본은 로컬 다국어 모델. */
export function createSemanticPlugin(embedder: Embedder = localEmbedder()): Plugin {
  return {
    name: 'semantic',

    commands: {
      init: {
        description:
          'KB의 모든 노트를 훑어 아직 벡터가 없는(또는 낡은/다른 모델의) 것만 임베딩한다. 옛 CLI로 만든 노트나 이 plugin을 뒤늦게 켠 KB를 소급 임베딩하는 backfill. 멱등 — 이미 현재 모델로 임베딩된 노트는 건너뛴다.',
        // 순정 query는 전체를 주지 않고 DEFAULT_LIMIT로 자르므로 offset으로 끝까지 페이지네이션한다.
        // deprecated도 포함해 임베딩한다 — afterQuery가 가시성(deprecated 숨김)을 검색 시점에
        // 이미 거르므로, 벡터 자체는 미리 있어도 무해하고 나중에 되살아나도 재임베딩이 불필요하다.
        async run(_args, ctx) {
          const PAGE = 100
          let offset = 0
          let embedded = 0
          let skipped = 0
          let scanned = 0
          for (;;) {
            const hits = await ctx.query({ text: '', includeDeprecated: true, offset, limit: PAGE })
            if (hits.length === 0) break
            for (const hit of hits) {
              scanned++
              const note = await ctx.read(hit.id)
              if (note === null) continue // 열거와 read 사이에 사라진 노트: 건너뛴다.
              if (await isEmbedded(ctx.dir, note.id, embedder.model, note.body)) {
                skipped++
                continue
              }
              await embed(embedder, ctx.dir, note)
              embedded++
            }
            offset += hits.length
          }
          return { model: embedder.model, scanned, embedded, skipped }
        },
      },
    },

    hooks: {
      // 새 노트를 임베딩해 격리 구역에 쟁인다. 코어 결과는 못 바꾼다(void).
      async afterCreate(ctx, _input, result: NutFile) {
        await embed(embedder, ctx.dir, result)
      },

      // fix(의미보존 덮어쓰기) 후 재임베딩 — 낡은 벡터·hash를 새 본문으로 덮는다.
      async afterFix(ctx, result: NutFile) {
        await embed(embedder, ctx.dir, result)
      },

      // orphan 방지: 노트가 사라지면 그 벡터도 지운다.
      async afterDelete(ctx, id) {
        await deleteVec(ctx.dir, id)
      },

      // lexical hits에 의미적 이웃을 합집합으로 보탠다. lexical은 절대 탈락 안 함.
      async afterQuery(ctx, input, hits) {
        // 빈 질의는 전체 열거(random plugin의 계약) — 임베딩할 대상이 없으니 그대로 둔다.
        if (input.text.trim() === '') return hits

        const stored = await readAllVecs(ctx.dir)
        if (stored.length === 0) return hits

        const qvec = await embedder.embedQuery(input.text)

        // 코사인으로 이웃 후보를 뽑는다. 모델(=차원)이 다른 벡터는 못 믿으니 건너뛴다.
        const already = new Set(hits.map((h) => h.id))
        const neighbors = stored
          .filter((s) => s.rec.model === embedder.model && !already.has(s.id))
          .map((s) => ({ id: s.id, sim: cosine(qvec, s.rec.vector) }))
          .filter((n) => n.sim >= MIN_SIMILARITY)
          .sort((a, b) => b.sim - a.sim || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
          .slice(0, NEIGHBORS)

        // 벡터 후보를 실체 검증한다: 삭제됐거나(orphan 벡터) deprecated면 거른다.
        // 순정 query의 가시성 규칙(deprecated 기본 숨김)을 벡터 경로에서도 지킨다.
        const extra: QueryHit[] = []
        for (const n of neighbors) {
          const note = await ctx.read(n.id)
          if (note === null) continue
          if (note.frontmatter.deprecatedAt !== undefined && !input.includeDeprecated) continue
          // 점수는 코사인 — BM25와 스케일이 다르다. 그래서 순서를 섞지 않고
          // lexical hits 뒤에 붙이기만 한다(비교 가능한 척하지 않는다).
          const hit: QueryHit = { id: n.id, score: n.sim }
          if (input.hash) hit.hash = bodyHash(note.body)
          extra.push(hit)
        }

        return [...hits, ...extra]
      },
    },
  }
}

// 기본 export: 로컬 embedder를 문 plugin. plugin 로더가 default를 집는다.
export default createSemanticPlugin()
