import assert from "node:assert/strict";
import fs from "node:fs";

const read = relative => fs.readFileSync(new URL(relative, import.meta.url), "utf8");
const main = read("../app/src/main/java/com/wayward/launcher/MainActivity.java");
const service = read("../app/src/main/java/com/wayward/launcher/ImageGenService.java");
const panel = read("../app/src/main/java/com/wayward/launcher/ImageGenPanelActivity.java");
const manifest = read("../app/src/main/AndroidManifest.xml");
const endpoint = read("../app/src/main/java/com/wayward/launcher/ComfyEndpoint.java");

assert.match(main, /NovelAI · EasyGen 서버 실행/);
assert.match(main, /ComfyUI 연결 서버 실행/);
assert.match(main, /startManagedImageGenServer\("novelai"/);
assert.match(main, /startManagedImageGenServer\("comfy"/);
assert.match(main, /wml\/mods\/easygen\/server/);
assert.match(main, /src\/nai\/client\.ts/);
assert.match(main, /zipMods\.extractDirectory\("easygen","server"/);
assert.match(main, /zipMods\.extractDirectory\("imagestudio","backend"/);
assert.match(main, /ImageGenPanelActivity\.EXTRA_MODE/);
assert.match(service, /EXTRA_LAUNCH_MODE/);
assert.match(service, /EXTRA_COMFY_URL/);
assert.match(service, /command\.add\(launch\.getAbsolutePath\(\)\)/,
  "NovelAI must launch the EasyGen wrapper, not the generic CLI entrypoint");
assert.match(service, /--config/);
assert.match(main, /wayward-imagegen\.config\.json이 필요합니다/,
  "ComfyUI startup validates its workflow configuration before launching");
assert.match(service, /--comfy-url/);
assert.match(service, /installCommand\.command\(\)\.add\("--production"\)/,
  "NovelAI uses the full dependency install while Image Studio keeps production-only install");
assert.match(panel, /127\.0\.0\.1:8189\/\?panel=anima/);
assert.match(panel, /setAllowFileAccess\(false\)/);
assert.match(manifest, /\.ImageGenPanelActivity/);
assert.match(endpoint, /100 && ip\[1\] >= 64 && ip\[1\] <= 127/,
  "Tailscale IPv4 address range is allowed");
assert.match(endpoint, /endsWith\("\.ts\.net"\)/);
console.log("ImageGen runtime launch contract tests passed.");
