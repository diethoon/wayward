import { cleanupExpired } from "../../lib/cleanup.js";
import { authorized, sendJson } from "../../lib/common.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return sendJson(res, 405, { error: "method not allowed" });
  if (!authorized(req, process.env.CRON_SECRET)) return sendJson(res, 401, { error: "unauthorized" });
  try {
    const result = await cleanupExpired();
    console.info("WAYWARD_DIAG_RETENTION " + JSON.stringify(result));
    return sendJson(res, 200, { ok: true, ...result });
  } catch (error) {
    console.error("WAYWARD_DIAG_CLEANUP_ERROR " + String(error?.name || "cleanup_error"));
    return sendJson(res, 500, { error: "retention cleanup failed" });
  }
}
