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
import android.service.notification.StatusBarNotification;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

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

            // Invoke the exact launcher action behind the NovelAI server Start button.
            // This exercises backend installation, config creation and service launch together.
            Activity activityToStart = launcherActivity;
            Method startAction = MainActivity.class.getDeclaredMethod("startNovelAiServer");
            startAction.setAccessible(true);
            instrumentation.runOnMainSync(() -> {
                try {
                    startAction.invoke(activityToStart);
                } catch (Exception error) {
                    throw new RuntimeException("Could not invoke the launcher ImageGen Start action", error);
                }
            });

            int initialHealth = awaitReachable(SERVER_START_TIMEOUT_MS);
            assertEquals("Bundled ARM64 Bun did not start the actual ImageGen HTTP server. "
                    + startupLogs(context), 503, initialHealth);
            long availabilityDeadline = System.currentTimeMillis() + 10_000L;
            ImageGenStatusStore.State unconfigured = ImageGenStatusStore.read(context.getFilesDir());
            while (!unconfigured.isAvailable() && System.currentTimeMillis() < availabilityDeadline) {
                Thread.sleep(100L);
                unconfigured = ImageGenStatusStore.read(context.getFilesDir());
            }
            assertTrue("HTTP 503 means the API is reachable but provider setup is pending. "
                    + startupLogs(context), unconfigured.isAvailable());
            assertTrue("Provider setup must not be treated as generation-ready. "
                    + startupLogs(context), !unconfigured.isReady());

            Instrumentation.ActivityMonitor panelMonitor = instrumentation.addMonitor(
                    ImageGenPanelActivity.class.getName(), null, false);
            Activity activityForPanel = launcherActivity;
            Method openPanel = MainActivity.class.getDeclaredMethod("openImageGenPanel");
            openPanel.setAccessible(true);
            instrumentation.runOnMainSync(() -> {
                try {
                    openPanel.invoke(activityForPanel);
                } catch (Exception error) {
                    throw new RuntimeException("Could not open EasyGen settings while provider setup is pending", error);
                }
            });
            Activity settingsPanel = instrumentation.waitForMonitorWithTimeout(panelMonitor, 10_000L);
            assertNotNull("EasyGen settings panel stayed blocked while health returned HTTP 503. "
                    + startupLogs(context), settingsPanel);
            instrumentation.runOnMainSync(settingsPanel::finish);
            instrumentation.removeMonitor(panelMonitor);

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

            // End-to-end: load the pinned Wayward WML page in the real launcher
            // WebView, invoke its installed native image-provider bridge, call the
            // real Cloudflare Worker from Android, and wait for a data: image to
            // decode in the game page before capturing the screen and diagnostics.
            runCloudflareGamePageSmoke(instrumentation, context, launcherActivity);

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
            Notification.Action stopAction = findStopAction(serviceNotification.getNotification());
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


    private static final String GAME_PROFILE_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private static final String FLUX_PROVIDER_ID = "0123456789abcdef0123456789abcdef";
    private static final String FLUX_ENDPOINT = "https://wayward-image-worker.trpgengine.workers.dev";
    private static final String GAME_ORIGIN = "https://localhost:38123";

    private static void runCloudflareGamePageSmoke(
            Instrumentation instrumentation, Context context, Activity activity) throws Exception {
        String resultSummary = "state=not_started";
        WebView[] webHolder = new WebView[1];
        CountDownLatch pageFinished = new CountDownLatch(1);
        AtomicReference<String> pageError = new AtomicReference<>("");
        File artifactDirectory = new File(context.getFilesDir(), "ci-artifacts");
        if (!artifactDirectory.isDirectory() && !artifactDirectory.mkdirs()) {
            throw new IllegalStateException("Could not create private CI artifact directory.");
        }

        try {
            configureCloudflareProvider(context, GAME_PROFILE_ID);
            byte[] gameHtml;
            try (InputStream input = instrumentation.getContext().getAssets().open("Wayward_WML_ko.html");
                 ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) >= 0) {
                    if (count > 0) output.write(buffer, 0, count);
                    if (output.size() > 6 * 1024 * 1024) {
                        throw new IllegalStateException("Pinned game HTML exceeds the expected test fixture size.");
                    }
                }
                gameHtml = output.toByteArray();
            }
            if (gameHtml.length != 4_383_674) {
                throw new IllegalStateException("Unexpected pinned Wayward_WML_ko.html size: " + gameHtml.length);
            }

            instrumentation.runOnMainSync(() -> {
                try {
                    MainActivity main = (MainActivity) activity;
                    FrameLayout root = (FrameLayout) getField(main, "root");
                    View home = (View) getField(main, "home");
                    if (root == null || home == null) {
                        throw new IllegalStateException("Launcher game container is not initialized.");
                    }
                    home.setVisibility(View.GONE);

                    WebView gameWeb = new WebView(main);
                    WebSettings settings = gameWeb.getSettings();
                    settings.setJavaScriptEnabled(true);
                    settings.setDomStorageEnabled(true);
                    settings.setDatabaseEnabled(true);
                    settings.setAllowFileAccess(false);
                    settings.setAllowContentAccess(false);
                    settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
                    gameWeb.setBackgroundColor(android.graphics.Color.WHITE);
                    gameWeb.setWebViewClient(new WebViewClient() {
                        @Override public void onPageFinished(WebView view, String url) {
                            pageFinished.countDown();
                            super.onPageFinished(view, url);
                        }
                        @Override public void onReceivedError(WebView view,
                                android.webkit.WebResourceRequest request,
                                android.webkit.WebResourceError error) {
                            if (request != null && request.isForMainFrame()) {
                                pageError.set("main-frame " + (error == null ? "unknown" : error.getErrorCode()));
                            }
                            super.onReceivedError(view, request, error);
                        }
                    });

                    setField(main, "activeProfileId", GAME_PROFILE_ID);
                    setField(main, "web", gameWeb);
                    Class<?> bridgeClass = Class.forName("com.wayward.launcher.MainActivity$HostBridge");
                    java.lang.reflect.Constructor<?> bridgeConstructor =
                            bridgeClass.getDeclaredConstructor(MainActivity.class);
                    bridgeConstructor.setAccessible(true);
                    Object bridge = bridgeConstructor.newInstance(main);
                    gameWeb.addJavascriptInterface(bridge, "WMLHost");

                    Method installScripts = MainActivity.class.getDeclaredMethod(
                            "installImageGenDocumentStartScript", String.class);
                    installScripts.setAccessible(true);
                    installScripts.invoke(main, GAME_ORIGIN);

                    root.addView(gameWeb, new FrameLayout.LayoutParams(
                            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
                    gameWeb.setVisibility(View.VISIBLE);
                    webHolder[0] = gameWeb;
                    gameWeb.loadDataWithBaseURL(
                            GAME_ORIGIN + "/game/Wayward_WML_ko.html",
                            new String(gameHtml, StandardCharsets.UTF_8),
                            "text/html", "UTF-8", null);
                } catch (Throwable error) {
                    pageError.set(error.getClass().getSimpleName() + ": " + error.getMessage());
                    pageFinished.countDown();
                }
            });

            assertTrue("Pinned Wayward game page did not finish loading: " + pageError.get(),
                    pageFinished.await(90, TimeUnit.SECONDS));
            WebView gameWeb = webHolder[0];
            assertNotNull("The launcher WebView was not created: " + pageError.get(), gameWeb);

            String bridgeType = awaitJsString(instrumentation, gameWeb,
                    "typeof window.WaywardImageProviders", 30_000L);
            assertEquals("The document-start image provider bridge is not installed in the game WebView.",
                    "object", bridgeType);

            String providersJson = awaitJsString(instrumentation, gameWeb,
                    "JSON.stringify(window.WaywardImageProviders.list())", 10_000L);
            JSONObject providers = new JSONObject(providersJson);
            assertEquals("The Cloudflare provider was not selected for the test game profile.",
                    FLUX_PROVIDER_ID, providers.optString("defaultProviderId", ""));
            assertTrue("The Cloudflare provider is not listed as enabled.",
                    providers.optJSONArray("providers") != null
                            && providers.optJSONArray("providers").length() > 0);

            String trigger = "(function(){"
                    + "window.__waywardCiImage={state:'generating'};"
                    + "var p=window.WaywardImageProviders.generate({"
                    + "prompt:'An original cozy fantasy shopkeeper in a small woodland general store, polished anime illustration, warm afternoon sunlight, full body, detailed clean composition, no text',"
                    + "width:1024,height:1024});"
                    + "p.then(function(result){"
                    + "if(!result||!result.dataUrl||!result.dataUrl.startsWith('data:image/'))"
                    + "throw new Error('Native bridge returned no image data URL');"
                    + "var img=document.createElement('img');img.id='wayward-ci-cloudflare-image';"
                    + "img.alt='Cloudflare FLUX Android integration result';"
                    + "img.style.cssText='position:fixed;z-index:2147483647;right:20px;top:20px;"
                    + "width:340px;height:340px;object-fit:contain;background:#fff;"
                    + "border:6px solid #2d6b49;border-radius:12px;box-shadow:0 4px 24px #0008';"
                    + "img.onload=function(){window.__waywardCiImage={state:'loaded',"
                    + "naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,"
                    + "mimeType:result.mimeType||'',dataUrlLength:result.dataUrl.length,"
                    + "providerId:result.providerId||'',fallbackUsed:!!result.fallbackUsed};};"
                    + "img.onerror=function(){window.__waywardCiImage={state:'img_error',"
                    + "naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight};};"
                    + "document.body.appendChild(img);img.src=result.dataUrl;"
                    + "}).catch(function(error){window.__waywardCiImage={state:'error',"
                    + "errorType:error&&error.name?String(error.name):'Error',"
                    + "message:error&&error.message?String(error.message).slice(0,240):'unknown'};});"
                    + "return 'dispatched';})()";
            String dispatch = awaitJsString(instrumentation, gameWeb, trigger, 10_000L);
            assertEquals("The game page did not dispatch its native image request.", "dispatched", dispatch);

            long deadline = System.currentTimeMillis() + 240_000L;
            JSONObject imageState = new JSONObject();
            while (System.currentTimeMillis() < deadline) {
                String stateJson = awaitJsString(instrumentation, gameWeb,
                        "JSON.stringify(window.__waywardCiImage||{state:'pending'})", 10_000L);
                imageState = new JSONObject(stateJson);
                String state = imageState.optString("state", "pending");
                if ("loaded".equals(state) || "error".equals(state) || "img_error".equals(state)) break;
                Thread.sleep(500L);
            }
            assertEquals("Cloudflare image did not render in the actual Wayward game WebView. "
                    + imageState + "; pipeline=" + ImagePipelineDiagnostics.readRecent(context, 100),
                    "loaded", imageState.optString("state", ""));
            assertTrue("The generated image decoded to zero dimensions in Android WebView: " + imageState,
                    imageState.optInt("naturalWidth", 0) > 0 && imageState.optInt("naturalHeight", 0) > 0);

            resultSummary = "state=loaded\n"
                    + "gameHtmlBytes=" + gameHtml.length + "\n"
                    + "gameHtmlSourceCommit=5e5c78c4e32198e460ba040256e920d37ed1711c\n"
                    + "gameHtmlBlob=8d998b50e82febe18b5c1d1159b16663b9169775\n"
                    + "cloudflareEndpoint=" + FLUX_ENDPOINT + "\n"
                    + "providerType=cloudflare-worker\n"
                    + "dataUrlLength=" + imageState.optInt("dataUrlLength") + "\n"
                    + "mimeType=" + imageState.optString("mimeType") + "\n"
                    + "decodedWidth=" + imageState.optInt("naturalWidth") + "\n"
                    + "decodedHeight=" + imageState.optInt("naturalHeight") + "\n"
                    + "pageError=" + pageError.get() + "\n";

        } finally {
            try {
                writeGameSmokeArtifacts(instrumentation, context, artifactDirectory, resultSummary);
            } catch (Throwable artifactError) {
                System.out.println("WAYWARD_CI_ARTIFACT_EXPORT_FAILED: "
                        + artifactError.getClass().getSimpleName() + ": " + artifactError.getMessage());
            }
        }
    }

    private static void configureCloudflareProvider(Context context, String profileId) throws Exception {
        ImageProviderStore.Snapshot snapshot = new ImageProviderStore(context).load();
        snapshot.providers.clear();
        snapshot.defaults.clear();
        snapshot.fallbacks.clear();

        ImageProviderStore.Provider provider = new ImageProviderStore.Provider();
        provider.id = FLUX_PROVIDER_ID;
        provider.name = "Wayward Android CI Cloudflare FLUX";
        provider.type = "cloudflare-worker";
        provider.endpoint = FLUX_ENDPOINT;
        provider.enabled = true;
        provider.allowInGame = true;
        snapshot.providers.add(provider);
        snapshot.defaults.put(profileId, provider.id);
        new ImageProviderStore(context).save(snapshot);
    }

    private static String awaitJsString(Instrumentation instrumentation, WebView web,
                                        String expression, long timeoutMs) throws Exception {
        CountDownLatch completed = new CountDownLatch(1);
        AtomicReference<String> output = new AtomicReference<>();
        instrumentation.runOnMainSync(() -> web.evaluateJavascript(expression, value -> {
            output.set(value);
            completed.countDown();
        }));
        assertTrue("Timed out waiting for JavaScript evaluation: " + expression,
                completed.await(timeoutMs, TimeUnit.MILLISECONDS));
        String raw = output.get();
        if (raw == null || "null".equals(raw)) return "";
        return new org.json.JSONArray("[" + raw + "]").getString(0);
    }

    private static Object getField(Object instance, String name) throws Exception {
        Field field = instance.getClass().getDeclaredField(name);
        field.setAccessible(true);
        return field.get(instance);
    }

    private static void setField(Object instance, String name, Object value) throws Exception {
        Field field = instance.getClass().getDeclaredField(name);
        field.setAccessible(true);
        field.set(instance, value);
    }

    private static void writeGameSmokeArtifacts(Instrumentation instrumentation, Context context,
                                                File directory, String resultSummary) throws Exception {
        if (!directory.isDirectory() && !directory.mkdirs()) {
            throw new IllegalStateException("Could not create CI artifact directory.");
        }

        StringBuilder log = new StringBuilder();
        log.append("=== Cloudflare game WebView smoke ===\n")
                .append(resultSummary).append('\n')
                .append("=== Image pipeline events ===\n");
        log.append(ImagePipelineDiagnostics.readRecent(context, 200).toString(2)).append('\n');
        log.append("=== ImageGen startup.log ===\n")
                .append(readText(new File(context.getFilesDir(), "imagegen/startup.log"))).append('\n');
        log.append("=== ImageGen server.log ===\n")
                .append(readText(new File(context.getFilesDir(), "imagegen/server.log"))).append('\n');
        log.append("=== Bun version ===\n")
                .append(readText(new File(context.getFilesDir(), "imagegen/bun-version.log"))).append('\n');

        File logFile = new File(directory, "Wayward-Android15-Cloudflare-Game-Logs.txt");
        try (FileOutputStream output = new FileOutputStream(logFile)) {
            output.write(log.toString().getBytes(StandardCharsets.UTF_8));
            output.flush();
            output.getFD().sync();
        }

        // Export the pipeline/server logs first so they survive even if screenshot
        // capture itself fails. The target APK is removed after connected tests.
        copyPrivateArtifact(instrumentation, context,
                "files/ci-artifacts/Wayward-Android15-Cloudflare-Game-Logs.txt",
                "/sdcard/Download/Wayward-CI/Wayward-Android15-Cloudflare-Game-Logs.txt");

        Bitmap screenshot = instrumentation.getUiAutomation().takeScreenshot();
        if (screenshot == null) throw new IllegalStateException("Android UiAutomation screenshot returned null.");
        File screenshotFile = new File(directory, "Wayward-Android15-Cloudflare-Game-Screen.png");
        try (FileOutputStream output = new FileOutputStream(screenshotFile)) {
            if (!screenshot.compress(Bitmap.CompressFormat.PNG, 100, output)) {
                throw new IllegalStateException("Could not encode Android game WebView screenshot.");
            }
            output.flush();
            output.getFD().sync();
        } finally {
            screenshot.recycle();
        }
        copyPrivateArtifact(instrumentation, context,
                "files/ci-artifacts/Wayward-Android15-Cloudflare-Game-Screen.png",
                "/sdcard/Download/Wayward-CI/Wayward-Android15-Cloudflare-Game-Screen.png");
        System.out.println("WAYWARD_GAME_CLOUDFLARE_RESULT " + resultSummary);
        System.out.println("WAYWARD_GAME_CLOUDFLARE_LOG " + logFile.getAbsolutePath());
        System.out.println("WAYWARD_GAME_CLOUDFLARE_SCREEN " + screenshotFile.getAbsolutePath());
    }

    private static void copyPrivateArtifact(Instrumentation instrumentation, Context context,
                                            String privatePath, String sharedPath) throws Exception {
        ParcelFileDescriptor mkdir = instrumentation.getUiAutomation()
                .executeShellCommand("mkdir -p /sdcard/Download/Wayward-CI");
        if (mkdir != null) {
            try (InputStream input = new FileInputStream(mkdir.getFileDescriptor())) {
                byte[] buffer = new byte[512];
                while (input.read(buffer) >= 0) { /* drain shell output */ }
            } finally {
                mkdir.close();
            }
        }
        String command = "run-as " + context.getPackageName() + " cat " + privatePath
                + " > " + sharedPath;
        ParcelFileDescriptor descriptor = instrumentation.getUiAutomation().executeShellCommand(command);
        if (descriptor != null) {
            try (InputStream input = new FileInputStream(descriptor.getFileDescriptor())) {
                byte[] buffer = new byte[1024];
                while (input.read(buffer) >= 0) { /* drain shell output */ }
            } finally {
                descriptor.close();
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
