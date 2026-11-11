(() => {
  "use strict";
  if (window.__waywardLauncherImageStudioRoutingInstalled) return;
  const host = window.WMLHost;
  if (!host || typeof host.imageGenRuntimeStatus !== "function") return;

  window.__waywardLauncherImageStudioRoutingInstalled = true;
  const LOCAL_ORIGIN = "http://127.0.0.1:8189";
  const wrappedFactories = new WeakSet();
  let lastPolicy = "";


  function report(event, details) {
    try {
      if (typeof host.logImageProviderDiagnostic === "function") {
        host.logImageProviderDiagnostic(event, JSON.stringify(details || {}));
      }
    } catch (_) {}
  }

  function runtimeStatus() {
    try {
      const raw = host.imageGenRuntimeStatus();
      const value = typeof raw === "string" ? JSON.parse(raw) : raw;
      return {
        available: value && value.available === true,
        starting: value && value.starting === true,
        ready: value && value.ready === true,
        backendVersion: String(value && value.backendVersion || "")
      };
    } catch (_) {
      return { available: false, starting: false, ready: false, backendVersion: "" };
    }
  }

  function engineName(status) {
    const version = String(status && status.backendVersion || "");
    if (version.endsWith(":novelai")) return "novelai";
    if (version.endsWith(":comfy")) return "comfy";
    return "unknown";
  }

  function backendState() {
    const status = runtimeStatus();
    const launcherAvailable = status.available || status.starting;
    const baseUrl = launcherAvailable ? LOCAL_ORIGIN : null;
    const ready = Boolean(baseUrl && status.ready);
    return {
      baseUrl,
      comfyui: ready,
      images: 0,
      version: status.backendVersion || null,
      error: !baseUrl ? "launcher_server_not_running" : (ready ? null : "provider_not_ready"),
      launcherManaged: true,
      engine: engineName(status)
    };
  }

  function localEndpoint(path) {
    const raw = String(path || "");
    if (!raw.startsWith("/api/") || raw.includes("\\") || raw.startsWith("//")) return null;
    const backend = backendState();
    return backend.baseUrl ? backend.baseUrl + raw : null;
  }

  function applyRuntimePolicy() {
    const status = runtimeStatus();
    const offlineOnly = !status.ready;
    window.__WW_STUDIO_OFFLINE_ONLY__ = offlineOnly;
    const signature = [
      status.available, status.starting, status.ready,
      engineName(status), offlineOnly
    ].join(":");
    window.__WAYWARD_LAUNCHER_IMAGE_RUNTIME__ = Object.freeze({
      available: status.available,
      starting: status.starting,
      ready: status.ready,
      engine: engineName(status),
      offlineOnly
    });
    if (signature !== lastPolicy) {
      lastPolicy = signature;
      report("launcher_image_route_state", {
        serverAvailable: status.available,
        serverStarting: status.starting,
        providerReady: status.ready,
        engine: engineName(status),
        offlineOnly
      });
    }
    return backendState();
  }

  function wrapImageStudioApi(api) {
    if (!api || typeof api.fn !== "function") return api;
    const originalFn = api.fn.bind(api);
    const facade = Object.create(api);
    Object.defineProperty(facade, "fn", {
      configurable: true,
      enumerable: true,
      writable: true,
      value(name, ...args) {
        if (name === "imageBackendProbe") {
          return async () => applyRuntimePolicy();
        }
        if (name === "imageServerUrl") {
          return path => localEndpoint(path);
        }
        if (name === "imageBackend") {
          return () => applyRuntimePolicy();
        }
        return originalFn(name, ...args);
      }
    });
    return facade;
  }

  function wrapPauseSettingsFactory(factory) {
    if (!factory || typeof factory.connect !== "function" || wrappedFactories.has(factory)) return factory;
    wrappedFactories.add(factory);
    const originalConnect = factory.connect;
    const facade = Object.create(factory);
    Object.defineProperty(facade, "connect", {
      configurable: true,
      enumerable: true,
      writable: true,
      value(wmlApi, config, ...rest) {
        const api = originalConnect.call(factory, wmlApi, config, ...rest);
        return config && config.id === "imagestudio" ? wrapImageStudioApi(api) : api;
      }
    });
    return facade;
  }

  function routeConnection(current) {
    const backend = applyRuntimePolicy();
    return { ...(current || {}), ...backend };
  }

  function wrapLegacyApi(value) {
    if (!value) return value;
    let originalGet;
    try { originalGet = value.get; } catch (_) { return value; }
    if (typeof originalGet !== "function") return value;
    const facade = Object.create(value);
    const descriptor = Object.getOwnPropertyDescriptor(value, "get");
    Object.defineProperty(facade, "get", {
      configurable: true,
      enumerable: descriptor ? descriptor.enumerable : true,
      writable: true,
      value(name, ...args) {
        const resolved = originalGet.apply(value, [name, ...args]);
        if (name !== "ph" || typeof resolved !== "function") return resolved;
        return (...callArgs) => routeConnection(resolved(...callArgs));
      }
    });
    return facade;
  }

  function installSlot(name, wrap) {
    let current = null;
    try { current = window[name] || null; } catch (_) {}
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: true,
        get() { return current; },
        set(value) { current = wrap(value); }
      });
      if (current) current = wrap(current);
    } catch (_) {
      if (current) current = wrap(current);
    }
  }

  function wrapStudioBridge(value) {
    if (!value || typeof value.connection !== "function" || value.__waywardLauncherRoutingWrapped) return value;
    const facade = Object.create(value);
    const originalConnection = value.connection.bind(value);
    Object.defineProperty(facade, "connection", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: (...args) => routeConnection(originalConnection(...args))
    });
    if (typeof value.setOfflineOnly === "function") {
      const originalSetOfflineOnly = value.setOfflineOnly.bind(value);
      Object.defineProperty(facade, "setOfflineOnly", {
        configurable: true,
        enumerable: true,
        writable: true,
        value: _value => {
          const result = originalSetOfflineOnly(!runtimeStatus().ready);
          applyRuntimePolicy();
          return result;
        }
      });
    }
    try { Object.defineProperty(facade, "__waywardLauncherRoutingWrapped", { value: true }); } catch (_) {}
    report("launcher_image_bridge_wrapped", {});
    return facade;
  }

  installSlot("__waywardPauseSettingsUiFactory", wrapPauseSettingsFactory);
  installSlot("__WML_LEGACY__", wrapLegacyApi);
  installSlot("WW_ImageStudioBridge", wrapStudioBridge);
  applyRuntimePolicy();

  window.WaywardLauncherImageStudioRouting = Object.freeze({
    refreshRuntime: applyRuntimePolicy,
    getRuntimeStatus: runtimeStatus,
    getBackendState: backendState
  });

  if (window.__WAYWARD_IMAGE_STUDIO_TEST__ !== true) {
    let lastRuntime = "";
    const watch = () => {
      const status = runtimeStatus();
      const signature = [status.available, status.starting, status.ready, status.backendVersion].join(":");
      if (signature !== lastRuntime) {
        lastRuntime = signature;
        applyRuntimePolicy();
      }
      window.setTimeout(watch, 1000);
    };
    window.setTimeout(watch, 1000);
  }
})();
