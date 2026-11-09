package com.wayward.launcher;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.Properties;

/** Cross-process status snapshot for the isolated ImageGen foreground service. */
final class ImageGenStatusStore {
    private static final String FILE_NAME = "imagegen-status.properties";
    private static final long HEARTBEAT_STALE_MS = 20_000L;

    static final class State {
        final boolean ready;
        final boolean starting;
        final String message;
        final String backendVersion;
        final long updatedAt;

        State(boolean ready, boolean starting, String message, String backendVersion, long updatedAt) {
            this.ready = ready;
            this.starting = starting;
            this.message = message == null ? "" : message;
            this.backendVersion = backendVersion == null ? "" : backendVersion;
            this.updatedAt = updatedAt;
        }

        boolean isFresh() {
            long age = System.currentTimeMillis() - updatedAt;
            return updatedAt > 0 && age >= 0 && age <= HEARTBEAT_STALE_MS;
        }

        boolean isStarting() {
            long age = System.currentTimeMillis() - updatedAt;
            return starting && updatedAt > 0 && age >= 0 && age <= HEARTBEAT_STALE_MS;
        }

        boolean isReady() {
            return ready && isFresh();
        }
    }

    private ImageGenStatusStore() {}

    static State read(File filesDir) {
        File target = new File(filesDir, FILE_NAME);
        Properties p = new Properties();
        try (FileInputStream in = new FileInputStream(target)) {
            p.load(in);
            return new State(
                    Boolean.parseBoolean(p.getProperty("ready", "false")),
                    Boolean.parseBoolean(p.getProperty("starting", "false")),
                    p.getProperty("message", ""),
                    p.getProperty("backendVersion", ""),
                    Long.parseLong(p.getProperty("updatedAt", "0")));
        } catch (Exception ignored) {
            return new State(false, false, "", "", 0L);
        }
    }

    static void write(File filesDir, boolean ready, boolean starting,
                      String message, String backendVersion) throws IOException {
        if (!filesDir.isDirectory() && !filesDir.mkdirs() && !filesDir.isDirectory()) {
            throw new IOException("앱 상태 저장 폴더를 만들지 못했습니다.");
        }
        Properties p = new Properties();
        p.setProperty("ready", Boolean.toString(ready));
        p.setProperty("starting", Boolean.toString(starting));
        p.setProperty("message", message == null ? "" : message);
        p.setProperty("backendVersion", backendVersion == null ? "" : backendVersion);
        p.setProperty("updatedAt", Long.toString(System.currentTimeMillis()));

        File target = new File(filesDir, FILE_NAME);
        File temp = new File(filesDir, FILE_NAME + ".tmp");
        try (FileOutputStream out = new FileOutputStream(temp)) {
            p.store(out, "Wayward ImageGen service state");
            out.flush();
            out.getFD().sync();
        }
        try {
            Files.move(temp.toPath(), target.toPath(),
                    StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException atomicMoveFailure) {
            try {
                Files.move(temp.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING);
            } catch (IOException moveFailure) {
                moveFailure.addSuppressed(atomicMoveFailure);
                throw moveFailure;
            }
        } finally {
            if (temp.exists()) temp.delete();
        }
    }
}
