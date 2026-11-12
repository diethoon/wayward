(() => {
  "use strict";
  if (window.__waywardImageStudioLauncherInstalled) return;
  window.__waywardImageStudioLauncherInstalled = true;

  const host = window.WMLHost;
  const LOCAL_ORIGIN = "http://127.0.0.1:8189";
  const delay = ms => new Promise(resolve => window.setTimeout(resolve, ms));
  let backendProbe = null;
  let probeRunning = null;
  let lastRuntimeSignature = "";
  let discoveryBusy = false;
  let discoveryComplete = false;
  let discoveryResult = null;

  function installLauncherOwnedSettingsUi() {
    const apply = () => {
      const root = window.document;
      if (!root || typeof root.querySelector !== "function") return;
      const hide = element => {
        if (!element) return;
        element.hidden = true;
        if (typeof element.setAttribute === "function") element.setAttribute("aria-hidden", "true");
        if (element.style && typeof element.style.setProperty === "function") {
          element.style.setProperty("display", "none", "important");
        }
      };

      // Prompt/character editing stays in Image Studio. Engine and server
      // selection are launcher-owned and are not exposed as game controls.
      const engineButton = root.querySelector("#wwis-generation-settings");
      if (engineButton) {
        engineButton.textContent = "생성 옵션 (엔진·서버는 런처 관리)";
        if (typeof engineButton.setAttribute === "function") {
          engineButton.setAttribute("aria-label", "생성 옵션. 엔진과 서버는 런처에서 관리합니다.");
        }
      }
      const providerRadio = root.querySelector('input[name="wwis-provider"]');
      hide(providerRadio && typeof providerRadio.closest === "function"
        ? providerRadio.closest(".wwis-card") : null);
      hide(root.querySelector("#wwis-comfy-settings"));

      // Credentials can only be entered or cleared in launcher settings.
      for (const selector of ["#wwis-nai-token", "#wwis-nai-token-clear"]) {
        const control = root.querySelector(selector);
        hide(control && typeof control.closest === "function" ? control.closest("label") : control);
      }
      const naiCheck = root.querySelector("#wwis-nai-check");
      hide(naiCheck && typeof naiCheck.closest === "function"
        ? (naiCheck.closest(".wwis-row") || naiCheck) : naiCheck);

      const naiCard = root.querySelector("#wwis-nai-settings");
      if (naiCard && typeof root.createElement === "function"
          && !root.querySelector("#wwis-launcher-nai-credential-note")) {
        const note = root.createElement("p");
        note.id = "wwis-launcher-nai-credential-note";
        note.className = "wwis-setting-status";
        note.textContent = "NovelAI 인증 정보와 서버 선택은 런처 설정에서만 관리됩니다.";
        const heading = naiCard.querySelector && naiCard.querySelector("h3");
        if (heading && heading.parentNode && typeof heading.parentNode.insertBefore === "function") {
          heading.parentNode.insertBefore(note, heading.nextSibling);
        }
      }

      const settingsTitle = root.querySelector(".wwis-generation-toolbar strong");
      if (settingsTitle && settingsTitle.textContent !== "생성 옵션 · 엔진/서버는 런처 관리") {
        settingsTitle.textContent = "생성 옵션 · 엔진/서버는 런처 관리";
      }
    };

    apply();
    if (window.MutationObserver && window.document && window.document.documentElement) {
      const observer = new window.MutationObserver(apply);
      observer.observe(window.document.documentElement, { childList: true, subtree: true });
      window.__waywardLauncherSettingsUiObserver = observer;
    }
  }

  function report(event, details) {
    try {
      if (host && typeof host.logImageProviderDiagnostic === "function") {
        host.logImageProviderDiagnostic(event, JSON.stringify(details || {}));
      }
    } catch (_) {}
  }

  function gameSettings() {
    try {
      const root = JSON.parse(window.localStorage.getItem("tavern-settings") || "{}");
      return root && root.state && typeof root.state === "object" ? root.state : root;
    } catch (_) { return {}; }
  }

  function prefersLauncherLocal() {
    return runtimeStatus().ready === true;
  }

  function runtimeEngine(status) {
    const declared = String(status && status.engine || "").trim().toLowerCase();
    if (declared) return declared;
    const version = String(status && status.backendVersion || "");
    const parts = version.split(":");
    return parts[0] === "launcher-imagegen" && parts[2]
      ? parts[2].toLowerCase()
      : "unknown";
  }

  function runtimeStatus() {
    let status = null;
    try {
      if (host && typeof host.imageGenRuntimeStatus === "function") {
        const raw = host.imageGenRuntimeStatus();
        status = typeof raw === "string" ? JSON.parse(raw) : raw;
      }
    } catch (_) {}

    const result = {
      available: !!(status && status.available === true),
      starting: !!(status && status.starting === true),
      ready: !!(status && status.ready === true),
      backendVersion: String(status && status.backendVersion || ""),
      engine: runtimeEngine(status)
    };
    try {
      window.__WAYWARD_LAUNCHER_IMAGE_RUNTIME__ = Object.freeze({
        available: result.available,
        starting: result.starting,
        ready: result.ready,
        engine: result.engine,
        offlineOnly: !result.ready
      });
      window.__WW_STUDIO_OFFLINE_ONLY__ = !result.ready;
    } catch (_) {}
    return result;
  }

  function isApiPath(path) {
    try {
      return new URL(String(path || ""), LOCAL_ORIGIN + "/").pathname.startsWith("/api/");
    } catch (_) { return false; }
  }

  function isGenerationPath(pathname) {
    return /^\/api\/batch\/enqueue(?:\/|$)/.test(pathname) ||
      /^\/api\/(?:image|images)\/generate(?:\/|$)/.test(pathname) ||
      /^\/api\/generation\/(?:generate|enqueue)(?:\/|$)/.test(pathname);
  }

  function backendState() {
    const status = runtimeStatus();
    const serverAvailable = status.available || status.starting;
    const ready = serverAvailable && status.ready;
    return {
      baseUrl: serverAvailable ? LOCAL_ORIGIN : null,
      comfyui: ready,
      images: 0,
      version: status.backendVersion || null,
      error: !serverAvailable ? "launcher_server_not_running" : (ready ? null : "provider_not_ready"),
      launcherManaged: true,
      engine: status.engine
    };
  }

  function localEndpoint(path) {
    const raw = String(path || "").trim();
    if (!raw || raw.indexOf("\\") >= 0 || raw.indexOf("\0") >= 0) return null;
    let url;
    try { url = new URL(raw, LOCAL_ORIGIN + "/"); }
    catch (_) { return null; }
    if (url.username || url.password ||
        (url.protocol !== "http:" && url.protocol !== "https:")) return null;

    if (url.pathname.startsWith("/api/")) {
      const state = runtimeStatus();
      if (!state.available && !state.starting) return null;
      if (isGenerationPath(url.pathname) && !state.ready) return null;
      return LOCAL_ORIGIN + url.pathname + url.search;
    }

    if (!url.pathname.startsWith("/images/")) return null;
    const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
    const localImageOrigin = url.origin === LOCAL_ORIGIN || url.origin === "http://localhost:8189";
    if (absolute && !localImageOrigin) return null;

    const encodedSegments = url.pathname.slice("/images/".length).split("/");
    if (!encodedSegments.length) return null;
    const segments = [];
    try {
      for (const encoded of encodedSegments) {
        const segment = decodeURIComponent(encoded);
        if (!segment || segment === "." || segment === ".." ||
            segment.indexOf("/") >= 0 || segment.indexOf("\\") >= 0 ||
            segment.indexOf("\0") >= 0) return null;
        segments.push(encodeURIComponent(segment));
      }
    } catch (_) { return null; }

    const gameOrigin = String(window.location && window.location.origin || "");
    try {
      const parsedGameOrigin = new URL(gameOrigin);
      if (parsedGameOrigin.protocol !== "https:" || parsedGameOrigin.origin !== gameOrigin) return null;
    } catch (_) { return null; }
    return gameOrigin + "/images/__wayward_generated__/" + segments.join("/") + url.search;
  }

  function imageElementSource(value) {
    const raw = String(value || "").trim();
    if (!raw) return value;
    let path = "";
    try { path = new URL(raw, window.location && window.location.href || LOCAL_ORIGIN + "/").pathname; }
    catch (_) { return value; }
    if (!path.startsWith("/images/")) return value;
    const mapped = localEndpoint(raw);
    if (!mapped || mapped === raw) return value;
    report("generated_image_url_rewritten", { path: path.slice(0, 200), targetOrigin: window.location.origin });
    return mapped;
  }

  function installImageElementUrlRewrite() {
    const prototype = window.HTMLImageElement && window.HTMLImageElement.prototype;
    if (!prototype || prototype.__waywardGeneratedImageUrlRewrite) {
      report("generated_image_dom_rewrite_unavailable", {});
      return;
    }
    try {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "src");
      if (!descriptor || typeof descriptor.set !== "function" || typeof descriptor.get !== "function") {
        report("generated_image_src_descriptor_unavailable", {});
        return;
      }
      Object.defineProperty(prototype, "src", {
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
        get() { return descriptor.get.call(this); },
        set(value) { descriptor.set.call(this, imageElementSource(value)); }
      });
      const nativeSetAttribute = prototype.setAttribute || (window.Element && window.Element.prototype.setAttribute);
      if (typeof nativeSetAttribute === "function") {
        prototype.setAttribute = function(name, value) {
          const next = String(name || "").toLowerCase() === "src"
            ? imageElementSource(value) : value;
          return nativeSetAttribute.call(this, name, next);
        };
      }
      Object.defineProperty(prototype, "__waywardGeneratedImageUrlRewrite", { value: true });
      report("generated_image_dom_rewrite_installed", {});
    } catch (error) {
      report("generated_image_dom_rewrite_failed", {
        reason: String(error && (error.message || error)).slice(0, 160)
      });
    }
  }

  function refreshBackendProbe(reason) {
    const state = backendState();
    const ok = state.comfyui === true;
    report("studio_backend_probe_completed", {
      reason: String(reason || "runtime_state_changed"),
      available: !!state.baseUrl,
      ready: ok,
      connected: !!state.baseUrl,
      selectedLocal: !!state.baseUrl,
      engine: state.engine
    });
    // Never invoke the original probe: it honors the game-configured URL.
    return Promise.resolve({
      ok,
      retry: !ok,
      reason: state.error || null,
      baseUrl: state.baseUrl,
      comfyui: state.comfyui,
      engine: state.engine
    });
  }

  function registerBackendProbe(probe) {
    if (typeof probe !== "function") return;
    backendProbe = probe;
    report("studio_backend_probe_hooked", {});
    void refreshBackendProbe("probe_hooked");
  }

  function wrapLegacyApi(value) {
    if (!value) return value;
    let originalGet;
    try { originalGet = value.get; } catch (_) { return value; }
    if (typeof originalGet !== "function") return value;
    try {
      const facade = Object.create(value);
      const descriptor = Object.getOwnPropertyDescriptor(value, "get");
      Object.defineProperty(facade, "get", {
        configurable: true,
        enumerable: descriptor ? descriptor.enumerable : true,
        writable: true,
        value(name, ...args) {
          const resolved = originalGet.apply(value, [name, ...args]);
          if (name !== "ph" || typeof resolved !== "function") return resolved;
          return (...callArgs) => ({
            ...(resolved(...callArgs) || {}),
            ...backendState()
          });
        }
      });
      return facade;
    } catch (_) { return value; }
  }

  function installLegacyApiHook() {
    let current = null;
    try { current = window.__WML_LEGACY__ || null; } catch (_) {}
    try {
      Object.defineProperty(window, "__WML_LEGACY__", {
        configurable: true,
        enumerable: true,
        get() { return current; },
        set(value) { current = wrapLegacyApi(value); }
      });
      if (current) current = wrapLegacyApi(current);
    } catch (_) {
      if (current) current = wrapLegacyApi(current);
    }
  }

  function wrapSettingsStore(store) {
    if (!store || typeof store.getState !== "function") return store;
    try {
      const originalGetState = store.getState.bind(store);
      const facade = Object.create(store);
      Object.defineProperty(facade, "getState", {
        configurable: true,
        enumerable: true,
        writable: true,
        value() {
          const state = originalGetState();
          if (!state || typeof state !== "object") return state;
          // The launcher owns engine selection. Never expose a game-selected remote backend.
          const active = runtimeStatus().ready === true;
          const imageBackendMode = active ? "auto" : "off";
          const imageBackendUrl = active ? LOCAL_ORIGIN : "";
          if (state.imageBackendMode === imageBackendMode && state.imageBackendUrl === imageBackendUrl) {
            return state;
          }
          return { ...state, imageBackendMode, imageBackendUrl };
        }
      });
      return facade;
    } catch (_) {
      return store;
    }
  }

  function wrapPauseSettingsFactory(factory) {
    if (!factory || typeof factory.connect !== "function" || factory.__waywardImageStudioWrapped) return factory;
    const originalConnect = factory.connect;
    try { Object.defineProperty(factory, "__waywardImageStudioWrapped", { value: true }); } catch (_) {}
    try {
      factory.connect = function(wmlApi, config, ...rest) {
        const api = originalConnect.call(this, wmlApi, config, ...rest);
        if (!config || config.id !== "imagestudio" || !api || typeof api.fn !== "function") return api;
        const originalFn = api.fn.bind(api);
        try {
          api.fn = function(name, ...args) {
            const value = originalFn(name, ...args);
            if (name === "settingsStore") return wrapSettingsStore(value);
            if (name === "imageBackendProbe" && typeof value === "function") {
              registerBackendProbe(value);
              return (..._args) => refreshBackendProbe("game_backend_probe");
            }
            if (name === "imageServerUrl" && typeof value === "function") {
              return path => {
                if (!path) return backendState().baseUrl;
                const local = localEndpoint(path);
                if (local) return local;
                return isApiPath(path) ? null : value(path);
              };
            }
            if (name === "imageBackend" && typeof value === "function") {
              return (...callArgs) => ({
                ...(value(...callArgs) || {}),
                ...backendState()
              });
            }
            return value;
          };
        } catch (_) {
          report("studio_api_probe_wrapper_unavailable", {});
        }
        try {
          const probe = originalFn("imageBackendProbe");
          if (typeof probe === "function") registerBackendProbe(probe);
        } catch (_) {}
        return api;
      };
    } catch (_) {
      report("studio_factory_wrapper_unavailable", {});
    }
    return factory;
  }

  function installPauseSettingsFactoryHook() {
    let current = null;
    try { current = window.__waywardPauseSettingsUiFactory || null; } catch (_) {}
    try {
      Object.defineProperty(window, "__waywardPauseSettingsUiFactory", {
        configurable: true,
        enumerable: true,
        get() { return current; },
        set(value) { current = wrapPauseSettingsFactory(value); }
      });
      if (current) current = wrapPauseSettingsFactory(current);
    } catch (_) {
      if (current) wrapPauseSettingsFactory(current);
    }
  }

  function wrapStudioBridge(value) {
    if (!value || typeof value.connection !== "function" || value.__waywardLauncherConnectionWrapped) return value;
    const facade = Object.create(value);
    const originalConnection = value.connection.bind(value);
    Object.defineProperty(facade, "connection", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: (...args) => ({
        ...(originalConnection(...args) || {}),
        ...backendState()
      })
    });
    if (typeof value.setOfflineOnly === "function") {
      const originalSetOfflineOnly = value.setOfflineOnly.bind(value);
      Object.defineProperty(facade, "setOfflineOnly", {
        configurable: true,
        enumerable: true,
        writable: true,
        value: _requested => originalSetOfflineOnly(!runtimeStatus().ready)
      });
    }
    try { Object.defineProperty(facade, "__waywardLauncherConnectionWrapped", { value: true }); } catch (_) {}
    report("studio_connection_bridge_wrapped", {});
    return facade;
  }

  function installStudioBridgeHook() {
    let current = null;
    try { current = window.WW_ImageStudioBridge || null; } catch (_) {}
    try {
      Object.defineProperty(window, "WW_ImageStudioBridge", {
        configurable: true,
        enumerable: true,
        get() { return current; },
        set(value) { current = wrapStudioBridge(value); }
      });
      if (current) current = wrapStudioBridge(current);
    } catch (_) {
      if (current) current = wrapStudioBridge(current);
    }
  }

  function installSettingsSaveProbe() {
    if (typeof window.fetch !== "function" || window.__waywardImageStudioFetchWrapped) return;
    window.__waywardImageStudioFetchWrapped = true;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = function(input, init) {
      let isSettingsSave = false;
      try {
        const rawUrl = typeof input === "string" ? input : input && input.url;
        const url = new URL(String(rawUrl || ""), window.location.href);
        const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
        isSettingsSave = method === "PUT" && url.pathname === "/api/generation/settings"
          && (url.hostname === "127.0.0.1" || url.hostname === "localhost") && url.port === "8189";
      } catch (_) {}
      const request = nativeFetch(input, init);
      if (!isSettingsSave || !request || typeof request.then !== "function") return request;
      return request.then(response => {
        if (response && response.ok) {
          window.setTimeout(() => { void refreshBackendProbe("generation_settings_saved"); }, 150);
        }
        return response;
      });
    };
  }

  function serverOrigin() {
    const state = runtimeStatus();
    return state.available || state.starting ? LOCAL_ORIGIN : null;
  }

  async function discoverNow() {
    if (discoveryBusy) return { ok: false, reason: "discovery_busy" };
    const bridge = window.WW_ImageStudioBridge;
    if (!bridge || typeof bridge.characters !== "function") {
      return { ok: false, retry: true, reason: "imagestudio_roster_not_ready" };
    }

    let roster;
    try { roster = bridge.characters(); }
    catch (_) { return { ok: false, retry: true, reason: "character_registry_unavailable" }; }
    const source = Array.isArray(roster && roster.characters) ? roster.characters : [];
    if (!source.length) return { ok: false, retry: true, reason: "character_registry_empty" };

    const characters = source.filter(character =>
      character &&
      /^[a-z0-9][a-z0-9_-]{0,99}$/.test(String(character.id || "").trim().toLowerCase()) &&
      String(character.id || "").trim().toLowerCase() !== "patron" &&
      String(character.originalPrompt || "").trim()
    ).map(character => ({
      id: String(character.id).trim().toLowerCase(),
      name: String(character.name || character.id).trim().slice(0, 100),
      prompt: String(character.prompt || "").trim(),
      negativePrompt: String(character.negativePrompt || "").trim(),
      originalPrompt: String(character.originalPrompt || "").trim(),
      originalNegativePrompt: String(character.originalNegativePrompt || "").trim()
    }));
    if (!characters.length) return { ok: true, found: source.length, added: 0, existing: 0, skipped: source.length };

    const origin = serverOrigin();
    if (!origin) return { ok: false, retry: true, reason: "image_server_connection_pending", found: characters.length };
    discoveryBusy = true;
    let added = 0;
    let existing = 0;
    try {
      for (let offset = 0; offset < characters.length; offset += 200) {
        const batch = characters.slice(offset, offset + 200);
        const response = await window.fetch(origin + "/api/generation/characters/discover-batch", {
          method: "POST",
          credentials: "omit",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ characters: batch })
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !Array.isArray(body.results) || body.results.length !== batch.length) {
          throw new Error("character_discovery_http_" + response.status);
        }
        for (const item of body.results) {
          if (item && item.added) added++;
          else existing++;
        }
      }
      discoveryComplete = true;
      discoveryResult = { ok: true, found: characters.length, added, existing, skipped: Number(roster.skipped) || 0 };
      report("studio_roster_discovery_completed", discoveryResult);
      return discoveryResult;
    } catch (error) {
      const result = { ok: false, retry: true, reason: String(error && (error.message || error)).slice(0, 100), found: characters.length, added, existing };
      report("studio_roster_discovery_retry", result);
      return result;
    } finally { discoveryBusy = false; }
  }

  async function openGenerationSettings() {
    const studio = window.WW_ImageStudio;
    if (!studio || typeof studio.open !== "function") {
      report("studio_settings_open_failed", { reason: "imagestudio_not_loaded" });
      return { ok: false, reason: "imagestudio_not_loaded" };
    }
    try { studio.open(); }
    catch (_) {
      report("studio_settings_open_failed", { reason: "studio_open_threw" });
      return { ok: false, reason: "studio_open_failed" };
    }
    for (let attempt = 0; attempt < 60; attempt++) {
      const button = document.querySelector("#wwis-generation-settings");
      if (button && !button.disabled) {
        button.click();
        report("studio_settings_opened", {});
        return { ok: true };
      }
      await delay(100);
    }
    report("studio_settings_open_failed", { reason: "settings_button_timeout" });
    return { ok: false, reason: "settings_button_timeout" };
  }

  function watchManagedServer() {
    let attempts = 0;
    const check = () => {
      if (attempts++ >= 300) return;
      const state = runtimeStatus();
      const signature = [state.available, state.starting, state.ready, state.backendVersion].join(":");
      if (state.available && signature !== lastRuntimeSignature) {
        lastRuntimeSignature = signature;
        void refreshBackendProbe("managed_server_state_changed");
      }
      if (!state.ready || !backendProbe) window.setTimeout(check, 500);
    };
    window.setTimeout(check, 500);
  }

  function installLauncherOwnedSettingsUi() {
    const apply = () => {
      const root = window.document;
      if (!root) return;
      const hide = element => {
        if (!element) return;
        element.hidden = true;
        element.setAttribute("aria-hidden", "true");
        element.style.setProperty("display", "none", "important");
      };

      // Keep prompt/character editing available, but remove game-side engine choice.
      const engineButton = root.querySelector("#wwis-generation-settings");
      if (engineButton) {
        engineButton.textContent = "생성 옵션 (엔진·서버는 런처 관리)";
        engineButton.setAttribute("aria-label", "생성 옵션. 엔진과 서버는 런처에서 관리합니다.");
      }
      const engineChoice = root.querySelector('input[name="wwis-provider"]');
      hide(engineChoice && engineChoice.closest(".wwis-card"));

      // The Comfy URL/models card is launcher-owned. The in-game editor cannot
      // select a remote Comfy endpoint or cause background probes against it.
      hide(root.querySelector("#wwis-comfy-settings"));

      // NAI credentials and credential checks are exclusively managed by the launcher.
      for (const selector of ["#wwis-nai-token", "#wwis-nai-token-clear"]) {
        const control = root.querySelector(selector);
        hide(control && (control.closest("label") || control));
      }
      const naiCheck = root.querySelector("#wwis-nai-check");
      hide(naiCheck && (naiCheck.closest(".wwis-row") || naiCheck));

      const naiCard = root.querySelector("#wwis-nai-settings");
      if (naiCard && !root.querySelector("#wwis-launcher-nai-credential-note")) {
        const note = root.createElement("p");
        note.id = "wwis-launcher-nai-credential-note";
        note.className = "wwis-setting-status";
        note.textContent = "NovelAI 인증 정보와 서버 선택은 런처 설정에서만 관리됩니다.";
        const heading = naiCard.querySelector("h3");
        if (heading && heading.parentNode) heading.parentNode.insertBefore(note, heading.nextSibling);
      }

      const settingsTitle = root.querySelector(".wwis-generation-toolbar strong");
      if (settingsTitle && settingsTitle.textContent !== "생성 옵션 · 엔진/서버는 런처 관리") {
        settingsTitle.textContent = "생성 옵션 · 엔진/서버는 런처 관리";
      }
    };

    apply();
    if (window.MutationObserver && window.document && window.document.documentElement) {
      const observer = new window.MutationObserver(apply);
      observer.observe(window.document.documentElement, { childList: true, subtree: true });
      window.__waywardLauncherSettingsUiObserver = observer;
    }
  }

  installLauncherOwnedSettingsUi();
  installImageElementUrlRewrite();
  installLauncherOwnedSettingsUi();
  installLegacyApiHook();
  installPauseSettingsFactoryHook();
  installStudioBridgeHook();
  installSettingsSaveProbe();

  window.WaywardLauncherImageStudio = Object.freeze({
    openGenerationSettings,
    discoverNow,
    refreshBackendProbe,
    getDiscoveryStatus: () => ({ complete: discoveryComplete, result: discoveryResult }),
    getRuntimeStatus: runtimeStatus
  });

  if (!window.__WAYWARD_IMAGE_STUDIO_TEST__) {
    let attempts = 0;
    const retry = async () => {
      if (discoveryComplete || attempts >= 90) return;
      attempts++;
      const result = await discoverNow();
      if (!result.ok || result.retry) window.setTimeout(retry, Math.min(5000, 500 + attempts * 100));
    };
    window.setTimeout(retry, 500);
    watchManagedServer();
  }
})();
