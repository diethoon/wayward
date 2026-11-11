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
    const settings = gameSettings();
    const mode = String(settings.imageBackendMode || "auto");
    if (mode === "off") return false;
    if (mode !== "custom") return true;
    const raw = String(settings.imageBackendUrl || "").trim().replace(/\/+$/, "");
    return raw === LOCAL_ORIGIN || raw === "http://localhost:8189";
  }

  function runtimeStatus() {
    try {
      if (!host || typeof host.imageGenRuntimeStatus !== "function") {
        return { available: false, starting: false, ready: false };
      }
      const raw = host.imageGenRuntimeStatus();
      const status = typeof raw === "string" ? JSON.parse(raw) : raw;
      return {
        available: status && status.available === true,
        starting: status && status.starting === true,
        ready: status && status.ready === true,
        backendVersion: String(status && status.backendVersion || "")
      };
    } catch (_) {
      return { available: false, starting: false, ready: false };
    }
  }

  function localEndpoint(path) {
    if (!prefersLauncherLocal()) return null;
    const value = String(path || "").trim();
    if (!value || value.indexOf("\\") >= 0 || value.indexOf("\0") >= 0) return null;
    const state = runtimeStatus();
    if (!state.available && !state.starting) return null;

    let url;
    try { url = new URL(value, LOCAL_ORIGIN + "/"); }
    catch (_) { return null; }
    if (url.username || url.password ||
        (url.origin !== LOCAL_ORIGIN && url.origin !== "http://localhost:8189")) return null;

    if (url.pathname.startsWith("/api/")) return LOCAL_ORIGIN + url.pathname + url.search;
    if (!url.pathname.startsWith("/images/")) return null;

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
    if (!backendProbe || !prefersLauncherLocal()) return Promise.resolve({ ok: false, reason: "probe_unavailable" });
    const state = runtimeStatus();
    if (!state.available && !state.starting) return Promise.resolve({ ok: false, retry: true, reason: "server_not_available" });
    if (probeRunning) {
      if (reason === "generation_settings_saved") {
        return probeRunning.then(
          () => refreshBackendProbe("generation_settings_saved_after_pending_probe"),
          () => refreshBackendProbe("generation_settings_saved_after_pending_probe")
        );
      }
      return probeRunning;
    }

    const settings = gameSettings();
    const mode = String(settings.imageBackendMode || "auto");
    const options = mode === "custom"
      ? { mode: "custom", url: String(settings.imageBackendUrl || "").trim(), allowAutoProbe: true }
      : { mode: "auto", url: "", allowAutoProbe: true };

    probeRunning = Promise.resolve()
      .then(() => backendProbe(options, true))
      .then(result => {
        const connection = result && typeof result === "object" ? result : {};
        const ok = connection.baseUrl === LOCAL_ORIGIN || connection.baseUrl === "http://localhost:8189";
        report("studio_backend_probe_completed", {
          reason: String(reason || "runtime_state_changed"),
          available: state.available,
          ready: state.ready,
          connected: !!connection.baseUrl,
          selectedLocal: ok
        });
        return { ok, baseUrl: connection.baseUrl || null, comfyui: connection.comfyui === true };
      })
      .catch(error => {
        report("studio_backend_probe_failed", {
          reason: String(reason || "runtime_state_changed"),
          errorType: error && error.name ? String(error.name) : "Error"
        });
        return { ok: false, retry: true, reason: "backend_probe_failed" };
      })
      .finally(() => { probeRunning = null; });
    return probeRunning;
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

    const wrappedGet = (name, ...args) => {
      const resolved = originalGet.apply(value, [name, ...args]);
      if (name !== "ph" || typeof resolved !== "function") return resolved;
      return (...callArgs) => {
        const current = resolved(...callArgs) || {};
        const state = runtimeStatus();
        if (!prefersLauncherLocal() || (!state.available && !state.starting)) return current;
        return { ...current, baseUrl: LOCAL_ORIGIN, comfyui: state.ready };
      };
    };

    // Do not Proxy the WML API. Its get member can be a frozen, non-configurable
    // native function; returning wrappedGet from a Proxy get trap violates the
    // ECMAScript Proxy invariant and aborts Image Studio setup. A facade lets us
    // override get without mutating or proxying the original object.
    try {
      const facade = Object.create(value);
      const descriptor = Object.getOwnPropertyDescriptor(value, "get");
      Object.defineProperty(facade, "get", {
        configurable: true,
        enumerable: descriptor ? descriptor.enumerable : true,
        writable: true,
        value: wrappedGet
      });
      return facade;
    } catch (_) {
      // Preserve the original WML API if it cannot be safely facaded.
      return value;
    }
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
            if (name === "imageBackendProbe" && typeof value === "function") {
              registerBackendProbe(value);
              return value;
            }
            if (name === "imageServerUrl" && typeof value === "function") {
              return path => localEndpoint(path) || value(path);
            }
            if (name === "imageBackend" && typeof value === "function") {
              return (...callArgs) => {
                const current = value(...callArgs) || {};
                const state = runtimeStatus();
                if (!prefersLauncherLocal() || (!state.available && !state.starting)) return current;
                return { ...current, baseUrl: LOCAL_ORIGIN, comfyui: state.ready };
              };
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

  function installStudioBridgeHook() {
    let current = null;
    try { current = window.WW_ImageStudioBridge || null; } catch (_) {}
    try {
      Object.defineProperty(window, "WW_ImageStudioBridge", {
        configurable: true,
        enumerable: true,
        get() { return current; },
        set(value) {
          current = value;
          if (!value || typeof value.connection !== "function" || value.__waywardLauncherConnectionWrapped) return;
          const originalConnection = value.connection.bind(value);
          value.connection = (...args) => {
            const currentConnection = originalConnection(...args) || {};
            const state = runtimeStatus();
            if (!prefersLauncherLocal() || (!state.available && !state.starting)) return currentConnection;
            return {
              ...currentConnection,
              baseUrl: LOCAL_ORIGIN,
              comfyui: state.ready
            };
          };
          try { Object.defineProperty(value, "__waywardLauncherConnectionWrapped", { value: true }); } catch (_) {}
          report("studio_connection_bridge_wrapped", {});
        }
      });
      if (current) {
        const setter = Object.getOwnPropertyDescriptor(window, "WW_ImageStudioBridge").set;
        setter.call(window, current);
      }
    } catch (_) {}
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
    try {
      const connection = window.WW_ImageStudioBridge && window.WW_ImageStudioBridge.connection();
      const raw = connection && connection.baseUrl;
      const url = new URL(String(raw || ""));
      if (url.protocol !== "http:" ||
          (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") ||
          url.port !== "8189" || (url.username || url.password)) return null;
      return url.origin;
    } catch (_) {
      const state = runtimeStatus();
      return prefersLauncherLocal() && (state.available || state.starting) ? LOCAL_ORIGIN : null;
    }
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

  installImageElementUrlRewrite();
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
