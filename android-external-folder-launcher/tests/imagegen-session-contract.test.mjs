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
assert.doesNotMatch(main, /ZipModStore|zipMods|imageStudioZipBackendVersion|PICK_MOD_ZIP/,
  "launcher must not retain a global app-private ZIP overlay");
assert.match(main, /private boolean ensureImageGenBackend\(SafTree sessionTree\)/,
  "Image Studio backend is copied only from the selected game folder");
assert.match(main, /private boolean hasImageGenProject\(File backend\)/,
  "the app-private cached backend layout must be validated before service start/restart");
assert.match(main, /sessionTree\.copyDirectory\("wml\/mods\/imagestudio\/backend", backend\)/,
  "Image Studio backend must come from that session's WML folder");
assert.match(main, /wml\/mods\/imagestudio\/backend\/wayward-imagegen\/package\.json/,
  "nested Image Studio ZIP backend layouts must be recognized");
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
assert.match(service, /ACTION_RESTART/,
  "the foreground service must support an explicit restart command");
assert.match(service, /ANDROID_LINKER_64 = "\/system\/bin\/linker64"/,
  "Bun in app-private storage must be loaded through Android's system linker to avoid direct execve W^X denial");
assert.match(service, /command\.add\(ANDROID_LINKER_64\)/,
  "all Bun commands must start via the system linker");
assert.match(service, /bunProcess\(bun, "install", "--production"\)/,
  "dependency installation must use the system-linker launch path");
assert.match(service, /bunProcess\(bun, "src\/cli\.ts", "--no-webp"\)/,
  "Android must disable WebP because the packaged sharp native binary is not Android ARM64");
assert.match(service, /while \(!stopping\)[\s\S]*?probeHealth\(\)/,\n  "health readiness must keep waiting while the launched server process remains alive");\nassert.doesNotMatch(service, /60초 안에 \/api\/image\/health/,\n  "health readiness must not fail solely because a fixed startup timeout elapsed");\nassert.match(service, /outFile\.setReadOnly\(\)/,
  "the extracted runtime must be marked read-only before writing");
assert.match(service, /executable\.setReadOnly\(\)/,
  "existing and fresh Bun executables must remain read-only");
assert.doesNotMatch(service, /new ProcessBuilder\((?:bun|binary|installed)\.getAbsolutePath\(\)/,
  "Bun must never be passed directly to ProcessBuilder on Android 10+");
assert.match(main, /imageGenStatusMonitorRunnable[\s\S]*?postDelayed\(this, 2000L\)/,
  "launcher home must refresh server state every two seconds");
assert.match(main, /probeImageGenHealth\(\)/,
  "launcher must actively probe the ImageGen Health endpoint");
assert.match(main, /imageGenStartButton[\s\S]*?imageGenRestartButton[\s\S]*?imageGenStopButton/,
  "launcher must expose start, restart, and stop controls");
assert.doesNotMatch(main, /launcher-mobile-companions|BUILTIN_COMPANIONS|launcher-companions-mobile-ui/,
  "the built-in Companion mobile real-time panel must be removed");
assert.match(main, /new WebFileChooser\(this\)/,
  "the in-game WML file picker must remain available after removing the app ZIP menu");
assert.match(proxy, /127\.0\.0\.1:8189/,
  "all session WebViews must target the one shared loopback server");

console.log("ImageGen session contract tests passed.");
