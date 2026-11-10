package com.wayward.launcher;

import java.io.File;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

public final class ZipModStoreTest {
    public static void main(String[] args) throws Exception {
        File temp = Files.createTempDirectory("wayward-zip-mod-test").toFile();
        try {
            ZipModStore store = new ZipModStore(temp);

            File rootZip = store.temporaryFile("root-test");
            Map<String, String> rootEntries = new LinkedHashMap<>();
            rootEntries.put("mod.js", "WML.define({ id: 'sample-mod', setup(api) {} });");
            rootEntries.put("assets/config.json", "{\"ok\":true}");
            rootEntries.put("../outside.txt", "must not be exposed");
            writeZip(rootZip, rootEntries);
            ZipModStore.ModInfo rootInfo = ZipModStore.inspect(rootZip);
            check("sample-mod".equals(rootInfo.id), "root mod.js ID parse");
            store.install(rootZip);
            check(store.listModIds().equals(List.of("sample-mod")), "registered root ZIP mod");
            check(read(store.open("wml/mods/sample-mod/mod.js")).contains("sample-mod"), "root mod.js served");
            check("{\"ok\":true}".equals(read(store.open("wml/mods/sample-mod/assets/config.json"))), "root ZIP asset served");
            int rootOpenCount = store.archiveOpenCountForTesting();
            for (int i = 0; i < 20; i++) {
                check("{\"ok\":true}".equals(read(store.open("wml/mods/sample-mod/assets/config.json"))),
                        "repeated ZIP asset request remains readable");
            }
            check(store.archiveOpenCountForTesting() == rootOpenCount,
                    "repeated requests reuse the open ZIP central directory");
            check(store.open("wml/mods/sample-mod/../../outside.txt") == null, "request traversal rejected");
            check(!new File(temp, "wml-zip-mods/sample-mod/mod.js").exists(), "ZIP not extracted");
            check(store.fileFor("sample-mod").isFile(), "original ZIP retained in app store");

            // Image Studio 1.31.20 ships a real 320,679-byte mod.js. Exercise
            // the same size class in the install/inspect/stream path so a
            // launcher ZIP-size regression cannot silently block the module.
            StringBuilder largeModSource = new StringBuilder(
                    "WML.define({ id: 'large-imagestudio', setup(api) {} });\\n/*");
            while (largeModSource.length() < 320_677) largeModSource.append('x');
            largeModSource.append("*/");
            check(largeModSource.length() == 320_679, "large WML fixture matches Image Studio mod.js byte size");
            File largeModZip = store.temporaryFile("large-mod-test");
            writeZip(largeModZip, Map.of("mod.js", largeModSource.toString(), "portrait.js", "window.portraitReady=true;"));
            ZipModStore.ModInfo largeInfo = ZipModStore.inspect(largeModZip);
            check("large-imagestudio".equals(largeInfo.id), "large WML mod.js ID parsed beyond 64KB");
            store.install(largeModZip);
            check(store.listModIds().contains("large-imagestudio"), "large WML mod registered from ZIP");
            check(largeModSource.toString().equals(read(store.open("wml/mods/large-imagestudio/mod.js"))),
                    "large WML mod.js streams intact through ZIP overlay");
            check("window.portraitReady=true;".equals(
                    read(store.open("wml/mods/large-imagestudio/portrait.js"))),
                    "large WML mod adjacent assets remain served");

            File nestedZip = store.temporaryFile("nested-test");
            Map<String, String> nestedEntries = new LinkedHashMap<>();
            nestedEntries.put("bundle-root/mod.js", "WML.define({ id: \"nested-mod\", setup(api) {} });");
            nestedEntries.put("bundle-root/images/icon.svg", "<svg></svg>");
            writeZip(nestedZip, nestedEntries);
            store.install(nestedZip);
            check("nested-mod".equals(read(store.open("wml/mods/nested-mod/mod.js")).contains("nested-mod") ? "nested-mod" : ""), "wrapped mod.js served");
            check("<svg></svg>".equals(read(store.open("wml/mods/nested-mod/images/icon.svg"))), "wrapped ZIP asset path served");

            File duplicate = store.temporaryFile("duplicate-test");
            writeZip(duplicate, Map.of("mod.js", "WML.define({ id: 'sample-mod', setup(api) {} });"));
            expectFailure(() -> store.install(duplicate), "duplicate ID rejected");

            File ambiguous = store.temporaryFile("ambiguous-test");
            Map<String, String> ambiguousEntries = new LinkedHashMap<>();
            ambiguousEntries.put("one/mod.js", "WML.define({ id: 'one', setup(api) {} });");
            ambiguousEntries.put("two/mod.js", "WML.define({ id: 'two', setup(api) {} });");
            writeZip(ambiguous, ambiguousEntries);
            expectFailure(() -> ZipModStore.inspect(ambiguous), "ambiguous multi-mod ZIP rejected");

            File imageStudioZip = store.temporaryFile("imagestudio-backend");
            Map<String, String> imageStudioEntries = new LinkedHashMap<>();
            imageStudioEntries.put("imagestudio-root/mod.js", "WML.define({ id: 'imagestudio', setup(api) {} });");
            imageStudioEntries.put("imagestudio-root/backend/wayward-imagegen/package.json", "{\"version\":\"0.8.4\"}");
            imageStudioEntries.put("imagestudio-root/backend/wayward-imagegen/src/cli.ts", "console.log('server');");
            imageStudioEntries.put("imagestudio-root/backend/wayward-imagegen/src/nested/provider.ts", "export const ok = true;");
            imageStudioEntries.put("imagestudio-root/other-asset.txt", "not copied");
            writeZip(imageStudioZip, imageStudioEntries);
            store.install(imageStudioZip);
            check(read(store.open("wml/mods/imagestudio/mod.js")).contains("id: 'imagestudio'"),
                    "Image Studio ZIP adapter marker is readable through the same overlay used by the game");

            File backend = new File(temp, "private-imagegen-backend");
            check(store.extractDirectory("imagestudio", "backend", backend), "ImageGen backend folder extracted");
            check(new File(backend, "wayward-imagegen/package.json").isFile(), "ImageGen package.json extracted");
            check(new File(backend, "wayward-imagegen/src/cli.ts").isFile(), "ImageGen CLI entrypoint extracted");
            check(new File(backend, "wayward-imagegen/src/nested/provider.ts").isFile(), "nested ImageGen source extracted");
            check(!new File(backend, "mod.js").exists(), "Image Studio mod entrypoint not copied into backend");
            check(!new File(backend, "other-asset.txt").exists(), "non-backend mod asset not copied");
            check(store.fileFor("imagestudio").isFile(), "original Image Studio ZIP retained");

            File rejectedBackend = new File(temp, "rejected-backend");
            expectFailure(() -> store.extractDirectory("imagestudio", "../backend", rejectedBackend),
                    "ImageGen backend path traversal rejected");
            check(!rejectedBackend.exists(), "failed backend extraction leaves no destination");

            for (int i = 0; i < 6; i++) {
                String id = "cache-mod-" + (i + 1);
                File cacheZip = store.temporaryFile("cache-" + i);
                writeZip(cacheZip, Map.of(
                        "mod.js", "WML.define({ id: '" + id + "', setup(api) {} });",
                        "asset.txt", "cache-" + i));
                store.install(cacheZip);
                check(("cache-" + i).equals(read(store.open("wml/mods/" + id + "/asset.txt"))),
                        "LRU ZIP cache serves installed mod assets");
            }
            check(store.cachedArchiveCountForTesting() <= 4,
                    "open ZIP handles remain bounded");
            int beforeReopen = store.archiveOpenCountForTesting();
            check(read(store.open("wml/mods/sample-mod/mod.js")).contains("sample-mod"),
                    "evicted ZIP can be reopened");
            check(store.archiveOpenCountForTesting() == beforeReopen + 1,
                    "an evicted ZIP is reopened only on the next request");
            store.close();
            check(store.cachedArchiveCountForTesting() == 0,
                    "closing the store releases cached archives");

            System.out.println("ZipModStore tests passed.");
        } finally {
            deleteRecursively(temp);
        }
    }

    private static void writeZip(File path, Map<String, String> entries) throws Exception {
        try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(path.toPath()))) {
            for (Map.Entry<String, String> entry : entries.entrySet()) {
                zip.putNextEntry(new ZipEntry(entry.getKey()));
                zip.write(entry.getValue().getBytes(StandardCharsets.UTF_8));
                zip.closeEntry();
            }
        }
    }

    private static String read(InputStream in) throws Exception {
        if (in == null) throw new AssertionError("expected ZIP entry stream");
        try (InputStream stream = in) {
            return new String(stream.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    private interface Checked {
        void run() throws Exception;
    }

    private static void expectFailure(Checked action, String label) throws Exception {
        try {
            action.run();
        } catch (Exception expected) {
            System.out.println("PASS " + label + ": " + expected.getMessage());
            return;
        }
        throw new AssertionError(label);
    }

    private static void check(boolean ok, String label) {
        if (!ok) throw new AssertionError(label);
        System.out.println("PASS " + label);
    }

    private static void deleteRecursively(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteRecursively(child);
        file.delete();
    }
}
