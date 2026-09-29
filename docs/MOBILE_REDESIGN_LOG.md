# Wayward 모바일 리디자인 작업 로그

## 2026-09-30 — 작업 시작
- 대상 저장소: `diethoon/wayward`
- 기준 브랜치: `main`
- 기준 source blob SHA: `343c1b01668008a9c9a9be895bc48b5c23c19d7e`
- 기준 파일: `Wayward_MOD_v2.107.html`
- 확인된 원본 규모: 약 5.63M chars / 7.40MB UTF-8 / 6,808 lines
- 문제의 핵심: 단일 line이 약 2.47M chars라 단순 line-split 분석은 실패할 수 있음
- 해결: 기존 `.github/workflows/main.yml`의 분석 분할을 80,000-character 고정 분할 방식으로 운용
- 분석 산출물: `analysis_parts/`
- 안전 원칙: UI만 수정하고 save/RNG/ID/undo/turn-state 로직은 건드리지 않음

### 사용자 확인 요구사항
1. 모바일 터치로 레이아웃 drag/resize가 오작동하지 않을 것
2. portrait에서도 character portrait → detailed status가 열릴 것
3. portrait에서도 location movement map이 열릴 것
4. `Wayward MOD v2.107` debug toggle이 본문을 가리지 않을 것
5. 추가적인 모바일 불편도 분석 단계에서 찾아 함께 개선할 것
6. 구문 오류를 절대 허용하지 않을 것
7. 향후 원본 HTML 업데이트 시 동일 작업을 반복할 수 있도록 작업 방법/내용을 문서화할 것

## 2026-09-30 — Phase 1 분석/워크플로 강화
- `main`의 workflow에 compact mobile patch context 추출 단계를 추가했다.
- 작업 브랜치 `mobile-redesign-v1`에서도 동일 분석 workflow가 실행되도록 branch trigger를 확장했다.
- 같은 브랜치의 workflow가 겹쳐 source/analysis push가 경합하지 않도록 concurrency를 추가했다.
- 자동 patch 단계는 정확한 기존 `#wc2-toggle` CSS target이 없으면 즉시 실패하도록 guard를 둔다.
- patch는 idempotent marker `data-mobile-redesign="v1-debug-toggle"`를 사용한다.
- patch 후 inline script 1개를 임시 JS로 추출해 `node --check`로 검증한다.

### 1차 모바일 수정
작업 브랜치 `mobile-redesign-v1`에서 다음만 수정했다.
- 모바일 breakpoint `max-width:1023px`에서 `#wc2-toggle`을 우측 safe-area 기준으로 이동
- 기본 opacity `0.28`, scale `0.82`
- 일반 컨텐츠보다 낮은 z-index를 사용해 본문/메뉴를 가릴 가능성을 줄임
- active/focus 시 opacity `0.92`, scale `1`로 피드백 제공
- 게임 상태, 저장, RNG, ID, undo, 턴 처리 코드는 변경하지 않음

### 검증
- GitHub Actions run `36617553179`: success
- `PHASE1_PATCH=applied`
- `INLINE_SCRIPTS=1`
- `SYNTAX_CHECK=PASS`
- workflow가 수정된 HTML까지 포함해 commit/push 성공
- 작업 브랜치 head는 새 커밋으로 갱신됨

### 작업 중 발생한 실패와 수정
- 최초 Phase 1 실행에서는 `git add analysis_parts/`만 수행해 HTML 변경분이 stage되지 않았고 push가 rejected 됐다.
- 원인을 확인한 뒤 HTML과 analysis를 함께 stage하도록 수정하고, remote fetch/rebase 후 push하도록 workflow를 보강했다.
- 이후 재실행은 성공했다.

## 다음 단계
- drag/resize 실제 핸들 컴포넌트와 portrait status/map의 실제 interaction owner를 추가로 좁힌다.
- 이후 각 항목을 한 단계씩 수정하고 매 단계마다 syntax/diff 검증한다.

### Phase 1 추가 검증 — 모바일 pane touch guard
- 작업 브랜치: `mobile-redesign-v1`
- pane manager의 두 pointer-down 지점을 정확히 1회씩 찾은 뒤 모바일 breakpoint(`max-width:1023px`)에서는 handler를 즉시 반환하도록 guard를 적용했다.
- 데스크톱에서는 기존 handler가 그대로 실행된다.
- guard marker: `mobile-redesign-v1-pane-touch-guard`
- 이미 적용된 source에서는 patch를 다시 삽입하지 않는 idempotent 방식으로 workflow를 수정했다.
- GitHub Actions run `36618168741`: success
- inline script syntax check: PASS
- `git diff --check`: PASS
- 저장/RNG/ID/undo/턴 처리 코드는 수정하지 않았다.

### Phase 1 현재 상태
- `mobile-redesign-v1`에서 debug toggle 및 pane touch guard가 원격 source에 반영된 상태.
- 다음은 `Pie`의 portrait/status interaction owner와 이동 지도 owner를 별도 compact context로 추출한 뒤 portrait surface를 구현한다.

### 2026-09-30 — 역할별 소스 분리 기반 추가
- 확인: 현재 실행 코드는 하나의 약 5.36M-character module script에 번들되어 있다.
- 단순 character-split을 실행 모듈로 사용하는 방식은 채택하지 않는다.
- 역할별 목표 경계를 `src/app`, `src/screens`, `src/game`, `src/ui`, `src/mobile`, `src/debug`, `src/storage`, `src/shared`로 정의했다.
- `docs/SOURCE_MODULARIZATION_PLAN.md` 추가.
- `src/README.md`를 작업 브랜치 `mobile-redesign-v1`에 추가.
- 원본을 수정하지 않고 semantic owner를 자동 분류하는 `tools/build_role_map.py` 및 `.github/workflows/role-map.yml`을 추가했다.
- 현재 확인된 모바일 owner: status = `Pie -> R3`, movement/action surface = `jre` 계열.
- 다음 실제 추출 순서는 status/map/debug/header 등 UI 경계가 명확한 부분부터 진행한다.
