import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../app/src/main/assets/imagegen-studio-bridge.js", import.meta.url), "utf8");
const calls = [];
const events = [];
let settingsClicked = 0;
const document = {
  querySelector(selector) {
    if (selector === "#wwis-generation-settings") {
      return { disabled: false, click() { settingsClicked++; } };
    }
    return null;
  }
};
const window = {
  __WAYWARD_IMAGE_STUDIO_TEST__: true,
  setTimeout,
  WMLHost: {
    logImageProviderDiagnostic(name, details) {
      events.push({ name, details: JSON.parse(details) });
    }
  },
  WW_ImageStudio: { open() {} },
  WW_ImageStudioBridge: {
    connection() { return { baseUrl: "http://127.0.0.1:8189", comfyui: false }; },
    characters() {
      return {
        skipped: 1,
        characters: [
          { id: "elena", name: "Elena", prompt: "prompt-e", originalPrompt: "prompt-e", negativePrompt: "neg-e", originalNegativePrompt: "neg-e" },
          { id: "new-wife", name: "New Wife", prompt: "prompt-n", originalPrompt: "prompt-n" },
          { id: "patron", name: "Patron", prompt: "", originalPrompt: "" },
          { id: "../bad", name: "Bad", prompt: "x", originalPrompt: "x" }
        ]
      };
    }
  },
  async fetch(url, options) {
    calls.push({ url, options });
    const batch = JSON.parse(options.body).characters;
    return { ok: true, status: 200, async json() { return { results: batch.map((character, index) => ({ added: index === 0, character })) }; } };
  }
};
vm.runInNewContext(source, { window, document, URL, Promise, JSON, String, Number, Math, Set, Error });
const discovery = await window.WaywardLauncherImageStudio.discoverNow();
assert.equal(discovery.ok, true);
assert.equal(discovery.found, 2);
assert.equal(discovery.added, 1);
assert.equal(discovery.existing, 1);
assert.equal(calls.length, 1);
assert.equal(calls[0].url, "http://127.0.0.1:8189/api/generation/characters/discover-batch");
assert.deepEqual(JSON.parse(calls[0].options.body).characters.map(item => item.id), ["elena", "new-wife"]);
assert.equal(events.some(item => item.name === "studio_roster_discovery_completed"), true);

const opened = await window.WaywardLauncherImageStudio.openGenerationSettings();
assert.equal(opened.ok, true);
assert.equal(settingsClicked, 1);

window.WW_ImageStudioBridge.connection = () => ({ baseUrl: "http://example.com:8189" });
const rejected = await window.WaywardLauncherImageStudio.discoverNow();
assert.equal(rejected.ok, false);
assert.equal(rejected.reason, "image_server_connection_pending");
assert.equal(calls.length, 1);
console.log("Image Studio launcher bridge contract tests passed.");
