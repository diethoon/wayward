# Wayward Android Launcher 0.3.12 · SAF/ZIP, 이미지 서비스 및 이미지 전달 진단

Android SAF 폴더 실행기입니다. 게임 원본 폴더는 직접 읽고, 일반 WML ZIP 모드는 앱 내부에 보관해 가상 제공하며, 여러 게임 폴더를 독립 세션으로 실행합니다. Image Studio 백엔드는 별도 ZIP 설치를 요구하지 않고 각 세션의 실제 WML 모드 폴더에서 감지합니다.

> **설치 주의:** 0.3.0 테스트 APK는 기존 앱 서명키를 확인할 수 없어 `com.wayward.launcher.imagegen` 별도 앱 ID로 빌드합니다. 기존 0.2.1을 삭제하거나 덮어쓰지 않습니다. Android 앱 데이터(WebView의 IndexedDB/localStorage)는 앱 간 자동 공유되지 않으므로 새 앱에서 게임 폴더를 다시 등록해야 하고, 기존 로컬 저장 데이터는 구형 앱에 남습니다. 교체 전에 게임 내보내기 또는 클라우드 세이브를 확인하세요.

## 1. 게임 폴더 등록과 여러 세션

1. **게임 폴더 추가**에서 Wayward 또는 Faith 게임 폴더를 선택합니다.
2. 등록된 게임 폴더 목록에서 **실행**을 누릅니다.
3. 다른 버전도 **게임 폴더 추가**로 등록한 뒤 각각 실행합니다.
4. Android 최근 앱 화면에서 각 게임을 별도 작업으로 전환할 수 있습니다.

게임 파일명은 Wayward_WML_ko.html, Wayward_WML.html, index.html을 우선하고, 그 외에는 루트의 Wayward_Faith*.html 또는 Wayward*.html을 탐색합니다.

각 폴더는 안정적인 프로필 ID를 사용하고, WebView 출처는 `https://localhost:<프로필별 고정 포트>`로 구성해 localStorage·IndexedDB·WML 모드 on/off·로드 순서를 프로필별로 분리합니다. `localhost` 출처는 게임의 기존 이미지 백엔드 자동 탐색 조건도 만족시키며, HTTPS AssetLoader로 게임 파일을 제공합니다. Android가 백그라운드 세션의 프로세스를 종료할 수는 있지만, 최근 앱에서 다시 열면 같은 폴더와 같은 세션 저장소로 복구됩니다.

## 2. WML ZIP 모드 설치

1. **모드 ZIP 설치**를 누릅니다.
2. 파일 선택기에서 ZIP 모드 하나 또는 여러 개를 선택합니다.
3. ZIP 안의 mod.js에서 WML.define({ id: ... }) ID를 확인한 뒤 앱 내부에 설치합니다.

ZIP은 다음 두 구조를 지원합니다.

~~~text
mod.zip
└── mod.js
~~~

~~~text
mod.zip
└── mod-folder/
    ├── mod.js
    ├── images/
    └── other-assets/
~~~

ZIP은 filesDir/wml-zip-mods/<mod-id>.zip에 그대로 보관합니다. 압축을 풀지 않고 ZipFile에서 필요한 mod.js와 자산 파일을 요청 시 스트리밍합니다. 게임 폴더의 wml/mods/에는 파일이나 폴더를 생성하지 않습니다.

앱 전용 ZIP 모드는 등록된 모든 게임 프로필에서 공통으로 제공되지만, 모드 활성화와 로드 순서는 각 게임 프로필의 WebView 저장소에 따로 보관됩니다. 같은 ID의 실제 게임 폴더 모드가 있으면 해당 폴더의 파일을 우선합니다.

ZIP 1개는 WML 모드 1개를 포함해야 합니다. mod.js가 없거나, WML.define/ID를 확인할 수 없거나, 같은 깊이의 mod.js가 여러 개면 설치하지 않습니다. ZIP 최대 크기는 512MB, mod.js 최대 크기는 64KB, 개별 ZIP 자산은 최대 256MB입니다.

## 3. 게임 안 WML ZIP 파일 선택기

게임 WebView의 HTML 파일 입력 버튼도 Android SAF 파일 선택기로 연결합니다. WML 모드 관리자에서 **모드 파일 고르기**를 누르면 Android 문서 선택기가 열리고, 단일 파일 및 복수 ZIP 선택 결과가 기존 웹 페이지로 반환됩니다. 선택 취소 시 WebView 콜백도 취소 상태로 정리합니다.

이 경로는 게임 HTML/WML ZIP 파서를 수정하지 않습니다. WebView의 WebChromeClient.onShowFileChooser()를 처리하는 Android 네이티브 브리지이며, 런처 홈의 **모드 ZIP 설치** 경로와 별개입니다.

## 4. 원본 폴더와 앱 저장소

- 게임 HTML, 이미지, 기존 wml/ 파일은 선택한 SAF 폴더에서 직접 읽습니다.
- 모드 ZIP만 앱 비공개 저장소에 별도로 복사합니다.
- ZIP 설치·삭제는 선택한 게임 폴더를 수정하지 않습니다.
- 세이브/백업 내보내기는 기존처럼 Download/Wayward/를 사용합니다.
- 앱을 삭제하면 앱 전용 ZIP 모드와 세션별 WebView 저장소도 삭제됩니다.

## 5. 이미지 전달 진단

런처 홈의 **이미지 전달 진단 · 로그 보기**에서 새 진단을 시작한 뒤 게임으로 돌아가 이미지 한 장을 생성하고 다시 진단 화면을 열어 확인합니다. HTTP 이미지 수신, 네이티브 이미지 바이트/형식, WebView 브리지 호출, data URL 디코딩 및 DOM 이미지 요소의 load/error 단계를 구분해 기록합니다. 프롬프트 원문, API 키, 이미지 바이트, URL 쿼리·fragment·계정정보는 기록하지 않습니다. HTTP(S) 이미지 요청은 호스트와 민감 경로 요소를 정제한 경로만, IMG 요소는 길이를 제한한 id/class/alt만 기록합니다. 진단 로그는 앱 내부에만 저장되며 일반 원격 진단 로그와 별도로 유지되고 자동 업로드하지 않습니다. **로그 복사**를 눌러 지원 요청에 첨부할 수 있습니다.

## 6. 설치 패키지

0.3.12 진단 테스트 빌드는 `com.wayward.launcher.imagegen039` 별도 패키지 ID를 사용하므로 기존 `imagegen038` 런처와 나란히 설치됩니다. 기존 앱을 덮어쓰거나 삭제하지 않습니다. 기존 0.3.6 (`com.wayward.launcher.imagegen036`), 0.3.5 (`com.wayward.launcher.imagegen035`), 0.3.4 (`com.wayward.launcher.imagegen034`) 및 구버전과 별도 앱으로 공존하므로 기존 앱을 삭제하거나 덮어쓰지 않습니다. 앱 데이터는 패키지별로 분리되므로 새 진단 앱에서 게임 폴더를 다시 등록하고, Cloudflare FLUX 서비스 설정을 다시 입력해야 합니다. 이전 앱의 앱 전용 ZIP 모드도 새 앱에 다시 설치해야 합니다. 기존 앱의 WebView localStorage/IndexedDB, 설정, 세이브 데이터는 자동 이전되지 않으며 기존 앱에 그대로 남습니다. 두 버전은 `127.0.0.1:8189` 포트를 공유하므로 다른 런처 앱에서 Image Studio 서버를 중지한 뒤 새 버전을 실행하세요. 기존 앱은 삭제하지 마세요.

## 7. 세션별 Image Studio 자동 감지와 공통 서버

게임 세션을 열 때 런처가 **그 세션의 `wml/mods/imagestudio`** 폴더를 직접 검사합니다. `mod.js`의 WML ID가 `imagestudio`이고 `backend/wayward-imagegen`의 `package.json`과 `src/cli.ts`가 확인된 경우에만 서버를 준비합니다. 다른 등록 세션을 뒤져 백엔드를 가져오지 않으며, Image Studio 전용 ZIP 설치도 요구하지 않습니다. 일반 WML ZIP 모드 설치 기능은 그대로 유지됩니다.

백엔드는 현재 세션에서 앱 비공개 저장소로 복사하고, 서버는 앱 전체에서 하나만 `127.0.0.1:8189`로 실행합니다. 같은 Image Studio 백엔드 버전을 사용하는 다른 세션은 이 서버를 공유합니다. 버전이 다르면 잘못된 백엔드로 요청하지 않도록 연결을 거부하고, 기존 서버를 중지한 뒤 해당 세션을 다시 열도록 안내합니다. 세션별 WebView 저장소와 WML 모드 활성화 상태는 기존처럼 분리됩니다.

Bun Android ARM64 v1.4.4 실행 파일은 공식 아카이브를 내려받아 SHA-256 검증 후 앱 내부에 설치합니다. 서버는 `:imagegen` 별도 Android 프로세스의 Foreground Service에서 실행되며, 런처 UI와 상태 파일로 연결 상태를 공유합니다. 첫 실행은 런타임 다운로드와 패키지 설치 때문에 시간이 걸릴 수 있습니다. 서비스가 비정상 종료되어 heartbeat가 끊기면 시작 중 상태를 만료시켜 게임 UI가 계속 대기하지 않게 합니다. 진단 로그는 앱 비공개 저장소의 `imagegen/startup.log` 및 `imagegen/server.log`에 기록합니다.

NovelAI 인증 정보는 EasyGen의 설정 패널에서 최초 1회 설정합니다. 런처는 EasyGen이 사용하는 인증 저장 형식을 그대로 두며 NovelAI 토큰을 별도의 새 저장소로 복제하지 않습니다. 게임의 `http://127.0.0.1:8189/api/*` Fetch 요청만 네이티브 브리지로 전달하며, 그 외 외부 요청은 변경하지 않습니다.

**미완료/미검증:** Bun Android는 실험적 지원이므로 Galaxy S25 Ultra에서 실제 실행·종속 패키지 설치·NovelAI/ComfyUI 이미지 생성까지 아직 검증되지 않았습니다. 현재 게임 연결 브리지는 Fetch 기반 `/api/*` 요청만 처리하며 WebSocket/EventSource/XHR 경로는 확인되지 않았습니다. ComfyUI는 PC에서 실행 중이어야 하며, 휴대폰 런처가 PC의 ComfyUI 프로세스를 대신 실행하지는 않습니다.

## 8. 검증 범위

CI에서 Android APK 컴파일·서명 검증을 수행합니다. 실제 Android 기기의 ZIP 선택기, 모드별 자산 로딩, 최근 앱 간 세션 동시 실행은 기기에서 별도 확인해야 합니다. CI 통과를 실기기 동작 검증으로 간주하지 않습니다.


## 9. 런처 진단 로그 자동 전송

별도 설정이나 연결 코드 입력 없이, 오류/경고 발생 직후 또는 앱 실행·복귀 때 대기 중인 진단 로그를 HTTPS로 자동 전송합니다. 전송에 실패하면 앱 비공개 저장소에 로그를 보관하고 다음 실행/복귀 때 재시도합니다. 앱을 설치하고 실행하는 것 외에 사용자가 연결 절차를 진행할 필요가 없습니다.

수집 항목은 런처 프로세스 시작/종료와 Java 예외 스택, Android가 제공하는 이전 프로세스 종료 사유, WebView 페이지 로딩 및 JavaScript 오류의 발생 위치, ImageGen 서비스 시작/중지/실패, ImageGen API의 경로·상태 코드·처리 시간입니다. 기기 모델/Android 버전과 앱별 무작위 설치 ID도 포함됩니다. URL 전체와 JS 콘솔 메시지 내용은 수집하지 않습니다.

게임 세이브, 이미지, 프롬프트, 요청/응답 본문, 인증 헤더, 쿠키, API 토큰은 수집하지 않습니다. ImageGen API도 요청 헤더와 본문을 기록하지 않습니다. 로그는 앱 비공개 저장소에서 파일당 최대 512KiB로 순환 보관하고, 네트워크 오류 시 삭제하지 않고 다음 실행/복귀 때 재전송합니다.

수신기는 Vercel Serverless Functions이며 로그 원본은 비공개 Vercel Blob에 저장합니다. 업로드 API는 인증 토큰 없이 호출할 수 있지만, 허용된 진단 이벤트 필드만 서버에서 다시 구성하고 이벤트당 크기·배치 수·기기별 분당 횟수·네트워크별 분당 횟수를 제한합니다. 네트워크 주소는 메모리 내 요청 제한에만 사용하고 저장하지 않습니다. 로그 열람 API는 별도 관리자 키로 계속 보호하며 APK에는 해당 키를 포함하지 않습니다. 실행 로그에도 `WAYWARD_DIAG` 접두사로 기록해 즉시 오류를 조회할 수 있습니다. Blob은 매일 UTC 04:00 예약 작업으로 확인해 7일이 지난 파일을 자동 삭제합니다. Android 앱은 다른 앱의 logcat이나 OS 내부 로그를 읽을 수 없으므로 런처 프로세스·WebView·ImageGen 서비스와 Android가 공개하는 종료 이력만 수집합니다.


## 10. 신캐 이미지 로컬 전용 경로 (0.3.6)

신캐 이미지의 URL은 `https://art.sintention.com/images/illustrious/characters/<캐릭터>/...` 형식입니다. 런처는 이 경로에만 CDN 우회(fallback)를 허용하지 않습니다. 요청된 상대 경로를 선택한 게임 폴더의 `Images/illustrious/characters/...` 또는 `images/illustrious/characters/...`에서 그대로 찾고, 파일이 없으면 로컬 404로 끝냅니다. 신캐 이미지가 원격 서버로 다시 요청되지 않습니다.

경로는 SAF 폴더 트리에서 각 디렉터리 구성요소를 정확히 따라가며, 대소문자만 다른 경로는 동일하게 처리합니다. 여러 후보를 추측하거나 다른 폴더를 재귀 탐색하지 않습니다. JS 파일이 `illustrious/characters/<캐릭터>/파일명.webp`를 가리키고 실제 파일이 게임 폴더의 `Images/illustrious/characters/<캐릭터>/파일명.webp`에 있으면 AWebServer 테스트 모드와 같은 상대경로로 불러옵니다.

그 외 `art.sintention.com/images/...` 리소스는 기존 동작을 보존합니다. 선택한 폴더에서 같은 경로를 먼저 찾고, 없으면 CDN 요청으로 돌아갑니다. 따라서 기존 기본 캐릭터 이미지의 원격 로딩 방식은 변경하지 않습니다.

이 변경은 일반 WML의 신캐 이미지 요청 경로에만 적용합니다. Faith 전용 경로 규칙이나 이미지 자동 탐색은 추가하지 않으며, 게임 JS·캐릭터 데이터·세이브·RNG·게임 로직은 수정하지 않습니다.


## 11. 런타임 응답성 최적화 (0.3.8)

- ZIP 모드 요청마다 ZipFile을 다시 열고 ZIP 전체의 mod.js를 찾아 ID를 재검증하던 동작을 설치 시 검증된 모드 ID와 메타데이터를 재사용하는 방식으로 변경했습니다. 열려 있는 ZIP은 최대 4개까지 LRU 캐시하고, 스트림이 사용 중인 파일은 읽기가 끝난 뒤 닫습니다.
- 홈 화면 복귀 시 ZIP 목록을 표시하려고 모든 ZIP의 내부 엔트리를 다시 스캔하지 않습니다. 설치 때 검증한 `<mod-id>.zip` 파일명으로 목록을 만듭니다.
- SAF 디렉터리 목록은 같은 경로에 대한 동시 조회를 하나로 합치고, 서로 다른 디렉터리는 최대 4개까지 조회합니다. 디렉터리 캐시는 기존 용량 한도 내에서 LRU로 유지합니다.
- 이미지 경로의 대소문자 비구분 검색 결과를 디렉터리별로 캐시합니다. WML 모드 ID 목록도 명시적 새로고침 전까지 재사용합니다.
- 이미지 요청은 실패(HTTP 4xx/5xx)하거나 로컬 조회가 350ms 이상 걸릴 때만 경로·상태·시간을 기록하며, WebView당 최대 16건으로 제한합니다. 게임 세이브와 이미지 본문은 기록하지 않습니다.
- WebView JavaScript 오류는 발생한 스크립트 경로와 줄 번호만 WebView당 최대 16건 기록합니다. 콘솔 메시지 본문은 게임 대사·세이브 데이터가 섞일 수 있어 수집하지 않습니다.

이번 변경은 런처의 파일 제공·캐시·조회 경로만 최적화합니다. 게임 HTML/JS, WML 모드, 세이브, RNG, ID, Undo, 경제, 공급 및 캐릭터 행동은 수정하지 않습니다. 실제 S25 Ultra의 메뉴 반응성, 썸네일 로딩 시간과 게임 진행 중 이미지 매칭은 새 APK를 기기에서 확인해야 합니다. ImageGen/Bun 실행 환경은 이 변경의 해결 범위에 포함하지 않습니다.

## 12. 이미지 생성 서비스 등록과 관리 (0.3.9)

런처 홈의 **이미지 서비스 관리 · 등록 / 테스트**에서 생성 서비스를 등록합니다. 이 기능은 Cloudflare 전용 화면이 아니라 서비스 정의를 저장하는 공통 카탈로그입니다.

### 제공 템플릿

- **Cloudflare FLUX Worker**: Worker URL에 프롬프트 JSON을 POST하고 { "success": true, "image": "<Base64>", "mimeType": "image/jpeg" } 형식으로 받은 이미지를 표시합니다. Worker가 내부 모델을 고정한다면 모델 입력은 비워도 됩니다.
- **OpenAI 호환 Images API**: 기본 주소 또는 /v1 주소를 입력합니다. 런처가 /v1/images/generations를 구성하고, 모델 ID·프롬프트·크기·1장 요청을 전송합니다. data[0].b64_json 및 data[0].url 응답을 처리합니다.
- **사용자 지정 REST · JSON**: 동기식 JSON POST를 구성합니다. 요청 본문 템플릿에서 {{prompt}}, {{model}}, {{width}}, {{height}}, {{size}} 값을 사용할 수 있고, 응답의 이미지 JSON 경로를 지정할 수 있습니다. 응답은 Base64, data URL 또는 이미지 URL을 지원합니다.

### 등록 순서

1. 서비스 이름과 API 주소를 입력하고 템플릿을 선택합니다.
2. 필요한 경우 모델 ID와 API 키/토큰을 입력합니다.
3. 사용자 지정 REST라면 요청 JSON, 응답 이미지 경로, 반환 형식을 설정합니다.
4. **실제 생성 테스트**를 실행해 요청·인증·이미지 응답과 미리보기를 확인합니다. 이 테스트는 실제 생성 요청이므로 제공자의 요금/크레딧을 사용할 수 있습니다.
5. 저장한 다음 게임별 기본 생성 서비스와 실패 시 대체 서비스를 지정합니다. Wayward와 Faith는 각각 독립된 기본/대체 서비스 값을 가집니다. 대체 서비스는 기본 서비스 요청이 실패했을 때 한 번만 호출되며, 이 경우에도 별도 생성 비용이 발생할 수 있습니다.

기존 서비스 편집 시 API 키 입력란을 비워두면 저장된 키를 유지합니다. 키를 변경하려면 새 키를 입력하세요. 서비스 삭제 시 해당 서비스가 기본값으로 지정된 게임 프로필의 기본값도 함께 해제합니다.

### 보안과 게임 사용 권한

- 서비스 설정과 API 키는 Android 앱 내부 파일에 저장되며 AES-256-GCM으로 암호화됩니다. 암호화 키는 Android Keystore에 보관합니다.
- WML 브리지와 게임 JavaScript에는 API 키·인증 헤더를 전달하지 않습니다. 등록된 서비스의 ID·이름·종류·모델과 프로필 기본값만 공개합니다.
- 새 서비스의 **게임 WML 모드에서 사용 허용**은 기본적으로 꺼져 있습니다. 켜야만 게임 모드가 그 서비스를 호출할 수 있습니다. 서비스 관리 화면의 실제 생성 테스트는 이 권한과 무관하게 사용할 수 있습니다.
- 외부 인터넷 서비스는 HTTPS 주소만 허용합니다. HTTP는 사설 LAN 주소에만 허용합니다. 이미지 URL의 리디렉션은 거부합니다.
- API 키는 진단 로그에 기록하지 않습니다. 로그에는 성공/실패, 서비스 ID·종류, 이미지 바이트 수와 오류 분류만 기록합니다.
- 암호화된 서비스 설정 파일은 Android 클라우드 백업과 기기 간 데이터 전송에서 제외합니다. 앱을 새 기기로 옮길 때는 이미지 서비스와 API 키를 새 기기에서 다시 등록해야 합니다.

### WML 모드 연결 API

런처 WebView는 문서 시작 시 window.WaywardImageProviders를 제공합니다.

~~~js
const { providers, defaultProviderId, fallbackProviderId } = window.WaywardImageProviders.list();

const result = await window.WaywardImageProviders.generate({
  // 생략하거나 빈 문자열이면 현재 게임 프로필의 기본 서비스 사용
  providerId: defaultProviderId || "",
  prompt: "a small orange circle on a warm off-white background",
  width: 1024,
  height: 1024
});

// result.dataUrl을 img.src 등에 연결
console.log(result.mimeType, result.fallbackUsed, result.dataUrl);
~~~

generate()는 이미지 생성이 끝난 뒤 { ok, providerId, fallbackUsed, mimeType, dataUrl }을 돌려줍니다. providerId를 지정하지 않으면 현재 게임 프로필의 기본 서비스를 사용하고, 그 요청이 실패하면 프로필의 대체 서비스를 한 번 시도합니다. providerId를 직접 지정하면 해당 서비스만 호출합니다. 서비스가 등록되지 않았거나 게임 사용 권한이 꺼져 있으면 오류로 끝납니다. 네이티브 브리지는 동시 실행을 제한하고 API 키를 반환하지 않습니다.

### 현재 지원 범위와 미지원 프로토콜

현재 공통 클라이언트가 구현한 것은 **한 번의 JSON HTTP 요청으로 작업을 제출하고 이미지 또는 Base64/URL을 바로 반환하는 동기식 API**입니다. OpenAI 호환 API와 사용자 지정 JSON 형식이라도 요청 JSON과 응답 이미지가 이 흐름에 맞으면 등록할 수 있습니다.

ComfyUI의 /prompt + WebSocket/히스토리 조회, Replicate·fal.ai 등의 비동기 작업 제출/폴링, multipart 업로드, OAuth 브라우저 로그인, 이미지 편집용 입력 파일 전송은 아직 구현하지 않았습니다. 이 서비스들은 서비스 등록 화면에 URL만 입력한다고 동작하지 않습니다. 해당 프로토콜의 작업 ID·상태·결과 응답을 처리하는 전용 어댑터를 추가해야 합니다.

또한 이 런처 브리지가 제공된다고 해서 기존 Image Studio 모드가 자동으로 이 브리지를 사용하도록 바뀌는 것은 아닙니다. 현재 저장소에는 Image Studio의 실제 WML 클라이언트 소스가 없어, 그 모드의 기존 NovelAI/ComfyUI 선택 흐름을 이 카탈로그에 자동 연결했다고 주장하지 않습니다. WML 모드는 위 WaywardImageProviders API를 호출하도록 연결해야 합니다. 기존 Image Studio 로컬 서버 경로는 별도로 보존됩니다.


## 13. EasyGen NovelAI 및 PC ComfyUI 원터치 연결 (0.3.10)

홈 화면의 이미지 생성 서비스 영역에 두 개의 서버 실행 버튼이 추가됐습니다. 기존 Cloudflare FLUX 등 외부 API 서비스 등록/테스트는 별도로 계속 사용할 수 있습니다.

### NovelAI · EasyGen 서버 실행

1. EasyGen 모드가 들어 있는 게임 폴더를 등록하거나, **모드 ZIP 설치**에서 EasyGen 모드 ZIP을 앱 전용으로 설치합니다.
2. 홈에서 **NovelAI · EasyGen 서버 실행**을 누릅니다.
3. 런처가 선택된 게임 폴더의 `wml/mods/easygen/server/`를 찾습니다. 실제 폴더에 없으면 앱 전용 ZIP의 `server/`를 사용합니다.
4. 서버가 준비되면 **이미지 생성 설정 / 상태 열기**를 눌러 EasyGen 설정 패널을 엽니다. NovelAI 계정 인증과 모델 선택은 EasyGen 패널에서 진행합니다.

Termux를 별도로 설치하거나 명령어를 입력할 필요가 없습니다. 첫 실행 때 런처가 Bun Android ARM64 런타임을 내려받아 SHA-256을 확인하고, EasyGen의 `wayward-imagegen` 의존 패키지를 설치한 뒤 `bun launch.mjs`를 실행합니다. 다운로드/패키지 설치에는 네트워크 연결과 앱 저장 공간이 필요합니다. Android가 서버 프로세스를 계속 유지하도록 Foreground Service와 진행 알림을 사용합니다.

### ComfyUI 연결 서버 실행

ComfyUI의 GPU 생성 엔진은 PC에서 실행되어야 합니다. 휴대폰에서 실행하는 것은 **Wayward ImageGen 연결 서버**이며, 이 서버가 PC ComfyUI에 요청을 전달합니다.

1. PC에서 ComfyUI를 실행하고 휴대폰과 같은 사설 LAN 또는 Tailscale 네트워크에서 접속할 수 있도록 설정합니다.
2. PC의 ComfyUI 주소를 확인합니다. Portable/수동 설치는 보통 `8188`, ComfyUI Desktop은 보통 `8000` 포트를 사용합니다. 예: `http://192.168.0.20:8188`, `http://192.168.31.41:8000`, 또는 Tailscale MagicDNS 주소 `https://my-pc.tailnet.ts.net:8188`.
3. 런처 홈의 ComfyUI 주소 입력란에 PC 주소를 넣고 **ComfyUI 연결 서버 실행**을 누릅니다.
4. 런처가 EasyGen 서버 백엔드를 우선 찾고, 없으면 Image Studio 백엔드를 찾습니다. 게임 폴더에 없으면 설치된 앱 전용 ZIP 모드에서도 확인합니다.
5. 준비가 끝나면 상태가 연결됨으로 바뀝니다. **이미지 생성 설정 / 상태 열기**는 ComfyUI 모드에서 로컬 ImageGen 상태/검토 페이지를 엽니다.

이 버튼은 PC의 ComfyUI 프로그램을 켜는 버튼이 아닙니다. PC의 ComfyUI가 꺼져 있거나, PC 방화벽이 휴대폰의 연결을 막거나, ComfyUI가 LAN 요청을 받지 않으면 이미지 생성은 실패합니다. PC에서 ComfyUI가 기본적으로 localhost(`127.0.0.1`)에만 묶여 있다면 Portable 실행 인수에 `--listen 0.0.0.0`을 추가하거나 Desktop의 Server Configuration에서 Listen Address를 `0.0.0.0`으로 바꾸고 재시작하세요. PC에서 ComfyUI의 LAN 수신을 허용하되 방화벽은 집의 사설 네트워크로 제한하세요. 인증 없는 ComfyUI 포트를 인터넷 전체에 공개하거나 공유기에서 공인 포트포워딩하는 방식은 사용하지 마세요.

### 주소 제한과 서버 중지

ComfyUI 주소는 휴대폰이 아닌 PC의 주소를 입력해야 하므로 `127.0.0.1`과 `localhost`는 거부합니다. 런처는 사설 IPv4(`10.x`, `172.16~31.x`, `192.168.x`), Tailscale IPv4(`100.64~127.x`), `.ts.net` 및 `.local` 호스트만 허용합니다. 사용자 정보, 쿼리 문자열, 임의의 URL 경로 및 공용 IP 주소는 받지 않습니다.

NovelAI와 ComfyUI 연결 서버는 동일한 로컬 포트 `127.0.0.1:8189`를 공유합니다. 다른 모드로 전환할 때는 **이미지 생성 서버 중지**를 누른 다음 원하는 서버 실행 버튼을 누르세요. 런처의 기존 Image Studio 자동 시작 기능도 유지됩니다.

**주의:** EasyGen의 NovelAI 자격 증명은 EasyGen 자체 설정/인증 흐름으로 처리됩니다. 기존 이미지 서비스 관리 화면의 Android Keystore 암호화 API 키 저장소와 동일한 저장 경로라고 가정하면 안 됩니다. Bun Android 실행과 실제 NovelAI·ComfyUI 생성은 기기에서 추가 검증이 필요합니다.
