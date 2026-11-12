# 클라우드세이브 — Google Drive (WML / v0.6.1)

**대상:** Wayward WML  
**모드 버전:** 0.6.1

Google Drive `appDataFolder`에 개인 세이브를 저장하는 WML 모드입니다. 브라우저는 GitHub Pages 인증 화면과 Google Identity Services를 사용하고, Android 공식 런처는 Android Google Identity Authorization API를 사용합니다. Google Drive API는 클라이언트에서 직접 호출합니다.

## 설치

1. `cloud-save` 폴더를 게임의 `wml/mods/` 안에 복사합니다. `mod.js`, `crypto.js`, `README.md`가 같은 폴더에 있어야 합니다.
2. `wml/mods/mods.js`의 `WML.enable([...])`에 `"cloud-save"`가 있는지 확인합니다. 없을 때만 기존 항목을 보존한 채 추가합니다.
3. 게임을 다시 열고 **클라우드세이브 (Google Drive)** 를 엽니다.

## 인증 경로

- 브라우저 인증 페이지: `https://jeiky224.github.io/cloud/`
- 브라우저는 Google Identity Services의 Token Model을 사용합니다.
- Android 공식 런처는 Android Google Identity `AuthorizationClient`를 직접 호출합니다.
- Google OAuth Client Secret, 별도 개인 서버, Cloudflare Worker/Pages/Functions/Durable Objects, WebSocket 인증 중계는 사용하지 않습니다.
- GitHub Pages 인증 페이지가 발급한 짧은 수명의 액세스 토큰은 게임에 nonce 검증된 `postMessage`로 전달합니다. 토큰은 URL이나 브라우저 저장소에 넣지 않습니다.
- Google Drive 목록·업로드·다운로드는 Google API로 직접 요청합니다.
- Google OAuth Web Client의 Authorized JavaScript origins에 `https://jeiky224.github.io`가 등록되어야 합니다. 브라우저 Token Model에는 OAuth Redirect URI나 Client Secret이 필요하지 않습니다.

## 로그인 상태 유지 정책

설정 화면에서 아래 두 정책 중 하나만 선택할 수 있습니다.

### 로그인 상태 유지

- 설정값만 게임 Origin의 localStorage에 저장합니다. 액세스 토큰이나 Refresh Token은 저장하지 않습니다.
- CloudSave 화면을 다시 열면 Android 공식 런처는 저장된 Google 권한을 `AuthorizationClient.authorize()`로 복구합니다. Google에 기존 권한이 남아 있으면 보통 사용자 입력 없이 새 액세스 토큰을 받습니다.
- 자동 복구는 이 기기/게임 Origin에서 이전 CloudSave 인증이 성공한 기록이 있는 경우에만 시도합니다. 최초 실행에서는 사용자가 Google 연결 버튼을 누르기 전까지 자동 인증 창을 띄우지 않습니다. 이 기록은 토큰이 아닌 단순 boolean 상태입니다.
- 일반 브라우저의 GIS Token Model은 페이지 재실행/새로고침 후 토큰을 자동 복원하거나 자동 갱신하지 않습니다. Google은 액세스 토큰 요청마다 사용자 동작을 요구합니다. 따라서 페이지를 다시 연 뒤 CloudSave의 **기존 Google 계정 인증 상태 복구** 버튼을 누르고, GitHub Pages 인증 화면에서 연결을 확인해야 합니다.
- 브라우저 연결은 Google의 기존 세션과 승인 상태를 재사용하도록 `prompt: ''`를 사용합니다. 최초 승인 또는 Google 세션 만료 시 Google 로그인 화면이 표시될 수 있습니다.

### 새로고침할 때마다 로그인 해제

- 위 로그인 상태 유지와 상호 배타적인 단일 정책값으로 저장합니다.
- 다음 페이지 초기화부터 기존 인증 상태 복구를 시도하지 않습니다.
- 다음 로그인 요청에는 Google 계정 선택을 요청합니다. 웹은 `prompt: 'select_account'`, Android 공식 런처는 `AuthorizationRequest.Prompt.SELECT_ACCOUNT`를 사용합니다.
- 현재 열린 게임 탭의 액세스 토큰은 사용자가 새로고침하기 전까지 사용할 수 있습니다. 이 정책을 켰다고 현재 탭을 즉시 로그아웃시키지는 않습니다.

## 명시적 로그아웃과 계정 변경

- **로그아웃**은 Google 권한을 철회하지 않고 현재 탭의 액세스 토큰과 런처 토큰 캐시를 지웁니다.
- 로그아웃하면 로그인 상태 유지 정책이 자동으로 해제되고 명시적 로그아웃 플래그가 저장됩니다.
- 이후 재연결 요청은 기존 Google 계정을 자동으로 재사용하려 하지 않고 계정 선택 화면을 요청합니다. 다른 Google 계정을 선택할 수 있습니다.
- 로그아웃 후 로그인 유지 설정을 바꾸더라도 명시적 로그아웃 잠금은 유지됩니다. 새 Google 인증이 실제 성공해야만 잠금이 해제됩니다.
- 로그인에 성공하면 명시적 로그아웃 플래그만 해제합니다. 사용자가 선택한 새로고침 정책은 그대로 유지됩니다.

## Google 앱 권한 철회

- **Google 앱 권한 철회**는 단순 로그아웃과 별도 버튼입니다.
- 브라우저는 Google Identity Services `revoke()` 완료 응답을 확인합니다.
- Android 공식 런처는 Google Identity `AuthorizationClient.revokeAccess()` 완료 응답을 확인합니다. Android API의 revoke 요청은 해당 앱에 부여된 권한을 철회하며 같은 앱에 승인된 다른 Google 범위도 함께 철회될 수 있습니다.
- 권한 철회에 실패해도 로컬 로그아웃은 수행하지만 실패를 성공으로 표시하지 않습니다.

## 상태 처리

모드는 로그인 유지, 재인증 대기, 명시적 로그아웃, 새로고침 로그인 해제, Google 세션 만료, Google Drive 권한 미승인을 별도 상태로 표시합니다. 토큰 만료 또는 Drive 401 응답 이후에는 저장 토큰을 사용하지 않고 사용자 재인증을 요청합니다. Google 로그인 자체가 취소되거나 팝업이 차단된 경우에도 연결 완료로 표시하지 않습니다.

## 환경 제한

- 브라우저: `http://localhost`, `http://127.0.0.1`, LAN HTTP, HTTPS. 실제 게임 Origin이 인증 페이지로 전달되어야 합니다.
- 브라우저 `file://`: opaque origin으로 안전한 출처 검증이 불가능해 지원하지 않습니다. 로컬 HTTP 서버로 실행하세요.
- Android: 정책별 계정 선택·자동 권한 복구를 지원하는 최신 공식 Wayward Launcher를 사용해야 합니다. 이전 런처는 계정 선택 정책을 네이티브 API에 전달하지 못할 수 있습니다.
- 브라우저 Token Model의 토큰 발급은 Google 정책상 사용자 동작이 필요합니다. 브라우저에서 새로고침 후 자동 로그인/무인 자동 갱신을 보장하지 않습니다.

## Google Drive 세이브

- 저장 파일은 게임 페이지에서 AES-256-GCM으로 암호화한 뒤 Google Drive `appDataFolder`로 직접 업로드합니다.
- 저장 슬롯 식별자, 기존 스냅샷 구조, 저장·복원 함수와 암호화 봉투 형식은 로그인 정책 변경과 분리해 유지합니다.
- 자동 암호화의 내장 키는 공개 모드 소스에서 추출할 수 있으므로 강한 기밀성을 보장하지 않습니다.
- 이전 암호화 형식의 세이브는 저장 당시 암호가 필요할 수 있습니다.
- 슬롯 수는 별도로 제한하지 않습니다. 게임 내부 저장 구조가 호환되지 않으면 복원은 실패할 수 있습니다.

정적 검사와 Android 빌드는 실제 Google 계정 인증, Drive 업로드·복원, Android 기기 내 계정 선택을 대신하지 않습니다. 해당 항목은 실계정·실기기 테스트로 별도 확인해야 합니다.
