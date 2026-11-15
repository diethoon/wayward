/* Personal Google Drive-backed cloud saves for WML.
 * HTTP/HTTPS browsers use Google's direct GIS Token Model from the game page.
 * Android may use the launcher's existing native Google Identity bridge.
 * Standalone PC file:// browsers fail closed: CloudSave does not depend on a
 * launcher, local/remote server, hosted auth relay, or opaque-Origin messaging.
 * Save contents are encrypted in the game page before direct upload to Drive.
 */
WML.define({
  id: 'cloud-save',
  name: '클라우드세이브 (Google Drive)',
  version: '0.6.2',
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
    let sessionGeneration = 0;
    const driveRequestControllers = new Set();
    let driveListGeneration = 0;
    let driveListPromise = null;
    let driveListAbortController = null;
    let driveAccountMemoryKey = '';
    let driveAccountCacheIdentity = null;
    let driveMetadataCacheAvailable = false;
    let preparedSlotRead = null;
    let lastListMetrics = null;
    let activeMemoDialog = null;
    let previewObserver = null;
    let previewTargets = new WeakMap();
    let previewLoadPromises = new Map();
    let previewCache = new Map();
    let drivePreviewDownloadCount = 0;
    let driveBodyDownloadCount = 0;
    let authStartedAt = 0;
    let authCompletedAt = 0;
    const SLOT_CACHE_KEY_PREFIX = 'wml-google-drive-slot-metadata-v1:';
    const slotMetadataMemoryCache = new Map();

    const GOOGLE_OAUTH_CLIENT_ID = '35944231952-p82giir62o28bo001j9uvmqo3kgp9c99.apps.googleusercontent.com';
    const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
    const nativeAuthHost = window.WMLHost || null;
    // WMLHost presence identifies the embedded launcher even when this
    // particular runtime has not exposed the CloudSave auth methods yet.
    // Keep it on the native adapter and fail closed; never fall through to GIS.
    const nativeLauncherContext = !!nativeAuthHost;
    const initialProtocol = String(window.location && window.location.protocol || '');
    const initialOrigin = String(window.location && window.location.origin || '');
    const fileOrigin = initialProtocol === 'file:' || initialOrigin === 'null';
    // Freeze the adapter once; account-selection policy never changes transport.
    const AUTH_ADAPTER = nativeLauncherContext ? 'android-native' :
      (fileOrigin ? 'file-bridge' : 'browser-gis');
    const FILE_AUTH_BRIDGE_URL = 'https://wayward-six.vercel.app/auth-page/index.html';
    const FILE_AUTH_BRIDGE_ORIGIN = 'https://wayward-six.vercel.app';
    const FILE_AUTH_BRIDGE_VERSION = 2;
    let browserGISLoadPromise = null;
    let browserGISLoadError = '';
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
        '.wml-gd-memo-box{box-sizing:border-box;max-width:min(92vw,480px);max-height:75vh;overflow:auto;padding:16px 18px;border:1px solid var(--wml-border,#7778);border-radius:10px;background:var(--wml-panel,Canvas);color:var(--wml-text,CanvasText);white-space:pre-wrap;overflow-wrap:anywhere;box-shadow:0 8px 30px #0005}';
      document.head.appendChild(style);
    }

    function hasToken() {
      return !!accessToken && Date.now() < tokenExpiresAt - 30000;
    }

    function isGoogleIdentityReady() {
      return !!(window.google && window.google.accounts && window.google.accounts.oauth2 &&
        typeof window.google.accounts.oauth2.initTokenClient === 'function');
    }

    function loadGoogleIdentity() {
      if (isGoogleIdentityReady()) return Promise.resolve();
      if (browserGISLoadPromise) return browserGISLoadPromise;
      browserGISLoadPromise = new Promise((resolve, reject) => {
        let settled = false, timer = null;
        const finish = error => { if (settled) return; settled = true; if (timer !== null) clearTimeout(timer); error ? reject(error) : resolve(); };
        let script = document.querySelector('script[data-wml-cloudsave-gis="true"]');
        if (!script) {
          script = document.createElement('script');
          script.src = 'https://accounts.google.com/gsi/client';
          script.async = true; script.defer = true;
          script.setAttribute('data-wml-cloudsave-gis', 'true');
        }
        script.addEventListener('load', () => finish(isGoogleIdentityReady() ? null : new Error('Google Identity 라이브러리를 초기화하지 못했습니다.')), { once: true });
        script.addEventListener('error', () => finish(new Error('Google Identity 라이브러리를 불러오지 못했습니다.')), { once: true });
        timer = setTimeout(() => finish(new Error('Google Identity 라이브러리 로딩 시간이 초과되었습니다.')), 10000);
        if (!script.isConnected) document.head.appendChild(script);
        if (isGoogleIdentityReady()) finish();
      }).catch(error => { browserGISLoadPromise = null; browserGISLoadError = String(error && error.message || error); throw error; });
      return browserGISLoadPromise;
    }

    if (AUTH_ADAPTER === 'browser-gis') {
      try { await loadGoogleIdentity(); }
      catch (error) { browserGISLoadError = String(error && error.message || error); }
    }

    function isCurrentAuthAttempt(attempt, sessionAtStart) {
      return attempt === authAttemptSerial && sessionAtStart === sessionGeneration;
    }

    function readStorage(key) {
      try {
        const value = window.localStorage.getItem(key);
        if (value != null) return value;
      } catch (_) {}
      try { return window.sessionStorage.getItem(key); }
      catch (_) { return null; }
    }
    function writeStorage(key, value) {
      let stored = false;
      try {
        if (value == null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, value);
        stored = true;
      } catch (_) {}
      try {
        if (value == null) window.sessionStorage.removeItem(key);
        else window.sessionStorage.setItem(key, value);
        stored = true;
      } catch (_) {}
      return stored;
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
      // A user logout must disable restore independently of the logout marker.
      hadPreviousAuth = false;
      writeStorage(HAD_AUTH_KEY, null);
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
      if (driveListAbortController) {        try { driveListAbortController.abort(); } catch (_) {}
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

    function invalidateDriveSession() {
      sessionGeneration += 1;
      for (const controller of driveRequestControllers) {
        try { controller.abort(); } catch (_) {}
      }
      driveRequestControllers.clear();
      if (previewObserver) {
        try { previewObserver.disconnect(); } catch (_) {}
        previewObserver = null;
      }
      previewLoadPromises.clear();
      previewCache.clear();
      if (activeMemoDialog) closeMemoPopup();
    }

    function assertDriveSession(generation) {
      if (generation !== sessionGeneration) {
        throw new Error('Google 계정 세션이 변경되어 진행 중인 작업을 취소했습니다.');
      }
      if (!hasToken()) {
        throw new Error('Google 액세스 토큰이 만료되었습니다. 다시 연결해 주세요.');
      }
    }

    function clearToken() {
      invalidateDriveSession();
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
      const expiresIn = Number(payload.expiresIn);
      if (payload.type !== 'wayward-cloud-auth-success' ||
          typeof payload.accessToken !== 'string' ||
          payload.accessToken.length < 16 || payload.accessToken.length > 8192 ||
          !Number.isFinite(expiresIn) || expiresIn < 60 || expiresIn > 7200) {
        authStatus = 'reauth-required';
        throw new Error('Google에서 유효한 액세스 토큰 응답을 반환하지 않았습니다.');
      }
      invalidateDriveSession();
      resetDriveListState();
      accessToken = payload.accessToken;
      authCompletedAt = Date.now();
      tokenExpiresAt = Date.now() + Math.min(3600, expiresIn) * 1000;
      explicitLogout = false;
      permissionRevoked = false;
      hadPreviousAuth = true;
      writeStorage(HAD_AUTH_KEY, '1');
      writeStorage(EXPLICIT_LOGOUT_KEY, null);
      authStatus = 'connected';
    }

    function requestNativeGoogleToken(nonce, forceSelectAccount, attempt, sessionAtStart) {
      if (AUTH_ADAPTER !== 'android-native') return null;
      const host = nativeAuthHost;
      if (!host || typeof host.takePendingStateForNonce !== 'function')
        return Promise.reject(new Error('Android 네이티브 Google 결과 조회 API를 사용할 수 없습니다. 웹 인증으로 전환하지 않았습니다.'));
      const hasPolicyStart = typeof host.startGoogleDriveAuthWithPolicy === 'function';
      const hasLegacyStart = typeof host.startGoogleDriveAuth === 'function';
      if (!hasPolicyStart && !hasLegacyStart)
        return Promise.reject(new Error('Android 네이티브 Google 인증 시작 API를 사용할 수 없습니다. 웹 인증으로 전환하지 않았습니다.'));
      if (forceSelectAccount && !hasPolicyStart)
        return Promise.reject(new Error('현재 Android 런처는 Google 계정 선택 정책 API를 제공하지 않습니다. 런처 인증 통합 후 다시 시도하세요. 웹 인증이나 자동 로그인으로 대체하지 않았습니다.'));
      const canCancel = typeof host.cancelGoogleDriveAuth === 'function';
      return new Promise((resolve, reject) => {
        let settled = false, pollTimer = null;
        const deadline = Date.now() + (canCancel ? 90000 : 180000);
        const finish = (error, payload) => {
          if (settled) return; settled = true;
          if (pollTimer !== null) clearTimeout(pollTimer);
          if (activeAuthCancel === cancel) activeAuthCancel = null;
          if (error) { if (canCancel) { try { host.cancelGoogleDriveAuth(nonce); } catch (_) {} } reject(error); return; }
          if (!isCurrentAuthAttempt(attempt, sessionAtStart)) {
            if (canCancel) { try { host.cancelGoogleDriveAuth(nonce); } catch (_) {} }
            reject(new Error('이전 Android 인증 응답을 무시했습니다.')); return;
          }
          try { acceptAccessToken(payload, nonce); resolve(); }
          catch (failure) { if (canCancel) { try { host.cancelGoogleDriveAuth(nonce); } catch (_) {} } reject(failure); }
        };
        const cancel = () => finish(new Error('Google 인증 요청을 취소했습니다.'));
        activeAuthCancel = cancel;
        try {
          if (hasPolicyStart) host.startGoogleDriveAuthWithPolicy(nonce, !!forceSelectAccount);
          else host.startGoogleDriveAuth(nonce); // Only non-picker restoration/re-auth may use the legacy API.
        } catch (error) { finish(new Error('Android Google 권한 요청을 시작하지 못했습니다: ' + String(error && error.message || error))); return; }
        const poll = () => {
          if (settled) return;
          if (!isCurrentAuthAttempt(attempt, sessionAtStart)) { finish(new Error('Android 인증 세션이 변경되어 이전 요청을 취소했습니다.')); return; }
          let raw = '';
          try { raw = host.takePendingStateForNonce(nonce) || ''; }
          catch (error) { finish(new Error('Android Google 인증 결과를 읽지 못했습니다: ' + String(error && error.message || error))); return; }
          if (raw) {
            let payload;
            try { payload = JSON.parse(raw); } catch (_) { finish(new Error('Android Google 인증 결과 형식이 올바르지 않습니다.')); return; }
            finish(null, payload); return;
          }
          if (Date.now() >= deadline) { finish(new Error('Android Google 권한 요청 시간이 초과되었습니다. 다시 연결을 누르세요.')); return; }
          pollTimer = setTimeout(poll, 250);
        };
        poll();
      });
    }
    function validateDirectGISOrigin() {
      const protocol = String(window.location.protocol || '');
      const origin = String(window.location.origin || '');
      if (protocol === 'file:' || origin === 'null') {
        throw new Error('Google GIS 직접 인증에 사용할 수 없는 게임 Origin입니다.');
      }
      let parsed;
      try { parsed = new URL(origin); } catch (_) { throw new Error('현재 게임 Origin을 확인할 수 없습니다.'); }
      if (parsed.origin !== origin || parsed.username || parsed.password || origin === 'null')
        throw new Error('Google GIS 직접 인증에 사용할 수 없는 게임 Origin입니다.');
      const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
      if (protocol !== 'https:' && !(protocol === 'http:' && loopback))
        throw new Error('Google GIS 직접 인증은 HTTPS가 필요합니다. HTTP는 localhost/loopback에서만 허용됩니다.');
      return origin;
    }

    function requestBrowserGoogleToken(nonce, forceSelectAccount, attempt, sessionAtStart) {
      try { validateDirectGISOrigin(); } catch (error) { return Promise.reject(error); }
      if (!isGoogleIdentityReady()) return Promise.reject(new Error(browserGISLoadError || 'Google Identity 라이브러리가 준비되지 않았습니다. CloudSave를 다시 여세요.'));
      return new Promise((resolve, reject) => {
        let settled = false, timeout = null;
        const finishError = error => {
          if (settled) return;
          settled = true;
          if (timeout !== null) clearTimeout(timeout);
          timeout = null;
          if (activeAuthCancel === cancel) activeAuthCancel = null;
          reject(error instanceof Error ? error : new Error(String(error || 'Google 인증에 실패했습니다.')));
        };
        const cancel = () => finishError(new Error('Google 인증 요청을 취소했습니다.'));
        activeAuthCancel = cancel;
        // GIS may omit the callback when the account/sign-in chooser is closed.
        // Bound the pending state so CloudSave can recover and allow retry.
        timeout = setTimeout(() => finishError(new Error('Google 인증 응답이 도착하지 않았습니다. 창을 닫았거나 인증이 중단되었을 수 있습니다. 다시 연결해 주세요.')), 120000);
        try {
          const client = window.google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_OAUTH_CLIENT_ID,
            scope: GOOGLE_DRIVE_SCOPE,
            include_granted_scopes: true,
            callback: response => {
              if (settled) return;
              if (!isCurrentAuthAttempt(attempt, sessionAtStart)) { finishError(new Error('이전 Google 인증 응답을 무시했습니다.')); return; }
              if (!response || response.error || !response.access_token) {
                const code = String(response && response.error || 'token-error');
                const detail = String(response && (response.error_description || response.error) || 'Google 액세스 토큰을 받지 못했습니다.');
                try { acceptAccessToken({ type: 'wayward-cloud-auth-error', nonce, code, message: detail }, nonce); }
                catch (error) { finishError(error); }
                return;
              }
              if (response.state !== nonce) { finishError(new Error('Google 인증 state가 없거나 일치하지 않습니다.')); return; }
              let granted = false;
              try { granted = window.google.accounts.oauth2.hasGrantedAllScopes(response, GOOGLE_DRIVE_SCOPE); } catch (_) {}
              if (!granted) granted = String(response.scope || '').split(/\s+/).includes(GOOGLE_DRIVE_SCOPE);
              if (!granted) {
                try { acceptAccessToken({ type: 'wayward-cloud-auth-error', nonce, code: 'scope_missing', message: 'Google Drive appData 권한이 승인되지 않았습니다.' }, nonce); }
                catch (error) { finishError(error); }
                return;
              }
              try { acceptAccessToken({ type: 'wayward-cloud-auth-success', nonce, accessToken: response.access_token, expiresIn: Number(response.expires_in) || 3600 }, nonce); }
              catch (error) { finishError(error); return; }
              settled = true;
              if (timeout !== null) clearTimeout(timeout);
              timeout = null;
              if (activeAuthCancel === cancel) activeAuthCancel = null;
              resolve();
            },
            error_callback: error => {
              if (settled) return;
              const type = String(error && error.type || 'popup_error');
              if (type === 'popup_closed') finishError(new Error('Google 인증 창이 닫혔습니다. 게임에서 다시 연결하세요.'));
              else if (type === 'popup_failed_to_open') finishError(new Error('Google 인증 팝업이 차단되었습니다. 이 게임 주소의 팝업을 허용하세요.'));
              else finishError(new Error('Google 인증 UI를 열지 못했습니다: ' + type));
            }
          });
          // requestAccessToken must run synchronously in the original game click handler.
          client.requestAccessToken({ prompt: forceSelectAccount ? 'select_account' : '', state: nonce });
        } catch (error) { finishError(new Error('Google GIS 인증을 시작하지 못했습니다: ' + String(error && error.message || error))); }
      });
    }

    function requestFileBridgeGoogleToken(nonce, forceSelectAccount, attempt, sessionAtStart) {
      if (AUTH_ADAPTER !== 'file-bridge') {
        return Promise.reject(new Error('PC file 인증 어댑터가 아닙니다.'));
      }
      if (typeof window.open !== 'function' || typeof MessageChannel !== 'function') {
        return Promise.reject(new Error('이 브라우저는 보안 인증 팝업 또는 MessageChannel을 지원하지 않습니다.'));
      }
      let requestId, attemptId;
      try {
        requestId = createAuthNonce();
        attemptId = createAuthNonce();
      } catch (error) {
        return Promise.reject(error);
      }
      return new Promise((resolve, reject) => {
        let popup = null;
        let port = null;
        let retryTimer = null;
        let handshakeTimer = null;
        let requestTimer = null;
        let popupWatchTimer = null;
        let ackTimer = null;
        let sessionId = '';
        let settled = false;
        let resultAccepted = false;
        let acceptedSessionGeneration = null;
        const isBridgeSessionCurrent = () => attempt === authAttemptSerial &&
          (sessionAtStart === sessionGeneration ||
            (resultAccepted && acceptedSessionGeneration !== null && acceptedSessionGeneration === sessionGeneration));

        const clearTimer = timer => {
          if (timer !== null) clearTimeout(timer);
          return null;
        };
        const sendToBridge = (type, extra) => {
          if (!port || !sessionId) return false;
          try {
            port.postMessage(Object.assign({
              type,
              version: FILE_AUTH_BRIDGE_VERSION,
              nonce,
              requestId,
              attemptId,
              sessionId
            }, extra || {}));
            return true;
          } catch (_) {
            return false;
          }
        };
        const cleanup = () => {
          retryTimer = clearTimer(retryTimer);
          handshakeTimer = clearTimer(handshakeTimer);
          requestTimer = clearTimer(requestTimer);
          ackTimer = clearTimer(ackTimer);
          if (popupWatchTimer !== null) clearInterval(popupWatchTimer);
          popupWatchTimer = null;
          if (port) {
            try { port.close(); } catch (_) {}
            port = null;
          }
          if (activeAuthCancel === cancel) activeAuthCancel = null;
        };
        const finish = error => {
          if (settled) return;
          settled = true;
          if (error && sessionId) {
            try { sendToBridge('wayward-cloud-auth-cancel'); } catch (_) {}
          }
          cleanup();
          if (error) {
            try { if (popup && !popup.closed) popup.close(); } catch (_) {}
            reject(error instanceof Error ? error : new Error(String(error || 'Google 인증에 실패했습니다.')));
          } else {
            resolve();
          }
        };
        const cancel = () => finish(new Error('Google 인증 요청을 취소했습니다.'));
        activeAuthCancel = cancel;

        const onPortMessage = event => {
          if (settled || !isBridgeSessionCurrent()) {
            if (!settled) finish(new Error('이전 PC file 인증 응답을 무시했습니다.'));
            return;
          }
          const data = event && event.data;
          if (!data || typeof data !== 'object' ||
              data.version !== FILE_AUTH_BRIDGE_VERSION ||
              data.nonce !== nonce || data.requestId !== requestId ||
              data.attemptId !== attemptId) return;

          if (data.type === 'wayward-cloud-auth-ready') {
            if (sessionId || typeof data.sessionId !== 'string' ||
                !/^[a-f0-9]{48}$/.test(data.sessionId)) return;
            sessionId = data.sessionId;
            retryTimer = clearTimer(retryTimer);
            handshakeTimer = clearTimer(handshakeTimer);
            return;
          }
          if (!sessionId || data.sessionId !== sessionId) return;

          if (data.type === 'wayward-cloud-auth-ack-received' && resultAccepted) {
            if (data.accepted !== true) {
              clearToken();
              finish(new Error('인증 중계 창에서 게임 세션의 수신 확인을 받지 못했습니다.'));
            } else {
              finish(null);
            }
            return;
          }
          if (data.type === 'wayward-cloud-auth-error') {
            const message = String(data.message || 'Google 인증이 취소되었거나 실패했습니다.');
            try { sendToBridge('wayward-cloud-auth-ack', { accepted: false, message }); } catch (_) {}
            finish(new Error(message));
            return;
          }
          if (data.type !== 'wayward-cloud-auth-success' || resultAccepted) return;

          resultAccepted = true;
          try {
            if (!isCurrentAuthAttempt(attempt, sessionAtStart)) {
              throw new Error('이전 PC file 인증 응답을 무시했습니다.');
            }
            acceptAccessToken({
              type: 'wayward-cloud-auth-success',
              nonce,
              accessToken: data.accessToken,
              expiresIn: data.expiresIn
            }, nonce);
            // acceptAccessToken invalidates the previous Drive session; retain
            // only the new generation for the final relay acknowledgement.
            acceptedSessionGeneration = sessionGeneration;
          } catch (error) {
            try {
              sendToBridge('wayward-cloud-auth-ack', {
                accepted: false,
                message: String(error && error.message || error)
              });
            } catch (_) {}
            finish(error);
            return;
          }
          if (!sendToBridge('wayward-cloud-auth-ack', { accepted: true })) {
            clearToken();
            finish(new Error('Google 인증 결과 확인 응답을 중계 창에 전달하지 못했습니다.'));
            return;
          }
          ackTimer = setTimeout(() => {
            if (settled) return;
            clearToken();
            finish(new Error('인증 중계 창의 결과 수신 확인이 시간 초과되었습니다.'));
          }, 15000);
        };

        const transmitInit = () => {
          if (settled || sessionId) return;
          if (!popup || popup.closed) {
            finish(new Error('Google 인증 중계 창이 닫혔습니다. 게임에서 다시 연결하세요.'));
            return;
          }
          try {
            if (port) { try { port.close(); } catch (_) {} port = null; }
            const channel = new MessageChannel();
            port = channel.port1;
            port.onmessage = onPortMessage;
            port.onmessageerror = () => finish(new Error('PC file 인증 메시지 채널이 손상되었습니다.'));
            if (typeof port.start === 'function') port.start();
            // The recipient origin is fixed; the opaque file Origin is never
            // placed in a targetOrigin field or used as an authentication claim.
            popup.postMessage({
              type: 'wayward-cloud-auth-init',
              version: FILE_AUTH_BRIDGE_VERSION,
              appId: 'wayward-cloudsave',
              action: 'login',
              nonce,
              requestId,
              attemptId,
              forceSelectAccount: forceSelectAccount === true
            }, FILE_AUTH_BRIDGE_ORIGIN, [channel.port2]);
          } catch (error) {
            if (port) { try { port.close(); } catch (_) {} port = null; }
          }
          retryTimer = setTimeout(transmitInit, 300);
        };

        try {
          // This must run synchronously within the original game login click.
          popup = window.open(
            FILE_AUTH_BRIDGE_URL,
            'waywardCloudSaveAuth_' + requestId,
            'popup=yes,width=540,height=760,resizable=yes,scrollbars=yes'
          );
        } catch (_) {
          popup = null;
        }
        if (!popup) {
          finish(new Error('브라우저가 CloudSave 인증 팝업을 차단했습니다. 이 게임의 팝업을 허용한 뒤 다시 시도하세요.'));
          return;
        }

        handshakeTimer = setTimeout(() => {
          if (!sessionId) finish(new Error('CloudSave 인증 페이지와 게임 세션 연결 시간이 초과되었습니다. 다시 시도하세요.'));
        }, 20000);
        requestTimer = setTimeout(() => {
          finish(new Error('PC file Google 인증 응답 시간이 초과되었습니다. 게임에서 다시 연결하세요.'));
        }, 180000);
        popupWatchTimer = setInterval(() => {
          if (settled) return;
          if (!popup || popup.closed) {
            finish(new Error('CloudSave 인증 창이 비정상적으로 종료되었습니다.'));
          } else if (!isBridgeSessionCurrent()) {
            finish(new Error('게임 인증 세션이 변경되어 이전 요청을 취소했습니다.'));
          }
        }, 400);
        transmitInit();
      });
    }

    function requestGoogleToken(forceSelectAccount, attempt) {
      const nonce = createAuthNonce(), sessionAtStart = sessionGeneration;
      if (AUTH_ADAPTER === 'android-native') return requestNativeGoogleToken(nonce, !!forceSelectAccount, attempt, sessionAtStart);
      if (AUTH_ADAPTER === 'browser-gis') return requestBrowserGoogleToken(nonce, !!forceSelectAccount, attempt, sessionAtStart);
      return requestFileBridgeGoogleToken(nonce, !!forceSelectAccount, attempt, sessionAtStart);
    }
    function attemptNativeSessionRestore() {
      if (startupRestoreAttempted || explicitLogout || !hadPreviousAuth || hasToken()) return;
      if (AUTH_ADAPTER !== 'android-native' || !nativeAuthHost ||
          (typeof nativeAuthHost.startGoogleDriveAuthWithPolicy !== 'function' && typeof nativeAuthHost.startGoogleDriveAuth !== 'function') ||
          typeof nativeAuthHost.takePendingStateForNonce !== 'function') return;
      startupRestoreAttempted = true;
      const attempt = ++authAttemptSerial;
      authStartedAt = Date.now();
      authCompletedAt = 0;
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
      const task = requestNativeGoogleToken(nonce, false, attempt, sessionGeneration);
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
      const generation = sessionGeneration;
      const token = await ensureAccessToken();
      assertDriveSession(generation);
      const opts = Object.assign({ method: 'GET', headers: {} }, options || {});
      opts.headers = Object.assign({}, opts.headers || {});
      opts.headers.Authorization = 'Bearer ' + token;
      let requestController = null;
      if (!opts.signal && typeof AbortController === 'function') {
        requestController = new AbortController();
        driveRequestControllers.add(requestController);
        opts.signal = requestController.signal;
      }
      try {
        const response = await fetch('https://www.googleapis.com' + path, opts);
        assertDriveSession(generation);
        if (response.status === 401) {
          clearToken();
          authStatus = 'reauth-required';          throw new Error('Google 액세스 토큰이 만료되었거나 Google 권한이 취소되었습니다. 연결 버튼을 눌러 재인증하세요.');
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
          assertDriveSession(generation);
          throw new Error('Google Drive 요청 실패 (' + response.status + ')' +
            (detail ? ': ' + detail : ''));
        }
        return response;
      } finally {
        if (requestController) driveRequestControllers.delete(requestController);
      }
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

    function normalizeDriveSlotFiles(files) {
      const slots = new Map();
      for (const file of (Array.isArray(files) ? files : [])) {
        const match = new RegExp('^' + FILE_PREFIX + '([1-9][0-9]*)\\.json$')
          .exec(String(file && file.name || ''));
        if (!match || !file.id) continue;
        const slot = Number(match[1]);
        if (!Number.isSafeInteger(slot) || slot < 1) continue;
        const previous = slots.get(slot);
        if (!previous || String(file.modifiedTime || '') > String(previous.modifiedTime || '')) {
          slots.set(slot, {
            id: String(file.id),
            name: String(file.name),
            mimeType: String(file.mimeType || 'application/json'),
            modifiedTime: String(file.modifiedTime || ''),
            size: Math.max(0, Number(file.size) || 0),
            previewId: String(file.appProperties && file.appProperties.wmlPreviewId || ''),
            previewGeneration: String(file.appProperties && file.appProperties.wmlPreviewGeneration || ''),
            appProperties: file.appProperties && typeof file.appProperties === 'object'
              ? {
                  wmlPreviewId: String(file.appProperties.wmlPreviewId || ''),
                  wmlPreviewGeneration: String(file.appProperties.wmlPreviewGeneration || '')
                }
              : {}
          });
        }
      }
      const slotNumber = file => Number(file.name.slice(FILE_PREFIX.length, -5));
      return Array.from(slots.values()).sort((a, b) => slotNumber(a) - slotNumber(b));
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
          mimeType: String(item.mimeType || 'application/json'),
          previewId: String(item.previewId || item.appProperties && item.appProperties.wmlPreviewId || ''),
          previewGeneration: String(item.previewGeneration || item.appProperties && item.appProperties.wmlPreviewGeneration || ''),
          appProperties: {
            wmlPreviewId: String(item.previewId || item.appProperties && item.appProperties.wmlPreviewId || ''),
            wmlPreviewGeneration: String(item.previewGeneration || item.appProperties && item.appProperties.wmlPreviewGeneration || '')
          }
        });
      }
      return output;
    }

    async function resolveDriveAccountCache() {
      const generation = sessionGeneration;
      if (driveAccountCacheIdentity) {
        assertDriveSession(generation);
        return Object.assign({
          apiCalls: 0, responseBytes: 0, apiRequestMs: 0, jsonParseMs: 0
        }, driveAccountCacheIdentity);
      }
      const now = () => typeof performance !== 'undefined' && performance.now
        ? performance.now() : Date.now();
      const requestStarted = now();
      try {
        const response = await driveFetch('/drive/v3/about?fields=user(permissionId)');
        const raw = await response.text();
        assertDriveSession(generation);
        const apiRequestMs = Math.max(0, Math.round(now() - requestStarted));
        let responseBytes = 0;
        try { responseBytes = new TextEncoder().encode(raw).length; }
        catch (_) { responseBytes = raw.length; }
        const parseStarted = now();
        const about = JSON.parse(raw);
        const jsonParseMs = Math.max(0, Math.round(now() - parseStarted));
        const permissionId = String(about && about.user && about.user.permissionId || '');
        assertDriveSession(generation);
        if (!permissionId) {
          return { memoryKey: '', storageKey: '', apiCalls: 1, responseBytes, apiRequestMs, jsonParseMs };
        }
        const storageKey = await accountCacheStorageKey(permissionId);
        assertDriveSession(generation);
        driveAccountCacheIdentity = { memoryKey: permissionId, storageKey };
        return Object.assign({ apiCalls: 1, responseBytes, apiRequestMs, jsonParseMs },
          driveAccountCacheIdentity);
      } catch (_) {
        assertDriveSession(generation);
        // about.get is optional. Failure must not block the core files.list call.
        return {
          memoryKey: '', storageKey: '', apiCalls: 1,
          responseBytes: 0, apiRequestMs: Math.max(0, Math.round(now() - requestStarted)),
          jsonParseMs: 0
        };
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
      const session = sessionGeneration;
      const now = () => typeof performance !== 'undefined' && performance.now
        ? performance.now() : Date.now();
      const startedAt = now();
      const startedAtWall = Date.now();
      const bodyCountAtStart = driveBodyDownloadCount;
      const previewCountAtStart = drivePreviewDownloadCount;
      let cacheDisplayMs = null;      const controller = typeof AbortController === 'function' ? new AbortController() : null;
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
        let apiRequestMs = 0;
        let jsonParseMs = 0;
        try {
          // Resolve account identity and query metadata in parallel. No save
          // body, encrypted envelope, account email or access token enters cache.
          const accountTask = resolveDriveAccountCache();
          const listTask = (async () => {
            const byFileId = new Map();
            let pageToken = '';
            do {
              if (generation !== driveListGeneration) return null;
              const params = new URLSearchParams({
                spaces: 'appDataFolder',
                pageSize: '1000',
                q: "trashed = false and name contains '" + FILE_PREFIX + "'",
                fields: 'files(id,name,mimeType,modifiedTime,size,appProperties),nextPageToken'
              });
              if (pageToken) params.set('pageToken', pageToken);
              apiCalls += 1;
              pageCount += 1;
              const requestStarted = now();
              const response = await driveFetch(
                '/drive/v3/files?' + params.toString(), requestOptions
              );
              const raw = await response.text();
              if (generation !== driveListGeneration) return null;
              assertDriveSession(session);
              apiRequestMs += Math.max(0, Math.round(now() - requestStarted));
              try { responseBytes += new TextEncoder().encode(raw).length; }
              catch (_) { responseBytes += raw.length; }
              const parseStarted = now();
              const data = JSON.parse(raw);
              jsonParseMs += Math.max(0, Math.round(now() - parseStarted));
              for (const file of (Array.isArray(data.files) ? data.files : [])) {
                if (file && file.id) byFileId.set(String(file.id), file);
              }
              pageToken = data.nextPageToken || '';
            } while (pageToken);
            return normalizeDriveSlotFiles(Array.from(byFileId.values()));
          })();

          const cacheKey = await accountTask;
          if (generation !== driveListGeneration) return [];
          driveAccountMemoryKey = cacheKey.memoryKey;
          apiCalls += Number(cacheKey.apiCalls) || 0;
          responseBytes += Number(cacheKey.responseBytes) || 0;
          apiRequestMs += Number(cacheKey.apiRequestMs) || 0;
          jsonParseMs += Number(cacheKey.jsonParseMs) || 0;

          // Never display another account's metadata. Read cache only after
          // Google Drive identifies the active account via permissionId.
          if (!driveSlots.length) {
            const cached = readAccountSlotCache(cacheKey);
            if (cached) {
              driveSlots = cached;
              driveMetadataCacheAvailable = true;
              cacheDisplayMs = Math.max(0, Math.round(now() - startedAt));
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
            apiRequestMs,
            jsonParseMs,
            bodyDownloads: driveBodyDownloadCount - bodyCountAtStart,
            previewDownloads: drivePreviewDownloadCount - previewCountAtStart,
            decryptMs: 0,
            slotCount: freshFiles.length,
            durationMs: Math.max(0, Math.round(now() - startedAt)),
            authDurationMs: authStartedAt && authCompletedAt
              ? Math.max(0, authCompletedAt - authStartedAt) : null,
            authToListStartMs: authCompletedAt
              ? Math.max(0, startedAtWall - authCompletedAt) : null,
            cacheFirstDisplayMs: cacheDisplayMs
          };
          const renderStartedAt = now();
          if (isConnected()) render();
          lastListMetrics.renderMs = Math.max(0, Math.round(now() - renderStartedAt));
          try {
            if (typeof console !== 'undefined' && console.info) {
              console.info('[Wayward CloudSave] metadata list metrics', lastListMetrics);
            }
          } catch (_) {}
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
      await refreshSlots();
    }

    function extractSnapshotPreview(snapshot) {
      const state = snapshot && snapshot.state && typeof snapshot.state === 'object' ? snapshot.state : {};
      const activeId = String(state.primaryCharacterId || '');
      const active = activeId && state.characters && typeof state.characters === 'object' ? state.characters[activeId] : null;
      const name = active && typeof active.name === 'string' ? active.name.trim() : '';
      const archetypeId = active && typeof active.archetypeId === 'string' ? active.archetypeId : '';
      const originNames = { elena_farmgirl: '엘레나', mara_citygirl: '마라', pippa_waif: '피파' };
      const dayValue = state.day;
      const day = (typeof dayValue === 'number' && Number.isFinite(dayValue)) ||
        (typeof dayValue === 'string' && /^-?\d+(?:\.\d+)?$/.test(dayValue.trim())) ? Number(dayValue) : null;
      const goldValue = state.economy && state.economy.gold;
      const gold = (typeof goldValue === 'number' && Number.isFinite(goldValue)) ||
        (typeof goldValue === 'string' && /^-?\d+(?:\.\d+)?$/.test(goldValue.trim())) ? Number(goldValue) : null;
      const savedAtValue = Number(snapshot && snapshot.savedAt);
      return {
        characterName: name, day, gold,
        origin: Object.prototype.hasOwnProperty.call(originNames, archetypeId) ? originNames[archetypeId] : '',
        savedAt: Number.isFinite(savedAtValue) && savedAtValue > 0 ? savedAtValue : null,
        memo: snapshot && typeof snapshot.memo === 'string' ? snapshot.memo : ''
      };
    }

    function buildPreviewSnapshot(snapshot, generation) {
      const preview = extractSnapshotPreview(snapshot);
      const sourceState = snapshot && snapshot.state && typeof snapshot.state === 'object' ? snapshot.state : {};
      const activeId = String(sourceState.primaryCharacterId || '');
      const active = activeId && sourceState.characters && typeof sourceState.characters === 'object' ? sourceState.characters[activeId] : null;
      const state = {};
      if (activeId) state.primaryCharacterId = activeId;
      if (active && typeof active === 'object') {
        const character = {};
        if (typeof active.name === 'string') character.name = active.name;
        if (typeof active.archetypeId === 'string') character.archetypeId = active.archetypeId;
        state.characters = { [activeId]: character };
      }
      if (preview.day !== null) state.day = preview.day;
      if (preview.gold !== null) state.economy = { gold: preview.gold };
      return { schema: 'wayward-cloud-save', version: 1, gameFamily: 'wayward', nativeFormat: 1,
        savedAt: preview.savedAt, memo: preview.memo, previewGeneration: String(generation || ''), state };
    }

    function formatPreviewSummary(preview) {
      if (!preview) return '';
      const parts = [];
      if (preview.characterName) parts.push(preview.characterName);
      if (preview.day !== null && preview.day !== undefined) parts.push('진행 ' + preview.day + '일');
      if (preview.gold !== null && preview.gold !== undefined) parts.push('소지 ' + Number(preview.gold).toLocaleString('ko-KR') + '골드');
      if (preview.origin) parts.push('출신 ' + preview.origin);
      if (preview.savedAt) {
        const timestamp = Number(preview.savedAt);
        if (Number.isFinite(timestamp) && timestamp > 0) parts.push('저장 ' + new Date(timestamp).toLocaleString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
      }
      return parts.join(' · ');
    }

    async function clearSlotPreview(file) {
      if (!file || !file.id || !file.previewId) return;
      const session = sessionGeneration;
      const oldPreviewId = file.previewId;
      await driveFetch('/drive/v3/files/' + encodeURIComponent(file.id) + '?fields=id%2CappProperties', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ appProperties: {} })
      });
      assertDriveSession(session);
      file.previewId = ''; file.previewGeneration = ''; file.appProperties = {};
      if (driveAccountCacheIdentity) writeAccountSlotCache(driveAccountCacheIdentity, driveSlots);
      try {
        await driveFetch('/drive/v3/files/' + encodeURIComponent(oldPreviewId), { method: 'DELETE' });
        assertDriveSession(session);
      } catch (error) {
        try { if (console && console.warn) console.warn('[Wayward CloudSave] preview cleanup failed', error); } catch (_) {}
      }
    }

    async function uploadPreviewSidecar(file, snapshot) {
      if (!file || !file.id) throw new Error('미리보기와 연결할 저장 파일을 찾지 못했습니다.');
      const session = sessionGeneration; assertDriveSession(session);
      const generation = createAuthNonce();
      const previewSnapshot = buildPreviewSnapshot(snapshot, generation);
      const envelope = await globalThis.WMLGoogleDriveCrypto.encryptSnapshotEmbedded(previewSnapshot);
      assertDriveSession(session);
      const boundary = 'wml_preview_' + generation;
      const metadata = { name: 'wayward-cloud-preview-' + generation + '.json', mimeType: 'application/json', parents: ['appDataFolder'] };
      const multipart = '--' + boundary + '\r\n' +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata) + '\r\n' +
        '--' + boundary + '\r\n' +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(envelope) + '\r\n' +
        '--' + boundary + '--';
      const uploadResponse = await driveFetch('/upload/drive/v3/files?uploadType=multipart&fields=id', {
        method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body: multipart
      });
      const created = await uploadResponse.json(); assertDriveSession(session);
      const previewId = String(created && created.id || '');
      if (!previewId) throw new Error('암호화 미리보기 파일 ID를 받지 못했습니다.');
      const previousId = file.previewId;
      try {
        await driveFetch('/drive/v3/files/' + encodeURIComponent(file.id) + '?fields=id%2CappProperties', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json; charset=UTF-8' },
          body: JSON.stringify({ appProperties: { wmlPreviewId: previewId, wmlPreviewGeneration: generation } })
        });
        assertDriveSession(session);
      } catch (error) {
        try { await driveFetch('/drive/v3/files/' + encodeURIComponent(previewId), { method: 'DELETE' }); } catch (_) {}
        throw error;
      }
      file.previewId = previewId; file.previewGeneration = generation;
      file.appProperties = { wmlPreviewId: previewId, wmlPreviewGeneration: generation };
      if (driveAccountCacheIdentity) writeAccountSlotCache(driveAccountCacheIdentity, driveSlots);
      if (previousId && previousId !== previewId) {
        try { await driveFetch('/drive/v3/files/' + encodeURIComponent(previousId), { method: 'DELETE' }); }
        catch (error) { try { if (console && console.warn) console.warn('[Wayward CloudSave] old preview cleanup failed', error); } catch (_) {} }
      }
      assertDriveSession(session); return previewSnapshot;
    }

    async function readSlotPreviewSidecar(file, session) {
      if (!file || !file.previewId || !file.previewGeneration) return null;
      drivePreviewDownloadCount += 1;
      const response = await driveFetch('/drive/v3/files/' + encodeURIComponent(file.previewId) + '?alt=media');
      const envelope = await response.json(); assertDriveSession(session);
      const snapshot = await globalThis.WMLGoogleDriveCrypto.decryptSnapshotEmbedded(envelope);
      assertDriveSession(session);
      if (snapshot.previewGeneration !== file.previewGeneration) throw new Error('미리보기 generation이 저장 파일 메타데이터와 일치하지 않습니다.');
      return snapshot;
    }

    function previewCacheKey(file) { return [file.id, file.modifiedTime, file.previewId, file.previewGeneration].join('|'); }

    function applySlotPreview(item, preview) {
      if (!item || !item.row.isConnected || item.session !== sessionGeneration) return;
      const summary = formatPreviewSummary(preview);
      item.summaryNode.textContent = summary || (preview ? '표시할 저장 정보가 없습니다.' : '이전 암호화 세이브입니다. 암호를 입력해 불러온 뒤 미리보기를 생성할 수 있습니다.');
      item.memo = preview && typeof preview.memo === 'string' ? preview.memo : '';
      if (item.memoButton) {
        const hasMemo = !!item.memo.trim(); item.memoButton.hidden = !hasMemo;
        item.memoButton.textContent = hasMemo ? '메모: ' + item.memo.replace(/\s+/g, ' ').trim() : '';
        item.memoButton.title = hasMemo ? item.memo : '';
      }
    }

    async function loadSlotPreview(item) {
      if (!item || !item.row.isConnected || item.session !== sessionGeneration) return;
      const file = item.file, session = item.session, key = previewCacheKey(file);
      if (previewCache.has(key)) { applySlotPreview(item, previewCache.get(key)); return; }
      let task = previewLoadPromises.get(key);
      if (!task) {
        task = (async () => {
          let previewSnapshot = null;
          if (file.previewId && file.previewGeneration) {
            try { previewSnapshot = await readSlotPreviewSidecar(file, session); }
            catch (_) { assertDriveSession(session); previewSnapshot = null; }
          }
          if (!previewSnapshot) {
            const envelope = await readSlotEnvelope(file); assertDriveSession(session);
            if (!envelope || envelope.keyMode !== 'embedded-addon-v2') return null;
            const originalSnapshot = await globalThis.WMLGoogleDriveCrypto.decryptSnapshotEmbedded(envelope);
            assertDriveSession(session);
            previewSnapshot = buildPreviewSnapshot(originalSnapshot, createAuthNonce());
            try { await uploadPreviewSidecar(file, originalSnapshot); assertDriveSession(session); }
            catch (error) {
              assertDriveSession(session);
              try { if (console && console.warn) console.warn('[Wayward CloudSave] preview sidecar backfill failed', error); } catch (_) {}
            }
          }
          return extractSnapshotPreview(previewSnapshot);
        })();
        previewLoadPromises.set(key, task);
      }
      try {
        const preview = await task; assertDriveSession(session);
        previewCache.set(key, preview); applySlotPreview(item, preview);
      } catch (error) {
        if (session !== sessionGeneration || !item.row.isConnected) return;
        item.summaryNode.textContent = '저장 미리보기 정보를 불러오지 못했습니다.';
        if (item.memoButton) item.memoButton.hidden = true;
        try { if (console && console.warn) console.warn('[Wayward CloudSave] preview load failed', error); } catch (_) {}
      } finally { if (previewLoadPromises.get(key) === task) previewLoadPromises.delete(key); }
    }

    function observeSlotPreview(file, row, summaryNode, memoButton) {
      const item = { file, row, summaryNode, memoButton, memo: '', session: sessionGeneration };
      previewTargets.set(row, item);
      if (previewObserver) previewObserver.observe(row);
      else if (typeof IntersectionObserver === 'function') {
        previewObserver = new IntersectionObserver(entries => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            previewObserver.unobserve(entry.target);
            const target = previewTargets.get(entry.target); if (target) loadSlotPreview(target);
          }
        }, { root: null, rootMargin: '100px 0px', threshold: 0 });
        previewObserver.observe(row);
      } else {
        const rect = row.getBoundingClientRect();
        const height = Number(window.innerHeight) || (document.documentElement && document.documentElement.clientHeight) || 0;
        if (rect.bottom >= 0 && rect.top <= height) loadSlotPreview(item);
      }
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
      return formatPreviewSummary(extractSnapshotPreview(snapshot));
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
      }      if (hasLogin() && slotsStatus !== 'loaded' && slotsStatus !== 'loading') {
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

    function shouldForceSelectAccount() {
      // First connection and every explicit logout must ask the user to pick.
      return explicitLogout || !hadPreviousAuth;
    }

    function connectFromClick() {
      if (busy) return;
      if (activeAuthCancel) {
        const cancel = activeAuthCancel;
        activeAuthCancel = null;
        try { cancel(); } catch (_) {}
      }
      const attempt = ++authAttemptSerial;
      authStartedAt = Date.now();
      authCompletedAt = 0;
      const forceSelectAccount = shouldForceSelectAccount();
      let task;
      try { task = requestGoogleToken(forceSelectAccount, attempt); }
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
      if (AUTH_ADAPTER === 'android-native') {
        if (nativeAuthHost && typeof nativeAuthHost.clearGoogleAccessToken === 'function' && token) { try { nativeAuthHost.clearGoogleAccessToken(token); } catch (_) {} }
        return Promise.resolve(false);
      }
      if (AUTH_ADAPTER === 'browser-gis') {
        if (!token || !isGoogleIdentityReady()) return Promise.resolve(false);
        return new Promise(resolve => {
          try { window.google.accounts.oauth2.revoke(token, response => resolve(!!(response && response.successful === true))); }
          catch (_) { resolve(false); }
        });
      }
      // Only the direct browser adapter can revoke a browser-issued GIS token.
      // Native and unsupported file:// environments do not use an external relay.
      return Promise.resolve(false);
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
      const host = AUTH_ADAPTER === 'android-native' ? nativeAuthHost : null;
      if (savedAccessToken && host && typeof host.clearGoogleAccessToken === 'function') {
        try { host.clearGoogleAccessToken(savedAccessToken); } catch (_) {}
      }
      clearToken();
      markExplicitLogout(false);
      show({ page: 'home' },
        '로그아웃했습니다. 다음 연결에서는 Google 계정 선택 화면을 표시합니다. Google 앱 권한은 유지됩니다.');
    }

    function requestNativeGoogleRevoke() {
      const host = nativeAuthHost;
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
      const host = AUTH_ADAPTER === 'android-native' ? nativeAuthHost : null;
      let revoked = false;
      let failure = '';
      try {
        if (AUTH_ADAPTER === 'android-native') {
          if (host && typeof host.revokeGoogleDriveAccess === 'function') revoked = await requestNativeGoogleRevoke();
          else failure = '이 Android 런처 버전은 Google 권한 철회 API를 제공하지 않습니다.';
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
      const session = sessionGeneration;
      assertDriveSession(session);
      const snapshot = buildSnapshot();
      snapshot.memo = String(fields.memo && fields.memo.value || '').trim();
      const envelope = await globalThis.WMLGoogleDriveCrypto.encryptSnapshotEmbedded(snapshot);
      assertDriveSession(session);
      let previewWarning = '';
      // Keep the old sidecar pointer until the primary save write succeeds.
      // uploadPreviewSidecar atomically replaces the pointer, then cleans the old sidecar.
      await writeSlotEnvelope(slot, envelope);
      assertDriveSession(session);
      const savedFile = currentFile(slot);
      if (savedFile) {
        try {
          await uploadPreviewSidecar(savedFile, snapshot); assertDriveSession(session);
          await refreshSlots(); assertDriveSession(session);
        } catch (error) {
          previewWarning = '세이브는 저장했지만 미리보기 갱신은 실패했습니다.';
          try { const latestFile = currentFile(slot); if (latestFile && latestFile.previewId) await clearSlotPreview(latestFile); } catch (_) {}
          try { if (console && console.warn) console.warn('[Wayward CloudSave] preview update failed', error); } catch (_) {}
        }
      } else previewWarning = '세이브는 저장했지만 미리보기 연결 파일을 찾지 못했습니다.';
      preparedSlotRead = null;
      show({ page: 'home' }, previewWarning
        ? '저장 슬롯 ' + slot + '에 저장했습니다. ' + previewWarning
        : '저장 슬롯 ' + slot + '에 자동 암호화하여 저장했습니다.');
    }

    async function prepareSaveSlot(slot) {
      const session = sessionGeneration;
      assertDriveSession(session);
      const file = currentFile(slot);
      let memo = '';
      if (file) {
        // Memo is inside the encrypted snapshot. Download only the slot the user
        // explicitly selected for overwrite; never fetch slot bodies for the list.
        const envelope = await readSlotEnvelope(file);
        assertDriveSession(session);
        if (envelope && envelope.keyMode === 'embedded-addon-v2') {
          const snapshot = await globalThis.WMLGoogleDriveCrypto.decryptSnapshotEmbedded(envelope);
          assertDriveSession(session);
          memo = String(snapshot.memo || '');
        }
      }
      assertDriveSession(session);
      show({ page: 'save', slot, memo });
    }

    async function prepareLoadSlot(slot) {
      const session = sessionGeneration;
      assertDriveSession(session);
      const file = currentFile(slot); if (!file) throw new Error('저장 슬롯이 비어 있습니다.');
      const envelope = await readSlotEnvelope(file);
      assertDriveSession(session);
      preparedSlotRead = {
        slot, fileId: file.id, modifiedTime: file.modifiedTime, envelope,
        sessionGeneration: session
      };
      show({ page: envelope && envelope.keyMode === 'embedded-addon-v2' ? 'load' : 'legacy-load', slot },
        envelope && envelope.keyMode === 'embedded-addon-v2' ? '' : '이전 암호화 세이브입니다. 저장 당시 암호를 입력하면 자동 암호화 형식으로 변환됩니다.');
    }
    async function loadSlot(slot) {
      const session = sessionGeneration;
      assertDriveSession(session);
      const file = currentFile(slot); if (!file) throw new Error('저장 슬롯이 비어 있습니다.');
      let envelope;
      if (preparedSlotRead && preparedSlotRead.sessionGeneration === session &&
          preparedSlotRead.slot === slot && preparedSlotRead.fileId === file.id &&
          preparedSlotRead.modifiedTime === file.modifiedTime && preparedSlotRead.envelope) {
        envelope = preparedSlotRead.envelope;
      } else {
        envelope = await readSlotEnvelope(file);
      }
      assertDriveSession(session);
      preparedSlotRead = null;
      let snapshot;
      if (envelope && envelope.keyMode === 'embedded-addon-v2') {
        snapshot = await globalThis.WMLGoogleDriveCrypto.decryptSnapshotEmbedded(envelope);
        assertDriveSession(session);
      } else {
        const passphrase = String(fields.passphrase && fields.passphrase.value || '');
        if (!passphrase) throw new Error('이전 세이브의 암호화 비밀번호를 입력해 주세요.');        snapshot = await globalThis.WMLGoogleDriveCrypto.decryptSnapshot(envelope, passphrase);
        assertDriveSession(session);
        const migratedEnvelope = await globalThis.WMLGoogleDriveCrypto.encryptSnapshotEmbedded(snapshot);
        assertDriveSession(session);
        await writeSlotEnvelope(slot, migratedEnvelope);
        assertDriveSession(session);
      }
      // No asynchronous boundary is allowed between this final guard and state application.
      assertDriveSession(session);
      applySnapshot(snapshot); if (win) win.close(); message = '';
    }

    async function removeSlot(slot) {
      const session = sessionGeneration;
      assertDriveSession(session);
      const file = currentFile(slot);
      if (!file) throw new Error('삭제할 저장 파일을 찾지 못했습니다.');
      const previewId = file.previewId || '';
      await driveFetch('/drive/v3/files/' + encodeURIComponent(file.id), { method: 'DELETE' });
      assertDriveSession(session);
      driveSlots = driveSlots.filter(item => item.id !== file.id);
      if (driveAccountCacheIdentity) writeAccountSlotCache(driveAccountCacheIdentity, driveSlots);
      let cleanupWarning = '';
      if (previewId) {
        try {
          await driveFetch('/drive/v3/files/' + encodeURIComponent(previewId), { method: 'DELETE' });
          assertDriveSession(session);
        } catch (error) {
          cleanupWarning = '연결된 암호화 미리보기 파일 정리는 실패했지만 기본 저장 파일은 삭제했습니다.';
          try { if (console && console.warn) console.warn('[Wayward CloudSave] deleted-slot sidecar cleanup failed', error); } catch (_) {}
        }
      }
      preparedSlotRead = null;
      let refreshWarning = '';
      try { await refreshSlots(); assertDriveSession(session); }
      catch (error) {
        assertDriveSession(session);
        refreshWarning = '저장은 삭제했지만 목록 새로고침은 실패했습니다.';
      }
      const notice = [cleanupWarning, refreshWarning].filter(Boolean).join(' ');
      show({ page: 'home' }, notice || ('저장 슬롯 ' + slot + '을 삭제했습니다.'));
    }

    function formatSlotMetadata(file) {
      const size = Number(file && file.size) || 0;
      if (size <= 0) return '';
      return 'Drive 파일 ' + (size < 1024 * 1024
        ? Math.max(1, Math.round(size / 1024)) + ' KB'
        : (size / (1024 * 1024)).toFixed(1) + ' MB');
    }

    function closeMemoPopup() {
      const overlay = activeMemoDialog;
      if (!overlay) return;
      activeMemoDialog = null;
      if (overlay._wmlMemoKeyHandler) {
        document.removeEventListener('keydown', overlay._wmlMemoKeyHandler, true);
        overlay._wmlMemoKeyHandler = null;
      }
      try { if (overlay.open && typeof overlay.close === 'function') overlay.close(); } catch (_) {}
      overlay.remove();
    }

    function showMemoPopup(memo) {
      const value = String(memo || '');
      if (!value.trim()) return;
      closeMemoPopup();
      const overlay = document.createElement('dialog');
      overlay.className = 'wml-gd-memo-overlay';
      overlay.setAttribute('aria-label', '저장 메모');
      overlay.setAttribute('aria-modal', 'true');
      const box = document.createElement('div');
      box.className = 'wml-gd-memo-box';
      box.setAttribute('role', 'document');
      const content = document.createElement('div');
      content.textContent = value;
      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.className = 'wml-gd-memo-close';
      closeButton.textContent = '닫기';
      box.append(content, closeButton);
      overlay.append(box);
      const onKeyDown = event => {
        if (event.key === 'Escape' && activeMemoDialog === overlay) { event.preventDefault(); closeMemoPopup(); }
      };
      overlay._wmlMemoKeyHandler = onKeyDown;
      overlay.addEventListener('click', event => { if (event.target === overlay) closeMemoPopup(); });
      overlay.addEventListener('cancel', event => { event.preventDefault(); closeMemoPopup(); });
      overlay.addEventListener('close', () => { if (activeMemoDialog === overlay) closeMemoPopup(); });
      closeButton.addEventListener('click', closeMemoPopup);
      document.addEventListener('keydown', onKeyDown, true);
      activeMemoDialog = overlay;
      document.body.append(overlay);
      if (typeof overlay.showModal === 'function') {
        try { overlay.showModal(); } catch (_) { overlay.setAttribute('open', ''); }
      } else overlay.setAttribute('open', '');
    }

    function renderSlots(root) {
      if (previewObserver) { try { previewObserver.disconnect(); } catch (_) {} previewObserver = null; }
      previewTargets = new WeakMap();
      addTitle(root, 'Google Drive 저장 슬롯');
      const bySlot = new Map(driveSlots.map(file => [Number(file.name.match(/([0-9]+)\.json$/)[1]), file]));
      const used = new Set(bySlot.keys());
      let nextSlot = 1; while (used.has(nextSlot)) nextSlot++;
      const slots = Array.from(bySlot.keys()).sort((a, b) => a - b);
      if (!used.has(nextSlot)) slots.push(nextSlot);
      for (const slot of slots) {
        const file = bySlot.get(slot);
        const row = h('div', { class: 'wml-gd-slot' });
        const head = h('div', { class: 'wml-gd-slot-head' });
        const line = h('div', { class: 'wml-gd-slot-line' });
        line.append(h('div', { class: 'wml-gd-slot-title' }, '저장 슬롯 ' + slot));
        let memoButton = null;
        if (file) {
          memoButton = document.createElement('button');
          memoButton.type = 'button'; memoButton.className = 'wml-gd-memo-chip'; memoButton.hidden = true;
          memoButton.setAttribute('aria-label', '저장 메모 보기'); memoButton.setAttribute('data-wml-ui', 'true');
          memoButton.addEventListener('click', () => { const target = previewTargets.get(row); if (target && target.memo) showMemoPopup(target.memo); });
          line.append(memoButton);
        }
        head.append(line);
        head.append(h('div', { class: 'wml-gd-small' }, file ? '저장됨' : '저장된 게임이 없습니다.'));
        row.append(head);
        let summaryNode = null;
        if (file) {
          summaryNode = h('div', { class: 'wml-gd-summary' }, '저장 정보 미리보기를 불러오는 중…');
          row.append(summaryNode);
          const metadata = formatSlotMetadata(file);
          if (metadata) row.append(h('div', { class: 'wml-gd-small' }, metadata));
        }
        const actions = h('div', { class: 'wml-gd-actions' });
        actions.append(button(file ? '덮어쓰기' : '저장', () => file ? runAction(() => prepareSaveSlot(slot)) : show({ page: 'save', slot, memo: '' }), { primary: true }));
        if (file) {
          actions.append(button('불러오기', () => runAction(() => prepareLoadSlot(slot))));
          actions.append(button('삭제', () => show({ page: 'delete', slot })));
        }
        row.append(actions); root.append(row);
        if (file) observeSlotPreview(file, row, summaryNode, memoButton);
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
                lastListMetrics.durationMs + ' ms · API ' + lastListMetrics.apiCalls + '회 · ' +
                lastListMetrics.bodyDownloads + '개 본문 다운로드',
                'wml-gd-small');
              addText(root, 'Drive 요청 ' + lastListMetrics.apiRequestMs + ' ms · JSON 파싱 ' +
                lastListMetrics.jsonParseMs + ' ms · 렌더링 ' + lastListMetrics.renderMs + ' ms',
                'wml-gd-small');
            }
          } else if (slotsStatus === 'loading') {
            if (driveMetadataCacheAvailable || driveSlots.length) {
              addText(root, driveMetadataCacheAvailable
                ? '저장목록 캐시를 먼저 표시하고 최신 상태를 동기화하고 있습니다…'
                : '저장목록 최신 상태를 확인하고 있습니다…', 'wml-gd-small');
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
        addMessage(root);      } else if (view.page === 'load') {
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
      if (fallbackDockButton || nativeMenuEntrySeen) return;      fallbackDockButton = api.ui.addButton({
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
      if (activeMemoDialog) { closeMemoPopup(); return true; }
      if (!isConnected()) return false;
      if (view.page === 'home') { win.close(); return true; }
      show({ page: 'home' });
      return true;
    });
  }
});



