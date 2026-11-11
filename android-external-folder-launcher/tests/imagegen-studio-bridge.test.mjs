import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../app/src/main/assets/imagegen-studio-bridge.js", import.meta.url), "utf8");
const calls = [];
const events = [];
const probes = [];
let settingsClicked = 0;
let runtime = { available: true, starting: false, ready: false, backendVersion: "0.8.4" };
let backendState = { baseUrl: null, comfyui: false };

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
  setTimeout,
  location: { href: "https://localhost:42000/game/Wayward_WML_ko.html", origin: "https://localhost:42000" },
  localStorage: {
    getItem(key) {
      if (key !== "tavern-settings") return null;
      return JSON.stringify({ state: { imageBackendMode: "auto", imageBackendUrl: "" }, version: 3 });
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
          return path => /^https?:\\/\\//i.test(String(path || "")) ? String(path) : backendState.baseUrl ? backendState.baseUrl + path : null;
        }
        if (name === "imageBackend") return () => backendState;
        return undefined;
      }
    };
  }
};
window.__waywardPauseSettingsUiFactory = factory;
const api = factory.connect({}, { id: "imagestudio" });
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
assert.equal(refreshed.ok, true);
assert.equal(probes.at(-1).force, true);
assert.equal(probes.at(-1).options.mode, "auto");
assert.equal(api.fn("imageServerUrl")("/api/batch/enqueue"), "http://127.0.0.1:8189/api/batch/enqueue");
assert.equal(api.fn("imageServerUrl")("/images/nai/characters/elena/portrait.png"), "https://localhost:42000/images/__wayward_generated__/nai/characters/elena/portrait.png");
assert.equal(api.fn("imageServerUrl")("http://127.0.0.1:8189/images/nai/characters/elena/portrait.png"), "https://localhost:42000/images/__wayward_generated__/nai/characters/elena/portrait.png");
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
runtime = { available: true, starting: false, ready: true, backendVersion: "0.8.4" };
const readyRefresh = await window.WaywardLauncherImageStudio.refreshBackendProbe("test_token_saved");
assert.equal(readyRefresh.ok, true);
assert.equal(api.fn("imageBackend")().comfyui, true);
legacyConnection = { baseUrl: null, comfyui: false };
assert.equal(legacyImageBackend().baseUrl, "http://127.0.0.1:8189");
assert.equal(legacyImageBackend().comfyui, true);
assert.equal(window.WW_ImageStudioBridge.connection().comfyui, true);

// A successful settings PUT must trigger the same refresh path automatically.
const probeCount = probes.length;
const saveResponse = await window.fetch("http://127.0.0.1:8189/api/generation/settings", {
  method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageProvider: "nai" })
});
assert.equal(saveResponse.status, 200);
await new Promise(resolve => setTimeout(resolve, 220));
assert.ok(probes.length > probeCount, "saving Image Studio settings must refresh the game connection");

// Do not redirect a user-selected remote server to the launcher's loopback.
window.localStorage.getItem = key => key === "tavern-settings"
  ? JSON.stringify({ state: { imageBackendMode: "custom", imageBackendUrl: "https://remote.example:8189" }, version: 3 })
  : null;
backendState = { baseUrl: "https://remote.example:8189", comfyui: true };
window.WW_ImageStudioBridge.connection = () => backendState;
assert.equal(api.fn("imageServerUrl")("https://remote.example:8189/images/remote.png"), "https://remote.example:8189/images/remote.png");
const rejected = await window.WaywardLauncherImageStudio.discoverNow();
assert.equal(rejected.ok, false);
assert.equal(rejected.reason, "image_server_connection_pending");
console.log("Image Studio launcher connection, settings refresh, and roster bridge tests passed.");
