# Wayward CloudSave — Google Drive WML v0.7.1

**상태:** 정적 인증 + 페이지 소유 Drive 브리지 최종 후보(실계정·실기기 검증 전)

Google Drive `appDataFolder`에 개인 세이브를 저장하는 WML 모드입니다. Google 계정 인증과 모든 Drive API 요청은 GitHub Pages의 정적 HTTPS 인증 페이지가 직접 처리합니다. Wayward 게임 모드는 토큰을 받지 않으며, 게임에서 암호화한 저장 envelope와 제한된 슬롯 명령만 HTTPS 팝업과 주고받습니다.

## 구조와 보안 경계

- 인증/Drive 페이지: `https://jeiky224.github.io/cloud/auth.html`
- Google OAuth: 기존 공개 Web Client ID + Google Identity Services Token Model
- Drive API: 페이지의 `drive.js`가 `https://www.googleapis.com`으로 직접 요청합니다.
- 게임↔페이지 통신: HTTPS 페이지 origin, 실제 팝업 WindowProxy, 192-bit nonce, 페이지가 생성한 session ID, 192-bit request ID, 메시지 버전, 허용된 command 및 데이터 schema를 확인하는 `postMessage` 프로토콜입니다.
- `file://` 직접 실행을 지원합니다. 브라우저별 opaque-origin 표기를 `null`로 정규화하고, 인증 페이지는 실제 opener 창과 일회성 nonce를 함께 검증합니다. 페이지→게임 메시지에만 opaque origin 때문에 `targetOrigin='*'`를 사용하며, 게임 수신부는 인증 페이지의 정확한 HTTPS origin과 실제 팝업 창을 검사합니다. 임의 파일의 `null` origin만으로 신뢰하지 않습니다.
- `localhost`, `127.0.0.1`, `0.0.0.0`, 일반 HTTP, HTTPS는 각각 실제 `location.origin`을 사용합니다. 주소를 서로 별칭 처리하지 않습니다.
- 액세스 토큰은 정적 HTTPS 페이지의 JavaScript 메모리 안에만 존재합니다. 게임 메모리·localStorage·sessionStorage·IndexedDB·URL·로그·postMessage 응답에 토큰을 기록하거나 전달하지 않습니다.
- 인증 창이 닫히거나 게임 창이 사라지거나 세션 handshake timeout이 발생하면 세션을 닫고 pending 요청을 거부합니다. 토큰은 팝업 메모리에서 제거됩니다. 외부 브라우저로 분리되어 opener 연결이 사라진 경우 수동 토큰 복사 방식을 제공하지 않으며, 게임에서 새 팝업을 다시 시작해야 합니다.
- 명시적 로그아웃은 이 페이지의 메모리 토큰만 지우고 Google 동의 자체는 철회하지 않습니다. 권한 철회는 GIS revoke 성공 응답이 확인된 경우에만 성공으로 표시합니다.

## `file://` 직접 실행

- 게임 HTML을 `file:///...` 주소로 직접 열어도 정적 HTTPS 인증 팝업을 사용할 수 있습니다.
- 인증 페이지는 `origin=null`을 file URL로 판별하고, opener의 실제 WindowProxy와 nonce를 확인한 뒤 연결합니다.
- opaque origin은 특정 targetOrigin으로 지정할 수 없으므로 인증 페이지에서 게임으로 보내는 응답에만 `targetOrigin='*'`를 사용합니다. 게임은 반대로 인증 페이지의 고정 HTTPS origin과 실제 팝업 창을 검사합니다.
- 브라우저 또는 WebView가 사용자 클릭으로 연 팝업을 차단하면 해당 환경의 팝업 허용이 필요합니다. 이는 `file://` 인증 자체를 금지하는 조건이 아니라 브라우저 팝업 정책입니다.

## Google Token Model 정책

- scope: `https://www.googleapis.com/auth/drive.appdata`
- 기존 OAuth Web Client ID를 재사용하며 Client Secret은 사용하지 않습니다.
- Token Model의 액세스 토큰은 단기 토큰입니다. 만료되면 사용자가 인증 페이지에서 다시 연결해야 합니다.
- 기존 Google 계정 로그인·동의가 남아 있다면 재사용을 요청할 수 있지만 무인 Refresh Token 갱신을 보장하지 않습니다. Refresh Token은 요청·저장하지 않습니다.
- 계정 선택 정책은 비밀정보가 아닌 상태값으로만 저장합니다.

## Google Drive 저장 구조

다음 기존 형식을 유지합니다.

- Drive location: `appDataFolder`
- 이름: `wayward-cloud-slot-{n}.json`
- 새 슬롯 저장: metadata에 `parents: ['appDataFolder']`를 지정해 multipart create
- 기존 슬롯 덮어쓰기: 기존 Drive file ID에 media PATCH
- 불러오기: 기존 ID의 `alt=media` envelope 읽기
- 삭제: 해당 파일 ID만 delete
- Google Drive CRUD는 인증 페이지에서만 실행합니다. 게임 모드에는 Drive API URL 또는 Authorization 헤더가 없습니다.

## 기존 세이브 호환성

- snapshot schema v1 및 native save format 1
- `embedded-addon-v2`, AES-256-GCM
- 이전 PBKDF2-SHA256 310,000회 비밀번호 envelope 복호화
- v0.4.4의 embedded 및 passphrase 암호화 fixture를 회귀 테스트합니다.
- `crypto.js`는 v0.6.1 기준본과 byte-identical이어야 합니다.
- snapshot 생성·복원, save/prepare-load/load/delete 흐름은 v0.6.1 기준 함수와 byte-identical 검사를 수행합니다.
- 기존 세이브 파일을 자동 마이그레이션하거나 삭제하지 않습니다. 이전 형식 파일은 기존 비밀번호 복호화 경로를 따릅니다.

## 설치 및 WML 등록

1. ZIP 안의 `cloud-save/` 폴더를 게임의 `wml/mods/` 폴더에 복사합니다. 모드 파일은 `mod.js`, `crypto.js`, `README.md`, `INSTALL.txt`입니다.
2. `wml/mods/mods.js`의 기존 `WML.enable([...])` 배열에 `"cloud-save"`가 있는지 확인합니다. 없을 때만 기존 배열 항목을 보존해 추가합니다.
3. 게임을 다시 열고 **클라우드세이브 (Google Drive)** 를 실행합니다.

별도의 JSON manifest는 사용하지 않습니다. WML 모드 manifest는 `mod.js`의 `WML.define({ id: 'cloud-save', name, version, … })`이며, 활성화는 `WML.enable([...])`에 의해 이뤄집니다.

## 실계정 검증에 대한 주의

정적 Node 테스트와 기준 코드 비교는 Google 실계정 로그인, 실제 Drive CRUD, 브라우저 file URL CORS, Android Chrome/Firefox 동작을 대신하지 않습니다. Pages 배포와 실제 계정·브라우저 테스트가 모두 끝나기 전에는 이 후보를 설치 완료 또는 실사용 성공으로 간주하지 않습니다.
