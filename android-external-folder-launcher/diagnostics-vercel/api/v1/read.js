import { get, list } from "@vercel/blob";
import { adminAuthorized, sendJson } from "../../lib/common.js";

/** Private assistant-side retrieval only. The APK never receives this key. */
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== "GET") return sendJson(res, 405, { error: "method not allowed" });
  if (!adminAuthorized(req)) return sendJson(res, 404, { error: "not found" });
  try {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const page = await list({ prefix: "logs/", limit: 1000 });
    const blobs = page.blobs
      .filter(blob => new Date(blob.uploadedAt).getTime() >= cutoff)
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
      .slice(0, 40);
    const batches = [];
    for (const blob of blobs) {
      const result = await get(blob.url, { access: "private" });
      if (!result || result.statusCode !== 200 || !result.stream) continue;
      const parsed = JSON.parse(await new Response(result.stream).text());
      if (Array.isArray(parsed.events)) batches.push(...parsed.events);
    }
    batches.sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
    return sendJson(res, 200, { ok: true, count: batches.length, events: batches.slice(-200) });
  } catch (error) {
    console.error("WAYWARD_DIAG_READ_ERROR " + String(error?.name || "read_error"));
    return sendJson(res, 500, { error: "unable to read diagnostic archive" });
  }
}
