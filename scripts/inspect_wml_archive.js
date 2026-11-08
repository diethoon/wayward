const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");

const sourcePath = "Wayward_WML_ko.html";
const expectedBytes = 4373978;
const expectedSha256 = "e159fb2002d31559b1ac1936cf6b48cdbbdc4858bfbb0b67e2d7284ca2195d1d";
const terms = [
  '"J":{get:()=>J,set:v=>{J=v}', '"J":{get:()=>J,enumerable',
  '"Fte":{get:()=>Fte,set:v=>{Fte=v}', '"Fte":{get:()=>Fte,enumerable',
  '"Xrt":{get:()=>Xrt,set:v=>{Xrt=v}', '"Xrt":{get:()=>Xrt,enumerable',
  '"gat":{get:()=>gat,set:v=>{gat=v}', '"gat":{get:()=>gat,enumerable',
  '"SB":{get:()=>SB,set:v=>{SB=v}', '"SB":{get:()=>SB,enumerable',
  '"wst":{get:()=>wst,set:v=>{wst=v}', '"wst":{get:()=>wst,enumerable',
  '"yst":{get:()=>yst,set:v=>{yst=v}', '"yst":{get:()=>yst,enumerable',
  '"PB":{get:()=>PB,set:v=>{PB=v}', '"PB":{get:()=>PB,enumerable',
  "globalThis.__WML__.boot", "Object.defineProperties(__wmlE",
  "function gat", "function wst", "function SB", "function yst",
  "function PB", "function Xrt", "function cst",
  "2026-11-01", "wml-core.js", "symbols/2026-11-01.js", "mods.js"
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

const { execFileSync } = require("node:child_process");
const archive = "wayward 11.2.zip";
if (fs.existsSync(archive)) {
  const archiveStat = fs.statSync(archive);
  const archiveHead = Buffer.alloc(4);
  const archiveFd = fs.openSync(archive, "r");
  fs.readSync(archiveFd, archiveHead, 0, 4, 0);
  fs.closeSync(archiveFd);
  console.log("WML_ARCHIVE_META", JSON.stringify({
    path: archive, bytes: archiveStat.size, magic: archiveHead.toString("hex")
  }));
  try {
    const names = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 })
      .split(/\r?\n/).filter(Boolean);
    const hits = names.filter(name => /wml-core\.js$|symbols\/2026-11-01|mods\.js$|wml\/runtime|wml\/symbols/i.test(name));
    console.log("WML_ARCHIVE_ENTRIES", JSON.stringify({
      entries: names.length, relevant: hits.slice(0, 200)
    }));
  } catch (error) {
    console.log("WML_ARCHIVE_LIST_FAIL", String(error.message || error));
  }
} else {
  console.log("WML_ARCHIVE_MISSING", archive);
}

scan();
