// 본문 토큰화. 순수함수, 상태 0.
// PROMPT: 유니코드 정규화 + 소문자 + 문장부호 분리, CJK는 bi-gram.
// 한국어/영어가 섞이므로 문자열 클래스를 나눠 다룬다:
//  - 라틴/숫자 등 "띄어쓰기가 단어 경계"인 스크립트 → 공백·문장부호로 쪼갠 통 토큰
//  - CJK(한중일)처럼 공백 없이 붙는 스크립트 → 인접 2글자 bi-gram
// bi-gram을 쓰는 이유: 한국어는 형태소 분석기 없이 통 토큰을 쪼갤 수 없어,
// "정책적" 같은 활용을 "정책"으로 못 맞춘다. bi-gram이면 "정책"이 부분 겹침으로 걸린다.

// 한 글자씩이 의미 단위인 스크립트 대역: 한글, CJK 통합 한자, 히라가나/가타카나.
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿가-힯]/
// 통 토큰이 되는 문자: 라틴/숫자/기타 문자·결합부호. 나머지(문장부호·공백)는 경계.
const WORD_CHAR_RE = /[\p{L}\p{N}\p{M}]/u

function isCjk(ch: string): boolean {
  return CJK_RE.test(ch)
}

/**
 * 텍스트 → 토큰 배열. 정규화(NFC)·소문자 후,
 * CJK 문자는 bi-gram으로, 그 외 단어 문자는 공백·문장부호 경계의 통 토큰으로.
 * 외자 CJK(경계에 홀로 남은 한 글자)는 uni-gram으로 살린다.
 */
export function tokenize(text: string): string[] {
  const norm = text.normalize('NFC').toLowerCase()
  const tokens: string[] = []

  let latin = '' // 쌓이는 라틴/숫자 통 토큰
  let cjk = '' // 쌓이는 CJK 런(런 끝에서 bi-gram으로 분해)

  const flushLatin = () => {
    if (latin) {
      tokens.push(latin)
      latin = ''
    }
  }
  const flushCjk = () => {
    if (!cjk) return
    if (cjk.length === 1) {
      tokens.push(cjk) // 외자는 uni-gram
    } else {
      for (let i = 0; i < cjk.length - 1; i++) {
        tokens.push(cjk.slice(i, i + 2))
      }
    }
    cjk = ''
  }

  for (const ch of norm) {
    if (isCjk(ch)) {
      flushLatin()
      cjk += ch
    } else if (WORD_CHAR_RE.test(ch)) {
      flushCjk()
      latin += ch
    } else {
      // 문장부호·공백 = 경계
      flushLatin()
      flushCjk()
    }
  }
  flushLatin()
  flushCjk()
  return tokens
}
