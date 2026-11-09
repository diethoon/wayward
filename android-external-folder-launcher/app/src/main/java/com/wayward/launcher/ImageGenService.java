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
    public static final String ACTION_RESTART = "com.wayward.launcher.imagegen.RESTART";
    public static final String ACTION_STOP = "com.wayward.launcher.imagegen.STOP";
    public static final String EXTRA_BACKEND_ROOT = "backendRoot";
    public static final String EXTRA_BACKEND_VERSION = "backendVersion";
    private static final String CHANNEL_ID = "wayward-imagegen";
    private static final int NOTIFICATION_ID = 8189;
    private static final String BUN_URL =
            "https://github.com/oven-sh/bun/releases/download/bun-v1.4.4/bun-linux-aarch64-android.zip";
    private static final String BUN_SHA256 =
            "d72e42c60e895ccbc16144bb1e0e0ad7ee384841c35b5501a7ec28b4d6d759c9";
    // Android 10+ blocks direct execve() of binaries stored under the app data directory.
    // Start the app-private Bun binary through the system dynamic linker instead.
    private static final String ANDROID_LINKER_64 = "/system/bin/linker64";
    private static final long MAX_BUN_ZIP = 60L * 1024L * 1024L;
    private static final long MAX_BUN_UNPACKED = 180L * 1024L * 1024L;
    public static volatile boolean serverReady = false;
    public static volatile boolean starting = false;
    public static volatile String statusMessage = "서버가 실행되지 않았습니다.";

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService heartbeat = Executors.newSingleThreadScheduledExecutor();
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
            starting = false;
            statusMessage = "이미지 생성 서버가 중지되었습니다.";
            stopRuntime();
            updateNotification(statusMessage);
            stopForeground(true);
            stopSelf(startId);
            return START_NOT_STICKY;
        }

        boolean restart = ACTION_RESTART.equals(action);
        String backendPath = intent == null ? null : intent.getStringExtra(EXTRA_BACKEND_ROOT);
        if (backendPath == null || backendPath.isEmpty()) {
            statusMessage = "ImageGen 백엔드 경로가 전달되지 않았습니다.";
            starting = false;
            serverReady = false;
            updateNotification(statusMessage);
            stopSelf(startId);
            return START_NOT_STICKY;
        }

        if (!restart && (serverReady || starting || (serverProcess != null && serverProcess.isAlive()))) {
            return START_STICKY;
        }
        DiagnosticsLogger.event(this,"INFO","imagegen_service",restart?"restart_command_received":"start_command_received",null);
        backendVersion = intent.getStringExtra(EXTRA_BACKEND_VERSION);
        if (backendVersion == null) backendVersion = "";
        try {
            if (restart) {
                stopping = true;
                stopRuntime();
                updateNotification("이미지 생성 서버 재시작 대기");
                startAsForeground("이미지 생성 서버 재시작 중");
                worker.execute(() -> {
                    stopping = false;
                    starting = true;
                    serverReady = false;
                    statusMessage = "이미지 생성 서버 재시작 중";
                    updateNotification(statusMessage);
                    try {
                        startRuntime(new File(backendPath));
                    } catch (Throwable error) {
                        recordFailure(error);
                    }
                });
            } else {
                stopping = false;
                starting = true;
                serverReady = false;
                updateNotification("이미지 생성 서버 준비 중");
                startAsForeground("이미지 생성 서버 준비 중");
                worker.execute(() -> {
                    try {
                        startRuntime(new File(backendPath));
                    } catch (Throwable error) {
                        recordFailure(error);
                    }
                });
            }
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
            ImageGenStatusStore.write(getFilesDir(), serverReady, starting, statusMessage, backendVersion);
        } catch (Exception error) {
            appendDiagnostic("상태 저장 실패: " + shortMessage(error));
        }
    }

    private void recordFailure(Throwable error) {
        DiagnosticsLogger.error(this,"imagegen_service","runtime_start_failed",error);
        serverReady = false;
        starting = false;
        String message = shortMessage(error);
        statusMessage = "서버 시작 실패: " + message;
        appendDiagnostic(stackTrace(error));
        persistState();
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

    private void startRuntime(File backendRoot) throws Exception {
        if (!backendRoot.isDirectory()) throw new IllegalStateException("Image Studio 백엔드 폴더를 찾지 못했습니다.");
        File project = new File(backendRoot, "wayward-imagegen");
        if (!new File(project, "package.json").isFile()) project = backendRoot;
        if (!new File(project, "package.json").isFile() || !new File(project, "src/cli.ts").isFile()) {
            throw new IllegalStateException("wayward-imagegen/package.json 또는 src/cli.ts가 없습니다.");
        }

        // Do not adopt an arbitrary listener on the shared Android loopback port.
        // Start our own backend and only accept health while our child process is alive.
        File bun = ensureBun();
        File log = new File(getFilesDir(), "imagegen/server.log");
        File logParent = log.getParentFile();
        if (logParent != null && !logParent.exists()) logParent.mkdirs();

        File nodeModules = new File(project, "node_modules");
        if (!nodeModules.isDirectory()) {
            updateNotification("ImageGen 종속 패키지 설치 중");
            File installLog = new File(getFilesDir(), "imagegen/install.log");
            int install = runCommand(bunProcess(bun, "install", "--production")
                    .directory(project), installLog, 15, TimeUnit.MINUTES);
            if (install != 0) throw new IllegalStateException("Bun 종속 패키지 설치 실패(exit " + install + "). 진단 로그 공유에서 설치 로그를 확인하세요.");
        }

        updateNotification("이미지 생성 서버 시작 중 · 127.0.0.1:8189");
        ProcessBuilder builder = bunProcess(bun, "src/cli.ts").directory(project).redirectErrorStream(true)
                .redirectOutput(ProcessBuilder.Redirect.appendTo(log));
        builder.environment().put("HOME", getFilesDir().getAbsolutePath());
        builder.environment().put("TMPDIR", getCacheDir().getAbsolutePath());
        builder.environment().put("BUN_INSTALL", new File(getFilesDir(), "bun-install").getAbsolutePath());
        serverProcess = startProcess(builder);
        DiagnosticsLogger.event(this,"INFO","imagegen_service","bun_server_process_started",null);

        long deadline = System.currentTimeMillis() + 60000L;
        while (!stopping && System.currentTimeMillis() < deadline) {
            if (serverProcess == null || !serverProcess.isAlive()) {
                int exitCode = -1;
                try { if (serverProcess != null) exitCode = serverProcess.exitValue(); } catch (Exception ignored) {}
                long serverLogBytes = log.isFile() ? log.length() : -1L;
                org.json.JSONObject exitDetails = new org.json.JSONObject();
                try {
                    exitDetails.put("exitCode", exitCode);
                    exitDetails.put("serverLogBytes", serverLogBytes);
                    exitDetails.put("projectHasNodeModules", nodeModules.isDirectory());
                    exitDetails.put("sdk", Build.VERSION.SDK_INT);
                    exitDetails.put("abis", java.util.Arrays.toString(Build.SUPPORTED_ABIS));
                } catch (Exception ignored) {}
                DiagnosticsLogger.event(this, "ERROR", "imagegen_service",
                        "bun_server_process_exited_early", exitDetails);
                appendDiagnostic("Bun 서버 프로세스 조기 종료: exitCode=" + exitCode
                        + "; serverLogBytes=" + serverLogBytes
                        + "; nodeModulesPresent=" + nodeModules.isDirectory());
                runDoctorProbe(bun, project);
                throw new IllegalStateException("ImageGen 프로세스가 시작 직후 종료됐습니다 (exitCode="
                        + exitCode + ", server.log=" + serverLogBytes + " bytes). 로그: " + log.getAbsolutePath());
            }
            if (probeHealth()) {
                serverReady = true;
                starting = false;
                updateNotification("연결됨 · 127.0.0.1:8189");
                break;
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
                        // Keep the extracted native runtime non-writable before it can be executed.
                        // Mark it immediately after opening, before writing through this descriptor.
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
        int version = runCommand(bunProcess(installed, "--version"), new File(getFilesDir(), "imagegen/bun-version.log"), 30, TimeUnit.SECONDS);
        if (version != 0) throw new IllegalStateException("이 기기에서 Bun Android 실행 파일을 실행하지 못했습니다(exit " + version + "). " + executableDiagnostics(installed));
        if (invalidBinary != null) deleteTree(invalidBinary);
        DiagnosticsLogger.event(this,"INFO","imagegen_service","bun_fresh_install_validated",null);
        return installed;
    }

    private void prepareBunExecutable(File executable) throws java.io.IOException {
        if (executable == null || !executable.isFile()) {
            throw new java.io.IOException("Bun 실행 파일이 없습니다: " + (executable == null ? "" : executable.getAbsolutePath()));
        }
        if (!executable.setReadOnly()) {
            throw new java.io.IOException("Bun 실행 파일을 읽기 전용으로 설정하지 못했습니다: " + executable.getAbsolutePath());
        }
        if (!executable.setExecutable(true, true)) {
            throw new java.io.IOException("Bun 실행 권한을 설정하지 못했습니다: " + executable.getAbsolutePath());
        }
        if (!executable.canRead() || !executable.canExecute() || executable.canWrite()) {
            throw new java.io.IOException("Bun 권한 검증 실패: " + executableDiagnostics(executable));
        }
    }

    private ProcessBuilder bunProcess(File executable, String... arguments) throws java.io.IOException {
        File linker = new File(ANDROID_LINKER_64);
        if (!linker.isFile() || !linker.canExecute()) {
            throw new java.io.IOException("Android 64비트 동적 링커를 사용할 수 없습니다: " + ANDROID_LINKER_64);
        }
        java.util.List<String> command = new java.util.ArrayList<>();
        command.add(ANDROID_LINKER_64);
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
            File launcher = command == null || command.isEmpty() ? null : new File(command.get(0));
            boolean usesSystemLinker = command != null && command.size() > 1
                    && ANDROID_LINKER_64.equals(command.get(0));
            File executable = usesSystemLinker ? new File(command.get(1)) : launcher;
            String diagnostics = "launcher=" + (launcher == null ? "" : launcher.getAbsolutePath())
                    + "; usesSystemLinker=" + usesSystemLinker + "; " + executableDiagnostics(executable);
            org.json.JSONObject details = new org.json.JSONObject();
            try {
                details.put("exception", error.toString());
                details.put("launcher", launcher == null ? "" : launcher.getAbsolutePath());
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

    private void runDoctorProbe(File bun, File project) {
        File doctorLog = new File(getFilesDir(), "imagegen/doctor.log");
        try {
            File parent = doctorLog.getParentFile();
            if (parent != null && !parent.exists()) parent.mkdirs();
            try (FileOutputStream ignored = new FileOutputStream(doctorLog, false)) {
                // Start with a fresh log so the diagnostic belongs to this failed launch.
            }
            ProcessBuilder doctor = bunProcess(bun, "src/cli.ts", "doctor").directory(project);
            doctor.environment().put("BUN_INSTALL",
                    new File(getFilesDir(), "bun-install").getAbsolutePath());
            int exitCode = runCommand(doctor, doctorLog, 30, TimeUnit.SECONDS);
            org.json.JSONObject details = new org.json.JSONObject();
            try {
                details.put("exitCode", exitCode);
                details.put("logBytes", doctorLog.isFile() ? doctorLog.length() : -1L);
                details.put("projectHasNodeModules", new File(project, "node_modules").isDirectory());
            } catch (Exception ignored) {}
            DiagnosticsLogger.event(this, "INFO", "imagegen_service",
                    "bun_server_doctor_completed", details);
            appendDiagnostic("Bun doctor 완료: exitCode=" + exitCode
                    + "; doctorLogBytes=" + (doctorLog.isFile() ? doctorLog.length() : -1L));
        } catch (Throwable error) {
            appendDiagnostic("Bun doctor 실행 실패: " + shortMessage(error));
            DiagnosticsLogger.error(this, "imagegen_service", "bun_server_doctor_failed", error);
        }
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
