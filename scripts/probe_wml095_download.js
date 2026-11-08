const fs = require("node:fs");
const crypto = require("node:crypto");

const base = "https://sintention.com/wayward/";
const paths = [
  "wml/runtime/wml-core.js",
  "wml/symbols/2026-11-01.js",
  "wml/mods/mods.js",
  "wml/i18n/ko/finals.js",
  "wml/i18n/ko/display.js",
  "wml/i18n/ko/voice.js",
  "wml/i18n/ko/runtime.js"
];

(async () => {
  let allAvailable = true;
  for (const relativePath of paths) {
    const url = new URL(relativePath, base).href;
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: { "user-agent": "Mozilla/5.0 Wayward-WML-forensic/1.0" },
        signal: AbortSignal.timeout(60000)
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      const sha = crypto.createHash("sha256").update(bytes).digest("hex");
      const result = {
        path: relativePath,
        status: response.status,
        finalUrl: response.url,
        contentType: response.headers.get("content-type"),
        bytes: bytes.length,
        sha256: sha,
        prefix: bytes.subarray(0, 160).toString("utf8")
      };
      console.log("SINTENTION_WML_RESOURCE", JSON.stringify(result));
      const looksLikeJavaScript = response.ok &&
        (bytes.length > 100 && /javascript|text\/plain|application\/octet-stream/i.test(response.headers.get("content-type") || ""));
      if (!looksLikeJavaScript) allAvailable = false;
      if (response.ok && looksLikeJavaScript) {
        const destination = "/tmp/wayward-wml-" + relativePath.replace(/[^a-z0-9]+/gi, "_");
        fs.writeFileSync(destination, bytes);
      }
    } catch (error) {
      allAvailable = false;
      console.log("SINTENTION_WML_RESOURCE_ERROR", JSON.stringify({
        path: relativePath,
        error: String(error)
      }));
    }
  }
  console.log("SINTENTION_WML_RESOURCE_SET", JSON.stringify({ allAvailable }));
  if (!allAvailable) process.exitCode = 2;
})().catch(error => {
  console.error("SINTENTION_WML_PROBE_FAIL", error.stack || String(error));
  process.exitCode = 1;
});
