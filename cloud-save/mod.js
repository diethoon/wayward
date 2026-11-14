/* Personal Google Drive-backed cloud saves for WML.
 * Browser OAuth uses Google's direct Token Model on the fixed GitHub Pages
 * page and a nonce-bound popup postMessage. Android uses the launcher's
 * native Google Identity bridge. No refresh token or auth relay is used.
 * Save contents are encrypted in the game page before direct upload to Drive.
 */
WML.define({
  id: 'cloud-save',
  name: '클라우드세이브 (Google Drive)',
  version: '0.6.1',
  description: 'Google 계정으로 연결해 개인 Drive에 암호화 세이브를 저장합니다. 게임 세이브는 서버를 거치지 않습니다.',
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
    let accessToken = '';
    let tokenExpiresAt = 0;
    let driveSlots = [];
    let slotsStatus = 'not-loaded'; // not-loaded | loading | loaded | error
    let slotsError = '';
    const EXPLICIT_LOGOUT_KEY = 'wml-google-drive-explicit-logout-v1';
    const HAD_AUTH_KEY = 'wml-google-drive-had-auth-v1';
    const LEGACY_SESSION_TOKEN_KEY = 'wml-google-drive-session-token-v1';
    let explicitLogout = false;
    let permissionRevoked = false;
    let hadPreviousAuth = false;
    let authStatus = 'reauth-required';
    let startupRestoreAttempted = false;
    let authAttemptSerial = 0;
    let activeAuthCancel = null;
    let driveListGeneration = 0;
    let driveListPromise = null;
    let driveListAbortController = null;
    let driveAccountMemoryKey = '';
    let driveAccountCacheIdentity = null;
    let driveMetadataCacheAvailable = false;
    let preparedSlotRead = null;
    let lastListMetrics = null;
    let driveBodyDownloadCount = 0;
    const SLOT_CACHE_KEY_PREFIX = 'wml-google-drive-slot-metadata-v1:';
    const slotMetadataMemoryCache = new Map();

    // Isolated 0.6.1 GIS page. It returns one nonce-bound access token.
    const AUTH_BRIDGE_URL = 'https://jeiky224.github.io/cloud/auth-061.html';
    const AUTH_BRIDGE_ORIGIN = 'https://jeiky224.github.io';
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

    function hasToken() {
      return !!accessToken && Date.now() < tokenExpiresAt - 30000;
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
      writeStorage(EXPLICIT_LOGOUT_KEY,
        explicitLogout ? (permissionRevoked ? 'revoked' : '1') : null);
    }
    function markExplicitLogout(revoked) {
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
      explicitLogout = true;
      permissionRevoked = true;
      hadPreviousAuth = false;
      writeStorage(HAD_AUTH_KEY, null);
      saveAuthPreferences();
      authStatus = 'permission-revoked';
    }
    explicitLogout = loadExplicitLogout();
    permissionRevoked = loadLogoutMarker() === 'revoked';
    hadPreviousAuth = loadHadPreviousAuth();
    authStatus = permissionRevoked ? 'permission-revoked' :
      (explicitLogout ? 'explicit-logout' :
        (hadPreviousAuth ? 'restore-pending' : 'reauth-required'));

    function resetDriveListState() {
      driveListGeneration += 1;
      if (driveListAbortController) {
        try { driveListAbortController.abort(); } catch (_) {}
      }
      driveListAbortController = null;
      driveListPromise = null;
      driveAccountMemoryKey = '';
      driveAccountCacheIdentity = null;
      driveMetadataCacheAvailable = false;
      driveSlots = [];
      slotsStatus = 'not-loaded';
      slotsError = '';
      preparedSlotRead = null;
    }

    function clearToken() {
      accessToken = '';
      tokenExpiresAt = 0;
      resetDriveListState();
      writeStorage(LEGACY_SESSION_TOKEN_KEY, null);
    }

    // Remove v0.5.2 refresh tokens saved on this game's origin.
    writeStorage(LEGACY_SESSION_TOKEN_KEY, null);

    function hasLogin() {
      return hasToken();
    }

    function createAuthNonce() {
      const bytes = new Uint8Array(24);
      try { globalThis.crypto.getRandomValues(bytes); }
      catch (_) { throw new Error('안전한 Google 인증 요청을 만들 수 없습니다.'); }
      return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    }

    function acceptAccessToken(payload, nonce) {
      if (!payload || payload.nonce !== nonce) {
        authStatus = 'reauth-required';
        throw new Error('Google 인증 응답의 nonce가 일치하지 않습니다.');
      }
      if (payload.type === 'wayward-cloud-auth-error') {
        if (payload.code === 'scope_missing') markPermissionRevoked();
        else if (payload.code === 'login_required' || payload.code === 'interaction_required') {
          authStatus = 'google-session-expired';
        } else if (payload.code === 'access_denied') authStatus = 'consent-denied';
        else authStatus = 'reauth-required';
        throw new Error(payload.message || 'Google 로그인이 취소되었거나 실패했습니다.');
      }
      if (payload.type !== 'wayward-cloud-auth-success' ||
          typeof payload.accessToken !== 'string' || !payload.accessToken) {
        authStatus = 'reauth-required';
        throw new Error('Google에서 유효한 액세스 토큰을 반환하지 않았습니다.');
      }
      resetDriveListState();
      accessToken = payload.accessToken;
      tokenExpiresAt = Date.now() +
        Math.max(60, Math.min(3600, Number(payload.expiresIn) || 3600)) * 1000;
      explicitLogout = false;
      permissionRevoked = false;
      hadPreviousAuth = true;
      writeStorage(HAD_AUTH_KEY, '1');
      writeStorage(EXPLICIT_LOGOUT_KEY, null);
      authStatus = 'connected';
    }

    function requestNativeGoogleToken(nonce, forceSelectAccount) {
      const host = window.WMLHost;
      const hasNativeStart = host && (
        typeof host.startGoogleDriveAuthWithPolicy === 'function' ||
        typeof host.startGoogleDriveAuth === 'function'
      );
      if (!hasNativeStart || typeof host.takePendingStateForNonce !== 'function') return null;
      // Legacy launchers cannot force SELECT_ACCOUNT, so use GIS on explicit logout.
      if (forceSelectAccount && typeof host.startGoogleDriveAuthWithPolicy !== 'function') return null;

      return new Promise((resolve, reject) => {
        let settled = false;
        let pollTimer = null;
        const deadline = Date.now() + 90000;
        const finish = (error, payload) => {
          if (settled) return;
          settled = true;
          if (pollTimer !== null) clearTimeout(pollTimer);
          if (activeAuthCancel === cancel) activeAuthCancel = null;
          if (error) reject(error);
          else {
            try { acceptAccessToken(payload, nonce); resolve(); }
            catch (failure) { reject(failure); }
          }
        };
        const cancel = () => finish(new Error('Google 인증 요청을 취소했습니다.'));
        activeAuthCancel = cancel;
        try {
          if (typeof host.startGoogleDriveAuthWithPolicy === 'function') {
            host.startGoogleDriveAuthWithPolicy(nonce, !!forceSelectAccount);
          } else host.startGoogleDriveAuth(nonce);
        } catch (error) {
          finish(new Error('Android Google 권한 요청을 시작하지 못했습니다: ' +
            String(error && error.message || error)));
          return;
        }
        const poll = () => {
          if (settled) return;
          let raw = '';
          try { raw = host.takePendingStateForNonce(nonce) || ''; }
          catch (error) {
            finish(new Error('Android Google 인증 결과를 읽지 못했습니다: ' +
              String(error && error.message || error)));
            return;
          }
          if (raw) {
            let payload;
            try { payload = JSON.parse(raw); }
            catch (_) { finish(new Error('Android Google 인증 결과 형식이 올바르지 않습니다.')); return; }
            finish(null, payload);
            return;
          }
          if (Date.now() >= deadline) {
            finish(new Error('Android Google 권한 요청 시간이 초과되었습니다. 다시 연결을 누르세요.'));
            return;
          }
          pollTimer = setTimeout(poll, 250);
        };
        poll();
      });
    }

    function requestGoogleToken(forceSelectAccount) {
      const nonce = createAuthNonce();
      const nativeTask = requestNativeGoogleToken(nonce, !!forceSelectAccount);
      if (nativeTask) return nativeTask;

      return new Promise((resolve, reject) => {
        const protocol = String(window.location.protocol || '');
        const rawOrigin = String(window.location.origin || '');
        const fileMode = protocol === 'file:' || rawOrigin === 'null';
        const gameOrigin = fileMode ? 'null' : rawOrigin;
        if (fileMode && protocol !== 'file:' && rawOrigin !== 'null') {
          reject(new Error('file:// 실행 Origin을 확인할 수 없습니다.'));
          return;
        }
        if (!fileMode) {
          try {
            const parsed = new URL(gameOrigin);
            if (!/^https?:$/.test(protocol) ||
                (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
                parsed.origin !== gameOrigin || parsed.username || parsed.password) {
              throw new Error('invalid origin');
            }
          } catch (_) {
            reject(new Error('이 실행 주소는 Google 인증 응답을 안전하게 전달할 수 없습니다.'));
            return;
          }
        }

        const bridgeUrl = new URL(AUTH_BRIDGE_URL);
        bridgeUrl.searchParams.set('origin', gameOrigin);
        bridgeUrl.searchParams.set('nonce', nonce);
        bridgeUrl.searchParams.set('login', forceSelectAccount ? 'select_account' : 'remember');

        let bridge = null, timeout = null, closeWatch = null, settled = false, helloSent = false;
        const cleanup = () => {
          window.removeEventListener('message', onMessage);
          if (timeout !== null) clearTimeout(timeout);
          if (closeWatch !== null) clearInterval(closeWatch);
          timeout = null;
          closeWatch = null;
          if (activeAuthCancel === cancel) activeAuthCancel = null;
        };
        const finishError = error => {
          if (settled) return;
          settled = true;
          cleanup();
          try { if (bridge && !bridge.closed) bridge.close(); } catch (_) {}
          reject(error instanceof Error ? error : new Error(String(error || 'Google 연결에 실패했습니다.')));
        };
        const cancel = () => finishError(new Error('Google 인증 요청을 취소했습니다.'));
        activeAuthCancel = cancel;
        const onMessage = event => {
          if (event.origin !== AUTH_BRIDGE_ORIGIN || event.source !== bridge ||
              !event.data || typeof event.data !== 'object') return;
          const payload = event.data;
          if (payload.version !== 1 || payload.nonce !== nonce) return;
          if (payload.type === 'wayward-cloud-auth-061-ready') {
            if (helloSent) return;
            helloSent = true;
            try {
              bridge.postMessage({
                type: 'wayward-cloud-auth-061-hello', version: 1, nonce
              }, AUTH_BRIDGE_ORIGIN);
            } catch (_) {
              finishError(new Error('정적 Google 인증 페이지와 보안 핸드셰이크를 완료하지 못했습니다.'));
            }
            return;
          }
          if (payload.type !== 'wayward-cloud-auth-success' &&
              payload.type !== 'wayward-cloud-auth-error') return;
          try { acceptAccessToken(payload, nonce); }
          catch (error) { finishError(error); return; }
          settled = true;
          cleanup();
          try { if (bridge && !bridge.closed) bridge.close(); } catch (_) {}
          resolve();
        };
        window.addEventListener('message', onMessage);
        try {
          // window.open must remain synchronous inside the user's click handler.
          bridge = window.open(bridgeUrl.toString(), 'waywardGoogleDriveAuth061',
            'popup=yes,width=520,height=720,resizable=yes,scrollbars=yes');
        } catch (error) {
          finishError(new Error('Google 인증 팝업을 열지 못했습니다: ' +
            String(error && error.message || error)));
          return;
        }
        if (!bridge) {
          finishError(new Error('Google 로그인 팝업이 차단되었습니다. 팝업을 허용한 뒤 다시 시도하세요.'));
          return;
        }
        timeout = setTimeout(() => finishError(new Error(
          'Google 로그인이 시간 초과되었습니다. 연결 버튼을 눌러 다시 시도하세요.'
        )), 120000);
        closeWatch = setInterval(() => {
          if (bridge && bridge.closed) {
            finishError(new Error('Google 인증 창이 닫혔습니다. [구글 계정으로 연결]을 눌러 다시 시도하세요.'));
          }
        }, 350);
      });
    }

    function attemptNativeSessionRestore() {
      if (startupRestoreAttempted || explicitLogout || !hadPreviousAuth || hasToken()) return;
      const host = window.WMLHost;
      if (!host || typeof host.startGoogleDriveAuthWithPolicy !== 'function' ||
          typeof host.takePendingStateForNonce !== 'function') return;
      startupRestoreAttempted = true;
      const attempt = ++authAttemptSerial;
      let nonce;
      try { nonce = createAuthNonce(); }
      catch (error) {
        authStatus = 'reauth-required';
        message = String(error && error.message || error);
        render();
        return;
      }
      authStatus = 'restoring';
      message = 'Android에 저장된 Google 승인 상태를 확인하고 있습니다.';
      render();
      const task = requestNativeGoogleToken(nonce, false);
      if (!task) { authStatus = 'reauth-required'; return; }
      task.then(() => refreshSlots())
        .then(() => {
          if (attempt !== authAttemptSerial) return;
          message = '기존 Google 인증 상태를 복구했습니다.';
          if (isConnected()) render();
        })
        .catch(error => {
          if (attempt !== authAttemptSerial) return;
          if (!['permission-revoked','google-session-expired','consent-denied'].includes(authStatus)) {
            authStatus = 'reauth-required';
          }
          message = String(error && error.message || error || '기존 Google 인증 상태를 복구하지 못했습니다.');
          if (isConnected()) render();
        });
    }

    async function ensureAccessToken() {
      if (hasToken()) return accessToken;
      clearToken();
      if (authStatus !== 'explicit-logout') authStatus = 'reauth-required';
      throw new Error('Google 액세스 토큰이 만료되었습니다. 연결 버튼을 눌러 다시 인증해 주세요.');
    }

    async function driveFetch(path, options) {
      await ensureAccessToken();
      const opts = Object.assign({ method: 'GET', headers: {} }, options || {});
      opts.headers = Object.assign({}, opts.headers || {});
      opts.headers.Authorization = 'Bearer ' + accessToken;
      const response = await fetch('https://www.googleapis.com' + path, opts);
      if (response.status === 401) {
        clearToken();
        authStatus = 'reauth-required';
        throw new Error('Google 액세스 토큰이 만료되었거나 Google 권한이 취소되었습니다. 연결 버튼을 눌러 재인증하세요.');
      }
      if (!response.ok) {
        let detail = '';
        let apiError = null;
        try {
          const data = await response.clone().json();
          apiError = data && data.error ? data.error : null;
          detail = apiError && apiError.message ? apiError.message : '';
          const reasons = apiError && Array.isArray(apiError.errors)
            ? apiError.errors.map(item => String(item && item.reason || ''))
            : [];
          if (response.status === 403 &&
              (apiError.status === 'PERMISSION_DENIED' || reasons.includes('insufficientPermissions'))) {
            markPermissionRevoked();
          }
        } catch (_) { /* response body may not be JSON */ }
        throw new Error('Google Drive 요청 실패 (' + response.status + ')' +
          (detail ? ': ' + detail : ''));
      }
      return response;
    }

    async function accountCacheStorageKey(permissionId) {
      if (!permissionId || !globalThis.crypto || !globalThis.crypto.subtle ||
          typeof TextEncoder !== 'function') return '';
      try {
        const digest = await globalThis.crypto.subtle.digest(
          'SHA-256', new TextEncoder().encode(String(permissionId))
        );
        return SLOT_CACHE_KEY_PREFIX + Array.from(new Uint8Array(digest), byte =>
          byte.toString(16).padStart(2, '0')).join('');
      } catch (_) {
        return '';
      }
    }

    function validateMetadataCache(value) {
      if (!Array.isArray(value) || value.length > 1000) return null;
      const output = [];
      for (const item of value) {
        if (!item || typeof item !== 'object' ||
            typeof item.id !== 'string' || !item.id ||
            typeof item.name !== 'string' ||
            !/^wayward-cloud-slot-[1-9][0-9]*\.json$/.test(item.name)) return null;
        output.push({
          id: item.id,
          name: item.name,
          modifiedTime: String(item.modifiedTime || ''),
          size: Math.max(0, Number(item.size) || 0),
          mimeType: String(item.mimeType || 'application/json')
        });
      }
      return output;
    }

    async function resolveDriveAccountCache() {
      if (driveAccountCacheIdentity) {
        return Object.assign({ apiCalls: 0 }, driveAccountCacheIdentity);
      }
      try {
        const response = await driveFetch('/drive/v3/about?fields=user(permissionId)');
        const about = await response.json();
        const permissionId = String(about && about.user && about.user.permissionId || '');
        if (!permissionId) return { memoryKey: '', storageKey: '', apiCalls: 1 };
        driveAccountCacheIdentity = {
          memoryKey: permissionId,
          storageKey: await accountCacheStorageKey(permissionId)
        };
        return Object.assign({ apiCalls: 1 }, driveAccountCacheIdentity);
      } catch (_) {
        // Account metadata is an optional cache optimization. A failure here
        // must not prevent the actual appDataFolder list request from working.
        return { memoryKey: '', storageKey: '', apiCalls: 1 };
      }
    }

    function readAccountSlotCache(cacheKey) {
      if (!cacheKey || !cacheKey.memoryKey) return null;
      const memory = slotMetadataMemoryCache.get(cacheKey.memoryKey);
      if (memory) return validateMetadataCache(memory);
      if (!cacheKey.storageKey) return null;
      const raw = readStorage(cacheKey.storageKey);
      if (!raw) return null;
      try {
        const parsed = validateMetadataCache(JSON.parse(raw));
        if (parsed) slotMetadataMemoryCache.set(cacheKey.memoryKey, parsed);
        return parsed;
      } catch (_) {
        return null;
      }
    }

    function writeAccountSlotCache(cacheKey, files) {
      if (!cacheKey || !cacheKey.memoryKey) return;
      const safeFiles = validateMetadataCache(files);
      if (!safeFiles) return;
      slotMetadataMemoryCache.set(cacheKey.memoryKey, safeFiles);
      if (cacheKey.storageKey) writeStorage(cacheKey.storageKey, JSON.stringify(safeFiles));
    }

    function refreshSlots() {
      if (driveListPromise) return driveListPromise;
      const generation = ++driveListGeneration;
      const now = () => typeof performance !== 'undefined' && performance.now
        ? performance.now() : Date.now();
      const startedAt = now();
      const bodyCountAtStart = driveBodyDownloadCount;
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      driveListAbortController = controller;
      const requestOptions = controller ? { signal: controller.signal } : undefined;
      slotsStatus = 'loading';
      slotsError = '';
      driveMetadataCacheAvailable = false;
      if (isConnected()) render();

      const task = (async () => {
        let apiCalls = 0;
        let responseBytes = 0;
        let pageCount = 0;
        try {
          // Fetch the account namespace and list in parallel. Cache keys are a
          // SHA-256 digest of Drive permissionId, never an email or access token.
          const accountTask = (async () => {
            const cache = await resolveDriveAccountCache();
            apiCalls += Number(cache.apiCalls) || 0;
            return cache;
          })();
          const listTask = (async () => {
            const files = new Map();
            let pageToken = '';
            do {
              if (generation !== driveListGeneration) return null;
              const params = new URLSearchParams({
                spaces: 'appDataFolder',
                pageSize: '1000',
                q: 'trashed = false',
                fields: 'files(id,name,mimeType,modifiedTime,size),nextPageToken'
              });
              if (pageToken) params.set('pageToken', pageToken);
              apiCalls += 1;
              pageCount += 1;
              const response = await driveFetch(
                '/drive/v3/files?' + params.toString(), requestOptions
              );
              const data = await response.json();
              const raw = JSON.stringify(data);
              try { responseBytes += new TextEncoder().encode(raw).length; }
              catch (_) { responseBytes += raw.length; }
              for (const file of (Array.isArray(data.files) ? data.files : [])) {
                const match = new RegExp('^' + FILE_PREFIX + '([1-9][0-9]*)\\.json$')
                  .exec(String(file.name || ''));
                if (!match || !file.id) continue;
                const slot = Number(match[1]);
                if (!Number.isSafeInteger(slot) || slot < 1) continue;
                const previous = files.get(slot);
                if (!previous || String(file.modifiedTime || '') > String(previous.modifiedTime || '')) {
                  files.set(slot, {
                    id: String(file.id),
                    name: String(file.name),
                    mimeType: String(file.mimeType || 'application/json'),
                    modifiedTime: String(file.modifiedTime || ''),
                    size: Math.max(0, Number(file.size) || 0)
                  });
                }
              }
              pageToken = data.nextPageToken || '';
            } while (pageToken);
            return Array.from(files.values()).sort((a, b) =>
              Number(a.name.match(/([0-9]+)\.json$/)[1]) -
              Number(b.name.match(/([0-9]+)\.json$/)[1])
            );
          })();

          const cacheKey = await accountTask;
          if (generation !== driveListGeneration) return [];
          driveAccountMemoryKey = cacheKey.memoryKey;
          if (!driveSlots.length) {
            const cached = readAccountSlotCache(cacheKey);
            if (cached) {
              driveSlots = cached;
              driveMetadataCacheAvailable = true;
              if (isConnected()) render();
            }
          }

          const freshFiles = await listTask;
          if (generation !== driveListGeneration || !freshFiles) return [];
          driveSlots = freshFiles;
          driveMetadataCacheAvailable = false;
          writeAccountSlotCache(cacheKey, freshFiles);
          slotsStatus = 'loaded';
          slotsError = '';
          lastListMetrics = {
            apiCalls,
            pageCount,
            responseBytes,
            bodyDownloads: driveBodyDownloadCount - bodyCountAtStart,
            slotCount: freshFiles.length,
            durationMs: Math.max(0, Math.round(now() - startedAt))
          };
          try {
            if (typeof console !== 'undefined' && console.info) {
              console.info('[Wayward CloudSave] metadata list metrics', lastListMetrics);
            }
          } catch (_) {}
          if (isConnected()) render();
          return driveSlots;
        } catch (error) {
          if (generation !== driveListGeneration || (error && error.name === 'AbortError')) return [];
          slotsStatus = 'error';
          slotsError = String(error && error.message || error || '저장목록을 확인하지 못했습니다.');
          if (isConnected()) render();
          throw error;
        } finally {
          if (generation === driveListGeneration && driveListAbortController === controller) {
            driveListAbortController = null;
          }
        }
      })();

      let tracked;
      tracked = task.finally(() => {
        if (driveListPromise === tracked) driveListPromise = null;
      });
      driveListPromise = tracked;
      return tracked;
    }

    function currentFile(slot) {
      return driveSlots.find(file => file.name === FILE_PREFIX + slot + '.json') || null;
    }

    async function readSlotEnvelope(file) {
      driveBodyDownloadCount += 1;
      const response = await driveFetch('/drive/v3/files/' + encodeURIComponent(file.id) + '?alt=media');
      return response.json();
    }

    async function writeSlotEnvelope(slot, envelope) {
      const existing = currentFile(slot);
      const body = JSON.stringify(envelope);
      if (existing) {
        await driveFetch('/upload/drive/v3/files/' + encodeURIComponent(existing.id) + '?uploadType=media', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json; charset=UTF-8' },
          body
        });
      } else {
        const boundary = 'wml_drive_' + Math.random().toString(16).slice(2) + Date.now().toString(16);
        const metadata = {
          name: FILE_PREFIX + slot + '.json',
          mimeType: 'application/json',
          parents: ['appDataFolder']
        };
        const multipart =
          '--' + boundary + '\r\n' +
          'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
          JSON.stringify(metadata) + '\r\n' +
          '--' + boundary + '\r\n' +
          'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
          body + '\r\n' +
          '--' + boundary + '--';
        await driveFetch('/upload/drive/v3/files?uploadType=multipart', {
          method: 'POST',
          headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
          body: multipart
        });
      }
      await refreshSlots();
    }

    async function deleteSlot(slot) {
      const file = currentFile(slot);
      if (!file) throw new Error('삭제할 저장 파일을 찾지 못했습니다.');
      await driveFetch('/drive/v3/files/' + encodeURIComponent(file.id), { method: 'DELETE' });
      preparedSlotRead = null;
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
        // Android can restore an already-approved grant at initialization.
        // Browser GIS is user-gesture gated, so its restore is offered as a
        // one-click action rather than auto-opening a blocked popup.
        attemptNativeSessionRestore();
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

    function connectFromClick() {
      if (busy) return;
      if (activeAuthCancel) {
        const cancel = activeAuthCancel;
        activeAuthCancel = null;
        try { cancel(); } catch (_) {}
      }
      const attempt = ++authAttemptSerial;
      const forceSelectAccount = explicitLogout;
      let task;
      try { task = requestGoogleToken(forceSelectAccount); }
      catch (error) { task = Promise.reject(error); }
      authStatus = 'authenticating';
      busy = true;
      message = 'Google 계정 인증을 여는 중…';
      render();
      Promise.resolve(task)
        .then(() => {
          if (attempt !== authAttemptSerial) return [];
          return refreshSlots();
        })
        .then(() => {
          if (attempt !== authAttemptSerial) return;
          show({ page: 'home' }, 'Google Drive에 연결했습니다.');
        })
        .catch(error => {
          if (attempt !== authAttemptSerial) return;
          if (!hasToken() && !['permission-revoked','google-session-expired','consent-denied'].includes(authStatus)) {
            authStatus = explicitLogout ? 'explicit-logout' : 'reauth-required';
          }
          message = String(error && error.message || error || 'Google 연결에 실패했습니다.');
          render();
        })
        .finally(() => {
          if (attempt !== authAttemptSerial) return;
          busy = false;
          if (isConnected()) render();
        });
    }

    function requestBrowserTokenRevocation(token) {
      const host = window.WMLHost;
      if (host && typeof host.clearGoogleAccessToken === 'function') {
        try { host.clearGoogleAccessToken(token); } catch (_) {}
        // The Android native bridge clears its cached grant; it does not report
        // Google web-token revocation as a completed GIS revoke operation.
        return Promise.resolve(false);
      }
      if (!token) return Promise.resolve(false);
      return new Promise(resolve => {
        const nonceBytes = new Uint8Array(24);
        try { globalThis.crypto.getRandomValues(nonceBytes); }
        catch (_) { resolve(false); return; }
        const nonce = Array.from(nonceBytes, byte => byte.toString(16).padStart(2, '0')).join('');
        const protocol = String(window.location.protocol || '');
        const rawOrigin = String(window.location.origin || '');
        const fileMode = protocol === 'file:' || rawOrigin === 'null';
        const gameOrigin = fileMode ? 'null' : rawOrigin;
        if (!fileMode && !/^https?:$/.test(protocol)) {
          resolve(false);
          return;
        }
        const revokeUrl = new URL(AUTH_BRIDGE_URL);
        revokeUrl.searchParams.set('mode', 'revoke');
        revokeUrl.searchParams.set('origin', gameOrigin);
        revokeUrl.searchParams.set('nonce', nonce);
        let popup = null, timer = null, closeWatch = null, settled = false, helloSent = false;
        const cleanup = () => {
          window.removeEventListener('message', onMessage);
          if (timer !== null) clearTimeout(timer);
          if (closeWatch !== null) clearInterval(closeWatch);
          timer = null;
          closeWatch = null;
        };
        const finish = result => {
          if (settled) return;
          settled = true;
          cleanup();
          try { if (popup && !popup.closed) popup.close(); } catch (_) {}
          resolve(result === true);
        };
        const onMessage = event => {
          if (event.origin !== AUTH_BRIDGE_ORIGIN || event.source !== popup ||
              !event.data || event.data.nonce !== nonce || event.data.version !== 1) return;
          if (event.data.type === 'wayward-cloud-auth-061-ready') {
            if (helloSent) return;
            helloSent = true;
            try {
              popup.postMessage({
                type: 'wayward-cloud-auth-061-hello', version: 1, nonce
              }, AUTH_BRIDGE_ORIGIN);
            } catch (_) { finish(false); }
          } else if (event.data.type === 'wayward-cloud-revoke-ready') {
            try {
              popup.postMessage({
                type: 'wayward-cloud-revoke', version: 1, nonce, accessToken: token
              }, AUTH_BRIDGE_ORIGIN);
            } catch (_) { finish(false); }
          } else if (event.data.type === 'wayward-cloud-revoke-result') {
            finish(event.data.revoked === true);
          }
        };
        window.addEventListener('message', onMessage);
        try {
          popup = window.open(revokeUrl.toString(), 'waywardGoogleDriveRevoke061',
            'popup=yes,width=520,height=520,resizable=yes,scrollbars=yes');
        } catch (_) { finish(false); return; }
        if (!popup) { finish(false); return; }
        timer = setTimeout(() => finish(false), 30000);
        closeWatch = setInterval(() => {
          if (popup && popup.closed) finish(false);
        }, 350);
      });
    }

    function logoutGoogleAccount() {
      authAttemptSerial += 1;
      if (activeAuthCancel) {
        const cancel = activeAuthCancel;
        activeAuthCancel = null;
        try { cancel(); } catch (_) {}
      }
      busy = false;
      const savedAccessToken = accessToken;
      const host = window.WMLHost;
      if (savedAccessToken && host && typeof host.clearGoogleAccessToken === 'function') {
        try { host.clearGoogleAccessToken(savedAccessToken); } catch (_) {}
      }
      clearToken();
      markExplicitLogout(false);
      show({ page: 'home' },
        '로그아웃했습니다. 다음 연결에서는 Google 계정 선택 화면을 표시합니다. Google 앱 권한은 유지됩니다.');
    }

    function requestNativeGoogleRevoke() {
      const host = window.WMLHost;
      if (!host || typeof host.revokeGoogleDriveAccess !== 'function' ||
          typeof host.takePendingStateForNonce !== 'function') return null;
      const nonce = createAuthNonce();
      return new Promise((resolve, reject) => {
        let settled = false;
        const deadline = Date.now() + 60000;
        const finish = (error, payload) => {
          if (settled) return;
          settled = true;
          if (error) reject(error);
          else if (payload && payload.nonce === nonce && payload.type === 'wayward-cloud-revoke-result') {
            resolve(payload.revoked === true);
          } else reject(new Error('Android Google 권한 철회 응답이 올바르지 않습니다.'));
        };
        try { host.revokeGoogleDriveAccess(nonce); }
        catch (error) {
          finish(new Error('Android Google 권한 철회를 시작하지 못했습니다: ' +
            String(error && error.message || error)));
          return;
        }
        const poll = () => {
          if (settled) return;
          let raw = '';
          try { raw = host.takePendingStateForNonce(nonce) || ''; }
          catch (error) { finish(new Error('Android 권한 철회 결과를 읽지 못했습니다: ' + String(error))); return; }
          if (raw) {
            try { finish(null, JSON.parse(raw)); }
            catch (_) { finish(new Error('Android 권한 철회 응답 JSON이 올바르지 않습니다.')); }
            return;
          }
          if (Date.now() >= deadline) {
            finish(new Error('Android Google 권한 철회 요청 시간이 초과되었습니다.'));
            return;
          }
          setTimeout(poll, 250);
        };
        poll();
      });
    }

    async function revokeGooglePermission() {
      const savedAccessToken = accessToken;
      const host = window.WMLHost;
      let revoked = false;
      let failure = '';
      try {
        if (host && typeof host.revokeGoogleDriveAccess === 'function') {
          revoked = await requestNativeGoogleRevoke();
        } else if (savedAccessToken) {
          revoked = await requestBrowserTokenRevocation(savedAccessToken);
        } else failure = '권한 철회에 사용할 유효한 액세스 토큰이 없습니다.';
      } catch (error) {
        failure = String(error && error.message || error || 'Google 권한 철회에 실패했습니다.');
      }
      if (savedAccessToken && host && typeof host.clearGoogleAccessToken === 'function') {
        try { host.clearGoogleAccessToken(savedAccessToken); } catch (_) {}
      }
      clearToken();
      markExplicitLogout(revoked);
      show({ page: 'home' }, revoked
        ? 'Google 앱 권한 철회를 완료하고 이 기기의 로그인 정보도 삭제했습니다.'
        : '이 기기의 로그인 정보는 삭제했습니다. Google 권한 철회는 확인되지 않았습니다.' +
          (failure ? ' (' + failure + ')' : ''));
    }

    async function saveSlot(slot) {
      const snapshot = buildSnapshot();
      snapshot.memo = String(fields.memo && fields.memo.value || '').trim();
      const envelope = await globalThis.WMLGoogleDriveCrypto.encryptSnapshotEmbedded(snapshot);
      await writeSlotEnvelope(slot, envelope);
      preparedSlotRead = null;
      show({ page: 'home' }, '저장 슬롯 ' + slot + '에 자동 암호화하여 저장했습니다.');
    }

    async function prepareSaveSlot(slot) {
      const file = currentFile(slot);
      let memo = '';
      if (file) {
        // Memo is inside the encrypted snapshot. Download only the slot the user
        // explicitly selected for overwrite; never fetch slot bodies for the list.
        const envelope = await readSlotEnvelope(file);
        if (envelope && envelope.keyMode === 'embedded-addon-v2') {
          const snapshot = await globalThis.WMLGoogleDriveCrypto.decryptSnapshotEmbedded(envelope);
          memo = String(snapshot.memo || '');
        }
      }
      show({ page: 'save', slot, memo });
    }

    async function prepareLoadSlot(slot) {
      const file = currentFile(slot); if (!file) throw new Error('저장 슬롯이 비어 있습니다.');
      const envelope = await readSlotEnvelope(file);
      preparedSlotRead = {
        slot, fileId: file.id, modifiedTime: file.modifiedTime, envelope
      };
      show({ page: envelope && envelope.keyMode === 'embedded-addon-v2' ? 'load' : 'legacy-load', slot },
        envelope && envelope.keyMode === 'embedded-addon-v2' ? '' : '이전 암호화 세이브입니다. 저장 당시 암호를 입력하면 자동 암호화 형식으로 변환됩니다.');
    }
    async function loadSlot(slot) {
      const file = currentFile(slot); if (!file) throw new Error('저장 슬롯이 비어 있습니다.');
      let envelope;
      if (preparedSlotRead && preparedSlotRead.slot === slot &&
          preparedSlotRead.fileId === file.id &&
          preparedSlotRead.modifiedTime === file.modifiedTime && preparedSlotRead.envelope) {
        envelope = preparedSlotRead.envelope;
      } else {
        envelope = await readSlotEnvelope(file);
      }
      preparedSlotRead = null;
      let snapshot;
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
      preparedSlotRead = null;
      show({ page: 'home' }, '저장 슬롯 ' + slot + '을 삭제했습니다.');
    }

    function formatSlotMetadata(file) {
      const parts = [];
      const timestamp = Date.parse(String(file && file.modifiedTime || ''));
      if (Number.isFinite(timestamp)) {
        parts.push(new Date(timestamp).toLocaleString('ko-KR', {
          month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
        }));
      }
      const size = Number(file && file.size) || 0;
      if (size > 0) {
        parts.push(size < 1024 * 1024
          ? Math.max(1, Math.round(size / 1024)) + ' KB'
          : (size / (1024 * 1024)).toFixed(1) + ' MB');
      }
      return parts.join(' · ');
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
      const bySlot = new Map(driveSlots.map(file => [
        Number(file.name.match(/([0-9]+)\.json$/)[1]), file
      ]));
      const used = new Set(bySlot.keys());
      let nextSlot = 1;
      while (used.has(nextSlot)) nextSlot++;
      const slots = Array.from(bySlot.keys()).sort((a, b) => a - b);
      if (!used.has(nextSlot)) slots.push(nextSlot);

      for (const slot of slots) {
        const file = bySlot.get(slot);
        const row = h('div', { class: 'wml-gd-slot' });
        const head = h('div', { class: 'wml-gd-slot-head' });
        const line = h('div', { class: 'wml-gd-slot-line' });
        line.append(h('div', { class: 'wml-gd-slot-title' }, '저장 슬롯 ' + slot));
        head.append(line);
        head.append(h('div', { class: 'wml-gd-small' }, file ? '저장됨' : '저장된 게임이 없습니다.'));
        row.append(head);
        if (file) {
          const metadata = formatSlotMetadata(file);
          if (metadata) row.append(h('div', { class: 'wml-gd-summary' }, metadata));
        }
        const actions = h('div', { class: 'wml-gd-actions' });
        actions.append(button(file ? '덮어쓰기' : '저장', () =>
          file ? runAction(() => prepareSaveSlot(slot)) : show({ page: 'save', slot, memo: '' }),
          { primary: true }));
        if (file) {
          actions.append(button('불러오기', () => runAction(() => prepareLoadSlot(slot))));
          actions.append(button('삭제', () => show({ page: 'delete', slot })));
        }
        row.append(actions);
        root.append(row);
      }
    }

    function renderView(root) {
      if (view.page === 'home') {
        addTitle(root, '개인 Google Drive 세이브');
        addText(root,
          'Google 계정을 연결하면 현재 진행 상황이 암호화되어 Drive에 직접 저장됩니다.');
        addButton(root, hasLogin() ? '저장 목록 새로고침' : '구글 계정으로 연결',
          hasLogin() ? () => runAction(async () => {
            await refreshSlots();
            show({ page: 'home' }, '저장목록을 새로고침했습니다.');
          }) : connectFromClick, true);
        // Logout remains usable during an authentication attempt so it can cancel it.
        addButton(root, '로그아웃', () => logoutGoogleAccount());

        if (hasLogin()) {
          if (slotsStatus === 'loaded') {
            renderSlots(root);
            if (lastListMetrics) {
              addText(root, '목록 ' + lastListMetrics.slotCount + '개 · ' +
                lastListMetrics.durationMs + ' ms · API ' + lastListMetrics.apiCalls + '회',
                'wml-gd-small');
            }
          } else if (slotsStatus === 'loading') {
            if (driveMetadataCacheAvailable || driveSlots.length) {
              addText(root, '저장목록 최신 상태를 확인하고 있습니다…', 'wml-gd-small');
              renderSlots(root);
            } else addText(root, '저장목록을 확인하고 있습니다…');
          } else if (slotsStatus === 'error') {
            if (driveMetadataCacheAvailable || driveSlots.length) renderSlots(root);
            addText(root, '최신 저장목록을 확인하지 못했습니다. 다시 시도해 주세요.');
            addButton(root, '저장목록 새로고침', () => runAction(() => refreshSlots()), true);
          } else {
            addText(root, '저장목록을 확인하려면 새로고침을 누르세요.');
            addButton(root, '저장목록 새로고침', () => runAction(() => refreshSlots()), true);
          }
        } else {
          const stateText = {
            restoring: 'Android 런처에 저장된 Google 승인 상태를 확인하고 있습니다.',
            'restore-pending': '이전에 연결한 Google 계정의 승인 상태를 다시 확인할 수 있습니다.',
            'explicit-logout': '로그아웃했습니다. 다음 연결은 Google 계정 선택 화면을 사용합니다.',
            'reauth-required': 'Google 계정 연결이 필요합니다.',
            'google-session-expired': 'Google 계정 세션이 만료되었습니다. 다시 연결해 주세요.',
            'consent-denied': 'Google 인증이 취소되거나 권한 승인이 거부되었습니다. 다시 연결할 수 있습니다.',
            'permission-revoked': 'Google Drive 권한이 해제되었습니다. Drive 권한을 다시 승인해야 합니다.',
            authenticating: 'Google 인증을 진행하고 있습니다.'
          };
          addText(root, stateText[authStatus] || 'Google 계정 연결이 필요합니다.', 'wml-gd-small');
        }
        addMessage(root);
      } else if (view.page === 'save') {
        addTitle(root, '저장 슬롯 ' + view.slot + ' 저장');
        addText(root, '저장할 때 자동으로 암호화됩니다. 메모는 비워 두어도 저장됩니다.');
        const memoWrap = h('label', { class: 'wml-gd-field' }, '저장 메모 (선택 사항)');
        const memoInput = document.createElement('textarea'); memoInput.className = 'wml-gd-memo-area'; memoInput.maxLength = 2000;
        memoInput.placeholder = '';
        memoInput.value = Object.prototype.hasOwnProperty.call(drafts, 'memo') ? drafts.memo : String(view.memo || '');
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




