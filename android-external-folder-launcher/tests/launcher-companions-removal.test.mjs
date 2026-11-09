import assert from "node:assert/strict";
import fs from "node:fs";

const java = fs.readFileSync(
  new URL("../app/src/main/java/com/wayward/launcher/MainActivity.java", import.meta.url),
  "utf8"
);
const adapterAsset = new URL("../app/src/main/assets/launcher-companions-mobile-ui.js", import.meta.url);

assert.doesNotMatch(
  java,
  /BUILTIN_COMPANIONS|launcher-mobile-companions|launcher-companions-mobile-ui/,
  "The launcher must not register or serve a built-in Companions adapter."
);
assert.equal(
  fs.existsSync(adapterAsset),
  false,
  "The launcher-bundled Companions adapter asset must be removed."
);

const allModIds = java.match(/private List<String> allModIds\(\)\s*\{([\s\S]*?)\n    \}/);
assert.ok(allModIds, "The normal WML mod discovery method must remain.");
assert.match(allModIds[1], /tree\.listModIds\(\)/);
assert.match(allModIds[1], /zipMods\.listModIds\(\)/);
assert.doesNotMatch(allModIds[1], /ids\.add\s*\(/);

console.log("Launcher built-in Companions adapter removal checks passed.");
