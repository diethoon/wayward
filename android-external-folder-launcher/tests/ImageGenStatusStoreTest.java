package com.wayward.launcher;

import java.io.File;
import java.nio.file.Files;

public final class ImageGenStatusStoreTest {
    public static void main(String[] args) throws Exception {
        File root = Files.createTempDirectory("wayward-imagegen-status").toFile();
        try {
            ImageGenStatusStore.State empty = ImageGenStatusStore.read(root);
            check(!empty.ready && !empty.starting, "missing state defaults to stopped");

            ImageGenStatusStore.write(root, false, true, "런타임 설치 중", "0.8.4");
            ImageGenStatusStore.State starting = ImageGenStatusStore.read(root);
            check(starting.starting && !starting.ready, "starting state persisted");
            check("런타임 설치 중".equals(starting.message), "status message persisted");
            check("0.8.4".equals(starting.backendVersion), "backend version persisted");
            check(starting.isStarting(), "fresh starting state accepted");

            ImageGenStatusStore.write(root, true, false, "연결됨", "0.8.4");
            ImageGenStatusStore.State ready = ImageGenStatusStore.read(root);
            check(ready.isReady(), "ready state persisted and fresh");
            check(ready.isAvailable(), "ready state is also available");
            check(!ready.isStarting(), "ready is not starting");

            ImageGenStatusStore.write(root, false, false, true,
                    "서버 응답 확인 · HTTP 503(공급자 설정/인증 대기)", "0.8.4");
            ImageGenStatusStore.State needsProviderSetup = ImageGenStatusStore.read(root);
            check(needsProviderSetup.isAvailable(), "HTTP 503 endpoint remains available for settings");
            check(!needsProviderSetup.isReady(), "HTTP 503 is not falsely marked generation-ready");
            check(!needsProviderSetup.isStarting(), "HTTP 503 is not misreported as server startup");

            java.util.Properties stale = new java.util.Properties();
            File statusFile = new File(root, "imagegen-status.properties");
            try (java.io.FileInputStream in = new java.io.FileInputStream(statusFile)) {
                stale.load(in);
            }
            stale.setProperty("ready", "false");
            stale.setProperty("starting", "true");
            stale.setProperty("available", "true");
            stale.setProperty("updatedAt", Long.toString(System.currentTimeMillis() - 60_000L));
            try (java.io.FileOutputStream out = new java.io.FileOutputStream(statusFile)) {
                stale.store(out, "stale test");
            }
            check(!ImageGenStatusStore.read(root).isStarting(), "dead service heartbeat expires startup state");
            check(!ImageGenStatusStore.read(root).isAvailable(), "dead service heartbeat expires availability state");

            ImageGenStatusStore.write(root, false, false, "설치 실패", "0.8.4");
            ImageGenStatusStore.State failed = ImageGenStatusStore.read(root);
            check(!failed.isReady() && !failed.isStarting(), "failure state persisted");
            check("설치 실패".equals(failed.message), "failure message persisted");

            System.out.println("ImageGenStatusStore tests passed.");
        } finally {
            File[] children = root.listFiles();
            if (children != null) for (File child : children) child.delete();
            root.delete();
        }
    }

    private static void check(boolean condition, String label) {
        if (!condition) throw new AssertionError(label);
        System.out.println("PASS " + label);
    }
}
