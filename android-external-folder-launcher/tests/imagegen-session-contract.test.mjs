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
const automaticStartup = main.slice(main.indexOf("private void ensureImageGenServer"), main.indexOf("private static boolean sameImageGenVersion"));
assert.doesNotMatch(automaticStartup, /extractDirectory\(/,
  "session startup must not extract the original WML ZIP mod");
assert.doesNotMatch(automaticStartup, /startImageGenService\(|startManagedImageGenServer\(|ImageGenBackendInstaller\.install/,
  "session startup must never start or install an engine implicitly");
assert.match(automaticStartup, /서버가 꺼져 있습니다.*기존 이미지팩만 사용합니다/,
  "with no launcher server, the game must remain image-pack-only");
assert.doesNotMatch(automaticStartup, /selectedMode|selectedProvider/,
  "session startup must not select a default provider or fallback engine");
assert.match(main, /launcher-imagegen:/,
  "server version identity must identify the bundled launcher backend");
assert.match(main, /writeImageGenRuntimeConfig\(backend,mode,requestedUrl,launcherProfileId,launcherProviderId\)/,
  "the selected profile/provider and ComfyUI endpoint must be configured in app-private storage");
assert.match(main, /launcherProviderToken/,
  "launcher provider IPC token must be represented in the private backend configuration");
assert.doesNotMatch(main, /@JavascriptInterface public void generateImageWithProvider/,
  "the WebView must not expose direct provider generation");
assert.doesNotMatch(main, /@JavascriptInterface public String listImageProviders/,
  "the WebView must not expose provider records directly");
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
assert.ok(main.includes("SESSION_ACTIVITIES"),
  "the launcher must retain a weak registry of game-session Activity owners");
assert.ok(main.includes("findActiveSessionActivity()"),
  "the home Activity must locate the Activity that owns the active game WebView");
assert.ok(main.includes("EXTRA_OPEN_IMAGE_STUDIO_SETTINGS"),
  "the cross-task handoff must carry an explicit Image Studio settings request");
assert.ok(main.includes("Intent.FLAG_ACTIVITY_NEW_DOCUMENT | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT"),
  "settings handoff must return to the existing document task instead of creating an unrelated WebView");
assert.ok(main.includes("if(openSettings){") && main.includes("openImageGenPanel();"),
  "the active game Activity must open settings after receiving the handoff intent");

console.log("ImageGen session contract tests passed.");
