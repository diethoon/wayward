# Wayward Android Launcher 0.2.1 · 파일 선택 수정

Android SAF 폴더 실행기입니다. 게임 원본 폴더는 직접 읽고, ZIP 모드는 앱 내부에 압축 파일 그대로 보관해 WML 경로로 가상 제공하며, 여러 게임 폴더를 독립 세션으로 실행합니다.

## 1. 게임 폴더 등록과 여러 세션

1. **게임 폴더 추가**에서 Wayward 또는 Faith 게임 폴더를 선택합니다.
2. 등록된 게임 폴더 목록에서 **실행**을 누릅니다.
3. 다른 버전도 **게임 폴더 추가**로 등록한 뒤 각각 실행합니다.
4. Android 최근 앱 화면에서 각 게임을 별도 작업으로 전환할 수 있습니다.

게임 파일명은 Wayward_WML_ko.html, Wayward_WML.html, index.html을 우선하고, 그 외에는 루트의 Wayward_Faith*.html 또는 Wayward*.html을 탐색합니다.

각 폴더는 안정적인 프로필 ID를 사용하고, WebView 출처도 프로필마다 다르게 만들어 localStorage·IndexedDB·WML 모드 on/off·로드 순서를 분리합니다. Android가 백그라운드 세션의 프로세스를 종료할 수는 있지만, 최근 앱에서 다시 열면 같은 폴더와 같은 세션 저장소로 복구됩니다.

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

## 5. 설치 패키지

이번 파일 선택 수정 빌드는 `com.wayward.launcher.zipmulti.filepicker` 패키지를 사용합니다. 기존 0.2.0 `.zipmulti` 앱과 동시에 설치할 수 있으며, 기존 앱을 삭제할 필요가 없습니다. 단, Android 앱 데이터 공간은 패키지별로 분리되므로 새 앱에서 게임 폴더를 다시 선택해야 하고, 이전 앱의 WebView localStorage/IndexedDB·WML 설정은 자동 이전되지 않습니다. 기존 앱은 세이브 데이터 확인 전까지 삭제하지 마세요.

## 6. 검증 범위

CI에서 Android APK 컴파일·서명 검증을 수행합니다. 실제 Android 기기의 ZIP 선택기, 모드별 자산 로딩, 최근 앱 간 세션 동시 실행은 기기에서 별도 확인해야 합니다. CI 통과를 실기기 동작 검증으로 간주하지 않습니다.
