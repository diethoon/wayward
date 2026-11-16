import { sendJson } from "../../lib/common.js";

export default function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
  return sendJson(res, 200, { ok: true, service: "wayward-launcher-diagnostics", mode: "write-only" });
}
