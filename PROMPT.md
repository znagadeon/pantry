# pantry

AI를 위한 개인용 knowledge base. Zettelkasten의 규율을 마크다운 더미 위에 씌운 얇은 CLI.
소비자는 AI다. 사람은 거의 보지 않는다. 노트끼리의 연결은 AI가 건다.

## 용어

- **ingredient** — pantry에 저장된 노트 하나. 자기완결적·원자적·불변. 개념 설명이 필요할 땐 atom.
- **dish** — query 결과 ingredient들을 바탕으로 AI가 합성한 2차 산출물. **저장하지 않고 휘발**시킨다. 개념 설명이 필요할 땐 projection. 같은 쿼리면 안정적으로 재현되므로 영속시킬 이유가 없다 — "순정은 부산물을 안 남긴다"의 의미론 버전이다. 벡터 캐시를 안 남기는 것과 dish를 안 남기는 것은 같은 원리(재생성 가능한 건 영속하지 않는다)의 데이터/의미 양면. 영속하는 것은 그 아래 불변 ingredient뿐이다.

## 설계 지반

**Unscoped.** 무언가를 *결정*하는 모든 행동은 결정 피로를 유발한다 — 카테고리·태그·스코프를 고르는 것도. pantry는 태그도 카테고리도 스코프도 두지 않는다. 대신 **컨텍스트가 다 담긴 하나의 완결된 문서**를 쓰고, 검색으로 찾는다. 태그의 문제는 두 가지다: (1) 필터가 아니라 검색으로 찾으므로 부차적이고, (2) 작성 시점에 미래의 질의를 예측할 수 없어 그때 필요한 태그를 달아둘 보장이 없다. "js/MCP 서버" 태그를 달았는데 정작 유저가 궁금한 건 그 안의 정책적 결정일 수 있다. deprecate되지 않은 모든 문서가 동일한 weight로 다뤄지고, 여러 스코프에 걸친 문서를 검색 하나로 관통한다. (config가 1인 1pantry 단일인 것도 이 따름정리다 — KB를 여러 개 두고 고르게 하면 결정 피로를 되살린다.)

**Linking, not Tagging.** 연관을 발견하면 같은 분류에 넣는 대신 서로를 링크한다. 분류는 미리 친 울타리라 몰랐던 관계를 못 담지만, 링크는 발견한 관계를 그때그때 잇는다.

## 핵심 원칙

- **순정은 부산물을 남기지 않는다.** ingredient가 유일한 진실이다. 인덱스·캐시·벡터 등 재생성 가능한 파생 상태는 순정의 책임이 아니라 plugin의 것이다. 그래서 순정 query는 성능 타협이 아니라 순수성 선택으로서 lexical이다 — 부산물 없이 답할 수 있는 최대치.
- **앱이 죽어도 데이터는 산다.** 순정 pantry가 존재하는 전부는 디렉토리 하나와 그 안의 `.md` 파일들이다. pantry 없이도 사람이 열고, git이 버전관리하고, grep이 훑는다.
- **판단은 AI가, 실행은 멍청하게 pantry가.** 무엇을 deprecate할지, 무엇에 링크를 걸지, 만들려는 게 이미 있는 중복인지 — 판단은 전부 AI(소비자)의 몫이다. pantry는 시키면 한다: create하면 파일을 쓸 뿐 중복인지 따지지 않는다. "create 전에 살펴라" 같은 규율은 pantry의 기능이 아니라 pantry를 쓰는 법이며, 툴이 아니라 skill에 새긴다. 멍청함이 pantry의 계약을 작고 검증 가능하게 유지한다 — pantry는 절대 놀라운 짓을 하지 않고, 똑똑함은 전부 위 레이어(skill·plugin)로 민다.

## ingredient

노트 하나. atomic, 자기완결적, immutable.

- **atomic** = 함께 낡고 함께 죽을 것들이 한 노트다. 앞 문단은 맞는데 뒷 문단만 틀려서 deprecate가 애매해지면, 그건 원래 두 노트였어야 했다는 사후 증거다. 다만 미리 완벽히 쪼개지 말 것 — 평소엔 넉넉히 자르고, "일부만 맞는 deprecate"는 드문 엣지로 감수한다. 문제가 터질 때 쪼갠다.
- **자기완결** = 다른 노트를 안 읽어도 이 노트 하나로 뜻이 선다. 그래서 컨텍스트를 풍부하게 담는다. wikilink는 "없으면 이해 불가"인 목발이 아니라 "더 파고들려면 이쪽"인 항해 표지다. 링크가 끊겨도 노트의 의미는 안 무너진다.
- **immutable** = 논리적 불변이지 물리적 불변이 아니다. 막는 건 "내용을 슬쩍 바꿔 과거를 소급 조작하는 것"이다. 오타 교정 같은 의미보존 편집(fix)은 덮어써도 된다. 참→거짓 같은 진짜 변화는 편집이 아니라 deprecate라는 별도 사건으로 다룬다.

**사전이 아니다.** 인터넷에 검색하면 바로 나오는 내용은 저장 대상이 아니다. 내가 겪은 시행착오, 안 적으면 사라지는 정보만 넣는다. pantry는 아카이브도 백과사전도 아니다. (뭘 넣을지 역시 판단이므로 pantry가 강제하지 않는다 — skill·지침의 몫이다.)

### 물리적 형태

- 파일: 마크다운 `.md`
- 파일명: `YYYY-MM-DD-{slug}-{unique_id}.md` (예: `2026-03-20-how-to-parse-yaml-abcde.md`). 날짜로 정렬되고, slug로 사람이 읽고, id로 안 겹친다. 파일명이 곧 id.
- 링크: `[[wikilink]]` 스타일
- frontmatter: `createdAt` (정밀 타임스탬프), `deprecatedAt` (없으면 유효, 있으면 낡음)

### 대체는 뒤를 가리킨다

낡은 노트에 `supersededBy: →` 같은 frontmatter 필드를 박지 않는다. 대신 **새 노트가 본문에서 `[[옛-노트]]`를 wikilink로 가리키며** "저 옛 노트의 이 부분이 틀렸다"고 산문으로 선언한다. 대체의 *이유*는 구조화된 필드가 아니라 본문 문장으로 산다 — frontmatter는 상태(`createdAt`/`deprecatedAt`)만, 내용은 본문. 낡은 노트는 자기가 뭐로 대체됐는지 모르고, 알 필요도 없다. deprecate 사건이 나도 낡은 노트의 `deprecatedAt`만 찍힐 뿐 본문엔 손대지 않는다. 지식은 앞으로만 흐르고 과거는 봉인된다.

### 날짜 스냅샷으로 deprecate를 피한다

시점에 따라 달라지는 정보는 "2026년 2월 기준"처럼 날짜를 본문에 박아 그 시점의 스냅샷으로 적는다. 이렇게 쓴 노트는 나중에 사실이 바뀌어도 *틀린 게 아니라 과거의 기록*이므로 deprecate할 필요 없이 그대로 불변으로 남는다. deprecate는 "그때도 지금도 참인 줄 알았는데 틀렸다"에 쓰고, 스냅샷 규율은 "애초에 특정 시점의 진술이었다"를 미리 못박아 deprecate 자체를 불필요하게 만든다.

## 기본 명령어

`plugin`을 뺀 나머지는 ingredient에 대응한다.

- **create** — 새 `.md` ingredient 생성. `createdAt` 기록.
- **query** — full-scan lexical 검색. **파일명(=id)만** 관련도순으로, 페이지네이션해서 돌려준다. 본문은 주지 않는다 — "어느 노트가 관련 있나"만 답하고, "그 노트가 뭐라 하나"는 `read`가 답한다. deprecated는 기본 숨김(명시적으로 부를 때만 노출).
- **read** — 파일명(=id)으로 ingredient 하나를 펼친다. query가 준 핸들을 받아 본문을 읽는 짝. 순정 명령으로 두는 이유는 plugin이 훅을 걸 수 있게 하기 위함(예: afterRead에서 관련 노트 추천, deprecated 경고). 순정 동작은 그냥 `.md`를 읽어 돌려주는 것이며, pantry 없이 파일을 직접 읽어도 데이터는 동일하다.
- **fix** — 오타/오기 교정. 의미 보존, 물리적 덮어쓰기 허용.

- **deprecate** — `deprecatedAt`을 찍는 독립 명령. create가 자동으로 옛 노트를 죽이지 않는다. 새 노트 생성과 deprecate는 별개의 명시적 두 행위이며, 판단은 AI가 한다.
- **delete** — 물리적 소멸. (deprecate는 무대 뒤로 물러남, delete는 존재가 사라짐.)

ingredient에 대응하지 않는 메타 명령 둘:

- **config** — pantry 전역 설정을 `get`/`set`하는 key-value. KB 경로와 활성 plugin 목록(등록순)을 저장한다. config 파일은 KB 바깥 고정된 자리(사용자 홈)에 산다 — KB 경로 자체를 여기서 정하므로 KB 안에 있을 수 없고, 재생성 불가능한 1차 입력이라 부산물도 아니다. **1인 1pantry 단일 설계**다(스코프를 고르는 것 자체가 결정 피로이므로 — 위 Unscoped). 다른 KB 지정은 디버깅용 override로만 열어둔다.
- **plugin** — 아래.

## plugin

pantry의 역할을 확장한다. **명령을 추가하거나, 기존 명령을 확장할 수 있다. 대체는 없다.**

- **불가침: 명령의 코어 의미.** create는 언제나 `.md`를 쓰고, query는 언제나 lexical을 한다 — 어떤 plugin을 켜도. plugin은 명령의 입·출력 파이프라인을 주무르되(before는 입력 변형, after는 출력 보강), 코어 동작은 못 건드린다. create의 코어("`.md` 쓰기")와 query의 코어("lexical 매칭")는 성역이다.

### 훅

명령마다 `before` / `after`.

- **before** — 입력을 변형하거나(예: 마크다운 아닌 입력을 마크다운으로 변환) 명령을 abort할 수 있다. abort는 **에러**로 시끄럽게 실패한다(사유와 함께). AI가 소비자라 취소 사실이 반드시 돌아와야 판단한다.
- **after** — 출력을 보강한다. deprecate/delete엔 after로 부산물을 정리한다(orphan 방지).
- **체인** — 여러 훅은 **등록 순서**대로 파이프처럼 엮인다. 앞 plugin의 출력이 뒤 plugin의 입력.

### 인터페이스

TypeScript로 구현한다. plugin은 아래 객체를 default export하는 모듈이다.

```ts
export default {
  name: 'semantic',        // 격리 구역 이름이 된다: .pantry/plugins/semantic/
  commands?: { ... },      // 새 명령어 추가 (예: random)
  hooks?: { ... },         // 기존 명령 확장
}
```

훅은 컨텍스트를 받는다. 부산물은 자기 격리 구역에만 쓴다 — 경로를 손에 쥐여줘 유도한다.

```ts
type PluginContext = {
  dir: string          // .pantry/plugins/{name}/ — 이 밖은 쓰지 않는다
  pantryRoot: string   // .md들이 사는 곳 (읽기용)
}
```

훅 시그니처. **before와 after의 비대칭이 핵심이다.**

```ts
hooks: {
  beforeCreate?: (ctx, input) => input           // 입력 반환(변형) 또는 throw(abort)
  beforeDelete?: (ctx, input) => input           // 주로 abort 가드(예: 링크 남은 노트 삭제 막기)
  afterCreate?:  (ctx, input, result) => void    // 부산물만. 코어 결과는 못 바꿈
  afterDelete?:  (ctx, input) => void            // 자기 부산물 정리
  afterDeprecate?: (ctx, input) => void          // 부산물 정리
  afterQuery?:   (ctx, input, hits) => hits       // 관련도 목록 rerank/합집합 후 반환
  afterRead?:    (ctx, input, note) => note       // 관련 노트·경고 덧붙임
}
```

- **before** — `create`와 `delete`에만. 입력 타입 → 입력 타입이라 파이프처럼 앞 훅 출력이 뒤 훅 입력이 된다. 반환으로 변형, throw로 abort. before를 이 둘로 한정하는 이유: 실제 용례(create의 입력 변형, delete의 abort 가드)가 여기뿐이다. 필요해지면 그때 연다(YAGNI).
- **after의 두 갈래** — query/read처럼 **출력을 보강**하는 훅은 `result → result`(반환값이 다음 훅으로 이어짐). create/delete/deprecate처럼 **부산물만 만지는** 훅은 `→ void`. 후자가 void인 건 코어 결과(파일이 써졌다/지워졌다)를 plugin이 못 바꾸게 하려는 것 — "코어 불가침"을 타입으로 강제한다.
- **plugin 간 상호호출 없음.** 각 plugin은 순정 코어만 본다. 옆 plugin의 명령·훅은 못 부른다. 이게 열리면 등록순 파이프가 그래프로 변질되고 멍청함이 깨진다. 파이프는 한 방향, 한 겹.

### 부산물

plugin의 모든 부산물은 plugin 소유이며, 순정이 정한 격리 구역(`.pantry/plugins/{name}/` 형태)에 산다. 순정 디렉토리는 언제나 `.md`만 남는다. plugin을 끄고 부산물을 지워도 ingredient는 멀쩡하다.

### 후보

- **random** — 노트 하나 무작위로 꺼냄 (새 명령어 추가).
- **semantic** — 벡터 임베딩으로 검색 보강. afterCreate에서 임베딩 생성(부산물), afterQuery에서 lexical 후보를 rerank하거나 벡터 후보를 합집합으로 보탬. lexical 코어는 항상 바닥에 깔린다 — 순수 벡터 검색은 포기한다.

## 스케일

노트 상한은 ~10만(사람이 만들 수 있는 가치 있는 노트의 현실적 한계). 순정은 full-scan을 감수한다. 인덱싱이 필요할 만큼 답답해지면 그건 순정을 고치라는 신호가 아니라 인덱싱 plugin을 켜라는 신호다.

## 열린 질문

- **create 입력 명세** — 무엇을 받나. 마크다운 본문 텍스트만? 제목/slug는 별도 인자인가 본문에서 뽑나. (파일명의 slug를 어디서 얻는지가 여기 걸림.)
- **wikilink 타겟 표기** — `[[slug]]`인가 `[[YYYY-MM-DD-slug-id]]`(전체 파일명)인가. slug는 유일하지 않고, 전체 파일명은 delete 시 깨진다. 대체 링크가 본문 wikilink로 사는 게 정해졌으니 이 표기를 확정해야 한다.
- **plugin `commands` 인터페이스** — 새 명령의 시그니처, 기존 명령명과 충돌 시 처리.
- **관련도 계산법** — lexical이라고만 정함. BM25 / TF-IDF / 단순 매칭 중 무엇인지, 파일명 대 본문 가중치. (구현 디테일이라 후순위.)
- plugin 모듈을 물리적으로 어디에 두고 어떻게 로드하나 (config의 활성 목록이 켬/끔·순서를 정한다는 건 정해짐)
