// 예시 plugin: 노트 하나를 무작위로 꺼낸다(새 명령어 추가).
// plugin 계약을 살아있는 코드로 검증하는 용도 — commands만 쓰고 hooks는 안 건다.
// KB는 ctx.query로만 본다(read-only). 생 fs는 만지지 않는다.

import type { Plugin } from '@pantrykb/core'

const plugin: Plugin = {
  name: 'random',
  commands: {
    random: {
      description: '노트 하나를 무작위로 꺼낸다',
      async run(_args, ctx) {
        // 빈 쿼리로 전체 핸들을 긁어 하나를 고른다.
        // (query가 빈 텍스트를 전체 열거로 다루는 건 코어 몫 — 여기선 계약만 소비.)
        const hits = await ctx.query({ text: '' })
        if (hits.length === 0) return null
        const pick = hits[Math.floor(Math.random() * hits.length)]!
        return ctx.read(pick.id)
      },
    },
  },
}

export default plugin
