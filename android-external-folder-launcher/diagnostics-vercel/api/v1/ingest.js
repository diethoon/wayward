import { randomUUID } from "node:crypto";
import { put } from "@vercel/blob";
import { authorized, parseBody, sendJson } from "../../lib/common.js";

export const config = { api: { bodyParser: { sizeLimit: "64kb" } } };
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
    return sendJson(res, 202, { ok: true, accepted: events.length });
  } catch (error) {
    const status = Number(error?.statusCode) || 400;
    if (status >= 500) console.error("WAYWARD_DIAG_INGEST_ERROR " + String(error?.name || "ingest_error"));
    return sendJson(res, status, { error: status === 413 ? "payload too large" : status === 429 ? "rate limited" : "invalid payload" });
  }
}
