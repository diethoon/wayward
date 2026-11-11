import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (path) => readFileSync(resolve(here, path), "utf8");
const client = read("../app/src/main/java/com/wayward/launcher/ImageProviderClient.java");
const activity = read("../app/src/main/java/com/wayward/launcher/ImageProviderActivity.java");
const store = read("../app/src/main/java/com/wayward/launcher/ImageProviderStore.java");
const localProvider = read("../app/src/main/java/com/wayward/launcher/ImageGenLocalProviderServer.java");

assert.match(client, /ai-gateway\.vercel\.sh/);
assert.match(client, /openAiEndpoint\(provider\.endpoint\)/);
assert.match(client, /value\.endsWith\("\/v1"\).*?images\/generations/s);
assert.match(client, /body\.put\("response_format",\s*"b64_json"\)/);
assert.match(client, /effectivePrompt\s*\+=\s*"\\n\\nAvoid: "/);
assert.match(client, /data\[0\]\.url or data\[0\]\.b64_json/);

assert.match(activity, /Vercel AI Gateway 프리셋 적용/);
assert.match(activity, /https:\/\/ai-gateway\.vercel\.sh\/v1/);
assert.match(activity, /bfl\/flux-2-pro/);
assert.match(activity, /gameAccess\.setChecked\(true\)/);
assert.match(store, /AES\/GCM\/NoPadding/);
assert.match(store, /KeyGenParameterSpec/);
assert.match(localProvider, /snapshot\.fallbacks\.get\(profileId\)/);
assert.match(localProvider, /ImageProviderClient\.generate\(fallback/);

console.log("Vercel AI Gateway image preset, Images API request contract, Keystore storage, and provider fallback checks passed.");
