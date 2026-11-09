import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(
  path.join(here, "../app/src/main/assets/image-provider-bridge.js"),
  "utf8"
);

const calls = [];
const diagnostics = [];
const imageListeners = {};
class FakeImage {
  constructor() {
    this.naturalWidth = 0;
    this.naturalHeight = 0;
  }
  set src(value) {
    this._src = value;
    this.naturalWidth = 512;
    this.naturalHeight = 512;
    queueMicrotask(() => this.onload && this.onload());
  }
  get src() { return this._src; }
}
const native = {
  listImageProviders() {
    return JSON.stringify({
      providers: [{ id: "a".repeat(32), name: "FLUX Worker", type: "cloudflare-worker" }],
      defaultProviderId: "a".repeat(32),
      fallbackProviderId: "b".repeat(32)
    });
  },
  logImageProviderDiagnostic(event, details) {
    diagnostics.push({ event, details: JSON.parse(details || "{}") });
  },
  generateImageWithProvider(id, providerId, prompt, width, height) {
    calls.push({ id, providerId, prompt, width, height });
    queueMicrotask(() => window.__waywardImageProvidersResolve(id, JSON.stringify({
      ok: true,
      providerId: "a".repeat(32),
      mimeType: "image/jpeg",
      dataUrl: "data:image/jpeg;base64,AA=="
    })));
  }
};
const window = {
  crypto: { randomUUID: () => "test-request-id" },
  Image: FakeImage,
  document: {
    addEventListener(name, callback) { imageListeners[name] = callback; }
  },
  WMLHost: native
};
vm.runInNewContext(source, {
  window, Promise, Map, Error, String, Number, Date, Math, JSON,
  Boolean, Object, setTimeout, clearTimeout, queueMicrotask
});

const listing = window.WaywardImageProviders.list();
assert.equal(listing.providers.length, 1);
assert.equal(listing.defaultProviderId, "a".repeat(32));
assert.equal(listing.fallbackProviderId, "b".repeat(32));

const result = await window.WaywardImageProviders.generate({
  prompt: "a small orange circle",
  width: 512,
  height: 512
});
assert.equal(result.ok, true);
assert.equal(calls.length, 1);
assert.equal(calls[0].providerId, "");
assert.equal(calls[0].prompt, "a small orange circle");
assert.equal(calls[0].width, 512);
assert.equal(calls[0].height, 512);
await new Promise(resolve => setTimeout(resolve, 0));

assert.ok(diagnostics.some(item => item.event === "js_bridge_installed"));
assert.ok(diagnostics.some(item => item.event === "game_generate_requested"));
assert.ok(diagnostics.some(item => item.event === "game_generate_dispatched"));
assert.ok(diagnostics.some(item => item.event === "resolver_received"));
assert.ok(diagnostics.some(item => item.event === "game_generate_resolved"));
assert.ok(diagnostics.some(item => item.event === "data_url_probe_loaded"));
const requestLog = diagnostics.find(item => item.event === "game_generate_requested");
assert.equal(requestLog.details.promptLength, "a small orange circle".length);
assert.equal(JSON.stringify(diagnostics).includes("a small orange circle"), false);

imageListeners.error({
  type: "error",
  target: {
    tagName: "IMG",
    src: "https://example.invalid/private/secret.png?token=hidden",
    currentSrc: "https://example.invalid/private/secret.png?token=hidden",
    naturalWidth: 0,
    naturalHeight: 0,
    complete: true
  }
});
const imageError = diagnostics.find(item => item.event === "img_element_error");
assert.ok(imageError);
assert.equal(imageError.details.srcKind, "https");
assert.equal(JSON.stringify(imageError.details).includes("example.invalid"), false);
assert.equal(JSON.stringify(imageError.details).includes("hidden"), false);

await assert.rejects(
  window.WaywardImageProviders.generate({ prompt: " " }),
  /프롬프트/
);
console.log("Image provider bridge diagnostics contract: PASS");
