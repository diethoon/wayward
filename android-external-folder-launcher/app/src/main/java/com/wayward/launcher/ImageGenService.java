package com.wayward.launcher;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * User-started, app-private Bun + Wayward ImageGen runtime.
 * Bun's Android binary is experimental; the runtime is verified by SHA-256
 * and then probed on-device before this service reports ready.
 */
public final class ImageGenService extends Service {
    public static final String ACTION_START = "com.wayward.launcher.imagegen.START";
    public static final String ACTION_STOP = "com.wayward.launcher.imagegen.STOP";
    public static final String EXTRA_BACKEND_ROOT = "backendRoot";
    private static final String CHANNEL_ID = "wayward-imagegen";
    private static final int NOTIFICATION_ID = 8189;
    private static final String BUN_URL =
            "https://github.com/oven-sh/bun/releases/download/bun-v1.4.4/bun-linux-aarch64-android.zip";
    private static final String BUN_SHA256 =
            "d72e42c60e895ccbc16144bb1e0e0ad7ee384841c35b5501a7ec28b4d6d759c9";
    private static final long MAX_BUN_ZIP = 60L * 1024L * 1024L;
    private static final long MAX_BUN_UNPACKED = 180L * 1024L * 1024L;
    public static volatile boolean serverReady = false;
    public static volatile boolean starting = false;
    public static volatile String statusMessage = "서버가 실행되지 않았습니다.";

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile Process serverProcess;
    private volatile boolean stopping = false;

    @Override public void onCreate() {
        super.onCreate();
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null && Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(new NotificationChannel(
                    CHANNEL_ID, "Wayward 이미지 생성 서버", NotificationManager.IMPORTANCE_LOW));
        }
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_START : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopping = true;
            starting = false;
            statusMessage = "이미지 생성 서버가 중지되었습니다.";
            stopRuntime();
            stopForeground(true);
            stopSelf(startId);
            return START_NOT_STICKY;
        }

        String backendPath = intent == null ? null : intent.getStringExtra(EXTRA_BACKEND_ROOT);
        if (backendPath == null || backendPath.isEmpty()) {
            stopSelf(startId);
            return START_NOT_STICKY;
        }

        if (serverReady || starting) return START_STICKY;
        stopping = false;
        starting = true;
        serverReady = false;
        updateNotification("이미지 생성 서버 준비 중");
        startAsForeground("이미지 생성 서버 준비 중");
        worker.execute(() -> {
            try {
                startRuntime(new File(backendPath));
            } catch (Exception e) {
                serverReady = false;
                starting = false;
                updateNotification("시작 실패: " + shortMessage(e));
            }
        });
        return START_NOT_STICKY;
    }

    private void startAsForeground(String text) {
        Notification notification = buildNotification(text);
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private Notification buildNotification(String text) {
        Intent stop = new Intent(this, ImageGenService.class).setAction(ACTION_STOP);
        PendingIntent pendingStop = PendingIntent.getService(this, 8189, stop,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL_ID) : new Notification.Builder(this);
        return builder.setSmallIcon(android.R.drawable.stat_sys_upload)
                .setContentTitle("Wayward 이미지 생성 서버")
                .setContentText(text)
                .setOngoing(true)
                .addAction(android.R.drawable.ic_media_pause, "중지", pendingStop)
                .build();
    }

    private void updateNotification(String text) {
        statusMessage = text;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.notify(NOTIFICATION_ID, buildNotification(text));
    }

    private void startRuntime(File backendRoot) throws Exception {
        if (!backendRoot.isDirectory()) throw new IllegalStateException("Image Studio 백엔드 폴더를 찾지 못했습니다.");
        File project = new File(backendRoot, "wayward-imagegen");
        if (!new File(project, "package.json").isFile()) project = backendRoot;
        if (!new File(project, "package.json").isFile() || !new File(project, "src/cli.ts").isFile()) {
            throw new IllegalStateException("wayward-imagegen/package.json 또는 src/cli.ts가 없습니다.");
        }

        if (probeHealth()) {
            serverReady = true;
            starting = false;
            updateNotification("이미지 생성 서버가 이미 실행 중입니다.");
            return;
        }

        File bun = ensureBun();
        File log = new File(getFilesDir(), "imagegen/server.log");
        File logParent = log.getParentFile();
        if (logParent != null && !logParent.exists()) logParent.mkdirs();

        File nodeModules = new File(project, "node_modules");
        if (!nodeModules.isDirectory()) {
            updateNotification("ImageGen 종속 패키지 설치 중");
            int install = runCommand(new ProcessBuilder(bun.getAbsolutePath(), "install", "--production")
                    .directory(project), log, 15, TimeUnit.MINUTES);
            if (install != 0) throw new IllegalStateException("Bun 종속 패키지 설치 실패(exit " + install + "). 로그: " + log.getAbsolutePath());
        }

        java.util.List<String> command = new java.util.ArrayList<>();
        command.add(bun.getAbsolutePath());
        command.add("src/cli.ts");
        command.add("--port");
        command.add("8189");
        File config = new File(project, "wayward-imagegen.config.json");
        if (!config.isFile()) config = new File(backendRoot, "wayward-imagegen.config.json");
        if (config.isFile()) {
            command.add("--config");
            command.add(config.getAbsolutePath());
        }

        updateNotification("이미지 생성 서버 시작 중 · 127.0.0.1:8189");
        ProcessBuilder builder = new ProcessBuilder(command).directory(project).redirectErrorStream(true)
                .redirectOutput(ProcessBuilder.Redirect.appendTo(log));
        builder.environment().put("HOME", getFilesDir().getAbsolutePath());
        builder.environment().put("TMPDIR", getCacheDir().getAbsolutePath());
        builder.environment().put("BUN_INSTALL", new File(getFilesDir(), "bun-install").getAbsolutePath());
        serverProcess = builder.start();

        long deadline = System.currentTimeMillis() + 60000L;
        while (!stopping && System.currentTimeMillis() < deadline) {
            if (probeHealth()) {
                serverReady = true;
                starting = false;
                updateNotification("연결됨 · 127.0.0.1:8189");
                break;
            }
            if (!serverProcess.isAlive()) {
                throw new IllegalStateException("ImageGen 프로세스가 시작 직후 종료됐습니다. 로그: " + log.getAbsolutePath());
            }
            Thread.sleep(500);
        }
        if (!serverReady) throw new IllegalStateException("60초 안에 /api/image/health 응답이 오지 않았습니다.");

        Process running = serverProcess;
        while (!stopping && running != null && running.isAlive()) {
            if (!probeHealth()) {
                updateNotification("서버 응답 대기 중 · 연결 상태 확인 필요");
            }
            Thread.sleep(5000);
        }
        if (!stopping) {
            serverReady = false;
            starting = false;
            updateNotification("ImageGen 서버가 종료됐습니다. 로그: " + log.getAbsolutePath());
        }
    }

    private File ensureBun() throws Exception {
        File root = new File(getFilesDir(), "imagegen/runtime");
        File binary = new File(root, "bun");
        if (binary.isFile() && binary.canExecute()) return binary;
        if (!root.exists() && !root.mkdirs()) throw new IllegalStateException("Bun 저장 폴더를 만들지 못했습니다.");

        File archive = new File(getCacheDir(), "bun-android-1.4.4.zip");
        updateNotification("Bun Android 런타임 다운로드 중 (약 49MB)");
        HttpURLConnection connection = (HttpURLConnection) new URL(BUN_URL).openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(120000);
        connection.setInstanceFollowRedirects(true);
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long total = 0;
        try (InputStream in = new BufferedInputStream(connection.getInputStream());
             FileOutputStream out = new FileOutputStream(archive)) {
            byte[] buffer = new byte[32768];
            int count;
            while ((count = in.read(buffer)) >= 0) {
                if (count == 0) continue;
                total += count;
                if (total > MAX_BUN_ZIP) throw new IllegalStateException("Bun 압축 파일 크기 제한 초과");
                digest.update(buffer, 0, count);
                out.write(buffer, 0, count);
            }
            out.flush();
        } finally {
            connection.disconnect();
        }
        if (!BUN_SHA256.equalsIgnoreCase(hex(digest.digest()))) {
            archive.delete();
            throw new SecurityException("Bun 공식 아카이브 SHA-256 검증 실패");
        }

        File staging = new File(root, ".extract");
        deleteTree(staging);
        if (!staging.mkdirs()) throw new IllegalStateException("Bun 압축 해제 폴더를 만들지 못했습니다.");
        boolean found = false;
        long unpacked = 0;
        try (ZipInputStream zip = new ZipInputStream(new BufferedInputStream(new FileInputStream(archive)))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                String name = entry.getName().replace('\\', '/');
                if (name.startsWith("/") || name.contains("../") || name.equals("..")) {
                    throw new SecurityException("Bun ZIP 경로가 안전하지 않습니다.");
                }
                if (!entry.isDirectory() && name.substring(name.lastIndexOf('/') + 1).equals("bun")) {
                    if (found) throw new SecurityException("Bun ZIP에 실행 파일이 중복되어 있습니다.");
                    File outFile = new File(staging, "bun");
                    try (FileOutputStream out = new FileOutputStream(outFile)) {
                        byte[] buffer = new byte[32768];
                        int count;
                        while ((count = zip.read(buffer)) >= 0) {
                            if (count == 0) continue;
                            unpacked += count;
                            if (unpacked > MAX_BUN_UNPACKED) throw new IllegalStateException("Bun 실행 파일 크기 제한 초과");
                            out.write(buffer, 0, count);
                        }
                    }
                    found = true;
                }
                zip.closeEntry();
            }
        } finally {
            archive.delete();
        }
        if (!found) throw new IllegalStateException("Bun ZIP에서 실행 파일을 찾지 못했습니다.");
        File stagedBinary = new File(staging, "bun");
        if (!stagedBinary.setExecutable(true, true)) throw new IllegalStateException("Bun 실행 권한을 설정하지 못했습니다.");
        if (!staging.renameTo(root)) {
            File finalBinary = new File(root, "bun");
            if (!stagedBinary.renameTo(finalBinary)) throw new IllegalStateException("Bun 실행 파일을 설치하지 못했습니다.");
            deleteTree(staging);
        }
        File installed = new File(root, "bun");
        if (!installed.setExecutable(true, true)) throw new IllegalStateException("Bun 실행 권한을 확인하지 못했습니다.");
        int version = runCommand(new ProcessBuilder(installed.getAbsolutePath(), "--version"), new File(getFilesDir(), "imagegen/bun-version.log"), 30, TimeUnit.SECONDS);
        if (version != 0) throw new IllegalStateException("이 기기에서 Bun Android 실행 파일을 실행하지 못했습니다.");
        return installed;
    }

    private int runCommand(ProcessBuilder builder, File log, long timeout, TimeUnit unit) throws Exception {
        File parent = log.getParentFile();
        if (parent != null && !parent.exists()) parent.mkdirs();
        builder.redirectErrorStream(true).redirectOutput(ProcessBuilder.Redirect.appendTo(log));
        builder.environment().put("HOME", getFilesDir().getAbsolutePath());
        builder.environment().put("TMPDIR", getCacheDir().getAbsolutePath());
        Process process = builder.start();
        if (!process.waitFor(timeout, unit)) {
            process.destroyForcibly();
            throw new IllegalStateException("Bun 명령 실행 시간이 초과됐습니다.");
        }
        return process.exitValue();
    }

    private boolean probeHealth() {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL("http://127.0.0.1:8189/api/image/health").openConnection();
            connection.setConnectTimeout(1200);
            connection.setReadTimeout(1200);
            connection.setUseCaches(false);
            connection.setRequestMethod("GET");
            int code = connection.getResponseCode();
            return code >= 200 && code < 300;
        } catch (Exception ignored) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void stopRuntime() {
        serverReady = false;
        starting = false;
        Process p = serverProcess;
        serverProcess = null;
        if (p != null && p.isAlive()) {
            p.destroy();
            try {
                if (!p.waitFor(2, TimeUnit.SECONDS)) p.destroyForcibly();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                p.destroyForcibly();
            }
        }
    }

    private static void deleteTree(File file) {
        if (file == null || !file.exists()) return;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) for (File child : children) deleteTree(child);
        }
        file.delete();
    }

    private static String hex(byte[] bytes) {
        StringBuilder out = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) out.append(String.format(Locale.ROOT, "%02x", b & 0xff));
        return out.toString();
    }

    private static String shortMessage(Exception e) {
        String message = e == null ? null : e.getMessage();
        if (message == null || message.trim().isEmpty()) return "원인을 확인하지 못했습니다.";
        return message.length() > 160 ? message.substring(0, 157) + "..." : message;
    }

    @Override public void onDestroy() {
        stopping = true;
        starting = false;
        stopRuntime();
        worker.shutdownNow();
        stopForeground(true);
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
