const fs = require("node:fs");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const archive = "wayward 11.2.zip";
const out = "/tmp/wayward-wml-archive-extract";
const wanted = [
  "wayward 11.5/wml/runtime/wml-core.js",
  "wayward 11.5/wml/mods/mods.js",
  "wayward 11.5/wml/symbols/2026-11-01.js",
  "wayward 11.5/wml/symbols/2026-11-01.json",
  "wayward 11.5/Wayward_WML_ko.html"
];
const terms = [
  "const VERSION", "VERSION =", "VERSION:", "WML 0.9.5", "0.9.5",
  "globalThis.__WML__", "__WML__", "WML.define", "WML.enable",
  "WML.symbols", "function boot(", "function addHook", "function getHook",
  "function resolveModSymbols", "api.hook", "window.WML",
  "2026-11-01", "ReactDOM", "createPortal"
];

function hash(algorithm, bytes) {
  return crypto.createHash(algorithm).update(bytes).digest("hex");
}

function scanTerms(text, list) {
  return Object.fromEntries(list.map(term => {
    const offsets = [];
    let at = -1;
    while ((at = text.indexOf(term, at + 1)) >= 0 && offsets.length < 20) offsets.push(at);
    return [term, offsets];
  }));
}

if (!fs.existsSync(archive)) throw new Error("Archive missing: " + archive);
const archiveBytes = fs.readFileSync(archive);
console.log("ARCHIVE", JSON.stringify({
  path: archive, bytes: archiveBytes.length,
  sha256: hash("sha256", archiveBytes), md5: hash("md5", archiveBytes)
}));

const names = execFileSync("unzip", ["-Z1", archive], {
  encoding: "utf8", maxBuffer: 20 * 1024 * 1024
}).split(/\r?\n/).filter(Boolean);
console.log("ARCHIVE_I18N_PATHS", JSON.stringify(names.filter(name => /wml\/i18n/i.test(name))));

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const records = {};
for (const relative of wanted) {
  if (!names.includes(relative)) {
    console.log("ARCHIVE_FILE_MISSING", relative);
    continue;
  }
  const bytes = execFileSync("unzip", ["-p", archive, relative], {
    encoding: "buffer", maxBuffer: 30 * 1024 * 1024
  });
  const destination = out + "/" + relative.slice("wayward 11.5/".length);
  fs.mkdirSync(require("node:path").dirname(destination), { recursive: true });
  fs.writeFileSync(destination, bytes);
  const text = bytes.toString("utf8");
  const record = {
    path: relative, extractedTo: destination, bytes: bytes.length,
    sha256: hash("sha256", bytes), md5: hash("md5", bytes),
    terms: scanTerms(text, relative.endsWith("wml-core.js") ? terms : ["2026-11-01", "WML.enable", "WML.define", "gameVersion"])
  };
  records[relative] = record;
  console.log("ARCHIVE_FILE", JSON.stringify(record));
}

const html = records["wayward 11.5/Wayward_WML_ko.html"];
if (html) {
  console.log("CANONICAL_HTML_HASH_CHECK", JSON.stringify({
    bytes: html.bytes, sha256: html.sha256, md5: html.md5,
    expectedBytes: 4373978,
    expectedSha256: "e159fb2002d31559b1ac1936cf6b48cdbbdc4858bfbb0b67e2d7284ca2195d1d",
    expectedUserHash: "d75797d4101f4a1312b3ae0571d77f68"
  }));
}
console.log("ARCHIVE_EXTRACT_SUMMARY", JSON.stringify({
  entries: names.length, present: Object.keys(records).length,
  wanted: wanted.length, output: out
}));

const corePath = out + "/wml/runtime/wml-core.js";
if (fs.existsSync(corePath)) {
  const code = fs.readFileSync(corePath, "utf8");
  const lines = code.split("\n");
  const versionAt = lines.findIndex(line => /VERSION\s*=/.test(line));
  if (versionAt >= 0) {
    console.log("CORE_VERSION_CONTEXT", JSON.stringify({
      line: versionAt + 1, lines: lines.slice(Math.max(0,versionAt-2),versionAt+5)
    }));
  }
  for (const term of ["function addHook(", "function getHook(", "function boot(", "globalThis.__WML__", "window.WML =", "const VERSION"]) {
    const at = code.indexOf(term);
    if (at >= 0) console.log("CORE_CONTEXT", JSON.stringify({
      term, offset: at,
      text: code.slice(Math.max(0,at-900), Math.min(code.length,at+2200))
    }));
  }
}
