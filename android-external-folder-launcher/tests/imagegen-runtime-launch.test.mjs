import assert from "node:assert/strict";
import fs from "node:fs";

const read = relative => fs.readFileSync(new URL(relative, import.meta.url), "utf8");
const main = read("../app/src/main/java/com/wayward/launcher/MainActivity.java");
const service = read("../app/src/main/java/com/wayward/launcher/ImageGenService.java");
const panel = read("../app/src/main/java/com/wayward/launcher/ImageGenPanelActivity.java");
const installer = read("../app/src/main/java/com/wayward/launcher/ImageGenBackendInstaller.java");
const store = read("../app/src/main/java/com/wayward/launcher/ImageProviderStore.java");
const providerUi = read("../app/src/main/java/com/wayward/launcher/ImageProviderActivity.java");
const providerClient = read("../app/src/main/java/com/wayward/launcher/ImageProviderClient.java");
const manifest = read("../app/src/main/AndroidManifest.xml");
const endpoint = read("../app/src/main/java/com/wayward/launcher/ComfyEndpoint.java");
const instrumentation = read("../app/src/androidTest/java/com/wayward/launcher/ImageGenServiceRuntimeTest.java");
const embed = read("../scripts/embed_imagegen_backend.py");

assert.match(main, /NovelAI 서버 시작/);
assert.match(main, /ComfyUI 연결 서버 시작/);
assert.match(main, /startNovelAiServer/);
assert.match(main, /startOrSwitchManagedImageGenServer/);
assert.match(main, /waitForImageGenStopThenStart/);
assert.match(main, /ImageGenBackendInstaller\.install\(this,backend\)/);
assert.match(main, /writeImageGenRuntimeConfig\(backend,mode,requestedUrl,launcherProfileId,launcherProviderId\)/);
assert.match(main, /new String\[\] \{ "imagegen-proxy.js", "imagegen-studio-bridge.js" \}/,
  "the direct in-game provider bridge must not be injected into WebView");
assert.doesNotMatch(main, /@JavascriptInterface public void generateImageWithProvider/,
  "WML must not have a direct provider-generation bypass");
assert.doesNotMatch(main, /@JavascriptInterface public String listImageProviders/,
  "WML must not enumerate launcher provider records directly");
assert.match(main, /zipMods\.open\("wml\/mods\/imagestudio\/mod\.js"\)/,
  "auto-start must detect an Image Studio adapter installed as a WML ZIP mod");
const automaticStart = main.slice(
  main.indexOf("private void ensureImageGenServer"),
  main.indexOf("private static boolean sameImageGenVersion")
);
assert.ok(automaticStart.length > 0, "session engine policy method exists");
assert.doesNotMatch(automaticStart, /startImageGenService\(|startManagedImageGenServer\(|ImageGenBackendInstaller\.install/,
  "opening a game session must never start or install a generation engine");
assert.match(automaticStart, /서버가 꺼져 있습니다.*기존 이미지팩만 사용합니다/,
  "when no server is running, session startup must leave image packs as the only source");
assert.doesNotMatch(main, /String selectedMode = "novelai"/,
  "session startup must not silently select NovelAI as a fallback");
assert.match(main, /PC 주소 미설정 · 연결 대기 중/);
assert.match(main, /런처 내장 ImageGen /);

const manualStart = main.slice(
  main.indexOf("private void startManagedImageGenServer(String mode,String comfyUrl)"),
  main.indexOf("private void writeImageGenRuntimeConfig", main.indexOf("private void startManagedImageGenServer(String mode,String comfyUrl)"))
);
assert.ok(manualStart.length > 0, "manual start method exists");
assert.doesNotMatch(manualStart, /new SafTree|zipMods|wml\/mods\//,
  "manual server startup must not inspect game folders or app-only WML ZIP modules");

assert.match(installer, /AssetManager/);
assert.match(installer, /launcher-bundle\.json/);
assert.match(installer, /sourceArchiveSha256/);
assert.match(installer, /sha256\(file\)/);
assert.match(installer, /wayward-imagegen\/src\/nai\/client\.ts/);

assert.match(embed, /26d6c32e0b0abbb886e3029efd548b7ca6774401/);
assert.match(embed, /dfd25e050dd0b98ec1c99c09634bd92b509efac428788273f84884e713e2c553/);
assert.match(embed, /imagestudio\/backend\//);
assert.match(embed, /EXPECTED_VERSION = "0\.8\.4"/);
assert.match(embed, /src\/nai\/client\.ts/);
assert.match(embed, /dependencies != \{"sharp": "0\.35\.5"\}/);

assert.match(store, /AndroidKeyStore/);
assert.match(store, /AES\/GCM\/NoPadding/);
assert.match(store, /root\.put\("novelAiToken", snapshot\.novelAiToken\)/);
assert.match(store, /readNovelAiToken\(Context context\)/);
assert.match(providerUi, /NovelAI API 토큰/);
assert.match(providerUi, /암호화 저장/);
assert.match(providerUi, /NovelAI 토큰 삭제/);

assert.match(service, /EXTRA_LAUNCH_MODE/);
assert.match(service, /\.addAction\(android\.R\.drawable\.ic_media_pause, "중지", pendingStop\)/,
  "the foreground service must retain its explicit Stop action");
assert.match(service, /ANDROID_LINKER_64 = "\/system\/bin\/linker64"/,
  "app-private Bun must be started through Android's system linker");
assert.ok(service.includes('ANDROID_BRIDGE_ARM64_LINKER_64 = "/system/bin/arm64/linker64"'),
  "x86_64 Google API emulators must select the ARM64 native-bridge linker");
assert.match(service, /private File resolveAndroidArm64Linker\(\)/,
  "select the system linker for the device ABI before launching Bun");
assert.match(service, /"arm64-v8a"\.equals\(abis\[0\]\)/,
  "native ARM64 devices must use the regular system linker");
assert.match(service, /synchronized \(processLock\)/,
  "Stop must be serialized with child-process publication");
assert.match(service, /if \(stopping\) \{/,
  "a late Bun launch must be killed when Stop was requested during startup");
assert.match(service, /private ProcessBuilder bunProcess\(File executable, String\.\.\. arguments\)/,
  "all Bun invocations must share the linker-backed command builder");
assert.match(service, /prepareBunExecutable\(binary\)/,
  "an existing Bun binary must be permission-hardened before validation");
assert.match(service, /prepareBunExecutable\(stagedBinary\)/);
assert.match(service, /prepareBunExecutable\(installed\)/);
assert.match(service, /runCommand\(\s*bunProcess\(binary, "--version"\)/);
assert.match(service, /runCommand\(bunProcess\(installed, "--version"\)/);
assert.doesNotMatch(service, /new ProcessBuilder\(binary\.getAbsolutePath\(\), "--version"\)/);
assert.doesNotMatch(service, /new ProcessBuilder\(installed\.getAbsolutePath\(\), "--version"\)/);
assert.doesNotMatch(service, /command\.add\(bun\.getAbsolutePath\(\)\)/,
  "the long-running server must also use the linker-backed builder");
const startupBeforeBun = service.slice(
  service.indexOf("private void startRuntime"),
  service.indexOf("File bun = ensureBun")
);
assert.doesNotMatch(startupBeforeBun, /probeHealth\(\)/,
  "do not adopt an unrelated loopback listener as the managed Bun server");
assert.match(service, /long nextHealthNoticeAt = 0L/);
assert.doesNotMatch(service, /long deadline = System\.currentTimeMillis\(\) \+ 60000L/);
assert.doesNotMatch(service, /60초 안에 \/api\/image\/health 응답이 오지 않았습니다/);
assert.match(service, /EXTRA_COMFY_URL/);
assert.match(service, /bunProcess\(bun,\s*"src\/cli\.ts",\s*"--config",\s*config\.getAbsolutePath\(\),\s*"--no-webp"\)/,
  "the long-running server must pass its CLI arguments through the linker-backed builder");
assert.match(service, /NAI_TOKEN/);
assert.match(service, /ImageProviderStore\.readNovelAiToken\(this\)/);
assert.match(service, /token != null && !token\.trim\(\)\.isEmpty\(\)/,
  "the NovelAI token must be optional at server startup");
assert.doesNotMatch(service, /NovelAI API 토큰이 등록되지 않았습니다/,
  "missing NovelAI credentials must not prevent the local server from starting");
assert.doesNotMatch(providerClient, /NAI_TOKEN|readNovelAiToken/,
  "Cloudflare and other direct providers must not depend on the NovelAI credential");
assert.match(providerClient, /provider\.apiKey/,
  "direct provider credentials are isolated to each provider record");
assert.doesNotMatch(between(main, "private void startManagedImageGenServer", "private void writeImageGenRuntimeConfig"),
  /readNovelAiToken/,
  "manual server startup must not reject missing NovelAI credentials");
function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  return from >= 0 && to > from ? source.slice(from, to) : "";
}
assert.doesNotMatch(service, /bun\.getAbsolutePath\(\), "install"/,
  "the pinned Android runtime must not install sharp or resolve host-specific npm binaries");
assert.match(service, /ComfyEndpoint\.normalizeOptional/);
assert.match(service, /if \("comfy"\.equals\(launchMode\) && !comfyUrl\.isEmpty\(\)\)/,
  "an empty endpoint must leave the local ComfyUI bridge running without a broken URL argument");

assert.match(panel, /127\.0\.0\.1:8189\/\?panel=anima/);
assert.match(panel, /setAllowFileAccess\(false\)/);
assert.match(manifest, /\.ImageGenPanelActivity/);
assert.match(endpoint, /100 && ip\[1\] >= 64 && ip\[1\] <= 127/,
  "Tailscale IPv4 address range is allowed");
assert.match(endpoint, /endsWith\("\.ts\.net"\)/);
assert.match(endpoint, /normalizeOptional/);

assert.ok(instrumentation.includes('MainActivity.class.getDeclaredMethod("startLauncherProviderServer")'),
  "instrumentation must invoke the launcher provider action used by the Image Studio pipeline smoke test");
assert.ok(instrumentation.includes("import android.service.notification.StatusBarNotification;"),
  "notification inventory must use the Android framework StatusBarNotification class");
assert.ok(instrumentation.includes("imagegen/bun-version.log"),
  "instrumentation must verify the downloaded Android Bun version");
assert.ok(instrumentation.includes('bunVersion.contains("1.4.4")'),
  "instrumentation must run Bun 1.4.4 on Android, not host Bun");
assert.ok(instrumentation.includes('serverLog.contains("wayward-imagegen 0.8.4")'),
  "instrumentation must verify that the embedded server actually booted");
assert.ok(instrumentation.includes("activityToFinish::finish"),
  "instrumentation must close the launcher Activity while leaving service alive");
assert.ok(instrumentation.includes("stopIntent.send()"),
  "instrumentation must invoke the notification Stop action");
assert.ok(instrumentation.includes("awaitServerDown(45_000L)"),
  "instrumentation must verify the server endpoint actually shuts down");
console.log("Embedded ImageGen runtime launch contract tests passed.");
