# External-folder launcher forensic basis (historical source provenance)

> 이 문서는 런처 원본 소스를 복원할 때 참조한 과거 조사 기록이다. 현재 게임 HTML의 기준 저장소는 `diethoon/wayward`이며, 아래 `diethoon/3.36` SHA와 파일 크기를 현재 게임 기준으로 사용하지 않는다.

Exact target:
- Repository: diethoon/3.36
- Base branch: work/wml-v10-choice-button-fullscreen-1.3.9
- Base commit: ae5e2fab04d02557f64461c038c69aa7038a2fdf
- Wayward_WML_ko.html: 4,383,674 bytes
- SHA-256: 35a0ccf79ff18d8650554f6788d5a0952ba7c683b63aea1c17c0b4f1273817f2

The HTML was inspected in 1,071 sequential 4,096-byte chunks with overlap at chunk boundaries. The original game file was not modified.

Relative dependencies include wml/i18n/ko scripts, wml/runtime/wml-core.js, wml/symbols/2026-10-24-pre7.js and wml/mods/mods.js. The selected folder must be exposed as one virtual root.

WML sidecar:
- runtime/wml-core.js: 116,652 bytes, SHA-256 4c0116ffbcb4395f1d90b8ed0354c4a4c0afd26bd998df43b5ef767a4d9b8fc3
- mods/mods.js: 79 bytes, SHA-256 b222e7ff81a9804a42f3e15d219d6aa967c2cd866d28cf7df447a1df74fc3ca4

WML defines MOD_ROOT as wml/mods/ and LS_FOLDERS as wml.folders. WML.enable(list) appends IDs from localStorage.wml.folders that are not already listed, then loads wml/mods/<id>/mod.js. Folder registration stores IDs only; the physical folder remains the source of truth. The launcher scans folders and seeds that existing mechanism before the game core starts.

Under HTTPS the game may use art.sintention.com/images/...; the launcher checks selected-folder images/ first and falls back to CDN.

Actual Android SAF/WebView/image/large-JS/cloud-save end-to-end remains untested.
