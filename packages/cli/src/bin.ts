#!/usr/bin/env node
// pantry CLI 엔트리. 서브커맨드를 순정 동사로 라우팅한다.
// plugin 관련(add/remove/list/run)은 config·로더가 붙는 후속 커밋에서 채운다.

import { run } from './router.js'

run(process.argv.slice(2)).catch((err: unknown) => {
  // AI가 소비자라 실패는 시끄럽게. 사유를 stderr로 돌려준다.
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
})
