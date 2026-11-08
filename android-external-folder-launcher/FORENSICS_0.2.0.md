# Android launcher 0.2.0 forensic record

## Fixed target

- Repository: diethoon/3.36
- Working branch: feature/android-launcher-zip-mods-multi-sessions
- Base branch: feature/android-external-folder-launcher-viewport-fit
- Base commit: 8fb1a896ebbbcad36bb3a071849565ec8b220078
- MainActivity path: android-external-folder-launcher/app/src/main/java/com/wayward/launcher/MainActivity.java
- MainActivity baseline Git blob: 59a54bd2373e30c3278286a3f8fd13908e7d694a
- MainActivity baseline size: 22,694 bytes
- MainActivity baseline SHA-256: df0cbd633f50564b237fb7c0c271fbe65e017022cdc66fe670d1b9d62e50583a

MainActivity UTF-8 scan: 4,096-byte chunks from offset 0 through EOF (6 chunks; final chunk 2,214 bytes). Chunk manifest SHA-256: f2f3341829c8737e702d81fa813d07b455e09e13cabaea5a05167f64ddf82bd6.

The original game target remains unchanged:
- Wayward_WML_ko.html: 4,383,674 bytes; SHA-256 35a0ccf79ff18d8650554f6788d5a0952ba7c683b63aea1c17c0b4f1273817f2
- wml/runtime/wml-core.js: 116,652 bytes; SHA-256 4c0116ffbcb4395f1d90b8ed0354c4a4c0afd26bd998df43b5ef767a4d9b8fc3
- wml/mods/mods.js: 79 bytes; SHA-256 b222e7ff81a9804a42f3e15d219d6aa967c2cd866d28cf7df447a1df74fc3ca4

## Procedure and evidence used

The current launcher branch did not contain idea/GPT_RUNTIME_FORENSIC_FALLBACK.md; the file was retrieved from the historical mobile-migration-v1 branch and used as the forensic procedure. The existing android-external-folder-launcher/DESIGN_FORENSICS.md is the prior launcher-specific evidence record.

WML source evidence:
- MOD_ROOT = "wml/mods/"
- LS_FOLDERS = "wml.folders"
- WML.enable(...) merges IDs from localStorage.wml.folders.
- WML subsequently loads wml/mods/<id>/mod.js by URL.
- Mod assets are resolved relative to the same folder URL.

This permits an app-private ZIP overlay without changing the WML runtime or game HTML: the native host enumerates mod IDs and the existing WebView path handler serves ZIP entries at the expected /game/wml/mods/<id>/... paths.

## Implementation scope

1. Store each accepted source ZIP unchanged in app-private filesDir/wml-zip-mods/<id>.zip.
2. Validate one WML mod ID from WML.define inside mod.js; support root mod.js or one wrapper directory containing it.
3. Resolve wml/mods/<id>/<asset> from the archive on demand using ZipFile; no extraction to the selected game folder and no extracted copy in app storage.
4. Merge IDs from existing SAF folders and ZIP archives before wml-folder-bootstrap.js seeds wml.folders.
5. Keep ZIP mods shared by the launcher while keeping WML toggle/order/save storage separated by game profile origin.
6. Store multiple persisted SAF folder profiles and launch each as a separate Android document task with a profile-specific WebView host/origin.
7. Detect root Wayward_Faith*.html and Wayward*.html files in addition to the original fixed HTML names.

## Safety and compatibility boundaries

- No edit to the game HTML, WML runtime, mod source, RNG, save implementation, or gameplay logic.
- A real folder mod wins over an app ZIP when both expose the same ID for a profile.
- ZIPs are size-limited, path traversal names are rejected, ambiguous multi-mod.js archives are rejected, and entries are streamed rather than unpacked.
- The new debug package suffix is .zipmulti; it is separate from the earlier .viewportfix package to avoid replacing the installed app signed by a different ephemeral CI debug key.
- The package separation means existing WebView localStorage/IndexedDB and SAF permissions from the old package are not silently migrated; users must select the folders again.

## Verification status

- Source inspection: done.
- New Git branch isolated from the base branch: done.
- `verify.sh`: PASS on commit `9ebbf8788581399126a392d2efb0c49ae73def23`.
- WML folder bootstrap Node tests: PASS.
- `ZipModStoreTest` JVM tests: PASS for root ZIP, wrapped ZIP, on-demand asset reads, no extraction, path traversal rejection, duplicate ID rejection, and ambiguous multi-`mod.js` rejection.
- WML core and bundled mod JavaScript `node --check`: PASS.
- `git diff --check`: PASS (part of `verify.sh`).
- Gradle Android debug build: PASS; APK signing verified with APK Signature Scheme v2 (one signer).
- CI run: `42497343291` (push) and `42497346787` (pull request), both successful.
- APK artifact: `WaywardLauncher-zipmulti-v0.2.0`, artifact ID `13623987574`, archive SHA-256 `ca067a181f5bac427eca3bafb482df167a58fd12c431c0b75de65e0c535c593e`.
- Extracted APK: 3,173,958 bytes, SHA-256 `8d8e5956fb85677a92071047fc0e383de688e1f12fd053734a90b5744de27366`.
- Android physical-device validation: pending; ZIP picker, real WML mod activation/assets, and concurrent recent-app session restoration are not claimed as device-tested.
