# Wayward source modularization plan

## 목표
`Wayward_MOD_v2.107.html`은 현재 약 7.40MB UTF-8의 단일 HTML이며, 실제 실행 코드는 하나의 약 5.36M-character module script에 번들된 상태다.

목표는 원본 게임 동작을 유지하면서 역할별 소스 경계를 만든 뒤, 최종 배포 시 다시 하나의 HTML artifact로 번들할 수 있게 하는 것이다.

## 권장 구조

```
src/
  app/App.tsx
  screens/
    StartScreen.tsx
    CharacterSelect.tsx
    WifeBuilder.tsx
    Onboarding.tsx
    GameScreen.tsx
  game/
    state/
    actions/
    turns/
    rng/
    ids/
  ui/
    header/
    menu/
    modal/
    status/
    map/
    controls/
  mobile/
    MobileSurfaceManager.tsx
    MobileStatusSheet.tsx
    MobileMapSheet.tsx
    mobile.css
  debug/DebugToggle.tsx
  storage/
    save/
    autosave/
    import-export/
  shared/
    image/
    hooks/
    utils/
```

## 원칙

### 게임 엔진과 UI 분리
save/RNG/ID/undo/turn-state는 먼저 재작성하지 않는다. 현재 동작을 기준선으로 고정한 뒤 UI부터 분리한다.

### 모바일은 기존 상태/액션을 재사용
portrait용 화면을 게임 로직과 별개로 복제하지 않는다. status/map/menu 같은 presentation만 모바일 surface로 제공한다.

### 개발은 다중 파일, 배포는 단일 HTML 가능
개발 소스는 여러 파일로 유지하고 빌드 단계에서 React/CSS/JS를 하나의 self-contained HTML artifact로 묶는다.

## 단계
1. 자동 역할 분류 — 현재 번들에서 함수/상태/이벤트를 역할별로 맵핑한다.
2. 모바일 UI 추출 — status/map/menu/debug/header부터 실제 모듈로 이동한다.
3. screen/layout 추출 — `nce -> Ihe -> vle` 경계를 분리한다.
4. 엔진 경계 고정 — save/RNG/ID/undo/turn-state를 보존하며 필요한 경우에만 이동한다.
5. 단일 HTML 번들 — 기존 배포 형태와 호환되는 결과물을 생성하고 검증한다.

## 금지
- 임의 character chunk를 실행 모듈로 사용하지 않는다.
- minified 변수 의존성을 추측해서 분리하지 않는다.
- 모듈 분리와 동시에 save/RNG/ID/undo/turn-state를 재작성하지 않는다.
