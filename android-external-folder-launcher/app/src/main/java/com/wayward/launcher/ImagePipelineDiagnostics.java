package com.wayward.launcher;

import android.content.Context;

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
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Pattern;

/** Local-only, bounded image-pipeline journal. Never uploaded with general diagnostics. */
final class ImagePipelineDiagnostics {
    private static final String ACTIVE = "image-pipeline.ndjson";
    private static final String PREVIOUS = "image-pipeline.previous.ndjson";
    private static final long MAX_BYTES = 256L * 1024L;
    private static final int MAX_LINE = 4096;
    private static final Object LOCK = new Object();
    private static final Pattern EVENT = Pattern.compile("[a-z0-9_]{1,64}");
    private static final Set<String> ALLOWED_EVENTS = new HashSet<>(Arrays.asList(
            "capture_started", "log_cleared", "js_bridge_unavailable", "image_element_watch_installed",
            "js_bridge_installed", "img_element_error", "img_element_loaded", "resolver_received",
            "resolver_orphaned", "game_generate_rejected", "game_generate_resolved",
            "data_url_probe_loaded", "data_url_probe_failed", "data_url_probe_setup_failed",
            "data_url_probe_skipped", "resolver_payload_parse_failed", "provider_list_failed",
            "game_generate_requested", "game_generate_timeout", "game_generate_dispatched",
            "game_generate_dispatch_failed", "native_request_rejected", "native_request_received",
            "native_worker_started", "provider_selection_failed", "provider_selected",
            "provider_permission_denied", "native_image_received", "native_data_url_built",
            "native_generation_succeeded", "native_generation_failed", "native_queue_rejected",
            "native_webview_delivery_started", "native_delivery_failed", "native_delivery_queued",
            "native_js_evaluate_callback", "native_js_resolver_invoked", "native_js_resolver_missing",
            "native_webview_evaluate_failed", "provider_http_response",
            "provider_http_error", "provider_http_request_failed", "webview_image_http_error",
            "webview_image_resource_error", "webview_image_resource_slow"
    ));
    private static final Set<String> ALLOWED = new HashSet<>(Arrays.asList(
            "requestId", "providerId", "providerType", "mimeType", "imageBytes",
            "imageWidth", "imageHeight", "imageFormat", "promptLength",
            "requestedWidth", "requestedHeight", "elapsedMs", "fallbackUsed",
            "responseStatus", "responseContentType", "responseBytes", "dataUrlLength", "providerType",
            "deliveryQueued", "webViewUrlPresent", "srcKind", "srcLength",
            "naturalWidth", "naturalHeight", "complete", "reasonCode", "errorType",
            "queueDepth", "hasProvider", "mimeDetected", "stage", "success",
            "elementTag", "pagePath", "pendingCount"
    ));

    private ImagePipelineDiagnostics() {}

    static void record(Context context, String event, JSONObject details) {
        if (context == null || event == null || !EVENT.matcher(event).matches() || !ALLOWED_EVENTS.contains(event)) return;
        try {
            JSONObject line = new JSONObject();
            line.put("timestamp", System.currentTimeMillis());
            line.put("event", event);
            line.put("details", safeDetails(details));
            byte[] bytes = (line.toString() + "\n").getBytes(StandardCharsets.UTF_8);
            if (bytes.length > MAX_LINE) return;
            synchronized (LOCK) {
                withLock(context, () -> append(context, bytes));
            }
        } catch (Throwable ignored) {
            // Diagnostics must never interrupt image generation or gameplay.
        }
    }

    static void recordJson(Context context, String event, String detailsJson) {
        if (detailsJson == null || detailsJson.length() > 2048) {
            record(context, event, new JSONObject());
            return;
        }
        try { record(context, event, new JSONObject(detailsJson)); }
        catch (Exception ignored) { record(context, event, new JSONObject()); }
    }

    private static JSONObject safeDetails(JSONObject input) throws Exception {
        JSONObject safe = new JSONObject();
        if (input == null) return safe;
        java.util.Iterator<String> keys = input.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            if (!ALLOWED.contains(key)) continue;
            Object value = input.opt(key);
            if (value == null || value == JSONObject.NULL) continue;
            if (value instanceof Boolean || value instanceof Integer || value instanceof Long
                    || value instanceof Double) {
                safe.put(key, value);
            } else if (value instanceof String) {
                String text = (String) value;
                if (text.length() <= 120 && !text.contains("://")
                        && !text.toLowerCase(java.util.Locale.ROOT).contains("bearer ")
                        && !text.toLowerCase(java.util.Locale.ROOT).contains("token")) {
                    safe.put(key, text);
                }
            }
        }
        return safe;
    }

    private interface LockedAction { void run() throws Exception; }

    private static void withLock(Context context, LockedAction action) throws Exception {
        File directory = directory(context);
        if (!directory.isDirectory() && !directory.mkdirs() && !directory.isDirectory()) {
            throw new IllegalStateException("진단 로그 폴더를 만들지 못했습니다.");
        }
        File lockFile = new File(directory, "image-pipeline.lock");
        try (RandomAccessFile raf = new RandomAccessFile(lockFile, "rw");
             FileChannel channel = raf.getChannel();
             FileLock ignored = channel.lock()) {
            action.run();
        }
    }

    private static File directory(Context context) {
        return new File(context.getFilesDir(), "diagnostics");
    }

    private static void append(Context context, byte[] bytes) throws Exception {
        File directory = directory(context);
        File active = new File(directory, ACTIVE);
        File previous = new File(directory, PREVIOUS);
        if (active.isFile() && active.length() + bytes.length > MAX_BYTES) {
            if (previous.exists()) previous.delete();
            Files.move(active.toPath(), previous.toPath(), StandardCopyOption.REPLACE_EXISTING);
        }
        try (FileOutputStream out = new FileOutputStream(active, true)) {
            out.write(bytes);
            out.flush();
        }
    }

    static JSONArray readRecent(Context context, int requestedLimit) throws Exception {
        int limit = Math.max(1, Math.min(200, requestedLimit));
        JSONArray all = new JSONArray();
        synchronized (LOCK) {
            withLock(context, () -> {
                readFile(new File(directory(context), PREVIOUS), all);
                readFile(new File(directory(context), ACTIVE), all);
            });
        }
        JSONArray recent = new JSONArray();
        int start = Math.max(0, all.length() - limit);
        for (int i = start; i < all.length(); i++) recent.put(all.getJSONObject(i));
        return recent;
    }

    private static void readFile(File file, JSONArray output) throws Exception {
        if (!file.isFile()) return;
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                new FileInputStream(file), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                try {
                    JSONObject item = new JSONObject(line);
                    if (item.has("timestamp") && item.has("event")) output.put(item);
                } catch (Exception ignored) {}
            }
        }
    }

    static void clear(Context context) throws Exception {
        synchronized (LOCK) {
            withLock(context, () -> {
                File dir = directory(context);
                File active = new File(dir, ACTIVE);
                File previous = new File(dir, PREVIOUS);
                if (active.exists() && !active.delete()) throw new IllegalStateException("진단 로그를 초기화하지 못했습니다.");
                if (previous.exists() && !previous.delete()) throw new IllegalStateException("이전 진단 로그를 초기화하지 못했습니다.");
            });
        }
    }
}
