const fs = require("node:fs");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const archive = "wayward 11.2.zip";
const out = "/tmp/wayward-wml-archive-extract";
const wanted = [
  "wayward 11.5/wml/runtime/wml-core.js",
  "wayward 11.5/wml/mods/mods.js",
  "wayward 11.5/wml/symbols/2026-11-01.js",
  "wayward 11.5/wml/i18n/ko/finals.js",
  "wayward 11.5/wml/i18n/ko/display.js",
  "wayward 11.5/wml/i18n/ko/voice.js",
  "wayward 11.5/wml/i18n/ko/runtime.js",
  "wayward 11.5/Wayward_WML_ko.html"
];

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

if (!fs.existsSync(archive)) throw new Error("Archive missing: " + archive);
const archiveBytes = fs.readFileSync(archive);
console.log("WML_ARCHIVE_META", JSON.stringify({
  path: archive, bytes: archiveBytes.length, sha256: sha256(archiveBytes),
  magic: archiveBytes.subarray(0, 4).toString("hex")
}));

const names = execFileSync("unzip", ["-Z1", archive], {
  encoding: "utf8", maxBuffer: 20 * 1024 * 1024
}).split(/\r?\n/).filter(Boolean);
console.log("WML_ARCHIVE_ENTRIES", JSON.stringify({
  entries: names.length, paths: names
}));

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
let present = 0;
for (const relative of wanted) {
  if (!names.includes(relative)) {
    console.log("WML_ARCHIVE_FILE_MISSING", relative);
    continue;
  }
  const bytes = execFileSync("unzip", ["-p", archive, relative], {
    encoding: "buffer", maxBuffer: 30 * 1024 * 1024
  });
  const destination = out + "/" + relative.slice("wayward 11.5/".length);
  fs.mkdirSync(require("node:path").dirname(destination), { recursive: true });
  fs.writeFileSync(destination, bytes);
  const text = bytes.toString("utf8");
  const version = text.match(/(?:VERSION|version)\\s*=\\s*['"]([^'"]+)['"]/);
  console.log("WML_ARCHIVE_FILE", JSON.stringify({
    path: relative,
    extractedTo: destination,
    bytes: bytes.length,
    sha256: sha256(bytes),
    head: text.slice(0, 360).replace(/\\s+/g, " "),
    version: version?.[1] || null
  }));
  present += 1;
}
console.log("WML_ARCHIVE_EXTRACT_SUMMARY", JSON.stringify({
  present, wanted: wanted.length, output: out
}));
