# Wayward Launcher 이미지 생성 연결 설계

작성 기준: 2026-11-09
상태: 제한적 구현/미검증(2026-11-09). 작업 브랜치 `feature/android-imagegen-launcher-one-tap`에 내장 Bun 시작 시도, 앱 전용 백엔드 복사, Foreground Service, HTTPS WebView용 제한된 Fetch 프록시가 구현되어 있다. 실제 CLI 실행 경로, Android 의존성, 토큰 설정, WML 모드의 fetch/XHR/WebSocket 호출 계약을 원본 소스 및 Galaxy S25 Ultra에서 다시 검증하기 전까지 완료로 표시하지 않는다.

## 목표와 사용자 흐름

런처의 게임 프로필(Wayward/Faith)별 **이미지 생성** 화면에서 백엔드를 고른다.

1. **휴대폰 NovelAI** — 휴대폰의 Termux에서 EasyGen 서버를 실행하고, EasyGen이 NovelAI 인터넷 API를 호출한다. PC와 ComfyUI는 필요하지 않다.
2. **집 PC ComfyUI** — 집 PC가 ComfyUI와 Wayward용 이미지 생성 어댑터를 실행한다. 휴대폰은 요청만 보내고 생성 결과를 받는다. 외부 네트워크에서는 Cloudflare Tunnel을 사용한다.
3. **사용 안 함** — 해당 게임 프로필에서 이미지 생성 연결을 사용하지 않는다.

ComfyUI 자체의 PC 전용 노드 편집기/로컬 GPU 설정은 Android에서 숨긴다. 다만 **집 PC 원격 생성** 설정은 숨기지 않는다. 즉 모바일에 맞지 않는 로컬 ComfyUI 메뉴만 감추고 NovelAI와 원격 PC 연결은 유지한다.

## 1. 휴대폰 NovelAI 경로 — Termux 비의존형 우선

### 사용자에게 보이는 흐름

런처의 Wayward/Faith 프로필에서 **이미지 생성 → 휴대폰 NovelAI → 연결/시작**만 누르게 한다.

- EasyGen이 이미 원격 서버로 제공되는 구성이라면 주소를 한 번 입력하고 연결한다. 로컬 런타임이나 PC는 필요 없다.
- EasyGen이 로컬 서버 코드로 제공되는 구성이라면 런처가 서버 런타임과 서버 파일을 앱 전용 저장소에 설치하고 직접 시작한다.
- 일반 사용자는 Termux를 열거나 명령어를 입력하지 않는다. 서버 설치/업데이트/시작/중지/상태 확인을 런처가 관리한다.
- NovelAI 인증정보는 사용자 기기 안에 저장하고, 게임 localStorage나 PC 서버로 복사하지 않는다.

즉 사용자 관점은 **주소 입력(원격형일 때만) → 연결 → 생성**이다.

### 런타임 선택

Termux RUN_COMMAND 방식은 기본 경로로 사용하지 않는다. 이 방식은 별도 Termux 앱, RUN_COMMAND 권한 승인, Termux 내부 `allow-external-apps=true` 설정이 필요하므로 완전한 원클릭 UX와 맞지 않는다.

우선 검증할 내장 런타임은 공식 Bun Android ARM64 빌드다.

- 기준 후보: Bun v1.4.4의 `bun-linux-aarch64-android.zip`
- 공식 릴리스 아카이브: 48,920,259 bytes
- 공식 SHA-256: `d72e42c60e895ccbc16144bb1e0e0ad7ee384841c35b5501a7ec28b4d6d759c9`
- Bun 공식 문서는 Android 지원을 실험적이라고 명시한다. 따라서 버전과 해시를 고정하고 Galaxy S25 Ultra에서 실제 프로세스 실행, HTTP 서버, 파일 접근, 네이티브 모듈 로딩을 확인한 후 채택한다.

구현 후보 경로:

1. 런처 설치 패키지에 검증된 Android ARM64 Bun 런타임을 포함하거나 앱에서 고정된 공식 아티팩트를 받아 검증한다.
2. 런타임과 EasyGen 서버 파일을 앱 비공개 저장소에 둔다. 게임 폴더나 공용 Download 폴더에는 실행 파일을 설치하지 않는다.
3. Java/Kotlin 네이티브 서비스가 Bun 프로세스를 직접 시작·중지하고 stdout/stderr와 종료 코드를 수집한다. Termux 앱 호출은 하지 않는다.
4. 서버가 실제 health 응답을 반환한 뒤에만 "연결됨"으로 표시한다. 프로세스가 죽거나 포트 충돌이 나면 원인을 표시하고 재시작을 제공한다.
5. 게임이 백그라운드에 있는 동안 서버가 유지되어야 한다면 Android 정책에 맞는 사용자 인지형 Foreground Service와 알림을 사용한다. 사용자가 시작을 누르지 않은 부팅 자동 실행은 기본으로 하지 않는다.
6. 런처 화면과 알림에서 서버 시작/중지/재시작을 관리한다. 사용자는 터미널을 볼 필요가 없다.

Android 15에서는 일부 Foreground Service 유형에 24시간 기준 실행시간 제한이 있다. 실제 서버 역할에 맞는 서비스 유형을 선택해야 하며, 단순히 장시간 실행을 위해 dataSync 유형으로 위장하지 않는다.

### EasyGen 의존성 및 보안 검증

Bun Android 빌드가 제공된다고 해서 모든 npm 네이티브 모듈이 Android에서 작동한다는 뜻은 아니다. 특히 `sharp`처럼 플랫폼별 바이너리를 포함하는 패키지, sqlite/native addon, 이미지 변환 라이브러리는 Android ABI용 빌드가 있는지 개별 확인한다.

- Android ABI 지원이 없으면 Android NDK로 빌드 가능한지 확인한다.
- 빌드할 수 없으면 해당 이미지 작업을 순수 JS/WASM 또는 Android Bitmap/ImageDecoder 기반 구현으로 대체할 수 있는지 평가한다.
- 실제 EasyGen 서버 API 계약과 코드가 확인되기 전에는 패키지 이름, API 경로, 요청 본문, 포트를 추정해서 구현하지 않는다.
- Termux는 일반 사용자 기본 요구사항으로 남기지 않는다. Android 내장 런타임이 특정 의존성 때문에 불가능한 경우에만 개발/진단용 대체 경로로 검토한다.

### WebView와 로컬 서버 연결

현재 런처 WebView는 HTTPS 앱 출처를 사용하고 혼합 콘텐츠를 차단한다. 따라서 게임 JavaScript에서 `http://127.0.0.1`을 직접 호출하는 구성이 동작한다고 가정하지 않는다.

우선순위는 다음과 같다.

1. WebView 요청을 Android 네이티브 계층에서 로컬 EasyGen으로 전달하는 제한된 프록시/브리지 제공.
2. 기존 EasyGen API를 그대로 유지하면서 CORS 및 진행상태(WebSocket/SSE/polling)를 네이티브 계층에서 중계.
3. 외부 HTTP 전체 허용이나 게임 WebView의 보안정책 전체 완화는 하지 않는다.

최종 검증은 생성 버튼 클릭 → 요청 전달 → 진행상태 수신 → 이미지 바이트 수신 → 게임이 기대하는 결과 형식으로 표시까지 이어져야 한다.

## 2. 집 PC ComfyUI 연결 경로

### PC에서 사용자가 직접 준비할 부분

PC의 ComfyUI 설치, 모델, custom node, 워크플로, GPU 설정은 사용자가 직접 한다. 런처가 PC의 ComfyUI 설치나 모델 다운로드를 대신하지 않는다.

ComfyUI의 기본 listen 주소는 localhost인 경우가 많다. 휴대폰에서 LAN으로 접근하려면 PC에서 LAN 연결을 허용하고 포트를 지정해야 한다. 일반적인 기본 포트는 8188이며 ComfyUI Desktop 구성에서는 8000일 수 있다. 서버에서 실제 사용 중인 포트를 기준으로 한다.

### 런처의 한 번 연결 UX

사용자 화면은 다음 순서로 최대한 단순화한다.

1. **집 PC ComfyUI → 자동 검색**을 누른다.
2. 같은 Wi-Fi 안에서 Wayward ComfyUI Beacon이 광고하는 서버를 찾으면 주소를 자동으로 채운다.
3. 사용자가 포트만 지정하거나(기본 8188) 검색된 서버를 선택하고 **연결**을 누른다.
4. 연결 성공 후 해당 게임 프로필에 저장한다. 다음부터는 **연결/사용**만 누른다.

ComfyUI 기본 서버는 자체적으로 Wayward용 검색 Beacon을 제공하지 않으므로 포트만으로 PC의 IP를 알아낼 수는 없다. 포트 전용 자동 검색을 위해 PC 쪽에 작은 Wayward ComfyUI Beacon/custom node를 한 번 설치해 LAN 서비스 검색에 응답하도록 한다. Beacon 없이 사용하는 경우에는 런처에서 한 줄짜리 **서버 주소** 입력란을 제공한다. 예: `http://192.168.0.25:8188`. 여러 개의 IP/포트/경로를 나눠 입력하게 하지 않는다.

집 밖에서 접속할 때는 포트 번호만으로 PC를 찾을 수 없다. 도메인 또는 터널 URL이 필요하다. 최초 한 번 HTTPS 주소를 등록하면 이후에는 저장된 연결을 누르는 방식으로 한다.

### ComfyUI 요청 계약

ComfyUI의 표준 API는 워크플로 제출 `POST /prompt`, 실행 결과 조회 `GET /history/{prompt_id}`, 실시간 상태 `/ws`, 결과 파일 `/view` 등을 제공한다. WML/EasyGen 쪽에서 사용하는 요청 규격과 일치하는 어댑터를 둔다.

- 서버 등록과 연결 테스트는 별개로 취급한다.
- 모델/워크플로/필요 노드가 없는 경우 구체적으로 오류를 표시한다.
- 앱은 버전이 관리되는 Wayward용 워크플로 템플릿을 사용한다. 게임 입력값으로 임의의 ComfyUI 그래프나 Python 노드를 실행하지 않는다.
- 실제 EasyGen ComfyUI provider의 요청/응답 코드를 확인하기 전에는 payload, node IDs, workflow JSON을 새로 만들어 호환된다고 주장하지 않는다.

### LAN 및 외부 접속 보안

ComfyUI의 원시 포트를 인터넷에 직접 공개하지 않는다. ComfyUI 접근이 가능한 사람은 프롬프트를 큐에 올릴 수 있고, 설치된 custom node의 코드 실행 위험까지 포함한다.

- 같은 Wi-Fi에서는 사설 LAN 주소와 사설 네트워크 방화벽 규칙으로 제한한다.
- 집 밖에서는 Named Cloudflare Tunnel 또는 동등한 HTTPS 터널과 인증 게이트웨이를 사용한다.
- 터널/게이트웨이는 Wayward 생성 요청, 상태 조회, 결과 이미지 반환만 허용하고 ComfyUI 관리자 기능, 임의 파일 경로, 임의 노드 그래프 실행은 외부로 노출하지 않는다.
- 인증은 기기별 폐기 가능한 토큰으로 처리하며 Android Keystore에 보관한다. 토큰을 QR URL이나 WML localStorage에 평문으로 넣지 않는다.
- PC가 꺼져 있거나 터널이 끊기면 "연결 불가"로 표시한다. 비용이 드는 NovelAI로 자동 전환하지 않는다.

## 3. 프로필별 설정과 모바일 기능 노출

각 게임 프로필에 별도로 아래 설정을 저장한다. Wayward에서 PC 서버를 쓰더라도 Faith 설정은 독립적으로 유지한다.

설정 데이터 예시:

- imageBackend: mobile-novelai 또는 home-pc-comfyui
- mobileEasyGen.mode: embedded-runtime 또는 remote-url
- mobileEasyGen.baseUrl: 원격형일 때만 사용자 지정 주소, 내장형은 앱 내부에서 관리
- mobileEasyGen.runtimeVersion: 런처가 고정·검증하는 Bun Android ARM64 버전
- homePc.discoveryPort: LAN Beacon 검색용 포트(기본 ComfyUI 포트와 별도)
- homePc.endpoint: 자동 검색 또는 한 줄 서버 주소 입력으로 확보한 주소
- homePc.port: PC ComfyUI 서버 포트(기본 8188, Desktop 구성은 8000일 수 있음)
- homePc.deviceCredentialAlias: Android Keystore 별칭

위 항목은 저장 구조 예시이며 실제 필드명은 EasyGen/WML의 확인된 API와 런처 버전에 맞춰 고정한다. 인증 비밀값 자체는 게임 저장소에 넣지 않는다.

런처는 WML에 Android capability를 알려주는 브리지를 제공한다. UI 필터링은 다음 원칙을 따른다.

- 숨김: 휴대폰에서 실행할 수 없는 로컬 ComfyUI 설치/노드 그래프/로컬 GPU 제어.
- 유지: 휴대폰 NovelAI, 집 PC 연결/페어링, 서버 연결 상태, 게임별 생성 설정.
- 숨김 여부는 화면 크기만이 아니라 런처 capability를 기준으로 판단한다. 작은 화면이라는 이유로 PC 원격 생성까지 숨기지 않는다.

## 4. 구현 순서와 완료 판정

1. EasyGen 서버 ZIP과 WML 클라이언트의 실제 코드를 확보해 원격형인지 로컬 실행형인지, API 경로/요청 형식/네이티브 의존성을 확정한다.
2. Bun v1.4.4 Android ARM64 바이너리를 별도 테스트 앱에서 실행하고 Galaxy S25 Ultra에서 서버·파일·네이티브 모듈 호환성을 검증한다.
3. Termux 없이 앱 관리 프로세스/서비스, 서버 파일 설치, 상태 확인, 재시작, 알림 기반 중지를 구현한다.
4. WebView 네이티브 프록시(Fetch 기반)를 통해 모바일 NovelAI 생성 요청부터 게임 내 이미지 표시까지 검증한다. XHR/EventSource/WebSocket은 아직 지원 여부를 확인하지 않았다.
5. PC용 Wayward ComfyUI Beacon/custom node와 포트 자동 검색을 구현한다.
6. 한 줄 서버 주소 대체 입력, Named Tunnel/Access 인증 및 외부 접속을 검증한다. 현재 구현 브랜치에는 원격 PC ComfyUI 모드/Beacon과 외부 접속 UI가 아직 들어가지 않았다.
7. Wayward/Faith 프로필별 설정 분리 및 Android에서 PC 전용 메뉴만 숨기는 동작을 검증한다.

**완료 조건:** NovelAI는 Termux를 열지 않고 런처의 연결/시작 버튼 하나로 서버가 준비되어야 한다. PC ComfyUI는 LAN Beacon 자동 검색 후 포트 지정만으로 연결되어야 하며, Beacon이 없으면 한 줄 주소 입력으로 연결되어야 한다. 양쪽 모두 실제 생성 요청, 작업 상태, 결과 이미지 표시까지 성공해야 한다. 서버 상태 확인 화면이나 단순 ping만 구현된 것은 완료가 아니다.
