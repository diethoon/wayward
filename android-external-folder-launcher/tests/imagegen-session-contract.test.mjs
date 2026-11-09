import assert from "node:assert/strict";
import fs from "node:fs";

const read = relative => fs.readFileSync(new URL(relative, import.meta.url), "utf8");
const main = read("../app/src/main/java/com/wayward/launcher/MainActivity.java");
const service = read("../app/src/main/java/com/wayward/launcher/ImageGenService.java");
const manifest = read("../app/src/main/AndroidManifest.xml");
const proxy = read("../app/src/main/java/com/wayward/launcher/ImageGenProxy.java");

assert.match(main, /ensureImageGenServer\(sessionTree,/,
  "session startup must inspect the SafTree captured for the active launch");
assert.match(main, /web\.loadUrl\(gameUrl\);[\s\S]*?ensureImageGenServer\(sessionTree,/,
  "game navigation must start before optional ImageGen preparation");
assert.match(main, /String imageStudioBackendVersion\(\)/,
  "Image Studio ID and backend entrypoints must be detected in that session");
assert.match(main, /wml\/mods\/imagestudio\/backend\/wayward-imagegen\/package\.json/,
  "the active session's nested backend layout must be recognized");
const automaticStartup = main.slice(main.indexOf("private void ensureImageGenServer"), main.indexOf("private static boolean sameImageGenVersion"));
assert.doesNotMatch(automaticStartup, /extractDirectory\(/,
  "automatic Image Studio startup must remain tied to the active physical game folder");
assert.match(main, /ImageGenBackendInstaller\.install\(this,backend\)/,
  "manual startup must install the server embedded in the launcher APK");
assert.match(main, /launcher-imagegen:/,
  "server version identity must identify the bundled launcher backend");
assert.match(main, /writeImageGenRuntimeConfig\(backend,mode,requestedUrl\)/,
  "the selected provider and ComfyUI endpoint must be configured in app-private storage");
const manualStartup = main.slice(main.indexOf("private void startManagedImageGenServer"), main.indexOf("private void writeImageGenRuntimeConfig"));
assert.doesNotMatch(manualStartup, /new SafTree|zipMods|wml\/mods\//,
  "manual startup must not search game folders or extract WML ZIP mods");
assert.doesNotMatch(main, /for \(GameProfile profile : profiles\)/,
  "backend lookup must not silently take another registered session's mod");
assert.match(main, /ImageGenStatusStore\.read\(getFilesDir\(\)\)/,
  "activity reads status from process-shared storage");
assert.match(main, /EXTRA_BACKEND_VERSION, version/,
  "the selected session's backend version must be sent to the service");
assert.match(manifest, /android:process=":imagegen"/,
  "ImageGen must run in a process separate from the WebView UI");
assert.match(service, /catch \(Throwable error\)/,
  "runtime startup failures must be captured by the isolated service");
assert.match(service, /heartbeat\.scheduleAtFixedRate/,
  "service liveness must be published while install/start work is running");
assert.match(proxy, /127\.0\.0\.1:8189/,
  "all session WebViews must target the one shared loopback server");

console.log("ImageGen session contract tests passed.");
