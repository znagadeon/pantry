---
name: pantry
description: AI 지식베이스(KB) CLI `pantry`를 부르는 얇은 래퍼. 작업 중 얻은 교훈을 자기완결적 ingredient으로 남기고(capture), 예전 ingredient을 검색해 끌어온다(recall). "이거 KB에 남겨", "KB에서 찾아봐", "관련된 거 검색해줘", "이 교훈 저장해줘", "예전에 비슷한 거 있었나", "/pantry" 등 명시적 호출에만 발동. 자동발동 없음.
---

너는 지금 **pantry CLI를 부르는 손**이다. pantry는 순수 결정적 CRUD 도구일 뿐이고, 똑똑한 판단(무엇을 남길지·무엇이 낡았는지·어떤 어휘로 검색할지·무엇에 링크를 걸지)은 전부 네 몫이다. 이 문서는 그 비결정 규약을 박는다.

## 발동
**명시적 호출에만** 발동한다 — "KB에 남겨" / "KB에서 찾아봐" 류. 무의식 자동발동은 없다. 사용자가 부르지 않았으면 ingredient을 만들지도 검색하지도 않는다.

## CLI 한눈에
`pantry`가 PATH에 깔려 있다고 가정한다(전역 설치). 안 잡히면 설치 안 된 것 — 사용자에게 알리고, 그 전엔 capture/recall을 시도하지 마라.

저장소 경로(loc)는 `pantry config set loc <dir>`로 한 번 박아두면 이후 생략 가능.

```
pantry create "<본문 md>" --slug <slug>   # ingredient 기록. id를 stdout으로 뱉음
pantry query [PATTERN...] [--since <d>] [--until <d>]
             [--include-deprecated] [--hash] [--page <n>] [--size <n>]
pantry read <id>                          # ingredient 통째 읽기
pantry fix <id> "<본문 md>"                # 오타 교정(의미 보존, 덮어쓰기)
pantry deprecate <id>                      # "더는 신뢰 마라" 스탬프(본문 불변)
pantry delete <id>                         # 물리 삭제
```

- **slug는 명시적으로 준다.** pantry는 본문을 들여다보지 않는다 — "이 노트의 핵심이 뭔가"는 네 판단이다. slug는 `[a-z0-9-]`만(소문자·숫자·하이픈). 한국어 개념이면 **영어로 번역**해 준다(음차 아님: "MCP 서버 정책" → `mcp-server-policy`). slug는 파일명·id·wikilink 타겟이라 안전 문자만.
- `query`는 본문 **BM25** 매칭이다(slug는 매칭 필드가 아님). PATTERN 없으면 **핸들**(id + 첫 줄), 있으면 **스니펫**을 관련도순으로 뱉는다. 다중 PATTERN은 OR + 부분점수(많이 겹칠수록 위로). 출력 머리의 페이지 정보로 절단 여부를 읽어라. deprecated는 기본 숨김.
- `read`는 query가 준 **id**만 받는다(path·`.md` 아님).
- `--hash`는 핸들에 본문 content-address(SHA-256)를 붙인다 — **위성 도구**(의미 검색 등)가 KB를 스냅샷해 자기 캐시를 무효화할 때만 쓴다. capture/recall에는 안 쓴다(무시해라).

## capture = query→write (중복 query 필수)
"이거 KB에 남겨"를 받으면 **곧장 create하지 마라.** 먼저 검색해 기존 ingredient과 충돌·중복을 확인한다:

1. **근접 중복/충돌 query.** 남기려는 교훈의 핵심 어휘로 `query`(다중-grep 프로토콜 동원).
2. **틀렸거나 낡은 기존 ingredient이 있으면** → 그걸 `deprecate <id>`로 내리고, 맞는 교훈을 새로 `create`. 새 ingredient 본문에서 옛 것을 `[[옛-파일명]]` wikilink로 가리키며 "저 노트의 이 부분이 틀렸다"고 산문으로 선언한다(대체 이유는 frontmatter가 아니라 본문에 산다).
3. **충돌 없으면** → 그냥 `create`.

이 강제는 시스템의 안티-오염 보장이 "기존 ingredient 존재를 네가 안다"에 통째로 얹혀 있기 때문이다. 건너뛰면 recall이 샌다. (단 lexical grep이라 *재진술된* 중복은 못 잡는다 — 같은 교훈을 다른 어휘로 쓰면 dedup에 안 걸려 중복 ingredient이 생긴다. 수용된 한계.)

## 자기완결적으로 써라 (create 전 본문 다듬기)
ingredient 하나 = 교훈 하나(**atomic** = 함께 낡고 함께 죽을 것들이 한 노트). create 부르기 전에 본문을 이렇게 다듬는다:

- **시점에서 탈색하거나, 날짜를 박아라.** "그때 그 작업에선"을 본문에 욱여넣지 마라. 언제 읽어도 말이 되게 쓰거나, 시점에 따라 변하는 정보면 "2026년 2월 기준"처럼 **날짜를 본문에 박아** 스냅샷으로 남긴다. 스냅샷은 나중에 사실이 바뀌어도 *틀린 게 아니라 과거의 기록*이라 deprecate가 불필요하다.
- **혼자 읽어서 말이 되게.** 쪼개되, 더 쪼개면 자기완결성이 깨지는 지점이 입자의 바닥. 검색해도 안 걸리는 ingredient은 *덜 완결된* ingredient이다(자기완결성 = 검색 리트머스). 다만 미리 완벽히 쪼개지 마라 — 넉넉히 자르고, 문제가 터질 때 쪼갠다.
- **의미 분류 금지.** category/tag/scope를 본문이나 어디에도 박지 마라 — 분류는 검색이 대신한다. 무엇에 관한 ingredient인지는 자기완결적 본문에 자연히 박힌다.
- **wikilink는 항해 표지지 목발이 아니다.** 연관을 발견하면 `[[전체-파일명]]`으로 잇되(slug만이 아니라 `YYYY-MM-DD-slug-id` 전체 — id가 유일성을 진다), 링크를 안 따라가도 ingredient이 혼자 말이 돼야 한다. load-bearing이면 덜 완결된 것.

## 사전이 아니다 (무엇을 넣지 말지)
인터넷에 검색하면 바로 나오는 내용은 저장 대상이 아니다. 내가 겪은 시행착오, 안 적으면 사라지는 정보만 넣는다. pantry는 아카이브도 백과사전도 아니다.

## recall = 다중-grep 프로토콜
"KB에서 관련된 거 찾아봐"를 받으면 query 한 번으로 끝내지 마라. query 한 번은 멍청한 단일 grep이고, **잇는 판단은 네 머릿속에** 있다:

1. **막막하면 bare query 먼저.** PATTERN 없이 `query`로 실재하는 ingredient 핸들을 조망한다 — 동의어를 허공에 추측하는 대신 실재 어휘를 보고 겨눈다.
2. **동의어·EN/KO·다른 각도 어휘로 여러 번 query**해 결과의 합집합을 취한다. 한 작업 경험이 여러 갈래에 걸치므로(예: MCP 삽질기 = MCP 지식이자 인프라/프록시 지식), 한 어휘로는 다 못 건진다.
3. **결과 본문에 딸려온 wikilink를 단서로** 후속 query·read를 판단한다("B도 봐야겠군").
4. 스니펫을 보고 통째로 읽을 것을 골라 `read <id>`. 그 자리에서 판단·종합·(필요시) dish 빚기.

## 교정 vs 보충
- **교정(틀렸다/낡았다)** → 옛 ingredient `deprecate` + 맞는 교훈 새로 `create`(본문에서 옛 것을 wikilink로 가리킴). 본문은 절대 안 고친다(ingredient은 논리적 불변). 오타 같은 의미보존 편집만 `fix`.
- **보충(새 통찰/반론)** → 자기완결적인 *다른* 교훈이면 새 `create`. 검색이 병치하고, 관계는 wikilink로 잇는다.
- 어느 ingredient을 deprecate할지·무엇이 맞는지·무엇에 링크를 걸지 판단은 전부 네 몫이다. 사람(소유자)이 곁에 있고 충돌하는 두 ingredient이 있으면 어느 쪽이 맞는지 물어 verdict을 더 정확히 한다(보너스지 의존 아님).

## 경계 (앱에 넘기지 마라)
dish 합성(query 결과를 잘라 게시글·PPT로 빚기), 관계 판단, 의미 확장 검색, 자기완결성 판정 — 전부 **네가** query→read로 긁어와 그 자리에서 한다. dish는 저장하지 않고 휘발시킨다(유일한 진실은 불변 ingredient뿐). pantry에 그런 서브커맨드는 없고, 앞으로도 없다.
