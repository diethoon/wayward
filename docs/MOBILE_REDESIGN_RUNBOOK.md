# Wayward 모바일 리디자인 재현용 런북

## 목적
`Wayward_MOD_v2.107.html`처럼 수 MB 규모의 단일 HTML/React 번들을 대상으로, 원본 게임 로직을 보존하면서 모바일 UI만 반복적으로 개선하기 위한 재현 절차를 고정한다.

## 원칙
1. `main`의 원본 게임 파일은 작업 중 직접 덮어쓰지 않는다. 모바일 수정은 별도 작업 브랜치에서 수행한다.
2. 저장/불러오기, RNG, ID, 턴 처리, undo, 이벤트 판정 등 게임 엔진과 상태 경계를 변경하지 않는다.
3. UI 변경은 가능한 한 상단 UI 라우터(`nce`), 메인 화면(`Ihe`), 메인 본문(`vle`) 및 모바일 전용 CSS/보조 UI에 한정한다.
4. 수 MB 원본을 줄 단위로 자르지 않는다. 한 줄이 수백만 문자인 번들이므로, 분석용 파트는 **고정 문자 수**로 자른다.
5. 모든 변경 후 JavaScript 문법 검사를 수행한다. 특히 inline script를 임시 JS 파일로 추출해 `node --check`를 통과시킨 뒤 커밋한다.
6. 변경 범위를 diff로 확인해 게임 저장/런타임 로직이 의도치 않게 변하지 않았는지 검증한다.

## 현재 기준 원본
- repository: `diethoon/wayward`
- branch: `main`
- source: `Wayward_MOD_v2.107.html`
- source blob SHA: `343c1b01668008a9c9a9be895bc48b5c23c19d7e`
- 당시 크기: 약 5.63M characters / 7.40MB UTF-8 / 6,808 lines
- 최대 단일 line: 약 2.47M characters

## 분석 파이프라인
현재 `.github/workflows/main.yml`은 다음을 수행한다.
1. 원본 전체를 읽고 SHA-256/문자 수/byte 수/line 수를 기록한다.
2. 80,000 characters 단위로 `analysis_parts/Wayward_MOD_v2.107.partNNN.txt`를 생성한다.
3. `MANIFEST.json`, `STATIC_REPORT.md`, `UI_COMPONENT_INDEX.md`, `UI_SNIPPETS.md`, CSS/HTML 분석 자료를 생성한다.
4. `nce/Ihe/vle/zse/The/She/whe` 및 관련 runtime/mobile interaction을 별도 target context로 추출한다.
5. compact patch context를 생성해 실제 패치 시 대용량 원문 조회를 피한다.
6. 결과를 저장소에 커밋한다.

## 브랜치 실행/안전 장치
- push 대상에는 `main`과 `mobile-redesign-v1`을 사용한다.
- workflow concurrency로 같은 ref의 중복 실행을 직렬화한다.
- 모바일 patch 단계는 `mobile-redesign-v1`에서만 실행된다.
- patch는 정확한 기존 target 문자열이 없어지면 `PATCH_GUARD_FAILED`로 중단한다.
- patch marker가 이미 존재하면 다시 삽입하지 않는다.
- source와 analysis를 함께 stage하고 remote를 fetch/rebase한 뒤 push한다.
- 이렇게 하면 향후 원본 HTML이 갱신돼도 무조건 덮어쓰지 않고 target이 바뀌었을 때 실패시켜 수동 검토하게 할 수 있다.

## 모바일 문제/설계 요구사항
- 터치 오작동으로 데스크톱용 column drag/resize가 발생하지 않게 한다.
- 캐릭터 portrait/status 상세가 세로 화면에서도 반드시 접근 가능해야 한다.
- location movement map을 portrait에서도 별도 full-screen surface로 열 수 있게 한다.
- 좌하단 `Wayward MOD v2.107` 디버그 버튼이 게임 내용을 가리지 않도록 한다. 기본값은 낮은 불투명도 + 필요시 드러나는 방식으로 하고, 이동 가능성도 고려한다.
- 현재 화면의 핵심 정보 우선순위를 높여 portrait에서 과밀해지지 않게 한다.
- 스크롤 주체를 명확하게 하고 nested scroll/pointer 충돌을 줄인다.
- 작은 모바일 터치 타깃과 인접한 아이콘으로 인한 오입력을 줄인다.
- 세로↔가로 회전 후에도 현재 컨텍스트와 열려 있던 surface가 가능한 한 유지되도록 한다.
- 키보드가 입력창/확인 버튼을 가리지 않도록 한다.
- modal/drawer/map/status 등 모바일 surface 동작을 일관되게 만든다.
- safe-area/notch 영역을 존중한다.

## 작업 순서
### Phase 0 — 기준선
- `main`의 source SHA를 기록한다.
- 작업 브랜치를 만든다.
- 저장/undo/RNG/ID 관련 함수의 변경 금지를 선언한다.

### Phase 1 — 구조 분석
- `nce` → `Ihe` → `vle` 및 header/menu/map/status 관련 컴포넌트를 식별한다.
- drag/resize pointer 이벤트와 모바일 breakpoint를 식별한다.
- 기존 `desk:*`, safe-area, 100dvh, overflow 규칙을 확인한다.

### Phase 2 — 모바일 레이아웃
- portrait를 기본 최적화 대상으로 삼고 landscape는 정보 밀도만 조정한다.
- 데스크톱 column layout을 모바일에서 비활성화한다.
- 모바일에는 고정된 핵심 정보/상단 헤더/필요 surface 접근 경로를 둔다.

### Phase 3 — surface
- status detail: portrait bottom-sheet/full-screen fallback
- movement map: portrait full-screen map surface
- menu: 기존 drawer를 재사용하되 viewport/safe-area 기준으로 정돈
- debug toggle: content-safe 위치/opacity

### Phase 4 — 검증
1. HTML 구조 점검
2. inline script 추출 후 `node --check`
3. 원본 대비 변경 범위 비교
4. GitHub Actions 성공 여부 확인
5. 가능하면 실제 브라우저 smoke test
6. 로그에 변경 파일/커밋/검증 결과 기록

## 새 버전 HTML이 들어왔을 때
1. 새 HTML을 `main`에 반영하면 `main.yml`이 자동으로 재분석한다.
2. 분석 manifest의 SHA-256과 크기를 새 기준선으로 기록한다.
3. 동일한 모바일 리디자인 브랜치에서 무조건 기존 patch를 재적용하지 말고, **target function/context가 여전히 존재하는지 먼저 검증**한다.
4. target context가 바뀌었으면 patch를 실패시키고 수동 검토 상태로 남긴다.
5. 성공한 경우에만 UI patch → syntax check → diff guard 순으로 진행한다.
