import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../app/src/main/java/com/wayward/launcher/MainActivity.java", import.meta.url), "utf8");
const contains = value => assert.ok(source.includes(value), "Missing launcher behavior: " + value);

contains("s.setCacheMode(WebSettings.LOAD_DEFAULT)");
contains('.setDomain(domain+":"+originPort)');
contains("FolderHandler.isGameRequestPath(path)");
contains("WebResourceResponse handle(String p){return serveGamePath(p);}");
contains("folderHandler.serveGamePath(path.substring(6))");
contains("web.loadUrl(gameUrl);");
contains("Image Studio is optional: its startup must never gate the game page.");
assert.equal(source.includes("web.loadUrl(gameUrl);\n            ensureImageGenServer"), false);
assert.equal(source.includes("WebSettings.LOAD_NO_CACHE"), false);
contains('h.put("Cache-Control","private, max-age=86400")');
contains("static boolean cacheableMedia(String path)");
contains("WebResourceResponse serveImagePath(String relative)");
contains("WebResourceResponse serveExternalImagePath(String relative)");
contains("static boolean isLocalOnlyCharacterImagePath(String path)");
contains('String prefix="/images/illustrious/characters/"');
contains("if(FolderHandler.isLocalOnlyCharacterImagePath(path))return serveImageRequest(folderHandler,path,imageDiagnostics);");
contains("handler.serveImagePath(path.substring(8))");
contains("if(FolderHandler.isImageRequestPath(path))return folderHandler.serveExternalImagePath(path.substring(8));");
const localOnlyRoute = source.indexOf("if(FolderHandler.isLocalOnlyCharacterImagePath(path))");
const cdnFallbackRoute = source.indexOf("if(FolderHandler.isImageRequestPath(path))return folderHandler.serveExternalImagePath");
assert.ok(localOnlyRoute >= 0 && cdnFallbackRoute > localOnlyRoute,
  "generated character paths must be handled locally before the general CDN fallback");
contains("InputStream openImage(String p)throws Exception");
contains("new SafImageCache(MainActivity.this)");
contains("imageCache.open(getContentResolver(),documentUri,n.id,n.size,n.lastModified)");
contains("recordImageOpenTiming(p,resolveMs,accessMs,opened,n.size)");
contains("recordDirectoryQueryTiming(waitMs,queryMs,loaded.size())");
contains("DocumentsContract.Document.COLUMN_SIZE");
contains("DocumentsContract.Document.COLUMN_LAST_MODIFIED");
contains("isImageAssetPath(p)?tree.openImage(p):tree.open(p)");
contains("isImageAssetPath(String path)");
contains("private Node resolveImage(String path)");
contains("private Node findIgnoreCase(String parent,String name)");
contains("candidate.name.toLowerCase(Locale.ROOT)");
contains("caseInsensitiveDirectoryCache.put(parent,folded)");
contains("dns-prefetch");
contains("preconnect");
contains("https://art.sintention.com");
contains('if(in==null)return null;');
contains("FolderHandler.isImageRequestPath(path)");
contains('path.regionMatches(true,0,"/images/",0,8)');
contains("directoryIndexCache");
contains("childIndex(String parent)");
contains("invalidateDirectoryIndex()");
contains("web.clearCache(true);web.reload()");
contains("caseInsensitiveDirectoryCache");
contains("directoryLoads");
contains("MAX_CONCURRENT_DIRECTORY_QUERIES");
contains("cachedModIdsGeneration");
contains("serveImageRequest(folderHandler,path,imageDiagnostics)");
contains("image_resource_slow_or_failed");
contains("image_http_error");
contains("isImageResourcePath(failedPath)");
contains("zipMods.close()");

const cacheSource = fs.readFileSync(new URL("../app/src/main/java/com/wayward/launcher/SafImageCache.java", import.meta.url), "utf8");
for (const value of ["MAX_CACHE_BYTES = 128L * 1024L * 1024L", "MAX_SINGLE_IMAGE_BYTES = 32L * 1024L * 1024L", "ConcurrentHashMap<String, CacheLoad>", "CompletableFuture<File>", "TeeInputStream", "if (copiedBytes != expectedSize)", "new File(context.getCacheDir(), \"wayward-saf-images\")"]) {
  assert.ok(cacheSource.includes(value), "Missing bounded SAF image cache behavior: " + value);
}
assert.ok(cacheSource.includes("SHARED_LOAD_TIMEOUT_SECONDS = 60L"), "Shared cache loads must have a timeout.");
console.log("SAF image stage timing, bounded streaming cache, duplicate-open coalescing, local-only generated characters and CDN fallback tests passed.");
