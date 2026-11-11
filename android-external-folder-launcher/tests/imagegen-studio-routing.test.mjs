import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../app/src/main/assets/imagegen-studio-bridge.js", import.meta.url), "utf8");
const events = [];
let runtime = { available: false, starting: false, ready: false, backendVersion: "" };
const storage = {
  getItem(key) {
    if (key === "ww-image-studio-offline-only-v1") return "false";
    return null;
  },
  setItem() {}
};
let originalProbeCalls = 0;
let originalServerUrlCalls = 0;
let nativeOffline = false;

const window = {
  __WAYWARD_IMAGE_STUDIO_TEST__: true,
  localStorage: storage,
  WMLHost: {
    imageGenRuntimeStatus() { return JSON.stringify(runtime); },
    logImageProviderDiagnostic(name, details) {
      events.push({ name, details: JSON.parse(details) });
    }
  }
};

vm.runInNewContext(source, {
  window, Promise, Object, String, Boolean, Number, JSON, Error, WeakSet
});

const factory = {
  connect(_wmlApi, config) {
    return {
      fn(name) {
        if (name === "imageBackendProbe") return async () => {
          originalProbeCalls++;
          return { baseUrl: "https://remote.example:8189", comfyui: true };
        };
        if (name === "imageServerUrl") return path => {
          originalServerUrlCalls++;
          return "https://remote.example:8189" + path;
        };
        if (name === "imageBackend") return () => ({ baseUrl: "https://remote.example:8189", comfyui: true });
        return undefined;
      }
    };
  }
};
window.__waywardPauseSettingsUiFactory = factory;
const api = window.__waywardPauseSettingsUiFactory.connect({}, { id: "imagestudio" });

const unavailable = await api.fn("imageBackendProbe")({ mode: "auto" }, true);
assert.equal(unavailable.baseUrl, null, "no launcher server must not probe/fall back to a remote server");
assert.equal(api.fn("imageServerUrl")("/api/batch/enqueue"), null);
assert.equal(originalProbeCalls, 0);
assert.equal(originalServerUrlCalls, 0);
assert.equal(window.__WW_STUDIO_OFFLINE_ONLY__, true);
assert.equal(window.WaywardLauncherImageStudioRouting.getBackendState().baseUrl, null);

let legacyConnection = { baseUrl: "https://remote.example:8189", comfyui: true };
const frozenLegacy = Object.freeze({
  get(name) { return name === "ph" ? () => legacyConnection : undefined; }
});
window.__WML_LEGACY__ = frozenLegacy;
assert.equal(window.__WML_LEGACY__.get("ph")().baseUrl, null);

let refreshCount = 0;
window.WW_ImageStudioBridge = {
  connection() { return { baseUrl: "https://remote.example:8189", comfyui: true }; },
  setOfflineOnly(value) { nativeOffline = value; refreshCount++; }
};
assert.equal(window.WW_ImageStudioBridge.connection().baseUrl, null);

// A reachable but unconfigured service is the only target. It may accept
// settings writes, but generation stays offline until its selected provider is ready.
runtime = { available: true, starting: false, ready: false, backendVersion: "launcher-imagegen:0.8.4:novelai" };
const configuring = await api.fn("imageBackendProbe")({ mode: "custom", url: "https://remote.example" }, true);
assert.equal(configuring.baseUrl, "http://127.0.0.1:8189");
assert.equal(configuring.comfyui, false);
assert.equal(configuring.engine, "novelai");
assert.equal(api.fn("imageServerUrl")("/api/generation/settings"), "http://127.0.0.1:8189/api/generation/settings");
assert.equal(window.__WW_STUDIO_OFFLINE_ONLY__, true);

// Ready NovelAI is allowed, and the game still talks only to launcher port 8189.
runtime = { available: true, starting: false, ready: true, backendVersion: "launcher-imagegen:0.8.4:novelai" };
const nai = window.WaywardLauncherImageStudioRouting.refreshRuntime();
assert.equal(nai.baseUrl, "http://127.0.0.1:8189");
assert.equal(nai.comfyui, true);
assert.equal(nai.engine, "novelai");
assert.equal(window.__WW_STUDIO_OFFLINE_ONLY__, false);

// ComfyUI is not reinterpreted as NovelAI; the local ImageGen service's own
// mode determines the engine and receives the same launcher-first API route.
runtime = { available: true, starting: false, ready: true, backendVersion: "launcher-imagegen:0.8.4:comfy" };
const comfy = window.WaywardLauncherImageStudioRouting.refreshRuntime();
assert.equal(comfy.engine, "comfy");
assert.equal(comfy.baseUrl, "http://127.0.0.1:8189");
assert.equal(window.WW_ImageStudioBridge.connection().engine, "comfy");

// An explicit in-game offline-only choice is preserved while the launcher is ready.
window.WW_ImageStudioBridge.setOfflineOnly(true);
assert.equal(nativeOffline, true);
assert.equal(window.__WW_STUDIO_OFFLINE_ONLY__, true);
window.WW_ImageStudioBridge.setOfflineOnly(false);
assert.equal(nativeOffline, false);
assert.equal(window.__WW_STUDIO_OFFLINE_ONLY__, false);

// Game-session backend selection cannot override a running launcher server.
for (const mode of ["off", "auto", "novelai", "comfy", "custom"]) {
  const selectedByGame = window.WaywardLauncherImageStudioRouting.refreshRuntime();
  assert.equal(selectedByGame.baseUrl, "http://127.0.0.1:8189", mode + " game mode must not redirect launcher requests");
  assert.equal(selectedByGame.engine, "comfy", mode + " game mode must not switch the launcher engine");
  assert.equal(window.__WW_STUDIO_OFFLINE_ONLY__, false);
}

// A server stop returns the game to image-pack-only mode without remote fallback.
runtime = { available: false, starting: false, ready: false, backendVersion: "" };
const stopped = window.WaywardLauncherImageStudioRouting.refreshRuntime();
assert.equal(stopped.baseUrl, null);
assert.equal(window.__WW_STUDIO_OFFLINE_ONLY__, true);
assert.equal(events.some(event => event.name === "launcher_image_route_state"), true);

console.log("Launcher-first Image Studio routing and image-pack-only fallback tests passed.");
