import assert from "node:assert/strict";
import fs from "node:fs";

const read = relative => fs.readFileSync(new URL(relative, import.meta.url), "utf8");
const main = read("../app/src/main/java/com/wayward/launcher/MainActivity.java");
const service = read("../app/src/main/java/com/wayward/launcher/ImageGenService.java");
const manifest = read("../app/src/main/AndroidManifest.xml");
const proxy = read("../app/src/main/java/com/wayward/launcher/ImageGenProxy.java");

assert.match(main, /ensureImageGenServer\(sessionTree,/,
  "session startup must inspect the SafTree captured for the active launch");
const launchMethod = main.match(/private void openProfileSession\(String id\)\{[\s\S]*?\n    \}\n\n    private void removeProfile/)?.[0] || "";
assert.ok(launchMethod, "profile launch method must be present");
assert.match(launchMethod, /pendingGameLoad\s*=\s*true[\s\S]*?ensureImageGenServer\(sessionTree,[\s\S]*?web\.loadUrl\(gameUrl\)/,
  "the game WebView must not navigate until ImageGen startup completes");
assert.doesNotMatch(launchMethod, /web\.loadUrl\(gameUrl\);[\s\S]*?ensureImageGenServer\(sessionTree,/,
  "game navigation must not race asynchronous ImageGen startup");
assert.match(main, /if\s*\(pendingGameLoad\)\s*return;/,
  "duplicate session intents must not bypass the ImageGen readiness gate");
assert.match(main, /String imageStudioBackendVersion\(\)/,
  "Image Studio ID and backend entrypoints must be detected in that session");
assert.match(main, /wml\/mods\/imagestudio\/backend\/wayward-imagegen\/package\.json/,
  "the active session's nested backend layout must be recognized");
assert.doesNotMatch(main, /zipMods\.extractDirectory\("imagestudio"/,
  "Image Studio must not require a separate launcher ZIP installation");
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
const runtimeStartup = service.match(/private void startRuntime\(File backendRoot\) throws Exception \{[\s\S]*?\n    private File ensureBun\(\)/)?.[0] || "";
assert.ok(runtimeStartup, "runtime startup method must be present");
assert.doesNotMatch(runtimeStartup, /if\s*\(probeHealth\(\)\)\s*\{[\s\S]*?return;/,
  "an unrelated process must not satisfy readiness before this app starts its backend");
assert.ok(runtimeStartup.indexOf("if (serverProcess == null || !serverProcess.isAlive())")
    < runtimeStartup.indexOf("if (probeHealth())"),
  "the spawned ImageGen process must be alive before health can mark it ready");
assert.match(service, /heartbeat\.scheduleAtFixedRate/,
  "service liveness must be published while install/start work is running");
assert.match(proxy, /127\.0\.0\.1:8189/,
  "all session WebViews must target the one shared loopback server");

console.log("ImageGen session contract tests passed.");
