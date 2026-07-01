// 본문 랭킹. 순수함수 — 코퍼스와 쿼리 토큰을 받아 점수를 낸다.
// full-scan이 전제라(스케일 ~10만) 인덱스 없이 매 query마다 코퍼스를 훑어 IDF를 센다.
// 부산물을 안 남기는 게 순정의 선택이므로 lexical BM25가 "부산물 없이 답할 최대치".
//
// 다중 쿼리 단어는 OR + 부분점수: 매칭된 단어들의 BM25 기여를 합산하므로
// 많이 겹칠수록 자연히 위로 간다(모든 단어를 요구하는 AND가 아니다).

// 표준 BM25 계수. k1=본문 내 빈도 포화, b=문서 길이 정규화 강도.
const K1 = 1.5
const B = 0.75

export type Scorable = {
  id: string
  /** 이미 tokenize된 본문 토큰. 호출자가 tokenize()로 만든다. */
  tokens: string[]
}

export type Scored = {
  id: string
  score: number
}

/**
 * 코퍼스를 쿼리 토큰으로 채점해 score>0인 문서만 내림차순 반환.
 * 동점은 id로 안정 정렬(결정적 출력 — 순정은 놀라운 짓을 하지 않는다).
 */
export function bm25(corpus: Scorable[], queryTokens: string[]): Scored[] {
  const N = corpus.length
  if (N === 0 || queryTokens.length === 0) return []

  // 문서별 term frequency와 길이를 한 번의 패스로 만든다.
  const tfs: Map<string, number>[] = []
  let totalLen = 0
  for (const doc of corpus) {
    const tf = new Map<string, number>()
    for (const t of doc.tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
    tfs.push(tf)
    totalLen += doc.tokens.length
  }
  const avgdl = totalLen / N

  // 쿼리에 등장하는 유니크 단어만 document frequency를 센다.
  const uniqueQ = [...new Set(queryTokens)]
  const df = new Map<string, number>()
  for (const q of uniqueQ) {
    let n = 0
    for (const tf of tfs) if (tf.has(q)) n++
    df.set(q, n)
  }

  const idf = new Map<string, number>()
  for (const q of uniqueQ) {
    const n = df.get(q)!
    // BM25 확률적 IDF. 음수를 막으려 +1(코퍼스 절반 이상에 나오는 흔한 단어 보호).
    idf.set(q, Math.log(1 + (N - n + 0.5) / (n + 0.5)))
  }

  const scored: Scored[] = []
  for (let i = 0; i < N; i++) {
    const tf = tfs[i]!
    const dl = corpus[i]!.tokens.length
    let score = 0
    for (const q of uniqueQ) {
      const f = tf.get(q)
      if (!f) continue
      const denom = f + K1 * (1 - B + (B * dl) / avgdl)
      score += idf.get(q)! * ((f * (K1 + 1)) / denom)
    }
    if (score > 0) scored.push({ id: corpus[i]!.id, score })
  }

  scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return scored
}
