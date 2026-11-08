const fs = require("node:fs");
const crypto = require("node:crypto");
const { pipeline } = require("node:stream/promises");

const url = "https://kio.ac/c/bZ_4-zurxRNdj8SYbqM6eb";
const output = "/tmp/wayward-wml-0.9.5-share.bin";

(async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "Wayward-WML-forensic-runtime/1.0" }
    });

    console.log("KIO_RESPONSE", JSON.stringify({
      status: response.status,
      statusText: response.statusText,
      finalUrl: response.url,
      contentType: response.headers.get("content-type"),
      contentLength: response.headers.get("content-length"),
      disposition: response.headers.get("content-disposition")
    }));
    if (!response.ok) throw new Error("KIO returned HTTP " + response.status);
    if (!response.body) throw new Error("KIO response has no body");

    await pipeline(response.body, fs.createWriteStream(output));
    const data = fs.readFileSync(output);
    const sha = crypto.createHash("sha256").update(data).digest("hex");
    console.log("KIO_BODY", JSON.stringify({
      bytes: data.length,
      sha256: sha,
      magicHex: data.subarray(0, 16).toString("hex"),
      zipMagic: data.subarray(0, 4).toString("hex") === "504b0304",
      fileSavedOutsideRepository: true
    }));
    if (data.subarray(0, 4).toString("hex") !== "504b0304") {
      console.log("KIO_BODY_PREFIX", data.subarray(0, 1024).toString("utf8"));
      throw new Error("Share response is not a ZIP archive");
    }
  } finally {
    clearTimeout(timer);
  }
})().catch(error => {
  console.error("KIO_DOWNLOAD_FAIL", error.stack || String(error));
  process.exitCode = 1;
});
