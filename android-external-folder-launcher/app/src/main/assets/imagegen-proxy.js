(() => {
  "use strict";
  if (window.__waywardImageGenProxyInstalled) return;
  if (!window.WMLHost || typeof window.WMLHost.imageGenProxyFetch !== "function") return;
  window.__waywardImageGenProxyInstalled = true;

  const nativeFetch = window.fetch.bind(window);
  const pending = new Map();

  function report(event, details) {
    try {
      if (typeof window.WMLHost.logImageProviderDiagnostic === "function") {
        window.WMLHost.logImageProviderDiagnostic(event, JSON.stringify(details || {}));
      }
    } catch (_) {}
  }

  function activeEngine() {
    const runtime = window.__WAYWARD_LAUNCHER_IMAGE_RUNTIME__;
    return runtime && typeof runtime.engine === "string" ? runtime.engine : "unknown";
  }

  function bytesToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
    }
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(value || "");
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  window.__waywardImageGenProxyResolve = (id, raw) => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeout(entry.timer);
    try {
      const result = JSON.parse(raw);
      const status = Number(result.status) || 502;
      const headers = new Headers(result.headers || {});
      const noBody = status === 204 || status === 205 || status === 304 || entry.method === "HEAD";
      const body = noBody ? null : base64ToBytes(result.bodyBase64);
      entry.resolve(new Response(body, {
        status,
        statusText: String(result.statusText || ""),
        headers
      }));
    } catch (error) {
      entry.reject(error);
    }
  };

  window.fetch = function(input, init) {
    let request;
    try {
      request = new Request(input, init);
    } catch (_) {
      return nativeFetch(input, init);
    }

    let url;
    try { url = new URL(request.url, window.location.href); }
    catch (_) { return nativeFetch(input, init); }

    const localImageGen =
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      url.port === "8189" &&
      url.pathname.startsWith("/api/");

    if (!localImageGen) return nativeFetch(input, init);

    return request.arrayBuffer().then(bodyBuffer => new Promise((resolve, reject) => {
      const id = (window.crypto && typeof window.crypto.randomUUID === "function")
        ? window.crypto.randomUUID()
        : "wimg-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
      const diagnostic = {
        requestId: id,
        method: request.method.toUpperCase(),
        path: url.pathname,
        engine: activeEngine()
      };
      report("launcher_imagegen_request_intercepted", diagnostic);
      const headers = {};
      request.headers.forEach((value, key) => { headers[key] = value; });
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new TypeError("ImageGen proxy timed out."));
      }, 15 * 60 * 1000);
      pending.set(id, { resolve, reject, timer, method: request.method.toUpperCase() });
      try {
        window.WMLHost.imageGenProxyFetch(
          id,
          request.method,
          url.pathname + url.search,
          JSON.stringify(headers),
          bytesToBase64(bodyBuffer)
        );
        report("launcher_imagegen_request_dispatched", diagnostic);
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        report("launcher_imagegen_request_dispatch_failed", {
          requestId: id,
          method: request.method.toUpperCase(),
          path: url.pathname,
          engine: activeEngine(),
          errorType: error && error.name ? String(error.name) : "Error"
        });
        reject(error);
      }
    }));
  };
})();