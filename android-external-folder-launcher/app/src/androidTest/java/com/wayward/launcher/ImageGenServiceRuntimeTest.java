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
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.net.Uri;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceResponse;
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
import java.io.SequenceInputStream;
import java.io.IOException;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.Base64;
import java.util.concurrent.atomic.AtomicBoolean;
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
        Activity homeActivity = null;
        boolean stopActionSent = false;
        CloudflareWorkerContractMock cloudflareMock = null;
        NotificationManager notifications =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);

        try {
            assertTrue("Test must run on Android 15/API 35", Build.VERSION.SDK_INT >= 35);
            assertTrue("This test requires a 64-bit Android ABI",
                    Build.SUPPORTED_64_BIT_ABIS != null && Build.SUPPORTED_64_BIT_ABIS.length > 0);

            grantNotificationPermission(instrumentation, context);
            // Isolate every CI run from any stale batch/cache result and stop a
            // leftover service before binding the fixed test port.
            try {
                context.startService(new Intent(context, ImageGenService.class)
                        .setAction(ImageGenService.ACTION_STOP));
            } catch (Exception ignored) {}
            awaitServerDown(15_000L);
            deleteTestTree(new File(context.getFilesDir(), "imagegen"));
            ImageGenStatusStore.write(context.getFilesDir(), false, false, false,
                    "CI runtime test reset", "");
            cloudflareMock = new CloudflareWorkerContractMock();
            configureCloudflareProvider(context, GAME_PROFILE_ID, cloudflareMock.endpoint());
            launcherActivity = instrumentation.startActivitySync(
                    new Intent(context, MainActivity.class)
                            .setData(Uri.parse("wayward://session/" + GAME_PROFILE_ID))
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NEW_DOCUMENT));
            assertNotNull("Launcher activity did not start", launcherActivity);
            setField(launcherActivity, "activeProfileId", GAME_PROFILE_ID);

            // Exercise the actual launcher-selected provider mode, including the
            // loopback-only authenticated adapter consumed by Image Studio jobs.
            Activity activityToStart = launcherActivity;
            Method startAction = MainActivity.class.getDeclaredMethod("startLauncherProviderServer");
            startAction.setAccessible(true);
            instrumentation.runOnMainSync(() -> {
                try {
                    startAction.invoke(activityToStart);
                } catch (Exception error) {
                    throw new RuntimeException("Could not invoke the launcher native-provider action", error);
                }
            });

            int initialHealth = awaitReachable(SERVER_START_TIMEOUT_MS);
            assertEquals("Bundled ARM64 Bun or the native provider adapter did not start. "
                    + startupLogs(context), 200, initialHealth);
            ImageGenStatusStore.State configured = ImageGenStatusStore.read(context.getFilesDir());
            long availabilityDeadline = System.currentTimeMillis() + 10_000L;
            while ((!configured.isAvailable() || !configured.isReady())
                    && System.currentTimeMillis() < availabilityDeadline) {
                Thread.sleep(100L);
                configured = ImageGenStatusStore.read(context.getFilesDir());
            }
            assertTrue("Native provider server did not report ready. " + startupLogs(context),
                    configured.isAvailable() && configured.isReady());
            assertEquals("The authenticated loopback provider adapter did not respond.",
                    200, requestStatus("http://127.0.0.1:8190/health", "GET", null));

            // The one-tap settings action now opens the active game WebView's
            // native Image Studio UI, not a separate review-page Activity. The
            // document-start bridge path is exercised against the local server below.

            // The NAI test token is saved later through the same document-start
            // WebView proxy used by the real Image Studio settings screen.
            String bunVersion = readText(new File(context.getFilesDir(), "imagegen/bun-version.log"));
            assertTrue("The test did not execute the pinned Android Bun 1.4.4 binary: " + bunVersion,
                    bunVersion.contains("1.4.4"));
            String serverLog = readText(new File(context.getFilesDir(), "imagegen/server.log"));
            assertTrue("The embedded wayward-imagegen server did not report listening: " + serverLog,
                    serverLog.contains("wayward-imagegen 0.8.4") && serverLog.toLowerCase().contains("listening"));

            // End-to-end: load the pinned Wayward WML page in the real launcher
            // WebView, submit through Image Studio's /api/batch/enqueue endpoint,
            // call Cloudflare through the authenticated native provider adapter,
            // save through JobRunner/cache, and read the result back through /api/pack.
            runCloudflareGamePageSmoke(instrumentation, context, launcherActivity, cloudflareMock.endpoint());
            assertTrue("The local Worker contract fixture received no native provider generation request.",
                    cloudflareMock.requestCount() > 0);
            homeActivity = verifyCrossTaskImageStudioSettingsRouting(
                    instrumentation, context, launcherActivity);
            restartImageGenServerWithKeystoreToken(instrumentation, context, launcherActivity);

            Activity homeToFinish = homeActivity;
            if (homeToFinish != null) instrumentation.runOnMainSync(homeToFinish::finish);
            homeActivity = null;
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
            if (homeActivity != null) {
                Activity activity = homeActivity;
                instrumentation.runOnMainSync(activity::finish);
            }
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
            if (cloudflareMock != null) cloudflareMock.close();
        }
    }

    /**
     * Quota-free local implementation of the Cloudflare Worker JSON contract.
     * The Android CI path still traverses ImageProviderClient, the authenticated
     * native adapter, ImageGen's normal cache, the production HTTPS image route,
     * and the real WML Image Studio portrait component. Live Worker inference is
     * kept in a separate opt-in workflow step to avoid burning daily free neurons.
     */
    private static final class CloudflareWorkerContractMock implements AutoCloseable {
        private final ServerSocket server;
        private final byte[] imageBytes;
        private final java.util.concurrent.atomic.AtomicInteger requests =
                new java.util.concurrent.atomic.AtomicInteger();
        private volatile boolean running = true;
        private final Thread acceptThread;

        CloudflareWorkerContractMock() throws Exception {
            server = new ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"));
            imageBytes = createFixturePng();
            acceptThread = new Thread(this::acceptLoop, "ci-cloudflare-worker-contract");
            acceptThread.setDaemon(true);
            acceptThread.start();
        }

        String endpoint() {
            return "http://127.0.0.1:" + server.getLocalPort();
        }

        int requestCount() { return requests.get(); }

        private void acceptLoop() {
            while (running) {
                try (Socket socket = server.accept()) {
                    socket.setSoTimeout(10_000);
                    handle(socket);
                } catch (IOException error) {
                    if (running) android.util.Log.e("WaywardCIWorkerMock",
                            "Contract worker request failed", error);
                }
            }
        }

        private void handle(Socket socket) throws IOException {
            InputStream input = socket.getInputStream();
            String requestLine = readHttpLine(input);
            if (requestLine == null || !requestLine.startsWith("POST ")) {
                writeResponse(socket, 405, "Method Not Allowed",
                        "{}");
                return;
            }
            int contentLength = 0;
            String header;
            while ((header = readHttpLine(input)) != null && !header.isEmpty()) {
                int colon = header.indexOf(':');
                if (colon > 0 && "content-length".equalsIgnoreCase(header.substring(0, colon).trim())) {
                    contentLength = Integer.parseInt(header.substring(colon + 1).trim());
                }
            }
            if (contentLength < 0 || contentLength > 64 * 1024) {
                writeResponse(socket, 413, "Payload Too Large",
                        "{}");
                return;
            }
            byte[] requestBody = new byte[contentLength];
            int offset = 0;
            while (offset < requestBody.length) {
                int count = input.read(requestBody, offset, requestBody.length - offset);
                if (count < 0) throw new IOException("Unexpected end of provider request body.");
                offset += count;
            }
            requests.incrementAndGet();
            JSONObject response = new JSONObject();
            try {
                response.put("success", true);
                response.put("image", Base64.getEncoder().encodeToString(imageBytes));
                response.put("mimeType", "image/png");
            } catch (Exception error) {
                throw new IOException("Could not serialize Worker contract response.", error);
            }
            writeResponse(socket, 200, "OK", response.toString());
        }

        private static String readHttpLine(InputStream input) throws IOException {
            ByteArrayOutputStream line = new ByteArrayOutputStream();
            int value;
            while ((value = input.read()) >= 0) {
                if (value == '\n') {
                    byte[] bytes = line.toByteArray();
                    int length = bytes.length;
                    if (length > 0 && bytes[length - 1] == '\r') length--;
                    return new String(bytes, 0, length, StandardCharsets.US_ASCII);
                }
                line.write(value);
                if (line.size() > 16 * 1024) throw new IOException("HTTP header line exceeds 16 KiB.");
            }
            return line.size() == 0 ? null : line.toString(StandardCharsets.US_ASCII.name());
        }

        private static void writeResponse(Socket socket, int status, String reason, String body)
                throws IOException {
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            OutputStream output = socket.getOutputStream();
            String headers = "HTTP/1.1 " + status + " " + reason + "\r\n"
                    + "Content-Type: application/json; charset=utf-8\r\n"
                    + "Content-Length: " + bytes.length + "\r\n"
                    + "Connection: close\r\n\r\n";
            output.write(headers.getBytes(StandardCharsets.US_ASCII));
            output.write(bytes);
            output.flush();
        }

        private static byte[] createFixturePng() throws Exception {
            Bitmap bitmap = Bitmap.createBitmap(384, 561, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bitmap);
            canvas.drawColor(Color.rgb(45, 31, 58));
            Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
            paint.setColor(Color.rgb(221, 158, 185));
            canvas.drawOval(111, 54, 273, 216, paint);
            paint.setColor(Color.rgb(82, 56, 105));
            canvas.drawRoundRect(72, 190, 312, 555, 92, 92, paint);
            paint.setColor(Color.rgb(237, 196, 208));
            canvas.drawRoundRect(127, 236, 257, 470, 44, 44, paint);
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            boolean encoded = bitmap.compress(Bitmap.CompressFormat.PNG, 100, output);
            bitmap.recycle();
            if (!encoded) throw new IOException("Could not encode the CI portrait PNG fixture.");
            return output.toByteArray();
        }

        @Override public void close() {
            running = false;
            try { server.close(); } catch (IOException ignored) {}
            try { acceptThread.join(1500L); } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
        }
    }


    private static void deleteTestTree(File file) {
        if (file == null || !file.exists()) return;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) for (File child : children) deleteTestTree(child);
        }
        if (!file.delete() && file.exists()) {
            throw new IllegalStateException("Could not reset ImageGen CI directory: " + file.getAbsolutePath());
        }
    }

    private static final String GAME_PROFILE_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private static final String FLUX_PROVIDER_ID = "0123456789abcdef0123456789abcdef";
    private static final String FLUX_ENDPOINT = "https://wayward-image-worker.trpgengine.workers.dev";
    private static final String GAME_ORIGIN = "https://localhost:38123";

    private static WebResourceResponse serveBundledWmlResource(
            MainActivity activity, ZipModStore zipMods, String relative, String origin) throws Exception {
        Class<?> safTreeClass = Class.forName(MainActivity.class.getName() + "$SafTree");
        Class<?> handlerClass = Class.forName(MainActivity.class.getName() + "$FolderHandler");
        java.lang.reflect.Constructor<?> constructor = handlerClass.getDeclaredConstructor(
                safTreeClass, android.content.res.AssetManager.class, ZipModStore.class, String.class);
        constructor.setAccessible(true);
        Object handler = constructor.newInstance(null, activity.getAssets(), zipMods, origin);
        Method serve = handlerClass.getDeclaredMethod("serveGamePath", String.class);
        serve.setAccessible(true);
        return (WebResourceResponse) serve.invoke(handler, relative);
    }

    private static void runCloudflareGamePageSmoke(
            Instrumentation instrumentation, Context context, Activity activity,
            String providerEndpoint) throws Exception {
        String resultSummary = "state=not_started";
        WebView[] webHolder = new WebView[1];
        CountDownLatch pageFinished = new CountDownLatch(1);
        CountDownLatch storageResetFinished = new CountDownLatch(1);
        AtomicReference<String> pageError = new AtomicReference<>("");
        AtomicBoolean imageStudioScriptServed = new AtomicBoolean(false);
        AtomicBoolean imageSearchScriptServed = new AtomicBoolean(false);
        AtomicBoolean wmlCoreScriptServed = new AtomicBoolean(false);
        AtomicBoolean wmlSymbolsScriptServed = new AtomicBoolean(false);
        AtomicBoolean wmlModsManifestServed = new AtomicBoolean(false);
        AtomicBoolean wmlLocaleBundleMissing = new AtomicBoolean(false);
        ConcurrentLinkedQueue<String> moduleRequests = new ConcurrentLinkedQueue<>();
        File artifactDirectory = new File(context.getFilesDir(), "ci-artifacts");
        if (!artifactDirectory.isDirectory() && !artifactDirectory.mkdirs()) {
            throw new IllegalStateException("Could not create private CI artifact directory.");
        }

        try {
            configureCloudflareProvider(context, GAME_PROFILE_ID, providerEndpoint);

            // Install the exact pinned Image Studio 1.31.20 release ZIP into
            // the launcher's app-private ZIP store. This exercises the real
            // 320,679-byte WML entrypoint rather than a synthetic WML.define.
            MainActivity launcher = (MainActivity) activity;
            ZipModStore zipMods = (ZipModStore) getField(launcher, "zipMods");
            assertNotNull("The launcher's app-private ZIP mod store was not initialized.", zipMods);
            File stagedImageStudioZip = zipMods.temporaryFile("ci-imagestudio-1.31.20");
            try (InputStream input = instrumentation.getContext().getAssets().open(
                    "imagestudio-source/imagestudio-1.31.20-20261101.zip");
                 OutputStream output = new FileOutputStream(stagedImageStudioZip)) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) >= 0) {
                    if (count > 0) output.write(buffer, 0, count);
                }
                output.flush();
            }
            ZipModStore.ModInfo realModInfo = ZipModStore.inspect(stagedImageStudioZip);
            assertEquals("The pinned Image Studio release ZIP resolved the wrong WML ID.",
                    "imagestudio", realModInfo.id);
            zipMods.install(stagedImageStudioZip);
            assertTrue("The real Image Studio ZIP was not registered in the app-private mod list.",
                    zipMods.listModIds().contains("imagestudio"));
            ByteArrayOutputStream realModSource = new ByteArrayOutputStream();
            try (InputStream input = zipMods.open("wml/mods/imagestudio/mod.js")) {
                assertNotNull("The Image Studio WML entrypoint was not served by the production ZIP reader.", input);
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) >= 0) {
                    if (count > 0) realModSource.write(buffer, 0, count);
                }
            }
            byte[] realModBytes = realModSource.toByteArray();
            assertEquals("The installed release ZIP did not serve the full production mod.js.",
                    320_679, realModBytes.length);
            byte[] moduleDigest = java.security.MessageDigest.getInstance("SHA-256").digest(realModBytes);
            StringBuilder moduleSha256 = new StringBuilder();
            for (byte value : moduleDigest) {
                moduleSha256.append(String.format(java.util.Locale.ROOT, "%02x", value & 0xff));
            }
            assertEquals("The Image Studio 1.31.20 source differs from the exact pinned mods.zip entry.",
                    "18e6851a03b27c4ccedb53e86465e6abcd6c09254cb881c9fa7abb16574890ef",
                    moduleSha256.toString());
            String realModText = new String(realModBytes, StandardCharsets.UTF_8);
            assertTrue("The served production mod.js no longer declares Image Studio 1.31.20.",
                    realModText.contains("imagestudio")
                            && realModText.contains("1.31.20"));
            assertTrue("The WML 0.9.5 native settings API call was lost from the production module.",
                    realModText.contains("return base.ui.pauseSettings("));

            // The actual WebView ZIP-serving path must return the exact module
            // bytes stored in the user's mods.zip, without a legacy API rewrite.
            ByteArrayOutputStream servedModSource = new ByteArrayOutputStream();
            try (InputStream input = zipMods.open("wml/mods/imagestudio/mod.js")) {
                assertNotNull("The WebView Image Studio entrypoint was not served.", input);
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) >= 0) {
                    if (count > 0) servedModSource.write(buffer, 0, count);
                }
            }
            assertTrue("The launcher modified the pinned Image Studio 1.31.20 source before WebView delivery.",
                    java.util.Arrays.equals(realModBytes, servedModSource.toByteArray()));
            Method detectImageStudio = MainActivity.class.getDeclaredMethod(
                    "imageStudioModId", Class.forName("com.wayward.launcher.MainActivity$SafTree"));
            detectImageStudio.setAccessible(true);
            assertEquals("The production launcher detector did not recognize the installed ZIP module.",
                    "imagestudio", detectImageStudio.invoke(launcher, new Object[]{null}));

            // Image Studio 1.31.20 intentionally delegates portrait lookup and
            // display to image-search-customize. Install that exact module plus
            // its pinned WML prerequisites from the same source archive.
            String[][] runtimeModules = new String[][]{
                    {"addon-compat", "imagestudio-source/wml-mods/addon-compat.zip"},
                    {"attention-image-prompt", "imagestudio-source/wml-mods/attention-image-prompt.zip"},
                    {"image-look", "imagestudio-source/wml-mods/image-look.zip"},
                    {"image-search-customize", "imagestudio-source/wml-mods/image-search-customize.zip"}
            };
            for (String[] module : runtimeModules) {
                File staged = zipMods.temporaryFile("ci-" + module[0]);
                try (InputStream input = instrumentation.getContext().getAssets().open(module[1]);
                     OutputStream output = new FileOutputStream(staged)) {
                    byte[] buffer = new byte[8192];
                    int count;
                    while ((count = input.read(buffer)) >= 0) {
                        if (count > 0) output.write(buffer, 0, count);
                    }
                    output.flush();
                }
                ZipModStore.ModInfo moduleInfo = ZipModStore.inspect(staged);
                assertEquals("Pinned WML runtime module resolved the wrong ID: " + module[0],
                        module[0], moduleInfo.id);
                zipMods.install(staged);
                assertTrue("Pinned WML runtime module was not registered: " + module[0],
                        zipMods.listModIds().contains(module[0]));
            }

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
            if (gameHtml.length != 4_373_978) {
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
                    Method serveGeneratedImageRoute = MainActivity.class.getDeclaredMethod(
                            "serveGeneratedImageRequest", String.class, java.util.concurrent.atomic.AtomicInteger.class);
                    serveGeneratedImageRoute.setAccessible(true);
                    java.util.concurrent.atomic.AtomicInteger generatedImageDiagnosticSamples =
                            new java.util.concurrent.atomic.AtomicInteger();
                    WebSettings settings = gameWeb.getSettings();
                    settings.setJavaScriptEnabled(true);
                    settings.setDomStorageEnabled(true);
                    settings.setDatabaseEnabled(true);
                    settings.setAllowFileAccess(false);
                    settings.setAllowContentAccess(false);
                    settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
                    gameWeb.setBackgroundColor(android.graphics.Color.WHITE);
                    gameWeb.setWebViewClient(new WebViewClient() {
                        @Override public WebResourceResponse shouldInterceptRequest(
                                WebView view, android.webkit.WebResourceRequest request) {
                            Uri requestUri = request == null ? null : request.getUrl();
                            String requestPath = requestUri == null ? null : requestUri.getPath();
                            if (requestUri != null
                                    && "localhost".equalsIgnoreCase(requestUri.getHost())
                                    && requestUri.getPort() == 38123
                                    && requestPath != null
                                    && requestPath.startsWith("/images/__wayward_generated__/")) {
                                try {
                                    WebResourceResponse generated = (WebResourceResponse) serveGeneratedImageRoute.invoke(
                                            main, requestPath, generatedImageDiagnosticSamples);
                                    if (generated == null) {
                                        throw new IllegalStateException("Native generated-image route returned null.");
                                    }
                                    return generated;
                                } catch (Exception error) {
                                    pageError.set("Native generated-image route: " + error.getMessage());
                                    return new WebResourceResponse("text/plain", "UTF-8", 500, "Route Error",
                                            java.util.Collections.emptyMap(),
                                            new java.io.ByteArrayInputStream(
                                                    String.valueOf(error.getMessage()).getBytes(StandardCharsets.UTF_8)));
                                }
                            }
                            String zipPath = null;
                            if (requestPath != null
                                    && (requestPath.contains("/mods/") || requestPath.endsWith(".js"))) {
                                moduleRequests.add(requestUri.toString());
                            }
                            if (requestPath != null && requestPath.startsWith("/game/wml/mods/")) {
                                zipPath = requestPath.substring("/game/".length());
                            } else if (requestPath != null && requestPath.startsWith("/wml/mods/")) {
                                zipPath = requestPath.substring(1);
                            }
                            if (zipPath != null) {
                                try {
                                    InputStream entry = zipMods.open(zipPath);
                                    if (entry != null) {
                                        if ("wml/mods/imagestudio/mod.js".equals(zipPath)) {
                                            imageStudioScriptServed.set(true);
                                        } else if ("wml/mods/image-search-customize/mod.js".equals(zipPath)) {
                                            imageSearchScriptServed.set(true);
                                        }
                                        String mime = zipPath.endsWith(".js") ? "application/javascript"
                                                : zipPath.endsWith(".json") ? "application/json"
                                                : zipPath.endsWith(".css") ? "text/css" : "application/octet-stream";
                                        return new WebResourceResponse(mime, "UTF-8", 200, "OK",
                                                java.util.Collections.emptyMap(), entry);
                                    }
                                } catch (Exception error) {
                                    pageError.set("ZIP WML module " + zipPath + ": " + error.getMessage());
                                }
                            }

                            // Match MainActivity.FolderHandler: serve the pinned WML runtime tree,
                            // and prepend the exact launcher folder bootstrap before wml-core.js.
                            String wmlRelative = null;
                            if (requestPath != null && requestPath.startsWith("/game/wml/")) {
                                wmlRelative = requestPath.substring("/game/".length());
                            } else if (requestPath != null && requestPath.startsWith("/wml/")) {
                                wmlRelative = requestPath.substring(1);
                            }
                            if (wmlRelative != null && wmlRelative.startsWith("wml/i18n/ko/")) {
                                // Wayward 11.2 ships the 0.9.5 core but not the optional
                                // Korean translation sidecars. Return a subresource 404 so
                                // the real core boots in its documented English fallback;
                                // do not mistake this packaging omission for a core failure.
                                wmlLocaleBundleMissing.set(true);
                                // The published Wayward 11.2 archive omits the optional Korean WML
                                // translation sidecars referenced by this Korean HTML. Preserve the game's
                                // intended WML language so Korean-only modules are not silently defaulted off.
                                String localeShim = "window.WML_I18N=Object.assign({},window.WML_I18N||{},{lang:'ko'});";
                                return new WebResourceResponse("application/javascript", "UTF-8",
                                        200, "OK", java.util.Collections.emptyMap(),
                                        new java.io.ByteArrayInputStream(localeShim.getBytes(StandardCharsets.UTF_8)));
                            }
                            if ("wml/mods/mods.js".equals(wmlRelative)) {
                                try {
                                    InputStream fixture = instrumentation.getContext().getAssets()
                                            .open("wml-runtime/" + wmlRelative);
                                    wmlModsManifestServed.set(true);
                                    return new WebResourceResponse("application/javascript", "UTF-8", 200, "OK",
                                            java.util.Collections.emptyMap(), fixture);
                                } catch (Exception error) {
                                    pageError.set("WML runtime fixture " + wmlRelative + ": " + error.getMessage());
                                }
                            }
                            if ("wml/symbols/2026-11-01.js".equals(wmlRelative)) {
                                try {
                                    WebResourceResponse symbolTable = serveBundledWmlResource(
                                            main, zipMods, wmlRelative, GAME_ORIGIN);
                                    if (symbolTable != null && symbolTable.getStatusCode() == 200) {
                                        wmlSymbolsScriptServed.set(true);
                                        return symbolTable;
                                    }
                                    pageError.set("Bundled WML symbol table was not served: " + wmlRelative);
                                } catch (Exception error) {
                                    pageError.set("Bundled WML symbol table: " + error.getMessage());
                                }
                            }
                            if ("wml/runtime/wml-core.js".equals(wmlRelative)) {
                                try {
                                    InputStream bootstrap = main.getAssets().open("wml-folder-bootstrap.js");
                                    InputStream core = instrumentation.getContext().getAssets()
                                            .open("wml-runtime/wml/runtime/wml-core.js");
                                    wmlCoreScriptServed.set(true);
                                    return new WebResourceResponse("application/javascript", "UTF-8", 200, "OK",
                                            java.util.Collections.emptyMap(), new SequenceInputStream(bootstrap, core));
                                } catch (Exception error) {
                                    pageError.set("WML core/bootstrap fixture: " + error.getMessage());
                                }
                            }
                            return super.shouldInterceptRequest(view, request);
                        }
                        @Override public void onPageFinished(WebView view, String url) {
                            if (url != null && url.contains("__wayward_ci_storage_reset__")) {
                                storageResetFinished.countDown();
                            } else {
                                pageFinished.countDown();
                            }
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
                    // openProfileSession() normally records the current ZIP revision
                    // before the session WebView is shown. This test builds the
                    // WebView directly, so mirror that production invariant; otherwise
                    // onResume() reloads the fixture page when the second document
                    // task starts and silently removes the injected settings button.
                    long zipRevision = main.getSharedPreferences(
                            "wayward_launcher", Context.MODE_PRIVATE).getLong("zip_mod_revision", 0L);
                    setField(main, "loadedZipRevision", zipRevision);
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
                    // This test uses a fixed localhost origin. Clear browser-persisted
                    // consent and WML toggles before loading the real game so a previous
                    // CI session cannot silently hide the age gate or turn Image Studio off.
                    String resetHtml = "<!doctype html><html><head><meta charset='utf-8'></head>"
                            + "<body><script>localStorage.clear();sessionStorage.clear();"
                            + "localStorage.setItem('wml.toggles',JSON.stringify({imagestudio:true}));"
                            + "</script></body></html>";
                    gameWeb.loadDataWithBaseURL(
                            GAME_ORIGIN + "/game/__wayward_ci_storage_reset__.html",
                            resetHtml, "text/html", "UTF-8", null);
                } catch (Throwable error) {
                    pageError.set(error.getClass().getSimpleName() + ": " + error.getMessage());
                    pageFinished.countDown();
                }
            });

            WebView gameWeb = webHolder[0];
            assertNotNull("The launcher WebView was not created: " + pageError.get(), gameWeb);
            assertTrue("Could not clear the isolated Wayward WebView origin.",
                    storageResetFinished.await(10, TimeUnit.SECONDS));
            String clearedStorage = awaitJsString(instrumentation, gameWeb,
                    "(function(){var before=Object.keys(localStorage);localStorage.clear();sessionStorage.clear();"
                            + "return JSON.stringify({before:before,local:localStorage.length,session:sessionStorage.length});})()",
                    5_000L);
            JSONObject storageState = new JSONObject(clearedStorage);
            if (storageState.optInt("local", -1) != 0 || storageState.optInt("session", -1) != 0) {
                throw new IllegalStateException("Wayward CI browser storage did not reset: " + clearedStorage);
            }
            instrumentation.runOnMainSync(() -> gameWeb.loadDataWithBaseURL(
                    GAME_ORIGIN + "/game/Wayward_WML_ko.html",
                    new String(gameHtml, StandardCharsets.UTF_8),
                    "text/html", "UTF-8", null));
            assertTrue("Pinned Wayward game page did not finish loading: " + pageError.get(),
                    pageFinished.await(90, TimeUnit.SECONDS));
            dismissWaywardAgeConfirmation(instrumentation, gameWeb);

            // A newly opened HTML document starts at Wayward's title menu.
            // WML's game-scoped mods are not requested until the user actually
            // starts a game. Tap the real title-menu button before asserting
            // Image Studio module registration.
            String newGameAction = awaitJsString(instrumentation, gameWeb,
                    "(function(){var button=Array.from(document.querySelectorAll('button,[role=button]'))"
                            + ".find(function(node){return String(node.innerText||node.textContent||'').replace(/\\\\s+/g,' ').trim()==='새 게임';});"
                            + "if(!button)return 'new_game_button_missing';button.click();return 'new_game_clicked';})()",
                    10_000L);
            assertEquals("Wayward did not expose its real 새 게임 action on the title page.",
                    "new_game_clicked", newGameAction);
            Thread.sleep(500L);
            String skipIntro = awaitJsString(instrumentation, gameWeb,
                    "(function(){var button=Array.from(document.querySelectorAll('button,[role=button]'))"
                            + ".find(function(node){return String(node.innerText||node.textContent||'').replace(/\\\\s+/g,' ').trim()==='건너뛰기';});"
                            + "if(!button)return 'no_skip';button.click();return 'intro_skipped';})()",
                    5_000L);
            System.out.println("WAYWARD_TITLE_START " + newGameAction + " " + skipIntro);

            String selectedCharacter = awaitJsString(instrumentation, gameWeb,
                    "(function(){"
                            + "var visible=function(e){var r=e.getBoundingClientRect(),s=getComputedStyle(e);return e.getClientRects().length>0&&r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};"
                            + "var radios=Array.from(document.querySelectorAll('input[type=radio]'));"
                            + "var radio=radios.find(function(e){var root=e.closest('label')||e.parentElement&&e.parentElement.parentElement;return root&&String(root.innerText||root.textContent||'').includes('엘레나')&&visible(e);});"
                            + "if(radio){radio.click();return 'elena_radio_clicked';}"
                            + "var nodes=Array.from(document.querySelectorAll('button,[role=button],label,[role=radio],input,div'));"
                            + "var card=nodes.find(function(e){return visible(e)&&String(e.innerText||e.textContent||'').replace(/\\\\s+/g,' ').trim().startsWith('엘레나')&&(e.matches('button,label,[role=button],[role=radio]')||e.querySelector('input[type=radio]'));});"
                            + "if(!card)return 'elena_card_missing radios='+radios.length+' labels='+Array.from(document.querySelectorAll('label')).map(function(e){return String(e.innerText||e.textContent||'').trim().slice(0,100);}).join('|');"
                            + "var nested=card.querySelector('input[type=radio]');if(nested)nested.click();else card.click();return 'elena_card_clicked';"
                            + "})()",
                    10_000L);
            assertTrue("Could not select Elena on the actual new-game character screen: " + selectedCharacter,
                    selectedCharacter.endsWith("_clicked"));
            String continueCharacter = "";
            long continueDeadline = System.currentTimeMillis() + 15_000L;
            while (System.currentTimeMillis() < continueDeadline) {
                continueCharacter = awaitJsString(instrumentation, gameWeb,
                        "(function(){var button=Array.from(document.querySelectorAll('button,[role=button]')).find(function(e){"
                                + "var t=String(e.innerText||e.textContent||'').replace(/\\\\s+/g,' ').trim();"
                                + "return t.includes('계속할 캐릭터')||t.includes('계속하기')||t==='계속';});"
                                + "if(!button)return 'continue_button_missing';"
                                + "return button.disabled||button.getAttribute('aria-disabled')==='true'?'continue_disabled':'continue_ready';})()",
                        5_000L);
                if ("continue_ready".equals(continueCharacter)) break;
                Thread.sleep(200L);
            }
            assertEquals("Selecting Elena did not enable the new-game continue action.",
                    "continue_ready", continueCharacter);
            String continueClicked = awaitJsString(instrumentation, gameWeb,
                    "(function(){var button=Array.from(document.querySelectorAll('button,[role=button]')).find(function(e){"
                            + "var t=String(e.innerText||e.textContent||'').replace(/\\\\s+/g,' ').trim();"
                            + "return (t.includes('계속할 캐릭터')||t.includes('계속하기')||t==='계속')&&!e.disabled;});"
                            + "if(!button)return 'continue_button_missing';button.click();return 'continue_clicked';})()",
                    10_000L);
            assertEquals("The launcher could not advance from Elena's character selection.",
                    "continue_clicked", continueClicked);
            System.out.println("WAYWARD_CHARACTER_START " + selectedCharacter + " "
                    + continueCharacter + " " + continueClicked);

            long moduleLoadDeadline = System.currentTimeMillis() + 45_000L;
            while (System.currentTimeMillis() < moduleLoadDeadline
                    && (!imageStudioScriptServed.get() || !imageSearchScriptServed.get()
                            || !wmlSymbolsScriptServed.get())) {
                Thread.sleep(150L);
            }
            assertTrue("The real pinned WML core was not served with the launcher folder bootstrap. "
                    + "page=" + pageError.get(), wmlCoreScriptServed.get());
            assertTrue("The real pinned WML mods.js manifest was not served. page=" + pageError.get(),
                    wmlModsManifestServed.get());
            assertTrue("The launcher did not serve the bundled 2026-11-01 WML symbol table. page="
                    + pageError.get() + " requests=" + moduleRequests, wmlSymbolsScriptServed.get());
            assertTrue("The game WML loader did not request the real Image Studio module. "
                    + "served=" + imageStudioScriptServed.get() + " page=" + pageError.get()
                    + " requests=" + moduleRequests,
                    imageStudioScriptServed.get());
            assertTrue("The game WML loader did not request the real image-search-customize portrait module. "
                    + "served=" + imageSearchScriptServed.get() + " page=" + pageError.get()
                    + " requests=" + moduleRequests,
                    imageSearchScriptServed.get());

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

            // Save the test-only NovelAI token through the exact WebView fetch
            // path used by Image Studio. This must pass through ImageGenProxy,
            // write to Android Keystore, and never remain in anima-settings.json.
            String saveDispatch = "(function(){"
                    + "window.__waywardCiNaiSave={state:'pending'};"
                    + "fetch('http://127.0.0.1:8189/api/generation/settings',{"
                    + "method:'PUT',headers:{'Content-Type':'application/json'},"
                    + "body:JSON.stringify({imageProvider:'nai',naiToken:'ci-smoke-token-not-valid'})"
                    + "}).then(async function(response){"
                    + "var body=await response.json().catch(function(){return {};});"
                    + "window.__waywardCiNaiSave={state:'done',status:response.status,"
                    + "configured:!!(body.settings&&body.settings.naiTokenConfigured),"
                    + "model:body.settings&&body.settings.naiModel};"
                    + "}).catch(function(error){window.__waywardCiNaiSave={state:'error',message:String(error).slice(0,160)};});"
                    + "return 'dispatched';})()";
            assertEquals("The Android WebView did not dispatch the NovelAI settings save.",
                    "dispatched", awaitJsString(instrumentation, gameWeb, saveDispatch, 10_000L));
            JSONObject naiSave = new JSONObject();
            long naiSaveDeadline = System.currentTimeMillis() + 30_000L;
            while (System.currentTimeMillis() < naiSaveDeadline) {
                naiSave = new JSONObject(awaitJsString(instrumentation, gameWeb,
                        "JSON.stringify(window.__waywardCiNaiSave||{state:'pending'})", 10_000L));
                if (!"pending".equals(naiSave.optString("state", ""))) break;
                Thread.sleep(100L);
            }
            assertEquals("NovelAI settings were not saved through the Android WebView proxy: " + naiSave,
                    "done", naiSave.optString("state", ""));
            assertEquals("NovelAI settings API returned an unexpected status: " + naiSave,
                    200, naiSave.optInt("status", -1));
            assertTrue("The NovelAI settings response did not mark the token as configured: " + naiSave,
                    naiSave.optBoolean("configured", false));
            assertEquals("The test must use the launcher's V4.5 Full default.",
                    "nai-diffusion-4-5-full", naiSave.optString("model", ""));
            assertEquals("The WebView proxy did not store the NovelAI token in Android Keystore.",
                    "ci-smoke-token-not-valid", ImageProviderStore.readNovelAiToken(context));
            File naiSettingsFile = new File(context.getFilesDir(), "imagegen/state/anima-settings.json");
            String naiSettingsOnDisk = readText(naiSettingsFile);
            assertTrue("The NovelAI token was written in plaintext to anima-settings.json.",
                    !naiSettingsOnDisk.contains("ci-smoke-token-not-valid"));
            assertEquals("ImageGen did not become generation-ready after the settings save.",
                    200, awaitStatus(200, 30_000L));

            // Exercise the actual WW_ImageStudioBridge registered by the
            // pinned WML Image Studio module. No fake bridge or fake settings
            // button is installed into the game page.
            String builderUiDiagnostics = awaitJsString(instrumentation, gameWeb,
                    "(function(){"
                            + "var visible=function(e){var r=e.getBoundingClientRect(),s=getComputedStyle(e);return e.getClientRects().length>0&&r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0;};"
                            + "var scrollers=Array.from(document.querySelectorAll('body *')).filter(function(e){var s=getComputedStyle(e);return e.scrollHeight>e.clientHeight+80&&/(auto|scroll)/.test(s.overflowY);}).map(function(e){return {tag:e.tagName,id:e.id,cls:String(e.className||'').slice(0,80),top:e.scrollTop,height:e.clientHeight,total:e.scrollHeight};}).slice(0,30);"
                            + "var buttons=Array.from(document.querySelectorAll('button,[role=button],input[type=button]')).map(function(e){var r=e.getBoundingClientRect();return {text:String(e.innerText||e.value||e.textContent||'').replace(/\\\\s+/g,' ').trim().slice(0,100),disabled:!!e.disabled,visible:visible(e),top:Math.round(r.top),bottom:Math.round(r.bottom)};}).filter(function(e){return e.text;});"
                            + "return JSON.stringify({title:document.title,bodyText:String(document.body.innerText||'').slice(-2500),buttons:buttons,scrollers:scrollers});})()",
                    10_000L);
            resultSummary = "state=builder_ui_diagnostics\\n" + builderUiDiagnostics + "\\n";

            String wmlBridgeDiagnostics = awaitJsString(instrumentation, gameWeb,
                    "(function(){"
                            + "var bridge=window.WW_ImageStudioBridge;"
                            + "var status=window.WML&&typeof window.WML.status==='function'?window.WML.status():null;"
                            + "return JSON.stringify({"
                            + "bridgeType:typeof bridge,bridgeIsNull:bridge===null,bridgeKeys:bridge?Object.keys(bridge):[],"
                            + "charactersType:bridge?typeof bridge.characters:'missing',"
                            + "studioType:typeof window.WW_ImageStudio,"
                            + "wmlVersion:window.WML?window.WML.VERSION:null,"
                            + "localeBundleMissing:" + wmlLocaleBundleMissing.get() + ","
                            + "officialSymbols:status&&status.symbols&&status.symbols.symbols?{"
                            + "setScene:status.symbols.symbols.setScene&&status.symbols.symbols.setScene.name,"
                            + "heroineDriveCalc:status.symbols.symbols.heroineDriveCalc&&status.symbols.symbols.heroineDriveCalc.name,"
                            + "imageLookup:status.symbols.symbols.imageLookup&&status.symbols.symbols.imageLookup.name,"
                            + "imageEntryUrl:status.symbols.symbols.imageEntryUrl&&status.symbols.symbols.imageEntryUrl.name,"
                            + "imageUsagePortraitPanel:status.symbols.symbols.imageUsagePortraitPanel&&status.symbols.symbols.imageUsagePortraitPanel.name}:null,"
                            + "wml:status?{game:status.game,booted:status.booted,listed:status.listed,"
                            + "loaded:status.loaded,failed:status.failed,warnings:status.warnings,missing:status.missing,"
                            + "unread:status.unread,defaultOff:status.defaultOff,installed:status.installed,"
                            + "order:status.order,lang:status.lang,modLangs:status.langs&&status.langs.imagestudio,"
                            + "symbolsGame:status.symbols&&status.symbols.game,modSymbolIds:Object.keys(status.modSymbols||{})}:null,"
                            + "bootSetups:window.WML&&window.WML.bootReport?window.WML.bootReport().data.setups.filter(function(item){return item.id==='imagestudio'||item.id==='image-search-customize'||item.id==='attention-image-prompt'||item.id==='addon-compat';}):null,"
                            + "imageStudioScriptServed:" + imageStudioScriptServed.get() + ","
                            + "imageSearchScriptServed:" + imageSearchScriptServed.get() + ","
                            + "moduleRequests:" + new org.json.JSONArray(moduleRequests).toString() + ","
                            + "folderMods:localStorage.getItem('wml.folders')"
                            + "});})()",
                    10_000L);
            resultSummary = "state=wml_bridge_diagnostics\\n" + wmlBridgeDiagnostics + "\\n";
            JSONObject wmlBridgeState = new JSONObject(wmlBridgeDiagnostics);
            assertEquals("The real Image Studio module did not install a non-null global bridge. "
                            + wmlBridgeDiagnostics,
                    "object", wmlBridgeState.optString("bridgeType", ""));
            assertTrue("The Image Studio global bridge is still the launcher's uninitialized null placeholder. "
                            + wmlBridgeDiagnostics, !wmlBridgeState.optBoolean("bridgeIsNull", true));
            assertEquals("The pinned Image Studio bridge does not expose its real character collector. "
                            + wmlBridgeDiagnostics,
                    "function", wmlBridgeState.optString("charactersType", ""));
            JSONObject wmlState = wmlBridgeState.optJSONObject("wml");
            assertNotNull("The pinned WML runtime did not expose its boot diagnostics: " + wmlBridgeDiagnostics,
                    wmlState);
            assertTrue("WML did not complete a game boot before Image Studio was inspected: "
                            + wmlBridgeDiagnostics,
                    wmlState.optBoolean("booted", false));
            assertEquals("The launcher did not load the exact WML 0.9.5 core from Wayward 11.2. "
                            + wmlBridgeDiagnostics,
                    "0.9.5", wmlBridgeState.optString("wmlVersion", ""));
            assertTrue("The test must record the package's omitted Korean WML translation sidecars. "
                            + wmlBridgeDiagnostics,
                    wmlBridgeState.optBoolean("localeBundleMissing", false));
            assertEquals("The Korean HTML fixture was incorrectly booted in English, disabling Korean-only mods. "
                            + wmlBridgeDiagnostics,
                    "ko", wmlState.optString("lang", ""));
            JSONObject officialSymbols = wmlBridgeState.optJSONObject("officialSymbols");
            assertNotNull("The launcher did not register the merged 2026-11-01 symbol table. "
                            + wmlBridgeDiagnostics, officialSymbols);
            assertEquals("Official WML 0.9.5 setScene mapping is wrong.", "aie",
                    officialSymbols.optString("setScene", ""));
            assertEquals("Official WML 0.9.5 heroineDriveCalc mapping is wrong.", "il",
                    officialSymbols.optString("heroineDriveCalc", ""));
            assertEquals("Image Studio imageLookup hook mapping is missing.", "vy",
                    officialSymbols.optString("imageLookup", ""));
            assertEquals("Image Studio imageEntryUrl hook mapping is missing.", "o_",
                    officialSymbols.optString("imageEntryUrl", ""));
            assertEquals("Image Studio portrait panel hook mapping is missing.", "rv",
                    officialSymbols.optString("imageUsagePortraitPanel", ""));
            assertEquals("The bundled 2026-11-01 semantic symbol table was not registered: "
                            + wmlBridgeDiagnostics,
                    "2026-11-01", wmlState.optString("symbolsGame", ""));
            JSONObject setupById = new JSONObject();
            org.json.JSONArray bootSetups = wmlBridgeState.optJSONArray("bootSetups");
            if (bootSetups != null) {
                for (int index = 0; index < bootSetups.length(); index++) {
                    JSONObject setup = bootSetups.optJSONObject(index);
                    if (setup != null) setupById.put(setup.optString("id"), setup);
                }
            }
            assertEquals("The official Image Studio WML module did not finish setup: " + wmlBridgeDiagnostics,
                    "ok", setupById.optJSONObject("imagestudio") == null ? "" :
                            setupById.optJSONObject("imagestudio").optString("result", ""));
            assertTrue("WML did not load the pinned imagestudio module: " + wmlBridgeDiagnostics,
                    wmlState.optJSONArray("loaded") != null
                            && containsJsonString(wmlState.optJSONArray("loaded"), "imagestudio"));
            assertTrue("WML did not load attention-image-prompt after registering the shared symbols: "
                            + wmlBridgeDiagnostics,
                    containsJsonString(wmlState.optJSONArray("loaded"), "attention-image-prompt"));
            assertTrue("WML did not load image-search-customize after registering the shared symbols: "
                            + wmlBridgeDiagnostics,
                    containsJsonString(wmlState.optJSONArray("loaded"), "image-search-customize"));
            // The settings launcher button is rendered inside the Image Studio panel.
            // openGenerationSettings() opens that panel first, so observe clicks at the
            // document level instead of requiring the panel button before it exists.
            String observeSettingsButton = "(function(){"
                    + "window.__waywardCiSettingsClicks=0;"
                    + "document.addEventListener('click',function(event){"
                    + "var target=event.target&&event.target.closest?event.target.closest('#wwis-generation-settings'):null;"
                    + "if(target)window.__waywardCiSettingsClicks++;"
                    + "},true);"
                    + "return 'observing';})()";
            assertEquals("The Android test could not install the settings-button click observer.",
                    "observing", awaitJsString(instrumentation, gameWeb, observeSettingsButton, 10_000L));

            String settingsDispatch = "(function(){"
                    + "window.__waywardCiSettings={state:'pending'};"
                    + "window.WaywardLauncherImageStudio.openGenerationSettings()"
                    + ".then(function(result){window.__waywardCiSettings=result;})"
                    + ".catch(function(error){window.__waywardCiSettings={ok:false,reason:String(error)};});"
                    + "return 'dispatched';})()";
            assertEquals("The Android test did not dispatch the real settings bridge.",
                    "dispatched", awaitJsString(instrumentation, gameWeb, settingsDispatch, 10_000L));
            JSONObject settingsResult = new JSONObject();
            long settingsDeadline = System.currentTimeMillis() + 10_000L;
            while (System.currentTimeMillis() < settingsDeadline) {
                settingsResult = new JSONObject(awaitJsString(instrumentation, gameWeb,
                        "JSON.stringify(window.__waywardCiSettings||{state:'pending'})", 10_000L));
                if (!"pending".equals(settingsResult.optString("state", ""))) break;
                Thread.sleep(100L);
            }
            assertTrue("The Image Studio settings bridge did not click the in-game settings button: "
                    + settingsResult, settingsResult.optBoolean("ok", false));
            String clicked = awaitJsString(instrumentation, gameWeb,
                    "String(window.__waywardCiSettingsClicks||0)", 5_000L);
            assertEquals("The real Image Studio settings button did not receive a click.", "1", clicked);

            // The real settings editor opens an overlay above the game. Wait for
            // its loaded navigation control, then close it through its real close
            // button so the subsequent portrait screenshot shows the game UI.
            long settingsReadyDeadline = System.currentTimeMillis() + 15_000L;
            String settingsReady = "false";
            while (System.currentTimeMillis() < settingsReadyDeadline) {
                settingsReady = awaitJsString(instrumentation, gameWeb,
                        "String(!!document.querySelector('#wwis-overlay #wwis-settings-back'))", 5_000L);
                if ("true".equals(settingsReady)) break;
                Thread.sleep(150L);
            }
            assertEquals("The real Image Studio generation settings did not finish loading.",
                    "true", settingsReady);
            String settingsClosed = awaitJsString(instrumentation, gameWeb,
                    "(function(){var close=document.querySelector('#wwis-overlay #wwis-close');"
                            + "if(!close)return 'close_button_missing';close.click();"
                            + "return String(!!document.querySelector('#wwis-overlay[hidden]'));})()",
                    5_000L);
            assertEquals("The real Image Studio settings overlay remained above the game.",
                    "true", settingsClosed);

            // The bridge automatically discovers the live WML roster and writes
            // it through the same discover-batch API as Image Studio's own button.
            JSONObject discoveryState = new JSONObject();
            long discoveryDeadline = System.currentTimeMillis() + 30_000L;
            while (System.currentTimeMillis() < discoveryDeadline) {
                discoveryState = new JSONObject(awaitJsString(instrumentation, gameWeb,
                        "JSON.stringify(window.WaywardLauncherImageStudio.getDiscoveryStatus())", 10_000L));
                if (discoveryState.optBoolean("complete", false)) break;
                Thread.sleep(250L);
            }
            assertTrue("Automatic character discovery did not complete in Android WebView: "
                    + discoveryState, discoveryState.optBoolean("complete", false));
            JSONObject discoveryResult = discoveryState.optJSONObject("result");
            assertNotNull("Character discovery returned no result.", discoveryResult);
            assertTrue("The real WML roster returned no discoverable characters: " + discoveryResult,
                    discoveryResult.optInt("found", 0) > 0);

            String countDispatch = "(function(){"
                    + "window.__waywardCiCounts={state:'pending'};"
                    + "window.fetch('http://127.0.0.1:8189/api/wife-image-counts')"
                    + ".then(function(response){if(!response.ok)throw new Error('HTTP '+response.status);return response.json();})"
                    + ".then(function(body){window.__waywardCiCounts={state:'loaded',counts:body.counts||{}};})"
                    + ".catch(function(error){window.__waywardCiCounts={state:'error',message:String(error)};});"
                    + "return 'dispatched';})()";
            assertEquals("The Android test did not query the server character index.",
                    "dispatched", awaitJsString(instrumentation, gameWeb, countDispatch, 10_000L));
            JSONObject countState = new JSONObject();
            long countDeadline = System.currentTimeMillis() + 15_000L;
            while (System.currentTimeMillis() < countDeadline) {
                countState = new JSONObject(awaitJsString(instrumentation, gameWeb,
                        "JSON.stringify(window.__waywardCiCounts||{state:'pending'})", 10_000L));
                if (!"pending".equals(countState.optString("state", ""))) break;
                Thread.sleep(100L);
            }
            assertEquals("The server did not return the character index.", "loaded",
                    countState.optString("state", ""));
            JSONObject characterCounts = countState.optJSONObject("counts");
            assertNotNull("The server character index was empty.", characterCounts);
            assertTrue("The real Elena character is missing from the launcher image index: "
                    + characterCounts, characterCounts.has("elena"));

            String trigger = "(function(){"
                    + "window.__waywardCiImage={state:'enqueue'};"
                    + "(async function(){"
                    + "var key='elena__task-idle__outfit-modest__room-taproom__v-0';"
                    + "var prompt='Portrait illustration of an adult woman named Elena, fully clothed in a modest tavern outfit, warm indoor light, clean detailed digital painting, single character, no text';"
                    + "var enqueueResponse=await window.fetch('http://127.0.0.1:8189/api/batch/enqueue',{"
                    + "method:'POST',headers:{'Content-Type':'application/json'},"
                    + "body:JSON.stringify({jobId:'launcher-native-provider-real-portrait-smoke',start:true,items:[{"
                    + "talentId:key,imageType:'portrait',prompt:prompt,negativePrompt:'blurry, low quality, extra limbs, text',weight:100"
                    + "}]})});"
                    + "var enqueueBody=await enqueueResponse.json().catch(function(){return {};});"
                    + "if(!enqueueResponse.ok)throw new Error('batch enqueue HTTP '+enqueueResponse.status+': '+JSON.stringify(enqueueBody).slice(0,240));"
                    + "window.__waywardCiImage={state:'queued',accepted:enqueueBody.accepted||0,alreadyCached:enqueueBody.alreadyCached||0};"
                    + "var batchDeadline=Date.now()+240000;var batchStatus=null;"
                    + "while(Date.now()<batchDeadline){"
                    + "var statusResponse=await window.fetch('http://127.0.0.1:8189/api/batch/status');"
                    + "batchStatus=await statusResponse.json();"
                    + "window.__waywardCiImage={state:'processing',done:batchStatus.done||0,total:batchStatus.total||0,completed:batchStatus.completed||0,cached:batchStatus.cached||0,errored:batchStatus.errored||0,lastError:batchStatus.lastError||''};"
                    + "if((batchStatus.done||0)>=(batchStatus.total||0)&&!batchStatus.running)break;"
                    + "await new Promise(function(resolve){setTimeout(resolve,500);});"
                    + "}"
                    + "if(!batchStatus||(batchStatus.total||0)<1||(batchStatus.done||0)<(batchStatus.total||0))throw new Error('batch job timed out: '+JSON.stringify(batchStatus));"
                    + "if((batchStatus.completed||0)!==1||(batchStatus.errored||0)!==0)throw new Error('Image Studio batch failed: '+JSON.stringify(batchStatus));"
                    + "var packResponse=await window.fetch('http://127.0.0.1:8189/api/pack?characters=elena');"
                    + "if(!packResponse.ok)throw new Error('pack HTTP '+packResponse.status);"
                    + "var pack=await packResponse.json();var entry=pack.entries&&pack.entries[key];"
                    + "if(!entry||!entry.imagePath)throw new Error('generated Elena portrait missing from /api/pack: '+JSON.stringify(pack).slice(0,300));"
                    + "var serverImageUrl='http://127.0.0.1:8189/images/'+entry.imagePath.split('/').map(encodeURIComponent).join('/');"
                    + "var imageUrl=new URL('/images/__wayward_generated__/'+entry.imagePath.split('/').map(encodeURIComponent).join('/'),window.location.origin).toString();"
                    + "if(!HTMLImageElement.prototype.__waywardGeneratedImageUrlRewrite)throw new Error('launcher did not install the generated image DOM URL rewrite');"
                    + "if(new URL(imageUrl).origin!==window.location.origin)throw new Error('generated image URL is not same-origin: '+imageUrl);"
                    + "var imageResponse=await window.fetch(imageUrl,{credentials:'omit'});"
                    + "if(!imageResponse.ok)throw new Error('same-origin cached image HTTP '+imageResponse.status);"
                    + "var blob=await imageResponse.blob();"
                    + "if(!blob.type||blob.type.indexOf('image/')!==0)throw new Error('unexpected generated image MIME: '+blob.type);"
                    + "if(blob.size<8)throw new Error('same-origin image route returned an empty image body');"
                    + "localStorage.setItem('wml.dev','true');"
                    + "var dev=WML.dev(),bridge=window.WW_ImageStudioBridge,matching=window.WW_ImageStudioMatching;"
                    + "if(!dev||!bridge||!matching)throw new Error('real WML Image Studio APIs are unavailable');"
                    + "var symbols=WML.status().modSymbols.imagestudio||{};"
                    + "var imageLookupSymbol=symbols.imageLookup,portraitPanelSymbol=symbols.imageUsagePortraitPanel;"
                    + "if(!imageLookupSymbol||!portraitPanelSymbol)throw new Error('Image Studio imageLookup/imageUsagePortraitPanel symbols are missing');"
                    + "var portraitPanelCalls=0;"
                    + "dev.hook(portraitPanelSymbol,{priority:-9000000,after:function(value){portraitPanelCalls++;return value;}});"
                    + "dev.hook(imageLookupSymbol,{priority:-9000000,replace:function(){return null;}});"
                    + "var launcherSettings=JSON.parse(localStorage.getItem('tavern-settings')||'{}');"
                    + "if(!launcherSettings||typeof launcherSettings!=='object')launcherSettings={};"
                    + "launcherSettings.state=Object.assign({},launcherSettings.state||{},{imageBackendMode:'custom',imageBackendUrl:'http://127.0.0.1:8189'});"
                    + "localStorage.setItem('tavern-settings',JSON.stringify(launcherSettings));"
                    + "dev.fn('settingsStore').getState().set({imageBackendMode:'custom',imageBackendUrl:'http://127.0.0.1:8189',ageAffirmed:true,contentAcknowledged:true});"
                    + "if(!window.WaywardLauncherImageStudio||!window.WaywardLauncherImageStudio.refreshBackendProbe)throw new Error('launcher image backend probe is unavailable');"
                    + "var probeDeadline=Date.now()+15000,probeResult=null;"
                    + "while(Date.now()<probeDeadline){probeResult=await window.WaywardLauncherImageStudio.refreshBackendProbe('ci-real-portrait-render');if(probeResult&&probeResult.ok&&probeResult.baseUrl==='http://127.0.0.1:8189')break;await new Promise(function(resolve){setTimeout(resolve,200);});}"
                    + "if(!probeResult||!probeResult.ok||probeResult.baseUrl!=='http://127.0.0.1:8189')throw new Error('WML did not select the launcher-local image backend: '+JSON.stringify(probeResult));"
                    + "dev.hook('bee',{priority:-9000000,replace:function(){return key;}});"
                    + "var config=matching.get();"
                    + "['scene','outfit','room','exposure'].forEach(function(id){if(config.rules[id])config.rules[id].required=false;});"
                    + "matching.set(config);"
                    + "dev.fn('store').setState(function(previous){return Object.assign({},previous,{started:true,selectingArchetype:false,selectingBuilder:false,selectingPicks:false});});"
                    + "await new Promise(function(resolve){setTimeout(resolve,100);});"
                    + "var skip=[...document.querySelectorAll('button')].find(function(button){return button.textContent.trim()==='건너뛰기';});"
                    + "if(skip)skip.click();"
                    + "var isVisible=function(element){var box=element.getBoundingClientRect(),css=getComputedStyle(element);return element.getClientRects().length>0&&box.width>0&&box.height>0&&css.display!=='none'&&css.visibility!=='hidden'&&Number(css.opacity)>0;};"
                    + "var promptTitleDeadline=Date.now()+5000,promptTitle=null;"
                    + "while(Date.now()<promptTitleDeadline){promptTitle=[...document.querySelectorAll('body *')].find(function(element){return element.children.length===0&&String(element.textContent||'').trim()==='상태별 프롬프트 선택'&&isVisible(element);});if(promptTitle)break;await new Promise(function(resolve){setTimeout(resolve,100);});}"
                    + "if(promptTitle){var applyPrompt=[...document.querySelectorAll('button,[role=button]')].find(function(button){return String(button.textContent||'').replace(/\\s+/g,' ').trim()==='선택 적용'&&isVisible(button);});"
                    + "if(!applyPrompt)throw new Error('status prompt dialog appeared without its 선택 적용 action');applyPrompt.click();"
                    + "var closeDeadline=Date.now()+5000;while(Date.now()<closeDeadline){var stillOpen=[...document.querySelectorAll('body *')].some(function(element){return element.children.length===0&&String(element.textContent||'').trim()==='상태별 프롬프트 선택'&&isVisible(element);});if(!stillOpen)break;await new Promise(function(resolve){setTimeout(resolve,100);});}"
                    + "if([...document.querySelectorAll('body *')].some(function(element){return element.children.length===0&&String(element.textContent||'').trim()==='상태별 프롬프트 선택'&&isVisible(element);}))throw new Error('status prompt selection dialog did not close after apply');}"
                    + "var shortKeyTitleDeadline=Date.now()+7000,shortKeyTitle=null;"
                    + "while(Date.now()<shortKeyTitleDeadline){shortKeyTitle=[...document.querySelectorAll('body *')].find(function(element){return element.children.length===0&&String(element.textContent||'').trim()==='최종 이미지 파일명 추가 축약'&&isVisible(element);});if(shortKeyTitle)break;await new Promise(function(resolve){setTimeout(resolve,100);});}"
                    + "if(shortKeyTitle){var keepLongKeys=[...document.querySelectorAll('button,[role=button]')].find(function(button){return String(button.textContent||'').replace(/\\s+/g,' ').trim()==='사용 안 함'&&isVisible(button);});"
                    + "if(!keepLongKeys)throw new Error('short image key prompt appeared without its 사용 안 함 action');keepLongKeys.click();"
                    + "var shortKeyCloseDeadline=Date.now()+5000;while(Date.now()<shortKeyCloseDeadline){var shortKeyStillOpen=[...document.querySelectorAll('body *')].some(function(element){return element.children.length===0&&String(element.textContent||'').trim()==='최종 이미지 파일명 추가 축약'&&isVisible(element);});if(!shortKeyStillOpen)break;await new Promise(function(resolve){setTimeout(resolve,100);});}"
                    + "if([...document.querySelectorAll('body *')].some(function(element){return element.children.length===0&&String(element.textContent||'').trim()==='최종 이미지 파일명 추가 축약'&&isVisible(element);}))throw new Error('short image key prompt did not close after 선택: 사용 안 함');}"
                    + "await new Promise(function(resolve){setTimeout(resolve,750);});"
                    + "var portraitDeadline=Date.now()+45000,portrait=null,portraitCandidates=[];"
                    + "while(Date.now()<portraitDeadline){"
                    + "portraitCandidates=[...document.querySelectorAll('#root img')];"
                    + "var matchingPortraits=portraitCandidates.filter(function(img){var src=img.currentSrc||img.src;return src===imageUrl&&img.complete&&img.naturalWidth>0&&img.naturalHeight>0&&img.isConnected;});"
                    + "var hasVisibleLayout=function(img){var r=img.getBoundingClientRect(),st=getComputedStyle(img);return img.getClientRects().length>0&&r.width>1&&r.height>1&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight&&st.display!=='none'&&st.visibility!=='hidden'&&Number(st.opacity)>0;};"
                    + "portrait=matchingPortraits.find(hasVisibleLayout)||matchingPortraits[0]||null;"
                    + "if(portrait)break;"
                    + "await new Promise(function(resolve){setTimeout(resolve,200);});"
                    + "}"
                    + "if(!portrait)throw new Error('the live WML portrait component did not load the same-origin generated image: '+JSON.stringify({expected:imageUrl,hookCalls:portraitPanelCalls,images:portraitCandidates.map(function(img){var r=img.getBoundingClientRect();return {src:img.currentSrc||img.src,alt:img.alt,className:String(img.className||'').slice(0,120),naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,connected:img.isConnected,rect:{x:r.x,y:r.y,width:r.width,height:r.height}};}).slice(0,24)}));"
                    + "await portrait.decode();"
                    + "var layoutDeadline=Date.now()+10000,rect=portrait.getBoundingClientRect(),style=getComputedStyle(portrait);"
                    + "while(Date.now()<layoutDeadline&&!hasVisibleLayout(portrait)){await new Promise(function(resolve){requestAnimationFrame(function(){setTimeout(resolve,100);});});rect=portrait.getBoundingClientRect();style=getComputedStyle(portrait);}"
                    + "var parent=portrait.parentElement,ancestorInfo=[];"
                    + "for(var depth=0;parent&&depth<6;depth++,parent=parent.parentElement){var parentRect=parent.getBoundingClientRect(),parentStyle=getComputedStyle(parent);ancestorInfo.push({tag:parent.tagName,id:parent.id,className:String(parent.className||'').slice(0,100),display:parentStyle.display,visibility:parentStyle.visibility,opacity:parentStyle.opacity,rect:{x:parentRect.x,y:parentRect.y,width:parentRect.width,height:parentRect.height}});}"
                    + "var visible=portrait.isConnected&&portrait.getClientRects().length>0&&rect.width>0&&rect.height>0&&rect.right>0&&rect.bottom>0&&style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)>0;"
                    + "if(!visible)throw new Error('live WML portrait image decoded but is not laid out visibly: '+JSON.stringify({rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height,right:rect.right,bottom:rect.bottom},display:style.display,visibility:style.visibility,opacity:style.opacity,viewport:{width:innerWidth,height:innerHeight},rootRect:(document.querySelector('#root')||document.body).getBoundingClientRect().toJSON(),rootImages:portraitCandidates.map(function(img){var r=img.getBoundingClientRect(),st=getComputedStyle(img);return {src:(img.currentSrc||img.src).slice(0,240),alt:img.alt,cls:String(img.className||'').slice(0,80),naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,rect:{x:r.x,y:r.y,width:r.width,height:r.height},display:st.display,visibility:st.visibility,opacity:st.opacity};}).slice(0,30),ancestorInfo:ancestorInfo,hookCalls:portraitPanelCalls}));"
                    + "window.__waywardCiImage={state:'loaded',displayedInPortraitHook:true,portraitHook:'imageUsagePortraitPanel',"
                    + "imageAlt:portrait.alt,naturalWidth:portrait.naturalWidth,naturalHeight:portrait.naturalHeight,visible:visible,portraitPanelCalls:portraitPanelCalls,domRewritten:portrait.src===imageUrl,serverImageUrl:serverImageUrl,"
                    + "mimeType:blob.type||'',imagePath:entry.imagePath,imageUrl:portrait.currentSrc||portrait.src,imageOrigin:new URL(portrait.currentSrc||portrait.src).origin,gameOrigin:window.location.origin,sameOriginResource:new URL(portrait.currentSrc||portrait.src).origin===window.location.origin,entryCount:pack.entryCount||Object.keys(pack.entries||{}).length,"
                    + "cacheCompleted:batchStatus.completed,cacheCount:batchStatus.cached||0};"
                    + "})().catch(function(error){window.__waywardCiImage={state:'error',errorType:error&&error.name?String(error.name):'Error',message:error&&error.message?String(error.message).slice(0,5000):'unknown'};});"
                    + "return 'dispatched';})()";
            String dispatch = awaitJsString(instrumentation, gameWeb, trigger, 10_000L);
            assertEquals("The game page did not dispatch the real WML portrait generation request.", "dispatched", dispatch);

            long deadline = System.currentTimeMillis() + 280_000L;
            JSONObject imageState = new JSONObject();
            while (System.currentTimeMillis() < deadline) {
                String stateJson = awaitJsString(instrumentation, gameWeb,
                        "JSON.stringify(window.__waywardCiImage||{state:'pending'})", 10_000L);
                imageState = new JSONObject(stateJson);
                String state = imageState.optString("state", "pending");
                if ("loaded".equals(state) || "error".equals(state) || "img_error".equals(state)) break;
                Thread.sleep(500L);
            }
            assertEquals("Cloudflare image did not render in the production WML portrait hook. "
                    + imageState + "; pipeline=" + ImagePipelineDiagnostics.readRecent(context, 120),
                    "loaded", imageState.optString("state", ""));
            assertTrue("The real WML imageUsagePortraitPanel did not render during the image test: " + imageState,
                    imageState.optInt("portraitPanelCalls", 0) > 0);
            assertTrue("The production portrait component did not display the actual generated image: " + imageState,
                    imageState.optBoolean("displayedInPortraitHook", false));
            assertTrue("The generated portrait did not decode in Android WebView: " + imageState,
                    imageState.optInt("naturalWidth", 0) > 0 && imageState.optInt("naturalHeight", 0) > 0);
            assertTrue("The actual portrait slot was not visible on screen: " + imageState,
                    imageState.optBoolean("visible", false));
            assertTrue("Generated image was not served from the registered game's HTTPS origin: " + imageState,
                    imageState.optBoolean("sameOriginResource", false));
            assertTrue("The actual game img.src was not rewritten from loopback to the HTTPS game origin: " + imageState,
                    imageState.optBoolean("domRewritten", false));
            assertEquals("Generated image route did not use the active game origin: " + imageState,
                    GAME_ORIGIN, imageState.optString("imageOrigin", ""));
            resultSummary = "state=loaded\nportraitHook=imageUsagePortraitPanel\nportraitPanelCalls=" + imageState.optInt("portraitPanelCalls") + "\ndisplayedInPortraitHook=true\nvisibleOnScreen=true\nsameOriginImageRoute=true\nimageOrigin=" + imageState.optString("imageOrigin") + "\n"
                    + "gameHtmlBytes=" + gameHtml.length + "\n"
                    + "gameHtmlSourceCommit=26d6c32e0b0abbb886e3029efd548b7ca6774401\n"
                    + "gameHtmlBlob=d198eacfc127c55dc44bd5d1b8e29ff2bb7d08e6\n"
                    + "cloudflareEndpoint=" + providerEndpoint + "\n"
                    + "providerMode=local_worker_contract_fixture\n"
                    + "providerType=cloudflare-worker\n"
                    + "imagePath=" + imageState.optString("imagePath") + "\n"
                    + "imageAlt=" + imageState.optString("imageAlt") + "\n"
                    + "packEntryCount=" + imageState.optInt("entryCount") + "\n"
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

    private static void dismissWaywardAgeConfirmation(Instrumentation instrumentation, WebView gameWeb)
            throws Exception {
        // The pinned Korean game build has two distinct, sequential prompts:
        // the game's "연령 확인" self-confirmation (예/아니오), and the optional
        // Image Studio "성인 콘텐츠 안내" consent (이해하고 동의합니다). Do not
        // guess one button globally; only click the affirmative button inside
        // the matching, currently visible dialog.
        String dispatch = "(function(){"
                + "var norm=function(e){return String(e.innerText||e.value||e.getAttribute('aria-label')||'').replace(/\\s+/g,' ').trim();};"
                + "var visible=function(e){var s=getComputedStyle(e),r=e.getBoundingClientRect();"
                + "return e.getClientRects().length>0&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0&&r.width>0&&r.height>0;};"
                + "var gates=[{title:'연령 확인',accept:'예',id:'age_confirmation'},"
                + "{title:'성인 콘텐츠 안내',accept:'이해하고 동의합니다',id:'adult_content_consent'}];"
                + "for(var i=0;i<gates.length;i++){var gate=gates[i];"
                + "var title=Array.from(document.querySelectorAll('body *')).find(function(e){"
                + "return e.children.length===0&&norm(e)===gate.title&&visible(e);});"
                + "if(!title)continue;var root=title;"
                + "for(var depth=0;root&&depth<10;depth++,root=root.parentElement){"
                + "var nodes=Array.from(root.querySelectorAll('button,[role=button],input[type=button],a,div,span'));"
                + "if(root.matches&&root.matches('button,[role=button],input[type=button],a,div,span'))nodes.unshift(root);"
                + "var accept=nodes.find(function(e){return norm(e)===gate.accept&&visible(e);});"
                + "if(accept){var target=accept.closest('button,[role=button],a')||accept;"
                + "target.click();return gate.id+'_accepted';}}"
                + "return gate.id+'_accept_button_not_found';}"
                + "return 'no_visible_age_gate';})()";
        boolean sawGate = false;
        String result = "";
        long deadline = System.currentTimeMillis() + 30_000L;
        while (System.currentTimeMillis() < deadline) {
            result = awaitJsString(instrumentation, gameWeb, dispatch, 5_000L);
            if (result.endsWith("_accept_button_not_found")) {
                fail("Visible age/consent dialog had no matching affirmative button: " + result);
            }
            if (result.endsWith("_accepted")) {
                sawGate = true;
                Thread.sleep(450L);
                continue;
            }
            // DOMContentLoaded/onPageFinished can precede the game's async
            // save/settings hydration. A blank first probe is not proof that the
            // age gate is absent; keep observing until the dialog appears or the
            // bounded readiness window expires.
            if ("no_visible_age_gate".equals(result)) {
                Thread.sleep(200L);
                continue;
            }
            Thread.sleep(150L);
        }
        if (!sawGate) {
            String readiness = awaitJsString(instrumentation, gameWeb,
                    "(function(){var root=document.getElementById('root');var state=null;"
                            + "try{var raw=localStorage.getItem('tavern-settings');state=raw?JSON.parse(raw):null;}catch(e){state='parse_error:'+String(e);}"
                            + "var status=null;try{status=window.WML&&window.WML.status?window.WML.status():null;}catch(e){status='status_error:'+String(e);}"
                            + "return JSON.stringify({title:document.title,body:String(document.body&&document.body.innerText||'').slice(0,1200),"
                            + "rootText:String(root&&root.innerText||'').slice(0,1200),settings:state,"
                            + "wmlVersion:window.WML&&window.WML.VERSION||null,wmlStatus:status});})()",
                    5_000L);
            fail("The Android test never observed Wayward's age/consent gate after waiting for page hydration. "
                    + "DOM/WML diagnostics: " + readiness + "; lastGateProbe=" + result);
        }
        String visibleGate = awaitJsString(instrumentation, gameWeb,
                "(function(){var labels=['연령 확인','성인 콘텐츠 안내'];"
                        + "return String(Array.from(document.querySelectorAll('body *')).some(function(e){"
                        + "if(e.children.length>0||labels.indexOf(String(e.innerText||e.textContent||'').trim())<0)return false;"
                        + "var s=getComputedStyle(e),r=e.getBoundingClientRect();"
                        + "return e.getClientRects().length>0&&s.display!=='none'&&s.visibility!=='hidden'&&"
                        + "Number(s.opacity)>0&&r.width>0&&r.height>0;}));})()",
                5_000L);
        assertEquals("Wayward's age/consent dialog remained visible after its affirmative action.",
                "false", visibleGate);
    }

    private static Activity verifyCrossTaskImageStudioSettingsRouting(
            Instrumentation instrumentation, Context context, Activity sessionActivity) throws Exception {
        // The game WebView is in a document task. This test-only SAF handle is
        // intentionally never dereferenced: Image Studio detection was covered
        // in the game/session setup path and the shared ImageGen service is ready.
        Class<?> treeClass = Class.forName("com.wayward.launcher.MainActivity$SafTree");
        java.lang.reflect.Constructor<?> treeConstructor =
                treeClass.getDeclaredConstructor(MainActivity.class, Uri.class);
        treeConstructor.setAccessible(true);
        Object testTree = treeConstructor.newInstance(sessionActivity,
                Uri.parse("content://com.android.externalstorage.documents/tree/primary%3ADownload"));
        setField(sessionActivity, "tree", testTree);
        setField(sessionActivity, "imageStudioSessionDetected", true);

        Method register = MainActivity.class.getDeclaredMethod("registerSessionActivity");
        register.setAccessible(true);
        instrumentation.runOnMainSync(() -> {
            try { register.invoke(sessionActivity); }
            catch (Exception error) { throw new RuntimeException("Could not register the active game session", error); }
        });

        WebView gameWeb = (WebView) getField(sessionActivity, "web");
        assertNotNull("The game WebView disappeared before cross-task routing.", gameWeb);
        assertEquals("The actual WML settings button disappeared before cross-task routing.", "1",
                awaitJsString(instrumentation, gameWeb,
                        "String(window.__waywardCiSettingsClicks||0)", 5_000L));
        awaitJsString(instrumentation, gameWeb,
                "(function(){window.__waywardCiSettingsClicks=0;return 'reset';})()", 5_000L);

        Activity homeActivity = instrumentation.startActivitySync(
                new Intent(context, MainActivity.class)
                        .setData(Uri.parse("wayward://home/image-studio-router-test"))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NEW_DOCUMENT
                                | Intent.FLAG_ACTIVITY_MULTIPLE_TASK));
        assertNotNull("The second launcher home Activity did not start.", homeActivity);
        assertTrue("The second launcher Activity unexpectedly owns a game WebView.",
                getField(homeActivity, "web") == null);

        Method openPanel = MainActivity.class.getDeclaredMethod("openImageGenPanel");
        openPanel.setAccessible(true);
        instrumentation.runOnMainSync(() -> {
            try { openPanel.invoke(homeActivity); }
            catch (Exception error) { throw new RuntimeException("Home Activity could not route Image Studio settings", error); }
        });

        long deadline = System.currentTimeMillis() + 15_000L;
        String clicked = "";
        while (System.currentTimeMillis() < deadline) {
            clicked = awaitJsString(instrumentation, gameWeb,
                    "String(window.__waywardCiSettingsClicks||0)", 5_000L);
            if ("1".equals(clicked)) break;
            Thread.sleep(100L);
        }
        assertEquals("The actual WML Image Studio settings button in the active game session was not opened from the separate launcher home task.",
                "1", clicked);
        return homeActivity;
    }

    private static void restartImageGenServerWithKeystoreToken(
            Instrumentation instrumentation, Context context, Activity activity) throws Exception {
        Method stopAction = MainActivity.class.getDeclaredMethod("stopImageGenServer");
        stopAction.setAccessible(true);
        instrumentation.runOnMainSync(() -> {
            try { stopAction.invoke(activity); }
            catch (Exception error) { throw new RuntimeException("Could not stop ImageGen for token persistence test", error); }
        });
        assertTrue("ImageGen did not stop before the Keystore persistence restart test.",
                awaitServerDown(45_000L));

        Method startAction = MainActivity.class.getDeclaredMethod("startNovelAiServer");
        startAction.setAccessible(true);
        instrumentation.runOnMainSync(() -> {
            try { startAction.invoke(activity); }
            catch (Exception error) { throw new RuntimeException("Could not restart ImageGen with the Keystore token", error); }
        });
        assertEquals("ImageGen did not reload NAI_TOKEN from Android Keystore after a full restart. "
                + startupLogs(context), 200, awaitStatus(200, 120_000L));
        assertEquals("The NovelAI token was lost from Android Keystore after restart.",
                "ci-smoke-token-not-valid", ImageProviderStore.readNovelAiToken(context));
        String settings = readText(new File(context.getFilesDir(), "imagegen/state/anima-settings.json"));
        assertTrue("The NovelAI token reappeared in plaintext after server restart.",
                !settings.contains("ci-smoke-token-not-valid"));
        DiagnosticsLogger.event(context, "INFO", "imagegen_service",
                "keystore_token_restart_verified", null);
    }

    private static void configureCloudflareProvider(Context context, String profileId,
                                                     String endpoint) throws Exception {
        ImageProviderStore.Snapshot snapshot = new ImageProviderStore(context).load();
        snapshot.providers.clear();
        snapshot.defaults.clear();
        snapshot.fallbacks.clear();

        ImageProviderStore.Provider provider = new ImageProviderStore.Provider();
        provider.id = FLUX_PROVIDER_ID;
        provider.name = "Wayward Android CI Worker contract fixture";
        provider.type = "cloudflare-worker";
        provider.endpoint = endpoint;
        provider.enabled = true;
        provider.allowInGame = true;
        snapshot.providers.add(provider);
        snapshot.defaults.put(profileId, provider.id);
        new ImageProviderStore(context).save(snapshot);
    }

    private static boolean containsJsonString(org.json.JSONArray values, String expected) {
        if (values == null || expected == null) return false;
        for (int index = 0; index < values.length(); index++) {
            if (expected.equals(values.optString(index))) return true;
        }
        return false;
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
        if (Build.VERSION.SDK_INT < 29) {
            throw new IllegalStateException("MediaStore Downloads export requires Android 10 or newer.");
        }
        String relativeFile = privatePath.startsWith("files/")
                ? privatePath.substring("files/".length()) : privatePath;
        File source = new File(context.getFilesDir(), relativeFile);
        if (!source.isFile() || source.length() <= 0) {
            throw new IllegalStateException("CI artifact is missing or empty: " + source.getAbsolutePath());
        }

        String displayName = new File(sharedPath).getName();
        String mimeType = displayName.toLowerCase(java.util.Locale.ROOT).endsWith(".png")
                ? "image/png" : "text/plain";
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, displayName);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, "Download/Wayward-CI/");
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);

        android.content.ContentResolver resolver = context.getContentResolver();
        Uri collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
        resolver.delete(collection,
                MediaStore.MediaColumns.DISPLAY_NAME + "=? AND "
                        + MediaStore.MediaColumns.RELATIVE_PATH + "=?",
                new String[] {displayName, "Download/Wayward-CI/"});
        Uri destination = resolver.insert(collection, values);
        if (destination == null) {
            throw new IllegalStateException("MediaStore refused to create CI artifact: " + displayName);
        }
        boolean completed = false;
        try (InputStream input = new FileInputStream(source);
             OutputStream output = resolver.openOutputStream(destination, "w")) {
            if (output == null) throw new IllegalStateException("MediaStore output stream is unavailable.");
            byte[] buffer = new byte[8192];
            int count;
            long copied = 0;
            while ((count = input.read(buffer)) >= 0) {
                if (count == 0) continue;
                output.write(buffer, 0, count);
                copied += count;
            }
            output.flush();
            if (copied != source.length()) {
                throw new IllegalStateException("CI artifact export was truncated: "
                        + copied + " of " + source.length() + " bytes.");
            }
            ContentValues published = new ContentValues();
            published.put(MediaStore.MediaColumns.IS_PENDING, 0);
            if (resolver.update(destination, published, null, null) != 1) {
                throw new IllegalStateException("Could not publish CI artifact in Downloads.");
            }
            completed = true;
            System.out.println("WAYWARD_CI_ARTIFACT_EXPORTED name=" + displayName
                    + " bytes=" + copied + " uri=" + destination);
        } finally {
            if (!completed) resolver.delete(destination, null, null);
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
