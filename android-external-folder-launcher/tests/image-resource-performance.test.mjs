import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../app/src/main/java/com/wayward/launcher/MainActivity.java", import.meta.url), "utf8");
const contains = value => assert.ok(source.includes(value), "Missing launcher behavior: " + value);

contains("s.setCacheMode(WebSettings.LOAD_DEFAULT)");
assert.equal(source.includes("WebSettings.LOAD_NO_CACHE"), false);
contains('h.put("Cache-Control","private, max-age=86400")');
contains("static boolean cacheableMedia(String path)");
contains("WebResourceResponse serveImagePath(String relative)");
contains('domain.equalsIgnoreCase(u.getHost())&&u.getPort()==originPort&&u.getPath()!=null&&u.getPath().startsWith("/images/")');
contains("directoryIndexCache");
contains("childIndex(String parent)");
contains("invalidateDirectoryIndex()");
contains("web.clearCache(true);web.reload()");
console.log("Image resource cache and same-origin /images/ tests passed.");
