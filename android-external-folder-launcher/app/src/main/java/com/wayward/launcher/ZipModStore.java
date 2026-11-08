package com.wayward.launcher;

import java.io.File;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * App-private WML mod ZIP overlay.
 *
 * The archive is kept as a ZIP in filesDir; entries are streamed on demand.
 * No entry is extracted into the selected game folder or app directory.
 */
final class ZipModStore {
    private static final String MOD_ROOT = "wml/mods/";
    private static final long MAX_ARCHIVE_BYTES = 512L * 1024L * 1024L;
    private static final long MAX_ENTRY_BYTES = 256L * 1024L * 1024L;
    private static final int MAX_MOD_JS_BYTES = 65536;
    private static final Pattern ID = Pattern.compile("^[a-z0-9][a-z0-9._-]*$");
    private static final Pattern MOD_ID = Pattern.compile(
            "(?:\\bid\\s*:\\s*|[\"']id[\"']\\s*:\\s*)[\"']([a-z0-9][a-z0-9._-]*)[\"']");

    static final class ModInfo {
        final String id;
        final String prefix;
        ModInfo(String id, String prefix) { this.id = id; this.prefix = prefix; }
    }

    private final File directory;

    ZipModStore(File filesDir) {
        directory = new File(filesDir, "wml-zip-mods");
        if (!directory.exists() && !directory.mkdirs()) {
            throw new IllegalStateException("앱 전용 모드 저장소를 만들 수 없습니다.");
        }
        File[] interrupted = directory.listFiles((dir, name) -> name.startsWith(".incoming-"));
        if (interrupted != null) for (File file : interrupted) file.delete();
    }

    File temporaryFile(String suffix) {
        return new File(directory, ".incoming-" + suffix + ".zip");
    }

    File fileFor(String id) {
        if (id == null || !ID.matcher(id).matches()) throw new IllegalArgumentException("잘못된 모드 ID");
        return new File(directory, id + ".zip");
    }

    boolean install(File stagedZip) throws IOException {
        ModInfo info = inspect(stagedZip);
        File destination = fileFor(info.id);
        if (destination.exists()) throw new IOException("이미 설치된 모드 ID입니다: " + info.id);
        if (!stagedZip.renameTo(destination)) throw new IOException("앱 내부 모드 저장소로 이동하지 못했습니다.");
        return true;
    }

    boolean uninstall(String id) {
        File f = fileFor(id);
        return !f.exists() || f.delete();
    }

    List<String> listModIds() {
        File[] files = directory.listFiles((dir, name) -> name.toLowerCase(Locale.ROOT).endsWith(".zip"));
        if (files == null) return Collections.emptyList();
        List<String> ids = new ArrayList<>();
        for (File file : files) {
            try {
                ModInfo info = inspect(file);
                if (file.getName().equals(info.id + ".zip")) ids.add(info.id);
            } catch (Exception ignored) {
                // Ignore incomplete/corrupt staged archives; the game must not load them.
            }
        }
        Collections.sort(ids);
        return ids;
    }

    InputStream open(String requestPath) throws IOException {
        if (requestPath == null || !requestPath.startsWith(MOD_ROOT)) return null;
        String relative = requestPath.substring(MOD_ROOT.length());
        int slash = relative.indexOf('/');
        if (slash <= 0 || slash == relative.length() - 1) return null;
        String id = relative.substring(0, slash);
        if (!ID.matcher(id).matches()) return null;

        File archive = fileFor(id);
        if (!archive.isFile() || archive.length() > MAX_ARCHIVE_BYTES) return null;
        ZipFile zip = new ZipFile(archive);
        boolean handedOff = false;
        try {
            ModInfo info = inspect(zip);
            if (!id.equals(info.id)) return null;
            String entryName = info.prefix + relative.substring(slash + 1);
            String safeName = safeEntryName(entryName);
            if (safeName == null) return null;
            ZipEntry entry = zip.getEntry(safeName);
            if (entry == null || entry.isDirectory()) return null;
            if (entry.getSize() > MAX_ENTRY_BYTES) return null;
            InputStream stream = zip.getInputStream(entry);
            handedOff = true;
            return new FilterInputStream(stream) {
                @Override public void close() throws IOException {
                    try { super.close(); } finally { zip.close(); }
                }
            };
        } finally {
            if (!handedOff) zip.close();
        }
    }

    boolean extractDirectory(String modId, String relativeDirectory, File destination) throws IOException {
        if (modId == null || !ID.matcher(modId).matches()) {
            throw new IOException("잘못된 WML 모드 ID");
        }
        String safeDirectory = safeEntryName(relativeDirectory);
        if (safeDirectory == null) throw new IOException("백엔드 경로가 안전하지 않습니다.");

        File archive = fileFor(modId);
        if (!archive.isFile() || archive.length() > MAX_ARCHIVE_BYTES) return false;
        File root = destination.getCanonicalFile();
        String rootPath = root.getPath() + File.separator;
        deleteTree(root);
        if (!root.mkdirs() && !root.isDirectory()) throw new IOException("앱 내부 백엔드 저장소를 만들지 못했습니다.");

        int copiedFiles = 0;
        int visited = 0;
        long totalBytes = 0;
        try (ZipFile zip = new ZipFile(archive)) {
            ModInfo info = inspect(zip);
            if (!modId.equals(info.id)) throw new IOException("ZIP 모드 ID가 일치하지 않습니다.");
            String prefix = info.prefix + safeDirectory + "/";
            Enumeration<? extends ZipEntry> entries = zip.entries();
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                String entryName = safeEntryName(entry.getName());
                if (entryName == null || !entryName.startsWith(prefix)) continue;
                String relative = entryName.substring(prefix.length());
                if (relative.isEmpty()) continue;
                if (++visited > 20000) throw new IOException("백엔드 파일 수가 20,000개 제한을 초과했습니다.");

                File output = new File(root, relative.replace('/', File.separatorChar)).getCanonicalFile();
                if (!output.getPath().startsWith(rootPath)) {
                    throw new IOException("ZIP 백엔드 경로가 저장소를 벗어납니다.");
                }
                if (entry.isDirectory()) {
                    if (!output.mkdirs() && !output.isDirectory()) throw new IOException("백엔드 폴더 생성 실패");
                    continue;
                }
                long declaredSize = entry.getSize();
                if (declaredSize > MAX_ENTRY_BYTES) throw new IOException("백엔드 파일이 256MB 제한을 초과했습니다.");
                File parent = output.getParentFile();
                if (parent != null && !parent.mkdirs() && !parent.isDirectory()) {
                    throw new IOException("백엔드 상위 폴더 생성 실패");
                }
                try (InputStream in = zip.getInputStream(entry);
                     java.io.FileOutputStream out = new java.io.FileOutputStream(output)) {
                    byte[] buffer = new byte[32768];
                    long fileBytes = 0;
                    int count;
                    while ((count = in.read(buffer)) >= 0) {
                        if (count == 0) continue;
                        fileBytes += count;
                        totalBytes += count;
                        if (fileBytes > MAX_ENTRY_BYTES || totalBytes > 512L * 1024L * 1024L) {
                            throw new IOException("백엔드 압축 해제 용량 제한을 초과했습니다.");
                        }
                        out.write(buffer, 0, count);
                    }
                    out.flush();
                }
                copiedFiles++;
            }
        } catch (IOException e) {
            deleteTree(root);
            throw e;
        }
        if (copiedFiles == 0) {
            deleteTree(root);
            return false;
        }
        return true;
    }

    private static void deleteTree(File file) {
        if (file == null || !file.exists()) return;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) for (File child : children) deleteTree(child);
        }
        file.delete();
    }

    static ModInfo inspect(File archive) throws IOException {
        if (archive == null || !archive.isFile()) throw new IOException("ZIP 파일을 찾을 수 없습니다.");
        if (archive.length() <= 0 || archive.length() > MAX_ARCHIVE_BYTES) {
            throw new IOException("ZIP 크기가 허용 범위를 벗어났습니다. (최대 512MB)");
        }
        try (ZipFile zip = new ZipFile(archive)) {
            return inspect(zip);
        }
    }

    private static ModInfo inspect(ZipFile zip) throws IOException {
        List<String> candidates = new ArrayList<>();
        Enumeration<? extends ZipEntry> entries = zip.entries();
        while (entries.hasMoreElements()) {
            ZipEntry entry = entries.nextElement();
            if (entry.isDirectory()) continue;
            String name = safeEntryName(entry.getName());
            if (name != null && (name.equals("mod.js") || name.endsWith("/mod.js"))) {
                candidates.add(name);
            }
        }
        if (candidates.isEmpty()) throw new IOException("ZIP 안에서 mod.js를 찾지 못했습니다.");
        Collections.sort(candidates, (a, b) -> {
            int depth = Integer.compare(a.split("/").length, b.split("/").length);
            return depth != 0 ? depth : Integer.compare(a.length(), b.length());
        });
        String selected = candidates.get(0);
        if (candidates.size() > 1
                && candidates.get(1).split("/").length == selected.split("/").length) {
            throw new IOException("ZIP 안에 같은 깊이의 mod.js가 여러 개 있어 모드를 구분할 수 없습니다.");
        }

        ZipEntry modJs = zip.getEntry(selected);
        if (modJs == null || modJs.getSize() > MAX_MOD_JS_BYTES) {
            throw new IOException("mod.js가 없거나 64KB를 초과합니다.");
        }
        byte[] bytes;
        try (InputStream in = zip.getInputStream(modJs)) {
            bytes = readLimited(in, MAX_MOD_JS_BYTES);
        }
        String source = new String(bytes, StandardCharsets.UTF_8);
        int defineAt = source.indexOf("WML.define");
        if (defineAt < 0) throw new IOException("mod.js에서 WML.define 등록 코드를 찾지 못했습니다.");
        Matcher matcher = MOD_ID.matcher(source.substring(defineAt));
        if (!matcher.find()) throw new IOException("mod.js에 유효한 WML 모드 ID가 없습니다.");
        String id = matcher.group(1);
        if (!ID.matcher(id).matches()) throw new IOException("허용되지 않는 모드 ID입니다.");

        String prefix = selected.equals("mod.js") ? "" : selected.substring(0, selected.length() - "mod.js".length());
        return new ModInfo(id, prefix);
    }

    private static byte[] readLimited(InputStream in, int limit) throws IOException {
        byte[] data = new byte[limit + 1];
        int used = 0;
        while (used < data.length) {
            int n = in.read(data, used, data.length - used);
            if (n < 0) break;
            if (n == 0) continue;
            used += n;
        }
        if (used > limit) throw new IOException("mod.js가 64KB를 초과합니다.");
        byte[] result = new byte[used];
        System.arraycopy(data, 0, result, 0, used);
        return result;
    }

    private static String safeEntryName(String name) {
        if (name == null || name.isEmpty() || name.startsWith("/") || name.indexOf('\\') >= 0
                || name.indexOf('\0') >= 0 || name.matches("^[A-Za-z]:.*")) return null;
        String value = name.endsWith("/") ? name.substring(0, name.length() - 1) : name;
        if (value.isEmpty()) return null;
        String[] segments = value.split("/", -1);
        for (String segment : segments) {
            if (segment.isEmpty() || segment.equals(".") || segment.equals("..")) return null;
        }
        return value;
    }
}
