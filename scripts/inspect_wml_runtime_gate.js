const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");

const sourcePath = "Wayward_WML_ko.html";
const expectedBytes = 4373978;
const expectedSha256 = "e159fb2002d31559b1ac1936cf6b48cdbbdc4858bfbb0b67e2d7284ca2195d1d";
const terms = [
  "WML.boot", "__WML__.boot", "__WML__", "WML",
  "boot({", "boot({game", "game:\\\"2026-11-01\\\"",
  "2026-11-01-pre7", "2026-11-01", "wml-core.js", "symbols/2026-11-01.js", "mods.js",
  "function gat", "function wst", "function SB", "function yst", "function PB",
  "var J=", "let J=", "const J=", "var Fte=", "let Fte=", "const Fte=",
  "Fte.createPortal", "createPortal", "ReactDOM", "React",
  "engine:", "engine:{", "render:", "render:()=>", "Object.freeze",
  "window.WML", "globalThis.WML", "WMLHost"
];

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function scan() {
  const fd = fs.openSync(sourcePath, "r");
  const chunk = Buffer.alloc(4096);
  const whole = crypto.createHash("sha256");
  const manifest = crypto.createHash("sha256");
  const matches = Object.fromEntries(terms.map(term => [term, []]));
  const rows = [];
  let carry = Buffer.alloc(0);
  let offset = 0;
  let chunks = 0;

  try {
    for (;;) {
      const n = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (n === 0) break;

      const current = Buffer.from(chunk.subarray(0, n));
      whole.update(current);
      const chunkHash = sha256(current);
      const row = offset + "\\t" + n + "\\t" + chunkHash;
      rows.push(row);
      manifest.update(Buffer.from(row + "\\n", "utf8"));

      const scanBuffer = Buffer.concat([carry, current]);
      const baseOffset = offset - carry.length;
      for (const term of terms) {
        const needle = Buffer.from(term, "utf8");
        let index = -1;
        while ((index = scanBuffer.indexOf(needle, index + 1)) !== -1) {
          const absolute = baseOffset + index;
          if (absolute >= offset - carry.length && matches[term].length < 30 &&
              !matches[term].includes(absolute)) {
            matches[term].push(absolute);
          }
        }
      }
      carry = scanBuffer.subarray(Math.max(0, scanBuffer.length - 1024));
      offset += n;
      chunks += 1;
    }
  } finally {
    fs.closeSync(fd);
  }

  const digest = whole.digest("hex");
  if (offset !== expectedBytes) {
    throw new Error("Exact target byte size mismatch: " + offset + " != " + expectedBytes);
  }
  if (digest !== expectedSha256) {
    throw new Error("Exact target SHA-256 mismatch: " + digest);
  }

  const contexts = {};
  for (const [term, offsets] of Object.entries(matches)) {
    contexts[term] = offsets.slice(0, 4).map(at => {
      const start = Math.max(0, at - 1536);
      const length = Math.min(4096, offset - start);
      const buffer = Buffer.alloc(length);
      const readFd = fs.openSync(sourcePath, "r");
      let got;
      try { got = fs.readSync(readFd, buffer, 0, length, start); }
      finally { fs.closeSync(readFd); }
      return {
        offset: at,
        start,
        bytes: got,
        text: buffer.subarray(0, got).toString("utf8")
      };
    });
  }

  fs.mkdirSync("evidence", { recursive: true });
  fs.writeFileSync("evidence/wml-html-chunk-manifest.tsv", rows.join("\\n") + "\\n");
  const report = {
    repository: "diethoon/wayward",
    branch: process.env.GITHUB_HEAD_REF || "unknown",
    expectedCommitSource: "4babcaff70e65af6c804e126d8ff9af5eb19dc6a",
    path: sourcePath,
    bytes: offset,
    chunkSize: 4096,
    chunks,
    sha256: digest,
    chunkManifestSha256: manifest.digest("hex"),
    terms: matches,
    contexts
  };
  fs.writeFileSync("evidence/wml-html-runtime-anchors.json", JSON.stringify(report, null, 2));
  console.log("EXACT_SOURCE_PASS", JSON.stringify({
    path: sourcePath, bytes: offset, chunks, sha256: digest,
    chunkManifestSha256: report.chunkManifestSha256
  }));
  for (const term of terms) {
    const found = matches[term];
    console.log("ANCHOR", JSON.stringify({ term, count: found.length, offsets: found.slice(0, 10) }));
  }
  for (const [term, list] of Object.entries(contexts)) {
    for (const entry of list.slice(0, 2)) {
      console.log("CONTEXT", term, entry.offset, JSON.stringify(entry.text));
    }
  }
}

scan();
