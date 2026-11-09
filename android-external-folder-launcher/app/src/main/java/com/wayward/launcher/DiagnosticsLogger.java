package com.wayward.launcher;

import android.app.Application;
import android.content.Context;
import android.os.Build;
import android.os.Process;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.io.RandomAccessFile;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/** Bounded, redacted NDJSON journal shared by the main and :imagegen processes. */
final class DiagnosticsLogger {
    private static final long MAX_FILE_BYTES = 512L * 1024L;
    private static final String ACTIVE = "launcher.ndjson";
    private static final String PREVIOUS = "launcher.previous.ndjson";
    private static final Object LOCK = new Object();
    private static final Pattern BEARER = Pattern.compile("(?i)(Bearer\\s+)[A-Za-z0-9._~+/-]+=*");
    private static final Pattern SECRET = Pattern.compile("(?i)((?:access|refresh)?_?(?:token|api[_-]?key|secret|password|cookie)\\s*[:=]\\s*[\\\"']?)[^\\s,;\\\"'}&]+");
    private static final Pattern QUERY_SECRET = Pattern.compile("(?i)([?&](?:token|key|secret|password)=)[^&\\s]+");

    private DiagnosticsLogger() {}

    static void event(Context context, String level, String component, String name, JSONObject details) {
        if (context == null) return;
        Context app = context.getApplicationContext();
        try {
            JSONObject event = new JSONObject();
            event.put("id", UUID.randomUUID().toString());
            event.put("timestamp", System.currentTimeMillis());
            event.put("level", clean(level, 12));
            event.put("component", clean(component, 48));
            event.put("event", clean(name, 80));
            event.put("deviceId", deviceId(app));
            event.put("appVersion", appVersion(app));
            event.put("sdk", Build.VERSION.SDK_INT);
            event.put("model", clean(Build.MANUFACTURER + " " + Build.MODEL, 80));
            event.put("process", clean(Application.getProcessName(), 80));
            event.put("pid", Process.myPid());
            String safeDetails = details == null ? "" : redact(details.toString());
            event.put("details", safeDetails.substring(0, Math.min(4200, safeDetails.length())));
            boolean urgent = "ERROR".equalsIgnoreCase(level) || "WARN".equalsIgnoreCase(level);
            append(app, redact(event.toString()) + "\n", urgent);
            if (urgent) {
                DiagnosticsUploader.uploadPending(app);
            }
        } catch (Throwable ignored) {
            // Diagnostics must never crash or block the launcher.
        }
    }

    static void error(Context context, String component, String name, Throwable error) {
        JSONObject details = new JSONObject();
        try {
            details.put("exception", error == null ? "Unknown" : error.getClass().getName());
            if (error != null) {
                java.io.StringWriter buffer = new java.io.StringWriter();
                error.printStackTrace(new java.io.PrintWriter(buffer));
                String stack = redact(buffer.toString());
                details.put("stack", stack.substring(0, Math.min(3600, stack.length())));
            }
        } catch (Exception ignored) {}
        event(context, "ERROR", component, name, details);
    }

    static String deviceId(Context context) {
        final String[] value = new String[1];
        try {
            synchronized (LOCK) {
                withFileLock(context, () -> {
                File file = new File(new File(context.getFilesDir(), "diagnostics"), "device.id");
                if (file.isFile()) {
                    try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                            new FileInputStream(file), StandardCharsets.UTF_8))) {
                        String existing = reader.readLine();
                        if (existing != null && existing.matches("[0-9a-fA-F-]{36}")) {
                            value[0] = existing;
                            return;
                        }
                    }
                }
                value[0] = UUID.randomUUID().toString();
                try (FileOutputStream out = new FileOutputStream(file, false)) {
                    out.write(value[0].getBytes(StandardCharsets.UTF_8));
                    out.flush();
                    out.getFD().sync();
                }
                });
            }
        } catch (Exception ignored) {
            value[0] = UUID.randomUUID().toString();
        }
        return value[0];
    }

    static JSONArray readPending(Context context, int maxEvents) throws Exception {
        final JSONArray result = new JSONArray();
        synchronized (LOCK) {
            withFileLock(context, () -> {
                readFile(context, PREVIOUS, result, maxEvents);
                readFile(context, ACTIVE, result, maxEvents);
            });
        }
        return result;
    }

    static String exportText(Context context) {
        Context app = context == null ? null : context.getApplicationContext();
        if (app == null) return "Wayward Launcher 진단 정보를 읽을 수 없습니다.";
        StringBuilder report = new StringBuilder(48 * 1024);
        report.append("Wayward Launcher diagnostics\n")
                .append("appVersion=").append(appVersion(app))
                .append(" sdk=").append(Build.VERSION.SDK_INT).append('\n');
        try {
            JSONArray events = readPending(app, 16);
            report.append("\n[Pending structured diagnostics]\n");
            report.append(events.length() == 0 ? "(no pending events)\n" : redact(events.toString()) + "\n");
        } catch (Exception error) {
            report.append("\n[Pending structured diagnostics unavailable]\n")
                    .append(redact(error.toString())).append('\n');
        }
        File imageGen = new File(app.getFilesDir(), "imagegen");
        appendLogTail(report, new File(imageGen, "startup.log"), 32 * 1024, "ImageGen startup.log");
        appendLogTail(report, new File(imageGen, "bun-version.log"), 4 * 1024, "Bun version probe");
        appendFilteredLogTail(report, new File(imageGen, "install.log"), 8 * 1024,
                "ImageGen dependency install.log", true);
        appendFilteredLogTail(report, new File(imageGen, "server.log"), 8 * 1024,
                "ImageGen server.log (filtered)", false);
        report.append("\n[Privacy] server/install logs are limited to diagnostic lines; prompt, request/body, authorization, cookie and image payload lines are omitted.\n");
        return report.toString();
    }

    private static void appendFilteredLogTail(StringBuilder report, File file, int maxBytes,
                                               String title, boolean installLog) {
        report.append("\n[").append(title).append("]\n");
        if (file == null || !file.isFile()) {
            report.append("(not present)\n");
            return;
        }
        try (RandomAccessFile input = new RandomAccessFile(file, "r")) {
            long length = input.length();
            long offset = Math.max(0L, length - maxBytes);
            report.append("[file bytes=").append(length)
                    .append(", tail offset=").append(offset).append("]\\n");
            int count = (int) Math.min(length - offset, maxBytes);
            byte[] bytes = new byte[count];
            input.seek(offset);
            input.readFully(bytes);
            String raw = new String(bytes, StandardCharsets.UTF_8);
            StringBuilder selected = new StringBuilder();
            String[] lines = raw.split("\\r?\\n");
            int included = 0;
            for (int i = Math.max(0, lines.length - 160); i < lines.length; i++) {
                String line = lines[i];
                if (line.isEmpty()) continue;
                String lower = line.toLowerCase(java.util.Locale.ROOT);
                // Never export lines that can carry generated prompts, request bodies or credentials.
                if (lower.matches(".*(prompt|authorization|cookie|request[_ -]?body|response[_ -]?body|data:image|base64|bearer\\s|api[_-]?key|access[_-]?token).*")) {
                    continue;
                }
                boolean stackFrame = line.matches("^\\\\s*at\\\\s+.*")
                        || line.matches("^\\\\s*\\\\d+\\\\s*\\\\|.*");
                boolean runtimeDiagnostic = lower.matches(".*(error|exception|fatal|panic|eaddrinuse|address already in use|cannot find|failed|failure|err_[a-z0-9_]+|warn|stack trace|segmentation fault|sig(abrt|segv|bus)|killed|module not found|unsupported|permission denied|bun:).*");
                boolean diagnostic = stackFrame || runtimeDiagnostic;
                boolean installProgress = installLog && lower.matches(".*(bun install|resolved [0-9]+|installed [0-9]+|downloaded [0-9]+|saved lockfile|packages? installed|fetching|extracting|cache).*");
                if (!diagnostic && !installProgress) continue;
                String safe = redact(line);
                if (selected.length() + safe.length() + 1 > maxBytes) break;
                selected.append(safe).append('\n');
                included++;
            }
            if (offset > 0) report.append("[older content truncated]\n");
            if (included == 0) report.append("(no safe diagnostic lines found)\n");
            else report.append(selected);
            report.append("[filtered lines=").append(included).append("]\n");
        } catch (Exception error) {
            report.append("[read failed] ").append(redact(error.toString())).append('\n');
        }
    }

    private static void appendLogTail(StringBuilder report, File file, int maxBytes, String title) {
        report.append("\n[").append(title).append("]\n");
        if (file == null || !file.isFile()) {
            report.append("(not present)\n");
            return;
        }
        try (RandomAccessFile input = new RandomAccessFile(file, "r")) {
            long length = input.length();
            long offset = Math.max(0L, length - maxBytes);
            int count = (int) Math.min(length - offset, maxBytes);
            byte[] bytes = new byte[count];
            input.seek(offset);
            input.readFully(bytes);
            String content = new String(bytes, StandardCharsets.UTF_8);
            if (offset > 0) {
                int newline = content.indexOf('\n');
                content = newline >= 0 ? content.substring(newline + 1) : "";
                report.append("[older content truncated]\n");
            }
            report.append(redact(content));
            if (!content.endsWith("\n")) report.append('\n');
        } catch (Exception error) {
            report.append("[read failed] ").append(redact(error.toString())).append('\n');
        }
    }

    static void acknowledge(Context context, Set<String> uploadedIds) throws Exception {
        if (uploadedIds == null || uploadedIds.isEmpty()) return;
        synchronized (LOCK) {
            withFileLock(context, () -> {
                rewriteWithout(context, PREVIOUS, uploadedIds);
                rewriteWithout(context, ACTIVE, uploadedIds);
            });
        }
    }

    private static void readFile(Context context, String name, JSONArray result, int max) throws Exception {
        File file = new File(new File(context.getFilesDir(), "diagnostics"), name);
        if (!file.isFile() || result.length() >= max) return;
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                new FileInputStream(file), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null && result.length() < max) {
                try { result.put(new JSONObject(line)); } catch (Exception ignored) {}
            }
        }
    }

    private static void rewriteWithout(Context context, String name, Set<String> ids) throws Exception {
        File dir = new File(context.getFilesDir(), "diagnostics");
        File file = new File(dir, name);
        if (!file.isFile()) return;
        File temp = new File(dir, name + ".tmp");
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                     new FileInputStream(file), StandardCharsets.UTF_8));
             FileOutputStream out = new FileOutputStream(temp, false)) {
            String line;
            while ((line = reader.readLine()) != null) {
                boolean remove = false;
                try { remove = ids.contains(new JSONObject(line).optString("id")); } catch (Exception ignored) {}
                if (!remove) out.write((line + "\n").getBytes(StandardCharsets.UTF_8));
            }
            out.flush();
            out.getFD().sync();
        }
        Files.move(temp.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING);
    }

    private interface LockedAction { void run() throws Exception; }

    private static void withFileLock(Context context, LockedAction action) throws Exception {
        File dir = new File(context.getFilesDir(), "diagnostics");
        if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("diagnostics directory unavailable");
        File lockFile = new File(dir, "journal.lock");
        try (RandomAccessFile raf = new RandomAccessFile(lockFile, "rw");
             FileChannel channel = raf.getChannel();
             FileLock ignored = channel.lock()) {
            action.run();
        }
    }

    private static void append(Context context, String line, boolean durable) throws Exception {
        byte[] bytes = line.getBytes(StandardCharsets.UTF_8);
        synchronized (LOCK) {
            withFileLock(context, () -> {
                File dir = new File(context.getFilesDir(), "diagnostics");
                File active = new File(dir, ACTIVE);
                File previous = new File(dir, PREVIOUS);
                if (active.isFile() && active.length() + bytes.length > MAX_FILE_BYTES) {
                    if (previous.exists()) previous.delete();
                    if (active.exists()) Files.move(active.toPath(), previous.toPath(), StandardCopyOption.REPLACE_EXISTING);
                }
                try (FileOutputStream out = new FileOutputStream(active, true)) {
                    out.write(bytes);
                    out.flush();
                    if (durable) out.getFD().sync();
                }
            });
        }
    }

    private static String appVersion(Context context) {
        try { return context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName; }
        catch (Exception ignored) { return "unknown"; }
    }

    private static String clean(String value, int max) {
        if (value == null) return "";
        String out = value.replace('\n', ' ').replace('\r', ' ').trim();
        return out.length() > max ? out.substring(0, max) : out;
    }

    private static String redact(String value) {
        if (value == null) return "";
        String out = BEARER.matcher(value).replaceAll("$1[REDACTED]");
        out = SECRET.matcher(out).replaceAll("$1[REDACTED]");
        out = QUERY_SECRET.matcher(out).replaceAll("$1[REDACTED]");
        return out.length() > 12000 ? out.substring(0, 12000) : out;
    }
}
