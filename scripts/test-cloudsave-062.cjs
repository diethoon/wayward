'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');

const root = path.resolve(__dirname, '..');
const modPath = path.join(root, 'cloud-save/mod.js');
const cryptoPath = path.join(root, 'cloud-save/crypto.js');
const outputDir = path.join(root, '.build');
fs.mkdirSync(outputDir, { recursive: true });

// Stream the pinned 0.6.1 baseline to disk; do not hold git-show output in memory.
const BASELINE_COMMIT = '0356c7da899b102107ab6988c11a1549de5d209e';
const baselinePath = path.join(os.tmpdir(), `wayward-cloudsave-061-${process.pid}.js`);
const baselineFd = fs.openSync(baselinePath, 'w');
try {
  execFileSync('git', ['show', `${BASELINE_COMMIT}:cloud-save/mod.js`], {
    stdio: ['ignore', baselineFd, 'inherit']
  });
} finally {
  fs.closeSync(baselineFd);
}
process.on('exit', () => { try { fs.rmSync(baselinePath, { force: true }); } catch (_) {} });

// Search source byte streams with a 4 KiB read buffer and boundary carry.
function fileContainsText(filePath, value) {
  const needle = Buffer.from(value, 'utf8');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(4096);
  let offset = 0;
  let carry = Buffer.alloc(0);
  try {
    while (true) {
      const length = fs.readSync(fd, buffer, 0, buffer.length, offset);
      if (length === 0) break;
      offset += length;
      const window = Buffer.concat([carry, buffer.subarray(0, length)]);
      if (window.indexOf(needle) >= 0) return true;
      carry = Buffer.from(window.subarray(Math.max(0, window.length - needle.length + 1)));
    }
  } finally { fs.closeSync(fd); }
  return false;
}

function fileMatchesRegex(filePath, expression) {
  const flags = expression.flags.replace(/[gy]/g, '');
  const matcher = new RegExp(expression.source, flags);
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(4096);
  const overlap = 8192;
  let offset = 0;
  let carry = '';
  try {
    while (true) {
      const length = fs.readSync(fd, buffer, 0, buffer.length, offset);
      if (length === 0) break;
      offset += length;
      const window = carry + buffer.subarray(0, length).toString('utf8');
      matcher.lastIndex = 0;
      if (matcher.test(window)) return true;
      carry = window.slice(-overlap);
    }
  } finally { fs.closeSync(fd); }
  return false;
}

// Keep only a requested function range in memory. Marker matching is byte-based,
// so a marker split across 4 KiB chunks is still detected.
function readSectionFromFile(filePath, startMarkerText, endMarkerText) {
  const startMarker = Buffer.from(startMarkerText, 'utf8');
  const endMarker = Buffer.from(endMarkerText, 'utf8');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(4096);
  const parts = [];
  let offset = 0;
  let carry = Buffer.alloc(0);
  let started = false;
  let ended = false;
  try {
    while (true) {
      const length = fs.readSync(fd, buffer, 0, buffer.length, offset);
      if (length === 0) break;
      offset += length;
      let window = Buffer.concat([carry, buffer.subarray(0, length)]);
      if (!started) {
        const startAt = window.indexOf(startMarker);
        if (startAt < 0) {
          carry = Buffer.from(window.subarray(Math.max(0, window.length - startMarker.length + 1)));
          continue;
        }
        started = true;
        window = window.subarray(startAt + startMarker.length);
      }
      const endAt = window.indexOf(endMarker);
      if (endAt >= 0) {
        if (endAt > 0) parts.push(Buffer.from(window.subarray(0, endAt)));
        ended = true;
        break;
      }
      const safeLength = Math.max(0, window.length - endMarker.length + 1);
      if (safeLength > 0) parts.push(Buffer.from(window.subarray(0, safeLength)));
      carry = Buffer.from(window.subarray(safeLength));
    }
  } finally { fs.closeSync(fd); }
  assert.ok(started && ended, `missing source section in ${filePath}: ${startMarkerText}`);
  return Buffer.concat(parts).toString('utf8');
}
function section(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'missing source section: ' + start);
  return source.slice(a, b);
}

function requireText(value, label) {
  assert.ok(fileContainsText(modPath, value), 'missing required CloudSave contract: ' + label);
}

assert.ok(fileMatchesRegex(modPath, /version: '0\.6\.2'/), 'CloudSave version must be 0.6.2');
assert.equal(fileContainsText(modPath, "https://jeiky224.github.io/cloud/auth-061.html"), false,
  'standalone CloudSave must not depend on a hosted auth endpoint');
requireText('startGoogleDriveAuthWithPolicy(nonce, !!forceSelectAccount)', 'Android native policy bridge');
requireText("const AUTH_ADAPTER = nativeLauncherContext ? 'android-native'", 'immutable environment adapter selection');
requireText('const nativeLauncherContext = !!nativeAuthHost', 'native launcher marker fails closed without auth API');
requireText('if (forceSelectAccount && !hasPolicyStart)', 'forced native account selection never degrades to legacy silent login');
requireText('return explicitLogout || !hadPreviousAuth;', 'first connection and explicit logout account selection');
requireText('function requestBrowserGoogleToken(nonce, forceSelectAccount, attempt, sessionAtStart)', 'direct GIS browser adapter');
requireText('function requestFileBridgeGoogleToken(nonce, forceSelectAccount, attempt, sessionAtStart)', 'standalone file-origin fail-closed adapter');
requireText("client.requestAccessToken({ prompt: forceSelectAccount ? 'select_account' : '', state: nonce });", 'GIS popup directly from game click');
requireText("const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';", 'least-privilege Drive scope');
requireText("const GOOGLE_OAUTH_CLIENT_ID =", 'public GIS OAuth client identifier');
requireText("if (AUTH_ADAPTER === 'browser-gis') {", 'GIS script is loaded only for browser adapter');
requireText('takePendingStateForNonce(nonce)', 'nonce-scoped native result retrieval');
requireText('payload.nonce !== nonce', 'one-time nonce validation');
requireText("'구글 계정으로 연결'", 'unified connect button label');
requireText('forceSelectAccount', 'native account selection policy');
requireText('activeAuthCancel', 'cancellable pending authentication');
requireText("const canCancel = typeof host.cancelGoogleDriveAuth === 'function';", 'optional native cancellation and 0.6.1 compatibility');
requireText('host.cancelGoogleDriveAuth(nonce)', 'native request cancellation on timeout or abort');
requireText('function invalidateDriveSession()', 'session generation invalidation');
requireText('driveRequestControllers', 'in-flight Drive request tracking');
requireText('assertDriveSession(session)', 'pre-apply session checks');
requireText('markExplicitLogout(false)', 'explicit logout state marker');
requireText("'wml-google-drive-slot-metadata-v1:'", 'metadata-only cache namespace');
requireText('drive/v3/about?fields=user(permissionId)', 'account-separated cache identity');
requireText('drive/v3/files?', 'metadata list API');
requireText("pageSize: '1000'", 'single-page 500-slot query');
requireText("trashed = false and name contains '", 'narrowed Drive list query');
requireText('AbortController', 'list cancellation');
requireText('driveListGeneration', 'stale response generation guard');
requireText('driveListPromise', 'duplicate list request coalescing');
requireText('bodyDownloads:', 'file body download instrumentation');
requireText('cacheFirstDisplayMs:', 'cache first display instrumentation');
requireText('apiRequestMs,', 'Drive request time instrumentation');
requireText('jsonParseMs,', 'JSON parse time instrumentation');
assert.equal(fileMatchesRegex(modPath, /showSessionSettingsPopup|setSessionPolicy|sessionPolicy|SESSION_POLICY_KEY/), false,
  'obsolete login-persistence controls must not remain');
assert.equal(fileContainsText(modPath, '로그인 유지 설정'), false,
  'login-persistence settings UI must be removed');
assert.equal(fileContainsText(modPath, '새로고침할 때마다 로그인 해제'), false,
  'legacy forced-logout copy must be removed');
assert.equal(fileMatchesRegex(modPath, /localStorage\.setItem\([^\n]*(?:accessToken|refreshToken)/i), false,
  'access tokens must not be persisted in localStorage');
assert.equal(fileMatchesRegex(modPath, /sessionStorage\.setItem\([^\n]*(?:accessToken|refreshToken)/i), false,
  'access tokens must not be persisted in sessionStorage');

const nativeAuth = readSectionFromFile(
  modPath,
  '    function requestNativeGoogleToken(nonce, forceSelectAccount, attempt, sessionAtStart) {',
  '    function validateDirectGISOrigin() {'
);
assert.match(nativeAuth, /const canCancel = typeof host\.cancelGoogleDriveAuth === 'function'/);
assert.match(nativeAuth, /canCancel \? 90000 : 180000/);
assert.match(nativeAuth, /else host\.startGoogleDriveAuth\(nonce\)/);
assert.match(nativeAuth, /isCurrentAuthAttempt\(attempt, sessionAtStart\)/);
assert.doesNotMatch(nativeAuth, /forceSelectAccount\s*&&.*return null/);

const directBrowserAuth = readSectionFromFile(
  modPath,
  '    function requestBrowserGoogleToken(nonce, forceSelectAccount, attempt, sessionAtStart) {',
  '    function requestFileBridgeGoogleToken(nonce, forceSelectAccount, attempt, sessionAtStart) {'
);
assert.match(directBrowserAuth, /google\.accounts\.oauth2\.initTokenClient/);
assert.match(directBrowserAuth, /client\.requestAccessToken\(\{ prompt: forceSelectAccount \? 'select_account' : '', state: nonce \}\)/);
assert.match(directBrowserAuth, /error_callback:/);
assert.doesNotMatch(directBrowserAuth, /window\.open|AUTH_BRIDGE_URL|postMessage/,
  'HTTP/HTTPS GIS adapter must not open an auth relay');

const fileAuth = readSectionFromFile(
  modPath,
  '    function requestFileBridgeGoogleToken(nonce, forceSelectAccount, attempt, sessionAtStart) {',
  '    function requestGoogleToken(forceSelectAccount, attempt) {'
);
assert.match(fileAuth, /window\.open\(/);
assert.match(fileAuth, /new MessageChannel\(\)/);
assert.match(fileAuth, /popup\.postMessage\([\s\S]*FILE_AUTH_BRIDGE_ORIGIN[\s\S]*channel\.port2/);
assert.match(fileAuth, /isCurrentAuthAttempt\(attempt, sessionAtStart\)/);
assert.match(fileAuth, /wayward-cloud-auth-ack-received/);
assert.doesNotMatch(fileAuth, /event\.origin|origin\s*===\s*['"]null['"]|postMessage\([^,]+,\s*['"]\*['"]/);
assert.doesNotMatch(fileAuth, /fetch\(|127\.0\.0\.1|localhost/);
assert.equal(fileContainsText(modPath, 'auth-061.html'), false);

const authDispatch = readSectionFromFile(
  modPath,
  '    function requestGoogleToken(forceSelectAccount, attempt) {',
  '    function attemptNativeSessionRestore() {'
);
assert.match(authDispatch, /AUTH_ADAPTER === 'android-native'.*requestNativeGoogleToken/);
assert.match(authDispatch, /AUTH_ADAPTER === 'browser-gis'.*requestBrowserGoogleToken/);
assert.match(authDispatch, /requestFileBridgeGoogleToken/);
assert.doesNotMatch(authDispatch, /window\.open|fallback/);

const driveFetchSource = readSectionFromFile(
  modPath,
  '    async function driveFetch(path, options) {',
  '    async function accountCacheStorageKey(permissionId) {'
);
assert.match(driveFetchSource, /new AbortController\(\)/);
assert.match(driveFetchSource, /driveRequestControllers\.add\(requestController\)/);
assert.match(driveFetchSource, /assertDriveSession\(generation\)/);

const accountCacheSource = readSectionFromFile(
  modPath,
  '    async function resolveDriveAccountCache() {',
  '    function readAccountSlotCache(cacheKey) {'
);
assert.ok((accountCacheSource.match(/assertDriveSession\(generation\)/g) || []).length >= 4,
  'account identity must not be cached after the Drive session changes');

const loadSlotSource = readSectionFromFile(
  modPath,
  '    async function loadSlot(slot) {',
  '    async function removeSlot(slot) {'
);
assert.ok((loadSlotSource.match(/assertDriveSession\(session\)/g) || []).length >= 4,
  'loadSlot must re-check the same session after read/decrypt and immediately before applySnapshot');
assert.match(loadSlotSource, /applySnapshot\(snapshot\)/);

const styleInit = readSectionFromFile(
  modPath,
  '    if (!document.getElementById(STYLE_ID)) {',
  '    function hasToken() {'
);
assert.equal((styleInit.match(/document\.head\.appendChild\(style\)/g) || []).length, 1,
  'CloudSave style element must be appended exactly once');
assert.match(styleInit, /box-shadow:0 8px 30px #0005}';\s*document\.head\.appendChild\(style\);/);

const refresh = readSectionFromFile(modPath, '    function refreshSlots() {', '    function currentFile(slot) {');
assert.match(refresh, /files\.list|drive\/v3\/files/);
assert.doesNotMatch(refresh, /readSlotEnvelope|decryptSnapshot|alt=media/,
  'the list must not download or decrypt save bodies');
assert.match(refresh, /files\(id,name,mimeType,modifiedTime,size,appProperties\)/);
assert.match(refresh, /pageSize: '1000'/);
assert.match(refresh, /name contains/);

const normalizerDeclaration = '    function normalizeDriveSlotFiles(files) {';
const normalizerSource = normalizerDeclaration + readSectionFromFile(
  modPath,
  normalizerDeclaration,
  '    function validateMetadataCache(value) {'
);
const normalizeDriveSlotFiles = vm.runInNewContext('(' + normalizerSource + ')', {
  FILE_PREFIX: 'wayward-cloud-slot-'
});

for (const count of [0, 20, 100, 500]) {
  const files = Array.from({ length: count }, (_, index) => ({
    id: 'drive-id-' + (index + 1),
    name: 'wayward-cloud-slot-' + (index + 1) + '.json',
    mimeType: 'application/json',
    modifiedTime: new Date(1760000000000 + index * 1000).toISOString(),
    size: 4096 + index
  }));
  const started = performance.now();
  const slots = normalizeDriveSlotFiles(files);
  const elapsed = performance.now() - started;
  assert.equal(slots.length, count);
  assert.equal(slots[0] && slots[0].name, count ? 'wayward-cloud-slot-1.json' : undefined);
  assert.equal(slots.at(-1) && Number(slots.at(-1).name.slice('wayward-cloud-slot-'.length, -5)), count || undefined);
  console.log('SYNTHETIC_METADATA', JSON.stringify({
    slots: count, normalized: slots.length, cpuMs: Number(elapsed.toFixed(3)),
    bodyDownloads: 0, decryptMs: 0
  }));
}


requireText('files(id,name,mimeType,modifiedTime,size,appProperties)', 'Drive appProperties sidecar pointer listing');
requireText("parents: ['appDataFolder']", 'encrypted preview sidecar stays in appDataFolder');
requireText('wmlPreviewId: previewId, wmlPreviewGeneration: generation', 'opaque sidecar ID and generation only');
requireText('function uploadPreviewSidecar(file, snapshot)', 'encrypted preview sidecar writer');
requireText('function readSlotPreviewSidecar(file, session)', 'encrypted preview sidecar reader');
requireText('function clearSlotPreview(file)', 'old sidecar pointer cleanup');
requireText('IntersectionObserver', 'visible-row lazy preview fetch');
requireText('previewLoadPromises', 'duplicate preview request coalescing');
requireText("overlay.addEventListener('cancel'", 'memo dialog native cancel handling');
requireText('event.target === overlay', 'memo popup outside click handling');
requireText('function closeMemoPopup()', 'memo popup idempotent close');
requireText('if (activeMemoDialog) { closeMemoPopup(); return true; }', 'Android back closes memo before CloudSave window');
requireText('item.memoButton.hidden = !hasMemo', 'memo button hidden for empty memo');
const standaloneFileAuth = readSectionFromFile(
  modPath,
  '    function requestFileBridgeGoogleToken(nonce, forceSelectAccount, attempt, sessionAtStart) {',
  '    function requestGoogleToken(forceSelectAccount, attempt) {'
);
assert.ok(standaloneFileAuth.includes('window.open'));
assert.ok(standaloneFileAuth.includes('new MessageChannel()'));
assert.ok(standaloneFileAuth.includes('FILE_AUTH_BRIDGE_ORIGIN'));
assert.ok(standaloneFileAuth.includes('wayward-cloud-auth-ack-received'));

const extractBody = readSectionFromFile(
  modPath,
  '    function extractSnapshotPreview(snapshot) {',
  '    function buildPreviewSnapshot(snapshot, generation) {'
);
const buildBody = readSectionFromFile(
  modPath,
  '    function buildPreviewSnapshot(snapshot, generation) {',
  '    function formatPreviewSummary(preview) {'
);
const previewHelpers = vm.runInNewContext(
  '(function(){ function extractSnapshotPreview(snapshot) {' + extractBody +
  ' function buildPreviewSnapshot(snapshot, generation) {' + buildBody +
  ' return { extractSnapshotPreview, buildPreviewSnapshot }; })()'
);
const previewFixture = {
  schema: 'wayward-cloud-save', version: 1, nativeFormat: 1, savedAt: 1794700000123,
  memo: '한글 메모 첫 줄\n둘째 줄과 긴 내용',
  state: {
    primaryCharacterId: 'player-a',
    characters: { 'player-a': { name: '테스트 캐릭터', archetypeId: 'elena_farmgirl' } },
    day: 42,
    economy: { gold: 987654 }
  }
};
const extractedPreview = JSON.parse(JSON.stringify(previewHelpers.extractSnapshotPreview(previewFixture)));
assert.deepEqual(extractedPreview, {
  characterName: '테스트 캐릭터', day: 42, gold: 987654,
  origin: '엘레나', savedAt: 1794700000123, memo: '한글 메모 첫 줄\n둘째 줄과 긴 내용'
});
const unknownOrigin = JSON.parse(JSON.stringify(previewHelpers.extractSnapshotPreview({
  ...previewFixture, state: { ...previewFixture.state, characters: { 'player-a': { name: 'Unknown', archetypeId: 'future_unknown_id' } } }
})));
assert.equal(unknownOrigin.origin, '', 'unknown archetypes must not be guessed or translated');
const previewSnapshot = JSON.parse(JSON.stringify(previewHelpers.buildPreviewSnapshot(previewFixture, 'generation-123')));
assert.equal(previewSnapshot.previewGeneration, 'generation-123');
assert.deepEqual(Object.keys(previewSnapshot.state).sort(), ['characters','day','economy','primaryCharacterId']);

const memoSource = "    function closeMemoPopup() {\n      const overlay = activeMemoDialog;\n      if (!overlay) return;\n      activeMemoDialog = null;\n      if (overlay._wmlMemoKeyHandler) {\n        document.removeEventListener('keydown', overlay._wmlMemoKeyHandler, true);\n        overlay._wmlMemoKeyHandler = null;\n      }\n      try { if (overlay.open && typeof overlay.close === 'function') overlay.close(); } catch (_) {}\n      overlay.remove();\n    }\n\n    function showMemoPopup(memo) {\n      const value = String(memo || '');\n      if (!value.trim()) return;\n      closeMemoPopup();\n      const overlay = document.createElement('dialog');\n      overlay.className = 'wml-gd-memo-overlay';\n      overlay.setAttribute('aria-label', '저장 메모');\n      overlay.setAttribute('aria-modal', 'true');\n      const box = document.createElement('div');\n      box.className = 'wml-gd-memo-box';\n      box.setAttribute('role', 'document');\n      const content = document.createElement('div');\n      content.textContent = value;\n      const closeButton = document.createElement('button');\n      closeButton.type = 'button';\n      closeButton.className = 'wml-gd-memo-close';\n      closeButton.textContent = '닫기';\n      box.append(content, closeButton);\n      overlay.append(box);\n      const onKeyDown = event => {\n        if (event.key === 'Escape' && activeMemoDialog === overlay) { event.preventDefault(); closeMemoPopup(); }\n      };\n      overlay._wmlMemoKeyHandler = onKeyDown;\n      overlay.addEventListener('click', event => { if (event.target === overlay) closeMemoPopup(); });\n      overlay.addEventListener('cancel', event => { event.preventDefault(); closeMemoPopup(); });\n      overlay.addEventListener('close', () => { if (activeMemoDialog === overlay) closeMemoPopup(); });\n      closeButton.addEventListener('click', closeMemoPopup);\n      document.addEventListener('keydown', onKeyDown, true);\n      activeMemoDialog = overlay;\n      document.body.append(overlay);\n      if (typeof overlay.showModal === 'function') {\n        try { overlay.showModal(); } catch (_) { overlay.setAttribute('open', ''); }\n      } else overlay.setAttribute('open', '');\n    }\n\n";
class MemoTestElement {
  constructor(tagName) { this.tagName = tagName; this.children = []; this.listeners = {}; this.attributes = {}; this.open = false; this.removed = false; }
  append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
  fire(name, event = {}) { for (const callback of [...(this.listeners[name] || [])]) callback(event); }
  showModal() { this.open = true; }
  close() { this.open = false; this.fire('close', { target: this }); }
  remove() { this.removed = true; if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this); }
}
const memoDocument = {
  listeners: {},
  createElement(tagName) { return new MemoTestElement(tagName); },
  addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); },
  removeEventListener(name, callback) { this.listeners[name] = (this.listeners[name] || []).filter(item => item !== callback); },
  body: new MemoTestElement('body')
};
const memoApi = vm.runInNewContext(
  '(function(){ let activeMemoDialog = null;\n' + memoSource + '\nreturn { showMemoPopup, closeMemoPopup, active: () => activeMemoDialog }; })()',
  { document: memoDocument }
);
memoApi.showMemoPopup('   ');
assert.equal(memoDocument.body.children.length, 0, 'empty memo must not open a popup');
const longKoreanMemo = '한글 첫 줄\n' + '긴 메모 문장 '.repeat(1200);
memoApi.showMemoPopup(longKoreanMemo);
let memoDialog = memoApi.active();
assert.ok(memoDialog && memoDialog.open, 'memo dialog opens');
assert.equal(memoDialog.children[0].children[0].textContent, longKoreanMemo, 'long Korean memo and line breaks are preserved exactly');
assert.equal(memoDialog.attributes['aria-modal'], 'true', 'memo dialog is announced as modal');
memoDialog.fire('click', { target: memoDialog.children[0] });
assert.equal(memoDialog.open, true, 'clicking inside memo must not close it');
memoDialog.fire('click', { target: memoDialog });
assert.equal(memoApi.active(), null, 'outside click closes memo');
assert.equal(memoDialog.removed, true, 'outside click removes dialog');
assert.equal((memoDocument.listeners.keydown || []).length, 0, 'outside close removes global key listener');
memoApi.showMemoPopup(longKoreanMemo);
memoDialog = memoApi.active();
let escapePrevented = false;
memoDocument.listeners.keydown[0]({ key: 'Escape', preventDefault() { escapePrevented = true; } });
assert.equal(escapePrevented, true, 'Escape is consumed by memo dialog');
assert.equal(memoApi.active(), null, 'Escape closes memo');
memoApi.showMemoPopup(longKoreanMemo);
memoDialog = memoApi.active();
let cancelPrevented = false;
memoDialog.fire('cancel', { preventDefault() { cancelPrevented = true; } });
assert.equal(cancelPrevented, true, 'native dialog cancel is consumed');
assert.equal(memoApi.active(), null, 'native cancel closes memo');
memoApi.showMemoPopup(longKoreanMemo);
memoDialog = memoApi.active();
memoDialog.children[0].children[1].fire('click');
assert.equal(memoApi.active(), null, 'close button closes memo');
assert.ok(fileContainsText(modPath, 'max-height:75vh;overflow:auto'), 'memo popup supports internal scrolling');
assert.ok(fileContainsText(modPath, 'white-space:pre-wrap'), 'memo popup preserves line breaks');
assert.ok(fileContainsText(modPath, 'text-overflow:ellipsis;white-space:nowrap'), 'memo chip is single-line ellipsized');
const cryptoRoundTripScript = [
  "const nodeCrypto = require('node:crypto');",
  "globalThis.crypto = nodeCrypto.webcrypto;",
  "globalThis.btoa = value => Buffer.from(value, 'binary').toString('base64');",
  "globalThis.atob = value => Buffer.from(value, 'base64').toString('binary');",
  "require(process.cwd() + '/cloud-save/crypto.js');",
  "(async () => {",
  "  const input = {\"schema\":\"wayward-cloud-save\",\"version\":1,\"gameFamily\":\"wayward\",\"nativeFormat\":1,\"savedAt\":1794700000123,\"memo\":\"한글 메모 첫 줄\\n둘째 줄과 긴 내용\",\"previewGeneration\":\"generation-123\",\"state\":{\"primaryCharacterId\":\"player-a\",\"characters\":{\"player-a\":{\"name\":\"테스트 캐릭터\",\"archetypeId\":\"elena_farmgirl\"}},\"day\":42,\"economy\":{\"gold\":987654}}};",
  "  const encrypted = await globalThis.WMLGoogleDriveCrypto.encryptSnapshotEmbedded(input);",
  "  const decrypted = await globalThis.WMLGoogleDriveCrypto.decryptSnapshotEmbedded(encrypted);",
  "  if (JSON.stringify(decrypted) !== JSON.stringify(input)) throw new Error('preview encrypt/decrypt mismatch');",
  "  const visible = JSON.stringify(encrypted);",
  "  if (visible.includes('테스트 캐릭터') || visible.includes('한글 메모')) throw new Error('preview plaintext leaked');",
  "  process.stdout.write(JSON.stringify({ encrypted: true, decrypted: true, plaintextHidden: true }));",
  "})().catch(error => { console.error(error); process.exit(1); });",
].join('\n');
const cryptoRoundTrip = JSON.parse(execFileSync(process.execPath, ['-e', cryptoRoundTripScript], { encoding: 'utf8', timeout: 20000 }));
assert.deepEqual(cryptoRoundTrip, { encrypted: true, decrypted: true, plaintextHidden: true });

(async () => {
assert.ok(globalThis.crypto && globalThis.crypto.subtle, 'Node WebCrypto is available for sidecar mock');
if (typeof globalThis.btoa !== 'function') globalThis.btoa = value => Buffer.from(value, 'binary').toString('base64');
if (typeof globalThis.atob !== 'function') globalThis.atob = value => Buffer.from(value, 'base64').toString('binary');
require(cryptoPath);
const currentModSource = fs.readFileSync(modPath, 'utf8');
const helperStart = currentModSource.indexOf('    function extractSnapshotPreview(snapshot) {');
const helperEnd = currentModSource.indexOf('    function buildSnapshot() {', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'preview helpers are present for mocked Drive tests');
const sidecarHelpers = currentModSource.slice(helperStart, helperEnd);
const driveCalls = [];
const sidecarFiles = new Map([['old-sidecar', { stale: true }]]);
const primaryFile = { id: 'primary-1', previewId: 'old-sidecar', previewGeneration: 'old-generation', appProperties: { wmlPreviewId: 'old-sidecar', wmlPreviewGeneration: 'old-generation' } };
let primaryProperties = primaryFile.appProperties;
let activeSessionGeneration = 7;
const driveContext = {
  WMLGoogleDriveCrypto: globalThis.WMLGoogleDriveCrypto, sessionGeneration: 7, driveAccountCacheIdentity: null, driveSlots: [primaryFile], drivePreviewDownloadCount: 0,
  createAuthNonce: () => 'generation-123',
  assertDriveSession: value => { if (value !== activeSessionGeneration) throw new Error('stale session'); },
  writeAccountSlotCache: () => {},
  driveFetch: async (url, options = {}) => {
    driveCalls.push({ url, method: options.method || 'GET' });
    if (url.startsWith('/upload/drive/v3/files?')) {
      const body = options.body;
      assert.ok(!body.includes('테스트 캐릭터') && !body.includes('한글 메모'), 'multipart upload contains no plaintext game details');
      const boundary = body.split('\r\n')[0].slice(2);
      const marker = 'Content-Type: application/json; charset=UTF-8\r\n\r\n';
      const first = body.indexOf(marker);
      const second = body.indexOf(marker, first + marker.length);
      const payloadStart = second + marker.length;
      const payloadEnd = body.indexOf('\r\n--' + boundary + '--', payloadStart);
      assert.ok(first >= 0 && second > first && payloadEnd > payloadStart, 'multipart envelope boundaries are valid');
      const envelope = JSON.parse(body.slice(payloadStart, payloadEnd));
      assert.ok(body.includes('appDataFolder'), 'sidecar parent uses appDataFolder');
      sidecarFiles.set('new-sidecar', envelope);
      return { json: async () => ({ id: 'new-sidecar' }) };
    }
    if (url.startsWith('/drive/v3/files/primary-1?fields=')) {
      primaryProperties = JSON.parse(options.body).appProperties;
      return { json: async () => ({ id: 'primary-1', appProperties: primaryProperties }) };
    }
    if (url === '/drive/v3/files/new-sidecar?alt=media') return { json: async () => sidecarFiles.get('new-sidecar') };
    if (options.method === 'DELETE' && url.startsWith('/drive/v3/files/')) { sidecarFiles.delete(url.slice('/drive/v3/files/'.length)); return { json: async () => ({}) }; }
    throw new Error('unexpected mock Drive request: ' + url + ' ' + (options.method || 'GET'));
  }
};
const sidecarApi = vm.runInNewContext(sidecarHelpers + '\n;({ uploadPreviewSidecar, readSlotPreviewSidecar, clearSlotPreview })', driveContext);
const savedPreview = await sidecarApi.uploadPreviewSidecar(primaryFile, previewFixture);
assert.equal(primaryFile.previewId, 'new-sidecar', 'new Sidecar ID is linked to primary save');
assert.equal(primaryFile.previewGeneration, 'generation-123', 'new generation is linked to primary save');
assert.deepEqual(Object.keys(primaryProperties).sort(), ['wmlPreviewGeneration','wmlPreviewId'], 'primary appProperties contain only opaque ID and generation');
assert.equal(sidecarFiles.has('old-sidecar'), false, 'old sidecar is cleaned up after pointer swap');
assert.equal(sidecarFiles.has('new-sidecar'), true, 'encrypted sidecar has been stored');
const loadedPreview = await sidecarApi.readSlotPreviewSidecar(primaryFile, 7);
assert.equal(loadedPreview.memo, savedPreview.memo, 'Sidecar memo is decryptable and preserved');
assert.equal(loadedPreview.savedAt, savedPreview.savedAt, 'Sidecar game timestamp is preserved');
const correctGeneration = primaryFile.previewGeneration;
primaryFile.previewGeneration = 'mismatched-generation';
await assert.rejects(() => sidecarApi.readSlotPreviewSidecar(primaryFile, 7), /generation/);
primaryFile.previewGeneration = correctGeneration;
activeSessionGeneration = 8;
await assert.rejects(() => sidecarApi.readSlotPreviewSidecar(primaryFile, 7), /stale session/);
activeSessionGeneration = 7;
await sidecarApi.clearSlotPreview(primaryFile);
assert.equal(primaryFile.previewId, '', 'Sidecar pointer is cleared');
assert.equal(primaryFile.previewGeneration, '', 'Sidecar generation is cleared');
assert.equal(sidecarFiles.size, 0, 'Sidecar and stale sidecar are deleted');
for (const method of ['POST','PATCH','GET','DELETE']) assert.ok(driveCalls.some(call => call.method === method), 'mock Drive exercised '+method);


const duplicateResult = normalizeDriveSlotFiles([
  { id: 'old', name: 'wayward-cloud-slot-7.json', modifiedTime: '2026-01-01T00:00:00Z', size: 1 },
  { id: 'new', name: 'wayward-cloud-slot-7.json', modifiedTime: '2026-02-01T00:00:00Z', size: 2 },
  { id: 'bad', name: '../wayward-cloud-slot-8.json', modifiedTime: '2026-03-01T00:00:00Z', size: 3 },
  { id: '', name: 'wayward-cloud-slot-9.json', modifiedTime: '2026-04-01T00:00:00Z', size: 4 }
]);
assert.equal(duplicateResult.length, 1);
assert.equal(duplicateResult[0].id, 'new');
assert.equal(duplicateResult[0].size, 2);

// The snapshot serializer/restorer and encrypted file primitives must remain
// exactly equal to the user's 0.6.1 baseline.
// The pinned 0.6.1 baseline is streamed to baselinePath above.
for (const [start, currentEnd, baselineEnd] of [
  ['    function buildSnapshot()', '    function firstValue(root', '    function firstValue(root'],
  ['    function applySnapshot(snapshot)', '    function isConnected()', '    function isConnected()'],
  ['    async function writeSlotEnvelope(slot, envelope)', '    async function deleteSlot(slot)', '    async function deleteSlot(slot)'],
  ['    async function deleteSlot(slot)', '    function extractSnapshotPreview(snapshot)', '    function buildSnapshot()']
]) {
  assert.equal(
    readSectionFromFile(modPath, start, currentEnd),
    readSectionFromFile(baselinePath, start, baselineEnd),
    'protected 0.6.1 data/game logic changed: ' + start
  );
}
const cryptoBlob = execFileSync('git', ['hash-object', cryptoPath], { encoding: 'utf8' }).trim();
assert.equal(cryptoBlob, '7a321b24588d892a02ad9dec7335cf17ce99c8c5',
  'crypto.js must remain byte-for-byte identical to the 0.6.1 baseline');

// Sequential binary scan: hash every byte in 4 KiB chunks and preserve the
// offset/length/hash manifest for both the current module and pinned baseline.
function scanBinaryFile(filePath, label) {
  const expectedSize = fs.statSync(filePath).size;
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(4096);
  const wholeHash = crypto.createHash('sha256');
  const chunks = [];
  let offset = 0;
  try {
    while (true) {
      const length = fs.readSync(fd, buffer, 0, buffer.length, offset);
      if (length === 0) break;
      const bytes = buffer.subarray(0, length);
      const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      wholeHash.update(bytes);
      chunks.push({ offset, length, sha256 });
      offset += length;
    }
  } finally { fs.closeSync(fd); }
  assert.equal(offset, expectedSize, label + ' scan must reach EOF exactly');
  return {
    file: label,
    bytes: offset,
    chunkSize: 4096,
    sha256: wholeHash.digest('hex'),
    chunks
  };
}

const sourceScan = scanBinaryFile(modPath, 'cloud-save/mod.js');
const baselineScan = scanBinaryFile(baselinePath, 'CloudSave 0.6.1 baseline mod.js');
fs.writeFileSync(
  path.join(outputDir, 'cloudsave-mod-chunks-4096.json'),
  JSON.stringify({ baselineCommit: BASELINE_COMMIT, scans: [sourceScan, baselineScan] }, null, 2)
);
console.log('BINARY_SCAN', JSON.stringify({
  source: { bytes: sourceScan.bytes, chunks: sourceScan.chunks.length, sha256: sourceScan.sha256 },
  baseline: { bytes: baselineScan.bytes, chunks: baselineScan.chunks.length, sha256: baselineScan.sha256 }
}));
fs.rmSync(baselinePath, { force: true });
console.log('CloudSave 0.6.2 source contracts passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
