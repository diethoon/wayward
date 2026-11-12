/* Personal Google Drive-backed cloud saves for WML.
 * OAuth is completed on the fixed GitHub Pages callback and returned over a
 * nonce-bound message/Worker relay. Refresh tokens stay in the game origin.
 * Save contents are encrypted in the game page before direct upload to Drive.
 */
WML.define({
  id: 'cloud-save',
  name: '클라우드세이브 (Google Drive)',
  version: '0.4.4',
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
    let refreshToken = '';
    let tokenExpiresAt = 0;
    let driveSlots = [];
    let slotsStatus = 'not-loaded'; // not-loaded | loading | loaded | error
    let slotsError = '';
    const SESSION_POLICY_KEY = 'wml-google-drive-session-policy-v1';
    const SESSION_TOKEN_KEY = 'wml-google-drive-session-token-v1';
    let sessionPolicy = 'persistent';

    // Fixed GitHub Pages auth UI + Cloudflare token broker. The game origin
    // itself may be file://, localhost, LAN HTTP, HTTPS, or an embedded WebView.
    const AUTH_BRIDGE_URL = 'https://jeiky224.github.io/cloud/';
    const AUTH_API_URL = 'https://wayward-auth-relay.trpgengine1.workers.dev';
    const AUTH_RELAY_WS_URL = 'wss://wayward-auth-relay.trpgengine1.workers.dev';
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
    function loadSessionPolicy() {
      const saved = readStorage(SESSION_POLICY_KEY);
      return saved === 'session' ? 'session' : 'persistent';
    }
    sessionPolicy = loadSessionPolicy();

    function persistSessionToken() {
      if (sessionPolicy !== 'persistent' || !refreshToken) {
        writeStorage(SESSION_TOKEN_KEY, null);
        return;
      }
      writeStorage(SESSION_TOKEN_KEY, JSON.stringify({
        accessToken: hasToken() ? accessToken : '',
        refreshToken,
        expiresAt: tokenExpiresAt
      }));
    }

    function clearToken() {
      accessToken = '';
      refreshToken = '';
      tokenExpiresAt = 0;
      driveSlots = [];
      slotsStatus = 'not-loaded';
      slotsError = '';
      writeStorage(SESSION_TOKEN_KEY, null);
    }

    function restoreSessionToken() {
      if (sessionPolicy !== 'persistent') {
        writeStorage(SESSION_TOKEN_KEY, null);
        return;
      }
      const saved = readStorage(SESSION_TOKEN_KEY);
      if (!saved) return;
      try {
        const session = JSON.parse(saved);
        const validAccess = typeof session.accessToken === 'string' && session.accessToken &&
          Number.isFinite(Number(session.expiresAt)) && Number(session.expiresAt) > Date.now() + 30000;
        if (typeof session.refreshToken === 'string' && session.refreshToken) {
          refreshToken = session.refreshToken;
          if (validAccess) {
            accessToken = session.accessToken;
            tokenExpiresAt = Number(session.expiresAt);
          }
        } else if (validAccess) {
          // Backward compatibility with v0.4.4 access-token-only sessions.
          accessToken = session.accessToken;
          tokenExpiresAt = Number(session.expiresAt);
        } else writeStorage(SESSION_TOKEN_KEY, null);
      } catch (_) { writeStorage(SESSION_TOKEN_KEY, null); }
    }
    restoreSessionToken();

    function hasLogin() {
      return hasToken() || !!refreshToken;
    }

    function requestGoogleToken() {
      return new Promise((resolve, reject) => {
        let bridge = null;
        let socket = null;
        let timeout = null;
        let settled = false;
        const bridgeUrl = new URL(AUTH_BRIDGE_URL);
        const bridgeOrigin = bridgeUrl.origin;
        const nonceBytes = new Uint8Array(24);
        try { globalThis.crypto.getRandomValues(nonceBytes); }
        catch (_) { reject(new Error('이 브라우저에서 안전한 로그인 연결을 만들 수 없습니다.')); return; }
        const nonce = Array.from(nonceBytes, byte => byte.toString(16).padStart(2, '0')).join('');
        const rawOrigin = String(window.location.origin || '');
        const fallbackOrigin = /^(https?):$/.test(window.location.protocol) && window.location.host
          ? window.location.protocol + '//' + window.location.host : '';
        const gameOrigin = window.location.protocol === 'file:' || rawOrigin === 'null'
          ? 'null' : (rawOrigin || fallbackOrigin);
        if (!gameOrigin || !/^(https?|file):$/.test(window.location.protocol)) {
          reject(new Error('지원하지 않는 실행 주소입니다. file://, HTTP 또는 HTTPS에서 실행해 주세요.'));
          return;
        }
        bridgeUrl.searchParams.set('origin', gameOrigin);
        bridgeUrl.searchParams.set('nonce', nonce);

        const cleanup = () => {
          window.removeEventListener('message', onMessage);
          if (timeout) clearTimeout(timeout);
          try { if (socket && socket.readyState < 2) socket.close(); } catch (_) {}
        };
        const fail = error => {
          if (settled) return;
          settled = true;
          cleanup();
          try { if (bridge && !bridge.closed) bridge.close(); } catch (_) {}
          reject(error instanceof Error ? error : new Error(String(error || 'Google 연결에 실패했습니다.')));
        };
        const accept = payload => {
          if (settled || !payload || payload.nonce !== nonce) return;
          if (payload.type === 'wayward-cloud-auth-error') {
            fail(new Error(payload.message || 'Google 로그인이 취소되었거나 실패했습니다.'));
            return;
          }
          if (payload.type !== 'wayward-cloud-auth-success' ||
              typeof payload.accessToken !== 'string' || !payload.accessToken ||
              typeof payload.refreshToken !== 'string' || !payload.refreshToken) return;
          settled = true;
          cleanup();
          accessToken = payload.accessToken;
          refreshToken = payload.refreshToken;
          tokenExpiresAt = Date.now() + Math.max(60, Math.min(3600, Number(payload.expiresIn) || 3600)) * 1000;
          persistSessionToken();
          try { if (bridge && !bridge.closed) bridge.close(); } catch (_) {}
          resolve();
        };
        const onMessage = event => {
          if (event.origin !== bridgeOrigin || event.source !== bridge || !event.data) return;
          accept(event.data);
        };
        window.addEventListener('message', onMessage);

        // Open the popup synchronously from the click. The nonce-bound WebSocket
        // relay is independent of the game's origin and backs up postMessage in
        // file://, LAN, and embedded WebView environments.
        try {
          socket = new WebSocket(AUTH_RELAY_WS_URL + '/relay/' + nonce + '?role=game');
          socket.addEventListener('message', event => {
            let payload;
            try { payload = JSON.parse(String(event.data)); } catch (_) { return; }
            accept(payload);
          });
        } catch (_) { socket = null; }

        bridge = window.open(bridgeUrl.toString(), 'waywardGoogleDriveAuth',
          'popup=yes,width=520,height=720,resizable=yes,scrollbars=yes');
        if (!bridge) {
          cleanup();
          reject(new Error('로그인 창이 차단되었습니다. 팝업을 허용한 뒤 다시 눌러 주세요.'));
          return;
        }
        timeout = setTimeout(() => fail(new Error('Google 연결 시간이 초과되었습니다. 로그인 창에서 승인을 완료했는지 확인해 주세요.')), 180000);
      });
    }

    async function refreshAccessToken(force) {
      if (!force && hasToken()) return accessToken;
      if (!refreshToken) {
        if (hasToken()) return accessToken;
        clearToken();
        throw new Error('Google 로그인이 만료되었습니다. Google 계정으로 다시 연결해 주세요.');
      }
      let response;
      let data = {};
      try {
        response = await fetch(AUTH_API_URL + '/oauth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XmlHttpRequest' },
          cache: 'no-store',
          credentials: 'omit',
          body: JSON.stringify({ refreshToken })
        });
        try { data = await response.json(); } catch (_) {}
      } catch (_) {
        throw new Error('Google 로그인 유지 서버에 연결하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.');
      }
      if (response.status === 401 || data.invalidGrant) {
        clearToken();
        throw new Error('Google 로그인 유지 토큰이 폐기되었거나 만료되었습니다. 다시 로그인해 주세요.');
      }
      if (!response.ok || !data.accessToken) {
        throw new Error(data.error || ('Google 로그인 갱신 실패 (' + response.status + ')'));
      }
      accessToken = String(data.accessToken);
      if (typeof data.refreshToken === 'string' && data.refreshToken) refreshToken = data.refreshToken;
      tokenExpiresAt = Date.now() + Math.max(60, Math.min(3600, Number(data.expiresIn) || 3600)) * 1000;
      persistSessionToken();
      return accessToken;
    }

    async function ensureAccessToken() {
      if (hasToken()) return accessToken;
      return refreshAccessToken(false);
    }

    async function driveFetch(path, options) {
      await ensureAccessToken();
      const opts = Object.assign({ method: 'GET', headers: {} }, options || {});
      opts.headers = Object.assign({}, opts.headers || {});
      const send = () => {
        opts.headers.Authorization = 'Bearer ' + accessToken;
        return fetch('https://www.googleapis.com' + path, opts);
      };
      let response = await send();
      if (response.status === 401 && refreshToken) {
        await refreshAccessToken(true);
        response = await send();
      }
      if (response.status === 401) {
        clearToken();
        throw new Error('Google 연결이 만료되었거나 접근 권한이 취소되었습니다. 다시 로그인해 주세요.');
      }
      if (!response.ok) {
        let detail = '';
        try {
          const data = await response.clone().json();
          detail = data && data.error && data.error.message ? data.error.message : '';
        } catch (_) { /* response body may not be JSON */ }
        throw new Error('Google Drive 요청 실패 (' + response.status + ')' + (detail ? ': ' + detail : ''));
      }
      return response;
    }

    async function refreshSlots() {
      slotsStatus = 'loading';
      slotsError = '';
      if (isConnected()) render();
      try {
      const slots = new Map(); let pageToken = '';
      do {
        const params = new URLSearchParams({ spaces: 'appDataFolder', pageSize: '100', q: 'trashed = false', fields: 'files(id,name,modifiedTime,size),nextPageToken' });
        if (pageToken) params.set('pageToken', pageToken);
        const response = await driveFetch('/drive/v3/files?' + params.toString());
        const data = await response.json();
        for (const file of (Array.isArray(data.files) ? data.files : [])) {
          const match = new RegExp('^' + FILE_PREFIX + '([1-9][0-9]*)\\.json$').exec(String(file.name || ''));
          if (!match) continue;
          const slot = Number(match[1]); if (!Number.isSafeInteger(slot) || slot < 1) continue;
          const previous = slots.get(slot);
          if (!previous || String(file.modifiedTime || '') > String(previous.modifiedTime || '')) slots.set(slot, file);
        }
        pageToken = data.nextPageToken || '';
      } while (pageToken);
      driveSlots = Array.from(slots.values()).sort((a,b) => Number(a.name.match(/([0-9]+)\.json$/)[1]) - Number(b.name.match(/([0-9]+)\.json$/)[1]));
      for (const file of driveSlots) {
        try {
          const envelope = await readSlotEnvelope(file);
          if (envelope && envelope.keyMode === 'embedded-addon-v2') {
            const snapshot = await globalThis.WMLGoogleDriveCrypto.decryptSnapshotEmbedded(envelope);
            file.memo = String(snapshot.memo || ''); file.summary = makeSummary(snapshot);
          } else { file.memo = ''; file.summary = ''; }
        } catch (_) { file.memo = ''; file.summary = ''; file.unreadable = true; }
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
      } else openWindow();
      // A restored token does not imply that the Drive file list has been restored.
      // Fetch it on first open and never render an unverified empty list as empty slots.
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
      // Open the popup synchronously from the user's click before rendering,
      // otherwise the browser may treat it as an unsolicited popup.
      const task = requestGoogleToken();
      busy = true;
      message = 'Google 로그인 창을 여는 중…';
      render();
      task
        .then(() => refreshSlots())
        .then(() => show({ page: 'home' }, 'Google Drive에 연결했습니다.'))
        .catch(error => {
          clearToken();
          message = String(error && error.message || error || 'Google 연결에 실패했습니다.');
          render();
        })
        .finally(() => {
          busy = false;
          if (isConnected()) render();
        });
    }

    async function logoutGoogleAccount() {
      const savedRefreshToken = refreshToken;
      const savedAccessToken = accessToken;
      let revoked = false;
      try {
        if (savedRefreshToken || savedAccessToken) {
          const response = await fetch(AUTH_API_URL + '/oauth/revoke', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XmlHttpRequest' },
            cache: 'no-store',
            credentials: 'omit',
            body: JSON.stringify({ refreshToken: savedRefreshToken, accessToken: savedAccessToken })
          });
          let data = {};
          try { data = await response.json(); } catch (_) {}
          revoked = response.ok && data.revoked === true;
        }
      } catch (_) { /* Always clear local credentials even when Google is unreachable. */ }
      clearToken();
      show({ page: 'home' }, revoked
        ? 'Google 연결을 로그아웃하고 이 브라우저의 로그인 토큰도 삭제했습니다.'
        : '이 브라우저의 로그인 정보는 삭제했습니다. Google 측 권한 철회는 확인되지 않았습니다.');
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
      description.textContent = '로그인 유지를 선택하면 Google refresh token을 이 게임 실행 주소의 브라우저 저장소에 보관하고, 액세스 토큰이 만료될 때 자동 갱신합니다. Google에서 권한을 취소하거나 보안 정책으로 토큰이 폐기되지 않는 동안에는 재실행 후에도 연결을 유지합니다.';
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
          sessionPolicy = policy;
          writeStorage(SESSION_POLICY_KEY, sessionPolicy);
          if (sessionPolicy === 'persistent') persistSessionToken();
          else writeStorage(SESSION_TOKEN_KEY, null);
          close();
          show({ page: 'home' }, policy === 'persistent'
            ? '로그인 유지 설정을 저장했습니다. Google 권한이 유효한 동안 만료된 액세스 토큰을 자동 갱신합니다.'
            : '새로고침하면 로그아웃하도록 설정했습니다.');
        });
        actions.append(choice);
      };
      addChoice('새로고침하면 로그아웃', 'session', '현재 열린 게임 탭에서만 refresh token을 메모리에 유지');
      addChoice('로그인 계속 유지', 'persistent', 'refresh token을 이 실행 주소에 저장하고 액세스 토큰을 자동 갱신');
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
          '구글계정으로 연결하면 현재 진행 상황이 암호화되어 드라이브에 직접 저장됩니다.');
        addButton(root, hasLogin() ? '저장 목록 새로고침' : 'Google 계정으로 연결',
          hasLogin() ? () => runAction(async () => {
            await refreshSlots();
            show({ page: 'home' }, '저장 목록을 새로고침했습니다.');
          }) : connectFromClick, true);
        addButton(root, '로그인 유지 설정', showSessionSettingsPopup);
        addButton(root, '로그아웃', () => runAction(() => logoutGoogleAccount()));
        addText(root, hasLogin()
          ? (sessionPolicy === 'persistent'
            ? '상태: 연결됨 (Google 권한이 유지되는 동안 자동 로그인 갱신)'
            : '상태: 연결됨 (현재 게임 탭에서만 유지)')
          : '상태: 연결되지 않음', 'wml-gd-small');
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