// 임베딩 백엔드. plugin은 이 인터페이스만 알고, 실제 구현은 주입받는다 —
// core가 now/newId를 주입받아 결정적으로 남는 것과 같은 패턴. 실사용 기본값은
// 로컬 다국어 모델(오프라인·무키·프라이버시), 테스트는 결정적 fake를 꽂는다.
//
// 검색은 비대칭이다: 저장하는 노트(passage)와 찾는 질의(query)가 다른 역할이라
// e5 계열은 프리픽스로 이 둘을 구분한다. 그 비대칭은 embedder 안에 가두고
// 바깥(store·plugin)엔 노출하지 않는다 — 호출자는 "문서냐 질의냐"만 고른다.

/**
 * 텍스트 → 벡터. document(저장용)와 query(검색용)를 나누는 건 검색 임베딩의
 * 비대칭성 때문. `model`은 부산물에 태그로 박혀, 모델·차원이 바뀌면 옛 벡터를
 * 무효화하는 열쇠가 된다(섞인 차원으로 코사인을 재면 안 되므로).
 */
export type Embedder = {
  /** 부산물에 박히는 모델 식별자. 이게 다르면 저장된 벡터는 못 믿는다. */
  model: string
  /** 노트 본문들 → 벡터들. L2 정규화된 벡터를 돌려준다(코사인=내적). */
  embedDocuments: (texts: string[]) => Promise<number[][]>
  /** 질의 하나 → 벡터. 정규화됨. */
  embedQuery: (text: string) => Promise<number[]>
}

/** 정규화된 두 벡터의 코사인 유사도 = 내적. 차원이 다르면 -1(비교 불가). */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return -1
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!
  return dot
}

// 기본 모델: multilingual-e5-small. 검색 전용 튜닝(비대칭 프리픽스), 한국어 양호,
// 384-dim ~118MB로 가볍다. Transformers.js v3로 오프라인·무키 로컬 추론.
const DEFAULT_MODEL = 'Xenova/multilingual-e5-small'

/**
 * 로컬 embedder. 무거운 파이프라인은 첫 임베딩 때 lazy-load 한다 —
 * plugin이 로드될 때가 아니라 실제로 벡터가 필요할 때만 모델 가중치를 당긴다
 * (query만 하는 세션은 문서 임베딩 파이프라인을 안 깨운다).
 */
export function localEmbedder(model: string = DEFAULT_MODEL): Embedder {
  // any: transformers 파이프라인 타입은 무겁고 여기선 호출 형태만 쓴다.
  let pipe: Promise<(input: string[], opts: unknown) => Promise<{ tolist: () => number[][] }>> | null =
    null

  const load = () => {
    if (!pipe) {
      pipe = import('@huggingface/transformers').then(({ pipeline }) =>
        pipeline('feature-extraction', model),
      ) as never
    }
    return pipe!
  }

  const run = async (texts: string[]): Promise<number[][]> => {
    if (texts.length === 0) return []
    const extractor = await load()
    // mean pooling + L2 정규화 → 코사인이 내적으로 떨어진다.
    const out = await extractor(texts, { pooling: 'mean', normalize: true })
    return out.tolist()
  }

  return {
    model,
    // e5 비대칭 프리픽스. 저장은 passage, 검색은 query.
    embedDocuments: (texts) => run(texts.map((t) => `passage: ${t}`)),
    embedQuery: async (text) => (await run([`query: ${text}`]))[0]!,
  }
}
