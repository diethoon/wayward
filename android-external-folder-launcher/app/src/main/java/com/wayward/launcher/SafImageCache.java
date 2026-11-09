package com.wayward.launcher;

import android.content.ContentResolver;
import android.content.Context;
import android.net.Uri;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Comparator;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * Bounded app-private cache for SAF-backed image assets.
 * The first request is streamed to WebView while a private cache copy is built.
 */
final class SafImageCache {
    private static final long MAX_CACHE_BYTES = 128L * 1024L * 1024L;
    private static final long MAX_SINGLE_IMAGE_BYTES = 32L * 1024L * 1024L;
    private static final long SHARED_LOAD_TIMEOUT_SECONDS = 60L;
    private final Context context;
    private final File directory;
    private final Object pruneLock = new Object();
    private final ConcurrentHashMap<String, CacheLoad> inFlight = new ConcurrentHashMap<>();

    SafImageCache(Context context) {
        this.context = context.getApplicationContext();
        directory = new File(context.getCacheDir(), "wayward-saf-images");
        cleanupStaleParts();
    }

    private void cleanupStaleParts() {
        File[] parts = directory.listFiles((parent, name) -> name.endsWith(".part"));
        if (parts == null) return;
        long cutoff = System.currentTimeMillis() - 6L * 60L * 60L * 1000L;
        for (File part : parts) {
            if (part.lastModified() < cutoff) part.delete();
        }
    }

    OpenResult open(ContentResolver resolver, Uri documentUri, String documentId,
                    long expectedSize, long lastModified) throws Exception {
        if (resolver == null || documentUri == null) return new OpenResult(null, "missing", 0L, 0L, 0L);
        if (documentId == null || documentId.isEmpty() || expectedSize <= 0L
                || expectedSize > MAX_SINGLE_IMAGE_BYTES || lastModified <= 0L) {
            return openDirect(resolver, documentUri, "bypass");
        }

        String key = digest(documentUri.toString() + "\n" + documentId + "\n"
                + expectedSize + "\n" + lastModified);
        File target = new File(directory, key + ".img");
        OpenResult cached = openCached(target, expectedSize);
        if (cached != null) return cached;

        CacheLoad candidate = new CacheLoad(key, target, expectedSize);
        CacheLoad active = inFlight.putIfAbsent(key, candidate);
        if (active != null) {
            long waitStarted = System.nanoTime();
            try {
                File ready = active.completed.get(SHARED_LOAD_TIMEOUT_SECONDS, TimeUnit.SECONDS);
                long waitMs = (System.nanoTime() - waitStarted) / 1_000_000L;
                if (ready != null && ready.isFile() && ready.length() == expectedSize) {
                    long cacheOpenStarted = System.nanoTime();
                    InputStream stream = new FileInputStream(ready);
                    long cacheOpenMs = (System.nanoTime() - cacheOpenStarted) / 1_000_000L;
                    ready.setLastModified(System.currentTimeMillis());
                    return new OpenResult(stream, "shared", 0L, waitMs, cacheOpenMs);
                }
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                return openDirect(resolver, documentUri, "fallback");
            } catch (ExecutionException | TimeoutException | IOException error) {
                return openDirect(resolver, documentUri, "fallback");
            }
            return openDirect(resolver, documentUri, "fallback");
        }

        long openStarted = System.nanoTime();
        InputStream source;
        try {
            source = resolver.openInputStream(documentUri);
        } catch (Exception error) {
            candidate.fail();
            throw error;
        }
        long openMs = (System.nanoTime() - openStarted) / 1_000_000L;
        if (source == null) {
            candidate.fail();
            return new OpenResult(null, "missing", openMs, 0L, 0L);
        }
        if (!candidate.begin()) {
            return new OpenResult(source, "fallback", openMs, 0L, 0L);
        }
        return new OpenResult(new TeeInputStream(source, candidate), "loading",
                openMs, 0L, 0L);
    }

    private OpenResult openDirect(ContentResolver resolver, Uri documentUri, String state) throws Exception {
        long started = System.nanoTime();
        InputStream stream = resolver.openInputStream(documentUri);
        long openMs = (System.nanoTime() - started) / 1_000_000L;
        return new OpenResult(stream, state, openMs, 0L, 0L, 0L);
    }

    private OpenResult openCached(File target, long expectedSize) {
        if (!target.isFile() || target.length() != expectedSize) {
            if (target.exists()) target.delete();
            return null;
        }
        long started = System.nanoTime();
        try {
            InputStream input = new FileInputStream(target);
            long openMs = (System.nanoTime() - started) / 1_000_000L;
            target.setLastModified(System.currentTimeMillis());
            return new OpenResult(input, "hit", 0L, 0L, openMs);
        } catch (IOException error) {
            target.delete();
            return null;
        }
    }

    private void trimCache(File preserve) {
        synchronized (pruneLock) {
            File[] files = directory.listFiles((parent, name) -> name.endsWith(".img"));
            if (files == null || files.length == 0) return;
            long total = 0L;
            for (File file : files) total += file.length();
            if (total <= MAX_CACHE_BYTES) return;
            Arrays.sort(files, Comparator.comparingLong(File::lastModified));
            for (File file : files) {
                if (total <= MAX_CACHE_BYTES) break;
                if (file.equals(preserve)) continue;
                long length = file.length();
                if (file.delete()) total -= length;
            }
        }
    }

    private void recordCacheCompleted(long sourceReadMs, long cacheWriteMs, long copiedBytes, boolean success) {
        try {
            org.json.JSONObject details = new org.json.JSONObject();
            details.put("sourceReadMs", sourceReadMs);
            details.put("cacheWriteMs", cacheWriteMs);
            details.put("imageSizeBytes", copiedBytes);
            details.put("cacheState", success ? "cached" : "failed");
            ImagePipelineDiagnostics.record(context, "saf_image_cache_completed", details);
        } catch (Exception ignored) {
            // Diagnostics must never affect an image stream.
        }
    }

    private static String digest(String value) throws Exception {
        byte[] bytes = MessageDigest.getInstance("SHA-256")
                .digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte item : bytes) result.append(String.format(java.util.Locale.ROOT, "%02x", item & 0xff));
        return result.toString();
    }

    private final class CacheLoad {
        final String key;
        final File target;
        final File part;
        final long expectedSize;
        final CompletableFuture<File> completed = new CompletableFuture<>();
        FileOutputStream output;
        long copiedBytes;
        long sourceReadNanos;
        long cacheWriteNanos;
        boolean active = true;
        boolean finished;

        CacheLoad(String cacheKey, File cacheTarget, long size) {
            key = cacheKey;
            target = cacheTarget;
            expectedSize = size;
            part = new File(directory, cacheTarget.getName() + "."
                    + Thread.currentThread().getId() + "." + System.nanoTime() + ".part");
        }

        synchronized boolean begin() {
            try {
                if (!directory.isDirectory() && !directory.mkdirs() && !directory.isDirectory()) {
                    throw new IOException("Unable to create private image cache directory");
                }
                output = new FileOutputStream(part);
                return true;
            } catch (IOException error) {
                failLocked();
                return false;
            }
        }

        synchronized void append(byte[] bytes, int offset, int length) {
            if (!active || finished || length <= 0) return;
            if (copiedBytes + length > expectedSize || copiedBytes + length > MAX_SINGLE_IMAGE_BYTES) {
                failLocked();
                return;
            }
            long writeStarted = System.nanoTime();
            try {
                output.write(bytes, offset, length);
                copiedBytes += length;
            } catch (IOException error) {
                failLocked();
            } finally {
                cacheWriteNanos += Math.max(0L, System.nanoTime() - writeStarted);
            }
        }

        synchronized void recordSourceReadDuration(long nanos) {
            if (active && !finished) sourceReadNanos += Math.max(0L, nanos);
        }

        synchronized void finish() {
            if (finished) return;
            finished = true;
            if (!active) return;
            try {
                output.flush();
                output.getFD().sync();
                output.close();
                output = null;
                if (copiedBytes != expectedSize) {
                    throw new IOException("SAF image size did not match document metadata");
                }
                if (!part.renameTo(target)) {
                    if (target.exists() && !target.delete()) {
                        throw new IOException("Unable to replace stale image cache file");
                    }
                    if (!part.renameTo(target)) {
                        throw new IOException("Unable to publish image cache file");
                    }
                }
                target.setLastModified(System.currentTimeMillis());
                trimCache(target);
                active = false;
                completed.complete(target);
                inFlight.remove(key, this);
                recordCacheCompleted(sourceReadNanos / 1_000_000L, cacheWriteNanos / 1_000_000L, copiedBytes, true);
            } catch (Exception error) {
                failLocked();
            }
        }

        synchronized void fail() {
            if (finished) return;
            finished = true;
            failLocked();
        }

        private void failLocked() {
            active = false;
            if (output != null) {
                try { output.close(); } catch (IOException ignored) {}
                output = null;
            }
            if (part.exists()) part.delete();
            completed.completeExceptionally(new IOException("SAF image cache fill failed"));
            inFlight.remove(key, this);
            recordCacheCompleted(sourceReadNanos / 1_000_000L, cacheWriteNanos / 1_000_000L, copiedBytes, false);
            finished = true;
        }
    }

    private static final class TeeInputStream extends FilterInputStream {
        private final CacheLoad load;
        private boolean closed;

        TeeInputStream(InputStream source, CacheLoad cacheLoad) {
            super(source);
            load = cacheLoad;
        }

        @Override
        public int read() throws IOException {
            int value;
            long started = System.nanoTime();
            try {
                value = in.read();
            } catch (IOException error) {
                load.recordSourceReadDuration(System.nanoTime() - started);
                load.fail();
                throw error;
            }
            load.recordSourceReadDuration(System.nanoTime() - started);
            if (value >= 0) {
                byte[] one = {(byte) value};
                load.append(one, 0, 1);
            } else {
                load.finish();
            }
            return value;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            if (length == 0) return 0;
            int count;
            long started = System.nanoTime();
            try {
                count = in.read(buffer, offset, length);
            } catch (IOException error) {
                load.recordSourceReadDuration(System.nanoTime() - started);
                load.fail();
                throw error;
            }
            load.recordSourceReadDuration(System.nanoTime() - started);
            if (count > 0) {
                load.append(buffer, offset, count);
            } else if (count < 0) {
                load.finish();
            }
            return count;
        }

        @Override
        public long skip(long requested) throws IOException {
            if (requested <= 0L) return 0L;
            byte[] buffer = new byte[(int) Math.min(8192L, requested)];
            long skipped = 0L;
            while (skipped < requested) {
                int count = read(buffer, 0, (int) Math.min(buffer.length, requested - skipped));
                if (count < 0) break;
                skipped += count;
            }
            return skipped;
        }

        @Override
        public boolean markSupported() {
            return false;
        }

        @Override
        public void mark(int readLimit) {
            // This stream intentionally does not support rewind while caching.
        }

        @Override
        public void reset() throws IOException {
            throw new IOException("SAF image stream does not support reset");
        }

        @Override
        public void close() throws IOException {
            if (closed) return;
            closed = true;
            try {
                super.close();
            } finally {
                load.fail();
            }
        }
    }

    static final class OpenResult {
        final InputStream stream;
        final String cacheState;
        final long openInputStreamMs;
        final long cacheWaitMs;
        final long cacheOpenMs;

        OpenResult(InputStream input, String state, long providerOpenMs,
                   long waitMs, long localOpenMs) {
            stream = input;
            cacheState = state;
            openInputStreamMs = providerOpenMs;
            cacheWaitMs = waitMs;
            cacheOpenMs = localOpenMs;
        }
    }
}
