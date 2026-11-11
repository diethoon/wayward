import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(
  path.join(here, "../app/src/main/assets/imagegen-proxy.js"),
  "utf8"
);

assert.match(source, /url\.pathname\.startsWith\("\/api\/"\)/);
assert.match(source, /url\.port === "8189"/);
assert.match(source, /window\.WMLHost\.imageGenProxyFetch/);

const bridgeCalls = [];
const nativeCalls = [];
const diagnostics = [];
const window = {
  __WAYWARD_LAUNCHER_IMAGE_RUNTIME__: Object.freeze({ engine: "novelai" }),
  location: { href: "https://session-test.appassets.androidplatform.net/game/index.html" },
  fetch: async (input) => {
    nativeCalls.push(String(input));
    return new Response("native-network");
  },
  WMLHost: {
    logImageProviderDiagnostic(name, details) {
      diagnostics.push({ name, details: JSON.parse(details) });
    },
    imageGenProxyFetch(id, method, url, headersJson, bodyBase64) {
      bridgeCalls.push({ id, method, url, headersJson, bodyBase64 });
      const response = {
        status: 200,
        statusText: "OK",
        headers: { "Content-Type": "application/json" },
        bodyBase64: Buffer.from('{"ok":true}', "utf8").toString("base64"),
      };
      queueMicrotask(() => window.__waywardImageGenProxyResolve(id, JSON.stringify(response)));
    },
  },
};

vm.runInNewContext(source, {
  window,
  URL,
  Request,
  Response,
  Headers,
  Uint8Array,
  Map,
  Date,
  Math,
  TypeError,
  setTimeout,
  clearTimeout,
  btoa,
  atob,
});

const response = await window.fetch("http://127.0.0.1:8189/api/image/health");
assert.equal(response.status, 200);
assert.deepEqual(await response.json(), { ok: true });
assert.equal(bridgeCalls.length, 1);
assert.equal(bridgeCalls[0].url, "/api/image/health");
assert.equal(bridgeCalls[0].method, "GET");
assert.equal(diagnostics.some(item =>
  item.name === "launcher_imagegen_request_intercepted" &&
  item.details.engine === "novelai"), true);
assert.equal(diagnostics.some(item =>
  item.name === "launcher_imagegen_request_dispatched" &&
  item.details.engine === "novelai"), true);
assert.equal(JSON.stringify(diagnostics).includes("items"), false,
  "request diagnostics must not include body or prompt contents");

const post = await window.fetch("http://localhost:8189/api/batch/enqueue?x=1", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: '{"items":[]}',
});
assert.equal(post.status, 200);
assert.equal(bridgeCalls.length, 2);
assert.equal(bridgeCalls[1].url, "/api/batch/enqueue?x=1");
assert.equal(bridgeCalls[1].method, "POST");
assert.equal(Buffer.from(bridgeCalls[1].bodyBase64, "base64").toString("utf8"), '{"items":[]}');

const external = await window.fetch("https://example.com/image.png");
assert.equal(await external.text(), "native-network");
const nonApi = await window.fetch("http://127.0.0.1:8189/not-api");
assert.equal(await nonApi.text(), "native-network");
const wrongPort = await window.fetch("http://127.0.0.1:8190/api/image/health");
assert.equal(await wrongPort.text(), "native-network");

assert.equal(bridgeCalls.length, 2, "Only local /api/* requests on port 8189 should be proxied.");
assert.equal(nativeCalls.length, 3, "All other network requests must retain native fetch.");
console.log("ImageGen proxy contract: PASS");
