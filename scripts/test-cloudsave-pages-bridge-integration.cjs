'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { MessageChannel } = require('node:worker_threads');
const { webcrypto } = require('node:crypto');

const sourcePath = path.join(__dirname, '..', 'pages-cloudsave-auth', 'cloud', 'file-auth.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const gameSource = fs.readFileSync(path.join(__dirname, '..', 'cloud-save', 'mod.js'), 'utf8');
const APP_ID = 'wayward-cloudsave';
const VERSION = 4;
const ID = 'a'.repeat(48);
const ID2 = 'b'.repeat(48);
const ID3 = 'c'.repeat(48);
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function createElement(id) {
  const listeners = new Map();
  const classes = new Set();
  return {
    id, textContent: '', hidden: id === 'auth-panel', checked: false, disabled: false,
    classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }, contains(name) { return classes.has(name); } },
    addEventListener(name, callback) { const list = listeners.get(name) || []; list.push(callback); listeners.set(name, list); },
    dispatch(name, event = {}) { for (const callback of [...(listeners.get(name) || [])]) callback(event); },
    listenerCount(name) { return (listeners.get(name) || []).length; }
  };
}

function createPage(options = {}) {
  const ids = ['connection-title','connection-status','auth-panel','request-description','confirm-request','auth-status','connect','cancel'];
  const elements = Object.fromEntries(ids.map(id => [id, createElement(id)]));
  const windowListeners = new Map();
  const scheduled = new Map();
  let nextTimer = 1;
  let tokenConfig = null;
  let requestOverride = null;
  let tokenClientCount = 0;
  let gisRequestCount = 0;
  let gisErrorCallback = null;
  let gisCallback = null;
  let closedWindow = false;
  const opener = options.opener || { closed: false, tag: 'expected-opener' };

  function setTimeoutTracked(callback, ms) {
    const id = nextTimer++;
    if (ms >= 10000) scheduled.set(id, { callback, ms, cleared: false });
    else scheduled.set(id, { handle: setTimeout(callback, ms), ms, cleared: false });
    return id;
  }
  function clearTimeoutTracked(id) {
    const entry = scheduled.get(id);
    if (!entry) return;
    entry.cleared = true;
    if (entry.handle) clearTimeout(entry.handle);
  }
  function fireLongTimer(ms) {
    const item = [...scheduled.entries()].find(([, value]) => value.ms === ms && !value.cleared);
    assert.ok(item, 'expected pending timer for ' + ms + 'ms');
    item[1].cleared = true;
    item[1].callback();
  }
  const oauth = {
    initTokenClient(config) {
      tokenClientCount += 1;
      tokenConfig = config;
      gisCallback = config.callback;
      gisErrorCallback = config.error_callback;
      return {
        requestAccessToken(override) {
          gisRequestCount += 1;
          requestOverride = override;
        }
      };
    },
    hasGrantedAllScopes(response, scope) {
      return String(response && response.scope || '').split(/\s+/).includes(scope);
    }
  };
  const window = {
    opener,
    closed: false,
    WAYWARD_GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com',
    google: { accounts: { oauth2: oauth } },
    addEventListener(name, callback) { const list = windowListeners.get(name) || []; list.push(callback); windowListeners.set(name, list); },
    dispatch(name, event = {}) { for (const callback of [...(windowListeners.get(name) || [])]) callback(event); },
    setTimeout: setTimeoutTracked,
    clearTimeout: clearTimeoutTracked,
    setInterval(callback, ms) { return setInterval(callback, ms); },
    clearInterval(id) { clearInterval(id); },
    close() { closedWindow = true; window.closed = true; }
  };
  const navigator = { userActivation: { isActive: true } };
  const context = {
    window, navigator, document: { getElementById(id) { return elements[id]; } },
    google: window.google, crypto: webcrypto, Uint8Array, Date, Promise, Error, String,
    Object, Array, Set, Map, Number, Math, RegExp,
    setTimeout: setTimeoutTracked, clearTimeout: clearTimeoutTracked,
    setInterval, clearInterval, console: { log() {}, warn() {}, error() {} }
  };
  vm.runInNewContext(source, context, { filename: sourcePath, timeout: 3000 });

  return {
    window, opener, elements, scheduled,
    tokenClientCount: () => tokenClientCount,
    gisRequestCount: () => gisRequestCount,
    getRequestOverride: () => requestOverride,
    getTokenConfig: () => tokenConfig,
    tokenResponse: value => gisCallback && gisCallback(value),
    gisError: value => gisErrorCallback && gisErrorCallback(value),
    fireLongTimer,
    closeWindow: () => closedWindow,
    initEvent({ origin = 'null', source: eventSource = opener, data = {}, port }) {
      window.dispatch('message', { origin, source: eventSource, data, ports: port ? [port] : [] });
    },
    clickConnect() {
      elements['confirm-request'].checked = true;
      elements['confirm-request'].dispatch('change');
      elements.connect.dispatch('click');
    },
    pagehide() { window.dispatch('pagehide'); }
  };
}

function initData(overrides = {}) {
  return {
    type: 'wayward-cloud-auth-init', version: VERSION, appId: APP_ID, action: 'login',
    nonce: ID, requestId: ID2, attemptId: ID3, forceSelectAccount: true, ...overrides
  };
}
function envelope(sessionId, overrides = {}) {
  return { version: VERSION, appId: APP_ID, nonce: ID, requestId: ID2, attemptId: ID3, sessionId, ...overrides };
}
function listen(port) {
  const messages = [];
  const waiters = [];
  port.on('message', data => {
    messages.push(data);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (!waiters[i].predicate || waiters[i].predicate(data)) {
        const waiter = waiters.splice(i, 1)[0];
        clearTimeout(waiter.timer);
        waiter.resolve(data);
      }
    }
  });
  port.start();
  return {
    messages,
    waitFor(predicate, timeout = 1000) {
      const existing = messages.find(item => !predicate || predicate(item));
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, timer: setTimeout(() => reject(new Error('Message timeout')), timeout) };
        waiters.push(waiter);
      });
    }
  };
}
function channel() {
  const item = new MessageChannel();
  return { game: item.port1, page: item.port2 };
}
function pass(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log('PASS ' + name),
    error => { console.error('FAIL ' + name + ': ' + (error.stack || error)); process.exitCode = 1; }
  );
}

(async () => {
  const tasks = [];
  tasks.push(pass('null Origin + exact opener accepted', async () => {
    const page = createPage(); const pair = channel(); const game = listen(pair.game);
    page.initEvent({ data: initData(), port: pair.page });
    const ready = await game.waitFor(x => x.type === 'wayward-cloud-auth-ready');
    assert.equal(ready.appId, APP_ID); assert.equal(ready.nonce, ID); assert.match(ready.sessionId, /^[a-f0-9]{48}$/);
    pair.game.close();
  }));
  tasks.push(pass('ordinary HTTPS Origin rejected before GIS', async () => {
    const page = createPage(); const pair = channel(); const game = listen(pair.game);
    page.initEvent({ origin: 'https://game.example', data: initData(), port: pair.page });
    await delay(30);
    assert.equal(game.messages.length, 0); assert.equal(page.tokenClientCount(), 0); assert.equal(page.gisRequestCount(), 0);
    pair.game.close();
  }));
  tasks.push(pass('unexpected non-opaque Origin rejected before GIS', async () => {
    const page = createPage(); const pair = channel(); const game = listen(pair.game);
    page.initEvent({ origin: 'https://attacker.invalid', data: initData(), port: pair.page });
    await delay(30); assert.equal(game.messages.length, 0); assert.equal(page.gisRequestCount(), 0); pair.game.close();
  }));
  tasks.push(pass('non-opener WindowProxy rejected', async () => {
    const page = createPage(); const pair = channel(); const game = listen(pair.game);
    page.initEvent({ origin: 'null', source: { tag: 'attacker' }, data: initData(), port: pair.page });
    await delay(30); assert.equal(game.messages.length, 0); assert.equal(page.gisRequestCount(), 0); pair.game.close();
  }));
  for (const key of ['nonce','requestId','attemptId']) {
    tasks.push(pass('malformed ' + key + ' rejected', async () => {
      const page = createPage(); const pair = channel(); const game = listen(pair.game);
      page.initEvent({ data: initData({ [key]: 'bad-id' }), port: pair.page });
      await delay(30); assert.equal(game.messages.length, 0); assert.equal(page.tokenClientCount(), 0); pair.game.close();
    }));
  }
  tasks.push(pass('appId mismatch rejected at init', async () => {
    const page = createPage(); const pair = channel(); const game = listen(pair.game);
    page.initEvent({ data: initData({ appId: 'other-app' }), port: pair.page });
    await delay(30); assert.equal(game.messages.length, 0); pair.game.close();
  }));
  tasks.push(pass('retransmitted init from a different request or attempt is rejected', async () => {
    for (const key of ['requestId','attemptId']) {
      const page = createPage(); const first = channel(); const firstGame = listen(first.game);
      page.initEvent({ data: initData(), port: first.page });
      const ready = await firstGame.waitFor(x => x.type === 'wayward-cloud-auth-ready');
      const duplicate = channel(); const duplicateGame = listen(duplicate.game);
      page.initEvent({ data: initData({ [key]: 'f'.repeat(48) }), port: duplicate.page });
      await delay(30);
      assert.equal(duplicateGame.messages.length, 0, key + ' mismatch must not receive ready');
      assert.equal(ready.sessionId.length, 48);
      first.game.close(); duplicate.game.close();
    }
  }));
  tasks.push(pass('nonce/requestId/attemptId/sessionId/appId mismatch rejected at activate', async () => {
    for (const key of ['nonce','requestId','attemptId','sessionId','appId']) {
      const page = createPage(); const pair = channel(); const game = listen(pair.game);
      page.initEvent({ data: initData(), port: pair.page });
      const ready = await game.waitFor(x => x.type === 'wayward-cloud-auth-ready');
      pair.game.postMessage({ type: 'wayward-cloud-auth-activate', ...envelope(ready.sessionId, { [key]: key === 'appId' ? 'not-wayward' : 'f'.repeat(48) }) });
      await delay(30);
      assert.equal(game.messages.some(x => x.type === 'wayward-cloud-auth-active'), false, key + ' mismatch must not activate');
      pair.game.close();
    }
  }));
  tasks.push(pass('delayed ready over 300ms + retransmitted port handoff', async () => {
    const page = createPage(); const first = channel();
    page.initEvent({ data: initData(), port: first.page });
    await delay(350);
    first.game.close();
    const second = channel(); const game = listen(second.game);
    page.initEvent({ data: initData(), port: second.page });
    const ready = await game.waitFor(x => x.type === 'wayward-cloud-auth-ready');
    second.game.postMessage({ type: 'wayward-cloud-auth-activate', ...envelope(ready.sessionId) });
    const active = await game.waitFor(x => x.type === 'wayward-cloud-auth-active');
    assert.equal(active.sessionId, ready.sessionId); second.game.close();
  }));
  tasks.push(pass('duplicate init keeps candidate ports until one activates', async () => {
    const page = createPage(); const first = channel(); const firstGame = listen(first.game);
    page.initEvent({ data: initData(), port: first.page });
    const ready1 = await firstGame.waitFor(x => x.type === 'wayward-cloud-auth-ready');
    const second = channel(); const secondGame = listen(second.game);
    page.initEvent({ data: initData(), port: second.page });
    const ready2 = await secondGame.waitFor(x => x.type === 'wayward-cloud-auth-ready');
    assert.equal(ready1.sessionId, ready2.sessionId, 'same attempt shares exactly one page session');
    second.game.postMessage({ type: 'wayward-cloud-auth-activate', ...envelope(ready2.sessionId) });
    await secondGame.waitFor(x => x.type === 'wayward-cloud-auth-active');
    first.game.close(); second.game.close();
  }));
  tasks.push(pass('GIS OAuth state mismatch rejected', async () => {
    const page = createPage(); const pair = channel(); const game = listen(pair.game);
    page.initEvent({ data: initData(), port: pair.page }); const ready = await game.waitFor(x => x.type === 'wayward-cloud-auth-ready');
    pair.game.postMessage({ type: 'wayward-cloud-auth-activate', ...envelope(ready.sessionId) });
    await game.waitFor(x => x.type === 'wayward-cloud-auth-active'); await delay(20); page.clickConnect();
    assert.equal(page.gisRequestCount(), 1);
    page.tokenResponse({ access_token: 'mock-token-not-real', expires_in: 3600, scope: SCOPE, state: 'wrong-state' });
    const error = await game.waitFor(x => x.type === 'wayward-cloud-auth-error');
    assert.equal(error.code, 'state-mismatch'); assert.equal(game.messages.some(x => x.type === 'wayward-cloud-auth-success'), false); pair.game.close();
  }));
  tasks.push(pass('Drive appData scope omission rejected', async () => {
    const page = createPage(); const pair = channel(); const game = listen(pair.game);
    page.initEvent({ data: initData(), port: pair.page }); const ready = await game.waitFor(x => x.type === 'wayward-cloud-auth-ready');
    pair.game.postMessage({ type: 'wayward-cloud-auth-activate', ...envelope(ready.sessionId) }); await game.waitFor(x => x.type === 'wayward-cloud-auth-active'); await delay(20); page.clickConnect();
    page.tokenResponse({ access_token: 'mock-token-not-real', expires_in: 3600, scope: 'openid email', state: page.getRequestOverride().state });
    const error = await game.waitFor(x => x.type === 'wayward-cloud-auth-error'); assert.equal(error.code, 'scope_missing'); pair.game.close();
  }));
  tasks.push(pass('GIS user cancellation and popup error propagated', async () => {
    for (const reason of ['popup_closed','popup_failed_to_open']) {
      const page = createPage(); const pair = channel(); const game = listen(pair.game);
      page.initEvent({ data: initData(), port: pair.page }); const ready = await game.waitFor(x => x.type === 'wayward-cloud-auth-ready');
      pair.game.postMessage({ type: 'wayward-cloud-auth-activate', ...envelope(ready.sessionId) }); await game.waitFor(x => x.type === 'wayward-cloud-auth-active'); await delay(20); page.clickConnect();
      page.gisError({ type: reason }); const error = await game.waitFor(x => x.type === 'wayward-cloud-auth-error'); assert.equal(error.code, reason); pair.game.close();
    }
  }));
  tasks.push(pass('normal token success is one-shot and ACK completes', async () => {
    const page = createPage(); const pair = channel(); const game = listen(pair.game);
    page.initEvent({ data: initData(), port: pair.page }); const ready = await game.waitFor(x => x.type === 'wayward-cloud-auth-ready');
    pair.game.postMessage({ type: 'wayward-cloud-auth-activate', ...envelope(ready.sessionId) }); await game.waitFor(x => x.type === 'wayward-cloud-auth-active'); await delay(20); page.clickConnect();
    const state = page.getRequestOverride().state;
    const response = { access_token: 'mock-token-not-real', expires_in: 3600, scope: SCOPE, state };
    page.tokenResponse(response); page.tokenResponse(response);
    const success = await game.waitFor(x => x.type === 'wayward-cloud-auth-success');
    assert.equal(success.accessToken, 'mock-token-not-real'); assert.equal(game.messages.filter(x => x.type === 'wayward-cloud-auth-success').length, 1);
    await delay(100);
    pair.game.postMessage({ type: 'wayward-cloud-auth-ack', ...envelope(ready.sessionId), accepted: true });
    const ack = await game.waitFor(x => x.type === 'wayward-cloud-auth-ack-received'); assert.equal(ack.accepted, true);
    pair.game.close();
  }));
  tasks.push(pass('lost ACK fails closed without repeating the token', async () => {
    const page = createPage(); const pair = channel(); const game = listen(pair.game);
    page.initEvent({ data: initData(), port: pair.page });
    const ready = await game.waitFor(x => x.type === 'wayward-cloud-auth-ready');
    pair.game.postMessage({ type: 'wayward-cloud-auth-activate', ...envelope(ready.sessionId) });
    await game.waitFor(x => x.type === 'wayward-cloud-auth-active');
    await delay(20); page.clickConnect();
    page.tokenResponse({ access_token: 'mock-token-not-real', expires_in: 3600, scope: SCOPE, state: page.getRequestOverride().state });
    await game.waitFor(x => x.type === 'wayward-cloud-auth-success');
    page.fireLongTimer(15000);
    await delay(30);
    assert.equal(game.messages.filter(x => x.type === 'wayward-cloud-auth-success').length, 1);
    assert.equal(game.messages.some(x => x.type === 'wayward-cloud-auth-ack-received'), false,
      'missing ACK must not manufacture ack-received');
    assert.equal(page.closeWindow(), false, 'finishPage reports through the page state and deferred close');
    pair.game.close();
  }));
  tasks.push(pass('ACK can be delayed without duplicate success', async () => {
    const page = createPage(); const pair = channel(); const game = listen(pair.game);
    page.initEvent({ data: initData(), port: pair.page }); const ready = await game.waitFor(x => x.type === 'wayward-cloud-auth-ready');
    pair.game.postMessage({ type: 'wayward-cloud-auth-activate', ...envelope(ready.sessionId) }); await game.waitFor(x => x.type === 'wayward-cloud-auth-active'); await delay(20); page.clickConnect();
    page.tokenResponse({ access_token: 'mock-token-not-real', expires_in: 3600, scope: SCOPE, state: page.getRequestOverride().state });
    await game.waitFor(x => x.type === 'wayward-cloud-auth-success'); await delay(250);
    assert.equal(game.messages.filter(x => x.type === 'wayward-cloud-auth-success').length, 1);
    pair.game.postMessage({ type: 'wayward-cloud-auth-ack', ...envelope(ready.sessionId), accepted: true });
    await game.waitFor(x => x.type === 'wayward-cloud-auth-ack-received'); pair.game.close();
  }));
  tasks.push(pass('auth timeout fails closed', async () => {
    const page = createPage(); const pair = channel(); const game = listen(pair.game);
    page.initEvent({ data: initData(), port: pair.page }); const ready = await game.waitFor(x => x.type === 'wayward-cloud-auth-ready');
    pair.game.postMessage({ type: 'wayward-cloud-auth-activate', ...envelope(ready.sessionId) }); await game.waitFor(x => x.type === 'wayward-cloud-auth-active'); await delay(20); page.clickConnect();
    page.fireLongTimer(120000); const error = await game.waitFor(x => x.type === 'wayward-cloud-auth-error'); assert.equal(error.code, 'auth-timeout'); pair.game.close();
  }));
  tasks.push(pass('pagehide/reload notifies original game via MessagePort', async () => {
    const page = createPage(); const pair = channel(); const game = listen(pair.game);
    page.initEvent({ data: initData(), port: pair.page }); const ready = await game.waitFor(x => x.type === 'wayward-cloud-auth-ready');
    pair.game.postMessage({ type: 'wayward-cloud-auth-activate', ...envelope(ready.sessionId) }); await game.waitFor(x => x.type === 'wayward-cloud-auth-active');
    page.pagehide(); const error = await game.waitFor(x => x.type === 'wayward-cloud-auth-error'); assert.equal(error.code, 'auth-page-unloaded'); pair.game.close();
  }));
  tasks.push(pass('game retains candidate MessagePorts and activates only the port that produced ready', async () => {
    const start = gameSource.indexOf('    function requestFileBridgeGoogleToken(nonce, forceSelectAccount, attempt, sessionAtStart) {');
    const end = gameSource.indexOf('    function requestGoogleToken(forceSelectAccount, attempt) {', start);
    assert.ok(start >= 0 && end > start, 'actual game-side file bridge helper is present');
    const helper = gameSource.slice(start, end);
    const pageChannels = [];
    const accepted = [];
    const sent = [];
    let transferCount = 0;
    let selectedChannel = 0;
    const popup = {
      closed: false,
      close() { this.closed = true; },
      postMessage(data, targetOrigin, ports) {
        assert.equal(targetOrigin, 'https://jeiky224.github.io');
        assert.equal(data.type, 'wayward-cloud-auth-init');
        const index = ++transferCount;
        const pagePort = ports[0];
        const candidate = { index, pagePort, pageClosed: false };
        pageChannels.push(candidate);
        pagePort.onmessage = event => {
          const message = event.data; sent.push({ index, message });
          if (message.type === 'wayward-cloud-auth-activate') {
            selectedChannel = index;
            for (const other of pageChannels) {
              if (other.index !== index && !other.pageClosed) { other.pageClosed = true; other.pagePort.close(); }
            }
            pagePort.postMessage({ type: 'wayward-cloud-auth-active', version: data.version, appId: data.appId, nonce: data.nonce, requestId: data.requestId, attemptId: data.attemptId, sessionId: SESSION });
            setTimeout(() => {
              if (candidate.pageClosed) return;
              pagePort.postMessage({ type: 'wayward-cloud-auth-success', version: data.version, appId: data.appId, nonce: data.nonce, requestId: data.requestId, attemptId: data.attemptId, sessionId: SESSION, accessToken: 'race-test-access-token-123456', expiresIn: 3600 });
            }, 5);
            setTimeout(() => {
              if (candidate.pageClosed) return;
              pagePort.postMessage({ type: 'wayward-cloud-auth-success', version: data.version, appId: data.appId, nonce: data.nonce, requestId: data.requestId, attemptId: data.attemptId, sessionId: SESSION, accessToken: 'duplicate-race-token-123456789', expiresIn: 3600 });
            }, 10);
          }
          if (message.type === 'wayward-cloud-auth-ack' && message.accepted === true) {
            pagePort.postMessage({ type: 'wayward-cloud-auth-ack-received', version: data.version, appId: data.appId, nonce: data.nonce, requestId: data.requestId, attemptId: data.attemptId, sessionId: SESSION, accepted: true });
          }
        };
        pagePort.start();
        const readyDelay = index === 1 ? 450 : 20;
        setTimeout(() => {
          if (!candidate.pageClosed) pagePort.postMessage({ type: 'wayward-cloud-auth-ready', version: data.version, appId: data.appId, nonce: data.nonce, requestId: data.requestId, attemptId: data.attemptId, sessionId: SESSION });
        }, readyDelay);
      }
    };
    const SESSION = 'd'.repeat(48);
    let sessionGeneration = 31;
    const context = {
      AUTH_ADAPTER: 'file-bridge', FILE_AUTH_BRIDGE_VERSION: 4,
      FILE_AUTH_BRIDGE_URL: 'https://jeiky224.github.io/cloud/file-auth.html',
      FILE_AUTH_BRIDGE_ORIGIN: 'https://jeiky224.github.io',
      activeAuthCancel: null, authAttemptSerial: 27, sessionGeneration,
      MessageChannel, Promise, Error, String, Date, setTimeout, clearTimeout, setInterval, clearInterval,
      createAuthNonce: (() => { let n = 0; return () => (++n).toString(16).padStart(48, '0'); })(),
      window: { open() { return popup; } },
      acceptAccessToken(payload, nonce) { assert.equal(payload.nonce, nonce); accepted.push(payload); sessionGeneration += 1; context.sessionGeneration = sessionGeneration; }
    };
    const request = vm.runInNewContext(helper + '\n;requestFileBridgeGoogleToken', context);
    await request('e'.repeat(48), true, 27, 31);
    assert.ok(transferCount >= 2, 'first ready delayed over 300ms must cause init retransmission');
    assert.equal(selectedChannel, 2, 'the later candidate whose ready arrived first owns activate and success');
    assert.equal(accepted.length, 1, 'duplicate token response is accepted only once');
    assert.equal(sent.filter(item => item.message.type === 'wayward-cloud-auth-activate').length, 1);
    assert.equal(sent.filter(item => item.message.type === 'wayward-cloud-auth-ack' && item.message.accepted).length, 1);
    for (const candidate of pageChannels) { if (!candidate.pageClosed) { candidate.pageClosed = true; candidate.pagePort.close(); } }
  }));
  tasks.push(pass('popup closure terminates the in-flight game request', async () => {
    const start = gameSource.indexOf('    function requestFileBridgeGoogleToken(nonce, forceSelectAccount, attempt, sessionAtStart) {');
    const end = gameSource.indexOf('    function requestGoogleToken(forceSelectAccount, attempt) {', start);
    const helper = gameSource.slice(start, end);
    const popup = { closed: false, close() { this.closed = true; }, postMessage() {} };
    const context = {
      AUTH_ADAPTER: 'file-bridge', FILE_AUTH_BRIDGE_VERSION: 4,
      FILE_AUTH_BRIDGE_URL: 'https://jeiky224.github.io/cloud/file-auth.html',
      FILE_AUTH_BRIDGE_ORIGIN: 'https://jeiky224.github.io',
      activeAuthCancel: null, authAttemptSerial: 27, sessionGeneration: 31,
      MessageChannel, Promise, Error, String, Date, setTimeout, clearTimeout, setInterval, clearInterval,
      createAuthNonce: () => ID,
      window: { open() { return popup; } },
      acceptAccessToken() { throw new Error('closed popup must not accept a token'); }
    };
    const request = vm.runInNewContext(helper + '\n;requestFileBridgeGoogleToken', context);
    const pending = request(ID, false, 27, 31);
    setTimeout(() => { popup.closed = true; }, 30);
    await assert.rejects(pending, /CloudSave 인증 창이 비정상적으로 종료되었습니다/);
  }));

  tasks.push(pass('opener closure is detected', async () => {
    const page = createPage(); const pair = channel(); const game = listen(pair.game);
    page.initEvent({ data: initData(), port: pair.page }); const ready = await game.waitFor(x => x.type === 'wayward-cloud-auth-ready');
    pair.game.postMessage({ type: 'wayward-cloud-auth-activate', ...envelope(ready.sessionId) }); await game.waitFor(x => x.type === 'wayward-cloud-auth-active');
    page.opener.closed = true; await delay(550); assert.match(page.elements['auth-status'].textContent, /게임 창이 닫혀/); pair.game.close();
  }));

  await Promise.all(tasks);
  process.exit(process.exitCode ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
