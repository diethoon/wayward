# 클라우드세이브 — Google Drive (WML / v0.6.0)

**대상:** Wayward WML  
**모드 버전:** 0.6.0

Google Drive `appDataFolder`에 개인 세이브를 저장하는 WML 모드입니다. Google Drive API를 브라우저/런처에서 직접 호출하며 세이브 데이터 구조와 슬롯 처리는 기존 버전과 호환되도록 유지합니다.

## 설치

1. `cloud-save` 폴더를 게임의 `wml/mods/` 안에 복사합니다. `mod.js`, `crypto.js`, `README.md`가 같은 폴더에 있어야 합니다.
2. `wml/mods/mods.js`의 `WML.enable([...])`에 `"cloud-save"`가 있는지 확인합니다. 없을 때만 기존 항목을 보존한 채 추가합니다.
3. 게임을 다시 열고 **클라우드세이브 (Google Drive)** 를 엽니다.

## 인증 구조 — 서버 없는 GitHub Pages

- 브라우저 인증 화면은 `https://jeiky224.github.io/cloud/` 한 곳에서만 호스팅합니다.
- 이 페이지는 Google Identity Services의 브라우저 Token Model을 사용해 Google에서 액세스 토큰을 직접 받습니다.
- OAuth Client Secret, 인증 코드 교환 서버, 토큰 갱신 서버, 세션 중계 서버는 사용하지 않습니다.
- 인증 페이지와 게임은 192-bit nonce, 실제 브라우저 Referer origin, `postMessage`의 발신 창/출처 검증으로 응답을 연결합니다. 토큰은 URL이나 브라우저 기록에 넣지 않습니다.
- 게임 페이지는 Google Drive API를 Google에 직접 요청합니다. 인증 페이지나 다른 서버로 세이브 파일을 보내지 않습니다.
- GitHub Pages는 `jeiky224/cloud` 저장소의 `main` 루트에 `index.html`을 배치해 게시합니다. Google OAuth Web Client의 Authorized JavaScript origins에 `https://jeiky224.github.io`를 등록해야 합니다. Token Model에는 OAuth redirect URI나 Client Secret이 필요하지 않습니다.

### Android 공식 런처

Google은 Android WebView 내부의 OAuth 웹 로그인을 지원하지 않습니다. 공식 Wayward Launcher에는 Android Google Identity 권한 요청 브리지가 이미 있으므로, 런처 실행에서는 그 네이티브 API를 호출해 액세스 토큰을 얻고 WML 모드에 전달합니다. 이 경로도 외부 인증 서버를 사용하지 않습니다. Android 런처의 네이티브 토큰 캐시 삭제와 Google 앱 권한 철회는 서로 다른 작업입니다.

다른 WebView/런처에 네이티브 Google Identity 브리지가 없으면 OAuth 결과를 외부 브라우저에서 안전하게 원래 WebView로 반환할 서버 없는 채널이 없으므로 해당 환경은 지원하지 않습니다. 브라우저 팝업이 차단되면 해당 게임 사이트의 팝업을 허용해야 합니다.

### 지원 Origin 및 보안 제한

- `http://localhost`, `http://127.0.0.1`, `http://0.0.0.0`, 사설 LAN HTTP 및 HTTPS 브라우저 Origin은 실제 Referer Origin과 요청 Origin이 일치할 때만 인증 응답을 전달합니다.
- `file://`는 opaque origin이어서 게임 출처를 신뢰성 있게 확인할 수 없습니다. 토큰 탈취 방지를 위해 브라우저 경로에서는 지원하지 않습니다. 로컬 HTTP 서버(가급적 `127.0.0.1`)로 실행하세요.
- `0.0.0.0`는 서버 바인딩 주소로만 사용하고 브라우저 접속은 `127.0.0.1` 또는 실제 LAN IP를 권장합니다.

## 로그인 유지와 토큰 만료

- Google의 브라우저 Token Model은 액세스 토큰만 발급하며 Refresh Token을 발급하지 않습니다.
- 액세스 토큰은 현재 게임 탭 메모리에만 보관하며 localStorage, URL, GitHub Pages 저장소에 기록하지 않습니다.
- Google 액세스 토큰은 만료 시 사용자 동작으로 다시 요청해야 합니다. 브라우저에 Google 계정 로그인 세션이 남아 있으면 **로그인 계속 유지** 설정으로 계정 선택을 간소화할 수 있지만, 백그라운드 자동 갱신이나 재실행 후 무인 로그인은 보장하지 않습니다.
- v0.5.2에서 저장했던 게임 Origin 및 GitHub Pages Origin의 구형 Refresh Token 키는 새 버전이 로드될 때 삭제합니다.
- **로그아웃:** 로컬 액세스 토큰 및 이전 버전의 저장 토큰을 삭제합니다. 일반 브라우저에서는 GitHub Pages가 Google Identity Services의 `revoke()`를 호출하고 성공 응답을 받을 때만 권한 철회 성공으로 표시합니다. Android 네이티브 경로는 현재 런처의 토큰 캐시를 지우며 Google 권한 철회 성공으로 오인하지 않습니다.

## Google Drive 세이브

- 저장 파일은 게임 페이지에서 AES-256-GCM으로 암호화한 뒤 Google Drive `appDataFolder`로 직접 업로드합니다.
- 업로드·다운로드·저장 목록은 Google Drive API에 직접 요청하며 인증 중계 서버를 거치지 않습니다.
- 슬롯 식별자, 기존 스냅샷 구조, 저장·복원 함수와 암호화 봉투 형식은 인증 변경과 분리해 유지합니다.
- 새 세이브는 모드에 포함된 임베디드 AES-256-GCM 키로 자동 암호화됩니다. 이 키는 공개 모드 소스에서 추출할 수 있으므로 강한 기밀성의 근거로 취급하지 마세요. 더 높은 기밀성이 필요하면 개인 비밀번호 암호화 방식을 선택해야 합니다.
- 이전 암호화 형식의 세이브는 저장 당시 암호가 필요할 수 있습니다.
- 슬롯 수를 별도로 제한하지 않습니다. 단, 게임 내부 저장 구조가 서로 호환되지 않으면 복원이 실패할 수 있습니다.

## 검수 포인트

1. 브라우저: GitHub Pages 인증 팝업 → Google 로그인 → 게임 창 복귀 → Drive 목록 조회
2. Android 공식 런처: 네이티브 Google 권한 승인 → Drive 목록 조회
3. 새 세이브 업로드 → 게임 재실행 → 새 토큰 발급 → 다운로드 및 복원
4. 로그아웃 후 로컬 토큰 삭제 확인, 브라우저에서는 별도 Google 권한 철회 결과 확인
5. 액세스 토큰 만료 후 수동 재연결 요구가 표시되는지 확인

정적 검사만으로 실제 Google OAuth나 실제 Drive 업로드/복원이 성공했다고 간주하지 않습니다.
