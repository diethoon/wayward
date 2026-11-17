import assert from "node:assert/strict";
import fs from "node:fs";

const read = relative => fs.readFileSync(new URL(relative, import.meta.url), "utf8");
const main = read("../app/src/main/java/com/wayward/launcher/MainActivity.java");
const service = read("../app/src/main/java/com/wayward/launcher/ImageGenService.java");
const manifest = read("../app/src/main/AndroidManifest.xml");
const proxy = read("../app/src/main/java/com/wayward/launcher/ImageGenProxy.java");

assert.match(main, /ensureImageGenServer\(sessionTree,/,
  "session entry must inspect only the currently opened session state");
assert.match(main, /web\.loadUrl\(gameUrl\);[\s\S]*?ensureImageGenServer\(sessionTree,/,
  "the game page must open without waiting for optional image services");
assert.match(main, /"imagegen-studio-bridge\.js"/,
  "the Image Studio routing policy must load before WML modules initialize");

const automaticStartup = main.slice(
  main.indexOf("private void ensureImageGenServer"),
  main.indexOf("private void waitForImageGenReady()")
);
assert.ok(automaticStartup.length > 0, "passive session ImageGen status detection must exist");
assert.match(automaticStartup, /ImageGenStatusStore\.read\(getFilesDir\(\)\)/,
  "session entry must read the already-running launcher server state");
assert.match(automaticStartup, /이미지팩/,
  "no-server session entry must explicitly retain the installed image-pack path");
assert.doesNotMatch(automaticStartup, /startImageGenService\s*\(/,
  "opening a game must not silently start a generation engine");
assert.doesNotMatch(automaticStartup, /writeImageGenRuntimeConfig\s*\(/,
  "opening a game must not overwrite the selected NovelAI or ComfyUI mode");
assert.doesNotMatch(automaticStartup, /ImageGenBackendInstaller\.install\s*\(/,
  "opening a game must not install or prepare a server that was not requested");
assert.doesNotMatch(main, /String imageStudioModId\(\)/,
  "server startup no longer depends on extracting or inspecting the game's WML mod");

assert.match(main, /ImageGenBackendInstaller\.install\(this,backend\)/,
  "explicit manual startup installs the backend embedded in the launcher APK");
assert.match(main, /writeImageGenRuntimeConfig\(backend,mode,requestedUrl\)/,
  "explicit manual startup writes the user-selected provider mode and endpoint");
assert.match(main, /config\.put\("imageProvider","novelai"\.equals\(mode\)\?"nai":"sdxl"\)/,
  "NovelAI and ComfyUI use their corresponding embedded backend providers");
assert.match(service, /EXTRA_LAUNCH_MODE/,
  "the selected engine mode is delivered to the foreground ImageGen service");
assert.match(service, /if \("comfy"\.equals\(launchMode\) && !comfyUrl\.isEmpty\(\)\)/,
  "ComfyUI mode passes the selected PC endpoint to the embedded server");
assert.match(service, /builder\.command\(\)\.add\("--comfy-url"\)/,
  "ComfyUI mode uses the embedded server's ComfyUI route");

assert.match(manifest, /android:process=":imagegen"/,
  "ImageGen must run in a process separate from the WebView UI");
assert.match(service, /catch \(Throwable error\)/,
  "runtime startup failures must be captured by the isolated service");
assert.match(service, /heartbeat\.scheduleAtFixedRate/,
  "service liveness must be published while install/start work is running");
assert.match(proxy, /127\.0\.0\.1:8189/,
  "all session WebViews must target the one shared loopback server");

console.log("ImageGen session passive-detection and explicit engine-selection contracts passed.");
