// semantic plugin: 벡터 임베딩으로 lexical 검색을 보강한다.
// - afterCreate: 새 노트를 임베딩해 격리 구역에 부산물로 쟁인다.
// - afterQuery: 질의를 임베딩해 의미적 이웃을 찾고, lexical이 놓친 것을 합집합으로 보탠다.
// - afterDelete: orphan 벡터를 정리한다.
//
// 코어 불가침: lexical BM25는 항상 바닥에 깔린다. 이 plugin은 순수 벡터 검색으로
// 대체하지 않는다 — lexical hit은 순서·점수 그대로 두고, 그 뒤에 벡터 전용 후보만
// 덧붙인다(union + lexical floor). "순수 벡터는 포기, lexical은 성역"이 설계다.
//
// fix엔 훅이 없어(순정이 안 열었다) 본문을 고쳐도 벡터는 옛 hash로 남아 살짝 낡을 수
// 있다. 그러나 fix는 "의미보존 오타교정" 계약이라 임베딩이 크게 흔들리지 않으므로
// 이 드리프트는 감수한다. 진짜 내용 변화는 fix가 아니라 새 노트+deprecate로 다뤄진다.

import { bodyHash, type IngredientFile, type Plugin, type QueryHit } from '@pantry/core'
import { cosine, type Embedder, localEmbedder } from './embedder.js'
import { readAllVecs, writeVec, deleteVec, type VecRecord } from './store.js'

// 벡터 이웃을 몇 개까지 후보로 볼지. lexical에 없는 것만 추려 붙이므로
// 실제 추가분은 이보다 적다. 너무 크면 관련 낮은 노트가 꼬리에 붙는다.
const NEIGHBORS = 10
// 이 코사인 미만은 "이웃"으로 안 친다. 정규화 벡터라 [-1,1] 범위.
const MIN_SIMILARITY = 0.75

/** embedder를 주입해 plugin을 만든다. 기본은 로컬 다국어 모델. */
export function createSemanticPlugin(embedder: Embedder = localEmbedder()): Plugin {
  return {
    name: 'semantic',

    hooks: {
      // 새 노트를 임베딩해 격리 구역에 쟁인다. 코어 결과는 못 바꾼다(void).
      async afterCreate(ctx, _input, result: IngredientFile) {
        const [vector] = await embedder.embedDocuments([result.body])
        if (!vector) return
        const rec: VecRecord = { model: embedder.model, hash: bodyHash(result.body), vector }
        await writeVec(ctx.dir, result.id, rec)
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
