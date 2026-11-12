import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const main = readFileSync(new URL("../app/src/main/java/com/wayward/launcher/MainActivity.java", import.meta.url), "utf8");
const picker = readFileSync(new URL("../app/src/main/java/com/wayward/launcher/WebFileChooser.java", import.meta.url), "utf8");

assert.match(picker, /onShowFileChooser\s*\(/, "WebView file chooser callback must be implemented");
assert.match(picker, /Intent\.ACTION_OPEN_DOCUMENT/, "Android Storage Access Framework must be used");
assert.match(picker, /Intent\.EXTRA_ALLOW_MULTIPLE/, "multiple ZIP selection must be supported");
assert.match(picker, /getClipData\(\)/, "ClipData selections must be read");
assert.match(picker, /getData\(\)/, "single-file selections must be read");
assert.match(picker, /callback\.onReceiveValue\(result\)/, "selected URIs must be returned to WebView");
assert.match(main, /web\.setWebChromeClient\(webFileChooser\)/, "WebView must use the file chooser client");
assert.match(main, /req==WebFileChooser\.REQUEST_CODE/, "file chooser activity results must be routed");
assert.doesNotMatch(main, /PICK_MOD_ZIP|chooseModZip|installModZips|showZipManager|showZipModActions/, "duplicate native ZIP management UI must remain removed; WML owns user-facing mod import and management");
assert.match(main, /LauncherWindowInsets\.apply\(root\)/, "launcher content must apply Android system-bar insets");
assert.doesNotMatch(main, /setWebChromeClient\(new WebChromeClient\(\)\)/, "empty default WebChromeClient must not remain");

console.log("WebFileChooser contract tests passed.");
