package com.wayward.launcher;

import android.app.Application;
import android.content.Context;
import android.content.SharedPreferences;
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
    private static final String PREFS = "wayward_launcher_diagnostics";
    private static final String DEVICE_ID = "device_id";
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
            event.put("details", details == null ? "" : redact(details.toString()));
            append(app, redact(event.toString()) + "\n");
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
                details.put("stack", redact(buffer.toString()));
            }
        } catch (Exception ignored) {}
        event(context, "ERROR", component, name, details);
    }

    static String deviceId(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String current = prefs.getString(DEVICE_ID, "");
        if (current != null && current.matches("[0-9a-fA-F-]{36}")) return current;
        String created = UUID.randomUUID().toString();
        prefs.edit().putString(DEVICE_ID, created).apply();
        return created;
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

    private static void append(Context context, String line) throws Exception {
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
                    out.getFD().sync();
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
