import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../app/src/main/assets/imagegen-studio-bridge.js", import.meta.url), "utf8");
const calls = [];
const events = [];
const probes = [];
let settingsClicked = 0;
let runtime = { available: true, starting: false, ready: false, backendVersion: "0.8.4" };
let gameImageBackendMode = "auto";
const persistedSettings = {
  imageBackendMode: "off",
  retainUnrelatedSetting: "unchanged"
};
const settingsStore = { getState: () => persistedSettings };
let backendState = { baseUrl: null, comfyui: false };
class FakeImageElement {
  constructor() { this._src = ""; this.attributes = {}; }
  get src() { return this._src; }
  set src(value) { this._src = String(value); }
  setAttribute(name, value) {
    this.attributes[String(name)] = String(value);
    if (String(name).toLowerCase() === "src") this._src = String(value);
  }
}


const document = {
  querySelector(selector) {
    if (selector === "#wwis-generation-settings") {
      return { disabled: false, click() { settingsClicked++; } };
    }
    return null;
  }
};

const window = {
  __WAYWARD_IMAGE_STUDIO_TEST__: true,
  HTMLImageElement: FakeImageElement,
  setTimeout,
  location: { href: "https://localhost:42000/game/Wayward_WML_ko.html", origin: "https://localhost:42000" },
  localStorage: {
    getItem(key) {
      if (key !== "tavern-settings") return null;
      return JSON.stringify({ state: { imageBackendMode: gameImageBackendMode, imageBackendUrl: "" }, version: 3 });
    }
  },
  WMLHost: {
    imageGenRuntimeStatus() { return JSON.stringify(runtime); },
    logImageProviderDiagnostic(name, details) {
      events.push({ name, details: JSON.parse(details) });
    }
  },
  WW_ImageStudio: { open() {} },
  async fetch(url, options = {}) {
    calls.push({ url, options });
    if (String(url).includes("/api/generation/characters/discover-batch")) {
      const batch = JSON.parse(options.body).characters;
      return {
        ok: true, status: 200,
        async json() { return { results: batch.map((character, index) => ({ added: index === 0, character })) }; }
      };
    }
    if (String(url).includes("/api/generation/settings") && options.method === "PUT") {
      return { ok: true, status: 200, async json() { return { saved: true }; } };
    }
    return { ok: false, status: 404, async json() { return {}; } };
  }
};

vm.runInNewContext(source, {
  window, document, URL, Promise, JSON, String, Number, Math, Set, Error, Object
});

// The launcher hook is installed before WML's settings factory exists.
// Assigning the real factory later must be intercepted.
const factory = {
  connect(_wmlApi, config) {
    return {
      fn(name) {
        if (name === "settingsStore") return settingsStore;
        if (name === "imageBackendProbe") {
          return async (options, force) => {
            probes.push({ options, force });
            backendState = {
              baseUrl: "http://127.0.0.1:8189",
              comfyui: runtime.ready
            };
            return backendState;
          };
        }
        if (name === "imageServerUrl") {
          return path => { const url = String(path || ""); return url.startsWith("https://") || url.startsWith("http://") ? url : backendState.baseUrl ? backendState.baseUrl + path : null; };
        }
        if (name === "imageBackend") return () => backendState;
        return undefined;
      }
    };
  }
};
window.__waywardPauseSettingsUiFactory = factory;
const api = factory.connect({}, { id: "imagestudio" });
assert.equal(api.fn("settingsStore").getState().imageBackendMode, "off");
assert.equal(persistedSettings.imageBackendMode, "off");
let legacyConnection = { baseUrl: null, comfyui: false };
// Match WML's immutable legacy API shape: a frozen get() must remain callable
// through the launcher facade without a Proxy invariant violation.
const frozenLegacyApi = Object.freeze({
  name(name) { return name; },
  get(name) { return name === "ph" ? () => legacyConnection : () => undefined; }
});
assert.equal(Object.getOwnPropertyDescriptor(frozenLegacyApi, "get").configurable, false);
assert.equal(Object.getOwnPropertyDescriptor(frozenLegacyApi, "get").writable, false);
window.__WML_LEGACY__ = frozenLegacyApi;
const legacyImageBackend = window.__WML_LEGACY__.get("ph");

const refreshed = await window.WaywardLauncherImageStudio.refreshBackendProbe("test_startup");
assert.equal(refreshed.ok, false, "provider-not-ready launcher must not allow generation");
assert.equal(refreshed.baseUrl, "http://127.0.0.1:8189",
  "the running launcher endpoint remains available for provider settings");
assert.equal(probes.length, 0, "the game-configured probe must never contact a remote endpoint");
assert.equal(api.fn("imageServerUrl")("/api/batch/enqueue"), null);
assert.equal(api.fn("imageServerUrl")("/api/generation/settings"),
  "http://127.0.0.1:8189/api/generation/settings");
assert.equal(api.fn("imageServerUrl")("/images/nai/characters/elena/portrait.png"), "https://localhost:42000/images/__wayward_generated__/nai/characters/elena/portrait.png");
assert.equal(api.fn("imageServerUrl")("http://127.0.0.1:8189/images/nai/characters/elena/portrait.png"), "https://localhost:42000/images/__wayward_generated__/nai/characters/elena/portrait.png");
const generatedImg = new FakeImageElement();
generatedImg.src = "http://127.0.0.1:8189/images/nai/characters/elena/portrait.png";
assert.equal(generatedImg.src, "https://localhost:42000/images/__wayward_generated__/nai/characters/elena/portrait.png");
const generatedViaAttribute = new FakeImageElement();
generatedViaAttribute.setAttribute("src", "/images/nai/characters/elena/portrait.png");
assert.equal(generatedViaAttribute.src, "https://localhost:42000/images/__wayward_generated__/nai/characters/elena/portrait.png");
const remoteImg = new FakeImageElement();
remoteImg.src = "https://cdn.example/images/portrait.png";
assert.equal(remoteImg.src, "https://cdn.example/images/portrait.png");
assert.equal(events.some(item => item.name === "generated_image_dom_rewrite_installed"), true);
runtime = { available: false, starting: false, ready: false, backendVersion: "0.8.4" };
backendState = { baseUrl: null, comfyui: false };
const cachedImgWhileServerStopped = new FakeImageElement();
cachedImgWhileServerStopped.src = "http://127.0.0.1:8189/images/nai/characters/elena/portrait.png";
assert.equal(cachedImgWhileServerStopped.src, "https://localhost:42000/images/__wayward_generated__/nai/characters/elena/portrait.png");
assert.equal(api.fn("imageServerUrl")("/api/batch/enqueue"), null);
runtime = { available: true, starting: false, ready: false, backendVersion: "0.8.4" };
assert.equal(api.fn("imageBackend")().comfyui, false);
assert.equal(legacyImageBackend().baseUrl, "http://127.0.0.1:8189");
assert.equal(legacyImageBackend().comfyui, false);

window.WW_ImageStudioBridge = {
  connection() { return backendState; },
  characters() {
    return {
      skipped: 1,
      characters: [
        { id: "elena", name: "Elena", prompt: "prompt-e", originalPrompt: "prompt-e", negativePrompt: "neg-e", originalNegativePrompt: "neg-e" },
        { id: "new-wife", name: "New Wife", prompt: "prompt-n", originalPrompt: "prompt-n" },
        { id: "patron", name: "Patron", prompt: "", originalPrompt: "" },
        { id: "../bad", name: "Bad", prompt: "x", originalPrompt: "x" }
      ]
    };
  }
};
assert.equal(window.WW_ImageStudioBridge.connection().baseUrl, "http://127.0.0.1:8189");
assert.equal(window.WW_ImageStudioBridge.connection().comfyui, false);

const discovery = await window.WaywardLauncherImageStudio.discoverNow();
assert.equal(discovery.ok, true);
assert.equal(discovery.found, 2);
assert.equal(discovery.added, 1);
assert.equal(discovery.existing, 1);
assert.equal(calls.length, 1);
assert.equal(calls[0].url, "http://127.0.0.1:8189/api/generation/characters/discover-batch");
assert.deepEqual(JSON.parse(calls[0].options.body).characters.map(item => item.id), ["elena", "new-wife"]);
assert.equal(events.some(item => item.name === "studio_roster_discovery_completed"), true);

const opened = await window.WaywardLauncherImageStudio.openGenerationSettings();
assert.equal(opened.ok, true);
assert.equal(settingsClicked, 1);

// The foreground service reports provider-ready only after the NovelAI token
// is saved and the health route returns HTTP 200. Force the original game's
// imageBackendProbe so its captured imageServerUrl function sees that state.
runtime = {
  available: true,
  starting: false,
  ready: true,
  backendVersion: "launcher-imagegen:0.8.4:novelai"
};
gameImageBackendMode = "off";
const effectiveSettings = api.fn("settingsStore").getState();
assert.equal(effectiveSettings.imageBackendMode, "auto",
assert.equal(effectiveSettings.imageBackendUrl, "http://127.0.0.1:8189",
  "a running launcher engine must replace the game-side endpoint in the settings view");
  "a ready launcher engine must override the in-memory off selector");
assert.equal(effectiveSettings.retainUnrelatedSetting, "unchanged");
assert.equal(persistedSettings.imageBackendMode, "off",
  "the original persisted setting must remain untouched");
assert.equal(window.__WAYWARD_LAUNCHER_IMAGE_RUNTIME__.engine, "novelai");
assert.equal(window.__WW_STUDIO_OFFLINE_ONLY__, false);
assert.equal(api.fn("imageServerUrl")("/api/batch/enqueue"),
  "http://127.0.0.1:8189/api/batch/enqueue",
  "off mode must still route to the ready launcher-managed engine");
runtime.backendVersion = "launcher-imagegen:0.8.4:comfy";
assert.equal(window.WaywardLauncherImageStudio.getRuntimeStatus().engine, "comfy");
assert.equal(window.__WAYWARD_LAUNCHER_IMAGE_RUNTIME__.engine, "comfy");
runtime.backendVersion = "launcher-imagegen:0.8.4:novelai";
const readyRefresh = await window.WaywardLauncherImageStudio.refreshBackendProbe("test_token_saved");
assert.equal(readyRefresh.ok, true);
assert.equal(api.fn("imageBackend")().comfyui, true);
legacyConnection = { baseUrl: null, comfyui: false };
assert.equal(legacyImageBackend().baseUrl, "http://127.0.0.1:8189");
assert.equal(legacyImageBackend().comfyui, true);
assert.equal(window.WW_ImageStudioBridge.connection().comfyui, true);
assert.equal(api.fn("settingsStore").getState().imageBackendMode, "auto");
assert.equal(persistedSettings.imageBackendMode, "off");

// A successful settings PUT must trigger the same refresh path automatically.
const refreshCount = events.filter(item => item.name === "studio_backend_probe_completed").length;
const saveResponse = await window.fetch("http://127.0.0.1:8189/api/generation/settings", {
  method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageProvider: "nai" })
});
assert.equal(saveResponse.status, 200);
await new Promise(resolve => setTimeout(resolve, 220));
assert.ok(events.filter(item => item.name === "studio_backend_probe_completed").length > refreshCount,
  "saving Image Studio settings must refresh launcher runtime state");

// A saved custom remote URL cannot override the launcher destination.
window.localStorage.getItem = key => key === "tavern-settings"
  ? JSON.stringify({ state: { imageBackendMode: "custom", imageBackendUrl: "https://remote.example:8189" }, version: 3 })
  : null;
assert.equal(api.fn("imageServerUrl")("https://remote.example:8189/api/batch/enqueue"),
  "http://127.0.0.1:8189/api/batch/enqueue");
assert.equal(api.fn("imageServerUrl")("https://remote.example:8189/images/remote.png"),
  "https://remote.example:8189/images/remote.png");
assert.equal(window.WW_ImageStudioBridge.connection().baseUrl, "http://127.0.0.1:8189");
const readyDiscovery = await window.WaywardLauncherImageStudio.discoverNow();
assert.equal(readyDiscovery.ok, true);
runtime = { available: false, starting: false, ready: false, backendVersion: "" };
assert.equal(api.fn("settingsStore").getState().imageBackendMode, "off",
assert.equal(api.fn("settingsStore").getState().imageBackendUrl, "",
  "with the launcher engine stopped, no game-side remote generation URL may remain active");
  "when the launcher engine is stopped, preserve the game's saved off preference");
assert.equal(api.fn("imageBackend")().baseUrl, null);
assert.equal(api.fn("imageServerUrl")("https://remote.example:8189/api/batch/enqueue"), null,
  "a stopped launcher must never fall back to a custom external URL");
assert.equal(window.__WW_STUDIO_OFFLINE_ONLY__, true);
assert.equal(window.WaywardLauncherImageStudio.getRuntimeStatus().engine, "unknown");
console.log("Image Studio launcher connection, settings refresh, and roster bridge tests passed.");
