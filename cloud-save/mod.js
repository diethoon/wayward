/* Personal Google Drive-backed cloud saves for WML.
 * Google OAuth and every Drive API request run only inside the fixed GitHub
 * Pages HTTPS popup. The game exchanges encrypted envelopes and slot commands
 * over a nonce- and request-id-bound postMessage session. No token enters game
 * memory, storage, messages, URLs or logs; no server relay is used.
 */
WML.define({
  id: 'cloud-save',
  name: '클라우드세이브 (Google Drive)',
  version: '0.7.0',
  description: '정적 HTTPS 인증 페이지가 Google Drive를 직접 처리하고 게임은 암호화된 세이브 데이터만 주고받습니다.',
  symbols: {
    "pauseMenu": {
      "raw": { "2026-10-04": "N6e" },
      "doc": "게임 기본 일시정지 메뉴. 버전에 따라 없어도 모드의 클라우드 창은 사용할 수 있습니다.",
      "optional": true,
      "find": { "all": ["\"support\""], "len": 2849, "any": ["\"save\"", ".returnToTitle", "\"changelog\"", "\"settings\"", "onDone:", "\"load\""] }
    }
  },
  async setup(api) {
    await api.loadScript('crypto.js');
    if (!globalThis.WMLGoogleDriveCrypto) {
      throw new Error('Google Drive 세이브 암호화 모듈을 불러오지 못했습니다.');
    }

    const h = api.ui.h;
    const button = api.ui.button;
    let win = null;
    let view = { page: 'home' };
    let message = '';
    let fields = {};
    let drafts = {};
    let busy = false;
    let driveSlots = [];
    let slotsStatus = 'not-loaded'; // not-loaded | loading | loaded | error
    let slotsError = '';
    const SESSION_POLICY_KEY = 'wml-google-drive-session-policy-v1';
    const EXPLICIT_LOGOUT_KEY = 'wml-google-drive-explicit-logout-v1';
    const HAD_AUTH_KEY = 'wml-google-drive-had-auth-v1';
    const LEGACY_SESSION_TOKEN_KEY = 'wml-google-drive-session-token-v1';
    let sessionPolicy = 'remember'; // remember | reauth
    let explicitLogout = false;
    let permissionRevoked = false;
    let hadPreviousAuth = false;
    let authStatus = 'reauth-required';
    let authPopup = null;
    let authNonce = '';
    let authSessionId = '';
    let bridgeReady = false;
    let pageAuthenticated = false;
    let bridgeStatus = 'disconnected';
    let bridgeWatchTimer = null;
    let bridgeHandshakeTimer = null;
    const pendingDriveRequests = new Map();
    const usedDriveRequestIds = new Set();
    const MAX_BRIDGE_REQUESTS = 2048;
    const MAX_BRIDGE_PAYLOAD_CHARS = 12 * 1024 * 1024;
    const AUTH_PAGE_URL = 'https://jeiky224.github.io/cloud/auth.html';
    const AUTH_PAGE_ORIGIN = 'https://jeiky224.github.io';
    const BRIDGE_VERSION = 1;
    const FILE_PREFIX = 'wayward-cloud-slot-';
    const STYLE_ID = 'wml-google-drive-save-style';

    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent =
        '.wml-gd-wrap{display:flex;flex-direction:column;gap:12px;color:inherit;font:inherit}' +
        '.wml-gd-desc{margin:0;opacity:.82;font-size:.92em;line-height:1.45;white-space:pre-line}' +
        '.wml-gd-field{display:flex;flex-direction:column;gap:5px;min-width:0;font-size:.92em}' +
        '.wml-gd-input{box-sizing:border-box;width:100%;min-width:0;min-height:42px;padding:9px 11px;border:1px solid var(--wml-border,#7778);border-radius:8px;background:var(--wml-panel,#00000010);color:inherit;font:inherit}' +
        '.wml-gd-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}' +
        '.wml-gd-slot{display:flex;flex-direction:column;gap:8px;padding:11px;border:1px solid var(--wml-border,#7778);border-radius:9px}' +
        '.wml-gd-slot-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}' +
        '.wml-gd-slot-title{font-weight:600;overflow-wrap:anywhere;min-width:0}' +
        '.wml-gd-slot-line{display:flex;align-items:center;gap:6px;min-width:0;max-width:100%;white-space:nowrap;overflow:hidden}' +
        '.wml-gd-memo-chip{min-width:0;max-width:58%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:0;background:transparent;color:inherit;text-align:left;text-decoration:underline;opacity:.78;padding:0;font:inherit;font-size:.9em;cursor:pointer}' +
        '.wml-gd-summary{font-size:.86em;opacity:.82;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
        '.wml-gd-memo-area{box-sizing:border-box;width:100%;min-height:72px;resize:vertical;padding:9px 11px;border:1px solid var(--wml-border,#7778);border-radius:8px;background:var(--wml-panel,#00000010);color:inherit;font:inherit}' +
        '.wml-gd-small{font-size:.82em;opacity:.72}' +
        '.wml-gd-wrap button{max-width:100%}' +
        '.wml-gd-memo-overlay{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:100%;height:100%;max-width:none;max-height:none;margin:0;padding:20px;border:0;background:rgba(0,0,0,.48);color:inherit}' +
        '.wml-gd-memo-box{box-sizing:border-box;max-width:min(92vw,480px);max-height:75vh;overflow:auto;padding:16px 18px;border:1px solid var(--wml-border,#7778);border-radius:10px;background:var(--wml-panel,Canvas);color:var(--wml-text,CanvasText);white-space:pre-wrap;overflow-wrap:anywhere;box-shadow:0 8px 30px #0005}' +
        '.wml-gd-session-overlay{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:100%;height:100%;max-width:none;max-height:none;margin:0;padding:20px;border:0;background:rgba(0,0,0,.55);color:inherit}' +
        '.wml-gd-session-box{box-sizing:border-box;width:min(92vw,440px);max-height:85vh;overflow:auto;padding:18px;border:1px solid var(--wml-border,#7778);border-radius:12px;background:var(--wml-panel,Canvas);color:var(--wml-text,CanvasText);box-shadow:0 8px 30px #0005}' +
        '.wml-gd-session-box h3{margin:0 0 10px}' +
        '.wml-gd-session-box p{line-height:1.45}' +
        '.wml-gd-session-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}' +
        '.wml-gd-session-actions button{flex:1 1 150px;min-height:40px;padding:8px 12px;border:1px solid var(--wml-border,#7778);border-radius:8px;background:var(--wml-panel,#00000010);color:inherit;font:inherit;cursor:pointer}' +
        '.wml-gd-session-actions button[aria-pressed="true"]{outline:2px solid var(--wml-accent,#4b8)}';
      document.head.appendChild(style);
    }

    function readStorage(key) {
      try { return window.localStorage.getItem(key); } catch (_) { return null; }
    }
    function writeStorage(key, value) {
      try {
        if (value == null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, value);
        return true;
      } catch (_) { return false; }
    }
    function loadSessionPolicy() {
      const saved = readStorage(SESSION_POLICY_KEY);
      return saved === 'reauth' || saved === 'session' ? 'reauth' : 'remember';
    }
    function loadLogoutMarker() {
      return readStorage(EXPLICIT_LOGOUT_KEY) || '';
    }
    function loadExplicitLogout() {
      return loadLogoutMarker() === '1' || loadLogoutMarker() === 'revoked';
    }
    function loadHadPreviousAuth() {
      return readStorage(HAD_AUTH_KEY) === '1';
    }
    function saveAuthPreferences() {
      writeStorage(SESSION_POLICY_KEY, sessionPolicy);
      writeStorage(EXPLICIT_LOGOUT_KEY,
        explicitLogout ? (permissionRevoked ? 'revoked' : '1') : null);
    }
    function hasLogin() {
      return !!(bridgeReady && pageAuthenticated && authPopup && !authPopup.closed);
    }
    function hasToken() {
      // Compatibility name for old UI paths; no access token exists in this game.
      return hasLogin();
    }
    function setSessionPolicy(policy) {
      sessionPolicy = policy === 'reauth' ? 'reauth' : 'remember';
      saveAuthPreferences();
      if (hasLogin()) authStatus = 'connected';
      else if (permissionRevoked) authStatus = 'permission-revoked';
      else if (explicitLogout) authStatus = 'explicit-logout';
      else authStatus = sessionPolicy === 'reauth' ? 'session-only' : 'reauth-required';
    }
    function markExplicitLogout(revoked) {
      sessionPolicy = 'reauth';
      explicitLogout = true;
      permissionRevoked = revoked === true;
      if (permissionRevoked) {
        hadPreviousAuth = false;
        writeStorage(HAD_AUTH_KEY, null);
      }
      saveAuthPreferences();
      authStatus = permissionRevoked ? 'permission-revoked' : 'explicit-logout';
    }
    function markPermissionRevoked() {
      sessionPolicy = 'reauth';
      explicitLogout = true;
      permissionRevoked = true;
      hadPreviousAuth = false;
      writeStorage(HAD_AUTH_KEY, null);
      saveAuthPreferences();
      authStatus = 'permission-revoked';
    }
    function markScopeMissing() {
      sessionPolicy = 'reauth';
      permissionRevoked = false;
      authStatus = 'scope-missing';
    }
    function markConsentDenied() {
      authStatus = 'consent-denied';
    }
    sessionPolicy = loadSessionPolicy();
    explicitLogout = loadExplicitLogout();
    permissionRevoked = loadLogoutMarker() === 'revoked';
    hadPreviousAuth = loadHadPreviousAuth();
    authStatus = permissionRevoked ? 'permission-revoked' :
      (explicitLogout ? 'explicit-logout' :
        (sessionPolicy === 'reauth' ? 'session-only' : 'reauth-required'));

    function rejectPendingDriveRequests(reason) {
      for (const [requestId, pending] of pendingDriveRequests.entries()) {
        clearTimeout(pending.timer);
        pendingDriveRequests.delete(requestId);
        try { pending.reject(new Error(reason || 'Google Drive 인증 창 연결이 종료되었습니다.')); } catch (_) {}
      }
    }

    function closeAuthSession(closePopup, reason) {
      if (bridgeWatchTimer !== null) clearInterval(bridgeWatchTimer);
      if (bridgeHandshakeTimer !== null) clearTimeout(bridgeHandshakeTimer);
      bridgeWatchTimer = null;
      bridgeHandshakeTimer = null;
      const popup = authPopup;
      authPopup = null;
      authNonce = '';
      authSessionId = '';
      bridgeReady = false;
      pageAuthenticated = false;
      bridgeStatus = 'disconnected';
      rejectPendingDriveRequests(reason || 'Google Drive 인증 창 연결이 종료되었습니다.');
      driveSlots = [];
      slotsStatus = 'not-loaded';
      slotsError = '';
      if (closePopup && popup && !popup.closed) {
        try { popup.close(); } catch (_) {}
      }
    }

    function clearToken() {
      // This clears the popup bridge, not a token: the token is private to
      // the HTTPS authentication page and cannot be accessed by game code.
      closeAuthSession(true, 'Google Drive 인증 세션을 종료했습니다.');
      writeStorage(LEGACY_SESSION_TOKEN_KEY, null);
    }
    writeStorage(LEGACY_SESSION_TOKEN_KEY, null);

    function validGameOrigin() {
      const protocol = String(window.location.protocol || '');
      const origin = String(window.location.origin || '');
      if (protocol === 'file:' && origin === 'null') return 'null';
      if (!/^https?:$/.test(protocol)) {
        throw new Error('지원하지 않는 실행 주소입니다. file://, HTTP 또는 HTTPS에서 실행해 주세요.');
      }
      try {
        const parsed = new URL(origin);
        if (parsed.origin !== origin || parsed.username || parsed.password) throw new Error('invalid origin');
      } catch (_) {
        throw new Error('게임 실행 origin을 검증할 수 없습니다.');
      }
      return origin;
    }

    function bridgeMessage(type, extra) {
      return Object.assign({
        type,
        version: BRIDGE_VERSION,
        nonce: authNonce,
        sessionId: authSessionId
      }, extra || {});
    }

    function sendBridgeHello() {
      if (!authPopup || authPopup.closed || !authNonce) return false;
      try {
        authPopup.postMessage({
          type: 'wayward-cloudsave-hello',
          version: BRIDGE_VERSION,
          nonce: authNonce
        }, AUTH_PAGE_ORIGIN);
        return true;
      } catch (_) {
        return false;
      }
    }

    function updateBridgeStatus(status, notice) {
      bridgeStatus = String(status || 'disconnected');
      authStatus = bridgeStatus;
      message = String(notice || '');
      if (bridgeStatus === 'connected') {
        explicitLogout = false;
        permissionRevoked = false;
        hadPreviousAuth = true;
        writeStorage(HAD_AUTH_KEY, '1');
        pageAuthenticated = true;
        writeStorage(EXPLICIT_LOGOUT_KEY, null);
      } else if (bridgeStatus === 'permission-revoked') {
        pageAuthenticated = false;
        markPermissionRevoked();
      } else if (bridgeStatus === 'scope-missing') {
        pageAuthenticated = false;
        markScopeMissing();
      } else if (bridgeStatus === 'consent-denied') {
        pageAuthenticated = false;
        markConsentDenied();
      } else if (bridgeStatus === 'logged-out') {
        pageAuthenticated = false;
        markExplicitLogout(false);
      } else if (bridgeStatus === 'revoke-failed') {
        pageAuthenticated = false;
        authStatus = 'revoke-failed';
      } else if (bridgeStatus === 'reauth-required' || bridgeStatus === 'auth-cancelled' ||
        pageAuthenticated = false;
                 bridgeStatus === 'popup-blocked') {
        authStatus = bridgeStatus;
      }
      if (isConnected()) render();
    }

    function onCloudSaveMessage(event) {
      if (!authPopup || event.source !== authPopup || event.origin !== AUTH_PAGE_ORIGIN) return;
      const data = event.data;
      if (!data || typeof data !== 'object' || data.version !== BRIDGE_VERSION ||
          data.nonce !== authNonce) return;

      if (data.type === 'wayward-cloudsave-page-ready') {
        if (bridgeReady) return;
        if (!sendBridgeHello()) {
          message = '정적 인증 페이지와 핸드셰이크를 시작하지 못했습니다.';
          if (isConnected()) render();
        }
        return;
      }

      if (data.type === 'wayward-cloudsave-ready') {
        if (bridgeReady || typeof data.sessionId !== 'string' ||
            !/^[a-f0-9]{48}$/.test(data.sessionId)) return;
        authSessionId = data.sessionId;
        bridgeReady = true;
        bridgeStatus = 'awaiting-google';
        authStatus = 'awaiting-google';
        message = '인증 페이지 연결이 확인되었습니다. 팝업에서 Google 계정을 연결하세요.';
        if (bridgeHandshakeTimer !== null) clearTimeout(bridgeHandshakeTimer);
        bridgeHandshakeTimer = null;
        if (isConnected()) render();
        return;
      }

      if (!bridgeReady || !authSessionId || data.sessionId !== authSessionId) return;

      if (data.type === 'wayward-cloudsave-status') {
        const allowed = new Set([
          'connected','logged-out','reauth-required','consent-denied','scope-missing',
          'permission-revoked','revoke-failed','auth-cancelled','popup-blocked',
          'network-error','drive-unavailable','permission-denied','quota-exceeded',
          'rate-limited','file-not-found','invalid-save-data','request-too-large',
          'session-request-limit'
        ]);
        if (!allowed.has(String(data.status || ''))) return;
        updateBridgeStatus(data.status, data.message);
        if (data.status === 'connected' && slotsStatus !== 'loading') {
          runAction(() => refreshSlots());
        }
        return;
      }

      if (data.type === 'wayward-cloudsave-response') {
        if (typeof data.requestId !== 'string' ||
            !/^[a-f0-9]{48}$/.test(data.requestId) ||
            typeof data.ok !== 'boolean') return;
        const pending = pendingDriveRequests.get(data.requestId);
        if (!pending) return;
        pendingDriveRequests.delete(data.requestId);
        clearTimeout(pending.timer);
        if (data.ok) {
          pending.resolve(data.data == null ? null : data.data);
        } else {
          const error = data.error && typeof data.error === 'object' ? data.error : {};
          const code = String(error.code || 'drive-error');
          if (code === 'reauth-required' || code === 'scope-missing' ||
              code === 'permission-revoked') {
            updateBridgeStatus(code, String(error.message || 'Google Drive 인증이 필요합니다.'));
          }
          pending.reject(new Error(String(error.message || 'Google Drive 요청에 실패했습니다.')));
        }
      }
    }
    window.addEventListener('message', onCloudSaveMessage);

    function requestDrive(action, payload) {
      if (!bridgeReady || !authSessionId || !authPopup || authPopup.closed) {
        return Promise.reject(new Error('Google 인증 페이지와 연결되어 있지 않습니다. 연결 버튼을 눌러 다시 시작하세요.'));
      }
      if (!['list','read','save','delete','logout','revoke'].includes(action)) {
        return Promise.reject(new Error('허용되지 않은 Google Drive 명령입니다.'));
      }
      let serialized;
      try { serialized = JSON.stringify(payload || {}); }
      catch (_) { return Promise.reject(new Error('Google Drive 요청 데이터가 직렬화되지 않습니다.')); }
      if (serialized.length > MAX_BRIDGE_PAYLOAD_CHARS) {
        return Promise.reject(new Error('Google Drive 요청 데이터가 허용된 크기를 초과했습니다.'));
      }
      if (usedDriveRequestIds.size >= MAX_BRIDGE_REQUESTS) {
        return Promise.reject(new Error('Google Drive 세션 요청 한도를 초과했습니다. 인증 팝업을 다시 여세요.'));
      }
      const requestId = createAuthNonce();
      if (usedDriveRequestIds.has(requestId)) {
        return Promise.reject(new Error('중복 요청 ID가 생성되었습니다. 다시 연결하세요.'));
      }
      usedDriveRequestIds.add(requestId);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingDriveRequests.delete(requestId);
          reject(new Error('Google Drive 응답 시간이 초과되었습니다. 인증 창과 네트워크를 확인하세요.'));
        }, action === 'list' || action === 'read' || action === 'save' ? 90000 : 45000);
        pendingDriveRequests.set(requestId, { resolve, reject, timer });
        try {
          authPopup.postMessage(bridgeMessage('wayward-cloudsave-request', {
            requestId,
            action,
            payload: payload || {}
          }), AUTH_PAGE_ORIGIN);
        } catch (_) {
          clearTimeout(timer);
          pendingDriveRequests.delete(requestId);
          reject(new Error('Google Drive 요청을 인증 페이지에 전달하지 못했습니다.'));
        }
      });
    }

    function openAuthPopup() {
      if (authPopup && !authPopup.closed) {
        try { authPopup.focus(); } catch (_) {}
        message = '열려 있는 Google CloudSave 인증 팝업을 사용하세요.';
        render();
        return;
      }
      try {
        const gameOrigin = validGameOrigin();
        const nonce = createAuthNonce();
        const url = new URL(AUTH_PAGE_URL);
        url.searchParams.set('origin', gameOrigin);
        url.searchParams.set('nonce', nonce);
        url.searchParams.set('login', explicitLogout || sessionPolicy === 'reauth'
          ? 'select_account' : 'remember');
        const popup = window.open(url.toString(),
          'waywardCloudSaveGoogleDrive',
          'popup=yes,width=540,height=760,resizable=yes,scrollbars=yes');
        if (!popup) {
          authStatus = 'popup-blocked';
          message = '브라우저가 Google 인증 팝업을 차단했습니다. 팝업을 허용한 뒤 다시 연결하세요.';
          render();
          return;
        }
        closeAuthSession(false, '이전 인증 세션을 새 세션으로 교체했습니다.');
        usedDriveRequestIds.clear();
        authPopup = popup;
        authNonce = nonce;
        authSessionId = '';
        bridgeReady = false;
        bridgeStatus = 'opening';
        authStatus = 'authenticating';
        driveSlots = [];
        slotsStatus = 'not-loaded';
        slotsError = '';
        message = 'GitHub Pages 정적 인증 팝업을 열었습니다. 보안 핸드셰이크를 기다립니다.';
        bridgeHandshakeTimer = setTimeout(() => {
            closeAuthSession(true, '인증 페이지 핸드셰이크 시간 초과');
          if (!bridgeReady) {
            authStatus = 'reauth-required';
            message = '정적 인증 페이지와 핸드셰이크가 시간 초과되었습니다. 팝업을 허용하고 다시 시도하세요.';
            if (isConnected()) render();
          }
        }, 30000);
        bridgeWatchTimer = setInterval(() => {
          if (authPopup && authPopup.closed) {
            closeAuthSession(false, 'Google 인증 팝업이 닫혔습니다.');
            authStatus = 'reauth-required';
            message = 'Google 인증 팝업이 닫혔습니다. 다시 연결하세요.';
            if (isConnected()) render();
          }
        }, 1000);
        render();
      } catch (error) {
        authStatus = 'reauth-required';
        message = String(error && error.message || error);
        render();
      }
    }

    function connectFromClick() {
      openAuthPopup();
    }

    async function refreshSlots() {
      if (!hasLogin()) throw new Error('Google 계정 연결이 필요합니다. 인증 페이지에서 로그인하세요.');
      slotsStatus = 'loading';
      slotsError = '';
      if (isConnected()) render();
      try {
        const result = await requestDrive('list', {});
        const files = Array.isArray(result && result.files) ? result.files : [];
        const slots = new Map();
        for (const file of files) {
          const match = new RegExp('^' + FILE_PREFIX + '([1-9][0-9]*)\\.json$').exec(String(file.name || ''));
          if (!match) continue;
          const slot = Number(match[1]);
          if (!Number.isSafeInteger(slot) || slot < 1) continue;
          const previous = slots.get(slot);
          if (!previous || String(file.modifiedTime || '') > String(previous.modifiedTime || '')) {
            slots.set(slot, file);
          }
        }
        driveSlots = Array.from(slots.values()).sort((a,b) =>
          Number(a.name.match(/([0-9]+)\.json$/)[1]) -
          Number(b.name.match(/([0-9]+)\.json$/)[1])
        );
        for (const file of driveSlots) {
          try {
            const envelope = await readSlotEnvelope(file);
            if (envelope && envelope.keyMode === 'embedded-addon-v2') {
              const snapshot = await globalThis.WMLGoogleDriveCrypto.decryptSnapshotEmbedded(envelope);
              file.memo = String(snapshot.memo || '');
              file.summary = makeSummary(snapshot);
            } else {
              file.memo = '';
              file.summary = '';
            }
          } catch (_) {
            file.memo = '';
            file.summary = '';
            file.unreadable = true;
          }
        }
        slotsStatus = 'loaded';
        slotsError = '';
        return driveSlots;
      } catch (error) {
        slotsStatus = 'error';
        slotsError = String(error && error.message || error || '저장목록을 확인하지 못했습니다.');
        throw error;
      }
    }

    function currentFile(slot) {
      return driveSlots.find(file => file.name === FILE_PREFIX + slot + '.json') || null;
    }

    async function readSlotEnvelope(file) {
      const match = new RegExp('^' + FILE_PREFIX + '([1-9][0-9]*)\\.json$').exec(String(file && file.name || ''));
      if (!match) throw new Error('저장 슬롯 파일 이름이 올바르지 않습니다.');
      const result = await requestDrive('read', { slot: Number(match[1]) });
      if (!result || !result.envelope) throw new Error('Google Drive에서 세이브 데이터를 받지 못했습니다.');
      return result.envelope;
    }

    async function writeSlotEnvelope(slot, envelope) {
      await requestDrive('save', { slot: Number(slot), envelope });
      await refreshSlots();
    }

    async function deleteSlot(slot) {
      await requestDrive('delete', { slot: Number(slot) });
      await refreshSlots();
    }

    function buildSnapshot() {
      const state = api.store.game();
      if (!state || typeof state !== 'object' || Array.isArray(state)) {
        throw new Error('게임이 시작된 뒤에 저장할 수 있습니다.');
      }
      // Prefer the game's native serializer when WML resolves it. Some newer
      // builds no longer expose that minified helper under a stable symbol.
      // In that case preserve the current JSON-compatible game state directly;
      // do not block the whole addon on an optional private implementation detail.
      let native = null;
      if (api.has('nativeSaveJSON')) {
        try {
          native = JSON.parse(api.fn('nativeSaveJSON')(state, String(api.game || '')));
        } catch (_) {
          native = null;
        }
      }
      const stateToSave = native && native.format === 1 && native.state &&
        typeof native.state === 'object' && !Array.isArray(native.state)
        ? native.state
        : JSON.parse(JSON.stringify(state));
      const gameVersion = native && native.gameVersion != null
        ? String(native.gameVersion)
        : String(api.game || '');
      const modData = native && native.modData && typeof native.modData === 'object'
        ? native.modData
        : (stateToSave.mods && typeof stateToSave.mods === 'object' &&
          !Array.isArray(stateToSave.mods) ? stateToSave.mods : {});
      return {
        schema: 'wayward-cloud-save',
        version: 1,
        gameFamily: 'wayward',
        game: String(api.game || ''), // build identifier for diagnostics; not a compatibility gate
        gameVersion,
        nativeFormat: 1,
        savedAt: Date.now(),
        memo: '',
        title: defaultTitle(stateToSave),
        state: stateToSave,
        modData
      };
    }

    function firstValue(root, patterns) {
      const seen = new Set(), queue = [{ value: root, depth: 0 }];
      while (queue.length) {
        const item = queue.shift();
        if (!item.value || typeof item.value !== 'object' || seen.has(item.value) || item.depth > 5) continue;
        seen.add(item.value);
        for (const [key, value] of Object.entries(item.value)) if (patterns.some(pattern => pattern.test(key)) && (typeof value === 'string' || typeof value === 'number') && String(value).trim()) return value;
        for (const value of Object.values(item.value)) if (value && typeof value === 'object') queue.push({ value, depth: item.depth + 1 });
      }
      return '';
    }
    function makeSummary(snapshot) {
      const state = snapshot && snapshot.state || {};
      const day = firstValue(state, [/^(day|days|currentDay|progressDay|dayCount|elapsedDays|daysPassed)$/i, /^(gameDay|storyDay)$/i]);
      const gold = firstValue(state, [/^(gold|money|coins|currency|playerGold|currentGold|goldAmount|cash)$/i, /gold|money|currency/i]);
      const role = firstValue(state, [/^(role|occupation|job|origin|background|statusName|className|socialClass|characterRole)$/i]);
      const character = firstValue(state, [/^(characterName|playerName|protagonistName|heroName|mainCharacterName|girlName)$/i]);
      const parts = [];
      if (character) parts.push(String(character) + ' 진행일:'); else if (day !== '') parts.push('진행일:');
      if (day !== '') parts.push(String(day) + '일');
      if (gold !== '') parts.push(String(gold) + '골드');
      if (role) parts.push(String(role));
      parts.push(new Date(Number(snapshot.savedAt) || Date.now()).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }));
      return parts.join(' · ');
    }
    function defaultTitle(state) {
      const day = Number(state && state.day);
      return Number.isFinite(day) && day > 0 ? 'Day ' + day : 'Wayward 세이브';
    }

    function applySnapshot(snapshot) {
      if (!snapshot || snapshot.schema !== 'wayward-cloud-save' || snapshot.version !== 1 ||
          snapshot.nativeFormat !== 1 || !snapshot.state ||
          typeof snapshot.state !== 'object' || Array.isArray(snapshot.state)) {
        throw new Error('지원하지 않는 세이브 형식입니다.');
      }
      // `game` and `gameVersion` are build identifiers, not game identities.
      // Keep old snapshots (which have no gameFamily) readable across Wayward builds.
      // The stable snapshot schema + nativeFormat are the compatibility contract.
      if (snapshot.gameFamily && snapshot.gameFamily !== 'wayward') {
        throw new Error('다른 게임 계열의 세이브입니다.');
      }
      const modData = snapshot.modData == null ? {} : snapshot.modData;
      if (!modData || typeof modData !== 'object' || Array.isArray(modData)) {
        throw new Error('세이브 MOD 데이터 형식이 올바르지 않습니다.');
      }
      const savedMods = snapshot.state.mods && typeof snapshot.state.mods === 'object' &&
        !Array.isArray(snapshot.state.mods) ? snapshot.state.mods : {};
      const restored = { ...snapshot.state, mods: { ...savedMods, ...modData } };
      // Set both the saved game state and the game-start flag so title-screen loads
      // transition into the playable screen instead of remaining on the title screen.
      if (typeof api.store.set === 'function') api.store.set(current => ({ ...current, state: restored, started: true }));
      else api.store.update(() => restored);
    }

    function isConnected() {
      return !!(win && win.el && win.el.isConnected);
    }

    function render() {
      if (win && win.refresh && isConnected()) win.refresh();
      else openWindow();
    }

    function show(nextView, notice) {
      view = nextView;
      message = notice || '';
      fields = {};
      drafts = {};
      if (isConnected()) win.setTitle('클라우드세이브 (Google Drive)');
      render();
    }

    function openWindow() {
      win = api.ui.window({
        id: 'cloud-save-google-drive-main',
        title: '클라우드세이브 (Google Drive)',
        width: 460,
        height: 650,
        render(body) {
          body.replaceChildren();
          const root = h('div', { class: 'wml-gd-wrap', 'data-wml-ui': 'true' });
          body.append(root);
          renderView(root);
        }
      });
    }

    function open() {
      view = { page: 'home' };
      message = '';
      if (isConnected()) {
        win.focus();
        win.refresh();
      } else {
        openWindow();
        // Static Google auth is user-gesture gated; no token restore occurs here.
      }
      if (hasLogin() && slotsStatus !== 'loaded' && slotsStatus !== 'loading') {
        runAction(() => refreshSlots());
      }
    }

    function addText(root, text, cls) {
      root.append(h('p', { class: cls || 'wml-gd-desc' }, String(text)));
    }

    function addTitle(root, text) {
      root.append(h('h3', { class: 'wml-gd-slot-title' }, text));
    }

    function addButton(root, label, fn, primary) {
      root.append(button(label, fn, primary ? { primary: true } : {}));
    }

    function addField(root, key, label, type, value, autocomplete) {
      const wrap = h('label', { class: 'wml-gd-field' }, label);
      const input = document.createElement('input');
      input.className = 'wml-gd-input';
      input.type = type || 'text';
      input.value = Object.prototype.hasOwnProperty.call(drafts, key) ? drafts[key] : (value || '');
      input.addEventListener('input', () => { drafts[key] = input.value; });
      input.autocomplete = autocomplete || 'off';
      input.setAttribute('data-wml-ui', 'true');
      if (type === 'password') input.minLength = 10;
      wrap.append(input);
      root.append(wrap);
      fields[key] = input;
      return input;
    }

    function runAction(fn) {
      if (busy) return;
      busy = true;
      message = '처리 중…';
      render();
      let task;
      try { task = fn(); }
      catch (error) { task = Promise.reject(error); }
      Promise.resolve(task).catch(error => {
        message = String(error && error.message || error || '요청에 실패했습니다.');
        render();
      }).finally(() => {
        busy = false;
        if (isConnected()) render();
      });
    }


    async function logoutGoogleAccount() {
      if (bridgeReady) await requestDrive('logout', {});
      else clearToken();
      markExplicitLogout(false);
      show({ page: 'home' },
        '로그아웃했습니다. 인증 페이지의 메모리 토큰을 삭제했으며 Google 권한 동의는 유지됩니다.');
    }

    async function revokeGooglePermission() {
      if (!bridgeReady) throw new Error('Google 인증 페이지와 연결되어 있지 않습니다.');
      try {
        const result = await requestDrive('revoke', {});
        const revoked = !!(result && result.revoked === true);
        markExplicitLogout(revoked);
        show({ page: 'home' }, revoked
          ? 'Google 앱 권한 철회를 확인했습니다.'
          : 'Google 앱 권한 철회 성공 응답을 받지 못했습니다. 로그인 정보는 종료했습니다.');
      } catch (error) {
        markExplicitLogout(false);
        clearToken();
        show({ page: 'home' },
          'Google 앱 권한 철회는 확인되지 않았습니다. 이 인증 세션은 종료했습니다. (' +
          String(error && error.message || error) + ')');
      }
    }

    async function saveSlot(slot) {
      const snapshot = buildSnapshot();
      snapshot.memo = String(fields.memo && fields.memo.value || '').trim();
      const envelope = await globalThis.WMLGoogleDriveCrypto.encryptSnapshotEmbedded(snapshot);
      await writeSlotEnvelope(slot, envelope);
      show({ page: 'home' }, '저장 슬롯 ' + slot + '에 자동 암호화하여 저장했습니다.');
    }

    async function prepareLoadSlot(slot) {
      const file = currentFile(slot); if (!file) throw new Error('저장 슬롯이 비어 있습니다.');
      const envelope = await readSlotEnvelope(file);
      show({ page: envelope && envelope.keyMode === 'embedded-addon-v2' ? 'load' : 'legacy-load', slot },
        envelope && envelope.keyMode === 'embedded-addon-v2' ? '' : '이전 암호화 세이브입니다. 저장 당시 암호를 입력하면 자동 암호화 형식으로 변환됩니다.');
    }
    async function loadSlot(slot) {
      const file = currentFile(slot); if (!file) throw new Error('저장 슬롯이 비어 있습니다.');
      const envelope = await readSlotEnvelope(file); let snapshot;
      if (envelope && envelope.keyMode === 'embedded-addon-v2') snapshot = await globalThis.WMLGoogleDriveCrypto.decryptSnapshotEmbedded(envelope);
      else {
        const passphrase = String(fields.passphrase && fields.passphrase.value || '');
        if (!passphrase) throw new Error('이전 세이브의 암호화 비밀번호를 입력해 주세요.');
        snapshot = await globalThis.WMLGoogleDriveCrypto.decryptSnapshot(envelope, passphrase);
        await writeSlotEnvelope(slot, await globalThis.WMLGoogleDriveCrypto.encryptSnapshotEmbedded(snapshot));
      }
      applySnapshot(snapshot); if (win) win.close(); message = '';
    }

    async function removeSlot(slot) {
      await deleteSlot(slot);
      show({ page: 'home' }, '저장 슬롯 ' + slot + '을 삭제했습니다.');
    }

    function showSessionSettingsPopup() {
      const overlay = document.createElement('dialog');
      overlay.className = 'wml-gd-session-overlay';
      overlay.setAttribute('data-wml-ui', 'true');
      const box = document.createElement('div');
      box.className = 'wml-gd-session-box';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      const title = document.createElement('h3');
      title.textContent = '로그인 유지 설정';
      const description = document.createElement('p');
      description.textContent =
        '두 설정은 비밀정보가 아닌 계정 선택 정책입니다. 로그인 상태 유지를 선택하면 다음 연결에서 기존 계정/동의를 재사용하도록 요청하고, 새로고침할 때마다 로그인 해제를 선택하면 다음 연결에서 계정 선택을 요청합니다. 액세스 토큰은 정적 HTTPS 인증 페이지의 메모리에만 보관되며 무인 갱신하지 않습니다.';
      const actions = document.createElement('div');
      actions.className = 'wml-gd-session-actions';
      const close = () => { if (overlay.open) overlay.close(); overlay.remove(); document.removeEventListener('keydown', onKeyDown, true); };
      const addChoice = (label, policy, detail) => {
        const choice = document.createElement('button');
        choice.type = 'button';
        choice.textContent = label;
        choice.setAttribute('aria-pressed', String(sessionPolicy === policy));
        choice.title = detail;
        choice.addEventListener('click', () => {
          setSessionPolicy(policy);
          close();
          show({ page: 'home' }, policy === 'remember'
            ? '로그인 상태 유지가 켜졌습니다. 다음 초기화에서는 기존 Google 인증 상태 복구를 시도합니다.'
            : '새로고침할 때마다 로그인 해제가 켜졌습니다. 다음 초기화부터 계정 선택을 요청합니다.');
        });
        actions.append(choice);
      };
      addChoice('로그인 상태 유지', 'remember', '다음 연결에서 Google의 기존 계정/동의 재사용을 요청');
      addChoice('새로고침할 때마다 로그인 해제', 'reauth', '다음 페이지 초기화부터 인증 상태를 복구하지 않고 Google 계정 선택을 요청');
      const closeActions = document.createElement('div');
      closeActions.className = 'wml-gd-session-actions';
      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.textContent = '닫기';
      closeButton.addEventListener('click', close);
      closeActions.append(closeButton);
      box.append(title, description, actions, closeActions);
      overlay.append(box);
      overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
      const onKeyDown = event => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
      document.addEventListener('keydown', onKeyDown, true);
      document.body.append(overlay);
      if (typeof overlay.showModal === 'function') overlay.showModal();
      else { overlay.setAttribute('open', ''); }
    }

    function showMemoPopup(memo) {
      const overlay = document.createElement('dialog');
      overlay.className = 'wml-gd-memo-overlay';
      const box = document.createElement('div');
      box.className = 'wml-gd-memo-box';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.textContent = String(memo || '');
      overlay.append(box);
      const close = () => { if (overlay.open) overlay.close(); overlay.remove(); document.removeEventListener('keydown', onKeyDown, true); };
      const onKeyDown = event => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
      overlay.addEventListener('click', close);
      box.addEventListener('click', event => event.stopPropagation());
      document.addEventListener('keydown', onKeyDown, true);
      document.body.append(overlay);
      if (typeof overlay.showModal === 'function') overlay.showModal();
      else { overlay.setAttribute('open', ''); }
    }

    function renderSlots(root) {
      addTitle(root, 'Google Drive 저장 슬롯');

      const bySlot = new Map(driveSlots.map(file => [Number(file.name.match(/([0-9]+)\.json$/)[1]), file]));
      const used = new Set(bySlot.keys()); let nextSlot = 1; while (used.has(nextSlot)) nextSlot++;
      const slots = Array.from(bySlot.keys()).sort((a,b) => a-b); if (!used.has(nextSlot)) slots.push(nextSlot);
      for (const slot of slots) {
        const file = bySlot.get(slot), row = h('div', { class: 'wml-gd-slot' });
        const head = h('div', { class: 'wml-gd-slot-head' }), line = h('div', { class: 'wml-gd-slot-line' });
        line.append(h('div', { class: 'wml-gd-slot-title' }, '저장 슬롯 ' + slot));
        if (file && file.memo) {
          const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'wml-gd-memo-chip';
          chip.textContent = '[' + file.memo + ']'; chip.title = '눌러서 메모 전체 보기';
          chip.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); showMemoPopup(file.memo); });
          line.append(chip);
        }
        head.append(line); head.append(h('div', { class: 'wml-gd-small' }, file ? '저장됨' : '저장된 게임이 없습니다.')); row.append(head);
        if (file && file.summary) row.append(h('div', { class: 'wml-gd-summary', title: file.summary }, file.summary));
        else if (file && file.unreadable) row.append(h('div', { class: 'wml-gd-small' }, '세이브 정보를 읽을 수 없음 (이전 암호화 형식일 수 있음)'));
        const actions = h('div', { class: 'wml-gd-actions' });
        actions.append(button(file ? '덮어쓰기' : '저장', () => show({ page: 'save', slot }), { primary: true }));
        if (file) {
          actions.append(button('불러오기', () => runAction(() => prepareLoadSlot(slot))));
          actions.append(button('삭제', () => show({ page: 'delete', slot })));
        }
        row.append(actions); root.append(row);
      }
    }

    function renderView(root) {
      if (view.page === 'home') {
        addTitle(root, '개인 Google Drive 세이브');
        addText(root,
          'Google 인증 팝업이 계정 인증과 Drive 통신을 전담합니다. 게임은 암호화된 세이브 데이터만 메시지로 주고받습니다.');
        const connectLabel = authStatus === 'restore-pending'
          ? '기존 Google 계정 인증 상태 복구'
          : (authStatus === 'explicit-logout' || authStatus === 'session-only'
            ? 'Google 계정 선택 후 로그인'
            : (authStatus === 'permission-revoked' || authStatus === 'scope-missing'
              ? 'Google Drive 권한 다시 승인'
              : 'Google 계정으로 다시 연결'));
        addButton(root, hasLogin() ? '저장 목록 새로고침' : connectLabel,
          hasLogin() ? () => runAction(async () => {
            await refreshSlots();
            show({ page: 'home' }, '저장 목록을 새로고침했습니다.');
          }) : connectFromClick, true);
        addButton(root, '로그인 유지 설정', showSessionSettingsPopup);
        addButton(root, '로그아웃', () => runAction(() => logoutGoogleAccount()));
        if (hasLogin()) {
          addButton(root, 'Google 앱 권한 철회', () => runAction(() => revokeGooglePermission()));
        }
        const stateText = {
          connected: sessionPolicy === 'remember'
            ? 'Google Drive 연결됨 — 액세스 토큰은 정적 HTTPS 팝업 메모리에만 있습니다.'
            : '현재 인증 팝업 세션에서만 연결되어 있습니다.',
          opening: '정적 Google 인증 팝업을 여는 중입니다.',
          authenticating: '정적 인증 팝업의 핸드셰이크를 기다리고 있습니다.',
          'awaiting-google': '인증 팝업에서 Google 계정을 연결하세요.',
          'session-only': '다음 연결에서 Google 계정 선택을 요청합니다.',
          'explicit-logout': '명시적으로 로그아웃했습니다. Google 권한 동의는 유지됩니다.',
          'reauth-required': 'Google 액세스 토큰이 만료되었거나 인증이 필요합니다. 팝업에서 다시 연결하세요.',
          'consent-denied': 'Google 계정 또는 권한 승인이 거부되었습니다.',
          'scope-missing': 'Google Drive appData 권한이 승인되지 않았습니다.',
          'permission-revoked': 'Google Drive 권한이 철회되었거나 거부되었습니다.',
          'revoke-failed': 'Google 앱 권한 철회 성공 응답을 받지 못했습니다.',
          'auth-cancelled': 'Google 인증 창이 닫혔습니다.',
          'popup-blocked': '브라우저가 인증 팝업을 차단했습니다.'
        };
        addText(root, stateText[authStatus] || '상태: 연결되지 않음', 'wml-gd-small');
        if (hasLogin()) {
          if (slotsStatus === 'loaded') {
            renderSlots(root);
          } else if (slotsStatus === 'loading') {
            addText(root, '불러오는 중…');
          } else if (slotsStatus === 'error') {
            addText(root, '저장목록 새로고침이 필요합니다.');
            addButton(root, '저장목록 새로고침', () => runAction(() => refreshSlots()), true);
          } else {
            addText(root, '저장목록 새로고침이 필요합니다.');
            addButton(root, '저장목록 새로고침', () => runAction(() => refreshSlots()), true);
          }
        } else addText(root, '로그인 창에서 Google 계정을 선택해 주세요.');
        addMessage(root);
      } else if (view.page === 'save') {
        addTitle(root, '저장 슬롯 ' + view.slot + ' 저장');
        addText(root, '저장할 때 자동으로 암호화됩니다. 메모는 비워 두어도 저장됩니다.');
        const memoWrap = h('label', { class: 'wml-gd-field' }, '저장 메모 (선택 사항)');
        const memoInput = document.createElement('textarea'); memoInput.className = 'wml-gd-memo-area'; memoInput.maxLength = 2000;
        memoInput.placeholder = '';
        memoInput.value = Object.prototype.hasOwnProperty.call(drafts, 'memo') ? drafts.memo : (currentFile(view.slot) && currentFile(view.slot).memo || '');
        memoInput.addEventListener('input', () => { drafts.memo = memoInput.value; }); memoInput.setAttribute('data-wml-ui', 'true');
        memoWrap.append(memoInput); root.append(memoWrap); fields.memo = memoInput;
        addButton(root, '자동 암호화하여 저장', () => runAction(() => saveSlot(view.slot)), true);
        addButton(root, '취소', () => show({ page: 'home' }));
        addMessage(root);
      } else if (view.page === 'load') {
        addTitle(root, '저장 슬롯 ' + view.slot + ' 불러오기');
        addText(root, '세이브를 자동으로 복호화한 뒤 게임을 불러옵니다.');
        addButton(root, '자동 복호화하고 불러오기', () => runAction(() => loadSlot(view.slot)), true);
        addButton(root, '취소', () => show({ page: 'home' })); addMessage(root);
      } else if (view.page === 'legacy-load') {
        addTitle(root, '이전 세이브 불러오기 및 변환');
        addText(root, '이전 버전 세이브는 저장 당시 비밀번호가 필요합니다. 복호화 후 자동 암호화 형식으로 변환합니다.');
        addField(root, 'passphrase', '기존 세이브 암호화 비밀번호', 'password', '', 'current-password');
        addButton(root, '복호화·변환 후 불러오기', () => runAction(() => loadSlot(view.slot)), true);
        addButton(root, '취소', () => show({ page: 'home' })); addMessage(root);
      } else if (view.page === 'delete') {
        addTitle(root, '저장 슬롯 ' + view.slot + ' 삭제');
        addText(root, 'Google Drive의 이 모드 전용 저장 파일을 삭제합니다. 삭제 후에는 복구할 수 없습니다.');
        addButton(root, '삭제 확인', () => runAction(() => removeSlot(view.slot)), true);
        addButton(root, '취소', () => show({ page: 'home' }));
        addMessage(root);
      }
    }

    function addMessage(root) {
      if (message) root.append(h('p', { class: 'wml-gd-desc wml-note', role: 'status' }, message));
    }

    // Title-screen shortcut: available even when native local-save loading is disabled.
    const TITLE_NEW_GAME_LABELS = ['새 게임', '새로 시작', 'New Game', 'Start New Game', 'Start Game'];
    const TITLE_LOAD_LABELS = ['불러오기', '게임 불러오기', '세이브 불러오기', 'Load', 'Load Game', 'Load Save'];
    let titleMenuObserver = null;
    let titleMenuSyncQueued = false;

    function normalizedMenuText(node) {
      return String(node && (node.innerText || node.textContent) || '')
        .replace(/\s+/g, ' ').trim().toLocaleLowerCase();
    }
    function isVisibleMenuControl(node) {
      if (!node || !node.isConnected || node.closest('[data-wml-ui="true"]')) return false;
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 &&
        style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }
    function findVisibleMenuControl(labels) {
      const wanted = new Set(labels.map(label => label.toLocaleLowerCase()));
      const selector = 'button,[role="button"],a,[tabindex],input[type="button"],input[type="submit"]';
      for (const node of document.querySelectorAll(selector)) {
        if (wanted.has(normalizedMenuText(node)) && isVisibleMenuControl(node)) return node;
      }
      for (const node of document.querySelectorAll('div,li,span')) {
        if (!wanted.has(normalizedMenuText(node)) || !isVisibleMenuControl(node)) continue;
        const style = window.getComputedStyle(node);
        if (style.cursor === 'pointer' || node.hasAttribute('onclick') ||
            node.getAttribute('role') === 'button' || node.hasAttribute('tabindex')) return node;
      }
      return null;
    }
    function hasNearbyMenu(newGame, load) {
      if (!newGame || !load || newGame === load || newGame.contains(load) || load.contains(newGame)) return false;
      const ancestors = new Map();
      let node = newGame;
      for (let depth = 0; node && depth <= 4; depth++, node = node.parentElement) ancestors.set(node, depth);
      node = load;
      for (let depth = 0; node && depth <= 4; depth++, node = node.parentElement) {
        if (ancestors.has(node) && node !== document.body && node !== document.documentElement) {
          return ancestors.get(node) + depth <= 5;
        }
      }
      return false;
    }
    function syncTitleCloudButton() {
      const marker = '[data-wml-cloud-drive-title-load="true"]';
      const existing = document.querySelector(marker);
      const newGame = findVisibleMenuControl(TITLE_NEW_GAME_LABELS);
      const nativeLoad = findVisibleMenuControl(TITLE_LOAD_LABELS);
      if (!newGame || !nativeLoad || !hasNearbyMenu(newGame, nativeLoad)) {
        if (existing) existing.remove();
        return;
      }
      if (existing && existing.isConnected && existing.parentElement === nativeLoad.parentElement) {
        if ('disabled' in existing) existing.disabled = false;
        existing.removeAttribute('disabled');
        existing.removeAttribute('aria-disabled');
        return;
      }
      if (existing) existing.remove();
      const cloudLoad = nativeLoad.cloneNode(false);
      cloudLoad.removeAttribute('id');
      cloudLoad.removeAttribute('disabled');
      cloudLoad.removeAttribute('aria-disabled');
      cloudLoad.setAttribute('data-wml-cloud-drive-title-load', 'true');
      cloudLoad.setAttribute('data-wml-ui', 'true');
      cloudLoad.setAttribute('title', '클라우드 불러오기');
      cloudLoad.setAttribute('aria-label', '클라우드 불러오기');
      cloudLoad.setAttribute('role', cloudLoad.getAttribute('role') || 'button');
      if (cloudLoad.tagName === 'BUTTON') cloudLoad.type = 'button';
      else if (!cloudLoad.hasAttribute('tabindex')) cloudLoad.tabIndex = 0;
      for (const name of [...cloudLoad.classList]) {
        if (/disabled|cursor-not-allowed|pointer-events-none/i.test(name) ||
            /^opacity-(?:[0-9]|[1-9][0-9])$/.test(name)) cloudLoad.classList.remove(name);
      }
      cloudLoad.style.removeProperty('opacity');
      cloudLoad.style.removeProperty('pointer-events');
      cloudLoad.style.removeProperty('cursor');
      cloudLoad.textContent = '클라우드 불러오기';
      const activate = event => {
        event.preventDefault();
        event.stopPropagation();
        open();
      };
      cloudLoad.addEventListener('click', activate);
      cloudLoad.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') activate(event);
      });
      nativeLoad.insertAdjacentElement('afterend', cloudLoad);
    }
    function treeHasTitleMenuLabel(node) {
      if (!node || node.nodeType !== 1) return false;
      const labels = TITLE_NEW_GAME_LABELS.concat(TITLE_LOAD_LABELS).map(label => label.toLocaleLowerCase());
      if (node.matches && node.matches('[data-wml-cloud-drive-title-load="true"]')) return true;
      if (labels.includes(normalizedMenuText(node))) return true;
      // Restrict descendant scans to interactive controls inside inserted fragments.
      // Broad div/li/span scans on every mutation may stall mobile browsers.
      if (node.querySelectorAll) {
        for (const candidate of node.querySelectorAll('button,[role="button"],a,[tabindex],input[type="button"],input[type="submit"]')) {
          if (labels.includes(normalizedMenuText(candidate))) return true;
        }
      }
      return false;
    }
    function scheduleTitleSync() {
      if (titleMenuSyncQueued) return;
      titleMenuSyncQueued = true;
      const schedule = typeof requestAnimationFrame === 'function'
        ? callback => requestAnimationFrame(callback)
        : callback => setTimeout(callback, 80);
      schedule(() => {
        titleMenuSyncQueued = false;
        syncTitleCloudButton();
      });
    }
    function installTitleCloudButton() {
      if (titleMenuObserver) return;
      const start = () => {
        if (!document.body || titleMenuObserver) return;
        titleMenuObserver = new MutationObserver(records => {
          if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(treeHasTitleMenuLabel))) {
            scheduleTitleSync();
          }
        });
        titleMenuObserver.observe(document.body, { childList: true, subtree: true });
        syncTitleCloudButton();
      };
      if (document.body) start();
      else document.addEventListener('DOMContentLoaded', start, { once: true });
    }
    installTitleCloudButton();

    let fallbackDockButton = null;
    let nativeMenuEntrySeen = false;
    function ensureDockFallback() {
      if (fallbackDockButton || nativeMenuEntrySeen) return;
      fallbackDockButton = api.ui.addButton({
        label: '클라우드세이브',
        title: '개인 Google Drive 저장 및 불러오기',
        onClick: open
      });
    }
    function removeDockFallback() {
      if (!fallbackDockButton) return;
      try { fallbackDockButton.remove(); } catch (_) { /* best effort */ }
      fallbackDockButton = null;
    }

    if (api.has('pauseMenu')) {
      api.hook('pauseMenu', {
        around(next, props) {
          const tree = next(props);
          const state = { inserted: false };
          function patch(node) {
            if (!node || typeof node !== 'object') return node;
            if (Array.isArray(node)) {
              let changed = false;
              const out = node.map(child => {
                const value = patch(child);
                if (value !== child) changed = true;
                return value;
              });
              return changed ? out : node;
            }
            const nodeProps = node.props;
            if (!nodeProps) return node;
            let result = node;
            const children = nodeProps.children;
            let nextChildren = children;
            if (Array.isArray(children)) nextChildren = children.map(child => patch(child));
            else if (children && typeof children === 'object') nextChildren = patch(children);
            if (nextChildren !== children) result = { ...node, props: { ...nodeProps, children: nextChildren } };
            const p = result.props || {};
            if (!state.inserted && result.type === 'div' &&
                p.className === 'flex flex-col gap-2' && Array.isArray(p.children)) {
              const rows = p.children;
              const loadIndex = rows.findIndex(item => {
                const label = item && item.props ? item.props.children : null;
                return typeof label === 'string' && ['불러오기', 'Load', 'Load Game', 'Load Save'].includes(label.trim());
              });
              if (loadIndex >= 0) {
                const original = rows[loadIndex];
                const driveButton = {
                  ...original,
                  key: 'wml-google-drive-cloud-save',
                  props: {
                    ...original.props,
                    onClick: () => {
                      if (typeof props.onClose === 'function') props.onClose();
                      open();
                    },
                    title: '클라우드세이브 (Google Drive)',
                    'aria-label': '클라우드세이브',
                    children: '클라우드세이브'
                  }
                };
                result = { ...result, props: { ...p, children: [...rows.slice(0, loadIndex + 1), driveButton, ...rows.slice(loadIndex + 1)] } };
                state.inserted = true;
              }
            }
            return result;
          }
          const patched = patch(tree);
          if (state.inserted) {
            nativeMenuEntrySeen = true;
            removeDockFallback();
          } else if (!nativeMenuEntrySeen) ensureDockFallback();
          return patched;
        }
      });
    } else ensureDockFallback();

    api.onBack(() => {
      if (!isConnected()) return false;
      if (view.page === 'home') { win.close(); return true; }
      show({ page: 'home' });
      return true;
    });
  }
});




