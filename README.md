# Wayward

## 🚨 절대 작업 지침 — 대용량 원본 직접 조회 금지

> **절대로 `Wayward_MOD_v2.107.html` 원본 5MB+ 파일을 ChatGPT/GitHub API 조회로 통째로 읽거나 대량 컨텍스트로 가져오지 않는다.**

이 저장소의 원본 HTML은 수 MB 규모의 단일 번들이며, 한 줄이 수백만 문자까지 커질 수 있다.

### 반드시 지킬 것

1. **원본 HTML 전체 fetch/read 금지.**
2. 원본 분석이 필요하면 반드시 **GitHub Actions 워크플로가 생성한 `analysis_parts/` 산출물**을 사용한다.
3. 코드 확인이 필요하면 `analysis_parts/mobile_targets/`의 compact context 또는 필요한 함수의 **소량 컨텍스트만** 조회한다.
4. 여러 개의 100KB+ 분석 파일을 한 번에 가져오지 않는다.
5. 필요한 정보가 산출물에 없으면 원본을 직접 읽지 말고 **워크플로를 먼저 수정해 필요한 정보만 추출한다.**
6. 모바일 리디자인은 작업 브랜치에서 수행하고 `main`의 원본 게임 파일은 직접 수정하지 않는다.
7. 변경 후 반드시 JavaScript 문법 검사(`node --check`)와 diff 검사를 통과시킨다.
8. 저장/불러오기, RNG, ID, undo, 턴 처리 등 게임 엔진 로직은 UI 작업에서 건드리지 않는다.
9. 이 지침은 원본 HTML 버전이 업데이트되어도 동일하게 적용한다.

### 대용량 파일 작업 순서

`원본 HTML → GitHub Actions 분석 → 필요한 compact context 생성 → 소량 조회 → 작업 브랜치 패치 → 문법 검사 → diff 검사 → 커밋`

**원본을 직접 통째로 읽는 방식으로 작업하지 않는다.**

자세한 재현 절차는 `docs/MOBILE_REDESIGN_RUNBOOK.md`를 따른다.
