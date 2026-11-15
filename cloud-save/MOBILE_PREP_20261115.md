# Wayward CloudSave mobile pre-integration preparation

Date: 2026-11-15
Status: analysis baseline; no launcher integration performed

## Scope guard

This branch is isolated from the active PC-linked mobile launcher work. Do not merge it into any launcher branch, do not change launcher PR #17/#18/#19, do not build or distribute an APK, and do not merge CloudSave PR #58. Final integration requires the new mobile-launcher branch and exact HEAD to be confirmed, then explicit approval.

## Repository baseline

- Repository: diethoon/wayward
- Preparation branch: feat/cloudsave-mobile-prep-preview-20261115
- Verified branch head at inspection: ac91de934c8219b3c2f0017cc486d480dfcae54f
- CloudSave PR: #58, open and unmerged
- Pinned 0.6.1 source commit: 0356c7da899b102107ab6988c11a1549de5d209e
- 0.6.1 mod.js blob: df4840736afc905d44bf0740d2d6484e76c42963
- 0.6.2 crypto.js blob: 7a321b24588d892a02ad9dec7335cf17ce99c8c5 (unchanged from 0.6.1)
- 0.6.2 branch head is also the latest PR #58 head. Existing push and PR verification runs #43661419355 and #43661421327 passed at that exact head.

## Android auth bridge comparison

### 0.6.1

The pinned 0.6.1 requestNativeGoogleToken() supports startGoogleDriveAuthWithPolicy/startGoogleDriveAuth and takePendingStateForNonce. It waits up to 180 seconds for the nonce-bound result. It does not require cancelGoogleDriveAuth and has no explicit timeout cleanup for the native pending request. Its timeout can therefore leave the Android-side request alive, potentially blocking a retry or allowing a late result to collide with a later request if the launcher does not independently guard it.

### 0.6.2

The current 0.6.2 implementation:
- requires the native start method, takePendingStateForNonce(), and cancelGoogleDriveAuth() before using native auth;
- uses a 90-second deadline;
- keeps activeAuthCancel and authAttemptSerial;
- calls cancelGoogleDriveAuth(nonce) when the request fails, times out, or is cancelled;
- rejects stale results by nonce and the existing auth attempt/session checks;
- falls back to the static GIS browser auth route when the launcher does not expose the cancellation API;
- retains the 0.6.1 one-time access-token handoff and does not mix the 0.7.x page-owned session bridge.

Launcher-side cancellation is tracked separately in wayward-launcher-official PR #19. Its PR description reports nonce-scoped cancellation, pending-result cleanup, ActivityResult request-code-to-nonce mapping, monotonic request-code allocation, and preservation of the one-argument startGoogleDriveAuth compatibility wrapper. The PR's reported CI/emulator results do not prove physical-device account-picker cancellation or real Google authorization.

## Verified game snapshot fields

The save snapshot is created by buildSnapshot() from api.store.game(), preferring nativeSaveJSON() when available and otherwise serializing the current game state. It stores the serialized game state under snapshot.state and sets snapshot.savedAt at save time.

For the preview implementation, the intended exact lookup is:
- active character ID: state.primaryCharacterId
- active character object: state.characters[state.primaryCharacterId]
- character display name: activeCharacter.name
- day count: state.day
- carried gold: state.economy.gold
- background/archetype key: activeCharacter.archetypeId
- save timestamp: snapshot.savedAt

The pinned game source's archetype registry confirms these IDs and labels:
- elena_farmgirl -> registry name "엘레나"; tagline "농가 출신 여성. 19세. 결혼한 지 3주 됨."
- mara_citygirl -> registry name "마라"; tagline "상인의 딸. 23세. 지금껏 관계를 맺어 본 남자는 한 명뿐."
- pippa_waif -> registry name "피파"; tagline is "작고 가녀리며 묘하게 사랑스러운 여인. 21세."; the locksmith-shop upbringing appears in the separate backstory field, not the tagline.

The registry evidence is in analysis_parts/Wayward_MOD_v2.107.part039.txt at the pinned source commit. Do not infer labels for unrecognized archetype IDs. Omit missing values. Do not use Drive modifiedTime as the game's save timestamp.

Before implementation is declared complete, validate all six paths against an actual captured snapshot from the target game build. The field-path evidence above is source inspection, not a real save round-trip.

## Existing memo UI status

CloudSave 0.6.2 still contains:
- showMemoPopup(memo)
- .wml-gd-memo-chip CSS
- .wml-gd-memo-overlay CSS
- .wml-gd-memo-box CSS

However, renderSlots(root) currently renders only the slot title and file size/Drive metadata. It does not add the memo chip or call showMemoPopup(). The popup currently handles Escape and overlay clicks, but the existing WML back handler does not give the memo dialog priority. The restoration patch must connect a memo button to decrypted preview data, hide it for empty memo, and ensure close handling is idempotent for Escape, dialog cancel, outside touch, and WML/Android back.

The current .wml-gd-memo-chip CSS already has overflow:hidden, text-overflow:ellipsis and white-space:nowrap. The memo box has max-height and overflow:auto; verify white-space:pre-wrap remains present before relying on line-break preservation.

## Encrypted preview design requirements

Do not add plaintext character names, day, gold, background, memo, or savedAt to Drive appProperties or the primary save metadata.

Preferred implementation:
1. Keep the existing primary save envelope and crypto.js byte-for-byte unchanged.
2. At save time, extract a small preview object from the exact snapshot paths above.
3. Encrypt a small preview snapshot using WMLGoogleDriveCrypto.encryptSnapshotEmbedded(), which uses the existing embedded AES-256-GCM key and AAD.
4. Store the encrypted envelope as a separate file in appDataFolder.
5. Put only an opaque sidecar file ID and a random generation tag in the primary file's appProperties.
6. Include appProperties in files.list's fields and preserve the two opaque pointers in the account metadata cache.
7. Fetch sidecars lazily for visible rows only; do not download all primary save bodies during list rendering.
8. For legacy auto-encrypted slots without a sidecar, decrypt and backfill only when that row is requested. For passphrase-encrypted legacy slots, do not attempt a silent decrypt; create the preview after the user explicitly loads/decrypts the slot.
9. Bind every sidecar read/write/backfill to the originating session generation and re-check after each await.
10. Delete the associated encrypted sidecar when deleting the primary slot; tolerate orphan cleanup failure without losing a successful primary delete.

Security note: the embedded key is extractable from the distributed addon source. Reusing it prevents personal fields from being exposed as plaintext Drive metadata; it is not a secrecy boundary against an attacker who can inspect the addon source.

## Outstanding implementation and validation

No preview sidecar or memo-list integration has been committed on this branch yet. A previous local patch-construction attempt stopped on a source-text mismatch before any GitHub write. A later patch-construction attempt also stopped before its first write. The remote CloudSave source files remain at the verified 0.6.2 head.

Still required:
- implement preview extraction and encrypted sidecar lifecycle;
- integrate visible-row lazy preview and memo button/popup;
- extend unit/source-contract tests for field mapping, encrypted-only Drive metadata, pointer validation, stale-session handling, memo dialog lifecycle, and legacy slot behavior;
- update README and INSTALL;
- run node --check, existing test script, git diff --check, GitHub Actions verification and package artifact generation;
- test PC file:// and mobile HTTPS regression paths;
- test Android WebView and native bridge on an actual target launcher/device;
- test real Google account authorization, save/list/load/delete, account switch and old-save compatibility.

Do not report implementation, package, deployment, physical-device, Google-account, or old-save compatibility as complete until the corresponding evidence exists.

## 2026-11-15 implementation continuation

- Independent branch: `feat/cloudsave-mobile-prep-preview-20261115`.
- Implementation code commit: `b1deeee1097b5f1a058f735851720bc75dd48c19`.
- Added encrypted preview Sidecar code using the existing `encryptSnapshotEmbedded/decryptSnapshotEmbedded` API. Primary file appProperties contain only `wmlPreviewId` and `wmlPreviewGeneration`.
- Added visible-row lazy fetching/backfill; old passphrase saves are not silently decrypted.
- Connected memo chips to the popup, including Escape, outside click, and Android back priority.
- Updated native auth compatibility so 0.6.1 nonce-scoped launchers without the cancellation API retain their native flow; browser fallback is reserved for missing native start/result APIs or unsupported forced account selection.
- Core `buildSnapshot`, `applySnapshot`, `writeSlotEnvelope`, `deleteSlot`, and `crypto.js` are intended to remain byte-compatible; automated comparison is pending.
- Tests, Actions, and real Drive/browser/device verification are pending. This note does not authorize mobile launcher integration, APK creation, merge, or deployment.

## 2026-11-15 final implementation and verification state

- Final pre-documentation implementation HEAD: `db6972752f91f1e12e14f464a8ebef3b389d70b6`; preparation branch remains separate and unmerged.
- Implemented memo chip and modal popup wiring, exact snapshot preview extraction, encrypted Drive appDataFolder sidecars, opaque primary appProperties pointer/generation, visible-row lazy lookup/backfill, best-effort orphan cleanup, and 0.6.1 nonce-based native auth compatibility.
- Automated verification passed at that implementation HEAD in GitHub Actions run [43678582536](https://github.com/diethoon/wayward/actions/runs/43678582536): syntax checks, pinned 0.6.1 protected-function byte comparisons, pinned crypto.js blob SHA, snapshot field fixture and unknown-archetype omission, crypto round-trip/plaintext concealment, memo fake-DOM tests, mocked Sidecar multipart upload/pointer swap/read/decrypt/delete, generation mismatch and stale-session rejection, synthetic metadata-only slot counts (0/20/100/500), package structure and artifact upload.
- The Actions artifact archive SHA-256 was verified against the artifact API digest. The nested release ZIP checksum manifest also verified against the package bytes. Packaged `crypto.js` Git blob SHA remained `7a321b24588d892a02ad9dec7335cf17ce99c8c5`.
- The package is a CI artifact only; it has not been deployed, installed into any launcher, or merged into PR #58.

### Verification not performed in this environment

- No actual Google account OAuth run from a local `file://` game window; no real popup-blocker, cancel, timeout, account-picker or return-to-game test. The source and nonce/message contracts are automated-test-covered. The flow uses a click-synchronously opened, opener-bound GIS bridge popup as the secure browser-compatible alternative, not an embedded same-window GIS form.
- No live Google Drive upload/list/download/delete using a real account; sidecar lifecycle was exercised against a mocked Drive transport with the real crypto module.
- No live HTTPS GIS browser session regression test.
- No Android 0.6.1 device/emulator test or actual in-game 0.6.1 snapshot capture. The 0.6.1 save/restore core and crypto source contracts are compared byte-for-byte. If an old native bridge lacks `cancelGoogleDriveAuth`, CloudSave can stop local polling and reject stale nonce responses but cannot cancel the native account-picker activity itself.
- No PC launcher/native launcher source changes, APK build, mobile integration, PR merge, or deployment were performed.

### Integration gate

- Do not integrate CloudSave into the PC-linked new mobile launcher or modify its repository/branch until that launcher work has a declared new baseline (branch and HEAD SHA) and the owner explicitly approves final integration. Existing PRs #17, #18, #19 and #58 remain untouched/unmerged.
