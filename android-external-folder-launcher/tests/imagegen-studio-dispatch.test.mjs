import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const read = path => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const readBackend = path => fs.readFileSync(new URL(
  "../app/src/main/assets/imagegen-backend/wayward-imagegen/src/" + path,
  import.meta.url
), "utf8");
const bridgeSource = read("../app/src/main/assets/imagegen-studio-bridge.js");
const proxySource = read("../app/src/main/assets/imagegen-proxy.js");
const proxyJava = read("../app/src/main/java/com/wayward/launcher/ImageGenProxy.java");
const mainActivitySource = read("../app/src/main/java/com/wayward/launcher/MainActivity.java");

// Pin the transport test to the actual 0.8.4 server request contract, not a
// lookalike fixture. Image Studio supplies prompt text; the server applies the
// selected provider's configured common prompts and generation parameters.
const batchRoutesSource = readBackend("batch/routes.ts");
const batchQueueSource = readBackend("batch/queue.ts");
const comfyJobRunnerSource = readBackend("comfy/jobRunner.ts");
const naiClientSource = readBackend("nai/client.ts");
const generationSettingsSource = readBackend("routes/generationSettings.ts");

assert.match(batchRoutesSource,
  /typeof item\.talentId !== 'string' \|\| typeof item\.prompt !== 'string'/,
  "the production batch API requires talentId and prompt on every item");
assert.match(batchQueueSource, /negativePrompt\?: string/,
  "the production batch item accepts a separate negative prompt");
assert.match(batchQueueSource,
  /prompt: \[this\.config\.sdxlPositivePrompt\.trim\(\), item\.prompt\]/,
  "the Comfy/Illustrious path retains the Image Studio prompt and adds its configured positive prompt");
assert.match(batchQueueSource,
  /negativePrompt: \[this\.config\.sdxlNegativePrompt\.trim\(\), item\.negativePrompt\?\.trim\(\)\]/,
  "the Comfy/Illustrious path retains the Image Studio negative prompt and adds its configured negative prompt");
assert.match(batchQueueSource,
  /if \(workflow === 'nai'\) return NovelAI_프롬프트만들기\(this\.config, item\.prompt, item\.negativePrompt\)/,
  "the NAI path receives both Image Studio prompt fields");
assert.match(comfyJobRunnerSource,
  /buildComfyPrompt\(\s*this\.config,\s*args\.prompt,\s*args\.negativePrompt,/,
  "the final Comfy workflow is built from the prepared positive and negative prompts");
assert.match(comfyJobRunnerSource,
  /NovelAI_이미지생성하기\(config, job\.prompt, job\.negativePrompt \|\| '', args\.seed\)/,
  "the final NAI request is built from the prepared positive and negative prompts");
assert.match(naiClientSource,
  /v4_prompt: \{ caption: \{ base_caption: prompt, char_captions: \[\] \}/,
  "the NAI request uses the prepared positive prompt");
assert.match(naiClientSource,
  /v4_negative_prompt: \{ caption: \{ base_caption: negativePrompt, char_captions: \[\] \}/,
  "the NAI request uses the prepared negative prompt");

assert.match(generationSettingsSource,
  /router\.get\('\/api\/generation\/settings'/,
  "Image Studio generation settings are readable from the bundled backend");
assert.match(generationSettingsSource,
  /router\.add\('PUT', '\/api\/generation\/settings'/,
  "Image Studio generation settings are writable through the bundled backend");
assert.match(generationSettingsSource,
  /config\.sdxlPositivePrompt = settings\.sdxlPositivePrompt[\s\S]*config\.sdxlNegativePrompt = settings\.sdxlNegativePrompt/,
  "saved Comfy positive/negative prompt settings are applied to runtime config");
assert.match(generationSettingsSource,
  /config\.naiCommonPrompt = settings\.naiCommonPrompt[\s\S]*config\.naiArtistPrompt = settings\.naiArtistPrompt[\s\S]*config\.naiNegativePrompt = settings\.naiNegativePrompt/,
  "saved NAI prompt settings are applied to runtime config");

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
  assert.equal(imageServerUrl("/api/generation/settings"),
    "http://127.0.0.1:8189/api/generation/settings");

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

  const settingsRead = await sendThroughWebViewProxy(
    imageServerUrl("/api/generation/settings"),
    { method: "GET", credentials: "omit" },
    {
      imageProvider: "sdxl",
      sdxlPositivePrompt: "fixture common positive style",
      sdxlNegativePrompt: "fixture common negative quality filters",
      sdxlSteps: 32,
      sdxlCfg: 6.5
    }
  );
  assert.equal(settingsRead.method, "GET");
  assert.equal(settingsRead.path, "/api/generation/settings");
  const loadedSettings = await settingsRead.response.json();
  assert.equal(loadedSettings.sdxlPositivePrompt, "fixture common positive style");
  assert.equal(loadedSettings.sdxlNegativePrompt, "fixture common negative quality filters");
  assert.equal(loadedSettings.sdxlSteps, 32);

  // Image Studio's provider-specific prompt editor saves settings with PUT.
  // Verify that the same launcher route carries edited values unchanged.
  const editedSettings = {
    imageProvider: "sdxl",
    sdxlPositivePrompt: "edited common positive: cinematic portrait, soft rim light",
    sdxlNegativePrompt: "edited common negative: blur, artifacts, bad anatomy",
    sdxlSteps: 34,
    sdxlCfg: 6.8,
    sdxlWidth: 896,
    sdxlHeight: 1152
  };
  const settingsWrite = await sendThroughWebViewProxy(
    imageServerUrl("/api/generation/settings"),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      body: JSON.stringify(editedSettings)
    },
    { saved: true, settings: editedSettings }
  );
  assert.equal(settingsWrite.method, "PUT");
  assert.equal(settingsWrite.path, "/api/generation/settings");
  assert.deepEqual(JSON.parse(settingsWrite.body), editedSettings,
    engine + ": Image Studio prompt editor settings must pass through unchanged");
  assert.equal((await settingsWrite.response.json()).saved, true);

  // Match BatchItem from wayward-imagegen 0.8.4. The earlier fixture used
  // 'key' instead of required 'talentId', so it could not pass the real route.
  const payload = {
    items: [{
      talentId: "fixture-character-task",
      prompt: "fixture edited positive prompt: silver hair, blue coat, rainy street",
      negativePrompt: "fixture edited negative prompt: blurry, low quality",
      workflow: "illustrious",
      imageType: "portrait",
      steps: 32,
      cfg: 6.5,
      loraStrength: 0.72,
      checkpoint: "fixture-checkpoint",
      width: 896,
      height: 1152,
      weight: 4
    }],
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
  assert.deepEqual(JSON.parse(enqueueRequest.body), payload,
    engine + ": edited prompts and generation settings must pass through byte-for-byte");
  assert.equal((await enqueueRequest.response.json()).accepted, 1);

  for (const eventName of ["launcher_imagegen_request_intercepted", "launcher_imagegen_request_dispatched"]) {
    assert.equal(events.some(event => event.name === eventName && event.details.engine === engine),
      true, engine + ": missing " + eventName + " diagnostic");
  }
  const serializedEvents = JSON.stringify(events);
  assert.equal(serializedEvents.includes("fixture edited positive prompt"), false,
    "diagnostics must not contain image prompts");
  assert.equal(serializedEvents.includes("fixture edited negative prompt"), false,
    "diagnostics must not contain negative prompts");

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

assert.match(mainActivitySource, /@JavascriptInterface public void imageGenProxyFetch\(String requestId,String method,String path,String headersJson,String bodyBase64\)\{\s*ImageGenProxy\.dispatch\(web,requestId,method,path,headersJson,bodyBase64\);\s*\}/,
  "the real WebView JavaScript interface must dispatch intercepted Image Studio requests to ImageGenProxy");
assert.match(mainActivitySource, /String launchVersion="launcher-imagegen:"\+ImageGenBackendInstaller\.VERSION\+":"\+mode;/,
  "the active NovelAI or ComfyUI engine mode must be present in the runtime identity");
assert.match(proxyJava, /new URL\("http:\/\/127\.0\.0\.1:8189" \+ safePath\)/,
  "the native WebView proxy must target only the launcher-managed loopback server");

const results = [];
for (const engine of ["novelai", "comfy"]) results.push(await exerciseEngine(engine));
assert.deepEqual(results, [{ engine: "novelai", calls: 4 }, { engine: "comfy", calls: 4 }]);

console.log("Image Studio prompt fields and generation settings reach the launcher-managed NAI/Comfy server without proxy mutation.");
