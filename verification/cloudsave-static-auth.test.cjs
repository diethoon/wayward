'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const modPath = path.join(root, 'cloud-save/mod.js');
const cryptoPath = path.join(root, 'cloud-save/crypto.js');
const readmePath = path.join(root, 'cloud-save/README.md');
const mod = fs.readFileSync(modPath, 'utf8');
const crypto = fs.readFileSync(cryptoPath);
const readme = fs.readFileSync(readmePath, 'utf8');
const fixture = JSON.parse(fs.readFileSync(
  path.join(root, 'verification/fixtures/cloudsave-v044-crypto-compat.json'),
  'utf8'
));
if (!globalThis.crypto || !globalThis.crypto.subtle) {
  globalThis.crypto = require('node:crypto').webcrypto;
}
require(cryptoPath);
const BASE_REF = 'origin/work/cloudsave-session-policy-20261113';
const baseMod = execFileSync('git', ['show', BASE_REF + ':cloud-save/mod.js'], {
  cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024
});
const baseCrypto = execFileSync('git', ['show', BASE_REF + ':cloud-save/crypto.js'], {
  cwd: root, maxBuffer: 8 * 1024 * 1024
});

function segment(source, start, end) {
  const from = source.indexOf(start);
  if (from < 0) throw new Error('segment start not found: ' + start);
  const to = source.indexOf(end, from + start.length);
  if (to < 0) throw new Error('segment end not found: ' + end);
  return source.slice(from, to);
}

test('the game context only opens the fixed Pages origin and never calls Google Drive directly', () => {
  const hosts = [...mod.matchAll(/https?:\/\/[A-Za-z0-9._:-]+/g)]
    .map(match => match[0]);
  assert.deepEqual([...new Set(hosts)], ['https://jeiky224.github.io']);
  assert.match(mod, /AUTH_PAGE_URL\s*=\s*'https:\/\/jeiky224\.github\.io\/cloud\/auth\.html'/);
  assert.doesNotMatch(mod, /www\.googleapis\.com|\/drive\/v3\/files|\/upload\/drive/i);
  assert.doesNotMatch(mod, /Authorization\s*:\s*['"]Bearer|accessToken|tokenExpiresAt|refresh_token|refreshToken|client_secret/i);
  assert.doesNotMatch(mod, /WMLHost|vercel\.app|workers\.dev|cloudflare|render\.com|wss?:\/\//i);
});

test('file origin remains opaque and HTTP origins, including 0.0.0.0, stay exact', () => {
  assert.match(mod, /protocol\s*===\s*'file:'\s*&&\s*origin\s*===\s*'null'/);
  assert.match(mod, /return 'null'/);
  assert.match(mod, /return origin/);
  assert.match(mod, /parsed\.origin\s*!==\s*origin/);
  assert.doesNotMatch(mod, /0\.0\.0\.0[^\n]{0,80}127\.0\.0\.1|127\.0\.0\.1[^\n]{0,80}0\.0\.0\.0/);
});

test('popup bridge binds exact Pages origin, popup WindowProxy, nonce, session and request id', () => {
  assert.match(mod, /event\.origin\s*!==\s*AUTH_PAGE_ORIGIN/);
  assert.match(mod, /event\.source\s*!==\s*authPopup/);
  assert.match(mod, /data\.nonce\s*!==\s*authNonce/);
  assert.match(mod, /data\.sessionId\s*!==\s*authSessionId/);
  assert.match(mod, /wayward-cloudsave-page-ready/);
  assert.match(mod, /wayward-cloudsave-hello/);
  assert.match(mod, /wayward-cloudsave-ready/);
  assert.match(mod, /wayward-cloudsave-request/);
  assert.match(mod, /wayward-cloudsave-response/);
  assert.match(mod, /usedDriveRequestIds\.has\(requestId\)/);
  assert.match(mod, /authPopup\.postMessage[\s\S]{0,220}AUTH_PAGE_ORIGIN/);
  assert.doesNotMatch(mod, /authPopup\.postMessage[\s\S]{0,220}'\*'/);
});

test('the game distinguishes a generic Drive permission denial from an explicit confirmed revoke', () => {
  assert.match(mod, /bridgeStatus === 'permission-revoked'[\s\S]{0,180}markPermissionRevoked\(\)/);
  assert.match(mod, /'permission-denied': 'Google Drive API가 권한을 거부했습니다/);
  assert.match(mod, /bridgeStatus === 'revoke-failed'[\s\S]{0,160}authStatus = 'revoke-failed'/);
  assert.doesNotMatch(mod, /permission-denied'[\s\S]{0,100}markPermissionRevoked/);
});

test('the game sends only encrypted envelopes and slot commands; no manual token or JSON return UI remains', () => {
  assert.match(mod, /function requestDrive\(action, payload\)/);
  assert.match(mod, /requestDrive\('list'/);
  assert.match(mod, /requestDrive\('read'/);
  assert.match(mod, /requestDrive\('save'/);
  assert.match(mod, /requestDrive\('delete'/);
  assert.match(mod, /requestDrive\('logout'/);
  assert.match(mod, /requestDrive\('revoke'/);
  assert.match(mod, /encryptSnapshotEmbedded\(snapshot\)/);
  assert.doesNotMatch(mod, /manual-auth|authResponse|submitManualAuthResponse|textarea.*token/i);
  assert.doesNotMatch(mod, /postMessage[\s\S]{0,500}(accessToken|access_token)/i);
});

test('the auth policy persists only non-secret selection flags and removes obsolete legacy tokens', () => {
  assert.match(mod, /SESSION_POLICY_KEY/);
  assert.match(mod, /EXPLICIT_LOGOUT_KEY/);
  assert.match(mod, /HAD_AUTH_KEY/);
  assert.match(mod, /writeStorage\(LEGACY_SESSION_TOKEN_KEY, null\)/);
  assert.doesNotMatch(mod, /localStorage\.setItem\([^\n]*(accessToken|refreshToken|token)/i);
});

test('the Wayward slot name and encrypted envelope schema remain unchanged', () => {
  assert.match(mod, /FILE_PREFIX\s*=\s*'wayward-cloud-slot-'/);
  assert.match(mod, /keyMode\s*===\s*'embedded-addon-v2'/);
  assert.match(mod, /WMLGoogleDriveCrypto\.decryptSnapshotEmbedded/);
  assert.match(mod, /WMLGoogleDriveCrypto\.decryptSnapshot\(envelope,\s*passphrase\)/);
  assert.match(mod, /schema:\s*'wayward-cloud-save'/);
  assert.match(mod, /nativeFormat:\s*1/);
});

test('reloading the auth page invalidates the old game session before a new handshake', () => {
  assert.match(mod, /rejectPendingDriveRequests\('정적 인증 페이지가 새로고침되어 이전 Drive 요청을 종료했습니다\.'/);
  assert.match(mod, /data\.type === 'wayward-cloudsave-page-ready'[\s\S]{0,360}pageAuthenticated = false/);
  assert.match(authSource, /addEventListener\('pagehide',[\s\S]{0,220}sendStatus\('reauth-required'/);
  assert.match(authSource, /clearPageToken\(\);\s*\n\s*\}\);/);
});

test('the current crypto module decrypts an embedded-addon-v2 envelope generated by the original v0.4.4 crypto.js', async () => {
  assert.equal(fixture.provenance.sourceSha256,
    '145d4e3a7d3538e569416f20a7594582f49b8bae58c5c9e927241e2a7369d577');
  assert.equal(fixture.provenance.sourceBytes, 11587);
  const snapshot = await globalThis.WMLGoogleDriveCrypto.decryptSnapshotEmbedded(
    fixture.embeddedEnvelope
  );
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), fixture.expectedSnapshot);
});

test('the current crypto module decrypts a PBKDF2 passphrase envelope generated by the original v0.4.4 crypto.js', async () => {
  const snapshot = await globalThis.WMLGoogleDriveCrypto.decryptSnapshot(
    fixture.passphraseEnvelope,
    fixture.testPassphrase
  );
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), fixture.expectedSnapshot);
});

test('snapshot construction, restore, save, prepare-load, load and delete UI functions remain byte-identical to v0.6.1', () => {
  const ranges = [
    ['snapshot construction', '    function buildSnapshot() {', '    function firstValue(root, patterns) {'],
    ['snapshot restore', '    function applySnapshot(snapshot) {', '    function isConnected() {'],
    ['save', '    async function saveSlot(slot) {', '    async function prepareLoadSlot(slot) {'],
    ['prepare load', '    async function prepareLoadSlot(slot) {', '    async function loadSlot(slot) {'],
    ['load', '    async function loadSlot(slot) {', '    async function removeSlot(slot) {'],
    ['delete confirmation action', '    async function removeSlot(slot) {', '    function showSessionSettingsPopup() {']
  ];
  for (const [name, start, end] of ranges) {
    assert.equal(segment(mod, start, end), segment(baseMod, start, end), name + ' must remain unchanged');
  }
  assert.deepEqual(crypto, baseCrypto, 'crypto.js must remain byte-identical to the v0.6.1 base');
});

test('the README describes page-owned Drive traffic and user-driven Token Model reauthentication', () => {
  assert.match(readme, /v0\.7\.0/);
  assert.match(readme, /Drive API.*인증 페이지/);
  assert.match(readme, /file:\/\//);
  assert.match(readme, /0\.0\.0\.0/);
  assert.match(readme, /무인.*갱신/);
  assert.match(readme, /appDataFolder/);
});
