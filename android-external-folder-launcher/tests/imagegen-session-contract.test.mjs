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
assert.match(main, /String imageStudioModId\(\)/,
  "the active session must identify the WML Image Studio adapter");
assert.match(main, /zipMods\.open\("wml\/mods\/imagestudio\/mod\.js"\)/,
  "active-session detection must include the app-private ZIP overlay");
assert.doesNotMatch(main, /wml\/mods\/imagestudio\/backend\//,
  "the game folder must not be required to contain the bundled server source");
assert.match(main, /ImageGenBackendInstaller\.install\(this, imageGenBackendRoot\(\)\)/,
  "the embedded backend is installed from APK assets, not copied from the game folder");
const automaticStartup = main.slice(main.indexOf("private void ensureImageGenServer"), main.indexOf("private static boolean sameImageGenVersion"));
assert.doesNotMatch(automaticStartup, /extractDirectory\(/,
  "automatic Image Studio startup must not extract the original WML ZIP mod");
assert.match(automaticStartup, /String selectedMode = "novelai"/,
  "automatic startup must retain NovelAI as the fallback provider mode");
assert.match(automaticStartup, /selectedMode = "launcher"/,
  "automatic startup must select the configured launcher provider for the active profile");
assert.match(automaticStartup, /selected\.allowInGame/,
  "automatic startup must respect the profile provider's in-game permission");
assert.match(main, /ImageGenBackendInstaller\.install\(this,backend\)/,
  "manual startup must install the server embedded in the launcher APK");
assert.match(main, /launcher-imagegen:/,
  "server version identity must identify the bundled launcher backend");
assert.match(main, /writeImageGenRuntimeConfig\(backend,mode,requestedUrl,launcherProfileId,launcherProviderId\)/,
  "the selected profile/provider and ComfyUI endpoint must be configured in app-private storage");
assert.match(main, /launcherProviderToken/ ,
  "launcher provider IPC token must be represented in the private backend configuration");
assert.match(service, /new ImageGenLocalProviderServer\(/,
  "the native provider adapter must be started by the isolated ImageGen service");
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
assert.match(main, /SESSION_ACTIVITIES/,
  "the launcher must retain a weak registry of game-session Activity owners");
assert.match(main, /findActiveSessionActivity\(\)/,
  "the home Activity must locate the Activity that owns the active game WebView");
assert.match(main, /EXTRA_OPEN_IMAGE_STUDIO_SETTINGS/,
  "the cross-task handoff must carry an explicit Image Studio settings request");
assert.match(main, /FLAG_ACTIVITY_NEW_DOCUMENT \\| Intent\\.FLAG_ACTIVITY_REORDER_TO_FRONT/,
  "settings handoff must return to the existing document task instead of creating an unrelated WebView");
assert.match(main, /if\(openSettings\)\s*\{[\s\S]*?openImageGenPanel\(\)/,
  "the active game Activity must open settings after receiving the handoff intent");

console.log("ImageGen session contract tests passed.");
