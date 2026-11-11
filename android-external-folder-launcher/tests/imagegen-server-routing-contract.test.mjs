import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url);
const mainActivity = fs.readFileSync(new URL("app/src/main/java/com/wayward/launcher/MainActivity.java", root), "utf8");
const service = fs.readFileSync(new URL("app/src/main/java/com/wayward/launcher/ImageGenService.java", root), "utf8");

const ensureStart = mainActivity.indexOf("private void ensureImageGenServer(");
const ensureEnd = mainActivity.indexOf("private void waitForImageGenReady()", ensureStart);
assert.ok(ensureStart >= 0 && ensureEnd > ensureStart, "session server detection method must exist");
const ensure = mainActivity.slice(ensureStart, ensureEnd);

assert.match(mainActivity, /"imagegen-studio-bridge\.js"/, "the launcher routing bridge must load at document start");
assert.match(ensure, /이미지팩/, "no-server state must explicitly retain image-pack mode");
assert.doesNotMatch(ensure, /startImageGenService\s*\(/, "opening a game must not auto-start ImageGen");
assert.doesNotMatch(ensure, /writeImageGenRuntimeConfig\s*\(/, "opening a game must not overwrite the selected engine");
assert.doesNotMatch(ensure, /ImageGenBackendInstaller\.install\s*\(/, "opening a game must not install/start a backend");

assert.match(mainActivity, /config\.put\("imageProvider","novelai"\.equals\(mode\)\?"nai":"sdxl"\)/,
  "NovelAI mode must configure the embedded server as NAI; ComfyUI mode must use SDXL");
assert.match(service, /if \("comfy"\.equals\(launchMode\) && !comfyUrl\.isEmpty\(\)\)/,
  "ComfyUI mode must pass the selected Comfy endpoint into the embedded server");
assert.match(service, /builder\.command\(\)\.add\("--comfy-url"\)/,
  "ComfyUI mode must use the server's ComfyUI route");
console.log("Launcher server selection, manual start, and image-pack fallback contracts passed.");
