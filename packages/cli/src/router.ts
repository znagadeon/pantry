// argv → 순정 동사 라우팅. 골격이라 파싱·출력 포맷은 최소.

const CORE_VERBS = ['create', 'query', 'read', 'fix', 'deprecate', 'delete'] as const
const META = ['config', 'plugin'] as const

const USAGE = `pantry <command> [args]

ingredient verbs:
  create    새 .md ingredient 생성 (본문 + slug 명시)
  query     본문 BM25 검색 — 관련도순 핸들 (--hash로 content-address)
  read      id로 ingredient 하나 펼침
  fix       오타 교정 (의미 보존)
  deprecate deprecatedAt 찍기
  delete    물리적 소멸

meta:
  config    get/set — KB 경로·활성 plugin 목록
  plugin    add <pkg> <desc> | remove <pkg> | list | run <pkg> <cmd> [args]
`

export async function run(argv: string[]): Promise<void> {
  const [command] = argv

  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(USAGE)
    return
  }

  if ((CORE_VERBS as readonly string[]).includes(command)) {
    throw new Error(`'${command}' not implemented yet (scaffold)`)
  }

  if ((META as readonly string[]).includes(command)) {
    throw new Error(`'${command}' not implemented yet (scaffold)`)
  }

  throw new Error(`unknown command: ${command}\n\n${USAGE}`)
}
