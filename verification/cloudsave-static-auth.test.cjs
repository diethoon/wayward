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

test('the only runtime hosts are the static Pages auth page and Google APIs', () => {
  const hosts = [...mod.matchAll(/https?:\/\/[A-Za-z0-9._:-]+/g)]
    .map(match => match[0]);
  assert.deepEqual([...new Set(hosts)].sort(), [
    'https://jeiky224.github.io',
    'https://www.googleapis.com'
  ]);
  assert.match(mod, /AUTH_BRIDGE_URL\s*=\s*'https:\/\/jeiky224\.github\.io\/cloud\/auth\.html'/);
  assert.match(mod, /fetch\('https:\/\/www\.googleapis\.com'\s*\+\s*path/);
  assert.doesNotMatch(mod, /vercel\.app|vercel\.com|workers\.dev|cloudflare|render\.com|wss?:\/\//i);
  assert.doesNotMatch(mod, /AUTH_API_URL|AUTH_RELAY|token_endpoint|oauth\/refresh|refreshToken|client_secret/i);
});

test('file origin is opaque; 0.0.0.0 and other HTTP origins remain exact', () => {
  assert.match(mod, /protocol\s*===\s*'file:'\s*\|\|\s*rawOrigin\s*===\s*'null'/);
  assert.match(mod, /gameOrigin\s*=\s*isFileExecution\s*\?\s*'null'\s*:\s*rawOrigin/);
  assert.match(mod, /parsedOrigin\.origin\s*!==\s*gameOrigin/);
  assert.doesNotMatch(mod, /0\.0\.0\.0[^\n]{0,80}127\.0\.0\.1|127\.0\.0\.1[^\n]{0,80}0\.0\.0\.0/);
});

test('popup return is bound to the exact Pages origin, WindowProxy and one-time nonce', () => {
  assert.match(mod, /event\.origin\s*!==\s*AUTH_BRIDGE_ORIGIN/);
  assert.match(mod, /event\.source\s*!==\s*pendingAuthWindow/);
  assert.match(mod, /payload\.nonce\s*!==\s*nonce/);
  assert.match(mod, /wayward-cloud-auth-page-ready/);
  assert.match(mod, /wayward-cloud-auth-hello/);
  assert.match(mod, /wayward-cloud-auth-success/);
  assert.match(mod, /pendingAuthWindow\.postMessage[\s\S]{0,180}AUTH_BRIDGE_ORIGIN/);
});

test('browser token revocation waits for the static page-ready handshake', () => {
  const revoke = segment(
    mod,
    '    function requestBrowserTokenRevocation(token) {',
    '    function logoutGoogleAccount() {'
  );
  assert.match(revoke, /event\.origin\s*!==\s*AUTH_BRIDGE_ORIGIN/);
  assert.match(revoke, /event\.source\s*!==\s*popup/);
  assert.match(revoke, /event\.data\.type\s*===\s*'wayward-cloud-auth-page-ready'/);
  assert.match(revoke, /popup\.postMessage\(\{\s*type:\s*'wayward-cloud-auth-hello',\s*nonce\s*\}/);
  assert.match(revoke, /event\.data\.type\s*===\s*'wayward-cloud-revoke-ready'/);
  assert.match(revoke, /accessToken:\s*token/);
  assert.doesNotMatch(revoke, /popup\.postMessage\(\{\s*type:\s*'wayward-cloud-auth-hello'[\s\S]{0,300}window\.addEventListener/);
});

test('manual external-browser return validates pending nonce and never persists the token', () => {
  assert.match(mod, /function submitManualAuthResponse\(\)/);
  assert.match(mod, /payload\.nonce\s*!==\s*pendingAuthNonce/);
  assert.match(mod, /pendingAuthResolve\(payload\)/);
  assert.match(mod, /view\.page === 'manual-auth'/);
  assert.match(mod, /authResponse/);
  assert.doesNotMatch(mod, /writeStorage\([^\n]*(accessToken|refreshToken)/i);
  assert.doesNotMatch(mod, /localStorage\.setItem\([^\n]*(accessToken|refreshToken)/i);
});

test('token handoff checks exact Drive scope, token size and bounded expiry', () => {
  assert.match(mod, /payload\.scope\s*!==\s*'https:\/\/www\.googleapis\.com\/auth\/drive\.appdata'/);
  assert.match(mod, /payload\.accessToken\.length\s*>\s*4096/);
  assert.match(mod, /expiresIn\s*<\s*60\s*\|\|\s*expiresIn\s*>\s*3600/);
});

test('Drive slot naming, appDataFolder and legacy envelope paths are retained', () => {
  assert.match(mod, /FILE_PREFIX\s*=\s*'wayward-cloud-slot-'/);
  assert.match(mod, /spaces:\s*'appDataFolder'/);
  assert.match(mod, /parents:\s*\['appDataFolder'\]/);
  assert.match(mod, /keyMode\s*===\s*'embedded-addon-v2'/);
  assert.match(mod, /WMLGoogleDriveCrypto\.decryptSnapshotEmbedded/);
  assert.match(mod, /WMLGoogleDriveCrypto\.decryptSnapshot\(envelope,\s*passphrase\)/);
  assert.match(mod, /schema:\s*'wayward-cloud-save'/);
  assert.match(mod, /nativeFormat:\s*1/);
});

test('protected Drive, snapshot, restore, save/load functions are byte-identical to v0.6.1 base', () => {
  const ranges = [
    ['drive operations', '    async function driveFetch(path, options) {', '    function buildSnapshot() {'],
    ['snapshot construction', '    function buildSnapshot() {', '    function firstValue(root, patterns) {'],
    ['snapshot restore', '    function applySnapshot(snapshot) {', '    function isConnected() {'],
    ['save/load', '    async function saveSlot(slot) {', '    function showSessionSettingsPopup() {']
  ];
  for (const [name, start, end] of ranges) {
    assert.equal(segment(mod, start, end), segment(baseMod, start, end), name + ' must remain unchanged');
  }
  assert.deepEqual(crypto, baseCrypto, 'crypto.js must remain byte-identical to the v0.6.1 base');
});

test('the candidate docs identify Token Model re-auth rather than claiming silent refresh', () => {
  assert.match(readme, /Token Model/);
  assert.match(readme, /사용자가 CloudSave의 연결 버튼을 눌러 Google에 직접 재인증/);
  assert.match(readme, /무인 갱신/);
  assert.match(readme, /file:\/\//);
  assert.match(readme, /0\.0\.0\.0/);
});
