const fs = require("node:fs");
const crypto = require("node:crypto");

const url = "https://kio.ac/c/bZ_4-zurxRNdj8SYbqM6eb";

function snippets(text, regex, limit = 50) {
  const found = [];
  let match;
  while ((match = regex.exec(text)) && found.length < limit) {
    found.push({
      index: match.index,
      text: match[0].slice(0, 1000)
    });
  }
  return found;
}

(async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36" }
    });
    const html = await response.text();
    console.log("KIO_RESPONSE", JSON.stringify({
      status: response.status,
      finalUrl: response.url,
      contentType: response.headers.get("content-type"),
      bytes: Buffer.byteLength(html),
      sha256: crypto.createHash("sha256").update(html).digest("hex")
    }));
    if (!response.ok) throw new Error("KIO returned HTTP " + response.status);

    console.log("KIO_HTML_LINKS", JSON.stringify(snippets(html, /<a\\b[^>]*>/gi)));
    console.log("KIO_HTML_SCRIPTS", JSON.stringify(snippets(html, /<script[^>]*src[^>]*>/gi)));
    console.log("KIO_HTML_META", JSON.stringify(snippets(html, /<meta\\b[^>]*>/gi)));
    console.log("KIO_URLS", JSON.stringify(snippets(html, /https?:[^ "'<>]+/gi, 100)));

    const keys = ["download", "file", "share", "filename", "fileName", "fileId", "token", "api", "presign", "object", "storage", "expires", "wml", "zip", "data"];
    const contexts = {};
    for (const key of keys) {
      const index = html.toLowerCase().indexOf(key.toLowerCase());
      if (index >= 0) contexts[key] = html.slice(Math.max(0, index - 500), Math.min(html.length, index + 1300));
    }
    console.log("KIO_KEY_CONTEXTS", JSON.stringify(contexts));
    fs.writeFileSync("/tmp/wayward-wml-0.9.5-share.html", html);
  } finally {
    clearTimeout(timer);
  }
})().catch(error => {
  console.error("KIO_PAGE_PROBE_FAIL", error.stack || String(error));
  process.exitCode = 1;
});
