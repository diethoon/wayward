> **상태: 폐기된 제안 / 구현 금지 (2026-11-16)**
> 상위 아키텍처 요구사항인 “CloudSave는 런처·Remote Host·로컬 서버·외부 인증 relay 없이 독립 동작”과 충돌하므로 이 Host OAuth + loopback 설계는 채택하지 않습니다. 이 문서는 과거 논의를 위한 기록이며 현재 API 계약이 아닙니다. 새로운 Host OAuth API, 로컬 callback listener 또는 Host 세션 토큰 의존성을 구현하지 마세요. 최신 결정은 `AUTH_UX_20261115.md`의 server-independence decision을 따릅니다.
>
> **2026-11-16 superseded:** This historical host-owned/loopback contract is no longer the current design. CloudSave 0.6.2 now uses the static GitHub Pages MessageChannel bridge v4 at `https://jeiky224.github.io/cloud/file-auth.html` for PC `file://`. See `cloud-save/README.md` and `pages-cloudsave-auth/README.md` for the current implementation. The historical analysis below is retained for audit only.
>
> ---
>
# CloudSave ↔ PC Host 인증 브리지 계약 초안

**상태: 제안서 / 미확정. PC Host 런처 담당자의 승인·통합 기준선 인수 전까지 구현 계약으로 취급하지 않는다.**

## 목적

PC에서 `file://`로 실행되는 게임이 기존의 정적 "게임 연결 확인" 웹 페이지에 의존하지 않고 Google 계정 인증을 마친 뒤 게임으로 돌아오게 한다. 인증 흐름의 소유자는 PC Host이며, CloudSave 모드는 기존 Drive 세이브 포맷과 암호화 방식을 유지한 채 승인된 액세스 토큰만 일시적으로 사용한다.

## 확인된 현재 경계

- CloudSave의 `file://` 경로는 현재 `https://jeiky224.github.io/cloud/auth-061.html` 브리지 프로토콜을 참조한다. 실제 배포 URL의 현재 응답과 호환성은 검증되지 않았다.
- 이전 읽기 전용 Host API 인벤토리에는 `GET /healthz`, `GET /v1/host/status`, `GET /v1/host/identity`, `POST /v1/host/stop`만 확인됐다. OAuth 시작·콜백·토큰 교환 API는 확인되지 않았다.
- 따라서 아래 항목은 새 Host API가 이미 존재한다는 뜻이 아니며, 최종 경로·메시지 이름·인증 수단은 Host 담당자가 확정해야 한다.
- 현재 CloudSave는 `Origin: null`을 Google GIS 직접 인증에 사용하지 않으며, 보안 정책을 우회하지 않는다.

## 권장 인증 흐름

1. CloudSave의 **사용자 클릭**으로 인증 시도를 시작하고, 요청별 고유 nonce/state를 만든다.
2. PC Host는 런처와 짝지어진 게임 요청임을 확인한 뒤, OS 기본 브라우저를 이용하는 데스크톱 OAuth 흐름을 시작한다.
3. OAuth는 Desktop App용 공개 클라이언트 + Authorization Code + PKCE(S256)를 사용한다. 앱에 client secret을 내장하지 않는다.
4. PC Host가 loopback 리디렉션 응답을 수신하고, state 및 PKCE 검증을 통과한 뒤 code를 토큰으로 교환한다.
5. 게임 복귀는 Host가 제공하는 로컬 완료 창/브리지에서 nonce에 결속된 일회성 결과로 전달한다. access token을 URL query, 브라우저 기록, 로그, 일반 파일에 넣지 않는다.
6. CloudSave는 nonce·요청 ID·세션 generation을 재검증한 후 access token을 메모리에 적용하고 Drive 목록을 조회한다. 로그아웃·취소·timeout·새 인증 시작 시 이전 요청 결과를 폐기한다.

## 보안 요구사항

- Host 서버는 loopback 인터페이스(`127.0.0.1` 또는 필요 시 `[::1]`)에만 바인딩한다. LAN 전체(`0.0.0.0`)에 인증 포트를 공개하지 않는다.
- CORS 허용이나 `Origin: null` 허용은 인증 수단이 아니다. 임의의 웹 페이지·로컬 HTML이 Host에 인증을 시작하거나 토큰을 읽을 수 없어야 한다.
- Host는 런처가 발급·보관하는 짝지음 capability 또는 동등한 강한 요청 인증을 검증해야 한다. nonce만으로 로컬 호출자를 인증했다고 간주하지 않는다.
- 시작 요청과 결과는 동일한 one-time request ID/nonce에 결속한다. 결과는 한 번만 회수 가능해야 하며, 시간 만료·취소·재시도 후 이전 결과는 재사용할 수 없어야 한다.
- `file://` 게임으로 전달할 때는 브리지 창의 실제 origin을 loopback Host origin으로 제한하고, 게임 측에서 `event.source`, `event.origin`, nonce, protocol version, request ID를 모두 확인한다. `targetOrigin: "*"`가 필요한 구조라면 토큰 전달 대상·창 수명·호출자 인증을 별도로 위협 모델링하고, Host 담당자 보안 검토를 통과하기 전까지 사용하지 않는다.
- refresh token은 CloudSave 모드나 URL로 전달하지 않는다. 필요하다면 Host가 OS 보호 저장소에 보관하고, CloudSave에는 제한된 수명의 access token만 반환한다.
- Google Drive 권한은 기존 최소 범위 `https://www.googleapis.com/auth/drive.appdata`를 유지한다.
- 명시적 로그아웃은 Host 세션/CloudSave 런타임 토큰 폐기와 Google 권한 철회를 구분한다. 실제 Google revoke 성공 응답 없이 권한 철회 완료라고 표시하지 않는다.

## API 형태 — 이름과 wire format 미확정

Host 담당자가 통합 기준선에서 다음 기능을 제공하는지 합의한다. 아래는 의미 수준의 계약이며, 경로·메서드·필드 이름을 고정하지 않는다.

| 기능 | 요구 동작 |
|---|---|
| 인증 시작 | 짝지음 capability 확인, nonce/request ID 검증, OS 브라우저 OAuth 시작 |
| 인증 상태 | pending / succeeded / failed / cancelled / expired 상태를 요청별로 조회 |
| 결과 회수 | 일치하는 nonce와 request ID로 일회성 access token 및 expiresIn 반환 |
| 취소 | 진행 중인 해당 request ID만 취소하고 callback 결과 폐기 |
| 로그아웃 | Host 로컬 세션/토큰 삭제 여부를 명확히 반환; Google 권한 revoke는 별도 결과 |
| Host 확인 | 기존 health/status API와 인증 기능 버전·지원 여부를 별도 capability로 명시 |

CloudSave 모드는 이 계약과 실제 브리지 버전이 일치하기 전까지 새로운 Host endpoint를 호출하지 않는다.

## 계정 선택 정책

- 최초 연결과 명시적 로그아웃 후 재로그인은 Host가 계정 선택을 요청하는 정책을 지원해야 한다.
- 일반 세션 복구와 사용자가 요청하지 않은 재인증은 remembered-account 정책을 사용할 수 있다.
- 계정 선택 정책을 지원하지 않는 Host에 대해 CloudSave는 조용히 무시하거나 브라우저 GIS·자동 로그인으로 대체하지 않고 명시적인 미지원 오류를 표시한다.

## PC 런처 담당자와 확정할 질문

1. 통합 기준선 브랜치와 정확한 SHA는 무엇인가?
2. 통합 런처에서 항상 존재하는 네이티브 Host 식별자와 인증 API capability는 무엇인가? 인증 API가 빠져 있어도 런처를 판별할 수 있어야 한다.
3. 런처 ↔ PC Host 요청 인증에 사용할 pairing capability를 누가 발급하고 어디에 보관하는가?
4. OS 브라우저 실행, loopback callback, 로컬 완료 창, 게임으로의 one-time 결과 전달을 누가 소유하는가?
5. Desktop App OAuth client 및 loopback redirect Console 설정이 필요한가? 필요 시 별도 승인 절차는 무엇인가?
6. 취소, popup 닫힘, timeout, Host 종료, 새 인증 중복 요청의 결과 계약은 무엇인가?

## 현재 구현·승인 상태

- 이 문서는 CloudSave 저장소의 설계 초안일 뿐이다.
- PC Host 저장소, Android 런처 저장소, Pages 저장소, OAuth Console, DNS 또는 운영 인프라에는 변경을 수행하지 않았다.
- Desktop OAuth client 생성, Console 등록/redirect 변경, Host endpoint 구현·배포는 별도 승인과 통합 기준선 확정 전에는 수행하지 않는다.
- Google의 데스크톱 앱 OAuth 가이드는 시스템 브라우저, 공개 클라이언트, PKCE 및 loopback redirect 방식을 설명한다. 실제 프로젝트 적용은 OAuth client 유형과 Console 설정을 별도로 확인해야 한다.
