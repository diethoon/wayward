import { authorized, sendJson } from "../../lib/common.js";

export default function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
  if (!authorized(req)) return sendJson(res, 401, { error: "unauthorized" });
  return sendJson(res, 200, { ok: true, service: "wayward-launcher-diagnostics" });
}
