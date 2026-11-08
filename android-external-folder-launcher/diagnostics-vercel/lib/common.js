import { timingSafeEqual } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RATE_WINDOW_MS = 60_000;
const MAX_BATCHES_PER_MINUTE = 30;
const MAX_IP_BATCHES_PER_MINUTE = 90;
const rate = new Map();
const ipRate = new Map();

function withinRateLimit(map, key, limit, now) {
  if (map.size > 4096) {
    for (const [entry, bucket] of map) {
      if (now - bucket.start > RATE_WINDOW_MS * 2) map.delete(entry);
    }
  }
  let bucket = map.get(key);
  if (!bucket || now - bucket.start > RATE_WINDOW_MS) {
    bucket = { start: now, count: 0 };
  }
  bucket.count += 1;
  map.set(key, bucket);
  return bucket.count <= limit;
}

function bounded(value, max = 3000) {
  return String(value ?? "").replace(/[\r\n]/g, " ").slice(0, max);
}

export function redact(value) {
  return bounded(value, 12000)
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, "$1[REDACTED]")
    .replace(/((?:access|refresh)?_?(?:token|api[_-]?key|secret|password|cookie)\s*[:=]\s*["']?)[^\s,;"'}&]+/gi, "$1[REDACTED]")
    .replace(/([?&](?:token|key|secret|password)=)[^&\s]+/gi, "$1[REDACTED]");
}

export function authorized(req, secret = process.env.DIAGNOSTICS_TOKEN) {
  if (!secret || String(secret).length < 32) return false;
  const supplied = Buffer.from(String(req.headers?.authorization || ""));
  const expected = Buffer.from("Bearer " + secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function adminAuthorized(req, secret = process.env.DIAGNOSTICS_ADMIN_TOKEN) {
  if (!secret || String(secret).length < 32) return false;
  const supplied = Buffer.from(String(req.headers?.authorization || ""));
  const expected = Buffer.from("Bearer " + secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(body));
}

export function parseBody(req) {
  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid body");
  if (Buffer.byteLength(JSON.stringify(body), "utf8") > 60 * 1024) {
    const error = new Error("payload too large");
    error.statusCode = 413;
    throw error;
  }
  if (!Array.isArray(body.events) || body.events.length < 1 || body.events.length > 8) {
    throw new Error("invalid event batch");
  }
  const events = body.events.map(event => {
    if (!event || !UUID.test(String(event.id || "")) || !UUID.test(String(event.deviceId || ""))) {
      throw new Error("invalid event identity");
    }
    return {
      id: bounded(event.id, 36),
      timestamp: Number(event.timestamp) || 0,
      deviceId: bounded(event.deviceId, 36),
      appVersion: bounded(event.appVersion, 32),
      sdk: Number(event.sdk) || 0,
      model: bounded(event.model, 80),
      process: bounded(event.process, 80),
      pid: Number(event.pid) || 0,
      level: bounded(event.level, 12),
      component: bounded(event.component, 48),
      event: bounded(event.event, 80),
      details: redact(event.details)
    };
  });
  const deviceIds = new Set(events.map(event => event.deviceId));
  if (deviceIds.size !== 1) throw new Error("mixed devices");
  const deviceId = events[0].deviceId;
  const now = Date.now();
  const bucket = rate.get(deviceId) || { start: now, count: 0 };
  if (now - bucket.start > RATE_WINDOW_MS) { bucket.start = now; bucket.count = 0; }
  bucket.count += 1;
  rate.set(deviceId, bucket);
  if (bucket.count > MAX_BATCHES_PER_MINUTE) {
    const error = new Error("rate limited");
    error.statusCode = 429;
    throw error;
  }
  return { deviceId, events };
}
