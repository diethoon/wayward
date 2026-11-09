package com.wayward.launcher;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.channels.OverlappingFileLockException;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Best-effort, write-only diagnostics uploader.
 * The server accepts a bounded, normalized, rate-limited event schema; no user-entered token is required.
 */
final class DiagnosticsUploader {
    private static final String BASE_URL = "https://wayward-launcher-diagnostics-hoon-ead4.vercel.app";
    private static final ExecutorService WORKER = Executors.newSingleThreadExecutor();
    private static final AtomicBoolean BUSY = new AtomicBoolean(false);
    private DiagnosticsUploader() {}

    static void uploadPending(Context context) {
        final Context app = context.getApplicationContext();
        if (!BUSY.compareAndSet(false, true)) return;
        WORKER.execute(() -> {
            try (UploadLock lock = tryAcquireUploadLock(app)) {
                // The journal is shared by the launcher and :imagegen processes. A file lock
                // prevents duplicate uploads while allowing either process to flush errors.
                if (lock == null) return;
                for (int pass = 0; pass < 6; pass++) {
                    JSONArray events = DiagnosticsLogger.readPending(app, 8);
                    if (events.length() == 0) break;
                    JSONObject payload = new JSONObject();
                    payload.put("events", events);
                    if (!post("/api/v1/ingest", payload)) break;
                    Set<String> ids = new HashSet<>();
                    for (int i = 0; i < events.length(); i++) {
                        JSONObject event = events.optJSONObject(i);
                        if (event != null) ids.add(event.optString("id"));
                    }
                    DiagnosticsLogger.acknowledge(app, ids);
                }
            } catch (Exception ignored) {
                // Keep unacknowledged events locally for the next process event or activity resume.
            } finally {
                BUSY.set(false);
            }
        });
    }

    private static UploadLock tryAcquireUploadLock(Context app) throws Exception {
        File directory = new File(app.getFilesDir(), "diagnostics");
        if (!directory.exists() && !directory.mkdirs()) {
            throw new IllegalStateException("diagnostics directory unavailable");
        }
        RandomAccessFile file = new RandomAccessFile(new File(directory, "uploader.lock"), "rw");
        FileChannel channel = file.getChannel();
        try {
            FileLock lock = channel.tryLock();
            if (lock == null) {
                channel.close();
                return null;
            }
            return new UploadLock(channel, lock);
        } catch (OverlappingFileLockException busy) {
            channel.close();
            return null;
        } catch (Exception error) {
            channel.close();
            throw error;
        }
    }

    private static final class UploadLock implements AutoCloseable {
        private final FileChannel channel;
        private final FileLock lock;

        UploadLock(FileChannel channel, FileLock lock) {
            this.channel = channel;
            this.lock = lock;
        }

        @Override public void close() throws java.io.IOException {
            try {
                if (lock.isValid()) lock.release();
            } finally {
                channel.close();
            }
        }
    }

    private static boolean post(String path, JSONObject body) {
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
