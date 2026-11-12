# 클라우드세이브 — Google Drive (WML / static direct-auth candidate)

**대상:** Wayward WML  
**현재 후보 버전:** 0.6.2-static-auth (검증 전 후보)

Google Drive `appDataFolder`에 개인 세이브를 저장하는 WML 모드입니다. 저장·목록·덮어쓰기·불러오기·삭제는 Google Drive API에 직접 요청합니다. 저장 데이터는 게임 페이지에서 기존 AES-256-GCM 형식으로 암호화합니다.

## 인증 구조

- 정적 인증 저장소: `https://jeiky224.github.io/cloud/`
- 게임에서 여는 실제 인증 문서: `https://jeiky224.github.io/cloud/auth.html`
- `index.html`은 정적 진입 안내, `auth.html`/`auth.js`는 Google Identity Services Token Model, `recovery.html`은 팝업·외부 브라우저 수동 복구 안내입니다.
- Google OAuth Client ID는 공개 Web Client ID만 사용합니다. Client Secret, Authorization Code 교환 서버, Refresh Token broker는 없습니다.
- 인증 페이지는 Google Token Model로 직접 액세스 토큰을 받고, Google Drive 요청은 모드가 `https://www.googleapis.com`에 직접 보냅니다.
- Android 공식 런처는 Google Identity `AuthorizationClient` 브리지를 사용합니다. 런처가 없는 환경은 정적 인증 페이지를 열고, 팝업 반환이 끊기면 일회성 JSON을 복사·붙여넣기합니다.
- `file://`은 opaque origin `null`로 처리합니다. 인증 페이지에서 게임으로 보낼 때만 `targetOrigin='*'`를 쓰며, 게임은 발신 origin이 `https://jeiky224.github.io`인지, 발신 창이 현재 요청의 팝업인지, 192-bit nonce와 메시지 타입·토큰 구조가 맞는지 모두 검사합니다.
- `localhost`, `127.0.0.1`, `0.0.0.0`, LAN HTTP, HTTPS는 각각 실제 `location.origin` 값을 사용합니다. `0.0.0.0`을 `localhost` 또는 opaque origin으로 취급하지 않습니다.
- 팝업 연결이 없거나 외부 브라우저로 분리되면 인증 페이지가 JSON 결과를 화면에 표시합니다. 사용자가 직접 복사해 원래 CloudSave 창에 붙여 넣을 수 있습니다. 토큰은 URL, localStorage, GitHub Pages 저장소에 기록하지 않습니다.

## Google Token Model 한계

Token Model은 짧은 수명의 액세스 토큰을 제공합니다. 만료 또는 권한 철회 뒤에는 사용자가 CloudSave의 연결 버튼을 눌러 Google에 직접 재인증해야 합니다. 기존 계정 승인 상태가 남아 있으면 계정·동의 단계를 줄일 수 있지만, 이를 Refresh Token 기반 무인 갱신으로 간주하지 않습니다. 장기 무인 로그인은 브라우저 Token Model에서 보장하지 않습니다.

## 설치

1. `cloud-save` 폴더를 게임의 `wml/mods/` 안에 복사합니다. `mod.js`, `crypto.js`, `README.md`가 같은 폴더에 있어야 합니다.
2. `wml/mods/mods.js`의 `WML.enable([...])`에 `"cloud-save"`가 있는지 확인합니다. 없을 때만 기존 항목을 보존한 채 추가합니다.
3. 게임을 다시 열고 **클라우드세이브 (Google Drive)** 를 엽니다.

## 보존 범위

- Google Drive scope: `https://www.googleapis.com/auth/drive.appdata`
- Drive의 `appDataFolder`, 파일명 `wayward-cloud-slot-{slot}.json`, 기존 Drive file ID를 유지합니다.
- 세이브 snapshot schema, native save format, 암호화 envelope 및 `crypto.js`는 인증 연결 변경과 분리합니다.
- 기존 액세스/Refresh Token을 게임 Origin `localStorage`에서 제거합니다. 이전 저장 토큰이 발견되면 재사용하지 않습니다.
- Android 런처는 Google Identity API의 기기 계정 승인 상태를 이용합니다. 브라우저는 액세스 토큰을 현재 페이지 메모리에만 보관합니다.

## 검증 상태

이 후보의 코드·브라우저 시뮬레이션·실계정 테스트는 별도 기록합니다. 정적 검사나 시뮬레이션만 통과한 환경을 실계정 CloudSave 성공으로 보고하지 않습니다.
