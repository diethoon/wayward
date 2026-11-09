(() => {
  "use strict";
  if (window.__waywardImageProvidersInstalled) return;

  const host = window.WMLHost;
  const pending = new Map();
  const imageErrorCounts = new Map();
  const log = (event, details) => {
    try {
      if (host && typeof host.logImageProviderDiagnostic === "function") {
        host.logImageProviderDiagnostic(event, JSON.stringify(details || {}));
      }
    } catch (_) {}
  };

  function makeId() {
    return (window.crypto && typeof window.crypto.randomUUID === "function")
      ? window.crypto.randomUUID()
      : "wprovider-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  }

  function srcKind(src) {
    if (!src) return "empty";
    if (src.startsWith("data:")) return "data";
    if (src.startsWith("blob:")) return "blob";
    if (src.startsWith("https:")) return "https";
    if (src.startsWith("http:")) return "http";
    if (src.startsWith("file:")) return "file";
    if (src.startsWith("/")) return "relative";
    return "other";
  }

  function safeDomField(value, maxLength) {
    return String(value || "")
      .replace(/[\x00-\x1f\x7f]/g, " ")
      .replace(/[^A-Za-z0-9À-ɏ぀-ヿ㐀-鿿가-힣 ._:-]/g, "")
      .replace(/\s+/g, " ").trim().slice(0, maxLength);
  }

  function safeImageLocation(raw) {
    try {
      const Url = window.URL || URL;
      const base = window.document && window.document.baseURI;
      const parsed = base ? new Url(raw, base) : new Url(raw);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return {};
      const segments = String(parsed.pathname || "/").split("/");
      const safeSegments = segments.map((part, index) => {
        if (index === 0) return "";
        let decoded = part;
        try { decoded = decodeURIComponent(part); } catch (_) {}
        const lower = decoded.toLowerCase();
        const sensitive = decoded.length > 80 ||
          /^[A-Za-z0-9_-]{40,}$/.test(decoded) ||
          /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(decoded) ||
          /token|secret|signature|authorization|bearer|session|api[_-]?key/i.test(lower);
        if (sensitive) return "~redacted~";
        return decoded.replace(/[^A-Za-z0-9À-ɏ぀-ヿ㐀-鿿가-힣._~!()+,;=:@%-]/g, "_");
      });
      let path = safeSegments.join("/");
      if (!path.startsWith("/")) path = "/" + path;
      if (path.length > 160) path = path.slice(-159);
      if (!path.startsWith("/")) path = "/" + path;
      return {
        srcHost: String(parsed.hostname || "").toLowerCase().slice(0, 120),
        srcPath: path
      };
    } catch (_) {
      return {};
    }
  }

  function imageDetails(img) {
    const raw = String(img.currentSrc || img.src || "");
    const classValue = typeof img.className === "string"
      ? img.className
      : (typeof img.getAttribute === "function" ? img.getAttribute("class") : "");
    const altValue = typeof img.alt === "string"
      ? img.alt
      : (typeof img.getAttribute === "function" ? img.getAttribute("alt") : "");
    const idValue = typeof img.id === "string"
      ? img.id
      : (typeof img.getAttribute === "function" ? img.getAttribute("id") : "");
    return {
      elementTag: "img",
      elementId: safeDomField(idValue, 64),
      elementClass: safeDomField(classValue, 96),
      elementAlt: safeDomField(altValue, 80),
      ...safeImageLocation(raw),
      srcKind: srcKind(raw),
      srcLength: raw.length,
      naturalWidth: Number(img.naturalWidth) || 0,
      naturalHeight: Number(img.naturalHeight) || 0,
      complete: Boolean(img.complete)
    };
  }

  if (window.document && typeof window.document.addEventListener === "function" &&
      !window.__waywardImageProviderImageWatchInstalled) {
    window.__waywardImageProviderImageWatchInstalled = true;
    const watch = event => {
      const img = event && event.target;
      if (!img || String(img.tagName || "").toUpperCase() !== "IMG") return;
      const details = imageDetails(img);
      if (event.type === "error") {
        const identity = details.srcHost && details.srcPath
          ? details.srcHost + "|" + details.srcPath : "";
        if (identity) {
          const repeatCount = (imageErrorCounts.get(identity) || 0) + 1;
          imageErrorCounts.set(identity, repeatCount);
          if (imageErrorCounts.size > 128 && repeatCount === 1) {
            imageErrorCounts.delete(imageErrorCounts.keys().next().value);
          }
          if (repeatCount === 1 || repeatCount === 2 || repeatCount % 10 === 0) {
            details.repeatCount = repeatCount;
            log("img_element_error", details);
          }
        } else {
          log("img_element_error", details);
        }
      } else if (details.srcKind === "data" || details.srcKind === "blob") {
        log("img_element_loaded", details);
      }
    };
    window.document.addEventListener("load", watch, true);
    window.document.addEventListener("error", watch, true);
    log("image_element_watch_installed", {});
  }

  if (!host ||
      typeof host.listImageProviders !== "function" ||
      typeof host.generateImageWithProvider !== "function") {
    log("js_bridge_unavailable", {
      hasProviderList: Boolean(host && typeof host.listImageProviders === "function"),
      hasGenerate: Boolean(host && typeof host.generateImageWithProvider === "function")
    });
    return;
  }

  window.__waywardImageProvidersInstalled = true;
  log("js_bridge_installed", {});

  window.__waywardImageProvidersResolve = (id, raw) => {
    const item = pending.get(id);
    log("resolver_received", { requestId: String(id || "").slice(0, 80), pendingCount: pending.size });
    if (!item) {
      log("resolver_orphaned", { requestId: String(id || "").slice(0, 80) });
      return;
    }
    pending.delete(id);
    clearTimeout(item.timer);
    try {
      const result = JSON.parse(raw);
      if (!result || result.ok !== true) {
        log("game_generate_rejected", {
          requestId: id,
          reasonCode: "native_result_not_ok",
          errorType: "NativeImageError"
        });
        item.reject(new Error(String(result && result.error || "이미지 생성에 실패했습니다.")));
        return;
      }
      const dataUrl = String(result.dataUrl || "");
      log("game_generate_resolved", {
        requestId: id,
        mimeType: String(result.mimeType || ""),
        dataUrlLength: dataUrl.length,
        providerId: String(result.providerId || ""),
        fallbackUsed: Boolean(result.fallbackUsed)
      });
      if (dataUrl.startsWith("data:image/") && typeof window.Image === "function") {
        try {
          const probe = new window.Image();
          probe.onload = () => log("data_url_probe_loaded", {
            requestId: id,
            naturalWidth: Number(probe.naturalWidth) || 0,
            naturalHeight: Number(probe.naturalHeight) || 0
          });
          probe.onerror = () => log("data_url_probe_failed", {
            requestId: id,
            mimeType: String(result.mimeType || ""),
            dataUrlLength: dataUrl.length
          });
          probe.src = dataUrl;
        } catch (_) {
          log("data_url_probe_setup_failed", { requestId: id });
        }
      } else {
        log("data_url_probe_skipped", {
          requestId: id,
          reasonCode: dataUrl ? "image_constructor_unavailable" : "data_url_missing"
        });
      }
      item.resolve(result);
    } catch (error) {
      log("resolver_payload_parse_failed", {
        requestId: String(id || "").slice(0, 80),
        errorType: error && error.name ? String(error.name) : "Error"
      });
      item.reject(error);
    }
  };

  window.WaywardImageProviders = Object.freeze({
    list() {
      try {
        return JSON.parse(host.listImageProviders() || "{}");
      } catch (_) {
        log("provider_list_failed", {});
        return { providers: [], defaultProviderId: null };
      }
    },

    generate(options) {
      const input = options && typeof options === "object" ? options : {};
      const prompt = String(input.prompt || "").trim();
      if (!prompt) return Promise.reject(new Error("이미지 프롬프트를 입력해 주세요."));
      if (prompt.length > 4096) return Promise.reject(new Error("프롬프트는 4,096자 이내로 입력해 주세요."));

      const id = makeId();
      const width = Number(input.width) || 1024;
      const height = Number(input.height) || 1024;
      log("game_generate_requested", {
        requestId: id,
        promptLength: prompt.length,
        requestedWidth: width,
        requestedHeight: height,
        hasProvider: Boolean(input.providerId)
      });
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          log("game_generate_timeout", { requestId: id, pendingCount: pending.size });
          reject(new Error("이미지 생성 시간이 초과되었습니다."));
        }, 210000);
        pending.set(id, { resolve, reject, timer });
        try {
          host.generateImageWithProvider(
            id,
            String(input.providerId || ""),
            prompt,
            width,
            height
          );
          log("game_generate_dispatched", { requestId: id, pendingCount: pending.size });
        } catch (error) {
          clearTimeout(timer);
          pending.delete(id);
          log("game_generate_dispatch_failed", {
            requestId: id,
            errorType: error && error.name ? String(error.name) : "Error"
          });
          reject(error);
        }
      });
    }
  });
})();
