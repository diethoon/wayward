(() => {
  "use strict";
  if (window.__waywardImageProvidersInstalled) return;
  if (!window.WMLHost ||
      typeof window.WMLHost.listImageProviders !== "function" ||
      typeof window.WMLHost.generateImageWithProvider !== "function") return;

  window.__waywardImageProvidersInstalled = true;
  const pending = new Map();

  function makeId() {
    return (window.crypto && typeof window.crypto.randomUUID === "function")
      ? window.crypto.randomUUID()
      : "wprovider-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  }

  window.__waywardImageProvidersResolve = (id, raw) => {
    const item = pending.get(id);
    if (!item) return;
    pending.delete(id);
    clearTimeout(item.timer);
    try {
      const result = JSON.parse(raw);
      if (!result || result.ok !== true) {
        item.reject(new Error(String(result && result.error || "이미지 생성에 실패했습니다.")));
        return;
      }
      item.resolve(result);
    } catch (error) {
      item.reject(error);
    }
  };

  window.WaywardImageProviders = Object.freeze({
    list() {
      try {
        return JSON.parse(window.WMLHost.listImageProviders() || "{}");
      } catch (_) {
        return { providers: [], defaultProviderId: null };
      }
    },

    generate(options) {
      const input = options && typeof options === "object" ? options : {};
      const prompt = String(input.prompt || "").trim();
      if (!prompt) return Promise.reject(new Error("이미지 프롬프트를 입력해 주세요."));
      if (prompt.length > 4096) return Promise.reject(new Error("프롬프트는 4,096자 이내로 입력해 주세요."));

      const id = makeId();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("이미지 생성 시간이 초과되었습니다."));
        }, 190000);
        pending.set(id, { resolve, reject, timer });
        try {
          window.WMLHost.generateImageWithProvider(
            id,
            String(input.providerId || ""),
            prompt,
            Number(input.width) || 1024,
            Number(input.height) || 1024
          );
        } catch (error) {
          clearTimeout(timer);
          pending.delete(id);
          reject(error);
        }
      });
    }
  });
})();