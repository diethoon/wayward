package com.wayward.launcher;

import android.app.Application;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

/** Best-effort uploader; failed uploads remain in the local journal for a later retry. */
final class DiagnosticsUploader {
    private static final String BASE_URL = "https://wayward-launcher-diagnostics-hoon-ead4.vercel.app";
    private static final ExecutorService WORKER = Executors.newSingleThreadExecutor();
    private static final AtomicBoolean BUSY = new AtomicBoolean(false);
    private DiagnosticsUploader() {}

    static void verifyAndSave(Context context, String token, Consumer<Boolean> callback) {
        final Context app = context.getApplicationContext();
        WORKER.execute(() -> {
            boolean ok = post("/api/v1/ping", token, new JSONObject());
            if (ok) {
                try { DiagnosticsTokenStore.save(app, token); }
                catch (Exception error) { ok = false; }
            }
            final boolean result = ok;
            new Handler(Looper.getMainLooper()).post(() -> callback.accept(result));
        });
    }

    static void uploadPending(Context context) {
        final Context app = context.getApplicationContext();
        if (!app.getPackageName().equals(Application.getProcessName())) return;
        final String token = DiagnosticsTokenStore.get(app);
        if (token.isEmpty() || !BUSY.compareAndSet(false, true)) return;
        WORKER.execute(() -> {
            try {
                for (int pass = 0; pass < 6; pass++) {
                    JSONArray events = DiagnosticsLogger.readPending(app, 8);
                    if (events.length() == 0) break;
                    JSONObject payload = new JSONObject();
                    payload.put("events", events);
                    if (!post("/api/v1/ingest", token, payload)) break;
                    Set<String> ids = new HashSet<>();
                    for (int i = 0; i < events.length(); i++) {
                        JSONObject event = events.optJSONObject(i);
                        if (event != null) ids.add(event.optString("id"));
                    }
                    DiagnosticsLogger.acknowledge(app, ids);
                }
            } catch (Exception ignored) {
                // Retain the journal and retry on the next activity/process resume.
            } finally {
                BUSY.set(false);
            }
        });
    }

    private static boolean post(String path, String token, JSONObject body) {
        HttpURLConnection connection = null;
        try {
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            if (bytes.length > 56 * 1024) return false;
            connection = (HttpURLConnection) new URL(BASE_URL + path).openConnection();
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(20000);
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setUseCaches(false);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("Authorization", "Bearer " + token);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(bytes);
                out.flush();
            }
            int status = connection.getResponseCode();
            return status >= 200 && status < 300;
        } catch (Exception ignored) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }
}
