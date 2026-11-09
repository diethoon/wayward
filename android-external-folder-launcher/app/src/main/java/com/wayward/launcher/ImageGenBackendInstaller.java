package com.wayward.launcher;

import android.content.Context;
import android.content.res.AssetManager;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.Iterator;

/** Installs the pinned Image Studio 0.8.4 server bundled inside the launcher APK. */
final class ImageGenBackendInstaller {
    static final String VERSION = "0.8.4";
    private static final String ASSET_ROOT = "imagegen-backend";
    private static final String SOURCE_ARCHIVE_SHA256 =
            "dfd25e050dd0b98ec1c99c09634bd92b509efac428788273f84884e713e2c553";
    private static final int MAX_FILES = 128;
    private static final long MAX_TOTAL_BYTES = 4L * 1024L * 1024L;
    private static final long MAX_FILE_BYTES = 2L * 1024L * 1024L;

    private ImageGenBackendInstaller() {}

    static File install(Context context, File destination) throws Exception {
        if (context == null || destination == null) throw new IllegalArgumentException("ImageGen 설치 경로가 없습니다.");
        File parent = destination.getAbsoluteFile().getParentFile();
        if (parent == null) throw new IllegalStateException("ImageGen 저장 경로가 올바르지 않습니다.");
        if (!parent.isDirectory() && !parent.mkdirs() && !parent.isDirectory()) {
            throw new IllegalStateException("ImageGen 앱 내부 저장 폴더를 만들지 못했습니다.");
        }

        if (isValidInstalled(destination)) return destination;

        File staging = new File(parent, destination.getName() + ".installing");
        File backup = new File(parent, destination.getName() + ".previous");
        deleteTree(staging);
        if (!staging.mkdirs()) throw new IllegalStateException("ImageGen 임시 설치 폴더를 만들지 못했습니다.");

        try {
            copyAssetTree(context.getAssets(), ASSET_ROOT, staging,
                    staging.getCanonicalFile(), new long[] {0}, new int[] {0});
            validateBundle(staging);
            deleteTree(backup);
            if (destination.exists() && !destination.renameTo(backup)) {
                throw new IllegalStateException("기존 ImageGen 백엔드를 안전하게 교체하지 못했습니다.");
            }
            if (!staging.renameTo(destination)) {
                if (backup.exists()) backup.renameTo(destination);
                throw new IllegalStateException("내장 ImageGen 백엔드를 설치 폴더로 이동하지 못했습니다.");
            }
            deleteTree(backup);
        } catch (Exception error) {
            deleteTree(staging);
            if (!destination.exists() && backup.exists()) backup.renameTo(destination);
            throw error;
        }

        if (!isValidInstalled(destination)) {
            deleteTree(destination);
            throw new SecurityException("설치한 ImageGen 백엔드 검증에 실패했습니다.");
        }
        return destination;
    }

    static boolean isValidInstalled(File root) {
        try {
            validateBundle(root);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private static void copyAssetTree(AssetManager assets, String assetPath, File output,
            File canonicalRoot, long[] total, int[] count) throws Exception {
        String rootPath = canonicalRoot.getPath() + File.separator;
        String[] children = assets.list(assetPath);
        if (children != null && children.length > 0) {
            if (!output.exists() && !output.mkdirs() && !output.isDirectory()) {
                throw new IllegalStateException("내장 ImageGen 폴더를 만들지 못했습니다.");
            }
            for (String child : children) {
                if (child == null || child.isEmpty() || child.equals(".") || child.equals("..")
                        || child.indexOf('/') >= 0 || child.indexOf('\\\\') >= 0) {
                    throw new SecurityException("내장 ImageGen 자산 경로가 올바르지 않습니다.");
                }
                File target = new File(output, child).getCanonicalFile();
                if (!target.getPath().startsWith(rootPath)) {
                    throw new SecurityException("ImageGen 자산 경로가 앱 저장소를 벗어납니다.");
                }
                copyAssetTree(assets, assetPath + "/" + child, target, canonicalRoot, total, count);
            }
            return;
        }

        if (++count[0] > MAX_FILES + 1) throw new IllegalStateException("ImageGen 파일 수 제한을 초과했습니다.");
        File parent = output.getParentFile();
        if (parent != null && !parent.mkdirs() && !parent.isDirectory()) {
            throw new IllegalStateException("내장 ImageGen 상위 폴더를 만들지 못했습니다.");
        }
        long fileBytes = 0;
        try (InputStream in = assets.open(assetPath);
             FileOutputStream out = new FileOutputStream(output)) {
            byte[] buffer = new byte[32768];
            int read;
            while ((read = in.read(buffer)) >= 0) {
                if (read == 0) continue;
                fileBytes += read;
                total[0] += read;
                if (fileBytes > MAX_FILE_BYTES || total[0] > MAX_TOTAL_BYTES + 65536L) {
                    throw new IllegalStateException("내장 ImageGen 자산 크기 제한을 초과했습니다.");
                }
                out.write(buffer, 0, read);
            }
            out.flush();
        }
    }

    private static void validateBundle(File root) throws Exception {
        if (root == null || !root.isDirectory()) throw new IllegalStateException("내장 ImageGen 서버 폴더가 없습니다.");
        File manifestFile = new File(root, "launcher-bundle.json");
        JSONObject manifest = new JSONObject(new String(readLimited(manifestFile, 65536), StandardCharsets.UTF_8));
        if (manifest.optInt("schemaVersion", 0) != 1
                || !SOURCE_ARCHIVE_SHA256.equals(manifest.optString("sourceArchiveSha256", ""))
                || !VERSION.equals(manifest.optString("backendVersion", ""))) {
            throw new SecurityException("내장 ImageGen 버전 또는 원본 해시가 일치하지 않습니다.");
        }
        JSONObject files = manifest.optJSONObject("files");
        if (files == null || files.length() < 1 || files.length() > MAX_FILES
                || manifest.optInt("fileCount", -1) != files.length()) {
            throw new SecurityException("내장 ImageGen 파일 목록이 손상되었습니다.");
        }

        long total = 0;
        Iterator<String> keys = files.keys();
        while (keys.hasNext()) {
            String relative = keys.next();
            if (relative.startsWith("/") || relative.indexOf('\\\\') >= 0
                    || relative.contains("../") || relative.equals("..")) {
                throw new SecurityException("ImageGen manifest 경로가 올바르지 않습니다.");
            }
            File file = new File(root, relative).getCanonicalFile();
            String rootPath = root.getCanonicalPath() + File.separator;
            if (!file.getPath().startsWith(rootPath) || !file.isFile() || file.length() > MAX_FILE_BYTES) {
                throw new SecurityException("ImageGen 파일이 없거나 크기가 올바르지 않습니다: " + relative);
            }
            total += file.length();
            if (!manifest.getString("files").equals("") && !sha256(file).equals(files.getString(relative))) {
                throw new SecurityException("내장 ImageGen 파일 해시가 일치하지 않습니다: " + relative);
            }
        }
        if (total != manifest.optLong("totalBytes", -1) || total > MAX_TOTAL_BYTES) {
            throw new SecurityException("내장 ImageGen 전체 크기가 일치하지 않습니다.");
        }
        File packageFile = new File(root, "wayward-imagegen/package.json");
        JSONObject pkg = new JSONObject(new String(readLimited(packageFile, 65536), StandardCharsets.UTF_8));
        if (!VERSION.equals(pkg.optString("version", ""))
                || !new File(root, "wayward-imagegen/src/cli.ts").isFile()
                || !new File(root, "wayward-imagegen/src/nai/client.ts").isFile()
                || !new File(root, "wayward-imagegen/src/server.ts").isFile()) {
            throw new SecurityException("ImageGen 실행 파일 구성이 올바르지 않습니다.");
        }
    }

    private static byte[] readLimited(File file, int limit) throws Exception {
        if (!file.isFile() || file.length() > limit) throw new IllegalStateException("ImageGen 검증 파일 크기가 올바르지 않습니다.");
        try (FileInputStream in = new FileInputStream(file);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int read;
            int total = 0;
            while ((read = in.read(buffer)) >= 0) {
                if (read == 0) continue;
                total += read;
                if (total > limit) throw new IllegalStateException("ImageGen 검증 파일 크기가 제한을 초과했습니다.");
                out.write(buffer, 0, read);
            }
            return out.toByteArray();
        }
    }

    private static String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(file)) {
            byte[] buffer = new byte[32768];
            int read;
            while ((read = in.read(buffer)) >= 0) {
                if (read > 0) digest.update(buffer, 0, read);
            }
        }
        StringBuilder out = new StringBuilder();
        for (byte value : digest.digest()) out.append(String.format(java.util.Locale.ROOT, "%02x", value & 0xff));
        return out.toString();
    }

    private static void deleteTree(File file) {
        if (file == null || !file.exists()) return;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) for (File child : children) deleteTree(child);
        }
        file.delete();
    }
}
