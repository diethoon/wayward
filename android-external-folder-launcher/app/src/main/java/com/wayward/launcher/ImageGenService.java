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
import java.io.PrintWriter;
import java.io.StringWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
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
    public static final String EXTRA_BACKEND_VERSION = "backendVersion";
    public static final String EXTRA_LAUNCH_MODE = "launchMode";
    public static final String EXTRA_COMFY_URL = "comfyUrl";
    private static final String CHANNEL_ID = "wayward-imagegen";
    private static final int NOTIFICATION_ID = 8189;
    private static final String BUN_URL =
            "https://github.com/oven-sh/bun/releases/download/bun-v1.4.4/bun-linux-aarch64-android.zip";
    private static final String BUN_SHA256 =
            "d72e42c60e895ccbc16144bb1e0e0ad7ee384841c35b5501a7ec28b4d6d759c9";
    // Android blocks direct execve() of app-private binaries on modern releases.
    // Launch the verified Bun ELF through the system dynamic linker instead.
    private static final String ANDROID_LINKER_64 = "/system/bin/linker64";
    // Google API emulator x86_64 images may expose an ARM64 native-bridge linker here.
    private static final String ANDROID_BRIDGE_ARM64_LINKER_64 = "/system/bin/arm64/linker64";
    private static final long MAX_BUN_ZIP = 60L * 1024L * 1024L;
    private static final long MAX_BUN_UNPACKED = 180L * 1024L * 1024L;
    public static volatile boolean serverReady = false;
    public static volatile boolean serverAvailable = false;
    public static volatile boolean starting = false;
    public static volatile String statusMessage = "서버가 실행되지 않았습니다.";

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService heartbeat = Executors.newSingleThreadScheduledExecutor();
    private final Object processLock = new Object();
    private volatile Process serverProcess;
    private volatile boolean stopping = false;
    private volatile String backendVersion = "";

    @Override public void onCreate() {
        super.onCreate();
        DiagnosticsLogger.event(this,"INFO","imagegen_service","service_created",null);
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null && Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(new NotificationChannel(
                    CHANNEL_ID, "Wayward 이미지 생성 서버", NotificationManager.IMPORTANCE_LOW));
        }
        heartbeat.scheduleAtFixedRate(this::persistState, 5, 5, TimeUnit.SECONDS);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_START : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            DiagnosticsLogger.event(this,"INFO","imagegen_service","stop_command_received",null);
            stopping = true;
            serverReady = false;
            serverAvailable = false;
            starting = false;
            statusMessage = "이미지 생성 서버가 중지되었습니다.";
            stopRuntime();
            updateNotification(statusMessage);
            stopForeground(true);
            stopSelf(startId);
            return START_NOT_STICKY;
        }

        String backendPath = intent == null ? null : intent.getStringExtra(EXTRA_BACKEND_ROOT);
        if (backendPath == null || backendPath.isEmpty()) {
            statusMessage = "ImageGen 백엔드 경로가 전달되지 않았습니다.";
            starting = false;
            serverReady = false;
            serverAvailable = false;
            updateNotification(statusMessage);
            stopSelf(startId);
            return START_NOT_STICKY;
        }

        if (serverReady || starting || (serverProcess != null && serverProcess.isAlive())) return START_STICKY;
        final String launchMode = intent == null ? "default" : intent.getStringExtra(EXTRA_LAUNCH_MODE);
        final String comfyUrl = intent == null ? "" : intent.getStringExtra(EXTRA_COMFY_URL);
        DiagnosticsLogger.event(this,"INFO","imagegen_service","start_command_received",null);
        stopping = false;
        starting = true;
        serverReady = false;
        serverAvailable = false;
        backendVersion = intent.getStringExtra(EXTRA_BACKEND_VERSION);
        if (backendVersion == null) backendVersion = "";
        try {
            updateNotification("이미지 생성 서버 준비 중");
            startAsForeground("이미지 생성 서버 준비 중");
            worker.execute(() -> {
                try {
                    startRuntime(new File(backendPath), launchMode == null ? "default" : launchMode, comfyUrl == null ? "" : comfyUrl);
                } catch (Throwable error) {
                    if (!stopping) recordFailure(error);
                }
            });
        } catch (Throwable error) {
            recordFailure(error);
            stopSelf(startId);
            return START_NOT_STICKY;
        }
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
        persistState();
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.notify(NOTIFICATION_ID, buildNotification(text));
    }

    private void persistState() {
        try {
            ImageGenStatusStore.write(getFilesDir(), serverReady, starting, serverAvailable, statusMessage, backendVersion);
        } catch (Exception error) {
            appendDiagnostic("상태 저장 실패: " + shortMessage(error));
        }
    }

    private void recordFailure(Throwable error) {
        DiagnosticsLogger.error(this,"imagegen_service","runtime_start_failed",error);
        serverReady = false;
        serverAvailable = false;
        starting = false;
        String message = shortMessage(error);
        statusMessage = "서버 시작 실패: " + message;
        appendDiagnostic(stackTrace(error));
        updateNotification(statusMessage);
    }

    private void appendDiagnostic(String message) {
        try {
            File log = new File(getFilesDir(), "imagegen/startup.log");
            File parent = log.getParentFile();
            if (parent != null && !parent.exists()) parent.mkdirs();
            try (FileOutputStream out = new FileOutputStream(log, true)) {
                out.write((System.currentTimeMillis() + " " + message + "\n").getBytes(java.nio.charset.StandardCharsets.UTF_8));
                out.flush();
                out.getFD().sync();
            }
        } catch (Exception ignored) {}
    }

    private static String stackTrace(Throwable error) {
        if (error == null) return "Unknown error";
        StringWriter text = new StringWriter();
        error.printStackTrace(new PrintWriter(text));
        String value = text.toString();
        return value.length() > 24000 ? value.substring(0, 24000) : value;
    }

    private void startRuntime(File backendRoot,String launchMode,String requestedComfyUrl) throws Exception {
        if (stopping) return;
        if (!backendRoot.isDirectory()) throw new IllegalStateException("런처 내장 ImageGen 백엔드 폴더가 없습니다.");
        if (!"default".equals(launchMode) && !"novelai".equals(launchMode) && !"comfy".equals(launchMode)) {
            throw new IllegalArgumentException("지원하지 않는 이미지 서버 실행 모드입니다.");
        }
        String comfyUrl = "comfy".equals(launchMode) ? ComfyEndpoint.normalizeOptional(requestedComfyUrl) : "";
        File project = new File(backendRoot, "wayward-imagegen");
        if (!new File(project, "package.json").isFile() || !new File(project, "src/cli.ts").isFile()) {
            throw new IllegalStateException("런처 내장 wayward-imagegen/package.json 또는 src/cli.ts가 없습니다.");
        }

        File bun = ensureBun();
        if (stopping) return;
        File log = new File(getFilesDir(), "imagegen/server.log");
        File logParent = log.getParentFile();
        if (logParent != null && !logParent.exists()) logParent.mkdirs();

        // The pinned 0.8.4 package has only an optional sharp dependency for
        // WebP conversion. Android runs with --no-webp and stores PNG, so no
        // package-manager install or platform-specific native addon is needed.
        File config = new File(project, "wayward-imagegen.config.json");
        if (!config.isFile() || config.length() == 0) {
            throw new IllegalStateException("런처 ImageGen 실행 설정 파일을 만들지 못했습니다.");
        }

        ProcessBuilder builder = bunProcess(bun,
                "src/cli.ts", "--config", config.getAbsolutePath(), "--no-webp")
                .directory(project).redirectErrorStream(true)
                .redirectOutput(ProcessBuilder.Redirect.appendTo(log));
        if ("comfy".equals(launchMode) && !comfyUrl.isEmpty()) {
            builder.command().add("--comfy-url");
            builder.command().add(comfyUrl);
        }

        updateNotification("comfy".equals(launchMode) && comfyUrl.isEmpty()
                ? "ComfyUI 주소 대기 중 · 로컬 서버 시작"
                : "이미지 생성 서버 시작 중 · 127.0.0.1:8189");
        builder.environment().put("HOME", getFilesDir().getAbsolutePath());
        builder.environment().put("TMPDIR", getCacheDir().getAbsolutePath());
        builder.environment().put("BUN_INSTALL", new File(getFilesDir(), "bun-install").getAbsolutePath());
        if ("novelai".equals(launchMode)) {
            String token = ImageProviderStore.readNovelAiToken(this);
            if (token != null && !token.trim().isEmpty()) {
                builder.environment().put("NAI_TOKEN", token);
                DiagnosticsLogger.event(this, "INFO", "imagegen_service",
                        "novelai_credential_available_at_start", null);
            } else {
                // Keep the service alive so the user can open the EasyGen panel
                // and configure a provider before the first generation request.
                DiagnosticsLogger.event(this, "INFO", "imagegen_service",
                        "novelai_credential_not_set_at_start", null);
            }
        }
        Process launched = startProcess(builder);
        synchronized (processLock) {
            // Stop can arrive while Bun is being downloaded or validated. Do not
            // leave a late child process running after the user pressed Stop.
            if (stopping) {
                launched.destroy();
                try {
                    if (!launched.waitFor(2, TimeUnit.SECONDS)) launched.destroyForcibly();
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    launched.destroyForcibly();
                }
                return;
            }
            serverProcess = launched;
        }
        DiagnosticsLogger.event(this,"INFO","imagegen_service","bun_server_process_started",null);

        // A reachable HTTP endpoint is enough to open EasyGen configuration.
        // Health HTTP 503 is expected before a provider credential is configured;
        // it must not deadlock the settings panel behind the readiness check.
        long nextHealthNoticeAt = 0L;
        while (!stopping) {
            Process running = serverProcess;
            if (running == null || !running.isAlive()) {
                int exitCode = -1;
                try { if (running != null) exitCode = running.exitValue(); } catch (Exception ignored) {}
                throw new IllegalStateException("ImageGen 프로세스가 시작 직후 종료됐습니다(exitCode="
                        + exitCode + "). 로그: " + log.getAbsolutePath());
            }
            HealthProbeResult probe = probeHealth();
            if (probe.ready) {
                serverAvailable = true;
                serverReady = true;
                starting = false;
                updateNotification("comfy".equals(launchMode) && comfyUrl.isEmpty()
                        ? "ComfyUI 주소 미설정 · 로컬 서버 대기 중 · 127.0.0.1:8189"
                        : "연결됨 · 127.0.0.1:8189");
                appendDiagnostic("health_ready HTTP " + probe.statusCode);
                break;
            }
            if (probe.reachable) {
                serverAvailable = true;
                serverReady = false;
                starting = false;
                updateNotification(healthStatusMessage(probe));
                appendDiagnostic("health_endpoint_reachable HTTP " + probe.statusCode);
                break;
            }
            serverReady = false;
            serverAvailable = false;
            starting = true;
            long now = System.currentTimeMillis();
            if (now >= nextHealthNoticeAt) {
                updateNotification("서버 프로세스 실행 중 · 헬스 응답 없음 (" + probe.detail
                        + ") · 127.0.0.1:8189");
                appendDiagnostic("health_probe_wait " + probe.detail);
                nextHealthNoticeAt = now + 30000L;
            }
            Thread.sleep(1000);
        }
        if (stopping) return;

        Process running = serverProcess;
        while (!stopping && running != null && running.isAlive()) {
            HealthProbeResult probe = probeHealth();
            if (probe.ready) {
                serverAvailable = true;
                serverReady = true;
                starting = false;
                if (!statusMessage.startsWith("연결됨")
                        && !statusMessage.startsWith("ComfyUI 주소 미설정")) {
                    updateNotification("연결됨 · 127.0.0.1:8189");
                    appendDiagnostic("health_ready HTTP " + probe.statusCode);
                }
            } else if (probe.reachable) {
                serverAvailable = true;
                serverReady = false;
                starting = false;
                String message = healthStatusMessage(probe);
                if (!message.equals(statusMessage)) {
                    updateNotification(message);
                    appendDiagnostic("health_not_ready HTTP " + probe.statusCode);
                }
            } else {
                serverAvailable = false;
                serverReady = false;
                starting = false;
                String message = "서버 프로세스는 실행 중이나 헬스 연결이 끊겼습니다 (" + probe.detail + ")";
                if (!message.equals(statusMessage)) {
                    updateNotification(message);
                    appendDiagnostic("health_connection_lost " + probe.detail);
                }
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
        File invalidBinary = null;
        if (binary.isFile()) {
            try {
                prepareBunExecutable(binary);
                int existingVersion = runCommand(
                        bunProcess(binary, "--version"),
                        new File(getFilesDir(), "imagegen/bun-version.log"), 30, TimeUnit.SECONDS);
                if (existingVersion == 0) {
                    DiagnosticsLogger.event(this,"INFO","imagegen_service","bun_existing_binary_validated",null);
                    return binary;
                }
                appendDiagnostic("기존 Bun 버전 검증 실패(exit " + existingVersion + "): " + executableDiagnostics(binary));
            } catch (Exception error) {
                appendDiagnostic("기존 Bun 실제 실행 검증 실패: " + error + " | " + executableDiagnostics(binary));
                DiagnosticsLogger.error(this,"imagegen_service","bun_existing_binary_invalid",error);
            }
            invalidBinary = new File(root, "bun.invalid." + System.currentTimeMillis());
            if (!binary.renameTo(invalidBinary)) {
                if (!binary.delete()) throw new IllegalStateException("검증 실패한 기존 Bun 파일을 격리하지 못했습니다: " + executableDiagnostics(binary));
                invalidBinary = null;
            }
        }
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
                        if (!outFile.setReadOnly()) {
                            throw new IllegalStateException("Bun 실행 파일을 추출 단계에서 읽기 전용으로 설정하지 못했습니다.");
                        }
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
        prepareBunExecutable(stagedBinary);
        if (!staging.renameTo(root)) {
            File finalBinary = new File(root, "bun");
            if (!stagedBinary.renameTo(finalBinary)) throw new IllegalStateException("Bun 실행 파일을 설치하지 못했습니다.");
            deleteTree(staging);
        }
        File installed = new File(root, "bun");
        prepareBunExecutable(installed);
        int version = runCommand(bunProcess(installed, "--version"),
                new File(getFilesDir(), "imagegen/bun-version.log"), 30, TimeUnit.SECONDS);
        if (version != 0) throw new IllegalStateException("이 기기에서 Bun Android 실행 파일을 실행하지 못했습니다(exit " + version + "). " + executableDiagnostics(installed));
        if (invalidBinary != null) deleteTree(invalidBinary);
        DiagnosticsLogger.event(this,"INFO","imagegen_service","bun_fresh_install_validated",null);
        return installed;
    }

    private void prepareBunExecutable(File executable) throws java.io.IOException {
        if (executable == null || !executable.isFile()) {
            throw new java.io.IOException("Bun 실행 파일이 없습니다: "
                    + (executable == null ? "" : executable.getAbsolutePath()));
        }
        if (!executable.setReadOnly()) {
            throw new java.io.IOException("Bun 실행 파일을 읽기 전용으로 설정하지 못했습니다: "
                    + executable.getAbsolutePath());
        }
        if (!executable.setExecutable(true, true)) {
            throw new java.io.IOException("Bun 실행 권한을 설정하지 못했습니다: "
                    + executable.getAbsolutePath());
        }
        if (!executable.canRead() || !executable.canExecute() || executable.canWrite()) {
            throw new java.io.IOException("Bun 권한 검증 실패: " + executableDiagnostics(executable));
        }
    }

    private File resolveAndroidArm64Linker() throws java.io.IOException {
        String[] abis = Build.SUPPORTED_ABIS == null ? new String[0] : Build.SUPPORTED_ABIS;
        boolean nativeArm64 = abis.length > 0 && "arm64-v8a".equals(abis[0]);
        File linker = nativeArm64
                ? new File(ANDROID_LINKER_64)
                : new File(ANDROID_BRIDGE_ARM64_LINKER_64);
        if (!linker.isFile() || !linker.canRead() || !linker.canExecute()) {
            throw new java.io.IOException("Android ARM64 동적 링커를 사용할 수 없습니다: "
                    + linker.getAbsolutePath() + "; abis="
                    + java.util.Arrays.toString(abis));
        }
        return linker;
    }

    private ProcessBuilder bunProcess(File executable, String... arguments) throws java.io.IOException {
        File linker = resolveAndroidArm64Linker();
        java.util.List<String> command = new java.util.ArrayList<>();
        command.add(linker.getAbsolutePath());
        command.add(executable.getAbsolutePath());
        if (arguments != null) {
            for (String argument : arguments) command.add(argument);
        }
        return new ProcessBuilder(command);
    }

    private String executableDiagnostics(File executable) {
        File parent = executable == null ? null : executable.getParentFile();
        return "path=" + (executable == null ? "" : executable.getAbsolutePath())
                + "; isFile=" + (executable != null && executable.isFile())
                + "; canRead=" + (executable != null && executable.canRead())
                + "; canExecute=" + (executable != null && executable.canExecute())
                + "; canWrite=" + (executable != null && executable.canWrite())
                + "; bytes=" + (executable != null && executable.isFile() ? executable.length() : -1)
                + "; parentCanRead=" + (parent != null && parent.canRead())
                + "; parentCanWrite=" + (parent != null && parent.canWrite())
                + "; sdk=" + Build.VERSION.SDK_INT
                + "; abis=" + java.util.Arrays.toString(Build.SUPPORTED_ABIS);
    }

    private Process startProcess(ProcessBuilder builder) throws java.io.IOException {
        try {
            return builder.start();
        } catch (java.io.IOException error) {
            java.util.List<String> command = builder.command();
            boolean usesSystemLinker = command != null && command.size() > 1
                    && ANDROID_LINKER_64.equals(command.get(0));
            File executable = command == null || command.isEmpty() ? null
                    : new File(usesSystemLinker ? command.get(1) : command.get(0));
            String diagnostics = "usesSystemLinker=" + usesSystemLinker + "; "
                    + executableDiagnostics(executable);
            org.json.JSONObject details = new org.json.JSONObject();
            try {
                details.put("exception", error.toString());
                details.put("usesSystemLinker", usesSystemLinker);
                details.put("executable", executable == null ? "" : executable.getAbsolutePath());
                details.put("isFile", executable != null && executable.isFile());
                details.put("canRead", executable != null && executable.canRead());
                details.put("canExecute", executable != null && executable.canExecute());
                details.put("canWrite", executable != null && executable.canWrite());
                details.put("bytes", executable != null && executable.isFile() ? executable.length() : -1);
                details.put("sdk", Build.VERSION.SDK_INT);
                details.put("supportedAbis", java.util.Arrays.toString(Build.SUPPORTED_ABIS));
            } catch (Exception ignored) {}
            DiagnosticsLogger.event(this,"ERROR","imagegen_service","process_builder_start_failed",details);
            appendDiagnostic("ProcessBuilder.start 실패: " + error + " | " + diagnostics);
            throw new java.io.IOException("Cannot run program: " + error.getMessage() + " | " + diagnostics, error);
        }
    }

    private int runCommand(ProcessBuilder builder, File log, long timeout, TimeUnit unit) throws Exception {
        File parent = log.getParentFile();
        if (parent != null && !parent.exists()) parent.mkdirs();
        builder.redirectErrorStream(true).redirectOutput(ProcessBuilder.Redirect.appendTo(log));
        builder.environment().put("HOME", getFilesDir().getAbsolutePath());
        builder.environment().put("TMPDIR", getCacheDir().getAbsolutePath());
        Process process = startProcess(builder);
        if (!process.waitFor(timeout, unit)) {
            process.destroyForcibly();
            throw new IllegalStateException("Bun 명령 실행 시간이 초과됐습니다.");
        }
        return process.exitValue();
    }

    private static final class HealthProbeResult {
        final boolean reachable;
        final boolean ready;
        final int statusCode;
        final String detail;

        HealthProbeResult(boolean reachable, boolean ready, int statusCode, String detail) {
            this.reachable = reachable;
            this.ready = ready;
            this.statusCode = statusCode;
            this.detail = detail == null ? "" : detail;
        }
    }

    private HealthProbeResult probeHealth() {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL("http://127.0.0.1:8189/api/image/health").openConnection();
            connection.setConnectTimeout(1200);
            connection.setReadTimeout(1200);
            connection.setUseCaches(false);
            connection.setRequestMethod("GET");
            int code = connection.getResponseCode();
            return new HealthProbeResult(true, code >= 200 && code < 300, code, "HTTP " + code);
        } catch (Exception error) {
            return new HealthProbeResult(false, false, -1, error.getClass().getSimpleName());
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String healthStatusMessage(HealthProbeResult probe) {
        if (probe.statusCode == 503) {
            return "서버 응답 확인 · HTTP 503(공급자 설정/인증 대기) · 127.0.0.1:8189";
        }
        return "서버 HTTP 응답 확인 · " + probe.detail + " (API 점검 필요) · 127.0.0.1:8189";
    }

    private void stopRuntime() {
        synchronized (processLock) {
            serverReady = false;
            serverAvailable = false;
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

    private static String shortMessage(Throwable e) {
        String message = e == null ? null : e.getMessage();
        if (message == null || message.trim().isEmpty()) return "원인을 확인하지 못했습니다.";
        return message.length() > 160 ? message.substring(0, 157) + "..." : message;
    }

    @Override public void onDestroy() {
        boolean unexpected = !stopping;
        stopping = true;
        starting = false;
        stopRuntime();
        if (unexpected) {
            DiagnosticsLogger.event(this,"ERROR","imagegen_service","service_destroyed_unexpectedly",null);
            serverReady = false;
            serverAvailable = false;
            statusMessage = "이미지 생성 서비스가 예기치 않게 종료되었습니다. 시작 로그를 확인하세요.";
        }
        persistState();
        heartbeat.shutdownNow();
        worker.shutdownNow();
        stopForeground(true);
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
