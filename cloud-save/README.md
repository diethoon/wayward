# 클라우드세이브 — Google Drive (WML / v0.5.1)

**대상:** Wayward WML
**모드 버전:** 0.5.1

Google Drive `appDataFolder`에 개인 세이브를 저장하는 WML 모드입니다. 세이브 본문은 게임 페이지에서 AES-256-GCM으로 암호화한 뒤 Google Drive에 직접 전송합니다. 인증 서버는 세이브 본문을 받지 않습니다.

## 설치

1. `cloud-save` 폴더를 게임의 `wml/mods/` 안에 복사합니다. `mod.js`, `crypto.js`, `README.md`가 같은 폴더에 있어야 합니다.
2. `wml/mods/mods.js`의 `WML.enable([...])`에 `"cloud-save"`가 있는지 확인합니다. 없을 때만 기존 항목을 보존한 채 추가합니다.
3. 게임을 다시 열고 **클라우드세이브 (Google Drive)** 를 엽니다.

## Google 인증 경로

- 인증 화면은 GitHub Pages의 `https://jeiky224.github.io/cloud/`에서 실행합니다.
- OAuth code 교환·토큰 갱신·권한 철회는 `https://wayward-auth-relay.trpgengine1.workers.dev`에서 처리합니다.
- 인증은 OAuth Authorization Code + PKCE 방식입니다. Google Client Secret은 Cloudflare Worker의 `GOOGLE_CLIENT_SECRET` Secret에만 보관하며 모드 파일이나 GitHub Pages에 넣지 않습니다.
- 게임 페이지와 GitHub 인증 페이지 사이에는 192-bit 임시 nonce가 붙은 `postMessage`를 사용하고, Worker WebSocket 릴레이를 보조 경로로 사용합니다. 게임 주소 자체를 Google OAuth 허용 원본으로 등록할 필요가 없습니다.
- `file://`, `localhost`, `127.0.0.1`, LAN HTTP, HTTPS 및 WebView처럼 게임 Origin이 달라도 동일한 고정 인증 페이지를 사용합니다. 브라우저에서 팝업을 막으면 해당 게임 주소의 팝업을 허용해야 합니다.

### Google Cloud / Cloudflare 사전 설정

- OAuth Client ID: `35944231952-p82giir62o28bo001j9uvmqo3kgp9c99.apps.googleusercontent.com`
- 승인된 리디렉션 URI: `https://jeiky224.github.io/cloud/`
- 요청 범위: `https://www.googleapis.com/auth/drive.appdata`
- Cloudflare Worker `wayward-auth-relay`에 Secret 이름 `GOOGLE_CLIENT_SECRET`을 등록해야 합니다. Secret 값은 Google Cloud Console에서 해당 OAuth Client의 클라이언트 보안 비밀을 사용합니다. 소스 코드나 이 저장소에 올리지 마세요.
- GitHub Pages는 `jeiky224/cloud` 저장소의 `main` 브랜치 루트에서 게시하도록 설정해야 합니다.

## 로그인 유지 / 로그아웃

- **로그인 계속 유지:** refresh token을 현재 게임 Origin의 저장소에 저장하고, 동시에 GitHub 인증 페이지 Origin의 공통 저장소에도 보관합니다. 게임 주소가 `localhost`에서 `127.0.0.1` 또는 `file://`로 바뀌어도 같은 브라우저 프로필에서 중앙 인증 페이지가 refresh token을 갱신해 새 게임 Origin에 전달합니다. 액세스 토큰이 만료되면 모드가 자동 갱신하고 Drive 요청을 한 번 재시도합니다.
- **새로고침하면 로그아웃:** 새로고침하면 로그아웃하도록 선택하면 인증 페이지 공통 저장소도 지웁니다. 토큰은 현재 게임 탭의 메모리에만 남고, 새로고침·재실행 후에는 다시 Google 인증을 거쳐야 합니다.
- **로그아웃:** Google 토큰 철회를 요청하고 현재 게임 Origin 및 GitHub 인증 페이지 공통 저장소의 로그인 정보를 삭제합니다. 팝업이나 네트워크가 막혀 중앙 저장소 삭제 또는 Google 권한 철회를 확인하지 못하더라도 게임 Origin의 로컬 로그인 정보는 삭제합니다.
- 브라우저 프로필, Android WebView 데이터 폴더, 앱 데이터 영역이 서로 분리된 경우에는 저장소가 공유되지 않습니다. 그런 환경은 처음 한 번 각 프로필에서 Google 인증을 해야 하며, 한 프로필에서 로그인한 토큰을 다른 앱/브라우저의 보안 저장소로 강제로 옮기지는 않습니다.

**‘영원히’ 유지는 보장할 수 없습니다.** Google은 사용자가 권한을 철회하거나 refresh token을 6개월 동안 사용하지 않는 경우, 비밀번호 변경·계정 보안 정책·토큰 수 제한·OAuth 동의 화면의 테스트 상태 등으로 refresh token을 무효화할 수 있습니다. Google 프로젝트의 OAuth 동의 상태는 외부 사용자에 대해 Production으로 게시해야 하며, Testing 상태에서는 일반적으로 refresh token이 7일 후 만료됩니다. 그 외 Google이 권한을 유지하는 동안에는 자동 갱신을 계속 시도합니다.

## 세이브 데이터

- 저장 파일은 게임 페이지에서 AES-256-GCM으로 암호화한 뒤 Google Drive `appDataFolder`로 직접 업로드합니다.
- 새 세이브는 별도 비밀번호 입력 없이 암호화됩니다. 이전 암호화 형식의 세이브는 저장 당시 암호가 필요할 수 있습니다.
- 슬롯 수를 별도로 제한하지 않습니다.
- 게임 빌드 식별자는 진단용이며 날짜가 다르다는 이유만으로 불러오기를 차단하지 않습니다. 단, 게임 내부 저장 구조가 호환되지 않으면 복원이 실패할 수 있습니다.
- 모드에 포함된 구형 임베디드 암호화 키는 소스 분석으로 추출할 수 있으므로 강한 기밀성의 근거로 취급하지 마세요.
- 기존 Cloudflare 일회성 공유 저장 데이터는 자동으로 Drive로 이전되지 않습니다.

## 문제 해결

- 팝업이 열리지 않으면 게임 페이지에서 팝업을 허용하고 다시 연결하세요.
- `Google OAuth server secret is not configured`가 나오면 Cloudflare Worker에 `GOOGLE_CLIENT_SECRET`이 등록되지 않은 것입니다.
- `redirect_uri_mismatch`가 나오면 Google OAuth Client의 승인된 리디렉션 URI가 `https://jeiky224.github.io/cloud/`와 정확히 일치하는지 확인하세요.
- refresh token이 폐기된 경우 모드에서 로그아웃한 뒤 Google 계정으로 다시 연결하세요.
- 저장 목록은 첫 연결 후 자동으로 불러옵니다. 네트워크 오류가 발생하면 저장 목록 새로고침을 다시 눌러 주세요.
