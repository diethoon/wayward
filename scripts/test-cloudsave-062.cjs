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
requireText("https://jeiky224.github.io/cloud/auth-061.html", 'isolated 0.6.1 auth endpoint');
requireText('startGoogleDriveAuthWithPolicy(nonce, !!forceSelectAccount)', 'Android native policy bridge');
requireText('takePendingStateForNonce(nonce)', 'nonce-scoped native result retrieval');
requireText('window.open(bridgeUrl.toString()', 'synchronous browser popup open');
requireText('event.origin !== AUTH_BRIDGE_ORIGIN', 'auth page Origin validation');
requireText('event.source !== bridge', 'auth popup source validation');
requireText('payload.nonce !== nonce', 'one-time nonce validation');
requireText("'구글 계정으로 연결'", 'unified connect button label');
requireText("bridgeUrl.searchParams.set('login', forceSelectAccount ? 'select_account' : 'remember')", 'browser account selection policy');
requireText('forceSelectAccount', 'native account selection policy');
requireText('closeWatch = setInterval', 'closed auth popup cleanup');
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
  '    function requestNativeGoogleToken(nonce, forceSelectAccount) {',
  '    function requestGoogleToken(forceSelectAccount) {'
);
assert.match(nativeAuth, /host\.cancelGoogleDriveAuth\(nonce\)/);
assert.match(nativeAuth, /const canCancel = typeof host\.cancelGoogleDriveAuth === 'function'/);
assert.match(nativeAuth, /canCancel \? 90000 : 180000/);

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
requireText("protocol === 'file:' || rawOrigin === 'null'", 'file origin one-click GIS handoff');
requireText('window.open(bridgeUrl.toString()', 'file-origin GIS popup remains user-gesture synchronous');

const browserAuth = readSectionFromFile(
  modPath,
  '    function requestGoogleToken(forceSelectAccount) {',
  '    function attemptNativeSessionRestore() {'
);
assert.match(browserAuth, /protocol === 'file:' \|\| rawOrigin === 'null'/);
assert.match(browserAuth, /window\.open\(bridgeUrl\.toString\(/);
assert.match(browserAuth, /event\.source !== bridge/);
assert.match(browserAuth, /payload\.nonce !== nonce/);

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

const cryptoRoundTripScript = [
  "const nodeCrypto = require('node:crypto');",
  "globalThis.crypto = nodeCrypto.webcrypto;",
  "globalThis.btoa = value => Buffer.from(value, 'binary').toString('base64');",
  "globalThis.atob = value => Buffer.from(value, 'base64').toString('binary');",
  "require(" + JSON.stringify(cryptoPath) + ");",
  "(async () => {",
  "  const input = " + JSON.stringify(previewSnapshot) + ";",
  "  const encrypted = await globalThis.WMLGoogleDriveCrypto.encryptSnapshotEmbedded(input);",
  "  const decrypted = await globalThis.WMLGoogleDriveCrypto.decryptSnapshotEmbedded(encrypted);",
  "  if (JSON.stringify(decrypted) !== JSON.stringify(input)) throw new Error('preview encrypt/decrypt mismatch');",
  "  const visible = JSON.stringify(encrypted);",
  "  if (visible.includes('테스트 캐릭터') || visible.includes('한글 메모')) throw new Error('preview plaintext leaked');",
  "  process.stdout.write(JSON.stringify({ encrypted: true, decrypted: true, plaintextHidden: true }));",
  "})().catch(error => { console.error(error); process.exit(1); });"
].join('\n');
const cryptoRoundTrip = JSON.parse(execFileSync(process.execPath, ['-e', cryptoRoundTripScript], { encoding: 'utf8', timeout: 20000 }));
assert.deepEqual(cryptoRoundTrip, { encrypted: true, decrypted: true, plaintextHidden: true });

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
for (const [start, end] of [
  ['    function buildSnapshot()', '    function firstValue(root'],
  ['    function applySnapshot(snapshot)', '    function isConnected()'],
  ['    async function writeSlotEnvelope(slot, envelope)', '    async function deleteSlot(slot)'],
  ['    async function deleteSlot(slot)', '    function extractSnapshotPreview(snapshot)']
]) {
  assert.equal(readSectionFromFile(modPath, start, end), readSectionFromFile(baselinePath, start, end),
    'protected 0.6.1 data/game logic changed: ' + start);
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
