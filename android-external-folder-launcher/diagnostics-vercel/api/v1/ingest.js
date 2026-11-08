import { randomUUID } from "node:crypto";
import { del, list, put } from "@vercel/blob";
import { authorized, parseBody, sendJson } from "../../lib/common.js";

export const config = { api: { bodyParser: { sizeLimit: "64kb" } } };
let lastPruneAt = 0;

async function pruneExpired() {
  const now = Date.now();
  if (now - lastPruneAt < 24 * 60 * 60 * 1000) return;
  const cutoff = now - 7 * 24 * 60 * 60 * 1000;
  let cursor;
  let pages = 0;
  do {
    const page = await list({ prefix: "logs/", limit: 1000, cursor });
    const expired = page.blobs.filter(blob => new Date(blob.uploadedAt).getTime() < cutoff);
    if (expired.length) await del(expired.map(blob => blob.url));
    cursor = page.cursor;
    pages += 1;
  } while (cursor && pages < 10);
  lastPruneAt = now;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
  if (!authorized(req)) return sendJson(res, 401, { error: "unauthorized" });
  try {
    const { deviceId, events } = parseBody(req);
    const date = new Date().toISOString().slice(0, 10);
    const pathname = `logs/${deviceId}/${date}/${Date.now()}-${randomUUID()}.json`;
    await put(pathname, JSON.stringify({ receivedAt: new Date().toISOString(), events }), {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false
    });

    // Short-lived runtime logs provide immediate inspection; private Blob is the durable archive.
    for (const event of events) {
      console.info("WAYWARD_DIAG " + JSON.stringify({ ...event, receivedAt: new Date().toISOString() }));
    }
    try { await pruneExpired(); } catch (cleanupError) {
      console.warn("WAYWARD_DIAG_CLEANUP_WARN " + String(cleanupError?.name || "cleanup_error"));
    }
    return sendJson(res, 202, { ok: true, accepted: events.length });
  } catch (error) {
    const status = Number(error?.statusCode) || 400;
    if (status >= 500) console.error("WAYWARD_DIAG_INGEST_ERROR " + String(error?.name || "ingest_error"));
    return sendJson(res, status, { error: status === 413 ? "payload too large" : status === 429 ? "rate limited" : "invalid payload" });
  }
}
