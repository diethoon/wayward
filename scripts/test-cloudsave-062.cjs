'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');

const root = path.resolve(__dirname, '..');
const modPath = path.join(root, 'cloud-save/mod.js');
const cryptoPath = path.join(root, 'cloud-save/crypto.js');
const mod = fs.readFileSync(modPath, 'utf8');

function section(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'missing source section: ' + start);
  return source.slice(a, b);
}

function requireText(value, label) {
  assert.ok(mod.includes(value), 'missing required CloudSave contract: ' + label);
}

assert.match(mod, /version: '0\.6\.2'/);
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
assert.doesNotMatch(mod, /showSessionSettingsPopup|setSessionPolicy|sessionPolicy|SESSION_POLICY_KEY|로그인 유지 설정|새로고침할 때마다 로그인 해제/);
assert.doesNotMatch(mod, /localStorage\.setItem\([^\n]*(?:accessToken|refreshToken)/i);
assert.doesNotMatch(mod, /sessionStorage\.setItem\([^\n]*(?:accessToken|refreshToken)/i);

const refresh = section(mod, '    function refreshSlots() {', '    function currentFile(slot) {');
assert.match(refresh, /files\.list|drive\/v3\/files/);
assert.doesNotMatch(refresh, /readSlotEnvelope|decryptSnapshot|alt=media/,
  'the list must not download or decrypt save bodies');
assert.match(refresh, /files\(id,name,mimeType,modifiedTime,size\)/);
assert.match(refresh, /pageSize: '1000'/);
assert.match(refresh, /name contains/);

const normalizerSource = section(
  mod,
  '    function normalizeDriveSlotFiles(files) {',
  '    function validateMetadataCache(value) {'
).trim();
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
  assert.equal(slots.at(-1) && Number(slots.at(-1).name.slice(19, -5)), count || undefined);
  console.log('SYNTHETIC_METADATA', JSON.stringify({
    slots: count, normalized: slots.length, cpuMs: Number(elapsed.toFixed(3)),
    bodyDownloads: 0, decryptMs: 0
  }));
}

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
const baseline = execFileSync('git', [
  'show', '0356c7da899b102107ab6988c11a1549de5d209e:cloud-save/mod.js'
], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
for (const [start, end] of [
  ['    function buildSnapshot()', '    function firstValue(root'],
  ['    function applySnapshot(snapshot)', '    function isConnected()'],
  ['    async function writeSlotEnvelope(slot, envelope)', '    async function deleteSlot(slot)'],
  ['    async function deleteSlot(slot)', '    function buildSnapshot()']
]) {
  assert.equal(section(mod, start, end), section(baseline, start, end),
    'protected 0.6.1 data/game logic changed: ' + start);
}
const cryptoBlob = execFileSync('git', ['hash-object', cryptoPath], { encoding: 'utf8' }).trim();
assert.equal(cryptoBlob, '7a321b24588d892a02ad9dec7335cf17ce99c8c5',
  'crypto.js must remain byte-for-byte identical to the 0.6.1 baseline');

// Sequential binary scan: every byte is read once in 4096-byte chunks and
// offset/length/SHA-256 are emitted for the build artifact.
const outputDir = path.join(root, '.build');
fs.mkdirSync(outputDir, { recursive: true });
const fd = fs.openSync(modPath, 'r');
const buffer = Buffer.alloc(4096);
const manifest = [];
let offset = 0;
try {
  while (true) {
    const length = fs.readSync(fd, buffer, 0, buffer.length, offset);
    if (length === 0) break;
    const bytes = buffer.subarray(0, length);
    manifest.push({
      offset,
      length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex')
    });
    offset += length;
  }
} finally {
  fs.closeSync(fd);
}
assert.equal(offset, fs.statSync(modPath).size, 'binary scan must reach EOF exactly');
fs.writeFileSync(
  path.join(outputDir, 'cloudsave-mod-chunks-4096.json'),
  JSON.stringify({ file: 'cloud-save/mod.js', bytes: offset, chunkSize: 4096, chunks: manifest }, null, 2)
);
console.log('BINARY_SCAN', JSON.stringify({ bytes: offset, chunks: manifest.length, chunkSize: 4096 }));
console.log('CloudSave 0.6.2 source contracts passed');
