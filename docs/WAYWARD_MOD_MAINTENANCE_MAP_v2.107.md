WAYWARD_MOD_MAINTENANCE_BEGIN
# Wayward MOD v2.107: 다음 제작자가 먼저 읽을 개발 안내와 이식 지도

현재 파일은 v2.106의 화이트 테마를 승인된 펄 그레이로 교체한 v2.107이다. 유일한 WAYWARD_MOD_CURRENT_MAP을 먼저 읽는다. v2.98 manifest, WAYWARD_MOD_MAP_2_101 및 v2.102 추가 설명은 당시 기록이며 현행 수치·동작의 근거로 단독 사용하지 않는다. 사용자 요청은 오래된 인수인계보다 우선하며, 아래 지도와 실행 코드를 함께 대조한다.

이 안내와 이어지는 manifest는 실행하지 않는 HTML 주석이다. 게임을 열어도 표시되지 않는다.
v2.101의 직접 입력은 검수본 v2.100이다. 이번 버전은 개발 안내의 범위·현재 구현 설명을 정정하고 표시 버전만 갱신했다. 게임 진행 코드·수치·저장 형식·성인 장면·한국어 대사는 바꾸지 않았다.
v2.96은 이미지 기능 변경 전 보존본이고 v2.92는 더 이전 게임 내용의 보존 마스터다. 아래 2.97~2.100 단락은 각 버전에서 생긴 기능의 역사적 배경이며, 현재 기능 여부는 이 머리말·현재 저장 구조·2.99/2.100/2.101 지도를 함께 읽어 판단한다.

## 변경 지도의 범위와 읽는 순서

1. 아래 `WAYWARD_MOD_MANIFEST_BEGIN`의 `game_release: 2.98`과 `full_change_map`은 제공 참고 원본 `index(9).html` → **v2.98**의 역사적 스냅샷이다. 함수 236개·변수 41개와 해시, `contracts.inventory_employees_effects_gameplay_implemented: false`는 당시 기준이다. v2.101의 현재 상태나 전체 함수 해시라고 읽지 않는다.
2. manifest 뒤의 2.99 신규 기능 지도와 2.100 QA 수정 지도를 이어 읽는다. v2.101 현재 구현·저장 구조·검산값은 맨 끝의 2.101 지도를 따른다. 기존 feature_groups는 2.98까지의 목적·원본 연결부·이식 점검 위치를 제공한다.
3. 정적 AST 비교에서 제공 원본 → v2.101은 최상위 함수 추가 120·변경 147, 변수 추가 24·변경 25, 삭제 0이다. 이 숫자는 구조 탐색 자료이며 새 원작 호환이나 기능 의미를 증명하지 않는다. v2.101은 표시 버전 외 실행 로직을 변경하지 않는다. 현재 해시와 비교 방법은 끝의 2.101 지도에 있다.

역사 manifest의 이름 없는 시작 코드·치트 에디터·스크립트 밖 HTML 비교 역시 **v2.98 당시 기록**이다. v2.100에서 상단 버튼 CSS가 추가됐으므로 그 비교 결과를 현재 스크립트 밖 HTML에 적용하지 않는다. 각 심벌은 당시 찾기 위한 대표 분야 하나에 배속됐고 기능은 여러 분야에 걸칠 수 있다.

새 원작 이식은 제공 원본→현재 모드→새 원본을 세 방향으로 대조한다. 2.98 개발자료의 `compare_all` 도구가 있다면 역사 manifest 분석에 쓸 수 있으나, 2.99 이후 연결점은 이 문서의 추가 지도와 현재 파일을 별도로 확인한다. 압축 이름·동작 조건·저장 버전이 달라질 수 있으므로 역할별로 직접 병합하고 기능별 회귀 검사를 한다. 자동 이식 완료로 간주하지 않는다. 원작 밖 이미지·배포 자산의 미래 호환도 주장하지 않는다.

## 작업 원칙

- 요청받은 범위와 필요한 수정만 적용한다. 관계없는 리팩터링, 수치 조정, 서술 순화·삭제·개작을 하지 않는다.
- 범위 밖의 문제·개선안·더 나은 대안을 발견하면 근거와 영향을 사용자에게 알린다. 제안만으로 변경 권한이 생기지는 않으며, 사용자의 추가 요청 또는 승인 전에는 작업물에 반영하지 않는다.
- 수행할 수 없는 요청은 설명하고 해당 부분을 보류한다. 다른 내용으로 몰래 대체하지 않는다.
- 새 모드의 영속 데이터는 아래 modData 기반을 먼저 검토한다. 별도 슬롯 매칭 시스템을 다시 만들지 않는다.
- 이 안내는 개발 계약이지 새 런타임 API가 아니다. 함수명 뒤 숫자는 도입 시점이며 모두 최신 숫자로 바꾸지 않는다.
- 이식할 때 이 안내도 실제 코드와 함께 갱신한다. 과거 검증 결과를 새 코드의 검증으로 대신하지 않는다.

## 2.97 이미지 연동의 소유권과 이식 계약

새 설정은 기존 기기 설정 저장소 tavern-settings의 state.koImage297에 있다. 게임 진행 상태나 modData에 넣지 않았다. 연결 주소·기기 성능과 함께 쓰는 설정이기 때문이다.
기존 저장 버전 3을 유지하며, 새 필드가 없으면 기존 동작을 그대로 사용한다. 기본값을 읽는 것만으로 저장하지 않는다. 기존 게임 JSON에는 이 기기 설정을 동봉하지 않는다.
원본 게임이 알 수 없는 기기 설정을 보존하거나 제거하는 경우에 게임 상태에는 영향이 없다. 새 PC에서는 이 이미지 설정을 별도로 다시 지정해야 한다.

koImage297은 schema 1이며 mode(auto/custom), custom(steps/cfg/loraStrength), models(name/path 배열), profiles(name/수치 배열), experimental(enabled/variants/packs)을 가진다.
생성 수치 입력 범위는 steps 정수 4~40, CFG 1~10, LoRA 강도 0~1이다. 자동 모드의 기존 8/12/18, 1.5/2/2.5, 1/0.9/0.8 선택 규칙은 그대로다. 허용 범위는 모델별 추천값이나 품질 보장이 아니다.
모델 즐겨찾기는 기존 체크포인트 경로 선택을 편하게 한 것이며, 모델을 설치하거나 서버의 설치 모델을 조회하지 않는다. 사용자 이름으로 20개, 생성 수치 묶음으로 12개까지 UI에서 등록한다.
기존 요청 필드만 사용한다. workflow illustrious, 해상도, 시드/샘플러/스케줄러 및 서버 기본 모델은 바꾸지 않는다. 사전 생성에 개별 checkpoint를 새로 넣지 않는다.

실험적 이미지 확장은 기본 OFF다. 켠 상태에서 자동 변형 정수 4~8, 인물별 번호 팩 검색 정수 2~4를 입력한다. 저장된 값은 다음 페이지 실행부터 적용한다.
시작 경로 `nce`에서 `koImageSession297`으로 이번 실행의 값을 고정한다. 초기 팩 검색과 이후 키 생성이 서로 다른 설정을 읽지 않게 하려는 경계다. 끄면 다음 실행부터 4/2이며 입력했던 값과 기존 이미지 목록을 삭제하지 않는다.
번호 팩 2는 images-인물-1.js 및 -2.js를 뜻한다. 번호 없는 파일, 공통/날짜 이름 파일까지 포함한 전체 팩 개수 제한이 아니다.
기존 수동 v4 이상 이미지는 자동 확장에 재사용될 수 있다. M0의 추가 버튼은 현재 자동 범위와 저장 목록/팩 키를 피해서 번호를 할당한다. ef 대기 중 장면이 바뀌면 추가를 중단한다.
사전 생성 상한 20,000 및 서버 제출 단위 2,000을 유지한다. 확장된 모든 그림을 한꺼번에 만들지 않고 해당 키가 필요할 때 요청한다.

M0는 같은 이미지 키에서도 바뀐 모델/수치로 수동 재생성을 요청한다. 기존 캐시는 자동 삭제하지 않는다. 재생성 시 표시용 프롬프트 묶음과 영상 표시도 갱신한다.
같은 출처 연결을 뜻하는 빈 문자열 주소와 미연결 null을 구분한다. 연결 상태 변경은 wayward-image-connection297, 오류 표시는 wayward-image-notice297 이벤트로 UI에 전달한다.
모델/HTTP/응답 오류와 수동 이미지 목록 저장 실패를 상태 문구로 알린다. fetch 자체의 새 제한 시간이나 재시도 정책은 추가하지 않았다.

이번 변경은 feature_groups의 image_generation_client로 묶었다. 새 실험적 기능은 승인된 경우에만 같은 UI 패턴을 검토한다. 다른 기능을 위해 거대한 공통 프레임워크나 새 모드 탭을 만들지 않았다.
QA는 실제 함수/게임 store에 모의 네트워크와 DOM/훅을 연결했다. 실제 브라우저 화면은 로컬 주소 접근 차단으로 확인하지 못했고, 실제 연동 서버·GPU·대용량 이미지 팩 성능은 확인하지 못했다.

## 2.98 QA 수정 범위

2.97의 이미지 저장 오류와 생성 오류가 한 문자열을 공유해, 생성 성공이 아직 해결되지 않은 저장 실패를 지우거나 저장 재시도 성공 뒤 오래된 실패가 남는 문제가 있었다.
koImageNoticeByKind298은 settings/variants/generation 안내를 실행 중에만 나눠 보관한다. 새 저장 필드가 아니다. koImageNotice297의 기존 한 인자 호출은 generation 안내로 유지한다.
koImageSave297와 Sae의 성공/실패에서 해당 종류만 갱신한다. 생성 성공은 generation만 비운다. 실패 문구를 순화하거나 게임 대사를 바꾸지 않는다.
koImageStatus297은 이벤트 구독을 붙인 직후 현재 값을 다시 읽는다. 렌더와 구독 사이에 도착한 오류를 놓치지 않게 하기 위함이다.
Vhe의 기존 미리보기 버튼 아래에 같은 안내 컴포넌트를 연결한다. 미리보기의 생성 요청·결과·캐시 처리는 바꾸지 않는다.

새 검증 14건 중 7건이 2.97에서 실패했고 같은 검증이 2.98에서는 14건 모두 통과했다. 실패 근본 원인은 안내 종류 혼합, 구독 시점 누락, 미리보기 표시 누락의 세 가지다.
기존 92건도 2.98 파일로 재검증한다. 별도 인수인계와 verification.json에서 실제 수행 결과를 확인한다. 브라우저/GPU 실환경 검증을 대신하는 결과가 아니다.

## 현재 저장 구조

수동 슬롯·하루 시작 자동 저장은 {format:1, gameVersion:51, savedAt, state, modData}다.
JSON 파일 내보내기는 여기에 modSettings를 동봉한다.
실시간 자동 저장은 기존 persist 래퍼인 {version:51, state:{state, modData, 기타 저장 UI 값}}이다.
현재 store에서 게임은 ue.getState().state, 확장은 ue.getState().modData로 분리되어 있다.

modData 기본값은 {schema:1, inventory:{}, employees:[], effects:[]}다. v2.99부터 `inventory`에는 능력치 비약·독약을 보관하고, `employees`에는 할머니 종업원 고용값을 보관하며, 선택 필드 `guestStudio`에는 사용자 생성 손님·원본 손님 편집·출현 비중과 복원 자료를 둔다. v2.100의 새 고용에는 `untilClose:true`가 붙는다. `effects`는 현재 전용 버프 동작에 연결되지 않은 예약 컨테이너다.
실제 행동은 `Jne`의 `ko299_` 분기 및 `ue.dispatch`의 `koShopData299`와 연결된다. 추가된 저장값은 구매·사용·고용·손님 편집·되돌리기·기존 저장/로드 경로를 거친다. `koValidModData293`은 기반 컨테이너의 형태를 확인하고, 선택 손님 설정은 `koStudio299`에서 읽을 때 정규화한다. 이 경계가 모든 하위 데이터의 세부 유효성을 보증하는 것은 아니다.
gameVersion 51은 원작 저장 migration 버전이고 modData.schema 1과 별개다.

게임 상태와 modData를 같은 localStorage 값 / 같은 JSON에 함께 저장한다.
별도 파일 둘을 슬롯 번호·식별값으로 맞추거나 자동 결합하는 구조가 아니다.
수동 저장은 0~11의 12칸, 모드 날짜 기록은 최근 5개다. 손님 수 제한과 관계없다.
원본과 모드의 브라우저 저장을 실시간으로 동기화하지 않는다. PC 이전은 JSON 한 파일로 한다.

확장 키는 manifest.storage에 있다. tavern-* 게임 키와 이전 모드 설정 키는 이 저장 기반에서 읽기만 한다.
새 자동 저장이 없을 때 유효한 구 자동 저장을 복사한다. 새 슬롯이 없으면 같은 번호 구 슬롯을 읽는다.
모드 슬롯 삭제는 state와 modData 묶음을 지운다. 남아 있던 구 슬롯이 다시 보일 수 있다.
새 게임·JSON 가져오기·자동 저장 초기화는 구 날짜 이력을 숨기되 구 저장 바이트를 삭제하지 않는다.
모드 설정은 브라우저 공통이다. 슬롯 로드로 교체하지 않는다. JSON 동봉 설정 적용 여부만 별도로 처리한다.

## 복구와 로드 경계

- modData 없음: 새 기본값, 경고 없음. 다른 플레이의 modData를 이어받으면 안 된다.
- 유효한 schema 1: 알 수 없는 추가 필드까지 보존한다. 현재 검증은 컨테이너 형태 수준이다.
- modData 손상 또는 미지원 schema: 오류 데이터 백업 시도, 기본값, 안내 후 게임 진행 가능.
- 게임 본문 검증 실패 또는 JSON 파싱 실패: 로드 거절, 현재 진행 유지. 안내 없이 대체하지 않는다.
- 잘못된 modSettings: 현재 설정 유지, 게임·modData 로드는 진행한다.
- 자동 저장 쓰기 실패: 메모리 진행 유지, JSON 내보내기 안내. 성공하기 전 같은 실패 팝업을 반복하지 않는다.

koPrepareImportedState175는 복사본을 검증하고 RNG와 손님 ID 카운터를 복원한다.
실제 로드가 성공하면 kI로 ID 카운터를 동기화하고 저장된 RNG를 적용해야 한다.
검증기의 부수효과 보호를 없애서 로드 문제를 해결하지 않는다. 목록 조회도 RNG·ID·백업을 바꾸면 안 된다.
자동 복원에서는 저장된 실행 함수나 undoStack을 믿지 않고 지정한 데이터만 복원한다.

## 확장 콘텐츠를 붙일 때

1. 필드의 소유자를 먼저 정한다. 기존 게임이 이해하는 진행 상태는 기존 state에, 모드 전용 인벤토리·직원·효과는 modData에 둔다. 기존 필드를 일괄 이동하지 않는다.
2. 실제 콘텐츠에 맞는 ID, 값 범위, 하위 항목 검증을 정의한다. schema를 바꾸면 이전 schema 변환도 함께 설계한다. 숫자만 올리면 현재 로더는 미지원 데이터로 복구한다.
3. modData를 불변 갱신한다. inventory 직접 대입, employees.push 같은 제자리 수정은 undo가 보관한 과거 참조까지 바꿀 수 있다.
4. 게임과 모드 값이 동시에 바뀌는 기존 사례는 `Jne`의 `ko299_` 액션 → `koShopAction299`로 게임 상태 처리 → `ue.dispatch`의 `koShopData299`로 modData 처리 → 한 번의 store 갱신이다. undoStack은 이전 state와 modData를 함께 보관한다. 새로운 액션도 같은 경계와 실패 시 무변경 조건을 확인한다. 직접 setState만 호출하면 새 undo 기록이 생기지 않는다.
5. 하루 시작 자동 저장에는 `ue.dispatch`에서 계산한 최종 `md299`가 `koCompleteTurn175(...,md299)`와 `bse`로 전달된다. 새 정산 기능이 modData를 변경한다면 이 최종값과 슬롯·실시간 자동 저장·JSON·undo의 일치를 다시 확인한다.
6. 임시 효과를 원작 영구 스탯에 누적해 굽거나 원작이 모르는 객체를 핵심 배열에 섞기 전에 원본 내보내기 영향을 설계한다. 중복 적용·만료·로드·undo·새 게임을 확인한다.
7. 수동·실시간·하루 시작 자동 저장·JSON·로드·undo·초기화 경로를 모두 점검한다. 별도 저장 버튼은 필요성이 확정될 때만 검토한다.

## 원작 업데이트를 이식할 때

기준 원본, 이전 모드, 새 원본을 보존한 뒤 세 방향으로 비교한다.
manifest의 save_regions는 저장 경계를 찾는 검색 지도다. 구간에는 기존 원작 코드도 섞여 있으므로 통째로 새 원본에 덮어쓰지 않는다.
원작 빌드의 압축 함수명은 바뀔 수 있다. 이름이 같다는 이유만으로 같은 기능이라 판단하지 않는다.
역사 manifest의 save_regions는 2.98 저장 읽기·쓰기·복원·턴 완료·UI 경계를 표기한다. v2.99 이후에는 Jne·ue.dispatch 및 UI·손님 생성/기록·Ol 연결점도 아래 지도에 추가됐다. 원작 migration과 새 버전 번호를 먼저 대조한다.
새 원본에서도 고쳐진 버그는 중복 패치하지 않는다. 문자열 치환은 예상 일치 개수를 검사하고 어긋나면 중단한다.
모든 ko 함수 목록은 탐색용 후보일 뿐이다. 기존 함수에 직접 들어간 수정도 있으므로 전체 모드 이식 완료 판정에 사용할 수 없다.
이번 저장 기반 밖의 변경은 2.92 보존본과 제공 참고 원본을 함께 비교한다. 안내에 없는 기능을 삭제할 근거로 삼지 않는다.
수정 후 저장 경계 검사와 해당 기능 회귀를 재실행하고, 실제 브라우저에서 화면과 저장 동선을 확인한다.

## 호환의 실제 범위와 남은 일

제공 참고 원본은 2.94 JSON을 읽지만 modData는 사용하지 않는다. 원본에서 다시 저장하면 modData가 빠지며 자동 복원할 수 없다.
파일을 읽는 호환과 모든 진행 장면의 호환은 다르다. 제공 112일차 세이브는 원본에서도 다음 턴 오류가 재현된 기존 사례다.
미래 원작 버전, 모든 세이브, 미구현 콘텐츠의 호환을 보장하지 않는다.
2.94 저장 경계 32건·기존 저장 13건·주요 회귀 14건 및 900행동의 과거 통과 기록이 있다. 새 변경의 재검사 결과와 구분한다.
실제 브라우저 화면, 실제 저장 용량 한도, 여러 탭 동시 저장은 별도 확인 항목이다.
현재 원작 버전이 확정되지 않아 자동 이식기를 만들지 않았다. 동봉 오프라인 도구는 위치 확인·변경 비교만 하며 게임을 수정하지 않는다.

파일만 넘겨받았다면 이 문서의 읽는 순서대로 역사 manifest의 feature_groups와 끝의 2.99~2.101 지도를 함께 읽는다. 2.98 save_regions의 start/end는 당시 저장 기반을 찾기 위한 경계이며, 새 기능의 모든 저장 지점을 포함하지 않는다. 도구가 있다면 compare_all과 저장 경계 검사를 재실행하되 현재 코드에서 다시 추출한 결과를 기준으로 판단한다.

WAYWARD_MOD_MANIFEST_BEGIN
{
  "format": "wayward-mod-maintenance",
  "manifest_version": 2,
  "maintenance_revision": 5,
  "game_release": "2.98",
  "runtime_change": "image_client_notice_fixes",
  "baseline": {
    "filename": "Wayward_MOD_v2.98.html with its development comment removed",
    "sha256": "6ea8ce5e0e28b8dc7f14dcbd041d359c7ff9c0134940515e424e0a494d16ad98"
  },
  "references": [
    {
      "role": "reviewed_input_v2.97",
      "filename": "Wayward_MOD_v2.97.html",
      "sha256": "9213ed5a9785e7930bee380a0856d25c9cab641fb4f5d5c45f9fa89cb8c082b3"
    },
    {
      "role": "approved_v2.96",
      "filename": "Wayward_MOD_v2.96.html",
      "sha256": "7c5ab20d794e86aa398c2a9a2bcef0af2ee4827fd56ce34c5f6e21758cacffec"
    },
    {
      "role": "approved_v2.95",
      "filename": "Wayward_MOD_v2.95.html",
      "sha256": "4006df4dd9235cf4565b0c5deb00fc6e75add3ad9dc89653119c4e6450af349a"
    },
    {
      "role": "approved_v2.94",
      "filename": "Wayward_MOD_v2.94.html",
      "sha256": "363aac21b44e45883bb5693f2041d02fb343ca31b9c6d8aa01e7f5963040c360"
    },
    {
      "role": "preserved_gameplay_master",
      "filename": "Wayward_MOD_v2.92.html",
      "sha256": "6e9f5ae369d279cf48c50d614de17d05af6da5f0fe4df894e9aa2f5ff73fec82"
    },
    {
      "role": "provided_original_reference_not_verified_upstream_tag",
      "filename": "index(9).html",
      "sha256": "8a8e15667347bfc8f14440eff0b50393bc9bb3e47c87044efe78e7dc8257aa6c"
    }
  ],
  "contracts": {
    "game_save_version": 51,
    "mod_data_schema": 1,
    "default_mod_data": {
      "schema": 1,
      "inventory": {},
      "employees": [],
      "effects": []
    },
    "manual_slots": 12,
    "day_autosaves_retained": 5,
    "manual_and_day_paths": {
      "game": "state",
      "mod": "modData"
    },
    "current_autosave_paths": {
      "game": "state.state",
      "mod": "state.modData"
    },
    "json_export_settings_path": "modSettings",
    "global_settings": true,
    "separate_sidecar_matching": false,
    "inventory_employees_effects_gameplay_implemented": false
  },
  "storage": {
    "current": "wayward-expanded-game",
    "slot_prefix": "wayward-expanded-slot-",
    "day_prefix": "wayward-expanded-auto-d",
    "old_current": "tavern-game",
    "old_slot_prefix": "tavern-slot-",
    "old_day_prefix": "tavern-auto-d",
    "settings": "wayward-expanded-mod-settings-v1",
    "old_settings": "wayward-mod-settings-v1",
    "legacy_days_hidden": "wayward-expanded-legacy-days-hidden",
    "recovery_prefix": "wayward-expanded-mod-recovery-",
    "image_device_settings": "tavern-settings"
  },
  "save_regions": [
    {
      "id": "base_validation",
      "start": "function koValidSaveState175(",
      "end": "const KO_STORAGE293=",
      "purpose": "게임 본문 검증; 검증 전후 RNG와 ID 보존",
      "sha256": "c3e1fade72fe30adfcdf454ad3a72d442e0dc2cb32b17fddb1b3414c070caa0e",
      "bytes": 6321
    },
    {
      "id": "mod_save_helpers",
      "start": "const KO_STORAGE293=",
      "end": "function koHasAutosave175() {",
      "purpose": "modData 규약, 복구, 원본 읽기, 자동 복원, 저장 오류",
      "sha256": "c9ee3be3033117de12526001322fbc91c32bd6c8b366613308fc13ddce67a328",
      "bytes": 6871
    },
    {
      "id": "autosave_presence",
      "start": "function koHasAutosave175() {",
      "end": "const KO_MOD_SETTINGS_KEY239=",
      "purpose": "계속하기 후보 자동 저장 확인",
      "sha256": "d05626df480fb2efef379ca2a6c333acdcd125d212fd0625bb9c3a18ad636846",
      "bytes": 241
    },
    {
      "id": "settings_key",
      "start": "const KO_MOD_SETTINGS_KEY239=",
      "end": "function koRichTarget249(",
      "purpose": "확장 모드 설정 키; 인접 주석 포함",
      "sha256": "1f24dbc6117396ede418fe2d740d57bc209e5962fadbef350cfdf25c417eab35",
      "bytes": 134
    },
    {
      "id": "settings_io",
      "start": "function koNormalizeModSettings239(",
      "end": "function koSetBadEnding239(",
      "purpose": "브라우저 공통 설정 정규화와 읽기·쓰기",
      "sha256": "8b2b046fb82a9604e183edf1ef711a6f75a0e34e486a16a3fd0590998c2a4d0c",
      "bytes": 1994
    },
    {
      "id": "day_commit",
      "start": "function koCompleteTurn175(",
      "end": "const koNamedAliases175=",
      "purpose": "하루 전환 후 최종 게임 및 모드 데이터 전달; 기존 정산도 포함",
      "sha256": "92f211b4f7d659c5a2d9d52f276fae09f9847d44d34bcd538bc9c8a1ae0dd7b6",
      "bytes": 410
    },
    {
      "id": "slots_and_export",
      "start": "const JC=12,",
      "end": "function x0(",
      "purpose": "원본 직렬화, 슬롯·날짜 저장·삭제, JSON 내보내기",
      "sha256": "97c7f3db6b10fad7fb64f97d85e6453fa997fd683c4a4b4ede688c157fcaa5b4",
      "bytes": 4665
    },
    {
      "id": "base_import_migration",
      "start": "function x0(",
      "end": "function xse(",
      "purpose": "원작 게임 본문 migration; 신규 원작과 먼저 대조",
      "sha256": "3aacd7700388a2ea1d434594cc89300b60efbb12c776c82253a2b929de2744bb",
      "bytes": 3537
    },
    {
      "id": "json_read_download",
      "start": "function xse(",
      "end": "function S0(",
      "purpose": "JSON 본문 사전 검증과 다운로드",
      "sha256": "174861c1dcaa4ee24f8ca48b448cf2a64d7b4c51b7a86d1f6fa33afd52627b8e",
      "bytes": 601
    },
    {
      "id": "store_dispatch_undo_new_game",
      "start": "koAdoptLegacyAuto293();const ue=",
      "end": "saveToSlot:o=>",
      "purpose": "구 자동 저장 채택, store 시작, 턴, undo, 새 게임",
      "sha256": "49f33ec1db776acc722033fe4c6bb2081e9394c1fe6d14b53f314c11b46eeca9",
      "bytes": 3661
    },
    {
      "id": "store_save_actions",
      "start": "saveToSlot:o=>",
      "end": "migrate:(e,t)=>{var n;const o=e;",
      "purpose": "실제 로드 확정 시 ID/RNG, 저장·가져오기, persist 경계",
      "sha256": "f5b13cdc3c71f3a65cc947d78c73b1ef2b94aeb6a960c185552955e9f840053d",
      "bytes": 1842
    },
    {
      "id": "persist_original_migration",
      "start": "migrate:(e,t)=>{var n;const o=e;",
      "end": "var t3=s2();",
      "purpose": "원작 버전별 persist migration; 새 원작으로 통째 덮어쓰지 않음",
      "sha256": "0f34d634cbdb30a38f4896763d6d5ddd0ec7814b4b98d0d6bb837c9b49b6c037",
      "bytes": 10623
    },
    {
      "id": "save_dialog",
      "start": "function sf(",
      "end": "function $le(",
      "purpose": "기존 저장 창, legacy·오류·삭제 표시, JSON 설정 확인",
      "sha256": "69e4a76d5aba22df45c0be3017f86b2c4a195b473678ce36b13ff5617caf6308",
      "bytes": 9122
    }
  ],
  "landmarks": [
    {
      "id": "engine_save_version",
      "needle": "Au=51,Gse=15;"
    },
    {
      "id": "day_snapshot_mod_argument",
      "needle": "bse(result.state,Au,modData293);"
    },
    {
      "id": "manual_load_id_commit",
      "needle": "loadFromSlot:o=>{const n=gse(o);return n?(koResetLiveLocks239(),kI(n.state),"
    },
    {
      "id": "day_load_id_commit",
      "needle": "loadDayAutosave:o=>{const n=wse(o);return n?(koResetLiveLocks239(),kI(n.state),"
    },
    {
      "id": "persist_validation",
      "needle": "storage:koAutoStorage294(),merge:koMergeSave294,onRehydrateStorage:()=>koHydrated294"
    },
    {
      "id": "undo_mod_snapshot",
      "needle": "h={state:s,modData:n.modData,turnIndex:n.lastTurnLogIndex}"
    }
  ],
  "navigation_only": {
    "custom_functions_regex": "\\bfunction\\s+(ko[A-Za-z0-9_$]+)\\s*\\(",
    "warning": "텍스트 기반 탐색 후보다. 원작 함수에 직접 반영한 변경과 데이터 치환 전체를 포괄하지 않는다."
  },
  "main_module_sha256": "59f412497fd598f7b9f617f2f01c1975d7124aae5faad7d92cd83eb5562d207b",
  "full_change_map": {
    "version": 1,
    "reference": {
      "role": "provided original, exact upstream release tag not verified",
      "html_sha256": "8a8e15667347bfc8f14440eff0b50393bc9bb3e47c87044efe78e7dc8257aa6c",
      "module_sha256": "68951481c1d7fa08e68e26dc57a4b002a6707eb0e35ad5332a38ba891eb8b69a"
    },
    "current": {
      "game_release": "2.98",
      "payload_sha256": "6ea8ce5e0e28b8dc7f14dcbd041d359c7ff9c0134940515e424e0a494d16ad98",
      "module_sha256": "59f412497fd598f7b9f617f2f01c1975d7124aae5faad7d92cd83eb5562d207b"
    },
    "method": "AST top-level named declarations by identifier and source; anonymous top-level statements separately; not a semantic port oracle",
    "feature_groups": [
      {
        "id": "localization_narration",
        "title": "번역·손님 음성·로그·표시 어휘",
        "purpose": "이름 대입, 번역 로그와 말투 자료, 관계/행위 상태를 표시하는 문구의 원천을 추적한다. 자료 해시는 문구 자체를 재작성하라는 지시가 아니다.",
        "upstream_boundary": "원본 대사 및 로그 데이터, koVoiceData137, koLogData179, 대사 선택과 표시 함수를 다시 대조한다.",
        "review": "상황·행위 주체·착의·실제 결과와 출력이 맞는지 확인하며 원문의 강도와 번역 표현을 임의로 낮추지 않는다.",
        "symbol_ids": {
          "functions": [
            "Xee"
          ],
          "variables": [
            "koVoiceData137",
            "koLogData179",
            "m",
            "g$",
            "eH",
            "dy",
            "x$",
            "T$",
            "tB",
            "yn"
          ]
        }
      },
      {
        "id": "patron_scene",
        "title": "손님·아내 장면과 단체 참여 흐름",
        "purpose": "손님 주도 접근, 단계 전환, 관람·참여·사정 결과, 단체 장면 종료와 후처리를 연결한다.",
        "upstream_boundary": "활성 장면 B/Ge, 손님 단계 Rm/JU, Bt/AI/K7/J7 종료 및 사건 큐를 새 원작의 같은 역할과 비교한다.",
        "review": "장면 선행조건, 방어·동의 판정, 참여자별 결과, 포커스·로그·흔적·퇴장 및 취침 후 정리를 검사한다.",
        "symbol_ids": {
          "functions": [
            "koPatronAftermath243",
            "koWifeAdvance286",
            "koSelfApproach243",
            "koPatronAlertValid254",
            "koGroupAftermath257",
            "koGroupFinishTag256",
            "koBackRoomPrivatePatronCleanup238",
            "koSceneCustomerIds246",
            "koPartyExpiry246",
            "koIntimateOfferPick221",
            "koIntimateOfferLegacy221",
            "Pc",
            "nH",
            "rH",
            "k$",
            "v$",
            "Rh",
            "ym",
            "Zb",
            "E8",
            "L8",
            "G8",
            "nw",
            "Sy",
            "hB",
            "cB",
            "Bt",
            "AI",
            "K7",
            "J7",
            "Rm",
            "JU",
            "Hj",
            "ez",
            "zj",
            "fV",
            "kV",
            "oN",
            "ec",
            "sK",
            "hK",
            "jQ",
            "LN"
          ],
          "variables": []
        }
      },
      {
        "id": "tavern_rooms_guests",
        "title": "주점 운영·투숙객·목욕탕·뒷방",
        "purpose": "객실 선결제·장기 투숙객의 이동/퇴장, 객실과 뒷방 점유, 관람자 및 목욕탕을 처리한다.",
        "upstream_boundary": "고객 위치/상태, 방 예약·파티 메타, 객실 설비, 장기 숙박 만료, 마감 정산을 연결해 대조한다.",
        "review": "방을 떠난 손님 복귀, occupiedBy와 고객 상태 동기화, 영업 종료·하루 전환·로드 뒤 고착 여부를 확인한다.",
        "symbol_ids": {
          "functions": [
            "koRenterRoom243",
            "koGuestReturns243",
            "koBathEntry243",
            "koDiscreetRenters240",
            "koBookedRenter260",
            "Ac",
            "yM",
            "ow",
            "hW",
            "cW",
            "NW",
            "JW",
            "XW",
            "oY",
            "Hf",
            "Tz",
            "Jj",
            "QZ",
            "jte",
            "BI"
          ],
          "variables": []
        }
      },
      {
        "id": "risk_and_traffic",
        "title": "악명 보상·고객 방문·영업 위험",
        "purpose": "고객 풀과 방문량, 행동 선택 가중치, 강제 시도와 기존 난투 가중치의 조정 위치를 기록한다.",
        "upstream_boundary": "고객 후보 n7, 방문 DS, fN 사건 풀, Hj/HV/MW 시도 판정 및 난투 발생 자격을 분리해 확인한다.",
        "review": "악명 위험 계수·후보 수·방문 제한·시도 확률과 원본 방어/수용 판정 유지 여부를 검사한다.",
        "symbol_ids": {
          "functions": [
            "koNotorietyRisk253",
            "n7",
            "DS",
            "EW",
            "MW",
            "HV",
            "fN"
          ],
          "variables": [
            "koThreatTactics253",
            "d6"
          ]
        }
      },
      {
        "id": "clothing_dares",
        "title": "옷 상태·권하기·상태 카드",
        "purpose": "순간 노출과 지속 착의 명령, 노팬티, 욕실 복장, 이미지 지시와 대상 손님 반응을 구분한다.",
        "upstream_boundary": "exposure/outfit 변환 um/Mi/Uh/WQ와 권하기 후보 LW/BW/xY의 조건·결과를 대조한다.",
        "review": "버튼·실제 상태·상대 반응·후속 장면과 옷 상태가 일치하는지 확인한다. 잠깐 보여주기와 근무 중 탈의를 혼동하지 않는다.",
        "symbol_ids": {
          "functions": [
            "koClothingLine244",
            "um",
            "p$",
            "VY",
            "Y9",
            "G9",
            "Uh",
            "Mi",
            "WQ"
          ],
          "variables": [
            "LW",
            "BW",
            "xY",
            "Tse"
          ]
        }
      },
      {
        "id": "daily_initiative_and_conversation",
        "title": "일상 행동 추첨·아내 대화·관계",
        "purpose": "아내의 일상 후보, 손님 대화와 관계 단계, 남편과의 대화, 감정/욕구 조건을 추적한다.",
        "upstream_boundary": "일상 후보 DW, 손님 행동 Dz, 대화 QS/PN/tZ/KN과 후보/선택 함수 qY/zY/dZ를 구분해 이식한다.",
        "review": "평소 발동 빈도와 자위 후보·아내 주도 후보의 경합, 관계 단계 기록, 선택 조건과 대사 일치를 검증한다.",
        "symbol_ids": {
          "functions": [
            "qY",
            "JI",
            "zY",
            "As",
            "rZ",
            "zee",
            "dZ",
            "CZ",
            "vte",
            "Vne"
          ],
          "variables": [
            "DW",
            "QS",
            "Dz",
            "PN",
            "tZ",
            "KN"
          ]
        }
      },
      {
        "id": "wife_initiative",
        "title": "아내가 먼저 덮치는 장면",
        "purpose": "비공개/공개 장소의 덮치기 자격과 추첨, 쿨타임, 클라이맥스와 만족하지 못한 종료를 처리한다.",
        "upstream_boundary": "koAutoRideContext223 및 koAutoRideStart223가 기존 일상 후보와 플레이어 장면 시작 Jf에 연결되는지 확인한다.",
        "review": "HI·개방성·자신감 기준, 성향 우선순위, 180분 재발동 제한, 남편 기력과 10틱 상한을 확인한다.",
        "symbol_ids": {
          "functions": [
            "koAutoRideContext223",
            "koAutoRideScene223",
            "koAutoRideUnfulfilled278",
            "koAutoRideLocked223",
            "koAutoRideStart223",
            "LX",
            "BX",
            "Jf"
          ],
          "variables": [
            "koAutoRideAgencyId223",
            "koAutoRidePrivateHI223",
            "koAutoRidePublicHI223"
          ]
        }
      },
      {
        "id": "player_intimacy",
        "title": "남편·아내 장면, 완료 선택과 여운",
        "purpose": "장면 진행, 체위별 종료 선택, 실제 결과, 여러 참여자와 관계/감정 여운을 추적한다.",
        "upstream_boundary": "장면 선택 YX/FN, 완료 qX/zN/iT/lT/tm/hT, 후처리 koPlayerAftermath244와 관계 보정을 비교한다.",
        "review": "자동 사정과 버튼 결과·상태·서술 정합성, 장면 종료 후 흔적 만료 및 실제 affinityEffects 표기를 확인한다.",
        "symbol_ids": {
          "functions": [
            "koPlayerFinishGroup244",
            "koPlayerFinishAction244",
            "koPlayerFinishChoices244",
            "koPlayerFinishReason244",
            "koPlayerAftermath244",
            "koPlayerMenuRepair244",
            "koWifeSexPhysicalCost215",
            "koFinishAfterglow218",
            "koActiveAfterglowAffinity291",
            "koAfterglowTime291",
            "koAfterglowAffinity291",
            "YX",
            "FN",
            "qX",
            "zN",
            "iT",
            "lT",
            "tm",
            "hT",
            "zX"
          ],
          "variables": []
        }
      },
      {
        "id": "ntr_and_relationship_endings",
        "title": "NTR 조건·경고·아침 엔딩",
        "purpose": "이탈 위험과 부부 관계 조건, 추궁/반응, 취침 뒤 엔딩, 디버그 테스트 경로를 기록한다.",
        "upstream_boundary": "koNtrLeavingRisk234/koNtrStage265와 eZ/dse/nse, 취침 후 koNtrAtWake250을 따로 확인한다.",
        "review": "조건이 대화·잠으로 사라지거나 경계값을 오가며 도돌이표가 되지 않는지, 디버그 보조가 실조건을 가리지 않는지 점검한다.",
        "symbol_ids": {
          "functions": [
            "koNtrDebugAttachment240",
            "koNtrLeavingRisk234",
            "koNtrStage265",
            "koNtrAtWake250",
            "eZ",
            "dse",
            "nse"
          ],
          "variables": []
        }
      },
      {
        "id": "collector_and_notoriety_endings",
        "title": "수금원·악명 배드엔딩",
        "purpose": "수금원 방문·경고·실패 누적과 악명 100 경고/즉시 종료, 플레이어 위치별 설명을 추적한다.",
        "upstream_boundary": "koCollector* 보조, koNotorietyEnding235, _ee/Ol/Aa/nb를 정산·턴 진행 엔진과 비교한다.",
        "review": "수금원 경고·8회 실패, 중복 정산 방지, 남편 동석/부재 표현, 엔딩 후 남은 턴 처리를 확인한다.",
        "symbol_ids": {
          "functions": [
            "koCollectorRelieveStreak",
            "koCollectorPresence285",
            "koCollectorStallNotice",
            "koCollectorGameOver239",
            "koApplyCollectorReenable239",
            "koNotorietyWarningHistoryReset236",
            "koNotorietyEnding235",
            "Z6",
            "P7",
            "nb",
            "_ee",
            "Ol",
            "Aa",
            "Zr",
            "ste",
            "w0",
            "Jne",
            "FC",
            "cp",
            "ose"
          ],
          "variables": [
            "koCollectorEndingRecheckPending239"
          ]
        }
      },
      {
        "id": "rich_ending",
        "title": "부자 해피엔딩과 종료 화면",
        "purpose": "목표 골드·시설·채무·아내 관계를 맞춘 뒤 다음날 끝나는 부자 엔딩 및 전용 종료 표시를 추적한다.",
        "upstream_boundary": "koRichEligible249/koRichEnding249/koRichEndingSettings249와 취침 후 w0, 종료 화면 $le를 연결한다.",
        "review": "모드 설정의 목표액, 시설 플래그, 신뢰와 빚, 날짜 발동 및 다른 엔딩과의 표시 충돌을 확인한다.",
        "symbol_ids": {
          "functions": [
            "koRichTarget249",
            "koRichEligible249",
            "koRichEnding249",
            "koSetRichEnding249",
            "koRichEndingSettings249",
            "$le"
          ],
          "variables": []
        }
      },
      {
        "id": "settings_and_visitors",
        "title": "모드 설정·방문률 예약 변경",
        "purpose": "배드/해피엔딩 ON·OFF, 방문률·동시 손님 상한의 다음날 적용과 설정 저장 위치를 추적한다.",
        "upstream_boundary": "koNormalizeModSettings239 및 koVisitorTraffic272 계열과 게임 설정 키를 기존 방문 추첨 DS에 연결한다.",
        "review": "보통/디버그 허용 범위, 다음날 반영, 취소, 설정과 게임 세이브 분리, 구 설정 읽기를 확인한다.",
        "symbol_ids": {
          "functions": [
            "koNormalizeVisitorTraffic272",
            "koVisitorTraffic272",
            "koQueueVisitorTraffic272",
            "koCancelVisitorTraffic273",
            "koActivateVisitorTraffic272",
            "koNormalizeModSettings239",
            "koGetModSettings239",
            "koSaveModSettings239",
            "koSetBadEnding239",
            "koModBadEndingEnabled239",
            "koResetLiveLocks239",
            "koModSettingsDialog239"
          ],
          "variables": [
            "KO_MOD_SETTINGS_KEY239",
            "koModSettingsCache239"
          ]
        }
      },
      {
        "id": "saves_and_migrations",
        "title": "원본 호환 modData 저장·복구",
        "purpose": "기존 게임 state와 별도의 modData를 한 저장/JSON에 묶고 구 저장을 읽으며, 손상·되돌리기·날짜 이력을 처리한다.",
        "upstream_boundary": "koReadBundle293, koMergeSave294, 원작 migration x0, Zustand store ue, 슬롯과 JSON의 쓰기·읽기를 대조한다.",
        "review": "구 저장 기본값, 손상 modData 백업, gameVersion/schema 분리, ID/RNG 동기화, 12칸·5일 이력, undo 및 원본 재저장 시 손실을 확인한다.",
        "symbol_ids": {
          "functions": [
            "koDefaultModData293",
            "koValidModData293",
            "koRecoverModData293",
            "koNotifyMod293",
            "koReadBundle293",
            "koAdoptLegacyAuto293",
            "koImportedSettings293",
            "koSaveObject294",
            "koStorageWarning294",
            "koAutoStorage294",
            "koMergeSave294",
            "koHydrated294",
            "koLegacyDaysVisible294",
            "koBundleState294",
            "koSaveInfo294",
            "koSettingsConflict294",
            "koSettingsNotice294",
            "koHasAutosave175",
            "koCompleteTurn175",
            "koSituationNormalize230",
            "zm",
            "_se",
            "gse",
            "bse",
            "v0",
            "wse",
            "Hh",
            "kse",
            "vse",
            "x0",
            "sf",
            "xle",
            "Tle",
            "G3"
          ],
          "variables": [
            "KO_STORAGE293",
            "koModRecoveryNotice293",
            "KO_LEGACY_DAYS_HIDDEN294",
            "KO_AUTO_READ_NOTICE294",
            "koStorageWarnings294",
            "koLegacyDayReset294",
            "mse",
            "Um",
            "fse",
            "ue"
          ]
        }
      },
      {
        "id": "game_ui_and_cheat",
        "title": "상태 화면·치트 에디터·기타 UI 접점",
        "purpose": "실제 상태 카드, 서비스 화면, 이미지 지시, 관리 창과 치트 에디터 독립 스크립트의 노출 지점을 묶는다.",
        "upstream_boundary": "a5/sie/iie/E3/Eie 등 UI 함수와 본문 뒤 익명 치트 IIFE 및 스타일을 새 원작 UI와 비교한다.",
        "review": "메인/모드 설정/치트의 버전, 화면 배치, 주요 스탯과 실제 행동 이름, 이미지 지시를 확인한다.",
        "symbol_ids": {
          "functions": [
            "a5",
            "sie",
            "iie",
            "E3",
            "Eie",
            "whe"
          ],
          "variables": []
        }
      },
      {
        "id": "image_generation_client",
        "title": "이미지 연동·생성 설정·실험적 확장",
        "purpose": "기존 이미지와 요청 규약을 유지하면서 기기별 모델 즐겨찾기와 생성 수치, 4~8 자동 변형 및 2~4 번호 팩 검색을 제공하고 모델 변경·같은 출처 주소·저장 실패 처리를 정정한다.",
        "upstream_boundary": "기기 설정 vt, 이미지 UI M0/hhe/yhe/Vhe, Aj→Sj 수치, cq/Nj 키, qre 팩 탐색, pae/_ae/she 요청과 서버 주소 검사를 대조한다. 원작 프롬프트 Aj 본문과 서버/ComfyUI는 수정하지 않았다.",
        "review": "실험 OFF 기본 4/2, 다음 페이지 적용, 기존 이미지/수동 키 보존, 모델 변경 후 재생성, 같은 출처 빈 주소, 설정 재시작과 요청 필드 호환을 검사한다. GPU 품질/호환 및 대규모 팩 성능은 별도 실환경 검증한다. 2.98의 종류별 오류 유지/해제, 화면 부착 시 동기화와 인물 미리보기 오류 표시도 확인한다.",
        "symbol_ids": {
          "functions": [
            "cq",
            "qre",
            "Sj",
            "nce",
            "M0",
            "yhe",
            "Vhe",
            "hhe",
            "Vh",
            "c3",
            "eae",
            "nae",
            "Kre",
            "R0",
            "uae",
            "lhe",
            "Sae",
            "pae",
            "_ae",
            "she",
            "koImageNumber297",
            "koImageCustom297",
            "koImagePrefs297",
            "koImageSession297",
            "koImageParams297",
            "koImageRequest297",
            "koImageNotice297",
            "koImageConnection297",
            "koImageSave297",
            "koImageModelOptions297",
            "koImageNextVariant297",
            "koImageStatus297",
            "koImageSettings297"
          ],
          "variables": [
            "koImageSessionCache297",
            "koImageNoticeState297",
            "koImageNoticeByKind298"
          ]
        }
      }
    ],
    "symbol_changes": {
      "functions": [
        {
          "name": "koDefaultModData293",
          "sha256": "b1bab0d73830fd0aea040e49a4c1e9ac277ab7ea02ea368db00e144fd70057a7",
          "previousSha256": null,
          "length": 85,
          "moduleCharacterOffset": 260826,
          "statementIndex": 22,
          "change": "added",
          "feature_id": "saves_and_migrations"
        },
        {
          "name": "koValidModData293",
          "sha256": "3b2600c339d02f8596b665686a40d467b97b823a523f4bb52212111f241fc47d",
          "previousSha256": null,
          "length": 274,
          "moduleCharacterOffset": 260912,
          "statementIndex": 23,
          "change": "added",
          "feature_id": "saves_and_migrations"
        },
        {
          "name": "koRecoverModData293",
          "sha256": "ec11b7742d7ece5caf5a3a448fa794e81e470adb0cd91e91b65fe569a3e41fb4",
          "previousSha256": null,
          "length": 817,
          "moduleCharacterOffset": 261282,
          "statementIndex": 25,
          "change": "added",
          "feature_id": "saves_and_migrations"
        },
        {
          "name": "koNotifyMod293",
          "sha256": "6608400e35501de27aa33e6f20c8dea6743f6609527d84a35c49ef39abbd4e32",
          "previousSha256": null,
          "length": 110,
          "moduleCharacterOffset": 262059,
          "statementIndex": 26,
          "change": "added",
          "feature_id": "saves_and_migrations"
        },
        {
          "name": "koReadBundle293",
          "sha256": "afb423c16a5bd3642165048b74221c606da279893933e11a4018522aa1d22efa",
          "previousSha256": null,
          "length": 496,
          "moduleCharacterOffset": 262170,
          "statementIndex": 27,
          "change": "added",
          "feature_id": "saves_and_migrations"
        },
        {
          "name": "koAdoptLegacyAuto293",
          "sha256": "76fc6aed4503dda9190e939bacf0a801335e37a000569c31b280c6a784711434",
          "previousSha256": null,
          "length": 439,
          "moduleCharacterOffset": 262667,
          "statementIndex": 28,
          "change": "added",
          "feature_id": "saves_and_migrations"
        },
        {
          "name": "koImportedSettings293",
          "sha256": "3ee5cbd4f55f6ff492cbb2ba679a89b034b16f7bad0839e42439bdeae495bfb1",
          "previousSha256": null,
          "length": 253,
          "moduleCharacterOffset": 263107,
          "statementIndex": 29,
          "change": "added",
          "feature_id": "saves_and_migrations"
        },
        {
          "name": "koSaveObject294",
          "sha256": "f72ad8368b2d391e3b27a1a0e3ee92f055f94a2d7da9f90ab425fb8533faa34b",
          "previousSha256": null,
          "length": 100,
          "moduleCharacterOffset": 263441,
          "statementIndex": 30,
          "change": "added",
          "feature_id": "saves_and_migrations"
        },
        {
          "name": "koStorageWarning294",
          "sha256": "0427842fac2fc2a675916d6f25f6f7ef7e3d49b0ab2e3b25b1e1dc6efe547651",
          "previousSha256": null,
          "length": 334,
          "moduleCharacterOffset": 263784,
          "statementIndex": 35,
          "change": "added",
          "feature_id": "saves_and_migrations"
        },
        {
          "name": "koAutoStorage294",
          "sha256": "e6d5ee3a67005b3ad7f935195366e20c8b59c98dddb7cdfba78243a5c34f5c5e",
          "previousSha256": null,
          "length": 289,
          "moduleCharacterOffset": 264007,
          "statementIndex": 36,
          "change": "added",
          "feature_id": "saves_and_migrations"
        },
        {
          "name": "koMergeSave294",
          "sha256": "6f26e15dc59e0363ec6c049781fa5d252a8b880e643de2dfa3c5bdceba4b54b9",
          "previousSha256": null,
          "length": 1274,
          "moduleCharacterOffset": 264281,
          "statementIndex": 37,
          "change": "added",
          "feature_id": "saves_and_migrations"
        },
        {
          "name": "koHydrated294",
          "sha256": "7fc8e2b6c6602163e7f179514397975b712b040cb3bfd3d0e91592dbd789ca9e",
          "previousSha256": null,
          "length": 224,
          "moduleCharacterOffset": 265556,
          "statementIndex": 38,
          "change": "added",
          "feature_id": "saves_and_migrations"
        },
        {
          "name": "koLegacyDaysVisible294",
          "sha256": "61a4a41e7e231b0bf46de7b8073c91bad264e31ba414d38f825fa04f9a61a974",
          "previousSha256": null,
          "length": 154,
          "moduleCharacterOffset": 265781,
          "statementIndex": 39,
          "change": "added",
          "feature_id": "saves_and_migrations"
        },
        {
          "name": "koBundleState294",
          "sha256": "a42114a813635e0ca4b1e5cae4422484311285d9dd9afb8ab7b54e2abe60e913",
          "previousSha256": null,
          "length": 77,
          "moduleCharacterOffset": 265936,
          "statementIndex": 40,
          "change": "added",
          "feature_id": "saves_and_migrations"
        },
        {
          "name": "koSaveInfo294",
          "sha256": "4e2e2682b7d312cd4eeedc6048fc5281bf1a420c07911c6dca84283a2a6b7e96",
          "previousSha256": null,
          "length": 476,
          "moduleCharacterOffset": 266014,
          "statementIndex": 41,
          "change": "added",
          "feature_id": "saves_and_migrations"
        },
        {
          "name": "koSettingsConflict294",
          "sha256": "3d47f52ba3923ba5635fb7bfab4a0e229a0dda206afd4c43a888d979fe05f85c",
          "previousSha256": null,
          "length": 332,
          "moduleCharacterOffset": 266491,
          "statementIndex": 42,
          "change": "added",
          "feature_id": "saves_and_migrations"
        },
        {
          "name": "koSettingsNotice294",
          "sha256": "97f338d8bd5c4f5398f0ecc580730a3557eeb4e3f2ed2fc8cc9dec835c17b606",
          "previousSha256": null,
          "length": 330,
          "moduleCharacterOffset": 266825,
          "statementIndex": 43,
          "change": "added",
          "feature_id": "saves_and_migrations"
        },
        {
          "name": "koHasAutosave175",
          "sha256": "19ca2ada1f775dcdc66bb74f735ae08c9e9bd29c54a76e920afe7590fd3f4f19",
          "previousSha256": "3eb233df2374f9c4e016793c08af6043b32dd9016891dd006abf00d52006a755",
          "length": 239,
          "moduleCharacterOffset": 267075,
          "statementIndex": 44,
          "change": "changed",
          "feature_id": "saves_and_migrations"
        },
        {
          "name": "koRichTarget249",
          "sha256": "9c90f79c383373ca13e39784e37bb9ebc3ed9fc1ecfc3782b89454b5e3821f57",
          "previousSha256": null,
          "length": 115,
          "moduleCharacterOffset": 267450,
          "statementIndex": 46,
          "change": "added",
          "feature_id": "rich_ending"
        },
        {
          "name": "koRichEligible249",
          "sha256": "088258a2f710dd76243332b0a5fae4da0940b947c9a6fa44b4b04dc9add9df04",
          "previousSha256": null,
          "length": 562,
          "moduleCharacterOffset": 267566,
          "statementIndex": 47,
          "change": "added",
          "feature_id": "rich_ending"
        },
        {
          "name": "koRichEnding249",
          "sha256": "9a9ba6abc70e8cdc65a38865aeb70d88cb8e527bb8de104ee57410a8e599da6b",
          "previousSha256": null,
          "length": 1310,
          "moduleCharacterOffset": 268129,
          "statementIndex": 48,
          "change": "added",
          "feature_id": "rich_ending"
        },
        {
          "name": "koSetRichEnding249",
          "sha256": "ae5bad17b71bed1622db73bf2b646096a99128a2f5ae029b58fac7c6b977daa0",
          "previousSha256": null,
          "length": 202,
          "moduleCharacterOffset": 268812,
          "statementIndex": 49,
          "change": "added",
          "feature_id": "rich_ending"
        },
        {
          "name": "koRichEndingSettings249",
          "sha256": "4aec95c1411e159baa8fb961ea1f0003d462881f03f7a14334cd903782596f47",
          "previousSha256": null,
          "length": 2463,
          "moduleCharacterOffset": 269015,
          "statementIndex": 50,
          "change": "added",
          "feature_id": "rich_ending"
        },
        {
          "name": "koNormalizeVisitorTraffic272",
          "sha256": "e4c1000b7432a48242e82213de8612e87efa754c305d205a91acd8a453338732",
          "previousSha256": null,
          "length": 423,
          "moduleCharacterOffset": 271259,
          "statementIndex": 51,
          "change": "added",
          "feature_id": "settings_and_visitors"
        },
        {
          "name": "koVisitorTraffic272",
          "sha256": "47470bb5070363e07f04544b73b88a65c0a1745399cb60bb72b66212d9ac3d7a",
          "previousSha256": null,
          "length": 91,
          "moduleCharacterOffset": 271683,
          "statementIndex": 52,
          "change": "added",
          "feature_id": "settings_and_visitors"
        },
        {
          "name": "koQueueVisitorTraffic272",
          "sha256": "f47ea93a507acf570f62ec389a8299700b7cb64c14dbbafa7992bfd1347e0b57",
          "previousSha256": null,
          "length": 799,
          "moduleCharacterOffset": 271775,
          "statementIndex": 53,
          "change": "added",
          "feature_id": "settings_and_visitors"
        },
        {
          "name": "koCancelVisitorTraffic273",
          "sha256": "2171d0272b40da92bda63dc2efb388237d5673021d2025a9ce31df16745e98da",
          "previousSha256": null,
          "length": 286,
          "moduleCharacterOffset": 272575,
          "statementIndex": 54,
          "change": "added",
          "feature_id": "settings_and_visitors"
        },
        {
          "name": "koActivateVisitorTraffic272",
          "sha256": "8117e04187c9e53dff7684729f6059c27bc39b03fd6400a8275c03f4698b6594",
          "previousSha256": null,
          "length": 273,
          "moduleCharacterOffset": 272862,
          "statementIndex": 55,
          "change": "added",
          "feature_id": "settings_and_visitors"
        },
        {
          "name": "koNormalizeModSettings239",
          "sha256": "3793249d4b87ee5e3ed50ab33d37d9c44b94ab178897bad3f01a7b8775f70743",
          "previousSha256": null,
          "length": 1159,
          "moduleCharacterOffset": 273136,
          "statementIndex": 56,
          "change": "added",
          "feature_id": "settings_and_visitors"
        },
        {
          "name": "koGetModSettings239",
          "sha256": "9e3d9d73344db656f9e5bda91293ef9957be9da31de427443a753eed7d077c45",
          "previousSha256": null,
          "length": 297,
          "moduleCharacterOffset": 274364,
          "statementIndex": 58,
          "change": "added",
          "feature_id": "settings_and_visitors"
        },
        {
          "name": "koSaveModSettings239",
          "sha256": "fc9c502a41861d7aa810c5e5fb151715aced268b77f4dfea32c0c71a8c34d548",
          "previousSha256": null,
          "length": 467,
          "moduleCharacterOffset": 274662,
          "statementIndex": 59,
          "change": "added",
          "feature_id": "settings_and_visitors"
        },
        {
          "name": "koSetBadEnding239",
          "sha256": "ad8589d87ffbaa407c6468bebce541316df439f7585cff47c64aa7dbee1327a6",
          "previousSha256": null,
          "length": 204,
          "moduleCharacterOffset": 275130,
          "statementIndex": 60,
          "change": "added",
          "feature_id": "settings_and_visitors"
        },
        {
          "name": "koModBadEndingEnabled239",
          "sha256": "94b2f60d18915d800e8f2a9d9ff3adce0d7c7c5b19c2a7a55605feac5c00cec7",
          "previousSha256": null,
          "length": 98,
          "moduleCharacterOffset": 275335,
          "statementIndex": 61,
          "change": "added",
          "feature_id": "settings_and_visitors"
        },
        {
          "name": "koResetLiveLocks239",
          "sha256": "c593996a32577d0c5ea2681a2ab3f052a3e97a41efc4fb321317eb05297b7d9f",
          "previousSha256": null,
          "length": 230,
          "moduleCharacterOffset": 275434,
          "statementIndex": 62,
          "change": "added",
          "feature_id": "settings_and_visitors"
        },
        {
          "name": "koNotorietyWarningHistoryReset236",
          "sha256": "d6bbb07150093a696bc776d45b0b594361265edebd7bd1e25e2d1521d267df2b",
          "previousSha256": null,
          "length": 358,
          "moduleCharacterOffset": 275666,
          "statementIndex": 63,
          "change": "added",
          "feature_id": "collector_and_notoriety_endings"
        },
        {
          "name": "koNotorietyEnding235",
          "sha256": "3402bef5aff4407d64fcb57d8458ef5c39317a15a52300384f934b614fe884f0",
          "previousSha256": null,
          "length": 2851,
          "moduleCharacterOffset": 276025,
          "statementIndex": 64,
          "change": "added",
          "feature_id": "collector_and_notoriety_endings"
        },
        {
          "name": "koCompleteTurn175",
          "sha256": "ae3a4fd0ea0c4a0db27b184e6745bb08ae60c7c03827abaef31d78727c517a73",
          "previousSha256": "50235f467d3c3810fd634f753ef94b9c726a98b90554a2161463ffe74a658466",
          "length": 408,
          "moduleCharacterOffset": 278045,
          "statementIndex": 65,
          "change": "changed",
          "feature_id": "saves_and_migrations"
        },
        {
          "name": "um",
          "sha256": "157e279d4e477ca6e191bdbdc6b98110f169d496139c4c6fcf6297518f0b7157",
          "previousSha256": "19ab681e2672e418e01e2c70aef1644f2952d68f6d9d59c7d46ee68894a95e9e",
          "length": 357,
          "moduleCharacterOffset": 2973631,
          "statementIndex": 271,
          "change": "changed",
          "feature_id": "clothing_dares"
        },
        {
          "name": "koRenterRoom243",
          "sha256": "be8f9a33d25c6204aa879f3e7bb502d6d0712b80337cd35cb733b832bbdf7fcf",
          "previousSha256": null,
          "length": 187,
          "moduleCharacterOffset": 2976872,
          "statementIndex": 288,
          "change": "added",
          "feature_id": "tavern_rooms_guests"
        },
        {
          "name": "koGuestReturns243",
          "sha256": "21ff86d754bc0d0f9f3225f7c0e8c50825cde2c15c44de0963679ffb05ffd55b",
          "previousSha256": null,
          "length": 535,
          "moduleCharacterOffset": 2977060,
          "statementIndex": 289,
          "change": "added",
          "feature_id": "tavern_rooms_guests"
        },
        {
          "name": "koBathEntry243",
          "sha256": "d513e6cb7492205fa4bf74a290424b977a889b16b6c8381e5ae269530508e440",
          "previousSha256": null,
          "length": 144,
          "moduleCharacterOffset": 2977578,
          "statementIndex": 290,
          "change": "added",
          "feature_id": "tavern_rooms_guests"
        },
        {
          "name": "koPatronAftermath243",
          "sha256": "f0b36e9e5df296cdd9c9ad2957f7c2118a8fa539780cb0a414f098acce7bcb80",
          "previousSha256": null,
          "length": 272,
          "moduleCharacterOffset": 2977723,
          "statementIndex": 291,
          "change": "added",
          "feature_id": "patron_scene"
        },
        {
          "name": "koWifeAdvance286",
          "sha256": "7be179b5d317620ef3bdd6725a9925179fa9a440cb59eae805c42ee4e3dbdcf1",
          "previousSha256": null,
          "length": 1671,
          "moduleCharacterOffset": 2977996,
          "statementIndex": 292,
          "change": "added",
          "feature_id": "patron_scene"
        },
        {
          "name": "koSelfApproach243",
          "sha256": "f336d269be84496754daf47dc65aa349df7b902286ef3a016a8176c431b5a136",
          "previousSha256": null,
          "length": 176,
          "moduleCharacterOffset": 2979668,
          "statementIndex": 293,
          "change": "added",
          "feature_id": "patron_scene"
        },
        {
          "name": "Ac",
          "sha256": "325d02e21a49c0c8afb2a325dc24ef0e4bf0b9917eff30b4d110a6766a45ce8f",
          "previousSha256": "4415a67945923119386189fcfda2a5960bcbee635823fd78c068d2d4b50bbca5",
          "length": 241,
          "moduleCharacterOffset": 2979845,
          "statementIndex": 294,
          "change": "changed",
          "feature_id": "tavern_rooms_guests"
        },
        {
          "name": "yM",
          "sha256": "402fa6251c7fcfe8182cc2999cb0fee89606b8bed78dc1fc3265f725963f44ab",
          "previousSha256": "1a0bff0858535216f8b589da5dc2fbedad398723c34c6008dee334dc3873d72d",
          "length": 329,
          "moduleCharacterOffset": 2985545,
          "statementIndex": 329,
          "change": "changed",
          "feature_id": "tavern_rooms_guests"
        },
        {
          "name": "p$",
          "sha256": "75ad92e0aacc460f5f621eea1bfcc8ee73dc0e2660483101aad2af04290bb017",
          "previousSha256": "3dbd4d6378e71bf6203fcccb7cab87e83608f3921ffe0893f9379c2a82a641ee",
          "length": 438,
          "moduleCharacterOffset": 3195174,
          "statementIndex": 521,
          "change": "changed",
          "feature_id": "clothing_dares"
        },
        {
          "name": "Pc",
          "sha256": "c16b8bc8bfd0d70494e04e253cba844c4e30efe69c0e6b8cbdcba40a41539f05",
          "previousSha256": "5df13d56a5a278546283f84520206fa1f5e1b696faf206cb5442a0b753c93562",
          "length": 225,
          "moduleCharacterOffset": 3221023,
          "statementIndex": 554,
          "change": "changed",
          "feature_id": "patron_scene"
        },
        {
          "name": "nH",
          "sha256": "cc28fcdbb971663aae83ac8d59db054d5ef1c42eee6743f3170ac225ac611e4b",
          "previousSha256": "58e4a35b707afcb20b4b7d590b16939c84f20fec929aea6c89d03085f09908d9",
          "length": 693,
          "moduleCharacterOffset": 3221523,
          "statementIndex": 556,
          "change": "changed",
          "feature_id": "patron_scene"
        },
        {
          "name": "rH",
          "sha256": "265967c92b6a9d1e63d84016b4094084c173a0ff5eff367120ab426d323e5550",
          "previousSha256": "c26da5746b313e1af03390458011e10f18225ad3a6e5a661e9415503fd17c665",
          "length": 517,
          "moduleCharacterOffset": 3222278,
          "statementIndex": 558,
          "change": "changed",
          "feature_id": "patron_scene"
        },
        {
          "name": "k$",
          "sha256": "6e7a3496aa9832cbd1bcb2a916e9760f7154184da950f441681dd75b158761d5",
          "previousSha256": "08d2b35acbbabd1dfd268da8ed0a999b658e5dd61db8fa20bd5f9d20a3599283",
          "length": 998,
          "moduleCharacterOffset": 3223112,
          "statementIndex": 562,
          "change": "changed",
          "feature_id": "patron_scene"
        },
        {
          "name": "v$",
          "sha256": "de9c9c55d88ba92eee288c4e969a6c43561358eeac4e4356952836592ca2186f",
          "previousSha256": "554dac8eae6e5b914e22e51dbcac900a66fcf788b871e1db10569be442d7117d",
          "length": 472,
          "moduleCharacterOffset": 3224078,
          "statementIndex": 563,
          "change": "changed",
          "feature_id": "patron_scene"
        },
        {
          "name": "Rh",
          "sha256": "0760d5ba80adafe450635c213e4df84a79a63cf27d2d382e64dcea26a4ef523e",
          "previousSha256": "6d9680abad3a32ba576a09c4f17cec8171023152cc2093ab6a6b328f943c4bd8",
          "length": 244,
          "moduleCharacterOffset": 3235790,
          "statementIndex": 569,
          "change": "changed",
          "feature_id": "patron_scene"
        },
        {
          "name": "ym",
          "sha256": "86c797f00f97bab4807844e027441dbb05a5812cd6313c58582bbf12bd3b1932",
          "previousSha256": "e6ce8a7c34619cd1bed1e8516d4e2a9599aa94731966e5c51c56bdf82b0ebceb",
          "length": 1104,
          "moduleCharacterOffset": 3236034,
          "statementIndex": 570,
          "change": "changed",
          "feature_id": "patron_scene"
        },
        {
          "name": "Z6",
          "sha256": "9cd5cc7e6625c86a8a057d8620a936e3485d6d12985b56ac60bd6e35b0fea065",
          "previousSha256": "ee0b290faf33b1281adbdde88224c331d583bd0d8ad26faa5d51f6ec696b3b1b",
          "length": 416,
          "moduleCharacterOffset": 3287600,
          "statementIndex": 659,
          "change": "changed",
          "feature_id": "collector_and_notoriety_endings"
        },
        {
          "name": "Zb",
          "sha256": "6b62ce48f337057a9601131f7ae075540253f6e91174f2b98e5177d72dcf53a6",
          "previousSha256": "99deebe83724eb7cd3c8260f92d638aecad2b41eb998b80bf839c987c436ebb8",
          "length": 488,
          "moduleCharacterOffset": 3297585,
          "statementIndex": 689,
          "change": "changed",
          "feature_id": "patron_scene"
        },
        {
          "name": "koPatronAlertValid254",
          "sha256": "938e027cd2d0830f4da454c231b6992bb9e7d4318de36d43d89bd65b92aa9e5a",
          "previousSha256": null,
          "length": 560,
          "moduleCharacterOffset": 3304170,
          "statementIndex": 707,
          "change": "added",
          "feature_id": "patron_scene"
        },
        {
          "name": "E8",
          "sha256": "854abed751ad5feee1116626864741a490a42a3fad82087244c28f8104ebdd91",
          "previousSha256": "b5417289860ffaec8ee8a95f133512cbf225f2a085da72f7cadc0ee7b15db26b",
          "length": 135,
          "moduleCharacterOffset": 3304730,
          "statementIndex": 708,
          "change": "changed",
          "feature_id": "patron_scene"
        },
        {
          "name": "L8",
          "sha256": "2fb41cb358c5f3e265ffadd74a1243e994a20a4eeacd96dabfc28a9253708bbd",
          "previousSha256": "b199b4cb41d922859b887dfd8b7c4fcba6cabd740277171526870f2683bcf9dc",
          "length": 362,
          "moduleCharacterOffset": 3306143,
          "statementIndex": 715,
          "change": "changed",
          "feature_id": "patron_scene"
        },
        {
          "name": "G8",
          "sha256": "f68af0ff108120ee132f71fb6bd2f9c5923185c0165581a239752a3a55b978bf",
          "previousSha256": "bf35f6f01e52b520b4d6e73ca357bba3fd597cb32a2305a5ce2aabfd0b10f662",
          "length": 531,
          "moduleCharacterOffset": 3310980,
          "statementIndex": 725,
          "change": "changed",
          "feature_id": "patron_scene"
        },
        {
          "name": "ow",
          "sha256": "5d504776a095bdc7a384dcb61468cb7a0554f4999f4b9448476508e7a02c1529",
          "previousSha256": "621d8cecb689cf2194bced5ed64ef02d070b08a4358063215918af9f0ad92ce9",
          "length": 317,
          "moduleCharacterOffset": 3320168,
          "statementIndex": 741,
          "change": "changed",
          "feature_id": "tavern_rooms_guests"
        },
        {
          "name": "nw",
          "sha256": "dcaa6af2f3fbfca3956c5ea9e64e7c3ebd142112b7df7209e49504220e1d86d3",
          "previousSha256": "98080c6636c93871bedb77dec0fc0d8f4ddc82445bbba6c5dcfc45362e86138c",
          "length": 2283,
          "moduleCharacterOffset": 3324872,
          "statementIndex": 747,
          "change": "changed",
          "feature_id": "patron_scene"
        },
        {
          "name": "koGroupAftermath257",
          "sha256": "0a00b0a4c92e5b06c2cd0cf229bc4e4baa19e4c49755b66eddd5691adc8fb8e2",
          "previousSha256": null,
          "length": 404,
          "moduleCharacterOffset": 3326937,
          "statementIndex": 749,
          "change": "added",
          "feature_id": "patron_scene"
        },
        {
          "name": "koGroupFinishTag256",
          "sha256": "cd75179026cc794cc6fe83e9cdf92049d4cc40830ed76226041dadcc1fb73322",
          "previousSha256": null,
          "length": 256,
          "moduleCharacterOffset": 3327341,
          "statementIndex": 750,
          "change": "added",
          "feature_id": "patron_scene"
        },
        {
          "name": "Sy",
          "sha256": "d066eb3f81129498f05b3b5f348f315a6b46fbd4b918a10e09f8637c7763334a",
          "previousSha256": "d427fa0da379a490ede03b5900e5c96be9225ec41425df09a71a629d9400b675",
          "length": 1138,
          "moduleCharacterOffset": 3327597,
          "statementIndex": 751,
          "change": "changed",
          "feature_id": "patron_scene"
        },
        {
          "name": "hB",
          "sha256": "6d078e0ffad69d0fb91daf878ecc903fc31edb4d29ceea2fbbf9c5c4252d07b1",
          "previousSha256": "b0b890b2568ce389f1049bfc2e4c6a8abbd92a960a4e1d9a737839e28c93297a",
          "length": 831,
          "moduleCharacterOffset": 3330852,
          "statementIndex": 762,
          "change": "changed",
          "feature_id": "patron_scene"
        },
        {
          "name": "cB",
          "sha256": "3f30e38b50f9f8bb99459c1c9c16dbbc4981b96f7618d8ee53153976b8f2a628",
          "previousSha256": "1803e255f0cd179e4d643e329e6db666023e54cc7c6a2ca699af50ffe82e68a6",
          "length": 1627,
          "moduleCharacterOffset": 3331552,
          "statementIndex": 764,
          "change": "changed",
          "feature_id": "patron_scene"
        },
        {
          "name": "n7",
          "sha256": "df5245d983b1823d6b210b6f115b427c802350c830618cab08c17a0021f82654",
          "previousSha256": "a37c02b752fb94d877af591ab9c38319f25dc967fc832a1fdc7ca07f601b3f5b",
          "length": 352,
          "moduleCharacterOffset": 3365736,
          "statementIndex": 843,
          "change": "changed",
          "feature_id": "risk_and_traffic"
        },
        {
          "name": "DS",
          "sha256": "bcb415aefe20c32c69794db8b5a270421918f38263c6921058458779cbbc38ab",
          "previousSha256": "ae3fc13c71461c9055395d7962ba841ebc651adcdcb562f6c7bb026fa7108863",
          "length": 268,
          "moduleCharacterOffset": 3371473,
          "statementIndex": 853,
          "change": "changed",
          "feature_id": "risk_and_traffic"
        },
        {
          "name": "P7",
          "sha256": "24b98c021d756086e0f4c1bc6e7e7c4fabdc4b06244bff8961514e1a94ceed7b",
          "previousSha256": "e96d6d8128be6070b398013aaf438d8d81482b59022d254f7891c5f8d5a4d877",
          "length": 2439,
          "moduleCharacterOffset": 3383621,
          "statementIndex": 893,
          "change": "changed",
          "feature_id": "collector_and_notoriety_endings"
        },
        {
          "name": "Bt",
          "sha256": "47cf39e786f7c4dfad22eea18051369fe3fc823bba6d872948a3313c050cb5aa",
          "previousSha256": "aa1f6457d82cb261b51723d9ace33316929947dd014977971e5a51ff29630d2e",
          "length": 12651,
          "moduleCharacterOffset": 3387998,
          "statementIndex": 905,
          "change": "changed",
          "feature_id": "patron_scene"
        },
        {
          "name": "AI",
          "sha256": "0e0d763574aacd3f7312291637cd5fa301d63d9cf4b5f90d44949ee5ce02f862",
          "previousSha256": "6e7a6e396695cb7b9d00b7b93baf9de02646bd2ece6114059820f5933f8a5fb5",
          "length": 2233,
          "moduleCharacterOffset": 3400257,
          "statementIndex": 907,
          "change": "changed",
          "feature_id": "patron_scene"
        },
        {
          "name": "K7",
          "sha256": "0d5a33f92411855952db208c292c1b5dca74b71da628a91793005cb57bd747c6",
          "previousSha256": "cda24f53b56ad2c6eb895420f7a0ef0dbeb9b6f0b110cad4d0b0985699d127b2",
          "length": 360,
          "moduleCharacterOffset": 3402482,
          "statementIndex": 908,
          "change": "changed",
          "feature_id": "patron_scene"
        },
        {
          "name": "J7",
          "sha256": "984e989c0104269099b10a2cddbae85ee274644cf6019c9cfe2b5f29906f1f5c",
          "previousSha256": "844d1c4c57a15ac948f04a7b67a49b289cbbb1ac31240e1a2bb0e44479641d06",
          "length": 125,
          "moduleCharacterOffset": 3402842,
          "statementIndex": 909,
          "change": "changed",
          "feature_id": "patron_scene"
        },
        {
          "name": "koBackRoomPrivatePatronCleanup238",
          "sha256": "5411e202e1083466a47074bfb201851c80f93820969a594ba1c36e47c09bdc8c",
          "previousSha256": null,
          "length": 323,
          "moduleCharacterOffset": 3403886,
          "statementIndex": 915,
          "change": "added",
          "feature_id": "patron_scene"
        },
        {
          "name": "hW",
          "sha256": "b571919ec8551d68674d40bd01587a14b7ad56febced94e63b33b17a0ed6b23c",
          "previousSha256": "dd0214a99275b8642451da2d2620cda76ab053897374d274c73155e72ac3fffb",
          "length": 2413,
          "moduleCharacterOffset": 3414584,
          "statementIndex": 930,
          "change": "changed",
          "feature_id": "tavern_rooms_guests"
        },
        {
          "name": "cW",
          "sha256": "1d180446856c1539e8912e4aa96ff488a13a9051478fdffcd021a330c32c2924",
          "previousSha256": "e447589d7a0458a68fa2087e9252d8a9953e8259d3340064810f59f8b82c2744",
          "length": 2134,
          "moduleCharacterOffset": 3416913,
          "statementIndex": 931,
          "change": "changed",
          "feature_id": "tavern_rooms_guests"
        },
        {
          "name": "NW",
          "sha256": "a3c4b9774d670fec4cfce460d06faed2e4c041d172b8f8698ae1390124c3a7fb",
          "previousSha256": "56ab8355092e4cbe21c224b01c286ef49b6982792edb36d8de9e5669e85bb3f7",
          "length": 843,
          "moduleCharacterOffset": 3424289,
          "statementIndex": 952,
          "change": "changed",
          "feature_id": "tavern_rooms_guests"
        },
        {
          "name": "EW",
          "sha256": "fb7609d8ae6f688cae3f75593606abcc6ac8d4e0a59a27600178cc6dd6d5fe1b",
          "previousSha256": "29be71bd17791dbc29260b51c7065540d47f82465e39dd7379941175b46456f1",
          "length": 804,
          "moduleCharacterOffset": 3448593,
          "statementIndex": 959,
          "change": "changed",
          "feature_id": "risk_and_traffic"
        },
        {
          "name": "koAutoRideContext223",
          "sha256": "78e9d445a9543f4be53c1c03646b3d61a06c0ffe6fa8c14b5c62f53f2a23fa62",
          "previousSha256": null,
          "length": 925,
          "moduleCharacterOffset": 3449501,
          "statementIndex": 961,
          "change": "added",
          "feature_id": "wife_initiative"
        },
        {
          "name": "koAutoRideScene223",
          "sha256": "7bb26ada8d103d6138a3c213a5f6b089b5b2bba364f49a62b28d206c12183abc",
          "previousSha256": null,
          "length": 292,
          "moduleCharacterOffset": 3450426,
          "statementIndex": 962,
          "change": "added",
          "feature_id": "wife_initiative"
        },
        {
          "name": "koAutoRideUnfulfilled278",
          "sha256": "b97ce9d0cea4ffba04636987dd916d55be3b98f772b38214767eb152bcd00222",
          "previousSha256": null,
          "length": 231,
          "moduleCharacterOffset": 3450718,
          "statementIndex": 963,
          "change": "added",
          "feature_id": "wife_initiative"
        },
        {
          "name": "koAutoRideLocked223",
          "sha256": "bcdc6ee398836639b224b972dc79317b1bf027c89033768f2affd8ddf282c9ce",
          "previousSha256": null,
          "length": 257,
          "moduleCharacterOffset": 3450885,
          "statementIndex": 964,
          "change": "added",
          "feature_id": "wife_initiative"
        },
        {
          "name": "koAutoRideStart223",
          "sha256": "4599af099412edc31b4e9beb5544f5aa1a8f39e4cb353a34f9bcb8c008d76498",
          "previousSha256": null,
          "length": 2573,
          "moduleCharacterOffset": 3451142,
          "statementIndex": 965,
          "change": "added",
          "feature_id": "wife_initiative"
        },
        {
          "name": "MW",
          "sha256": "51a6743d4ce4e218f817a40d53da25c1bdfecf32750ef750a3516c21eb17ee57",
          "previousSha256": "af86852cf73f7f45e09b48980c3f7935d26cfd65b414ed6329da10441145f484",
          "length": 1718,
          "moduleCharacterOffset": 3452769,
          "statementIndex": 966,
          "change": "changed",
          "feature_id": "risk_and_traffic"
        },
        {
          "name": "BI",
          "sha256": "357165f469649a080adee1f093b2a812bbf9314a2d2ef02d86d1e4de22f190a9",
          "previousSha256": "c70f5d68b798cc6feb055d248a8ffaf95910563358341e28fe7a06ed5534eea4",
          "length": 48,
          "moduleCharacterOffset": 3473551,
          "statementIndex": 980,
          "change": "changed",
          "feature_id": "tavern_rooms_guests"
        },
        {
          "name": "JW",
          "sha256": "dfd2cf4ba915dfdf073cb02e535ba6a9c73a45f529301f68aff609fc167ea0bb",
          "previousSha256": "1c24f290302295c756e6fa53ead255c9dfdd798730dc2292acb60f7ba9709c1e",
          "length": 763,
          "moduleCharacterOffset": 3475959,
          "statementIndex": 991,
          "change": "changed",
          "feature_id": "tavern_rooms_guests"
        },
        {
          "name": "XW",
          "sha256": "a9095175cc2eb62c152f1dd09bb37cea9317bb524316f30f8114ff9ce716ca27",
          "previousSha256": "5d34f37cf26825d70108bbf352a786cd14ce984e1c0faf7a46c0f7a9388422a5",
          "length": 1153,
          "moduleCharacterOffset": 3476464,
          "statementIndex": 993,
          "change": "changed",
          "feature_id": "tavern_rooms_guests"
        },
        {
          "name": "oY",
          "sha256": "8b83f5ed136dc50a93d635c029d44358c0000d1ca9be0aefdd7ae7dd4b64a11c",
          "previousSha256": "d97b9a95c6e8fe7d88aca8a68729b0f658b6da9dda17980b33c0dbaa9b9eaf40",
          "length": 2175,
          "moduleCharacterOffset": 3481096,
          "statementIndex": 1000,
          "change": "changed",
          "feature_id": "tavern_rooms_guests"
        },
        {
          "name": "koDiscreetRenters240",
          "sha256": "c7a61b2fc02111641d1bd53e6dff893648f8cd8798e9680c072d845417950a0e",
          "previousSha256": null,
          "length": 410,
          "moduleCharacterOffset": 3529360,
          "statementIndex": 1048,
          "change": "added",
          "feature_id": "tavern_rooms_guests"
        },
        {
          "name": "Hf",
          "sha256": "ef65b8af1a329f4c1f848c6644ba79957ad88d20c3415c8154a4ffad9b5ee9d5",
          "previousSha256": "f9aa557a1b25c0e62f6c48b6bcc0b3d4a399c0ae4530380d6416203e33c3c355",
          "length": 164,
          "moduleCharacterOffset": 3529770,
          "statementIndex": 1049,
          "change": "changed",
          "feature_id": "tavern_rooms_guests"
        },
        {
          "name": "qY",
          "sha256": "d500c5e0a8e7d54f2288e3c842dfdbd93e1517fabc75ec5433a93b867e475c23",
          "previousSha256": "f048a9a56cae3a79a42e56415ccc2c552bf53d3ae0085bd53b3a7dab5e71ebcc",
          "length": 1692,
          "moduleCharacterOffset": 3531552,
          "statementIndex": 1055,
          "change": "changed",
          "feature_id": "daily_initiative_and_conversation"
        },
        {
          "name": "JI",
          "sha256": "2d77ad0bdece782cd344782b43d3ade00d0313438f130c80920291d98dd54b25",
          "previousSha256": "47958360275469e11034ca85c71b83d1127c49bd0413acdcf90b661e8726b302",
          "length": 608,
          "moduleCharacterOffset": 3533244,
          "statementIndex": 1056,
          "change": "changed",
          "feature_id": "daily_initiative_and_conversation"
        },
        {
          "name": "zY",
          "sha256": "05920778d3524e2d73510b4b1d265bd58bfa793afd88a2e4ccd0cfcced364ecc",
          "previousSha256": "f7f0fb02d0ed8be2e47052344b18272962699beb5a718ecb234ebfe4097d1547",
          "length": 2784,
          "moduleCharacterOffset": 3534133,
          "statementIndex": 1060,
          "change": "changed",
          "feature_id": "daily_initiative_and_conversation"
        },
        {
          "name": "VY",
          "sha256": "8baced26220550201928ebc185473e1ff3397ae4f9eba00d34a9e18c949963f3",
          "previousSha256": "b4c77c74c7ecd993eb30ebe99e3b45a3a959ca379c5283ec6053c7cee8c137ce",
          "length": 577,
          "moduleCharacterOffset": 3536857,
          "statementIndex": 1061,
          "change": "changed",
          "feature_id": "clothing_dares"
        },
        {
          "name": "Y9",
          "sha256": "28b0fcf269001ef2e528a25792f42da6ddb9a7702e1d298f2f10b19f7aaad6c7",
          "previousSha256": "798fe9d6c7ab5f0b6b24640e1117323895e55e2cf4119a2cc1f34769d00ed7d5",
          "length": 1086,
          "moduleCharacterOffset": 3609199,
          "statementIndex": 1183,
          "change": "changed",
          "feature_id": "clothing_dares"
        },
        {
          "name": "G9",
          "sha256": "35a6a754835723cc09426bc2541dbeea6dec895554a3559931c35899628c0726",
          "previousSha256": "69d2f848a2500292eca6ada1382178716b652eb4d6eda4efb000215fad7acfd1",
          "length": 1663,
          "moduleCharacterOffset": 3610725,
          "statementIndex": 1185,
          "change": "changed",
          "feature_id": "clothing_dares"
        },
        {
          "name": "Uh",
          "sha256": "59b14b4961ef20efd40466c0cb27a49a63878661102390e1a51763205a0513f5",
          "previousSha256": "47dac90ced49964b794ace12fa442dd45a1a1006aa4aa2d5e36e2e15df295fcc",
          "length": 4524,
          "moduleCharacterOffset": 3640163,
          "statementIndex": 1223,
          "change": "changed",
          "feature_id": "clothing_dares"
        },
        {
          "name": "koImageNumber297",
          "sha256": "fb06a7d3445ada5bddfa29ff5705efa14f1e7e51c43368bb1cedcbb2c4a74dda",
          "previousSha256": null,
          "length": 255,
          "moduleCharacterOffset": 3682903,
          "statementIndex": 1281,
          "change": "added",
          "feature_id": "image_generation_client"
        },
        {
          "name": "koImageCustom297",
          "sha256": "5bf31b61ab36353c160e01c8e37f9aceb9932d926024cc83afafcbaca662dd64",
          "previousSha256": null,
          "length": 305,
          "moduleCharacterOffset": 3683159,
          "statementIndex": 1282,
          "change": "added",
          "feature_id": "image_generation_client"
        },
        {
          "name": "koImagePrefs297",
          "sha256": "15ef83c651267ddf24556d954eced30b0106df0918ea76a17f3dff4750ec1f31",
          "previousSha256": null,
          "length": 1056,
          "moduleCharacterOffset": 3683465,
          "statementIndex": 1283,
          "change": "added",
          "feature_id": "image_generation_client"
        },
        {
          "name": "koImageSession297",
          "sha256": "6b47022a201c547ac674323c7551594323e060b280273054d4de2d95e6b62eb6",
          "previousSha256": null,
          "length": 284,
          "moduleCharacterOffset": 3684522,
          "statementIndex": 1284,
          "change": "added",
          "feature_id": "image_generation_client"
        },
        {
          "name": "koImageParams297",
          "sha256": "9f59b0c3d731a1d6dd908adcb602b2520c35f159b0a2f6b1dd208562eab792e7",
          "previousSha256": null,
          "length": 151,
          "moduleCharacterOffset": 3684807,
          "statementIndex": 1285,
          "change": "added",
          "feature_id": "image_generation_client"
        },
        {
          "name": "koImageRequest297",
          "sha256": "6cfda6aed1a57dec3c943ad3afc1e26dfd5f84b3ec39fb4c7d55bee6fe1fc783",
          "previousSha256": null,
          "length": 117,
          "moduleCharacterOffset": 3684959,
          "statementIndex": 1286,
          "change": "added",
          "feature_id": "image_generation_client"
        },
        {
          "name": "koImageNotice297",
          "sha256": "9b604689656d4da656ba797ed39376b924f1cfd01800b2ad4e0ab6c4362d4a1a",
          "previousSha256": null,
          "length": 415,
          "moduleCharacterOffset": 3685145,
          "statementIndex": 1288,
          "change": "added",
          "feature_id": "image_generation_client"
        },
        {
          "name": "koImageConnection297",
          "sha256": "568d71711ed5bde62f6e7157a3a291c879baca4614e05e6ed89544e84342b2fe",
          "previousSha256": null,
          "length": 159,
          "moduleCharacterOffset": 3685561,
          "statementIndex": 1289,
          "change": "added",
          "feature_id": "image_generation_client"
        },
        {
          "name": "koImageSave297",
          "sha256": "ecff5cd45d16166fbabf5e66b901a0293dd9ccc46ba774eaafab4fad272a552d",
          "previousSha256": null,
          "length": 370,
          "moduleCharacterOffset": 3685721,
          "statementIndex": 1290,
          "change": "added",
          "feature_id": "image_generation_client"
        },
        {
          "name": "koImageModelOptions297",
          "sha256": "e8de42b1dec12e1996f89780a7384d049bfdb700e91c6eeafd0e5bf9cb75f1ed",
          "previousSha256": null,
          "length": 351,
          "moduleCharacterOffset": 3685988,
          "statementIndex": 1291,
          "change": "added",
          "feature_id": "image_generation_client"
        },
        {
          "name": "koImageNextVariant297",
          "sha256": "3ba193ec8530889744cd247997e2c96da628af5be7c4502f69d7c0ca887e032a",
          "previousSha256": null,
          "length": 402,
          "moduleCharacterOffset": 3686288,
          "statementIndex": 1292,
          "change": "added",
          "feature_id": "image_generation_client"
        },
        {
          "name": "koImageStatus297",
          "sha256": "641ff7c255e70113f774e693f55f60f887132500bb7ff509ebd63aaa2f8f356b",
          "previousSha256": null,
          "length": 479,
          "moduleCharacterOffset": 3686691,
          "statementIndex": 1293,
          "change": "added",
          "feature_id": "image_generation_client"
        },
        {
          "name": "koImageSettings297",
          "sha256": "ac5d669479a7273eb22549c2a9d4a3491f97473de83ad2c4bcd0e348a81e7b68",
          "previousSha256": null,
          "length": 10178,
          "moduleCharacterOffset": 3687171,
          "statementIndex": 1294,
          "change": "added",
          "feature_id": "image_generation_client"
        },
        {
          "name": "cq",
          "sha256": "cdbe7681f149ac50f00e75378d817c588032a814f0f4458af60c0626aa2998de",
          "previousSha256": "f37004fd7ba3f7ad2a343b6fec7b699fc186e86714ae73103092650e2f7474fd",
          "length": 89,
          "moduleCharacterOffset": 3695726,
          "statementIndex": 1295,
          "change": "changed",
          "feature_id": "image_generation_client"
        },
        {
          "name": "Sj",
          "sha256": "a31dcf68cb3a3e1704b3c8b829fe4c1fdbbfa104839ed32104ae7e992932ca7d",
          "previousSha256": "c9e8bf6e25189851f7f93ee9a1a84514158ae76915a2361b676f2b0852d8ce85",
          "length": 116,
          "moduleCharacterOffset": 3730685,
          "statementIndex": 1327,
          "change": "changed",
          "feature_id": "image_generation_client"
        },
        {
          "name": "Mi",
          "sha256": "a9af4d53faf831d4f313ec3a866b9617b8a360b5a71ffb42c8a6c0ad69064690",
          "previousSha256": "fcfba7e2d4be4f9ac6d42c2043b984db7a31564fb16bb7b30d1433e04d90a1b2",
          "length": 330,
          "moduleCharacterOffset": 3736766,
          "statementIndex": 1342,
          "change": "changed",
          "feature_id": "clothing_dares"
        },
        {
          "name": "Rm",
          "sha256": "5ef4120830fe69dbc7ace2b96f56832432cfb1825c41a3a3186e29ca7cb825e5",
          "previousSha256": "69f7272e69b324169d2864fbd43fb2bfa827fde4e82dbff6e8325141c1fd42d7",
          "length": 2653,
          "moduleCharacterOffset": 3803818,
          "statementIndex": 1413,
          "change": "changed",
          "feature_id": "patron_scene"
        },
        {
          "name": "JU",
          "sha256": "74be4f5524b5e617fda2b8d35b1541d32467354d4d91cf8d79042d3eb9d11c9c",
          "previousSha256": "bf66b23a6dddaf21e0c28fdb03c812f8e305293de8289b85aaaf3026276b95a9",
          "length": 952,
          "moduleCharacterOffset": 3807064,
          "statementIndex": 1415,
          "change": "changed",
          "feature_id": "patron_scene"
        },
        {
          "name": "Hj",
          "sha256": "4c1e4213b1ae8162ed28cabb7cca6aa4c30d4487d8bea25f12aeda8c90f84255",
          "previousSha256": "2d10999754e43a3543d3f369d5c2f215f9f499f1eb5cf1ffaa0a5662a3921a0d",
          "length": 1697,
          "moduleCharacterOffset": 3809244,
          "statementIndex": 1423,
          "change": "changed",
          "feature_id": "patron_scene"
        },
        {
          "name": "ez",
          "sha256": "324e77638abf57bb58bebf783c7f28c55147ebd3d3abefdd62a5636c272a85f4",
          "previousSha256": "559f353b9dd4e5bebb9974591e7f636eacc3e6770da9825131bd639009c9d663",
          "length": 2412,
          "moduleCharacterOffset": 3811342,
          "statementIndex": 1426,
          "change": "changed",
          "feature_id": "patron_scene"
        },
        {
          "name": "zj",
          "sha256": "ae9b470a2db99bdaf3269a5a3ce615500584f53c1ac9b514db8549bfe32c0848",
          "previousSha256": "1ef864a17dd6e43687dda4c205de1cfb20f9ba1570b6d52fc5b949e54ee59c8b",
          "length": 732,
          "moduleCharacterOffset": 3837628,
          "statementIndex": 1450,
          "change": "changed",
          "feature_id": "patron_scene"
        },
        {
          "name": "koBookedRenter260",
          "sha256": "775de6832663af23ccf60500a5f0cc16a5bf4eaf2fa4f4c56464d416370e06fd",
          "previousSha256": null,
          "length": 197,
          "moduleCharacterOffset": 3854774,
          "statementIndex": 1468,
          "change": "added",
          "feature_id": "tavern_rooms_guests"
        },
        {
          "name": "Tz",
          "sha256": "c798941fecf9b78a1d445d2ea17a4cd0bd7390300da0e22e8dd99dfb07a41779",
          "previousSha256": "91ad96849856da6616822f9b71e4d8cae9a45bb71b13bfb0cc037795de645a41",
          "length": 784,
          "moduleCharacterOffset": 3854971,
          "statementIndex": 1469,
          "change": "changed",
          "feature_id": "tavern_rooms_guests"
        },
        {
          "name": "koSceneCustomerIds246",
          "sha256": "4548f0c57b2ebdde34caaed6fbac581d94fc7a6ab890cf0d579a11d21e4be7fd",
          "previousSha256": null,
          "length": 511,
          "moduleCharacterOffset": 3855983,
          "statementIndex": 1471,
          "change": "added",
          "feature_id": "patron_scene"
        },
        {
          "name": "koPartyExpiry246",
          "sha256": "aae613b135cba0c6a9a35505c3b0783419a3959884013722e591eaab7760ab07",
          "previousSha256": null,
          "length": 526,
          "moduleCharacterOffset": 3856648,
          "statementIndex": 1472,
          "change": "added",
          "feature_id": "patron_scene"
        },
        {
          "name": "Jj",
          "sha256": "22c131ef0991bbc8b263ef6d1c87f4708bf9861599a861ebb70c50102d24c37e",
          "previousSha256": "7ba75a860401da020ebff7dc68f964ac4fa2341ed720988de59fdf8e3d0c9b04",
          "length": 1930,
          "moduleCharacterOffset": 3857176,
          "statementIndex": 1473,
          "change": "changed",
          "feature_id": "tavern_rooms_guests"
        },
        {
          "name": "fV",
          "sha256": "a046e83a1860bb0d4f612b5acd2e04e1e2189e53aa10f81c57d3e769de4beb90",
          "previousSha256": "1dc84d0dfbd114e8d669b4a08901325cc0e0c223d80dc21aaf6cb1c8dc9b4266",
          "length": 2083,
          "moduleCharacterOffset": 3936662,
          "statementIndex": 1522,
          "change": "changed",
          "feature_id": "patron_scene"
        },
        {
          "name": "kV",
          "sha256": "692fe3538a535396992a62e6585501e1e8fcf7c2ae5ea1b6419ec2c3218b86b5",
          "previousSha256": "3c6573e7a430c967df64d4cc82ff41d3ada959e7c96f8e19ff97902282a40857",
          "length": 554,
          "moduleCharacterOffset": 3939847,
          "statementIndex": 1531,
          "change": "changed",
          "feature_id": "patron_scene"
        },
        {
          "name": "HV",
          "sha256": "1dfe45dc8fb1fde557dea0663457d63d85e389d80ba9d6a13b8145f346784f44",
          "previousSha256": "c341b9e6334da8df5eae87d8aadd203eb6891731bbe274e9f353522d12946cb4",
          "length": 2277,
          "moduleCharacterOffset": 3947305,
          "statementIndex": 1549,
          "change": "changed",
          "feature_id": "risk_and_traffic"
        },
        {
          "name": "oN",
          "sha256": "a7dcc8e84b9ded67e4bc3f78b7f859d2c8db3c7e680eacdb6019f6697c5da2f5",
          "previousSha256": "1501fff9fe9749fbcf0c8e0febdf76ae05dbaf76e4bdea8917b6caf1612bc246",
          "length": 15151,
          "moduleCharacterOffset": 3959289,
          "statementIndex": 1569,
          "change": "changed",
          "feature_id": "patron_scene"
        },
        {
          "name": "ec",
          "sha256": "0ee7566cd062676447c17998779522be11c518337752c3b57be350f3c6750a22",
          "previousSha256": "bbcc2c240a1d9687da8bd3ff42e367bd704d64b7684993d29e38bcffdd044fae",
          "length": 2219,
          "moduleCharacterOffset": 3982427,
          "statementIndex": 1584,
          "change": "changed",
          "feature_id": "patron_scene"
        },
        {
          "name": "sK",
          "sha256": "a88258ef5969c08bc0402aa66f900c58991c2a53b660141ff0f23313060e6cfa",
          "previousSha256": "6da7b69e2fe306e861e36e70e321e5e34ff4c2e2e914aa376e3bb700ceb7d96c",
          "length": 9647,
          "moduleCharacterOffset": 3984317,
          "statementIndex": 1586,
          "change": "changed",
          "feature_id": "patron_scene"
        },
        {
          "name": "hK",
          "sha256": "3b6d086d8dfd6e7054e787eb46ec8557fc17abeb3feb0c8daddc7ecf284968a3",
          "previousSha256": "e36ad262e1036fbc24d9c5174644e34f8cfb6c23db9f91b2efc7891e6333eae6",
          "length": 530,
          "moduleCharacterOffset": 4010637,
          "statementIndex": 1593,
          "change": "changed",
          "feature_id": "patron_scene"
        },
        {
          "name": "koNotorietyRisk253",
          "sha256": "8f8da922517676d10b3f5452260a86d932da1e4e1b5dae558247d43cd75dab41",
          "previousSha256": null,
          "length": 145,
          "moduleCharacterOffset": 4066129,
          "statementIndex": 1653,
          "change": "added",
          "feature_id": "risk_and_traffic"
        },
        {
          "name": "fN",
          "sha256": "947e7525216ea61ca29dc61f5110d794ed7114b887c24fd3e7a646afb61b95ab",
          "previousSha256": "bb14d1b8d1feab1e0cfc5229203c4d4238f79aa729a3ff5d0f1cf1174a0d7fdf",
          "length": 4540,
          "moduleCharacterOffset": 4066392,
          "statementIndex": 1655,
          "change": "changed",
          "feature_id": "risk_and_traffic"
        },
        {
          "name": "As",
          "sha256": "013d436d2fa5c06c486673d4b21c09eee222bb999010fe357820b771bc768ab1",
          "previousSha256": "9ebb9750fc40b7a196bde92dc10ee2f8beb140d680c065ecb6ddcaa0a5657fd2",
          "length": 566,
          "moduleCharacterOffset": 4100912,
          "statementIndex": 1724,
          "change": "changed",
          "feature_id": "daily_initiative_and_conversation"
        },
        {
          "name": "jQ",
          "sha256": "f83d49b5e8b5ad7403b70c3efd884b08db66f4cfd13e37fd00be5c949939bde3",
          "previousSha256": "115e59aa8f9c4d90fa51a30a488c76397f36128968355364fe864e5840c1df52",
          "length": 764,
          "moduleCharacterOffset": 4138373,
          "statementIndex": 1790,
          "change": "changed",
          "feature_id": "patron_scene"
        },
        {
          "name": "WQ",
          "sha256": "002a4ad36dda345a6473c40d0611d89c1cfa49aec74090ccde2e710820b15b5b",
          "previousSha256": "723182efa9420e6767ad9375410b7a56704d8cfcbd9170ed67151bd26315bb04",
          "length": 1544,
          "moduleCharacterOffset": 4148497,
          "statementIndex": 1813,
          "change": "changed",
          "feature_id": "clothing_dares"
        },
        {
          "name": "LN",
          "sha256": "b96a3df30b554d51f860b1c0cfb0e8deee7a4e358f3fa385f2157353b0264af6",
          "previousSha256": "94a38679d09e4da8f38d99ef0c865ac5f7d4af214b9eb606939a874db7bb7261",
          "length": 848,
          "moduleCharacterOffset": 4181161,
          "statementIndex": 1846,
          "change": "changed",
          "feature_id": "patron_scene"
        },
        {
          "name": "LX",
          "sha256": "d50a95be4626608202044cd15b04530c2ae52215ae856898e36c3ae820c7ef8e",
          "previousSha256": "887f5b12e890bf3cd92257c406760ed528c44fad24b2912d206b40f0fbe81198",
          "length": 2968,
          "moduleCharacterOffset": 4205315,
          "statementIndex": 1877,
          "change": "changed",
          "feature_id": "wife_initiative"
        },
        {
          "name": "koPlayerFinishGroup244",
          "sha256": "f4a0399bdd619ee009ef1d558e1eccc089e24d157e0a8dc61ed472c56a69993d",
          "previousSha256": null,
          "length": 360,
          "moduleCharacterOffset": 4207407,
          "statementIndex": 1878,
          "change": "added",
          "feature_id": "player_intimacy"
        },
        {
          "name": "koPlayerFinishAction244",
          "sha256": "f5485bb26ee5d8eb3b8555ede39aa947d596982f69eeea8882887c145c5d62e1",
          "previousSha256": null,
          "length": 584,
          "moduleCharacterOffset": 4207768,
          "statementIndex": 1879,
          "change": "added",
          "feature_id": "player_intimacy"
        },
        {
          "name": "koPlayerFinishChoices244",
          "sha256": "4d15f809a72a599b61e7fda3ba0cbde9dd4c7f3fb7ee0fb24cc14c9a1c7d47f5",
          "previousSha256": null,
          "length": 1543,
          "moduleCharacterOffset": 4208353,
          "statementIndex": 1880,
          "change": "added",
          "feature_id": "player_intimacy"
        },
        {
          "name": "koPlayerFinishReason244",
          "sha256": "0f06e7b9062f762fe6aa9c0d61965afc21207e7a674616bee36097af75f9446b",
          "previousSha256": null,
          "length": 506,
          "moduleCharacterOffset": 4209521,
          "statementIndex": 1881,
          "change": "added",
          "feature_id": "player_intimacy"
        },
        {
          "name": "koPlayerAftermath244",
          "sha256": "ddf9b7cf8a3f1b54777c2e32829fd5e6e2a93c70c4c7469061a8698c2cf79f5e",
          "previousSha256": null,
          "length": 1041,
          "moduleCharacterOffset": 4210028,
          "statementIndex": 1882,
          "change": "added",
          "feature_id": "player_intimacy"
        },
        {
          "name": "koClothingLine244",
          "sha256": "dc961279607ced62b98f8daf11a5e695bfe68361728b614e8bcbdb86c2642974",
          "previousSha256": null,
          "length": 908,
          "moduleCharacterOffset": 4211070,
          "statementIndex": 1883,
          "change": "added",
          "feature_id": "clothing_dares"
        },
        {
          "name": "koPlayerMenuRepair244",
          "sha256": "4ce7a87b94fbf74a5c6fa44e0e50ac1195154aba68f9e024cb04afb6dcd20b84",
          "previousSha256": null,
          "length": 212,
          "moduleCharacterOffset": 4211691,
          "statementIndex": 1884,
          "change": "added",
          "feature_id": "player_intimacy"
        },
        {
          "name": "BX",
          "sha256": "1b73ad8b6019acd9f834383b4a3c0de550df1d881893500a46a1f496820ed8a3",
          "previousSha256": "fec7c50280c72d16646fbdafc68d643b6cac6e7be75158eb4bf6e48ffb52fa7e",
          "length": 1746,
          "moduleCharacterOffset": 4211905,
          "statementIndex": 1885,
          "change": "changed",
          "feature_id": "wife_initiative"
        },
        {
          "name": "Jf",
          "sha256": "d071d3b548fd8041eac598eb10a3aab18dba7821eabfe14dc20efc4e695b52e9",
          "previousSha256": "c08a2461a3a74031807da5f3fade73513dea57da3ef2b93428264af722dfe8f1",
          "length": 493,
          "moduleCharacterOffset": 4214449,
          "statementIndex": 1887,
          "change": "changed",
          "feature_id": "wife_initiative"
        },
        {
          "name": "YX",
          "sha256": "34c59c5ea73b0eb19ca711f884884f4d131026cd43bbd6ea9fc4b8bdcfbe9817",
          "previousSha256": "219a0cf93c9e2dcefec8326d46f6513ef8d49f367d05f2eaf1766b21c8cc80c3",
          "length": 6256,
          "moduleCharacterOffset": 4215674,
          "statementIndex": 1890,
          "change": "changed",
          "feature_id": "player_intimacy"
        },
        {
          "name": "FN",
          "sha256": "fe7ffa4c58ca742025e52114fd84d305eb6ee1f652d9af54db2d7e371eadd73e",
          "previousSha256": "ed4537fee34f4c220ff2e9fda3bf59c723978c40f0b1c0286401d9195014c217",
          "length": 5959,
          "moduleCharacterOffset": 4221122,
          "statementIndex": 1891,
          "change": "changed",
          "feature_id": "player_intimacy"
        },
        {
          "name": "qX",
          "sha256": "3a958f4a2c820bcc5f1112e6471785b6e6befcc4a7cfd157ed735220eacf2a75",
          "previousSha256": "e08706a01a0553ba66ef310a2497fde83be5179d172c6a27f19eeeeb612729a2",
          "length": 326,
          "moduleCharacterOffset": 4226642,
          "statementIndex": 1896,
          "change": "changed",
          "feature_id": "player_intimacy"
        },
        {
          "name": "zN",
          "sha256": "900fcfcd288c6092d63660b6573fe740eb92d319b436c546d9442059944cf45d",
          "previousSha256": "89801e15eef173a6211b9b77dfb94cd16ec822c4e11bd3b23905a87362add61a",
          "length": 799,
          "moduleCharacterOffset": 4226919,
          "statementIndex": 1898,
          "change": "changed",
          "feature_id": "player_intimacy"
        },
        {
          "name": "iT",
          "sha256": "d5a13ffe6d044057c04b44ff4e307a67ae89a3ab5b4c2df8bec94da77f2256b8",
          "previousSha256": "26daccc9be88b953f79662b1496316fe09f70462484909f6d49459a7a76f6b90",
          "length": 838,
          "moduleCharacterOffset": 4228055,
          "statementIndex": 1900,
          "change": "changed",
          "feature_id": "player_intimacy"
        },
        {
          "name": "koWifeSexPhysicalCost215",
          "sha256": "87ffad5e88129dfb46b4bdcb128de2655b31949dcbd972621e5d2acd241214e1",
          "previousSha256": null,
          "length": 585,
          "moduleCharacterOffset": 4228653,
          "statementIndex": 1901,
          "change": "added",
          "feature_id": "player_intimacy"
        },
        {
          "name": "koFinishAfterglow218",
          "sha256": "6632dc9555723cc6cb3a8d563b7fef8ebe01ff5154418cb566e23a822b958b86",
          "previousSha256": null,
          "length": 940,
          "moduleCharacterOffset": 4229238,
          "statementIndex": 1902,
          "change": "added",
          "feature_id": "player_intimacy"
        },
        {
          "name": "lT",
          "sha256": "ebc42165b288def01e206a6f9e557653dcce9e67f24f683aa4ad9ff1a397f7ab",
          "previousSha256": "1ce539f7fe8252ecf27bc39027064fb1b97fb77129eebe2464f7da69ae80e3af",
          "length": 1628,
          "moduleCharacterOffset": 4230118,
          "statementIndex": 1903,
          "change": "changed",
          "feature_id": "player_intimacy"
        },
        {
          "name": "tm",
          "sha256": "0d335ff44470d6d8aead1f306b9d1ae006817cfa537d7b0a689a37e04844df92",
          "previousSha256": "c4c996b302968ad6e6f107ded0cb3f2a93ce90b2d6ec77574d419029720a1e49",
          "length": 455,
          "moduleCharacterOffset": 4231746,
          "statementIndex": 1904,
          "change": "changed",
          "feature_id": "player_intimacy"
        },
        {
          "name": "hT",
          "sha256": "e0a414e401c6054a1d96f9689051ab27adc6dfb25820aa1478ecac0013449b97",
          "previousSha256": "1cbc728a65be49ec019c7e30e3f1f2ba4108b0148874c2fc78ed3e89924656e7",
          "length": 1059,
          "moduleCharacterOffset": 4232201,
          "statementIndex": 1905,
          "change": "changed",
          "feature_id": "player_intimacy"
        },
        {
          "name": "zX",
          "sha256": "ef684a4594d35c7d569029ba7956ae161b84ddfbb1cebb3f28845017a099ee4c",
          "previousSha256": "2a89589dd420a08b0880d97b87219dc7d410228a496df5769f21c2622dcbd851",
          "length": 621,
          "moduleCharacterOffset": 4233260,
          "statementIndex": 1906,
          "change": "changed",
          "feature_id": "player_intimacy"
        },
        {
          "name": "eZ",
          "sha256": "aea73eb10383054ca8a6c7291007c6d90139bd284d61f980f92dc89e2c41c260",
          "previousSha256": "d1c540ca2fc6d2cc2cdfab97f95d9227615a766bf8c28916b087a76e81f792d2",
          "length": 637,
          "moduleCharacterOffset": 4247647,
          "statementIndex": 1919,
          "change": "changed",
          "feature_id": "ntr_and_relationship_endings"
        },
        {
          "name": "koNtrDebugAttachment240",
          "sha256": "fddfdced0feb4f13e3a8fff94bdf4bbc226704614e2e113754d1cd4936a31bfb",
          "previousSha256": null,
          "length": 227,
          "moduleCharacterOffset": 4248102,
          "statementIndex": 1920,
          "change": "added",
          "feature_id": "ntr_and_relationship_endings"
        },
        {
          "name": "koNtrLeavingRisk234",
          "sha256": "695602759da2556953a845532617f91e21e7ffa6e76da90c9809bbbceee4d0e9",
          "previousSha256": null,
          "length": 659,
          "moduleCharacterOffset": 4248329,
          "statementIndex": 1921,
          "change": "added",
          "feature_id": "ntr_and_relationship_endings"
        },
        {
          "name": "koNtrStage265",
          "sha256": "303c6b953cf482c1ae809c4b49c6cdbab4d9194d041de32996226d5718f3c56a",
          "previousSha256": null,
          "length": 315,
          "moduleCharacterOffset": 4248989,
          "statementIndex": 1922,
          "change": "added",
          "feature_id": "ntr_and_relationship_endings"
        },
        {
          "name": "rZ",
          "sha256": "17749b4b281dc3b6f66d861d457ba52671d3300ec77a1d12324b09784676c375",
          "previousSha256": "9fd3997c8e87ad31dd7f34c7f507fb36181df7e6f020a239042f977c2bb41529",
          "length": 1749,
          "moduleCharacterOffset": 4261253,
          "statementIndex": 1926,
          "change": "changed",
          "feature_id": "daily_initiative_and_conversation"
        },
        {
          "name": "dZ",
          "sha256": "b74a4fa2ac2e52e28c4dd9b6584c810a2a52ac3ffde50f2fdd2b72a2e577a236",
          "previousSha256": "3f81c2bed58dc50d354b36f417afdfdd4fbd004ee95577a59cbd34f417bd4feb",
          "length": 441,
          "moduleCharacterOffset": 4280467,
          "statementIndex": 1940,
          "change": "changed",
          "feature_id": "daily_initiative_and_conversation"
        },
        {
          "name": "koIntimateOfferPick221",
          "sha256": "435fbf7eedbee09e48f2d974337ae099722146098d552d0594e4370f873dbeaa",
          "previousSha256": null,
          "length": 441,
          "moduleCharacterOffset": 4302534,
          "statementIndex": 1960,
          "change": "added",
          "feature_id": "patron_scene"
        },
        {
          "name": "koIntimateOfferLegacy221",
          "sha256": "91034e67669423f33e255b394cf7df4f212b453ea561158c3816e6bb1eb651d1",
          "previousSha256": null,
          "length": 179,
          "moduleCharacterOffset": 4302975,
          "statementIndex": 1961,
          "change": "added",
          "feature_id": "patron_scene"
        },
        {
          "name": "CZ",
          "sha256": "3ca8f73941888814274b7ae0f55c94800e5cbbeb0ab498080079c945dc518d0d",
          "previousSha256": "50e199332d4a06a2d9d3a6e12bdfc8b672476d629d773c19fff79273d7e093a5",
          "length": 755,
          "moduleCharacterOffset": 4303154,
          "statementIndex": 1962,
          "change": "changed",
          "feature_id": "daily_initiative_and_conversation"
        },
        {
          "name": "koSituationNormalize230",
          "sha256": "d68f6423645b07cb760c08881f3d71d86f3e33f77324e4f131bea19a5a5e91a2",
          "previousSha256": null,
          "length": 225,
          "moduleCharacterOffset": 4328234,
          "statementIndex": 1981,
          "change": "added",
          "feature_id": "saves_and_migrations"
        },
        {
          "name": "QZ",
          "sha256": "a99caa4e00c4c1471748aaadc7677d108ac7dce9f6af8304f5661f44fafa9d20",
          "previousSha256": "1c3c5c1fd3874a6286226e1381272c9d2b98f553c3a062abae512abf35d386f7",
          "length": 538,
          "moduleCharacterOffset": 4333180,
          "statementIndex": 1991,
          "change": "changed",
          "feature_id": "tavern_rooms_guests"
        },
        {
          "name": "koCollectorRelieveStreak",
          "sha256": "41293619c8a7cdadc7b54e20eefece73f50162672b41f1a90db7c9ae416911b6",
          "previousSha256": null,
          "length": 246,
          "moduleCharacterOffset": 4340382,
          "statementIndex": 2010,
          "change": "added",
          "feature_id": "collector_and_notoriety_endings"
        },
        {
          "name": "koCollectorPresence285",
          "sha256": "c961a02abdbcc54132faed493fbebb6f6f9d9cc619a197ced357c095065e79c2",
          "previousSha256": null,
          "length": 152,
          "moduleCharacterOffset": 4340628,
          "statementIndex": 2011,
          "change": "added",
          "feature_id": "collector_and_notoriety_endings"
        },
        {
          "name": "koCollectorStallNotice",
          "sha256": "ebd046aaae57a00dcd123581d7ff454a8c6da48ada1dd2131a077d2d6f720a36",
          "previousSha256": null,
          "length": 2264,
          "moduleCharacterOffset": 4340780,
          "statementIndex": 2012,
          "change": "added",
          "feature_id": "collector_and_notoriety_endings"
        },
        {
          "name": "koCollectorGameOver239",
          "sha256": "1356b5aca015f01dd8fe5a8a0ea5302dd1449bb0445306e0b6a14560abe6e53f",
          "previousSha256": null,
          "length": 1906,
          "moduleCharacterOffset": 4342078,
          "statementIndex": 2013,
          "change": "added",
          "feature_id": "collector_and_notoriety_endings"
        },
        {
          "name": "koApplyCollectorReenable239",
          "sha256": "c20c67cf7807f4b6c04c4015b1c4fb13df2344ca29633c491ab920a5995efd0d",
          "previousSha256": null,
          "length": 298,
          "moduleCharacterOffset": 4343026,
          "statementIndex": 2014,
          "change": "added",
          "feature_id": "collector_and_notoriety_endings"
        },
        {
          "name": "nb",
          "sha256": "450a3efc72f5f4a3678f0d7a7ac19e6b8e233ce27e287ecb62cb14c52abfce39",
          "previousSha256": "153761aac4f9a11405e6f09779eb0c1f106f448b2635bd90e749d7cd40e7b8f4",
          "length": 208,
          "moduleCharacterOffset": 4343324,
          "statementIndex": 2015,
          "change": "changed",
          "feature_id": "collector_and_notoriety_endings"
        },
        {
          "name": "_ee",
          "sha256": "b5dcad49b3c1d2c60f3d3173f200312df25a0208d5c9ed48e2d16ca7e49d5497",
          "previousSha256": "1f85fea81dfdae6f274163dbd1ca5420a5c82b42e2bdfec2d29b6eab25053f43",
          "length": 3030,
          "moduleCharacterOffset": 4343993,
          "statementIndex": 2019,
          "change": "changed",
          "feature_id": "collector_and_notoriety_endings"
        },
        {
          "name": "zee",
          "sha256": "9e82630124ad26c96d38f31c8f8a0fa8e9748855fdf3f08342936de823b1239a",
          "previousSha256": "fbfb5ecddf8c721c9cc247d53033a5afac1e54d818b558cc66227cdaca1a8fb4",
          "length": 479,
          "moduleCharacterOffset": 4364723,
          "statementIndex": 2052,
          "change": "changed",
          "feature_id": "daily_initiative_and_conversation"
        },
        {
          "name": "Ol",
          "sha256": "511c9e990c3c775a8f62ac7f522c87e8202b9ec0964f07749182d5f038a37611",
          "previousSha256": "00c3a5911f145ec7179c85e9729a4b9355a8a6264d3acf3a275fb9212bdcdf1d",
          "length": 3402,
          "moduleCharacterOffset": 4365366,
          "statementIndex": 2054,
          "change": "changed",
          "feature_id": "collector_and_notoriety_endings"
        },
        {
          "name": "Xee",
          "sha256": "6920effaf05a57769a81a13c345d5288b53a30a6265bc786ff32af073e1ce48f",
          "previousSha256": "2f81c314ea210038842542e564b9c71f3b23a7f69b43f2117f1e91fc4b8fc764",
          "length": 1366,
          "moduleCharacterOffset": 4371059,
          "statementIndex": 2063,
          "change": "changed",
          "feature_id": "localization_narration"
        },
        {
          "name": "Zr",
          "sha256": "3dadaf6d8f32d450fff2e3e9f52b40ecde2b70e2b6301b08704c45c5d871b16b",
          "previousSha256": "271e511deed6f817bf69d4428dde2ebab69b3d9e709eb0384212dcd5f9a48472",
          "length": 2925,
          "moduleCharacterOffset": 4374751,
          "statementIndex": 2070,
          "change": "changed",
          "feature_id": "collector_and_notoriety_endings"
        },
        {
          "name": "ste",
          "sha256": "af97f53e049b779f884c0409619b13315220a73610d270a3f418b745181886bf",
          "previousSha256": "0ccd6a00f25b8fd78a31c09f20f9286e139b1f68dc09a0e93daa1fb11ab4fd5d",
          "length": 4800,
          "moduleCharacterOffset": 4378730,
          "statementIndex": 2075,
          "change": "changed",
          "feature_id": "collector_and_notoriety_endings"
        },
        {
          "name": "Aa",
          "sha256": "08c4b13d4a548a3e73286ab00e297211efd3a928c3014a82761d80adfc1cd9fa",
          "previousSha256": "bbf124c612d0e61bfa229aacc9ef63a593906c44892dd8b322c550bbd5a9c982",
          "length": 3082,
          "moduleCharacterOffset": 4389649,
          "statementIndex": 2098,
          "change": "changed",
          "feature_id": "collector_and_notoriety_endings"
        },
        {
          "name": "vte",
          "sha256": "8f5a19380d1a9912f3902c2e882d31320611adfc39fda571cbd84d46399325ac",
          "previousSha256": "2d1838793c0efc0ec4ee2369b2282d4d4fc7720004045ded28e5cbd1b83a9a00",
          "length": 7883,
          "moduleCharacterOffset": 4393559,
          "statementIndex": 2101,
          "change": "changed",
          "feature_id": "daily_initiative_and_conversation"
        },
        {
          "name": "jte",
          "sha256": "a5f35385d166f7b7ac53032dd73f236d463617aefaed85af932983d66145fda9",
          "previousSha256": "72e30d5f7ef584ef98e0e83703f73e31142783125bf6f4695951f3a5776ee769",
          "length": 1162,
          "moduleCharacterOffset": 4403395,
          "statementIndex": 2107,
          "change": "changed",
          "feature_id": "tavern_rooms_guests"
        },
        {
          "name": "koNtrAtWake250",
          "sha256": "5aa130a54da9686756ccc556e18831c33bb4a3ba37e91c6c4f2ff3f4b0e87b45",
          "previousSha256": null,
          "length": 494,
          "moduleCharacterOffset": 4445819,
          "statementIndex": 2239,
          "change": "added",
          "feature_id": "ntr_and_relationship_endings"
        },
        {
          "name": "w0",
          "sha256": "e602aa956b802c00bfafb1bf7dbd5a376aae6e6f007beb51afd883bfeb10f3c8",
          "previousSha256": "8cfd7dd95841151d65f53c23866c82a1119ee4ff883305dbe58378552e2474e6",
          "length": 5776,
          "moduleCharacterOffset": 4446314,
          "statementIndex": 2240,
          "change": "changed",
          "feature_id": "collector_and_notoriety_endings"
        },
        {
          "name": "Vne",
          "sha256": "855074305e9043d684eeaee639a7cf48aa65e28f4c7b8a459421a03627c0dd1a",
          "previousSha256": "4cc05c0d142c6a17302df49fc7dc06231fae136dfa370662d60b30a366ad9da0",
          "length": 9307,
          "moduleCharacterOffset": 4463465,
          "statementIndex": 2265,
          "change": "changed",
          "feature_id": "daily_initiative_and_conversation"
        },
        {
          "name": "Jne",
          "sha256": "78a2f21702cbc1cfc3f791a824f4f50bb5a09ebd4f2518d7147a07fc84ac1987",
          "previousSha256": "6fbf2d09b976f08d0530d2d69669331b67a6d55fd8caa84e900551ab852ce8e8",
          "length": 6300,
          "moduleCharacterOffset": 4473127,
          "statementIndex": 2270,
          "change": "changed",
          "feature_id": "collector_and_notoriety_endings"
        },
        {
          "name": "FC",
          "sha256": "4241ccc4664b6c7b92f0bdb4b962485290b98980ea008a557126e83804483a0b",
          "previousSha256": "07d06634428f5420df78a60d91e9bc2ce1208cdd4149cb4d3701d69e16871c28",
          "length": 319,
          "moduleCharacterOffset": 4479245,
          "statementIndex": 2271,
          "change": "changed",
          "feature_id": "collector_and_notoriety_endings"
        },
        {
          "name": "cp",
          "sha256": "dad6c41d5f69fc498caef4ad53b150487039e14f9a21d4d34ac94b01a0422bf6",
          "previousSha256": "d8d80d117f5d82c464733752c0e94042c018040fbc56dbbc3c71a5b78ff29236",
          "length": 1803,
          "moduleCharacterOffset": 4485751,
          "statementIndex": 2283,
          "change": "changed",
          "feature_id": "collector_and_notoriety_endings"
        },
        {
          "name": "ose",
          "sha256": "2fb6a3c607acf88107505e05100737f14bd2a035a51c9540c77c123f80fb4163",
          "previousSha256": "adda855da7cffcccd5161d0a1d6b30a56cd24437af2c0492372b0df9a5519e57",
          "length": 1204,
          "moduleCharacterOffset": 4487448,
          "statementIndex": 2284,
          "change": "changed",
          "feature_id": "collector_and_notoriety_endings"
        },
        {
          "name": "nse",
          "sha256": "61c2f3f49b2cd6ced75e363b8b4428f8d57d301949c878b831c500c2f1a0546c",
          "previousSha256": "3030aa4aca50d74fcbeda42c0ae3798c456e20756e3c424e6ed65195bae77ad8",
          "length": 359,
          "moduleCharacterOffset": 4488859,
          "statementIndex": 2286,
          "change": "changed",
          "feature_id": "ntr_and_relationship_endings"
        },
        {
          "name": "dse",
          "sha256": "d9b183a60c9c0097ff42b3db2e6637116de4859571b34b8c17439926d9028303",
          "previousSha256": "804ed8bbd7d627401b9689c29bfeca66400e6e6549fec5717e4b6e77c825b9b7",
          "length": 3225,
          "moduleCharacterOffset": 4491431,
          "statementIndex": 2295,
          "change": "changed",
          "feature_id": "ntr_and_relationship_endings"
        },
        {
          "name": "zm",
          "sha256": "81c2c4fadbdfac6d2f4fd6e2974c20950abc3987fb4564fafe5129f2fac688c7",
          "previousSha256": "681257061648b23e46dcccd8987e6c037db01b682f86f10f83505ad4629a33ce",
          "length": 598,
          "moduleCharacterOffset": 4495488,
          "statementIndex": 2301,
          "change": "changed",
          "feature_id": "saves_and_migrations"
        },
        {
          "name": "_se",
          "sha256": "5112e6f26b57a146bd360f70d0607ab778251c7275979bfc106ccc2e0b671bc7",
          "previousSha256": "1801c678146b2c88ae9ea94967e16ced540b9770da4c7440cbcb13e66b1cc996",
          "length": 254,
          "moduleCharacterOffset": 4496161,
          "statementIndex": 2303,
          "change": "changed",
          "feature_id": "saves_and_migrations"
        },
        {
          "name": "gse",
          "sha256": "7b5af7491c5bea6cc1cd6d70097bba7f638a2ac7651d299b584bbac192182a13",
          "previousSha256": "28666cbc4267688d8657ed82186a2fc816482abc27dcf3463b17e7aa7760c478",
          "length": 266,
          "moduleCharacterOffset": 4496375,
          "statementIndex": 2304,
          "change": "changed",
          "feature_id": "saves_and_migrations"
        },
        {
          "name": "bse",
          "sha256": "09b5422986802e7a712e709843bffd27014956256978e3fab56cf810213814c4",
          "previousSha256": "67390dc654522ed031c3d8a717b1bc979176b088600474136ace809b5d2e51dd",
          "length": 427,
          "moduleCharacterOffset": 4496721,
          "statementIndex": 2307,
          "change": "changed",
          "feature_id": "saves_and_migrations"
        },
        {
          "name": "v0",
          "sha256": "10d2be7a031b53fd07354988e0d4d3913f4057bf6e54d0ac8ee068f6435b19da",
          "previousSha256": "cb88c5fdac4bb66d0e8f84838802a4efd491d4d9785976441b8052c59afadab9",
          "length": 726,
          "moduleCharacterOffset": 4497116,
          "statementIndex": 2308,
          "change": "changed",
          "feature_id": "saves_and_migrations"
        },
        {
          "name": "wse",
          "sha256": "aef113fe299c49c4fbe17140366791a697a4d25c1a31528243ecaeed84891e97",
          "previousSha256": "c5456286eae180efac62409ca40dfb9ad417bad022f4ae8ceb530a114bc874dc",
          "length": 262,
          "moduleCharacterOffset": 4497842,
          "statementIndex": 2309,
          "change": "changed",
          "feature_id": "saves_and_migrations"
        },
        {
          "name": "Hh",
          "sha256": "e38b2a395ba53593485a22603fbd23b2352d1e9d2c5dcbaa7e01b0a3884c4fb0",
          "previousSha256": "cb0e663297401648f2492345823d85529f647ecb311f10538d853458f10e596c",
          "length": 387,
          "moduleCharacterOffset": 4498104,
          "statementIndex": 2310,
          "change": "changed",
          "feature_id": "saves_and_migrations"
        },
        {
          "name": "kse",
          "sha256": "0e5995451c810a88f337f64423c0dbd1399c43d8f7ec60bdfac26c2d90e863a1",
          "previousSha256": "41caa784db31cf02fd22ccf21c74c2bca355b68754b512e6ffe0b8e6d2d9ed9d",
          "length": 126,
          "moduleCharacterOffset": 4498473,
          "statementIndex": 2311,
          "change": "changed",
          "feature_id": "saves_and_migrations"
        },
        {
          "name": "vse",
          "sha256": "cc7192f856dc4200a0bcea465f7e0b6d29e234437af4b49aaf3871bd2f27f6a0",
          "previousSha256": "b393cea3b00c4b28a581690a56892287b7ae7e8bb59b3b1025aecd0e671b4180",
          "length": 179,
          "moduleCharacterOffset": 4498599,
          "statementIndex": 2312,
          "change": "changed",
          "feature_id": "saves_and_migrations"
        },
        {
          "name": "x0",
          "sha256": "3aacd7700388a2ea1d434594cc89300b60efbb12c776c82253a2b929de2744bb",
          "previousSha256": "96e43e7ae3096a2e0f66ea1518ade86b4b9e92eb000ff21c257415b6c41da8b2",
          "length": 3537,
          "moduleCharacterOffset": 4498778,
          "statementIndex": 2313,
          "change": "changed",
          "feature_id": "saves_and_migrations"
        },
        {
          "name": "a5",
          "sha256": "072e4e02f6f15a93204c30a295adc936654aa74f98b1b3e4c9ff888bd799be46",
          "previousSha256": "7b001901fb711d68966c2414a28213fb5b22403934d4cbc77f80cf7332850924",
          "length": 15346,
          "moduleCharacterOffset": 4712887,
          "statementIndex": 2413,
          "change": "changed",
          "feature_id": "game_ui_and_cheat"
        },
        {
          "name": "qre",
          "sha256": "47e0dbab22d960ce3957f3594da5618461b2e75d2caef039ae281187d5007d00",
          "previousSha256": "d9abde129e69ecb543c8b34f058dd92d294671232aa00c42c19c1880dbefbedd",
          "length": 122,
          "moduleCharacterOffset": 4739157,
          "statementIndex": 2424,
          "change": "changed",
          "feature_id": "image_generation_client"
        },
        {
          "name": "Kre",
          "sha256": "1d98f7908b92b3f6e868418906729557ca0c02524e5f9d453cc4826fb4087ea4",
          "previousSha256": "a5b2642a85590829924bb01b02c71a28cbebedee561b9f3ac003717037d0a44c",
          "length": 309,
          "moduleCharacterOffset": 4740257,
          "statementIndex": 2430,
          "change": "changed",
          "feature_id": "image_generation_client"
        },
        {
          "name": "Vh",
          "sha256": "0b7506e857e3130630af1c0643dc63d501518245f2ef0170002bc886bd6e24ee",
          "previousSha256": "d41b499d8e16d1f85238fc500e6e0dc1d7e9fe56a19e65feabc0593993b0aa75",
          "length": 101,
          "moduleCharacterOffset": 4742153,
          "statementIndex": 2439,
          "change": "changed",
          "feature_id": "image_generation_client"
        },
        {
          "name": "c3",
          "sha256": "61f1dcca24fdbfcdd8b7ebd8062ea36b97f3d95cbcd65463ad28af3a92c00ed1",
          "previousSha256": "8aef0f8f8731d2284e1b3f4ea26c9174ed5cec7b4d73d263804291003f3a96bb",
          "length": 161,
          "moduleCharacterOffset": 4742279,
          "statementIndex": 2441,
          "change": "changed",
          "feature_id": "image_generation_client"
        },
        {
          "name": "eae",
          "sha256": "29b3c443b50c2765dec6af92e812586f62513782b5f6cba67adb3d71ef586e0e",
          "previousSha256": "de66ec77fcd4a3bf0ec52ba1309ed3a89143bb47b4aa34062b16e1e2d253b0e9",
          "length": 111,
          "moduleCharacterOffset": 4742440,
          "statementIndex": 2442,
          "change": "changed",
          "feature_id": "image_generation_client"
        },
        {
          "name": "nae",
          "sha256": "9dc4b1c84b35c9525f94ff1032899dcc87b33d238846c4aa876a27583f9f0f0f",
          "previousSha256": "13770c4b4d80934397b09f1bacf3a05e9a3881b020d5af142712b3a16d3d06ab",
          "length": 264,
          "moduleCharacterOffset": 4744571,
          "statementIndex": 2458,
          "change": "changed",
          "feature_id": "image_generation_client"
        },
        {
          "name": "R0",
          "sha256": "cb2dd128f21ed642f6af7f762c1937eb1b67cf42e744e6cb5c35d38d92ba3b6f",
          "previousSha256": "4c60050e65d64b9f2487a7aa16aff682c613b4972720078ca39fde5480d68bc5",
          "length": 300,
          "moduleCharacterOffset": 4746771,
          "statementIndex": 2468,
          "change": "changed",
          "feature_id": "image_generation_client"
        },
        {
          "name": "uae",
          "sha256": "33c7509a24949592c00467e5fc71f37a472904e057ef2fe843d7f93b33e494e6",
          "previousSha256": "f36daa7f2dcb05f066af4b8aa2f1d89c4c68c70d5a5a9cc11ae414dd0906e23b",
          "length": 322,
          "moduleCharacterOffset": 4748198,
          "statementIndex": 2473,
          "change": "changed",
          "feature_id": "image_generation_client"
        },
        {
          "name": "pae",
          "sha256": "7ba2856a938c0a785d8c92bf7d7e77651cdf048ce046cb82d788302d62864a73",
          "previousSha256": "48f1101c450d88467c1d898d5d1d3e9d82162daa49e851179939161822bf45e0",
          "length": 1621,
          "moduleCharacterOffset": 4748880,
          "statementIndex": 2476,
          "change": "changed",
          "feature_id": "image_generation_client"
        },
        {
          "name": "_ae",
          "sha256": "276058d986438f295be4e1efe5356e300b35ed2b4492443171031b6dfc439ffa",
          "previousSha256": "58b36c66235a9759a79e728416363cf940db5028aaa0ac2e3beb11e3a37e659c",
          "length": 1079,
          "moduleCharacterOffset": 4750540,
          "statementIndex": 2478,
          "change": "changed",
          "feature_id": "image_generation_client"
        },
        {
          "name": "Sae",
          "sha256": "c84d0b375fd3c5b557e3aeca0d8facf7d1f25def876e5b20f642e1ae0b67ccf2",
          "previousSha256": "d41088fbba74154cb2b085a4325471987896bb47e37dc50f912aba4d0e977f6b",
          "length": 247,
          "moduleCharacterOffset": 4757874,
          "statementIndex": 2494,
          "change": "changed",
          "feature_id": "image_generation_client"
        },
        {
          "name": "M0",
          "sha256": "48ec8c313b5211c33e0ec74c7221eac9d6a3d8c9cd2a04f342c9acbc1e6dd9d6",
          "previousSha256": "5b8051ae4a0848f449804f8857ca34ccc0482629630f5f77c7351bf2d0ef7f8d",
          "length": 11286,
          "moduleCharacterOffset": 4758768,
          "statementIndex": 2502,
          "change": "changed",
          "feature_id": "image_generation_client"
        },
        {
          "name": "sie",
          "sha256": "5188409a82f691366c81b4b76b858d80e178f0fe7a49e64dbf0087092013e350",
          "previousSha256": "1aa88c8c7797a7fa4e13f900db772680dbac6411b1029461a680f7e72534c26a",
          "length": 5942,
          "moduleCharacterOffset": 4796986,
          "statementIndex": 2540,
          "change": "changed",
          "feature_id": "game_ui_and_cheat"
        },
        {
          "name": "iie",
          "sha256": "3fa34386955130aa3ff31863e9643592acc277d708f3431d5bab003828d48d7f",
          "previousSha256": "80037662b58c5d97b3ef551d70107effcc600892c75158ade710ddf7cf9b1922",
          "length": 4789,
          "moduleCharacterOffset": 4806635,
          "statementIndex": 2543,
          "change": "changed",
          "feature_id": "game_ui_and_cheat"
        },
        {
          "name": "koActiveAfterglowAffinity291",
          "sha256": "74b2a942fd1302f8e2697c61aa22b73d54766757eb829a8d45a542d1af65abe6",
          "previousSha256": null,
          "length": 843,
          "moduleCharacterOffset": 4824503,
          "statementIndex": 2568,
          "change": "added",
          "feature_id": "player_intimacy"
        },
        {
          "name": "koAfterglowTime291",
          "sha256": "d18b3167dd7dae80734a9042d5be354df6bcad164d60888bbbb84472eef0e692",
          "previousSha256": null,
          "length": 158,
          "moduleCharacterOffset": 4825323,
          "statementIndex": 2569,
          "change": "added",
          "feature_id": "player_intimacy"
        },
        {
          "name": "koAfterglowAffinity291",
          "sha256": "f8eb6de7482cdf63c47d82e81e7be158553f1bbe608bc1fe7ea1cd3bd1e6f049",
          "previousSha256": null,
          "length": 684,
          "moduleCharacterOffset": 4825474,
          "statementIndex": 2570,
          "change": "added",
          "feature_id": "player_intimacy"
        },
        {
          "name": "E3",
          "sha256": "53f72cca9d88cd2b12c62d9211e0a9820f03d2946430e86bb58d9b2905eafe8e",
          "previousSha256": "682c83f27a6dfec85d5b1cea4906ae5c28eef4625a7f51f88edbfb45a87442da",
          "length": 7902,
          "moduleCharacterOffset": 4828520,
          "statementIndex": 2574,
          "change": "changed",
          "feature_id": "game_ui_and_cheat"
        },
        {
          "name": "Eie",
          "sha256": "8a117c1a61b19237606afa7bb6b4f3d4698cc36232dc1e89188c77bda9499e29",
          "previousSha256": "f56ade64b96e05622f8aaf7bb8c4fc95113597065ad5114140894cee199c7b50",
          "length": 546,
          "moduleCharacterOffset": 4842513,
          "statementIndex": 2582,
          "change": "changed",
          "feature_id": "game_ui_and_cheat"
        },
        {
          "name": "sf",
          "sha256": "20fc6ddfcba498562548d835febfd0eb32ff1f8e751cca5ee9c7f99f61220615",
          "previousSha256": "01549bc129769c3b7ec438bddae2f9bf3114a4caaa3f20f391cc4f385fa97bc9",
          "length": 5644,
          "moduleCharacterOffset": 4897561,
          "statementIndex": 2648,
          "change": "changed",
          "feature_id": "saves_and_migrations"
        },
        {
          "name": "xle",
          "sha256": "9ed1a15720544caccbebeea5f77702971d956e9f7924ecb8be2b8f23e4061017",
          "previousSha256": "c1207c7c01349dc75af3472dc012af96c363067fce74dc96ba7da0a6878dbf8f",
          "length": 1188,
          "moduleCharacterOffset": 4902844,
          "statementIndex": 2651,
          "change": "changed",
          "feature_id": "saves_and_migrations"
        },
        {
          "name": "Tle",
          "sha256": "43671c957fe33516a643c0641bc8da0dd61193ffa0c87e3e172714c60f2b824e",
          "previousSha256": "6494bfa968d38e6eb69e1b048a2b75a83e4e432c30f41475a7f2154dbf90e3aa",
          "length": 747,
          "moduleCharacterOffset": 4904150,
          "statementIndex": 2653,
          "change": "changed",
          "feature_id": "saves_and_migrations"
        },
        {
          "name": "G3",
          "sha256": "0a8c3c9ded86962e3aa1e02c1b07608c3fb1ccec59f75fd401fc7af8749f197e",
          "previousSha256": "8aa4e9ff9abcdf149b936fabce9820cffcb1647cea33c55c1774aff972aedbf5",
          "length": 760,
          "moduleCharacterOffset": 4904827,
          "statementIndex": 2654,
          "change": "changed",
          "feature_id": "saves_and_migrations"
        },
        {
          "name": "$le",
          "sha256": "14c39e15c2e7c8791637e874b1ce6c6461522f1047883b3330225604aed986ab",
          "previousSha256": "598e1d42349d29eb79c1e4a652313c2086a7b1b4ce04d783b555cba21496651c",
          "length": 2494,
          "moduleCharacterOffset": 4905472,
          "statementIndex": 2655,
          "change": "changed",
          "feature_id": "rich_ending"
        },
        {
          "name": "she",
          "sha256": "c2dcfb8a1c54c19c157c7a39154e4c9ae6bf41487d8c365f8b0fdf4c7982a8bf",
          "previousSha256": "2a8585d723eee5a7e0ab57aff251954ca1ba4e35937264048fd946ef2003d6b0",
          "length": 800,
          "moduleCharacterOffset": 5073777,
          "statementIndex": 2677,
          "change": "changed",
          "feature_id": "image_generation_client"
        },
        {
          "name": "lhe",
          "sha256": "6a436bef7b3237481b7a3d8ede67c350f12d0b6d944ecfafe8ad0a809099572a",
          "previousSha256": "a77a5be52cf22036ea1cc9a612ec6285867e92b7be88b313e708a9a4c05189ea",
          "length": 5707,
          "moduleCharacterOffset": 5075253,
          "statementIndex": 2682,
          "change": "changed",
          "feature_id": "image_generation_client"
        },
        {
          "name": "hhe",
          "sha256": "3429cc55eb87c008fa21eb244d2094b73cff1dbe93b63fb0463c0f38d9d77ed9",
          "previousSha256": "c2552f97a997562ebd0225c8f2539f560873986e87e23c5fa733207defff2385",
          "length": 3373,
          "moduleCharacterOffset": 5080325,
          "statementIndex": 2683,
          "change": "changed",
          "feature_id": "image_generation_client"
        },
        {
          "name": "yhe",
          "sha256": "955f0364d3ad635f525c23cad69b61fbeaaec44e0fca91094a0321f4f92d1157",
          "previousSha256": "691ba4c6f55e4a19c6290247d9eb7cf8dee14d318fcb04dca859a4c0af4dd1f4",
          "length": 2104,
          "moduleCharacterOffset": 5102063,
          "statementIndex": 2707,
          "change": "changed",
          "feature_id": "image_generation_client"
        },
        {
          "name": "koModSettingsDialog239",
          "sha256": "6aa3b7122803231166ad121661f52e00800f0b6fa4677e057916fb3ac3d08b71",
          "previousSha256": null,
          "length": 4825,
          "moduleCharacterOffset": 5109124,
          "statementIndex": 2710,
          "change": "added",
          "feature_id": "settings_and_visitors"
        },
        {
          "name": "whe",
          "sha256": "698f69425d583acabbb82ca8592f32ece7cae5c6bd010adf1f7b2c3eee6e4026",
          "previousSha256": "fbf1f1b29d5099db7f96565d48e846edc86f56ed2e409110e309c357a0b90825",
          "length": 2388,
          "moduleCharacterOffset": 5113138,
          "statementIndex": 2711,
          "change": "changed",
          "feature_id": "game_ui_and_cheat"
        },
        {
          "name": "Vhe",
          "sha256": "de8ec19438b913a5c171dce1558fac5ae192fc369cc03dd12c8d4f1c96626d59",
          "previousSha256": "a861c98df01a1ab02b60bcf8ed64237dc7ae5bb959bdf2c519626b4fe966c570",
          "length": 16107,
          "moduleCharacterOffset": 5224603,
          "statementIndex": 2744,
          "change": "changed",
          "feature_id": "image_generation_client"
        },
        {
          "name": "nce",
          "sha256": "1b59a78b93415f1c64777b2914268ad8358166a4811cc3cb92ed6ad9b1ab6a8f",
          "previousSha256": "5aa228c2a59f026b16ebcb0737d6fb304dd32fac8c0d3b2da1acfe02697674e3",
          "length": 978,
          "moduleCharacterOffset": 5250102,
          "statementIndex": 2770,
          "change": "changed",
          "feature_id": "image_generation_client"
        }
      ],
      "variables": [
        {
          "name": "koVoiceData137",
          "sha256": "f89ce4df53b43da7057344511a8f6e09990a598fe81fdc2f7bdedd35085e0bd3",
          "previousSha256": "eeccee4ad10f13909ab68cb24d894d11c69464ec63a2cf4b0fe033f158f6bb90",
          "length": 440775,
          "moduleCharacterOffset": 6,
          "statementIndex": 0,
          "change": "changed",
          "feature_id": "localization_narration",
          "declarationKind": "const"
        },
        {
          "name": "KO_STORAGE293",
          "sha256": "eed3c0902941a0222b0e1cf1443bc188d33732817d054c8a3fb5d1f72a553d69",
          "previousSha256": null,
          "length": 178,
          "moduleCharacterOffset": 260646,
          "statementIndex": 21,
          "change": "added",
          "feature_id": "saves_and_migrations",
          "declarationKind": "const"
        },
        {
          "name": "koModRecoveryNotice293",
          "sha256": "a89989061511ed8d4fa24089df6e4325d9ea92fdc1af4b9c8d854d7df712048c",
          "previousSha256": null,
          "length": 179,
          "moduleCharacterOffset": 261193,
          "statementIndex": 24,
          "change": "added",
          "feature_id": "saves_and_migrations",
          "declarationKind": "const"
        },
        {
          "name": "KO_LEGACY_DAYS_HIDDEN294",
          "sha256": "81d94bce6e642870c2b00c0eac7d28056f6150edacc1ba82e4e71256f111ed9a",
          "previousSha256": null,
          "length": 62,
          "moduleCharacterOffset": 263548,
          "statementIndex": 31,
          "change": "added",
          "feature_id": "saves_and_migrations",
          "declarationKind": "const"
        },
        {
          "name": "KO_AUTO_READ_NOTICE294",
          "sha256": "d88a60f97056504d7c14a80b98b2a1bfe43eff2b9a67bb2b339e0cae7ebf8c19",
          "previousSha256": null,
          "length": 189,
          "moduleCharacterOffset": 263618,
          "statementIndex": 32,
          "change": "added",
          "feature_id": "saves_and_migrations",
          "declarationKind": "const"
        },
        {
          "name": "koStorageWarnings294",
          "sha256": "e6001392f14dfecec466eb255130c924126f40df72385e2112cbc2d83cf72077",
          "previousSha256": null,
          "length": 30,
          "moduleCharacterOffset": 263721,
          "statementIndex": 33,
          "change": "added",
          "feature_id": "saves_and_migrations",
          "declarationKind": "const"
        },
        {
          "name": "koLegacyDayReset294",
          "sha256": "6121a803efd3ea356fdd2e999f755f8c6ec8d9ff40362caca0640be0a7b80048",
          "previousSha256": null,
          "length": 25,
          "moduleCharacterOffset": 263757,
          "statementIndex": 34,
          "change": "added",
          "feature_id": "saves_and_migrations",
          "declarationKind": "let"
        },
        {
          "name": "KO_MOD_SETTINGS_KEY239",
          "sha256": "459bf95c48a7569a8fc6e3ee0e7388c1d7574c82b3217f62dae4841bafe63b41",
          "previousSha256": null,
          "length": 57,
          "moduleCharacterOffset": 267322,
          "statementIndex": 45,
          "change": "added",
          "feature_id": "settings_and_visitors",
          "declarationKind": "const"
        },
        {
          "name": "koModSettingsCache239",
          "sha256": "8f691b41d1930cad667e2ce59619f61edab1689b34a8f0ffe0e7e35017daff9b",
          "previousSha256": null,
          "length": 21,
          "moduleCharacterOffset": 274300,
          "statementIndex": 57,
          "change": "added",
          "feature_id": "settings_and_visitors",
          "declarationKind": "let"
        },
        {
          "name": "koCollectorEndingRecheckPending239",
          "sha256": "9f3e97c85bb4a9c424154294c79ee79105f7d433b634912263d4f0c115ffd89f",
          "previousSha256": null,
          "length": 40,
          "moduleCharacterOffset": 274322,
          "statementIndex": 57,
          "change": "added",
          "feature_id": "collector_and_notoriety_endings",
          "declarationKind": "let"
        },
        {
          "name": "koLogData179",
          "sha256": "f8a5af34444396584c2c2ae5f0dc7d2c59f7f07eb53ba49779fc52f94ca92bcc",
          "previousSha256": "8c3df7edd20ed30b00f7d0fc2969c26e3cf85559921db3fbcc4b2f19c699cc68",
          "length": 3246129,
          "moduleCharacterOffset": 279970,
          "statementIndex": 71,
          "change": "changed",
          "feature_id": "localization_narration",
          "declarationKind": "const"
        },
        {
          "name": "m",
          "sha256": "faed4ff47271034e652a252154d98cc32a7f421ec86f1a793b0780068a489910",
          "previousSha256": "8ba5e355244bb6c9430d5bfd90ce090437e1728020893a1d4c2b549ad6a266c5",
          "length": 8381,
          "moduleCharacterOffset": 2765166,
          "statementIndex": 91,
          "change": "changed",
          "feature_id": "localization_narration",
          "declarationKind": "var"
        },
        {
          "name": "g$",
          "sha256": "0c8af6ea187ebdba3cc48700c23d26c90c26c124d1ae67c59ea7f9b55f48cd53",
          "previousSha256": "07f9977b748371ea40214bb0767a993b8d54420c725c8483e62eaf66684d7d73",
          "length": 30677,
          "moduleCharacterOffset": 3195698,
          "statementIndex": 524,
          "change": "changed",
          "feature_id": "localization_narration",
          "declarationKind": "const"
        },
        {
          "name": "eH",
          "sha256": "846cadf4eca6f6e29c69f3cfd551d18217847399551594465b4c475e93acbc16",
          "previousSha256": "c6f13dad628325d1d1e354291feb6bf611c037214826b0488f12cd7766b8b001",
          "length": 777,
          "moduleCharacterOffset": 3220073,
          "statementIndex": 552,
          "change": "changed",
          "feature_id": "localization_narration",
          "declarationKind": "const"
        },
        {
          "name": "dy",
          "sha256": "e04bd64bce50ffb44741e51cb50fbf569a7ff42983417cd2b6076a01995ea7f5",
          "previousSha256": "84a12710e436e75d14cdeffbf6752d7ae6b92e5694515c6cfb05c2aca25591af",
          "length": 3752,
          "moduleCharacterOffset": 3225143,
          "statementIndex": 566,
          "change": "changed",
          "feature_id": "localization_narration",
          "declarationKind": "const"
        },
        {
          "name": "x$",
          "sha256": "30e85fec75d43c3ebcdf0d64120f450b6b22c9c31b7c71894e0727816ce3236f",
          "previousSha256": "98428bc85c8565a56b121d72e0d008df67e90dfa609a4b420a8c89a312b5bf2b",
          "length": 3295,
          "moduleCharacterOffset": 3227198,
          "statementIndex": 566,
          "change": "changed",
          "feature_id": "localization_narration",
          "declarationKind": "const"
        },
        {
          "name": "T$",
          "sha256": "684e3be0251764ffa3015ce376ff31a8a2ff277e13973a875d9b5e2ea242028f",
          "previousSha256": "2903acc548188568afaa2a1920e89bc954563c82552fea92d590bc89dbdfaf3d",
          "length": 3711,
          "moduleCharacterOffset": 3231981,
          "statementIndex": 566,
          "change": "changed",
          "feature_id": "localization_narration",
          "declarationKind": "const"
        },
        {
          "name": "d6",
          "sha256": "4ca7640d4494a65c517b234ff40c06f1c772a93dbf438996078cde52df7fbcf7",
          "previousSha256": "546e3cb0518c8991733863f59698a3f602f6b68f3d049f202737a9653d294ea1",
          "length": 6,
          "moduleCharacterOffset": 3269522,
          "statementIndex": 595,
          "change": "changed",
          "feature_id": "risk_and_traffic",
          "declarationKind": "const"
        },
        {
          "name": "tB",
          "sha256": "c7e245def8552c7b1f706ad5f67728cf513262e9f79f35e9dd50759df2f7b8bf",
          "previousSha256": "781e1540a3b0f9c2ae07ceadff14e33b78d50cd916a7ecbb1d704d6bbf03895e",
          "length": 1851,
          "moduleCharacterOffset": 3322118,
          "statementIndex": 744,
          "change": "changed",
          "feature_id": "localization_narration",
          "declarationKind": "const"
        },
        {
          "name": "DW",
          "sha256": "76dde4a18a500f61eeb889deb1df7fb340a6fc59fdfcc6a2bdce9c41fc7873d5",
          "previousSha256": "5456a99dbf7d77361c45308dc773560aab408764771a425063de056e5a2d9483",
          "length": 30686,
          "moduleCharacterOffset": 3427616,
          "statementIndex": 958,
          "change": "changed",
          "feature_id": "daily_initiative_and_conversation",
          "declarationKind": "const"
        },
        {
          "name": "koAutoRideAgencyId223",
          "sha256": "d5d5c4f1839699b0ba4eaf50fe18098fa853b03a5aabdc8c64c6351053ce2ae2",
          "previousSha256": null,
          "length": 46,
          "moduleCharacterOffset": 3449403,
          "statementIndex": 960,
          "change": "added",
          "feature_id": "wife_initiative",
          "declarationKind": "const"
        },
        {
          "name": "koAutoRidePrivateHI223",
          "sha256": "70e8f463105726aaea5506982698f0401b9792c687afae61bd899feba7f74728",
          "previousSha256": null,
          "length": 25,
          "moduleCharacterOffset": 3449450,
          "statementIndex": 960,
          "change": "added",
          "feature_id": "wife_initiative",
          "declarationKind": "const"
        },
        {
          "name": "koAutoRidePublicHI223",
          "sha256": "f5fb5a01a0fdfeb29844fce66158b85cfd18f5e09cf541313ee7b5d9f1040a72",
          "previousSha256": null,
          "length": 24,
          "moduleCharacterOffset": 3449476,
          "statementIndex": 960,
          "change": "added",
          "feature_id": "wife_initiative",
          "declarationKind": "const"
        },
        {
          "name": "LW",
          "sha256": "f014ef945e8cce5c4dffbea4c9dbb7fce3e4890d01563d313ff364b444c71d41",
          "previousSha256": "6b9fb7674b3af8de40a7cc8ae5e148c9a7ff566b79d414bb620cd97bb62cf14d",
          "length": 4727,
          "moduleCharacterOffset": 3462729,
          "statementIndex": 976,
          "change": "changed",
          "feature_id": "clothing_dares",
          "declarationKind": "const"
        },
        {
          "name": "BW",
          "sha256": "d64d2a9360fc0ffddbe4d243392995f2a72a261b0e6b3bd83255a2b65eae7dac",
          "previousSha256": "0cfe5b18840d8cf10ca5480b552325278d5ba3ab43eeebe5f7ce3577325bebc2",
          "length": 6293,
          "moduleCharacterOffset": 3465883,
          "statementIndex": 976,
          "change": "changed",
          "feature_id": "clothing_dares",
          "declarationKind": "const"
        },
        {
          "name": "xY",
          "sha256": "f6fbde991977659f9fd26756b7cf27a08b2dc6188b7bc588f2282312d0168d57",
          "previousSha256": "11ba530da1d671ef4662dc3e1ce9ff0b0191894ae9e91ce53e09996f68d3245f",
          "length": 35586,
          "moduleCharacterOffset": 3489983,
          "statementIndex": 1021,
          "change": "changed",
          "feature_id": "clothing_dares",
          "declarationKind": "const"
        },
        {
          "name": "QS",
          "sha256": "958efe88609fbecd255642471b3783034f04330c5382ea37e815a037d376c75b",
          "previousSha256": "b5d98264ed0b371daa05becc5d850b12ab969ca0cae491b1e986304ce8eb8367",
          "length": 7558,
          "moduleCharacterOffset": 3557418,
          "statementIndex": 1092,
          "change": "changed",
          "feature_id": "daily_initiative_and_conversation",
          "declarationKind": "const"
        },
        {
          "name": "koImageSessionCache297",
          "sha256": "de1a8e5ad40f31c453c4c8bc98d9506c460d5e5cf54dd066524b86760ff7e973",
          "previousSha256": null,
          "length": 27,
          "moduleCharacterOffset": 3682849,
          "statementIndex": 1280,
          "change": "added",
          "feature_id": "image_generation_client",
          "declarationKind": "var"
        },
        {
          "name": "koImageNoticeState297",
          "sha256": "10be589ee11bafc8808481f0e7ccf7586b44381684c43abf0d55d5dce4faf871",
          "previousSha256": null,
          "length": 24,
          "moduleCharacterOffset": 3682877,
          "statementIndex": 1280,
          "change": "added",
          "feature_id": "image_generation_client",
          "declarationKind": "var"
        },
        {
          "name": "koImageNoticeByKind298",
          "sha256": "1a5b4c97fb9ca1bc337a39cfcab8076e5435d6a954a7184a81abf602eab9d79e",
          "previousSha256": null,
          "length": 62,
          "moduleCharacterOffset": 3685081,
          "statementIndex": 1287,
          "change": "added",
          "feature_id": "image_generation_client",
          "declarationKind": "var"
        },
        {
          "name": "Dz",
          "sha256": "00f4ce5a8849c985d9b69c724d4ef91e91ad81bd69f8609420d253a3e52365f1",
          "previousSha256": "1d3543b3e1c28c8363ea90b4519f14e9eb5efd7ba8c116b7c05c9905c3fee295",
          "length": 13843,
          "moduleCharacterOffset": 3866561,
          "statementIndex": 1484,
          "change": "changed",
          "feature_id": "daily_initiative_and_conversation",
          "declarationKind": "const"
        },
        {
          "name": "koThreatTactics253",
          "sha256": "a398136ae8bb29d57483ce14e7d8d9ff4f0ad5b8e3a851aab8bac1b12e5bc76d",
          "previousSha256": null,
          "length": 111,
          "moduleCharacterOffset": 4066280,
          "statementIndex": 1654,
          "change": "added",
          "feature_id": "risk_and_traffic",
          "declarationKind": "const"
        },
        {
          "name": "PN",
          "sha256": "d40f639809b0f0b684f6c6204aad2355476162c63a8b8af47c0064f778e74445",
          "previousSha256": "843b9ecacd67bdd4bf5750b3d4a39a770a199c1a820cd9d5dcb6ff690f733312",
          "length": 21190,
          "moduleCharacterOffset": 4157505,
          "statementIndex": 1824,
          "change": "changed",
          "feature_id": "daily_initiative_and_conversation",
          "declarationKind": "const"
        },
        {
          "name": "tZ",
          "sha256": "c35d36e7fd4d82e3af42898670853df6a5f1b6188468a41197ed40792510891c",
          "previousSha256": "e56fdc4873d082be9d8532facb8a28aaeb0b9a6e566b917b7df520f07aeff07d",
          "length": 17247,
          "moduleCharacterOffset": 4249310,
          "statementIndex": 1923,
          "change": "changed",
          "feature_id": "daily_initiative_and_conversation",
          "declarationKind": "const"
        },
        {
          "name": "KN",
          "sha256": "53cd4808d60a0688906f961f1a6b2c168b82b72f4f5c7f2467c846b868829abe",
          "previousSha256": "e3f2c9787a6c6790a66cc39c14d9775b6eb8198cbe5b5151f1bce442fb680702",
          "length": 25696,
          "moduleCharacterOffset": 4285661,
          "statementIndex": 1957,
          "change": "changed",
          "feature_id": "daily_initiative_and_conversation",
          "declarationKind": "const"
        },
        {
          "name": "mse",
          "sha256": "0dcb9455a769babfa565ca3494c4861203e85f2763ce35fa8a0bb2185ca84984",
          "previousSha256": "5f8643ceb5854c52de29598e5bed8766dc038e90e7226e6e0bbf53992678037f",
          "length": 25,
          "moduleCharacterOffset": 4494215,
          "statementIndex": 2297,
          "change": "changed",
          "feature_id": "saves_and_migrations",
          "declarationKind": "const"
        },
        {
          "name": "Um",
          "sha256": "ba07789d808958df113e19c0e703bfdd7f87b7c057dc4f09e231873b7484762e",
          "previousSha256": "a4e2ad59188dbc4ce8a8be8c8f2e9e5a594f13227f80f89ef6c05fcc9d30267a",
          "length": 20,
          "moduleCharacterOffset": 4494246,
          "statementIndex": 2297,
          "change": "changed",
          "feature_id": "saves_and_migrations",
          "declarationKind": "const"
        },
        {
          "name": "fse",
          "sha256": "3667ca4ecf84779207ebed1e67f13ee4d2330ba9f39969de0db9f428b21de97f",
          "previousSha256": "f2488a5a5ae4bfa09a7d67cf8411c9a9bfc780fe47a432f3beb6f223a82734c6",
          "length": 22,
          "moduleCharacterOffset": 4494267,
          "statementIndex": 2297,
          "change": "changed",
          "feature_id": "saves_and_migrations",
          "declarationKind": "const"
        },
        {
          "name": "Tse",
          "sha256": "cfc7eebf6d96a1bb072ebfc36bf4c1416be22c745c23962c0bb1167a75539b1e",
          "previousSha256": "74bdf6d7ed492542fca9b70ed34271a2a3e0ce8a56c3d06740f4176f45421d31",
          "length": 1579,
          "moduleCharacterOffset": 4503095,
          "statementIndex": 2317,
          "change": "changed",
          "feature_id": "clothing_dares",
          "declarationKind": "const"
        },
        {
          "name": "ue",
          "sha256": "de19ed4d0fac5c58e5d07d8f8d6eac5acef70268b9b866c8fdf74d1b6081e04d",
          "previousSha256": "7b504a230f28cf10ae3ba142bd7e082c167365a9545ab54f528be59e3c968d2e",
          "length": 16096,
          "moduleCharacterOffset": 4513410,
          "statementIndex": 2345,
          "change": "changed",
          "feature_id": "saves_and_migrations",
          "declarationKind": "const"
        },
        {
          "name": "yn",
          "sha256": "2f295ec68aec5496c25027623df0406046623d77c3a611cea2d79b3f338b1d2d",
          "previousSha256": "e86930b8cfd162bfb0aea389294a459afa670ed1dc0ccc3a649a2f7920fe8065",
          "length": 3158,
          "moduleCharacterOffset": 4774500,
          "statementIndex": 2521,
          "change": "changed",
          "feature_id": "localization_narration",
          "declarationKind": "const"
        }
      ]
    },
    "anonymous_changes": [
      {
        "kind": "ExpressionStatement",
        "sha256": "f1cda2263c200c87663ec7ed64891b836195c56d80186e693d148a8d0d7e61d8",
        "length": 23,
        "moduleCharacterOffset": 4513381,
        "feature_id": "saves_and_migrations"
      },
      {
        "kind": "ExpressionStatement",
        "sha256": "4bc9f62c9d062266f86d27ba5259d26d3f1c26b91743d4404b1bacc96e105e09",
        "length": 77585,
        "moduleCharacterOffset": 5251527,
        "feature_id": "game_ui_and_cheat"
      }
    ],
    "outside_module": {
      "before_main_module": {
        "reference_sha256": "7dfe416a9f74d4e9549c46d85641f4b438e122b986d2671bf06a0c2fd46b3eb3",
        "current_sha256": "a6deebf39c3a887cbae9bdf4cb74b7558f36b39dfb5303325b765c27d8396283",
        "reference_bytes": 3440,
        "current_bytes": 3424,
        "equal_after_newline_normalization": true
      },
      "after_main_module": {
        "reference_sha256": "f84dd1ff0e93fa8357b541ca84a300dd0028a43d2df90e8443bea479bd3b2583",
        "current_sha256": "b32faa3aebb189e657f5f9b9556670a6e32a684f2c2cbd2aedd0110edc0fcda8",
        "reference_bytes": 64253,
        "current_bytes": 64248,
        "equal_after_newline_normalization": true
      }
    },
    "coverage": {
      "named_changes": 277,
      "classified_named_changes": 277,
      "anonymous_changes": 2,
      "unclassified_named_changes": 0,
      "unnamed_variable_declarations": 0,
      "summary": {
        "functions": {
          "added": 93,
          "changed": 143,
          "removed": 0,
          "unchanged": 2017
        },
        "variables": {
          "added": 16,
          "changed": 25,
          "removed": 0,
          "unchanged": 1246
        }
      }
    },
    "caution": "All recorded structural changes relative to the supplied reference are classified; same-name semantics and future upstream behavior still require manual review."
  },
  "image_client_contract": {
    "settings_path": "state.koImage297 within tavern-settings JSON; vt.getState().koImage297 at runtime",
    "settings_schema": 1,
    "original_settings_version": 3,
    "included_in_game_json_export": false,
    "defaults": {
      "mode": "auto",
      "experimental_enabled": false,
      "variants": 4,
      "numbered_packs_per_character": 2
    },
    "ranges": {
      "steps": [
        4,
        40
      ],
      "cfg": [
        1,
        10
      ],
      "loraStrength": [
        0,
        1
      ],
      "variants": [
        4,
        8
      ],
      "numbered_packs_per_character": [
        2,
        4
      ]
    },
    "expansion_effective": "next page load; immutable session snapshot",
    "batch_max": 20000,
    "batch_chunk_size": 2000,
    "backend_api_changed": false,
    "prompt_builder_changed": false
  }
}
WAYWARD_MOD_MANIFEST_END

## 2.99 신규 기능 이식 지도

- 기준: v2.98 본체의 게임 로직/이미지 코드/성인 대사는 그대로 두고, core299.js와 ui299.js의 독립 구획 및 연결점만 추가. 기존의 아래 manifest는 **v2.98까지의 역사적 비교 지도**다. v2.99의 변경점은 이 단락과 qa/release299/build.py의 고정 앵커 패치가 대표한다.
- guestStudio: `modData.guestStudio`는 선택 필드. 없으면 사용자 손님 0명·등장 비중 20%. `gc` 새 손님 분기, `s7` 재방문 추첨, `X$` 관계 기록에만 연결. 이름·프로필·가중치·삭제 유예 목록, 원본 프로필 복원 스냅샷을 보관한다. 진행 중인 손님 장면/ID는 편집하지 않는다.
- shop/inventory: 기존 `modData.inventory`에 `plus:strength` 등 18개 아이템 수량. `Jne`의 `ko299_` 행동 네 종류와 `ue.dispatch`의 `koShopData299`가 동일 턴의 게임 상태 및 모드 저장값을 함께 갱신한다. 배송은 `om` 가격·원본 물자, 구매 외출은 `Ol` 60틱, 아이템 사용은 원본 player/primary character attributes 경로다.
- worker: `modData.employees`에 `{kind:'grandmother',day}` 하나. `Ol`에서 아내 자동 행동 이후 `koWorker299` 한 번 호출한다. 홀 손님 상태·원본 주문/재고/수입 함수만 사용하고 아내의 작업 타이머와 성인 장면은 건드리지 않는다.
- UI: `Ihe`의 상단 `koHeaderButtons299` 및 끝부분 독립 편집/상점/인벤토리 창. 치트 에디터 DEBUG 상태에서만 손님 편집 버튼을 표시한다. 원작 업데이트 시 두 모듈과 위에서 명시한 연결점을 역할별로 대조해 이식한다.
- 원본 JSON은 기존 state 필드를 그대로 사용한다. 미사용 아이템·손님 템플릿·직원은 별도 modData이므로 원본에서 실행할 때 이 추가 콘텐츠는 적용되지 않는다. 애드온의 확장/충돌 관리는 애드온 제작자 책임이다.
- v2.99 원본 빌드의 스크립트 SHA-256: 3c2aa51ccc9066bd6f616ddfa4eee1f40b30d059779d765d02b8fb92e9aeac24. 실제 서버/GPU와 대용량 이미지 성능은 기존 v2.98과 마찬가지로 실환경 미검증.

## 2.100 QA 수정 지도

- 2.99에서 추가한 영역만 정정했다. 기존 장면·성인 대사·이미지 경로·수치 밸런스는 그대로다. 단계별 패치와 재현 검사는 `qa/review299/`에 있다.
- 손님 UI: 접근 매력과 기본 능력치 매력의 입력 키 충돌을 분리. 저장된 사용자 손님 비중으로 제목 초기화. 원본 동작 복원 후, 퇴장한 손님의 불필요한 baseline을 해제한다.
- `koGuestTemplate299`/`koRecordBaseline299`/`koApplyGuest299`: 사전 조회는 자체 키만 인정. constructor 등 유효한 사용자 이름이 Object 프로토타입과 충돌해 예외가 나는 경로 수정.
- `koWorker299`/`koGrandmotherHired299`/`koShopData299`: 신규 직원은 기존 modData.employees 항목에 선택 필드 `untilClose:true`를 사용. 자정 이후에도 계속 근무하며 마감·새 준비일·게임 종료 시 정리. 2.99의 day-only 고용값도 당일 및 다음날 준비 시간 전의 같은 야간 근무를 지원. 홀의 장면 참여·구경 손님은 일반 업무 대상으로 삼지 않는다.
- 상점: 기존 의상 쇼핑/조작 중인 장면과 겹치는 구입·사용을 막고, 시장 방문·고용 뒤 보유 골드/재고/시세 견적을 갱신한다. 가격/효과/60분 외출/수량 범위는 변경하지 않음.
- 모달: 열린 동안만 키보드 입력을 분리해 배후 게임의 기다리기·조리·외출 단축키가 실행되지 않게 했다. Escape는 해당 창만 닫는다. 게임 종료 시 모달 해제.
- `ko299-header-layout`: 누락된 상단 버튼 CSS 3개만 보충. 원본의 desk 640px 기준을 유지한다.
- 저장 스키마는 1 그대로, 기존 인벤토리·템플릿·직원 값 유지. 새 게임 필드 없음. 직원 선택 필드는 모드 데이터에만 저장되고 원본은 무시한다.
- 최신 메인 스크립트 SHA-256: 707371f4aef2adce2b031b1dde8d6f8b4834da643ea7d5928ca89a503a124f8f
- 실제 브라우저 시각 검수와 이미지 서버/GPU 검증 여부는 동봉 QA 인수인계서의 검증 한계를 확인할 것.

## 2.101 현재 개발 안내 정정

- 직접 기준 v2.100에서 오래된 머리말·현재 저장 구조·이식 설명을 바로잡았다. 게임 진행 코드와 서술은 그대로이며 실행되는 문자열은 버전 표기만 v2.101로 바뀐다.
- v2.98 manifest는 수정하지 않은 역사 자료다. 아래 현재 연결 지도는 v2.98→v2.99→v2.100의 변경 지점을 나타낸다. v2.101은 표시 버전 외 기능 변경이 없으며, 각 함수의 최신 해시는 현재 파일에서 새로 추출해야 한다.
- 현재 전체 구조 수치는 제공 원본과 이 파일의 메인 모듈에 대한 정적 비교다. 모드 이식 시 역사 manifest에만 있는 236/41을 전체 현재 차이로 오해하지 말고, 손님 설정·상점·인벤토리·할머니 업무와 UI 연결점 및 2.100 QA 수정을 포함한다.
- 단순히 저장된 `modData` 하위 필드가 있다고 사용 가능 기능으로 판단하지 않는다. `guestStudio`·`inventory`·`employees`는 실제 기능에 연결됐고 `effects`는 아직 그렇지 않다. 원작은 모드 데이터 기능을 실행하지 않으며 원작에서 다시 저장하면 모드 데이터가 사라질 수 있다.
- 이 버전의 메인 모듈 SHA-256: `14efadc8d9297228ea454c3211a9e7e92f07f1b43a05ad51c2c9ac5be5777b04`. 역사 manifest의 `game_release` 및 SHA-256과 용도를 구분한다. 함수명 뒤 299는 도입 앵커이며 개명하지 않는다.
- v2.100 QA의 기능/저장 43건 통과는 이 문서 정정의 새 브라우저·GPU 테스트를 뜻하지 않는다. 그중 day1 세이브는 진행 중인 장면 때문에 `wait` 20회가 시간을 전진시키지 못했다. 나머지 day51·day112에서 각 20틱 진행을 확인했다. v2.101 본체로 게임 기능/저장 26건, 합성 UI 10건을 다시 실행했고 구문·현재 AST·2.100 대비 실행 코드 제한 비교도 통과했다. 실제 브라우저·GPU 검증은 하지 않았다.

WAYWARD_MOD_MAP_2_101_BEGIN
{
  "current_release": "2.101",
  "runtime_basis": "2.100; only displayed version labels changed in main module and cheat UI",
  "historical_manifest_release": "2.98",
  "provided_original_reference": "index(9).html (not a verified upstream tag)",
  "main_module_sha256": "14efadc8d9297228ea454c3211a9e7e92f07f1b43a05ad51c2c9ac5be5777b04",
  "original_to_current_ast_counts": {
    "functions_added": 120,
    "functions_changed": 147,
    "variables_added": 24,
    "variables_changed": 25,
    "functions_removed": 0,
    "variables_removed": 0
  },
  "v2_98_to_v2_99": {
    "functions_added": [
      "koNum299",
      "koStudio299",
      "koStudioNames299",
      "koProfile299",
      "koGuestBase299",
      "koGuestMod299",
      "koGuestTemplate299",
      "koApplyGuest299",
      "koPickCustom299",
      "koFreshCustom299",
      "koRecordBaseline299",
      "koSourceGuest299",
      "koRestoreGuestRecord299",
      "koWorker299",
      "koShopAction299",
      "koShopData299",
      "koHeaderButtons299",
      "ko299Node",
      "ko299Css",
      "ko299Modal",
      "ko299Action",
      "ko299QtyRow",
      "ko299ReadQty",
      "koOpenShop299",
      "koOpenInventory299",
      "koOpenGuestEditor299"
    ],
    "functions_changed": [
      "X$",
      "gc",
      "s7",
      "Ol",
      "Jne",
      "koModSettingsDialog239",
      "Ihe"
    ],
    "variables_added": [
      "KO299_ATTRS",
      "KO299_TYPES",
      "KO299_INTENTS",
      "KO299_TACTICS",
      "KO299_TAGS",
      "KO299_ITEM_NAMES",
      "KO299_WALLET",
      "koPendingGuestBaselines299"
    ],
    "variables_changed": [
      "ue"
    ]
  },
  "v2_99_to_v2_100": {
    "functions_added": [
      "koGrandmotherHired299"
    ],
    "functions_changed": [
      "koGuestTemplate299",
      "koApplyGuest299",
      "koRecordBaseline299",
      "koSourceGuest299",
      "koWorker299",
      "koShopAction299",
      "koShopData299",
      "koModSettingsDialog239",
      "ko299Css",
      "ko299Modal",
      "ko299Action",
      "koOpenShop299",
      "koOpenGuestEditor299"
    ],
    "variables_changed": []
  },
  "new_persistent_content": {
    "modData_schema": 1,
    "guestStudio": "optional; v2.99 guest template/editor/share/baselines",
    "inventory": "18 purchasable +/- attribute items",
    "employees": "grandmother hire; optional untilClose true from v2.100",
    "effects": "container only; no dedicated consumable buff action"
  }
}
WAYWARD_MOD_MAP_2_101_END

## v2.102 이식 추가 지도

직접 입력은 v2.101이다. 신규 카탈로그는 `KO299_TRAITS`/`KO299_ITEM_NAMES`/`koItemPrice102`/`koItemLimit102`/`koItemBasketError102`를 따른다. 구매 판정은 `koShopAction299`, 인벤토리 증감은 `koShopData299`, 실제 능력치·기력·피로·아내 성향 결과는 원본 state, 미사용 물품은 modData.inventory에 남는다. 스키마는 1 그대로다. 성향 아이템은 대상 아내에게 이미 있더라도 사용·소모하며 같은 문구로 처리해 숨은 성향을 알려주지 않는다. 새 성향이면 latentTraits와 noticedLatentTraits에 더한다. 상품은 개점 전 한 번 장바구니에 왕복 60분, 300/100/5/800g 및 재고 상한을 적용한다. 기존 초과 재고는 지우지 않는다.

`koGrandmaWatching299`는 장면·방·시간·고용을 조회하는 저장 없는 20% 결정식이다. `koWorker299` 5분 업무를 그 장면 동안 쉬고 `ple`의 홀 카드에 상태만 보여준다. 손님 객체, 참여자 목록, 관계 효과는 건드리지 않는다. 화면 테마는 `XT`/`vt`의 기기 설정 theme에 보관하며 원본·모드 세이브로 내보내지 않는다. `koThemeButton102`/`koHeaderButtons299`/`Ihe`와 `ko102-theme` CSS가 상단 버튼과 테마를 연결한다. 새 원작 이식 시 조정할 접점: `Ol`→직원 호출, `Jne`→상점 액션, `ue.dispatch`→`koShopData299`, `ple`→직원 표시, `Ihe`→상단 폭.

현재 메인 모듈 SHA-256: `389b4e2c404ec7c3a9b3c9f514c1f5c501ddb396bdf41b5a2882ee92ea47f9c6`. 이 지도는 v2.101 현재 지도 뒤에 더해진 변경분이다. v2.98 manifest와 v2.101의 해시는 당시 파일 전용이다. 기존 장면·성인 대사·서술을 일괄 수정하지 않는다. 브라우저 시각 검수와 외부 이미지 서버 테스트는 별도다.


## v2.103 QA 수정 및 현행 지도

사용자가 이번 QA에서 필요한 수정을 허용했다. v2.102의 오래된 검수 전용 지시는 이번 작업 권한을 제한하지 않는다. 무관한 기능·서술 변경은 금지다.

초과 재고 때문에 다른 품목까지 막히던 구매 판정, 복용한 기존 숨은 성향의 공개 누락, 자정의 할머니 구경 재추첨, 접이식 상점의 키보드 이동, 좁은 화면 테마 팝업 좌표와 추가 테마의 확인된 색 대비 문제만 수정했다. 성향 보유 검사로 사용을 막지 않으며, 새 성향·기존 숨은 성향 모두 같은 복용 로그와 공개 결과를 갖는다. 원본 장면 문구는 바꾸지 않았다.

아래 해시는 모듈 본문(스크립트 태그 제외) 기준이다. 이 지도는 실행 코드에서 AST를 재계산해 생성했다. 구버전 지도는 역사 기록이며 앞으로 CURRENT_MAP은 하나만 유지한다. 실제 브라우저 검증으로 오인하지 말 것.

WAYWARD_MOD_MAP_2_103_BEGIN
{
  "current_release": "2.103",
  "direct_base_release": "2.102",
  "qa_scope_start": "2.101",
  "direct_base_sha256": "bcd2f4023817ad2859128b450a85bb4ff5ec75f2ba73c597475c67baa676991b",
  "main_module_sha256": "8396937b8fa6593cf7c27e709539cb952c000ca7eddf16f399d769f35e7e472e",
  "provided_original_reference": "index(9).html (not a verified upstream tag)",
  "diff_scope": {
    "original": {
      "functions": {
        "added": [
          "koDefaultModData293",
          "koValidModData293",
          "koRecoverModData293",
          "koNotifyMod293",
          "koReadBundle293",
          "koAdoptLegacyAuto293",
          "koImportedSettings293",
          "koSaveObject294",
          "koStorageWarning294",
          "koAutoStorage294",
          "koMergeSave294",
          "koHydrated294",
          "koLegacyDaysVisible294",
          "koBundleState294",
          "koSaveInfo294",
          "koSettingsConflict294",
          "koSettingsNotice294",
          "koRichTarget249",
          "koRichEligible249",
          "koRichEnding249",
          "koSetRichEnding249",
          "koRichEndingSettings249",
          "koNormalizeVisitorTraffic272",
          "koVisitorTraffic272",
          "koQueueVisitorTraffic272",
          "koCancelVisitorTraffic273",
          "koActivateVisitorTraffic272",
          "koNormalizeModSettings239",
          "koGetModSettings239",
          "koSaveModSettings239",
          "koSetBadEnding239",
          "koModBadEndingEnabled239",
          "koResetLiveLocks239",
          "koNotorietyWarningHistoryReset236",
          "koNotorietyEnding235",
          "koRenterRoom243",
          "koGuestReturns243",
          "koBathEntry243",
          "koPatronAftermath243",
          "koWifeAdvance286",
          "koSelfApproach243",
          "koPatronAlertValid254",
          "koGroupAftermath257",
          "koGroupFinishTag256",
          "koItemPrice102",
          "koItemLimit102",
          "koItemBasketError102",
          "koGrandmaWatching299",
          "koNum299",
          "koStudio299",
          "koStudioNames299",
          "koProfile299",
          "koGuestBase299",
          "koGuestMod299",
          "koGuestTemplate299",
          "koApplyGuest299",
          "koPickCustom299",
          "koFreshCustom299",
          "koRecordBaseline299",
          "koSourceGuest299",
          "koRestoreGuestRecord299",
          "koGrandmotherHired299",
          "koWorker299",
          "koShopAction299",
          "koShopData299",
          "koBackRoomPrivatePatronCleanup238",
          "koAutoRideContext223",
          "koAutoRideScene223",
          "koAutoRideUnfulfilled278",
          "koAutoRideLocked223",
          "koAutoRideStart223",
          "koDiscreetRenters240",
          "koImageNumber297",
          "koImageCustom297",
          "koImagePrefs297",
          "koImageSession297",
          "koImageParams297",
          "koImageRequest297",
          "koImageNotice297",
          "koImageConnection297",
          "koImageSave297",
          "koImageModelOptions297",
          "koImageNextVariant297",
          "koImageStatus297",
          "koImageSettings297",
          "koBookedRenter260",
          "koSceneCustomerIds246",
          "koPartyExpiry246",
          "koNotorietyRisk253",
          "koPlayerFinishGroup244",
          "koPlayerFinishAction244",
          "koPlayerFinishChoices244",
          "koPlayerFinishReason244",
          "koPlayerAftermath244",
          "koClothingLine244",
          "koPlayerMenuRepair244",
          "koWifeSexPhysicalCost215",
          "koFinishAfterglow218",
          "koNtrDebugAttachment240",
          "koNtrLeavingRisk234",
          "koNtrStage265",
          "koIntimateOfferPick221",
          "koIntimateOfferLegacy221",
          "koSituationNormalize230",
          "koCollectorRelieveStreak",
          "koCollectorPresence285",
          "koCollectorStallNotice",
          "koCollectorGameOver239",
          "koApplyCollectorReenable239",
          "koNtrAtWake250",
          "koActiveAfterglowAffinity291",
          "koAfterglowTime291",
          "koAfterglowAffinity291",
          "koModSettingsDialog239",
          "koThemeButton102",
          "koHeaderButtons299",
          "ko299Node",
          "ko299Css",
          "ko299Modal",
          "ko299Action",
          "ko299QtyRow",
          "ko299ReadQty",
          "koOpenShop299",
          "koOpenInventory299",
          "koOpenGuestEditor299"
        ],
        "changed": [
          "koHasAutosave175",
          "koCompleteTurn175",
          "um",
          "Ac",
          "yM",
          "p$",
          "Pc",
          "nH",
          "rH",
          "k$",
          "v$",
          "Rh",
          "ym",
          "Z6",
          "X$",
          "Zb",
          "E8",
          "L8",
          "G8",
          "ow",
          "nw",
          "Sy",
          "hB",
          "cB",
          "gc",
          "n7",
          "s7",
          "DS",
          "P7",
          "Bt",
          "AI",
          "K7",
          "J7",
          "hW",
          "cW",
          "NW",
          "EW",
          "MW",
          "BI",
          "JW",
          "XW",
          "oY",
          "Hf",
          "qY",
          "JI",
          "zY",
          "VY",
          "Y9",
          "G9",
          "Uh",
          "cq",
          "Sj",
          "Mi",
          "Rm",
          "JU",
          "Hj",
          "ez",
          "zj",
          "Tz",
          "Jj",
          "fV",
          "kV",
          "HV",
          "oN",
          "ec",
          "sK",
          "hK",
          "fN",
          "As",
          "jQ",
          "WQ",
          "LN",
          "LX",
          "BX",
          "Jf",
          "YX",
          "FN",
          "qX",
          "zN",
          "iT",
          "lT",
          "tm",
          "hT",
          "zX",
          "eZ",
          "rZ",
          "dZ",
          "CZ",
          "QZ",
          "nb",
          "_ee",
          "zee",
          "Ol",
          "Xee",
          "Zr",
          "ste",
          "Aa",
          "vte",
          "jte",
          "w0",
          "Vne",
          "Jne",
          "FC",
          "cp",
          "ose",
          "nse",
          "dse",
          "zm",
          "_se",
          "gse",
          "bse",
          "v0",
          "wse",
          "Hh",
          "kse",
          "vse",
          "x0",
          "a5",
          "qre",
          "Kre",
          "Vh",
          "c3",
          "eae",
          "nae",
          "R0",
          "uae",
          "pae",
          "_ae",
          "Sae",
          "M0",
          "sie",
          "iie",
          "E3",
          "Eie",
          "ple",
          "sf",
          "xle",
          "Tle",
          "G3",
          "$le",
          "she",
          "lhe",
          "hhe",
          "yhe",
          "whe",
          "Ihe",
          "Vhe",
          "nce"
        ],
        "removed": [],
        "unchanged": 2012
      },
      "variables": {
        "added": [
          "KO_STORAGE293",
          "koModRecoveryNotice293",
          "KO_LEGACY_DAYS_HIDDEN294",
          "KO_AUTO_READ_NOTICE294",
          "koStorageWarnings294",
          "koLegacyDayReset294",
          "KO_MOD_SETTINGS_KEY239",
          "koModSettingsCache239",
          "koCollectorEndingRecheckPending239",
          "KO299_ATTRS",
          "KO299_TYPES",
          "KO299_INTENTS",
          "KO299_TACTICS",
          "KO299_TAGS",
          "KO299_TRAITS",
          "KO299_ITEM_NAMES",
          "KO299_WALLET",
          "koPendingGuestBaselines299",
          "koAutoRideAgencyId223",
          "koAutoRidePrivateHI223",
          "koAutoRidePublicHI223",
          "koImageSessionCache297",
          "koImageNoticeState297",
          "koImageNoticeByKind298",
          "koThreatTactics253",
          "KO_THEMES102"
        ],
        "changed": [
          "koVoiceData137",
          "koLogData179",
          "m",
          "g$",
          "eH",
          "dy",
          "x$",
          "T$",
          "d6",
          "tB",
          "DW",
          "LW",
          "BW",
          "xY",
          "QS",
          "Dz",
          "PN",
          "tZ",
          "KN",
          "mse",
          "Um",
          "fse",
          "Tse",
          "XT",
          "ue",
          "yn"
        ],
        "removed": [],
        "unchanged": 1245
      }
    },
    "base101": {
      "functions": {
        "added": [
          "koItemPrice102",
          "koItemLimit102",
          "koItemBasketError102",
          "koGrandmaWatching299",
          "koThemeButton102"
        ],
        "changed": [
          "koWorker299",
          "koShopAction299",
          "ple",
          "koModSettingsDialog239",
          "Ihe",
          "koHeaderButtons299",
          "ko299Css",
          "ko299Modal",
          "koOpenShop299",
          "koOpenInventory299"
        ],
        "removed": [],
        "unchanged": 2270
      },
      "variables": {
        "added": [
          "KO299_TRAITS",
          "KO_THEMES102"
        ],
        "changed": [
          "KO299_ITEM_NAMES",
          "XT"
        ],
        "removed": [],
        "unchanged": 1293
      }
    },
    "base102": {
      "functions": {
        "added": [],
        "changed": [
          "koItemBasketError102",
          "koGrandmaWatching299",
          "koShopAction299",
          "koModSettingsDialog239",
          "koThemeButton102",
          "ko299Css",
          "ko299Modal"
        ],
        "removed": [],
        "unchanged": 2278
      },
      "variables": {
        "added": [],
        "changed": [],
        "removed": [],
        "unchanged": 1297
      }
    }
  },
  "catalog": {
    "attribute_plus": {
      "types": 9,
      "price": 300,
      "delta": 1,
      "stock_cap": 10
    },
    "attribute_minus": {
      "types": 9,
      "price": 100,
      "delta": -1,
      "stock_cap": 10
    },
    "energy": {
      "price": 5,
      "delta": 10,
      "targets": [
        "player",
        "wife"
      ],
      "stock_cap": 10
    },
    "fatigue": {
      "price": 5,
      "delta": -5,
      "target": "player",
      "stock_cap": 10
    },
    "traits": {
      "types": 20,
      "price": 800,
      "target": "wife",
      "per_type_stock_cap": 1,
      "total_stock_cap": 10,
      "use": "always consumes; owned and noticed after dose; identical log on new/duplicate; does not reroll numerical stats"
    }
  },
  "save_contract": {
    "modData_schema": 1,
    "inventory": "existing modData.inventory; preserve legacy overstock; only positive additions subject to caps",
    "item_effects": "original player / character fields; latentTraits and noticedLatentTraits",
    "theme": "device tavern-settings.theme; not game or mod save",
    "grandmother_watch": "derived only; no new field; hash uses bo(startedAtSlot):customerId:startedAtSlot"
  },
  "port_hooks": [
    "Ol -> koWorker299",
    "Jne -> koShopAction299",
    "ue.dispatch -> koShopData299",
    "ple -> hall staff display",
    "Ihe / koHeaderButtons299 -> theme/shop/inventory",
    "ko299Css -> overlay keyboard capture",
    "ko299Modal -> theme-aware notice colors",
    "XT / vt -> device theme"
  ],
  "styles": [
    "ko102-theme (historical base palette)",
    "ko103-qa-fixes (optional-theme contrast fixes)"
  ],
  "theme_values": [
    "classic",
    "ivory",
    "charcoal",
    "midnight",
    "sage"
  ],
  "boundaries": [
    "No scene rules, adult wording, portrait/image backend changes",
    "No new schema fields or old-save rewriting",
    "Real browser pixel/layout validation and external image server/GPU remain unverified"
  ]
}
WAYWARD_MOD_MAP_2_103_END


## v2.104 타이틀 표시 이식 지도

원본 게임 제목과 소개 문구·이미지·게임 로직은 유지하고, 시작 화면의 `ty`에 MOD와 작은 버전 표기만 추가했다. 다음 버전을 만들 때 이 컴포넌트와 기존 모드 설정·치트 에디터의 버전 문자열을 함께 바꾼다. 브라우저 탭 `<title>`은 이번 요청 범위 밖이라 유지했다. 구 v2.103 지도는 바로 위의 역사 기록이고, 현행 지도는 아래 하나다.

WAYWARD_MOD_MAP_2_104_BEGIN
{
  "current_release": "2.104",
  "direct_base_release": "2.103",
  "direct_base_sha256": "7a7547109f50308df13ed7db336f92de8f7a0c4ee9d0497afff70e2197373272",
  "main_module_sha256": "ecd353f32dfc044730db03f3ea2dc68054fb38c77484b236afa9107508be415d",
  "runtime_delta": {
    "title_component": "ty: Wayward → Wayward MOD + small v2.104; used by main menu and age/content notices",
    "display_labels": "koModSettingsDialog239 and cheat editor two strings: v2.103 → v2.104",
    "browser_tab_title": "Wayward unchanged",
    "save_schema": "unchanged (modData.schema=1)",
    "gameplay_and_adult_text": "unchanged"
  },
  "prior_full_map": "WAYWARD_MOD_MAP_2_103 (v2.102→v2.103 plus original/2.101 comparisons)",
  "verification": "exact runtime substitutions and JS syntax checked; actual browser visual check not performed"
}
WAYWARD_MOD_MAP_2_104_END

## v2.105 피드백 수정 지도

WAYWARD_MOD_MAP_2_105_BEGIN
{
  "current_release": "2.105",
  "direct_base_release": "2.104",
  "direct_base_sha256": "0c8a801758fc91b5e4c54ae41dffed5b1752118b98d8641753e21c3375ca6809",
  "main_module_sha256": "9e068a4bd6004d4556233ffbab620f5d845257a85624c9b1179143fa2e78818e",
  "prior_full_map": "WAYWARD_MOD_MAP_2_104 -> WAYWARD_MOD_MAP_2_103",
  "runtime_delta": {
    "listening": "lW/GW call koListenTicks2105 after existing successful-listen guards; To remains back_room=2/upstairs=3; new pending event, errand, ending or bedroom transition stops ticks.",
    "payments": "Kj applies the wallet cap after the minimum-price calculation, so quotes cannot exceed the wallet; funded quotes retain the old calculation. pt adds a factual split receipt for accepted paid offers; pz/Yw display ri.paid, not the requested amount. Actual transfer, split, acceptance algorithm, tips, refund and scene rules unchanged. Lower affordable quote is also the amount used by existing acceptance logic.",
    "settings": "sR wording and E3 tooltips now describe expanded vs compact status. statDetailPinned behavior/persistence unchanged; separate character info dialog/status tab unchanged.",
    "save_schema": "unchanged (modData.schema=1); no save fields or migration",
    "version_labels": "title small version, mod settings and cheat editor two labels -> 2.105",
    "adult_narrative": "unchanged; existing dialogue and scene text preserved"
  },
  "verification_notes": "See Wayward_MOD_v2.105_피드백수정_인수인계.md and accompanying reproducible QA; exact reported 39g->5g circumstances lack a save. Do not claim the original report is fully reproduced or change economics speculatively."
}
WAYWARD_MOD_MAP_2_105_END

## v2.106 객실 추첨 이식 지도

원본의 BI=.35+명성/190, v2.105의 BI=.40+명성/190, 이번 BI=.45+명성/190이다. 개점 시 빈 객실마다 한 번 판정한다. 두 번째 방의 별도 .95 계수와 최종 .95 상한은 그대로다.

WAYWARD_MOD_MAP_2_106_BEGIN
{
  "current_release": "2.106",
  "direct_base_release": "2.105",
  "direct_base_sha256": "a8444b116951441e03eb5ce4204322c5a9d86b64c4190b3e790a1c0cf6191a7b",
  "main_module_sha256": "426656d9a027d281ef3ca5f318a46151db51a6d20f598235a469100dcd058f96",
  "prior_full_map": "WAYWARD_MOD_MAP_2_105 -> WAYWARD_MOD_MAP_2_104 -> WAYWARD_MOD_MAP_2_103",
  "runtime_delta": {
    "lodging": "BI: Math.min(.95, .40 + renown / 190) -> Math.min(.95, .45 + renown / 190). One roll at opening for room 1; room 2 uses BI * .95. The cap, conditions, booking duration, occupant and save logic are unchanged.",
    "version_labels": "small title label, mod settings, two cheat editor strings -> v2.106",
    "save_schema": "unchanged; no new saved fields",
    "adult_text_and_other_gameplay": "unchanged"
  },
  "verification": "Exact module substitution, AST and engine boundary rolls; synthetic runtime only, no browser or external image server."
}
WAYWARD_MOD_MAP_2_106_END

## v2.107 펄 그레이 테마 이식 지도

사용자가 승인한 미리보기의 바탕 #D4D8DA, 본문 #E2E5E6, 글자 #293236을 적용한다. ivory는 기존 기기 설정 호환을 위한 내부 ID이며 사용자 표시 이름은 펄 그레이다. 현재 테마 수는 5개로 유지한다. 변경 범위는 이 테마 팔레트·표시명·색상 견본과 버전 표기다.

WAYWARD_MOD_CURRENT_MAP_BEGIN
{
  "current_release": "2.107",
  "direct_base_release": "2.106",
  "direct_base_sha256": "bda2f3f95105ee559ff9b08b30e4d79e05b29ec2ca5fc8f05bce44f657702d98",
  "main_module_sha256": "c4840b4c67634f48a029fecd0558bda72241a88c77df55ad2de4b3da2ca641f9",
  "prior_full_map": "WAYWARD_MOD_MAP_2_106 -> WAYWARD_MOD_MAP_2_105 -> WAYWARD_MOD_MAP_2_104 -> WAYWARD_MOD_MAP_2_103",
  "runtime_delta": {
    "theme": "KO_THEMES102: ivory label 화이트 -> 펄 그레이, swatch #faf7f1 -> #e2e5e6; ko102-theme CSS: only the ivory palette variable block replaced. Existing semantic color rules retained.",
    "compatibility": "The persisted tavern-settings.theme value ivory and all CSS selectors remain unchanged. Existing white-theme users receive the new palette; other palettes are unchanged.",
    "palette": {
      "bg950": "#d4d8da",
      "bg900": "#e2e5e6",
      "bg800": "#d8dddf",
      "bg700": "#d2d8da",
      "bg600": "#adb7bb",
      "text100": "#293236",
      "text200": "#303b40",
      "text300": "#414e54",
      "text400": "#515e64",
      "text500": "#526066",
      "accent": "#805022",
      "focus": "#875828"
    },
    "version_labels": "small title label, mod settings, two cheat editor strings -> v2.107",
    "gameplay_and_save_schema": "unchanged, including v2.106 lodging probability",
    "adult_text_and_images": "unchanged"
  },
  "porting": "Port the ivory palette block in style#ko102-theme and the corresponding KO_THEMES102 display entry together; preserve ivory storage ID. No new save or settings migration.",
  "verification": "Module syntax, source diff scope, palette contrast calculations, and existing setting application checked. No external image-server verification."
}
WAYWARD_MOD_CURRENT_MAP_END

WAYWARD_MOD_MAINTENANCE_END