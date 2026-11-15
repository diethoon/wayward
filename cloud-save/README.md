# Wayward CloudSave — Google Drive (WML / v0.6.2)

**대상:** Wayward WML  
**버전:** 0.6.2

Google Drive `appDataFolder`에 기존 CloudSave 형식으로 세이브를 저장하는 WML 모드입니다. 0.6.2는 0.6.1의 게임 세이브·암호화·Drive 파일 형식을 유지하면서 인증 재시도, 로그아웃, 목록 메타데이터 조회를 개선합니다.

## 인증 구성

- **Android 공식 런처:** `WMLHost`에 네이티브 인증 API가 있으면 세션 시작 때 `android-native` 어댑터로 고정합니다. 로그아웃 후 `forceSelectAccount=true`여도 웹 GIS나 `auth-061.html`로 전환하지 않습니다. 0.6.1 브리지처럼 `cancelGoogleDriveAuth`가 없으면 페이지 측 대기만 중단하고 nonce별 늦은 응답을 거부합니다(최대 180초 대기). 이 경우 네이티브 계정 선택 화면 자체를 취소할 수는 없습니다. 계정 선택 정책 오버로드가 없는 아주 오래된 브리지에서는 기존 `startGoogleDriveAuth(nonce)`를 유지하므로 계정 강제 선택 힌트만 사용할 수 없습니다.
- **PC HTTP/HTTPS 브라우저:** Google Identity Services Token Model을 게임 화면의 Google 연결 버튼 클릭 이벤트에서 직접 실행합니다. 별도 `auth-061.html` 인증 팝업이나 연결 확인 중간 페이지를 거치지 않습니다. 브라우저 GIS 팝업의 성공·취소·팝업 차단 콜백을 게임 세션에서 처리합니다. `prompt: 'select_account'`는 명시적 로그아웃 후에만 적용합니다.
- **PC `file://`:** opaque Origin(`null`)에서는 게임 문서가 웹 GIS를 직접 호출할 수 없어 파일 전용 정적 인증 브리지 경로만 사용합니다. 이 경로는 메시지 source·Origin·nonce를 검증하는 opener 핸드셰이크를 유지합니다. 현재 GitHub Pages `main` 소스에는 과거 호출 URL `cloud/auth-061.html` 파일이 없고, PC Host에도 OAuth API가 없으므로 file 환경의 실제 브리지 가용성과 연결 확인 단계 제거는 실환경 검증 전까지 완료로 보지 않습니다.
- **Drive API:** 게임 페이지가 Google Drive API를 직접 호출합니다. 별도 백엔드, Worker, OAuth Client Secret, Refresh Token 중계는 추가하지 않습니다.
- **토큰:** access token은 현재 페이지 메모리에만 둡니다. URL, localStorage, sessionStorage, 게임 세이브 및 로그에 저장하지 않습니다.

연결되지 않은 상태의 버튼 문구는 **구글 계정으로 연결**입니다. 로그인 유지 설정 UI는 없습니다. 일반 연결은 가능한 범위에서 기존 Google 브라우저 세션과 승인을 재사용하도록 요청합니다. Android 런처는 이전 연결 성공 기록이 있는 경우 기존 승인 상태 복구를 먼저 시도합니다.

브라우저의 GIS Token Model access token은 장기 로그인 토큰이 아닙니다. 브라우저 세션이 유지되더라도 토큰 만료 후에는 사용자 동작을 통한 새 토큰 발급이 필요할 수 있습니다.

## 로그아웃

- 로그아웃은 메모리 access token과 Android 런처의 해당 토큰 캐시를 정리하고, 명시적 로그아웃 표식을 남깁니다.
- 다음 연결은 브라우저 GIS에서 `prompt: 'select_account'`, Android 런처에서 `forceSelectAccount=true`를 요청합니다. 이는 계정 선택 정책만 바꾸며, 이미 결정된 인증 어댑터를 바꾸지 않습니다.
- 일반 로그아웃은 Google 앱 권한 철회와 다릅니다. 권한 철회는 별도 동작이며, 철회 성공 응답을 확인하지 못하면 성공으로 표시하지 않습니다.
- 로그아웃 표식과 이전 연결 표식에는 비밀이 아닌 상태값만 저장합니다. localStorage를 사용할 수 없으면 sessionStorage를 시도합니다. 두 저장소가 모두 차단된 환경에서는 현재 실행 중 메모리 상태만 보장할 수 있습니다.

## 지원 환경과 제한

지원 가능한 환경 및 제한:

- HTTPS: 게임 Origin에서 Google GIS를 직접 실행합니다. Google OAuth Web Client의 **Authorized JavaScript origins**에 실제 게임 Origin을 등록해야 합니다. 현재 알려진 배포 홈은 `https://wayward-six.vercel.app`이지만 이 Origin의 Google Cloud 등록 여부는 확인되지 않았습니다.
- HTTP: Google 정책에 따라 `localhost`, `127.0.0.1`, `[::1]` loopback만 직접 GIS를 허용합니다. LAN IP, `0.0.0.0` 또는 일반 원격 HTTP는 보안 컨텍스트가 아니므로 직접 GIS를 거부합니다.
- `file://`: `null` Origin은 웹 OAuth의 허용된 JavaScript Origin이 아니므로 게임 창에서 GIS를 직접 호출하지 않습니다. 별도 HTTPS 브리지가 필요하지만, 저장소의 현재 Pages `main` 트리에서 `cloud/auth-061.html`은 찾을 수 없고 실제 배포 응답도 이 환경에서 확인하지 못했습니다. 브리지 페이지가 열려도 브라우저 사용자 활성화는 교차 출처 팝업으로 자동 이전되지 않으므로 페이지 내부의 추가 사용자 동작이 요구될 수 있습니다. 이 환경의 UX 제거는 미완료입니다.
- Android WebView: 공식 런처가 제공하는 네이티브 Google Identity 브리지를 우선 사용합니다. Android에서는 웹 GIS 경로를 자동 fallback으로 사용하지 않습니다.

GIS 응답의 `state`와 세션 generation을 검증합니다. 액세스 토큰은 게임 페이지 메모리에만 보관합니다. Google의 웹 OAuth 정책은 HTTPS JavaScript Origin과 신뢰 가능한 브라우저를 요구하며, embedded user-agent 우회는 허용되지 않습니다.

지원 완료 여부는 브라우저·Android 기기별 실환경 테스트 결과로 별도 판정해야 합니다. 자동 테스트는 실제 Google 계정 인증, 권한 동의, 팝업 정책, Drive 요청을 대신하지 않습니다.

## 저장목록 성능

목록 표시는 저장 파일 본문을 다운로드하거나 복호화하지 않습니다.

- 계정 식별용 Drive `about.get(fields=user(permissionId))`와 슬롯 목록 `files.list`를 병렬 실행합니다.
- `files.list`는 `appDataFolder`, `trashed=false`, 파일명 prefix 조건, 최소 메타데이터와 암호화 미리보기 Sidecar 포인터(`appProperties`)를 사용하고 pageSize 1000으로 요청합니다.
- 목록 캐시는 Drive `permissionId`의 SHA-256 키로 계정별 분리합니다. 저장하는 것은 파일 ID·이름·수정 시각·크기와 Sidecar ID·generation뿐이며, 캐릭터 이름·일수·골드·출신·저장 메모·게임 저장 시각은 저장하지 않습니다.
- 캐시가 있으면 현재 연결 계정의 permissionId를 확인한 뒤 먼저 표시하고, 최신 Drive 목록으로 갱신합니다. localStorage가 막히면 sessionStorage, 둘 다 사용할 수 없으면 현재 페이지 메모리 캐시로 동작합니다.
- 전체 목록에서 기본 저장 파일 본문을 일괄 다운로드하지 않습니다. 화면에 보이는 슬롯만 `IntersectionObserver`로 Sidecar를 지연 조회합니다. Sidecar가 없는 기존 자동 암호화 저장은 보이는 슬롯에서만 기본 파일을 읽어 미리보기를 만들고 Sidecar를 backfill합니다. 저장목록이 전체 저장 파일을 순회하거나 복호화하지 않습니다.
- 목록 요청은 동일 계정에서 병합하고, 로그아웃·계정 변경 시 이전 요청을 abort/generation으로 무효화합니다.

콘솔의 `[Wayward CloudSave] metadata list metrics`에는 API 호출 수, 응답 바이트, Drive 요청 시간, JSON 파싱 시간, 슬롯 수, 본문 다운로드 수, 복호화 시간, 캐시 첫 표시 시간, 전체 표시 시간, 렌더링 시간이 기록됩니다.

## 암호화 미리보기와 메모

- 저장 시 실제 `buildSnapshot()` 결과에서 `state.primaryCharacterId`, `state.characters[id].name`, `state.characters[id].archetypeId`, `state.day`, `state.economy.gold`, `snapshot.savedAt`, `snapshot.memo`만 추출합니다. 알 수 없는 archetype ID는 번역하거나 추측하지 않고 생략합니다.
- 미리보기는 기존 `WMLGoogleDriveCrypto.encryptSnapshotEmbedded()`로 별도 암호화하고 Google Drive `appDataFolder`의 Sidecar JSON으로 저장합니다. `crypto.js`, 기본 저장 envelope, AES-GCM AAD·key mode·암호화 형식은 변경하지 않았습니다.
- 기본 저장 파일 `appProperties`에는 불투명한 Sidecar ID와 random generation만 기록합니다. 캐릭터 이름·진행일·골드·출신·메모·`savedAt`은 기본 파일 메타데이터나 캐시에 평문으로 기록하지 않습니다.
- Sidecar가 있는 슬롯은 화면에 나타날 때만 지연 다운로드·복호화합니다. Sidecar가 없는 기존 자동 암호화 슬롯은 보이는 행에 한해 기존 저장 파일을 읽어 backfill합니다. passphrase 암호화 저장은 목록에서 암묵적으로 복호화하지 않습니다. 사용자가 기존 암호를 입력해 직접 불러오고 변환한 뒤 미리보기를 만들 수 있습니다.
- 메모가 비어 있으면 버튼을 표시하지 않습니다. 메모는 슬롯 제목 옆에서 한 줄 말줄임으로 표시하고, 열면 원문 줄바꿈·한글·긴 텍스트 스크롤을 지원합니다. Escape, 팝업 바깥 터치, 닫기 버튼, Android 뒤로가기로 닫을 수 있습니다.
- primary 저장 성공은 Sidecar 실패로 되돌리지 않습니다. 저장 후 Sidecar 갱신 실패는 경고로만 표시합니다. 슬롯 삭제 시 primary를 먼저 삭제하고 Sidecar 정리는 best-effort로 시도합니다. 정리 실패가 primary 삭제를 실패로 바꾸지는 않습니다.
- 저장 시각은 반드시 암호화된 `snapshot.savedAt`을 사용합니다. Drive `modifiedTime`은 게임 저장 시각의 대체값으로 사용하지 않습니다.
## 세이브 호환성

- Google Drive 경로: 기존 `appDataFolder`
- 파일명 및 슬롯 ID: 기존 `wayward-cloud-slot-{slot}.json`
- 기존 JSON envelope, AES-256-GCM 암호화·복호화, 스냅샷 직렬화 및 게임 복원 흐름 유지
- `crypto.js`는 0.6.1 기준 파일과 바이트 단위로 동일하게 유지
- 새 저장, 덮어쓰기, 선택 슬롯 불러오기, 삭제는 기존 primary save API와 파일명을 유지합니다. Sidecar는 별도 보조 파일이며 없어도 기존 저장·복원은 동작합니다.

자동 암호화에 내장된 키는 공개 모드 소스에서 추출 가능하므로 강한 기밀성의 근거로 취급하지 마세요. 이전 passphrase 방식 저장 파일은 저장 당시 비밀번호가 필요할 수 있습니다.

## 설치

1. 배포된 `cloud-save` 폴더를 게임의 `wml/mods/` 안에 복사합니다.
2. `wml/mods/mods.js`의 `WML.enable([...])`에 `"cloud-save"`가 있는지 확인합니다. 없을 때만 기존 항목을 보존해 추가합니다.
3. `crypto.js`, `mod.js`, `README.md`, `INSTALL.txt`가 같은 `cloud-save` 폴더에 있어야 합니다.
4. Android 런처의 네이티브 인증 브리지가 있으면 네이티브 어댑터를 사용합니다. HTTP/HTTPS 브라우저는 GIS 직접 인증을 사용하며, file://만 별도 브리지 어댑터를 사용합니다.
5. 모드를 다시 로드하고 **클라우드세이브 (Google Drive)** 를 엽니다.

실제 Google 실계정 인증·Drive save/load·Android·브라우저 매트릭스 테스트 결과는 배포 전 별도 검증 보고서에서 확인하세요.
