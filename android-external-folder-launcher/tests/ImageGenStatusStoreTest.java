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
            check(!ready.isStarting(), "ready is not starting");

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
