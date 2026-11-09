package com.wayward.launcher;

import android.content.ContentResolver;
import android.content.Context;
import android.net.Uri;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Comparator;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.FutureTask;

/**
 * Bounded app-private cache for SAF-backed image assets.
 * The selected game folder remains read-only; unknown metadata bypasses the cache.
 */
final class SafImageCache {
    private static final long MAX_CACHE_BYTES = 128L * 1024L * 1024L;
    private static final long MAX_SINGLE_IMAGE_BYTES = 32L * 1024L * 1024L;
    private final File directory;
    private final Object pruneLock = new Object();
    private final ConcurrentHashMap<String, FutureTask<CacheFileResult>> inFlight = new ConcurrentHashMap<>();

    SafImageCache(Context context) {
        directory = new File(context.getCacheDir(), "wayward-saf-images");
    }

    OpenResult open(ContentResolver resolver, Uri documentUri, String documentId,
                    long expectedSize, long lastModified) throws Exception {
        if (resolver == null || documentUri == null) return new OpenResult(null, "missing", 0L, 0L, 0L, 0L);
        if (documentId == null || documentId.isEmpty() || expectedSize <= 0L
                || expectedSize > MAX_SINGLE_IMAGE_BYTES || lastModified <= 0L) {
            return openDirect(resolver, documentUri, "bypass");
        }

        String key = digest(documentUri.toString() + "\n" + documentId + "\n"
                + expectedSize + "\n" + lastModified);
        File target = new File(directory, key + ".img");
        OpenResult cached = openCached(target, expectedSize);
        if (cached != null) return cached;

        FutureTask<CacheFileResult> candidate = new FutureTask<>(
                () -> copyToCache(resolver, documentUri, target, expectedSize));
        FutureTask<CacheFileResult> active = inFlight.putIfAbsent(key, candidate);
        boolean shared = active != null;
        if (active == null) {
            active = candidate;
            candidate.run();
        }

        long waitStarted = System.nanoTime();
        try {
            CacheFileResult ready = active.get();
            long waitMs = (System.nanoTime() - waitStarted) / 1_000_000L;
            if (ready != null && ready.file != null && ready.file.isFile()
                    && ready.file.length() == expectedSize) {
                long cacheOpenStarted = System.nanoTime();
                InputStream stream = new FileInputStream(ready.file);
                long cacheOpenMs = (System.nanoTime() - cacheOpenStarted) / 1_000_000L;
                ready.file.setLastModified(System.currentTimeMillis());
                return new OpenResult(stream, shared ? "shared" : "loaded",
                        ready.openInputStreamMs, ready.cacheReadMs, shared ? waitMs : 0L, cacheOpenMs);
            }
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            return openDirect(resolver, documentUri, "fallback");
        } catch (ExecutionException error) {
            // Keep image display functional even when the private cache cannot be written.
        } finally {
            inFlight.remove(key, active);
        }
        return openDirect(resolver, documentUri, "fallback");
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
            return new OpenResult(input, "hit", 0L, 0L, 0L, openMs);
        } catch (IOException error) {
            target.delete();
            return null;
        }
    }

    private CacheFileResult copyToCache(ContentResolver resolver, Uri documentUri, File target,
                                        long expectedSize) throws Exception {
        if (!directory.isDirectory() && !directory.mkdirs() && !directory.isDirectory()) {
            throw new IOException("Unable to create private image cache directory");
        }
        File part = new File(directory, target.getName() + "."
                + Thread.currentThread().getId() + ".part");
        if (part.exists() && !part.delete()) {
            throw new IOException("Unable to clear stale image cache part");
        }

        long openStarted = System.nanoTime();
        InputStream source = resolver.openInputStream(documentUri);
        long openMs = (System.nanoTime() - openStarted) / 1_000_000L;
        if (source == null) return new CacheFileResult(null, openMs, 0L);

        long copied = 0L;
        long readStarted = System.nanoTime();
        try (InputStream input = source; FileOutputStream output = new FileOutputStream(part)) {
            byte[] buffer = new byte[32 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) {
                copied += count;
                if (copied > expectedSize || copied > MAX_SINGLE_IMAGE_BYTES) {
                    throw new IOException("SAF image size changed while caching");
                }
                output.write(buffer, 0, count);
            }
            output.flush();
            output.getFD().sync();
        } catch (Exception error) {
            part.delete();
            throw error;
        }
        long readMs = (System.nanoTime() - readStarted) / 1_000_000L;

        if (copied != expectedSize) {
            part.delete();
            throw new IOException("SAF image size did not match document metadata");
        }
        if (!part.renameTo(target)) {
            if (target.exists() && !target.delete()) {
                part.delete();
                throw new IOException("Unable to replace stale image cache file");
            }
            if (!part.renameTo(target)) {
                part.delete();
                throw new IOException("Unable to publish image cache file");
            }
        }
        target.setLastModified(System.currentTimeMillis());
        trimCache(target);
        return new CacheFileResult(target, openMs, readMs);
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

    private static String digest(String value) throws Exception {
        byte[] bytes = MessageDigest.getInstance("SHA-256")
                .digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte item : bytes) result.append(String.format(java.util.Locale.ROOT, "%02x", item & 0xff));
        return result.toString();
    }

    private static final class CacheFileResult {
        final File file;
        final long openInputStreamMs;
        final long cacheReadMs;

        CacheFileResult(File cachedFile, long openMs, long readMs) {
            file = cachedFile;
            openInputStreamMs = openMs;
            cacheReadMs = readMs;
        }
    }

    static final class OpenResult {
        final InputStream stream;
        final String cacheState;
        final long openInputStreamMs;
        final long cacheReadMs;
        final long cacheWaitMs;
        final long cacheOpenMs;

        OpenResult(InputStream input, String state, long providerOpenMs,
                   long readMs, long waitMs, long localOpenMs) {
            stream = input;
            cacheState = state;
            openInputStreamMs = providerOpenMs;
            cacheReadMs = readMs;
            cacheWaitMs = waitMs;
            cacheOpenMs = localOpenMs;
        }
    }
}
