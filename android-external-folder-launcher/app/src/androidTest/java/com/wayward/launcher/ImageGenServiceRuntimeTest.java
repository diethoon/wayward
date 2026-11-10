package com.wayward.launcher;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import android.app.Activity;
import android.app.Instrumentation;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.StatusBarNotification;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.ParcelFileDescriptor;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

@RunWith(AndroidJUnit4.class)
public final class ImageGenServiceRuntimeTest {
    private static final String HEALTH_URL = "http://127.0.0.1:8189/api/image/health";
    private static final String SETTINGS_URL = "http://127.0.0.1:8189/api/generation/settings";
    private static final long SERVER_START_TIMEOUT_MS = 240_000L;

    @Test
    public void serverSurvivesActivityFinishUntilNotificationStop() throws Exception {
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        Context context = instrumentation.getTargetContext();
        Activity launcherActivity = null;
        boolean stopActionSent = false;
        NotificationManager notifications =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);

        try {
            assertTrue("Test must run on Android 15/API 35", Build.VERSION.SDK_INT >= 35);
            assertTrue("This test requires a 64-bit Android ABI",
                    Build.SUPPORTED_64_BIT_ABIS != null && Build.SUPPORTED_64_BIT_ABIS.length > 0);

            grantNotificationPermission(instrumentation, context);
            launcherActivity = instrumentation.startActivitySync(
                    new Intent(context, MainActivity.class)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP));
            assertNotNull("Launcher activity did not start", launcherActivity);

            File backend = installBundledBackend(context);
            prepareRuntimeConfig(context, backend);

            Intent start = new Intent(context, ImageGenService.class)
                    .setAction(ImageGenService.ACTION_START)
                    .putExtra(ImageGenService.EXTRA_BACKEND_ROOT, backend.getAbsolutePath())
                    .putExtra(ImageGenService.EXTRA_BACKEND_VERSION, "launcher-imagegen:0.8.4:novelai")
                    .putExtra(ImageGenService.EXTRA_LAUNCH_MODE, "novelai")
                    .putExtra(ImageGenService.EXTRA_COMFY_URL, "");
            context.startForegroundService(start);

            int initialHealth = awaitReachable(SERVER_START_TIMEOUT_MS);
            assertEquals("Bundled ARM64 Bun did not start the actual ImageGen HTTP server. "
                    + startupLogs(context), 503, initialHealth);

            int settingsCode = updateTestProviderSettings();
            assertEquals("Could not configure the test-only provider state. "
                    + startupLogs(context), 200, settingsCode);
            assertEquals("ImageGen health did not become ready after provider setup. "
                    + startupLogs(context), 200, awaitStatus(200, 30_000L));
            String bunVersion = readText(new File(context.getFilesDir(), "imagegen/bun-version.log"));
            assertTrue("The test did not execute the pinned Android Bun 1.4.4 binary: " + bunVersion,
                    bunVersion.contains("1.4.4"));
            String serverLog = readText(new File(context.getFilesDir(), "imagegen/server.log"));
            assertTrue("The embedded wayward-imagegen server did not report listening: " + serverLog,
                    serverLog.contains("wayward-imagegen 0.8.4") && serverLog.toLowerCase().contains("listening"));

            Activity activityToFinish = launcherActivity;
            instrumentation.runOnMainSync(activityToFinish::finish);
            launcherActivity = null;

            long keepAliveUntil = System.currentTimeMillis() + 15_000L;
            while (System.currentTimeMillis() < keepAliveUntil) {
                assertEquals("ImageGen stopped when its launcher Activity was closed. "
                        + startupLogs(context), 200, requestStatus(HEALTH_URL, "GET", null));
                Thread.sleep(1000L);
            }

            StatusBarNotification serviceNotification = findImageGenNotification(notifications);
            assertNotNull("Foreground ImageGen notification was not retained after Activity finish. "
                    + startupLogs(context), serviceNotification);
            Notification.Action stopAction = findStopAction(serviceNotification.notification);
            assertNotNull("Foreground notification has no explicit 중지 action. "
                    + startupLogs(context), stopAction);
            PendingIntent stopIntent = stopAction.actionIntent;
            assertNotNull("Stop action has no PendingIntent", stopIntent);
            stopIntent.send();
            stopActionSent = true;

            assertTrue("ImageGen endpoint remained alive after pressing notification Stop. "
                    + startupLogs(context), awaitServerDown(45_000L));
            assertTrue("Foreground notification remained after Stop",
                    findImageGenNotification(notifications) == null);
        } finally {
            if (launcherActivity != null) {
                Activity activity = launcherActivity;
                instrumentation.runOnMainSync(activity::finish);
            }
            if (!stopActionSent) {
                try {
                    context.startService(new Intent(context, ImageGenService.class)
                            .setAction(ImageGenService.ACTION_STOP));
                    awaitServerDown(15_000L);
                } catch (Exception ignored) {
                    // Preserve the primary assertion/error from the runtime test.
                }
            }
        }
    }

    private static void grantNotificationPermission(Instrumentation instrumentation, Context context)
            throws Exception {
        if (Build.VERSION.SDK_INT < 33) return;
        ParcelFileDescriptor descriptor = instrumentation.getUiAutomation().executeShellCommand(
                "pm grant " + context.getPackageName() + " android.permission.POST_NOTIFICATIONS");
        if (descriptor == null) return;
        try (InputStream input = new FileInputStream(descriptor.getFileDescriptor())) {
            byte[] buffer = new byte[1024];
            while (input.read(buffer) >= 0) { /* drain shell output */ }
        } finally {
            descriptor.close();
        }
    }

    private static File installBundledBackend(Context context) throws Exception {
        File destination = new File(context.getFilesDir(), "imagegen/backend");
        Class<?> installer = Class.forName("com.wayward.launcher.ImageGenBackendInstaller");
        Method install = installer.getDeclaredMethod("install", Context.class, File.class);
        install.setAccessible(true);
        try {
            return (File) install.invoke(null, context, destination);
        } catch (InvocationTargetException error) {
            Throwable cause = error.getTargetException();
            if (cause instanceof Exception) throw (Exception) cause;
            throw error;
        }
    }

    private static void prepareRuntimeConfig(Context context, File backend) throws Exception {
        File project = new File(backend, "wayward-imagegen");
        File images = new File(context.getFilesDir(), "imagegen/images");
        File state = new File(context.getFilesDir(), "imagegen/state");
        if (!images.isDirectory() && !images.mkdirs()) throw new IllegalStateException("Cannot create images directory");
        if (!state.isDirectory() && !state.mkdirs()) throw new IllegalStateException("Cannot create state directory");

        JSONObject config = new JSONObject();
        config.put("host", "127.0.0.1");
        config.put("port", 8189);
        config.put("imagesDir", images.getAbsolutePath());
        config.put("stateDir", state.getAbsolutePath());
        config.put("comfyUrl", "http://127.0.0.1:8188");
        config.put("imageProvider", "nai");
        config.put("webp", false);
        config.put("requireWebp", false);

        File destination = new File(project, "wayward-imagegen.config.json");
        try (FileOutputStream output = new FileOutputStream(destination)) {
            output.write(config.toString().getBytes(StandardCharsets.UTF_8));
            output.flush();
            output.getFD().sync();
        }
    }

    private static int updateTestProviderSettings() throws Exception {
        JSONObject body = new JSONObject();
        body.put("imageProvider", "nai");
        body.put("naiToken", "ci-smoke-token-not-valid");
        return requestStatus(SETTINGS_URL, "PUT", body.toString());
    }

    private static int awaitReachable(long timeoutMs) throws Exception {
        long deadline = System.currentTimeMillis() + timeoutMs;
        int last = -1;
        while (System.currentTimeMillis() < deadline) {
            last = requestStatus(HEALTH_URL, "GET", null);
            if (last >= 200) return last;
            Thread.sleep(1000L);
        }
        fail("ImageGen HTTP endpoint never became reachable; last status=" + last);
        return -1;
    }

    private static int awaitStatus(int expected, long timeoutMs) throws Exception {
        long deadline = System.currentTimeMillis() + timeoutMs;
        int last = -1;
        while (System.currentTimeMillis() < deadline) {
            last = requestStatus(HEALTH_URL, "GET", null);
            if (last == expected) return last;
            Thread.sleep(1000L);
        }
        fail("Expected ImageGen HTTP " + expected + " but last status was " + last);
        return last;
    }

    private static boolean awaitServerDown(long timeoutMs) throws Exception {
        long deadline = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < deadline) {
            if (requestStatus(HEALTH_URL, "GET", null) < 0) return true;
            Thread.sleep(1000L);
        }
        return false;
    }

    private static int requestStatus(String endpoint, String method, String body) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(endpoint).openConnection();
            connection.setConnectTimeout(1500);
            connection.setReadTimeout(2500);
            connection.setUseCaches(false);
            connection.setRequestMethod(method);
            if (body != null) {
                connection.setDoOutput(true);
                connection.setRequestProperty("content-type", "application/json");
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(body.getBytes(StandardCharsets.UTF_8));
                    output.flush();
                }
            }
            return connection.getResponseCode();
        } catch (Exception ignored) {
            return -1;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static StatusBarNotification findImageGenNotification(NotificationManager manager) {
        if (manager == null) return null;
        for (StatusBarNotification item : manager.getActiveNotifications()) {
            CharSequence title = item.getNotification().extras.getCharSequence(Notification.EXTRA_TITLE);
            if (title != null && title.toString().contains("Wayward 이미지 생성 서버")) return item;
        }
        return null;
    }

    private static Notification.Action findStopAction(Notification notification) {
        if (notification.actions == null) return null;
        for (Notification.Action action : notification.actions) {
            if (action.title != null && "중지".contentEquals(action.title)) return action;
        }
        return null;
    }

    private static String readText(File file) throws Exception {
        if (!file.isFile()) return "";
        try (InputStream input = new FileInputStream(file);
             java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) >= 0) {
                if (read > 0) output.write(buffer, 0, read);
            }
            return output.toString("UTF-8");
        }
    }

    private static String startupLogs(Context context) {
        return "startup.log=" + new File(context.getFilesDir(), "imagegen/startup.log").getAbsolutePath()
                + "; server.log=" + new File(context.getFilesDir(), "imagegen/server.log").getAbsolutePath()
                + "; bun-version.log=" + new File(context.getFilesDir(), "imagegen/bun-version.log").getAbsolutePath();
    }
}
