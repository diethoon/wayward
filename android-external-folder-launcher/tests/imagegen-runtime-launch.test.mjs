import assert from "node:assert/strict";
import fs from "node:fs";

const read = relative => fs.readFileSync(new URL(relative, import.meta.url), "utf8");
const main = read("../app/src/main/java/com/wayward/launcher/MainActivity.java");
const service = read("../app/src/main/java/com/wayward/launcher/ImageGenService.java");
const panel = read("../app/src/main/java/com/wayward/launcher/ImageGenPanelActivity.java");
const installer = read("../app/src/main/java/com/wayward/launcher/ImageGenBackendInstaller.java");
const store = read("../app/src/main/java/com/wayward/launcher/ImageProviderStore.java");
const providerUi = read("../app/src/main/java/com/wayward/launcher/ImageProviderActivity.java");
const manifest = read("../app/src/main/AndroidManifest.xml");
const endpoint = read("../app/src/main/java/com/wayward/launcher/ComfyEndpoint.java");
const embed = read("../scripts/embed_imagegen_backend.py");

assert.match(main, /NovelAI · 런처 내장 서버 실행/);
assert.match(main, /ComfyUI 연결 서버 실행/);
assert.match(main, /startNovelAiServer/);
assert.match(main, /startOrSwitchManagedImageGenServer/);
assert.match(main, /waitForImageGenStopThenStart/);
assert.match(main, /ImageGenBackendInstaller\.install\(this,backend\)/);
assert.match(main, /writeImageGenRuntimeConfig\(backend,mode,requestedUrl\)/);
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
assert.match(service, /EXTRA_COMFY_URL/);
assert.match(service, /command\.add\("src\/cli\.ts"\)/);
assert.match(service, /command\.add\("--config"\)/);
assert.match(service, /command\.add\("--no-webp"\)/);
assert.match(service, /NAI_TOKEN/);
assert.match(service, /ImageProviderStore\.readNovelAiToken\(this\)/);
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
console.log("Embedded ImageGen runtime launch contract tests passed.");
