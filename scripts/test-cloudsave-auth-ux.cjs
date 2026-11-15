'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const modPath = path.join(__dirname, '..', 'cloud-save', 'mod.js');
const source = fs.readFileSync(modPath, 'utf8');

function section(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, 'missing source range: ' + startMarker);
  return source.slice(start, end);
}

function makeNativeHarness(host, options = {}) {
  const accepted = [];
  const context = {
    nativeAuthHost: host,
    AUTH_ADAPTER: 'android-native',
    activeAuthCancel: null,
    authAttemptSerial: options.attempt || 7,
    sessionGeneration: options.session || 11,
    isCurrentAuthAttempt(attempt, session) {
      return attempt === context.authAttemptSerial && session === context.sessionGeneration;
    },
    acceptAccessToken(payload, nonce) {
      if (!payload || payload.nonce !== nonce) throw new Error('nonce mismatch');
      accepted.push(payload);
    },
    Promise, Date, Error, JSON, String, setTimeout, clearTimeout
  };
  const code = section(
    '    function requestNativeGoogleToken(nonce, forceSelectAccount, attempt, sessionAtStart) {',
    '    function validateDirectGISOrigin() {'
  );
  const requestNativeGoogleToken = vm.runInNewContext(
    code + '\n;requestNativeGoogleToken', context
  );
  return { context, accepted, requestNativeGoogleToken };
}

async function testLegacyAndroidRelogin() {
  const nonce = 'a'.repeat(48);
  const calls = [];
  const host = {
    startGoogleDriveAuth(value) { calls.push(['legacy-start', value]); },
    takePendingStateForNonce(value) {
      calls.push(['take', value]);
      return JSON.stringify({
        type: 'wayward-cloud-auth-success',
        nonce: value,
        accessToken: 'legacy-android-access-token-123456',
        expiresIn: 3600
      });
    }
  };
  const harness = makeNativeHarness(host);
  const pending = harness.requestNativeGoogleToken(nonce, true, 7, 11);
  assert.equal(calls[0][0], 'legacy-start',
    'forceSelectAccount must not route a 0.6.1 native bridge to browser GIS');
  assert.equal(calls[0][1], nonce);
  await pending;
  assert.equal(harness.accepted.length, 1);
  assert.equal(harness.accepted[0].nonce, nonce);
  assert.equal(calls.some(call => call[0] === 'take'), true);
}

async function testModernAndroidPolicy() {
  const nonce = 'b'.repeat(48);
  let selected = null;
  const host = {
    startGoogleDriveAuthWithPolicy(value, force) {
      selected = { nonce: value, force };
    },
    cancelGoogleDriveAuth() {},
    takePendingStateForNonce(value) {
      return JSON.stringify({
        type: 'wayward-cloud-auth-success', nonce: value,
        accessToken: 'modern-android-access-token-123456', expiresIn: 3600
      });
    }
  };
  const harness = makeNativeHarness(host);
  await harness.requestNativeGoogleToken(nonce, true, 7, 11);
  assert.deepEqual(selected, { nonce, force: true },
    'new native bridge must receive the account-selection policy');
}

async function testAndroidStaleResponseRejected() {
  const nonce = 'c'.repeat(48);
  let context;
  const host = {
    startGoogleDriveAuth() {},
    takePendingStateForNonce(value) {
      context.sessionGeneration += 1;
      return JSON.stringify({
        type: 'wayward-cloud-auth-success', nonce: value,
        accessToken: 'stale-android-access-token-123456', expiresIn: 3600
      });
    }
  };
  const harness = makeNativeHarness(host);
  context = harness.context;
  await assert.rejects(
    harness.requestNativeGoogleToken(nonce, false, 7, 11),
    /이전 Android 인증 응답/
  );
  assert.equal(harness.accepted.length, 0, 'stale native response must not be applied');
}

async function testAndroidCancelIsNonceScoped() {
  const nonce = 'd'.repeat(48);
  const cancelled = [];
  const host = {
    startGoogleDriveAuthWithPolicy() {},
    cancelGoogleDriveAuth(value) { cancelled.push(value); },
    takePendingStateForNonce() { return ''; }
  };
  const harness = makeNativeHarness(host);
  const pending = harness.requestNativeGoogleToken(nonce, false, 7, 11);
  assert.equal(typeof harness.context.activeAuthCancel, 'function');
  harness.context.activeAuthCancel();
  await assert.rejects(pending, /취소/);
  assert.deepEqual(cancelled, [nonce]);
}

async function testBrokenNativeBridgeDoesNotFallback() {
  const nonce = 'e'.repeat(48);
  const host = { startGoogleDriveAuth() {} };
  const harness = makeNativeHarness(host);
  await assert.rejects(
    harness.requestNativeGoogleToken(nonce, false, 7, 11),
    /결과 조회 API/
  );
}

function createBrowserHarness(options = {}) {
  const calls = [];
  const accepted = [];
  let tokenCallback = null;
  let errorCallback = null;
  const oauth = {
    initTokenClient(config) {
      tokenCallback = config.callback;
      errorCallback = config.error_callback;
      calls.push({ type: 'init', config });
      return {
        requestAccessToken(override) {
          calls.push({ type: 'request', override });
          if (options.autoResponse !== false) {
            tokenCallback({
              access_token: 'browser-gis-access-token-123456',
              expires_in: 3600,
              scope: 'https://www.googleapis.com/auth/drive.appdata',
              state: override && override.state
            });
          }
        }
      };
    },
    hasGrantedAllScopes() { return true; },
    revoke(token, callback) { callback({ successful: true }); }
  };
  const context = {
    window: {
      location: {
        protocol: options.protocol || 'https:',
        origin: options.origin || 'https://wayward-six.vercel.app'
      },
      google: { accounts: { oauth2: oauth } }
    },
    URL,
    Promise, Error, String, Date, Uint8Array,
    GOOGLE_OAUTH_CLIENT_ID: 'test-public-client-id.apps.googleusercontent.com',
    GOOGLE_DRIVE_SCOPE: 'https://www.googleapis.com/auth/drive.appdata',
    browserGISLoadError: '',
    activeAuthCancel: null,
    authAttemptSerial: options.attempt || 9,
    sessionGeneration: options.session || 13,
    isCurrentAuthAttempt(attempt, session) {
      return attempt === context.authAttemptSerial && session === context.sessionGeneration;
    },
    isGoogleIdentityReady() { return true; },
    acceptAccessToken(payload, nonce) {
      if (!payload || payload.nonce !== nonce) throw new Error('nonce mismatch');
      accepted.push(payload);
    }
  };
  const code = section(
    '    function validateDirectGISOrigin() {',
    '    function requestFileBridgeGoogleToken(nonce, forceSelectAccount, attempt, sessionAtStart) {'
  );
  const api = vm.runInNewContext(
    code + '\n;({ validateDirectGISOrigin, requestBrowserGoogleToken })',
    context
  );
  return { api, context, calls, accepted, getTokenCallback: () => tokenCallback, getErrorCallback: () => errorCallback };
}

async function testDirectGISPromptAndClickCall() {
  const nonce = 'f'.repeat(48);
  const harness = createBrowserHarness();
  const pending = harness.api.requestBrowserGoogleToken(nonce, true, 9, 13);
  const requestCall = harness.calls.find(call => call.type === 'request');
  assert.ok(requestCall, 'GIS requestAccessToken must start synchronously in the game-button handler');
  assert.equal(requestCall.override.prompt, 'select_account');
  assert.equal(requestCall.override.state, nonce);
  await pending;
  assert.equal(harness.accepted.length, 1);
  assert.equal(harness.accepted[0].type, 'wayward-cloud-auth-success');
}

async function testDirectGISNormalPrompt() {
  const harness = createBrowserHarness({ autoResponse: false });
  const pending = harness.api.requestBrowserGoogleToken('1'.repeat(48), false, 9, 13);
  const call = harness.calls.find(item => item.type === 'request');
  assert.ok(call);
  assert.equal(call.override.prompt, '',
    'normal relogin should preserve GIS remembered-account behavior');
  harness.getTokenCallback()({
    access_token: 'browser-gis-access-token-123456',
    expires_in: 3600,
    scope: 'https://www.googleapis.com/auth/drive.appdata',
    state: call.override.state
  });
  await pending;
  assert.equal(harness.accepted.length, 1);
}

async function testDirectGISRejectsMissingState() {
  const harness = createBrowserHarness({ autoResponse: false });
  const nonce = '5'.repeat(48);
  const pending = harness.api.requestBrowserGoogleToken(nonce, false, 9, 13);
  harness.getTokenCallback()({
    access_token: 'browser-gis-access-token-123456',
    expires_in: 3600,
    scope: 'https://www.googleapis.com/auth/drive.appdata'
  });
  await assert.rejects(pending, /state가 없거나 일치하지 않습니다/);
  assert.equal(harness.accepted.length, 0, 'GIS token without matching state must not be applied');
}

async function testDirectGISPopupFailureAndStaleState() {
  const blocked = createBrowserHarness({ autoResponse: false });
  const blockedPromise = blocked.api.requestBrowserGoogleToken('2'.repeat(48), false, 9, 13);
  blocked.getErrorCallback()({ type: 'popup_failed_to_open' });
  await assert.rejects(blockedPromise, /팝업이 차단/);
  assert.equal(blocked.accepted.length, 0);

  const stale = createBrowserHarness({ autoResponse: false });
  const stalePromise = stale.api.requestBrowserGoogleToken('3'.repeat(48), false, 9, 13);
  stale.context.authAttemptSerial += 1;
  stale.getTokenCallback()({
    access_token: 'browser-gis-access-token-123456',
    expires_in: 3600,
    scope: 'https://www.googleapis.com/auth/drive.appdata',
    state: '3'.repeat(48)
  });
  await assert.rejects(stalePromise, /이전 Google 인증 응답/);
  assert.equal(stale.accepted.length, 0);
}

function testDirectGISOriginRules() {
  const https = createBrowserHarness();
  assert.equal(https.api.validateDirectGISOrigin(), 'https://wayward-six.vercel.app');
  const localhost = createBrowserHarness({ protocol: 'http:', origin: 'http://127.0.0.1:8765' });
  assert.equal(localhost.api.validateDirectGISOrigin(), 'http://127.0.0.1:8765');
  const remoteHttp = createBrowserHarness({ protocol: 'http:', origin: 'http://192.168.0.20:8000' });
  assert.throws(() => remoteHttp.api.validateDirectGISOrigin(), /HTTPS가 필요합니다/);
  const file = createBrowserHarness({ protocol: 'file:', origin: 'null' });
  assert.throws(() => file.api.validateDirectGISOrigin(), /사용할 수 없는 게임 Origin/);
}

function testAdapterDispatchDoesNotCrossFallback() {
  const dispatch = section(
    '    function requestGoogleToken(forceSelectAccount, attempt) {',
    '    function attemptNativeSessionRestore() {'
  );
  const calls = [];
  const context = {
    AUTH_ADAPTER: 'android-native',
    sessionGeneration: 17,
    createAuthNonce: () => '4'.repeat(48),
    requestNativeGoogleToken: (...args) => { calls.push(['native', ...args]); return 'native-task'; },
    requestBrowserGoogleToken: (...args) => { calls.push(['browser', ...args]); return 'browser-task'; },
    requestFileBridgeGoogleToken: (...args) => { calls.push(['file', ...args]); return 'file-task'; }
  };
  const route = vm.runInNewContext(dispatch + '\n;requestGoogleToken', context);
  assert.equal(route(true, 23), 'native-task');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'native');
  context.AUTH_ADAPTER = 'browser-gis';
  assert.equal(route(false, 24), 'browser-task');
  assert.equal(calls[1][0], 'browser');
  context.AUTH_ADAPTER = 'file-token-bridge';
  assert.equal(route(false, 25), 'file-task');
  assert.equal(calls[2][0], 'file');
}

function testFileBridgeIsIsolatedAndOriginChecked() {
  const fileSource = section(
    '    function requestFileBridgeGoogleToken(nonce, forceSelectAccount, attempt, sessionAtStart) {',
    '    function requestGoogleToken(forceSelectAccount, attempt) {'
  );
  assert.match(fileSource, /window\.open\(bridgeUrl\.toString\(/);
  assert.match(fileSource, /event\.origin !== AUTH_BRIDGE_ORIGIN/);
  assert.match(fileSource, /event\.source !== bridge/);
  assert.match(fileSource, /payload\.nonce !== nonce/);
  assert.match(fileSource, /protocol !== 'file:' && origin !== 'null'/);
  const browserSource = section(
    '    function requestBrowserGoogleToken(nonce, forceSelectAccount, attempt, sessionAtStart) {',
    '    function requestFileBridgeGoogleToken(nonce, forceSelectAccount, attempt, sessionAtStart) {'
  );
  assert.doesNotMatch(browserSource, /window\.open|AUTH_BRIDGE_URL|postMessage/);
}

async function main() {
  await testLegacyAndroidRelogin();
  await testModernAndroidPolicy();
  await testAndroidStaleResponseRejected();
  await testAndroidCancelIsNonceScoped();
  await testBrokenNativeBridgeDoesNotFallback();
  await testDirectGISPromptAndClickCall();
  await testDirectGISNormalPrompt();
  await testDirectGISRejectsMissingState();
  await testDirectGISPopupFailureAndStaleState();
  testDirectGISOriginRules();
  testAdapterDispatchDoesNotCrossFallback();
  testFileBridgeIsIsolatedAndOriginChecked();
  console.log('CloudSave auth UX tests passed: Android native relogin, direct GIS popup, file-only bridge and stale-response guards');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
