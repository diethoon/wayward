(() => {
  "use strict";
  if (window.__waywardImageStudioLauncherInstalled) return;
  window.__waywardImageStudioLauncherInstalled = true;
  const host = window.WMLHost;
  const delay = ms => new Promise(resolve => window.setTimeout(resolve, ms));
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
  function serverOrigin() {
    try {
      const connection = window.WW_ImageStudioBridge?.connection?.();
      const url = new URL(String(connection?.baseUrl || ""));
      if (url.protocol !== "http:" ||
          (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") ||
          url.port !== "8189" || (url.username || url.password)) return null;
      return url.origin;
    } catch (_) { return null; }
  }
  async function discoverNow() {
    if (discoveryBusy) return { ok: false, reason: "discovery_busy" };
    const bridge = window.WW_ImageStudioBridge;
    if (!bridge || typeof bridge.characters !== "function") return { ok: false, retry: true, reason: "imagestudio_roster_not_ready" };
    let roster;
    try { roster = bridge.characters(); }
    catch (_) { return { ok: false, retry: true, reason: "character_registry_unavailable" }; }
    const source = Array.isArray(roster?.characters) ? roster.characters : [];
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
          if (item?.added) added++;
          else existing++;
        }
      }
      discoveryComplete = true;
      discoveryResult = { ok: true, found: characters.length, added, existing, skipped: Number(roster.skipped) || 0 };
      report("studio_roster_discovery_completed", discoveryResult);
      return discoveryResult;
    } catch (error) {
      const result = { ok: false, retry: true, reason: String(error?.message || error).slice(0, 100), found: characters.length, added, existing };
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
  window.WaywardLauncherImageStudio = Object.freeze({
    openGenerationSettings,
    discoverNow,
    getDiscoveryStatus: () => ({ complete: discoveryComplete, result: discoveryResult })
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
  }
})();