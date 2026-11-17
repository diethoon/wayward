import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";

const MAX_BODY = 64 * 1024;
const MAX_EVENTS = 8;
const RATE_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 30;
const EVENT_ID = /^[0-9a-f-]{36}$/i;
const DEVICE_ID = /^[0-9a-f-]{36}$/i;

function bounded(value, max = 3000) {
  return String(value ?? "").replace(/[\r\n]/g, " ").slice(0, max);
}
function redact(value) {
  return bounded(value, 12000)
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, "$1[REDACTED]")
    .replace(/((?:access|refresh)?_?(?:token|api[_-]?key|secret|password|cookie)\s*[:=]\s*["']?)[^\s,;"'}&]+/gi, "$1[REDACTED]")
    .replace(/([?&](?:token|key|secret|password)=)[^&\s]+/gi, "$1[REDACTED]");
}
function authorized(req, token) {
  const supplied = Buffer.from(String(req.headers.authorization || ""));
  const expected = Buffer.from("Bearer " + token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error("payload too large"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
function json(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": data.length,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  res.end(data);
}

export function createServer({ token = process.env.DIAGNOSTICS_TOKEN, emit = console.log } = {}) {
  if (!token || String(token).length < 32) throw new Error("DIAGNOSTICS_TOKEN must contain at least 32 characters");
  const rate = new Map();
  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/healthz") return json(res, 200, { ok: true });
    if (req.method !== "POST" || !["/api/v1/ping", "/api/v1/ingest"].includes(req.url)) {
      return json(res, 404, { error: "not found" });
    }
    if (!authorized(req, token)) return json(res, 401, { error: "unauthorized" });

    if (req.url === "/api/v1/ping") return json(res, 200, { ok: true, service: "wayward-launcher-diagnostics" });

    try {
      const body = JSON.parse(await readBody(req));
      if (!Array.isArray(body.events) || body.events.length < 1 || body.events.length > MAX_EVENTS) {
        return json(res, 400, { error: "invalid event batch" });
      }
      const records = [];
      for (const event of body.events) {
        if (!event || !EVENT_ID.test(String(event.id || "")) || !DEVICE_ID.test(String(event.deviceId || ""))) {
          return json(res, 400, { error: "invalid event identity" });
        }
        const deviceId = bounded(event.deviceId, 36);
        const now = Date.now();
        const bucket = rate.get(deviceId) || { start: now, count: 0 };
        if (now - bucket.start > RATE_WINDOW_MS) { bucket.start = now; bucket.count = 0; }
        bucket.count += 1;
        rate.set(deviceId, bucket);
        if (bucket.count > MAX_REQUESTS_PER_WINDOW) return json(res, 429, { error: "rate limited" });
        records.push({
          receivedAt: new Date().toISOString(),
          id: bounded(event.id, 36),
          timestamp: Number(event.timestamp) || 0,
          deviceId,
          appVersion: bounded(event.appVersion, 32),
          sdk: Number(event.sdk) || 0,
          model: bounded(event.model, 80),
          process: bounded(event.process, 80),
          pid: Number(event.pid) || 0,
          level: bounded(event.level, 12),
          component: bounded(event.component, 48),
          event: bounded(event.event, 80),
          details: redact(event.details)
        });
      }
      for (const record of records) emit("WAYWARD_DIAG " + JSON.stringify(record));
      return json(res, 202, { ok: true, accepted: records.length });
    } catch (error) {
      return json(res, Number(error?.status) || 400, {
        error: error?.status === 413 ? "payload too large" : "invalid payload"
      });
    }
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createServer();
  const port = Number(process.env.PORT || 10000);
  server.listen(port, "0.0.0.0", () => console.log("wayward diagnostics receiver listening on " + port));
}
