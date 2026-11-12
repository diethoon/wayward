#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mod = fs.readFileSync(path.join(__dirname, '../cloud-save/mod.js'), 'utf8');
const page = fs.readFileSync(path.join(__dirname, '../auth-page/index.html'), 'utf8');

for (const required of [
  "const SESSION_POLICY_KEY = 'wml-google-drive-session-policy-v1'",
  "const EXPLICIT_LOGOUT_KEY = 'wml-google-drive-explicit-logout-v1'",
  "sessionPolicy = policy === 'reauth' ? 'reauth' : 'remember'",
  "explicitLogout = true",
  "const forceSelectAccount = explicitLogout || sessionPolicy === 'reauth'",
  "startGoogleDriveAuthWithPolicy(nonce, !!forceSelectAccount)",
  "permissionRevoked = loadLogoutMarker() === 'revoked'",
  "function markPermissionRevoked()",
  "markExplicitLogout(revoked)",
  "const HAD_AUTH_KEY = 'wml-google-drive-had-auth-v1'",
  "function loadHadPreviousAuth()",
  "hadPreviousAuth = true",
  "!hadPreviousAuth",
  "function attemptNativeSessionRestore()",
  "function requestNativeGoogleRevoke()",
  "async function revokeGooglePermission()",
  "authStatus = 'explicit-logout'",
  "authStatus = 'google-session-expired'",
  "authStatus = 'permission-revoked'"
]) assert.ok(mod.includes(required), 'missing WML auth policy contract: ' + required);

const logoutStart = mod.indexOf('function logoutGoogleAccount()');
const logoutEnd = mod.indexOf('function requestNativeGoogleRevoke()', logoutStart);
assert.ok(logoutStart >= 0 && logoutEnd > logoutStart, 'local logout function boundaries missing');
const logout = mod.slice(logoutStart, logoutEnd);
assert.ok(logout.includes('markExplicitLogout()'));
assert.ok(!logout.includes('requestBrowserTokenRevocation('), 'simple logout must not revoke Google grant');

for (const required of [
  "const loginPolicy=params.get('login')==='select_account'?'select_account':'remember'",
  "client.requestAccessToken({prompt:loginPolicy==='select_account'?'select_account':'',state:nonce})",
  "google.accounts.oauth2.hasGrantedAllScopes(response,DRIVE_SCOPE)",
  "code:'scope_missing'",
  "google.accounts.oauth2.revoke",
  '<meta name="referrer" content="strict-origin-when-cross-origin">',
]) assert.ok(page.includes(required), 'missing Pages auth policy contract: ' + required);

for (const forbidden of [
  'wayward-auth-relay', 'workers.dev', 'cloudflare', 'AUTH_API_URL',
  'refreshToken', '/oauth/refresh', '/oauth/exchange', 'new WebSocket'
]) {
  assert.ok(!mod.toLowerCase().includes(forbidden.toLowerCase()), 'CloudSave relay/token code remains: ' + forbidden);
  assert.ok(!page.toLowerCase().includes(forbidden.toLowerCase()), 'Pages relay/token code remains: ' + forbidden);
}
assert.ok(!/localStorage\.setItem\([^,]*(access.?token|refresh.?token)/i.test(mod),
  'an OAuth token must never be persisted in browser storage');

console.log('CloudSave browser and WML session-policy contracts passed');
