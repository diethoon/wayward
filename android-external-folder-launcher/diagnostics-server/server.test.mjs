import assert from "node:assert/strict";
import { createServer } from "./server.mjs";

const lines = [];
const token = "diagnostic-test-token-".padEnd(40, "x");
const server = createServer({ token, emit: line => lines.push(line) });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
try {
  let response = await fetch(base + "/healthz");
  assert.equal(response.status, 200);

  response = await fetch(base + "/api/v1/ping", { method: "POST", body: "{}" });
  assert.equal(response.status, 401);

  response = await fetch(base + "/api/v1/ping", {
    method: "POST", headers: { authorization: "Bearer " + token }, body: "{}"
  });
  assert.equal(response.status, 200);

  const event = {
    id: "123e4567-e89b-12d3-a456-426614174000",
    timestamp: Date.now(),
    deviceId: "123e4567-e89b-12d3-a456-426614174001",
    appVersion: "0.3.1", sdk: 35, model: "Samsung SM-S938N",
    process: "com.wayward.launcher.imagegen031", pid: 12,
    level: "ERROR", component: "imagegen_service", event: "runtime_start_failed",
    details: "{\"exception\":\"java.lang.IllegalStateException\"}"
  };
  response = await fetch(base + "/api/v1/ingest", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ events: [event] })
  });
  assert.equal(response.status, 202);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^WAYWARD_DIAG /);
  assert.equal(JSON.parse(lines[0].slice("WAYWARD_DIAG ".length)).deviceId, event.deviceId);

  response = await fetch(base + "/api/v1/ingest", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ events: [{ ...event, id: "bad-id" }] })
  });
  assert.equal(response.status, 400);

  response = await fetch(base + "/api/v1/ingest", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: "x".repeat(70 * 1024)
  });
  assert.equal(response.status, 413);

  response = await fetch(base + "/not-a-log-reader");
  assert.equal(response.status, 404);
  console.log("Diagnostics receiver tests passed.");
} finally {
  await new Promise(resolve => server.close(resolve));
}
