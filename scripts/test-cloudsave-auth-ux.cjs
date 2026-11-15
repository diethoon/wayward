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

async function testLegacyAndroidReauthAndForcedPickerFailsClosed() {
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
  await harness.requestNativeGoogleToken(nonce, false, 7, 11);
  assert.equal(calls[0][0], 'legacy-start',
    'legacy native API remains available for non-picker session restoration');
  assert.equal(calls[0][1], nonce);
  assert.equal(harness.accepted.length, 1);
  assert.equal(harness.accepted[0].nonce, nonce);
  assert.equal(calls.some(call => call[0] === 'take'), true);

  const beforeForcedAttempt = calls.filter(call => call[0] === 'legacy-start').length;
  const forced = makeNativeHarness(host);
  await assert.rejects(
    forced.requestNativeGoogleToken('a'.repeat(48).replace(/a/g, 'f'), true, 7, 11),
    /계정 선택 정책 API/
  );
  assert.equal(calls.filter(call => call[0] === 'legacy-start').length, beforeForcedAttempt,
    'legacy bridge must not silently ignore a required account-picker policy');
}

async function testAndroid061PolicyWithoutNativeCancel() {
  const nonce = 'b'.repeat(48);
  let selected = null;
  const host = {
    startGoogleDriveAuthWithPolicy(value, force) {
      selected = { nonce: value, force };
    },
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
    setTimeout(callback, delay) { context.timeoutCallback = callback; context.timeoutDelay = delay; return 41; },
    clearTimeout(id) { context.clearedTimer = id; },
    acceptAccessToken(payload, nonce) {
      if (!payload || payload.nonce !== nonce) throw new Error('nonce mismatch');
      accepted.push(payload);
    }
  };
  const code = section(
    '    function validateDirectGISOrigin() {',
    '    function requestUnsupportedFileGoogleToken() {'
  );
  const api = vm.runInNewContext(
    code + '\n;({ validateDirectGISOrigin, requestBrowserGoogleToken })',
    context
  );
  return { api, context, calls, accepted, getTokenCallback: () => tokenCallback, getErrorCallback: () => errorCallback };
}


function testConnectFromClickDispatchesAuthSynchronouslyAndHonorsPickerPolicy() {
  const code = section(
    '    function shouldForceSelectAccount() {',
    '    function requestBrowserTokenRevocation(token) {'
  );
  const scenarios = [
    { name: 'first connection', explicitLogout: false, hadPreviousAuth: false, expectedPicker: true },
    { name: 'remembered account', explicitLogout: false, hadPreviousAuth: true, expectedPicker: false },
    { name: 'after explicit logout', explicitLogout: true, hadPreviousAuth: false, expectedPicker: true }
  ];

  for (const scenario of scenarios) {
    const calls = [];
    const context = {
      explicitLogout: scenario.explicitLogout,
      hadPreviousAuth: scenario.hadPreviousAuth,
      busy: false,
      activeAuthCancel: null,
      authAttemptSerial: 40,
      authStartedAt: 0,
      authCompletedAt: 0,
      authStatus: 'reauth-required',
      message: '',
      requestGoogleToken(forceSelectAccount, attempt) {
        calls.push({ kind: 'auth-start', forceSelectAccount, attempt });
        // Keep the request pending so only synchronous click-handler work is observed.
        return new Promise(() => {});
      },
      render() { calls.push({ kind: 'render' }); }
    };
    const api = vm.runInNewContext(
      code + '\n;({ connectFromClick })',
      context
    );

    api.connectFromClick();

    assert.equal(calls[0] && calls[0].kind, 'auth-start',
      scenario.name + ': auth dispatch must be the first synchronous click-handler action');
    assert.equal(calls[0].forceSelectAccount, scenario.expectedPicker,
      scenario.name + ': account selection policy');
    assert.equal(calls[0].attempt, 41,
      scenario.name + ': a fresh attempt ID is used');
    assert.equal(calls[1] && calls[1].kind, 'render',
      scenario.name + ': UI rendering follows auth dispatch');
    assert.equal(context.busy, true,
      scenario.name + ': duplicate clicks are blocked while auth is pending');
  }
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

async function testDirectGISNoCallbackTimesOut() {
  const harness = createBrowserHarness({ autoResponse: false });
  const pending = harness.api.requestBrowserGoogleToken('7'.repeat(48), false, 9, 13);
  assert.equal(harness.context.timeoutDelay, 120000);
  assert.equal(typeof harness.context.timeoutCallback, 'function');
  harness.context.timeoutCallback();
  await assert.rejects(pending, /Google 인증 응답이 도착하지 않았습니다/);
  assert.equal(harness.context.clearedTimer, 41);
  assert.equal(harness.accepted.length, 0);
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

  const closed = createBrowserHarness({ autoResponse: false });
  const closedPromise = closed.api.requestBrowserGoogleToken('8'.repeat(48), false, 9, 13);
  closed.getErrorCallback()({ type: 'popup_closed' });
  await assert.rejects(closedPromise, /Google 인증 창이 닫혔습니다/);
  assert.equal(closed.accepted.length, 0, 'closing the GIS window must not accept a token');

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

function testAuthFunctionDeclarationsAreUnique() {
  const counts = new Map();
  for (const match of source.matchAll(/^\s*function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
    counts.set(match[1], (counts.get(match[1]) || 0) + 1);
  }
  for (const name of ['validateDirectGISOrigin', 'requestBrowserGoogleToken', 'requestUnsupportedFileGoogleToken']) {
    assert.equal(counts.get(name), 1, name + ' must have exactly one runtime declaration');
  }
}

function testNativeLauncherMarkerKeepsNativeAdapterEvenWithoutAuthMethods() {
  const adapterSource = section(
    '    const nativeAuthHost = window.WMLHost || null;',
    '    let browserGISLoadPromise = null;'
  );
  function select(host, protocol = 'https:', origin = 'https://wayward-six.vercel.app') {
    return vm.runInNewContext(adapterSource + '\n;({ AUTH_ADAPTER, nativeLauncherContext })', {
      window: { WMLHost: host, location: { protocol, origin } }
    });
  }
  assert.equal(select({}).AUTH_ADAPTER, 'android-native',
    'an embedded launcher with a missing auth surface must not become browser GIS');
  assert.equal(select({ startGoogleDriveAuth() {} }).AUTH_ADAPTER, 'android-native');
  assert.equal(select(undefined).AUTH_ADAPTER, 'browser-gis');
  assert.equal(select(undefined, 'file:', 'null').AUTH_ADAPTER, 'file-unsupported');
}

function testFirstConnectionAndExplicitLogoutRequirePicker() {
  const helper = section(
    '    function shouldForceSelectAccount() {',
    '    function connectFromClick() {'
  );
  function shouldForce(explicitLogout, hadPreviousAuth) {
    return vm.runInNewContext(helper + '\n;shouldForceSelectAccount()', {
      explicitLogout, hadPreviousAuth
    });
  }
  assert.equal(shouldForce(false, false), true, 'first connection must request account selection');
  assert.equal(shouldForce(true, true), true, 'explicit logout must request account selection');
  assert.equal(shouldForce(false, true), false, 'normal remembered-session auth keeps normal prompt');
}

function testExplicitLogoutClearsPreviousAuthRestoreMarker() {
  const logoutSource = section(
    '    function markExplicitLogout(revoked) {',
    '    function markPermissionRevoked() {'
  );
  const writes = [];
  const context = {
    explicitLogout: false,
    permissionRevoked: false,
    hadPreviousAuth: true,
    HAD_AUTH_KEY: 'wml-google-drive-had-auth-v1',
    writeStorage(key, value) { writes.push([key, value]); return false; },
    saveAuthPreferences() {}
  };
  vm.runInNewContext(logoutSource + '\n;markExplicitLogout', context)(false);
  assert.equal(context.explicitLogout, true);
  assert.equal(context.permissionRevoked, false);
  assert.equal(context.hadPreviousAuth, false,
    'explicit logout must disable native restore even if persistent marker storage fails');
  assert.ok(writes.some(([key, value]) =>
    key === 'wml-google-drive-had-auth-v1' && value === null));
}

function testExplicitLogoutSuppressesStartupRestoreAndSlotRefresh() {
  const restoreSource = section(
    '    function attemptNativeSessionRestore() {',
    '    async function ensureAccessToken() {'
  );
  const openSource = section(
    '    function open() {',
    '    function addText(root, text, cls) {'
  );
  let opened = 0;
  let refreshed = 0;
  const context = {
    startupRestoreAttempted: false,
    explicitLogout: true,
    hadPreviousAuth: true,
    hasToken: () => false,
    AUTH_ADAPTER: 'android-native',
    nativeAuthHost: {},
    view: { page: 'home' },
    message: '',
    isConnected: () => false,
    openWindow: () => { opened += 1; },
    hasLogin: () => false,
    slotsStatus: 'not-loaded',
    runAction: () => { refreshed += 1; },
    refreshSlots: () => Promise.resolve([]),
    render: () => {},
    Date, Promise, Error, String
  };
  vm.runInNewContext(restoreSource + '\n' + openSource + '\n;open()', context);
  assert.equal(opened, 1);
  assert.equal(refreshed, 0, 'explicit logout must not auto-fetch the Drive slot list');
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
    requestUnsupportedFileGoogleToken: (...args) => { calls.push(['file-unavailable', ...args]); return 'file-unavailable-task'; }
  };
  const route = vm.runInNewContext(dispatch + '\n;requestGoogleToken', context);
  assert.equal(route(true, 23), 'native-task');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'native');
  context.AUTH_ADAPTER = 'browser-gis';
  assert.equal(route(false, 24), 'browser-task');
  assert.equal(calls[1][0], 'browser');
  context.AUTH_ADAPTER = 'file-unsupported';
  assert.equal(route(false, 25), 'file-unavailable-task');
  assert.equal(calls[2][0], 'file-unavailable');
}

async function testFileOriginFailsClosedWithoutExternalAuthDependency() {
  const fileSource = section(
    '    function requestUnsupportedFileGoogleToken() {',
    '    function requestGoogleToken(forceSelectAccount, attempt) {'
  );
  assert.match(fileSource, /file:\/\//);
  assert.match(fileSource, /PC 런처/);
  assert.match(fileSource, /외부 인증 페이지에 의존하지 않으므로/);
  assert.doesNotMatch(fileSource, /window\.open|postMessage|fetch\(|AUTH_BRIDGE_URL|127\.0\.0\.1/);

  const unsupported = vm.runInNewContext(
    fileSource + '\n;requestUnsupportedFileGoogleToken',
    { Promise, Error }
  );
  await assert.rejects(unsupported(), /PC file:\/\//);

  assert.doesNotMatch(source, /AUTH_BRIDGE_URL|AUTH_BRIDGE_ORIGIN|auth-061\.html/);
  const browserSource = section(
    '    function requestBrowserGoogleToken(nonce, forceSelectAccount, attempt, sessionAtStart) {',
    '    function requestUnsupportedFileGoogleToken() {'
  );
  assert.doesNotMatch(browserSource, /window\.open|AUTH_BRIDGE|postMessage/);
}
async function main() {
  testConnectFromClickDispatchesAuthSynchronouslyAndHonorsPickerPolicy();
  testAuthFunctionDeclarationsAreUnique();
  testNativeLauncherMarkerKeepsNativeAdapterEvenWithoutAuthMethods();
  testFirstConnectionAndExplicitLogoutRequirePicker();
  testExplicitLogoutClearsPreviousAuthRestoreMarker();
  testExplicitLogoutSuppressesStartupRestoreAndSlotRefresh();
  await testLegacyAndroidReauthAndForcedPickerFailsClosed();
  await testAndroid061PolicyWithoutNativeCancel();
  await testAndroidStaleResponseRejected();
  await testAndroidCancelIsNonceScoped();
  await testBrokenNativeBridgeDoesNotFallback();
  await testDirectGISPromptAndClickCall();
  await testDirectGISNormalPrompt();
  await testDirectGISNoCallbackTimesOut();
  await testDirectGISRejectsMissingState();
  await testDirectGISPopupFailureAndStaleState();
  testDirectGISOriginRules();
  testAdapterDispatchDoesNotCrossFallback();
  await testFileOriginFailsClosedWithoutExternalAuthDependency();
  console.log('CloudSave auth UX tests passed: Android native relogin, direct GIS popup, standalone file:// fail-closed routing and stale-response guards');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
