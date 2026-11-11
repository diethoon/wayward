import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const read = path => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const bridgeSource = read("../app/src/main/assets/imagegen-studio-bridge.js");
const proxySource = read("../app/src/main/assets/imagegen-proxy.js");
const proxyJava = read("../app/src/main/java/com/wayward/launcher/ImageGenProxy.java");

const tick = () => new Promise(resolve => setImmediate(resolve));
const toBase64 = value => Buffer.from(value, "utf8").toString("base64");
const fromBase64 = value => Buffer.from(value || "", "base64").toString("utf8");

async function exerciseEngine(engine) {
  const events = [];
  const forwarded = [];
  const runtime = {
    available: true,
    starting: false,
    ready: true,
    backendVersion: "launcher-imagegen:0.8.4:" + engine
  };
  const window = {
    __WAYWARD_IMAGE_STUDIO_TEST__: true,
    location: { href: "https://wayward.test/game", origin: "https://wayward.test" },
    localStorage: {
      getItem(key) {
        return key === "ww-image-studio-offline-only-v1" ? "true" : null;
      },
      setItem() {}
    },
    fetch: globalThis.fetch,
    crypto: { randomUUID: () => "test-" + engine + "-" + forwarded.length },
    WMLHost: {
      imageGenRuntimeStatus() { return JSON.stringify(runtime); },
      logImageProviderDiagnostic(name, details) {
        events.push({ name, details: JSON.parse(details) });
      },
      imageGenProxyFetch(...args) { forwarded.push(args); }
    }
  };

  const persistedSettings = {
    imageBackendMode: "off",
    retainUnrelatedSetting: "unchanged"
  };
  const settingsStore = { getState: () => persistedSettings };
  const factory = {
    connect(_wmlApi, config) {
      assert.equal(config.id, "imagestudio");
      return {
        fn(name) {
          if (name === "settingsStore") return settingsStore;
          if (name === "imageBackendProbe") return async () => ({
            baseUrl: "https://game-configured.example:8189",
            comfyui: false
          });
          if (name === "imageServerUrl") return path =>
            "https://game-configured.example:8189" + path;
          if (name === "imageBackend") return () => ({
            baseUrl: "https://game-configured.example:8189",
            comfyui: false
          });
          return undefined;
        }
      };
    }
  };
  window.__waywardPauseSettingsUiFactory = factory;

  const context = {
    window, Promise, Object, String, Boolean, Number, JSON, Error, WeakSet,
    Request, URL, Uint8Array, Headers, Response, btoa, atob,
    setTimeout, clearTimeout, Math, Date
  };
  vm.runInNewContext(proxySource, context, { filename: "imagegen-proxy.js" });
  vm.runInNewContext(bridgeSource, context, { filename: "imagegen-studio-bridge.js" });

  const api = window.__waywardPauseSettingsUiFactory.connect({}, { id: "imagestudio" });
  assert.equal(window.__WW_STUDIO_OFFLINE_ONLY__, false,
    engine + ": active launcher server must override saved offline-only=true");
  const effectiveSettings = api.fn("settingsStore").getState();
  assert.equal(effectiveSettings.imageBackendMode, "auto",
    engine + ": active launcher engine must override the game-side 'off' generation selector");
  assert.equal(effectiveSettings.retainUnrelatedSetting, "unchanged");
  assert.equal(persistedSettings.imageBackendMode, "off",
    "the saved game setting must not be overwritten");

  // Image Studio's bridge may try to restore its saved game-side offline preference.
  // While the launcher engine is ready, the wrapper must keep generation enabled.
  window.WW_ImageStudioBridge = {
    connection() { return { baseUrl: "https://game-configured.example:8189", comfyui: false }; },
    setOfflineOnly(value) { window.__WW_STUDIO_OFFLINE_ONLY__ = !!value; }
  };
  assert.equal(window.WW_ImageStudioBridge.connection().baseUrl, "http://127.0.0.1:8189");
  assert.equal(window.WW_ImageStudioBridge.connection().engine, engine);
  window.WW_ImageStudioBridge.setOfflineOnly(true);
  assert.equal(window.__WW_STUDIO_OFFLINE_ONLY__, false);

  const probe = await api.fn("imageBackendProbe")({
    mode: "custom", url: "https://game-configured.example:8189"
  }, true);
  assert.equal(probe.baseUrl, "http://127.0.0.1:8189");
  assert.equal(probe.engine, engine);
  const imageServerUrl = api.fn("imageServerUrl");
  assert.equal(imageServerUrl("/api/batch/status"),
    "http://127.0.0.1:8189/api/batch/status");
  assert.equal(imageServerUrl("/api/batch/enqueue"),
    "http://127.0.0.1:8189/api/batch/enqueue");

  async function sendThroughWebViewProxy(url, init, responseBody) {
    const promise = window.fetch(url, init);
    await tick();
    assert.equal(forwarded.length > 0, true, engine + ": request must reach the native loopback proxy");
    const args = forwarded.at(-1);
    const [requestId, method, path, headersJson, bodyBase64] = args;
    const result = {
      status: 200,
      statusText: "OK",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      bodyBase64: toBase64(JSON.stringify(responseBody))
    };
    window.__waywardImageGenProxyResolve(requestId, JSON.stringify(result));
    const response = await promise;
    assert.equal(response.status, 200);
    return { response, method, path, headers: JSON.parse(headersJson), body: fromBase64(bodyBase64) };
  }

  const statusRequest = await sendThroughWebViewProxy(
    imageServerUrl("/api/batch/status"),
    { method: "GET", credentials: "omit" },
    { enqueueMode: "append", running: false, total: 0, done: 0 }
  );
  assert.equal(statusRequest.method, "GET");
  assert.equal(statusRequest.path, "/api/batch/status");
  assert.equal((await statusRequest.response.json()).enqueueMode, "append");

  const payload = {
    items: [{ key: "fixture-character-task", prompt: "fixture prompt must pass through unchanged" }],
    jobId: "fixture-job",
    start: true
  };
  const enqueueRequest = await sendThroughWebViewProxy(
    imageServerUrl("/api/batch/enqueue"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      body: JSON.stringify(payload)
    },
    { jobId: "fixture-job", accepted: 1, alreadyCached: 0, alreadyQueued: 0 }
  );
  assert.equal(enqueueRequest.method, "POST");
  assert.equal(enqueueRequest.path, "/api/batch/enqueue");
  assert.equal(enqueueRequest.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(enqueueRequest.body), payload);
  assert.equal((await enqueueRequest.response.json()).accepted, 1);

  for (const eventName of ["launcher_imagegen_request_intercepted", "launcher_imagegen_request_dispatched"]) {
    assert.equal(events.some(event => event.name === eventName && event.details.engine === engine),
      true, engine + ": missing " + eventName + " diagnostic");
  }
  const serializedEvents = JSON.stringify(events);
  assert.equal(serializedEvents.includes("fixture prompt"), false,
    "diagnostics must not contain image prompts");

  runtime.available = false;
  runtime.ready = false;
  runtime.backendVersion = "";
  window.WaywardLauncherImageStudioRouting.refreshRuntime();
  assert.equal(api.fn("settingsStore").getState().imageBackendMode, "off",
    "without a ready launcher server, preserve the game's normal off setting");
  assert.equal(imageServerUrl("/api/batch/enqueue"), null,
    "without a launcher server, do not route to an external game backend");

  return { engine, calls: forwarded.length };
}

assert.match(proxyJava, /new URL\("http:\/\/127\.0\.0\.1:8189" \+ safePath\)/,
  "the native WebView proxy must target only the launcher-managed loopback server");

const results = [];
for (const engine of ["novelai", "comfy"]) results.push(await exerciseEngine(engine));
assert.deepEqual(results, [{ engine: "novelai", calls: 2 }, { engine: "comfy", calls: 2 }]);

console.log("Image Studio automatic generation dispatch reaches launcher NAI and ComfyUI loopback endpoints.");
