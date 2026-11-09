import assert from "node:assert/strict";
import { adminAuthorized, authorized, parseBody, redact } from "./lib/common.js";
import { cleanupExpiredWith } from "./lib/cleanup-core.js";

const uuid = "123e4567-e89b-12d3-a456-426614174000";
const device = "123e4567-e89b-12d3-a456-426614174001";
const secret = "test-diagnostics-secret".padEnd(40, "x");
const req = { headers: { authorization: "Bearer " + secret } };
assert.equal(authorized(req, secret), true);
assert.equal(authorized({ headers: {} }, secret), false);
const adminSecret = "diagnostics-admin-test-secret".padEnd(40, "z");
assert.equal(adminAuthorized({ headers: { authorization: "Bearer " + adminSecret } }, adminSecret), true);
assert.equal(adminAuthorized({ query: { key: adminSecret } }, adminSecret), false);
assert.equal(adminAuthorized({ headers: { authorization: "Bearer read" } }, adminSecret), false);
assert.equal(redact("Authorization: Bearer abcdef123; api_key=secret").includes("abcdef123"), false);

const parsed = parseBody({ body: { events: [{
  id: uuid, timestamp: Date.now(), deviceId: device, appVersion: "0.3.2",
  sdk: 35, model: "SM-S938N", process: "launcher", pid: 42,
  level: "ERROR", component: "webview", event: "renderer_process_gone",
  details: "access_token=should-not-leak"
}] } });
assert.equal(parsed.events.length, 1);
assert.equal(parsed.events[0].details.includes("should-not-leak"), false);
assert.throws(() => parseBody({ body: { events: [{ id: "bad", deviceId: device }] } }));
assert.throws(() => parseBody({ body: { events: [{ id: uuid, deviceId: device }, { id: uuid, deviceId: uuid }] } }));
assert.throws(() => parseBody({ body: { events: Array.from({ length: 9 }, () => ({ id: uuid, deviceId: device })) } }));
const deleted = [];
let pageIndex = 0;
const cleanup = await cleanupExpiredWith({
  now: Date.parse("2026-11-09T00:00:00.000Z"),
  listBlobs: async () => {
    pageIndex += 1;
    if (pageIndex === 1) return {
      blobs: [
        { url: "private://expired-1", uploadedAt: "2026-11-01T00:00:00.000Z" },
        { url: "private://recent", uploadedAt: "2026-11-08T00:00:00.000Z" }
      ],
      cursor: "page-2"
    };
    return {
      blobs: [{ url: "private://expired-2", uploadedAt: "2026-10-31T00:00:00.000Z" }],
      cursor: undefined
    };
  },
  deleteBlobs: async urls => deleted.push(...urls)
});
assert.equal(cleanup.pages, 2);
assert.equal(cleanup.deleted, 2);
assert.deepEqual(deleted, ["private://expired-1", "private://expired-2"]);
console.log("Vercel diagnostics API contract tests passed.");
