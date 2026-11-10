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
        Activity homeActivity = null;
        boolean stopActionSent = false;
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
            configureCloudflareProvider(context, GAME_PROFILE_ID);
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
            runCloudflareGamePageSmoke(instrumentation, context, launcherActivity);
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
            dismissWaywardAgeConfirmation(instrumentation, gameWeb);

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

            // Exercise the one-tap Image Studio bridge in the actual Android WebView.
            // The pinned HTML fixture does not install third-party WML mods, so
            // provide the exact WW_ImageStudioBridge contract returned by the mod.
            String bridgeFixture = "(function(){"
                    + "window.WW_ImageStudio={open:function(){}};"
                    + "var settingsButton=document.createElement('button');"
                    + "settingsButton.id='wwis-generation-settings';"
                    + "settingsButton.addEventListener('click',function(){settingsButton.dataset.clicked='yes';});"
                    + "document.body.appendChild(settingsButton);"
                    + "window.WW_ImageStudioBridge={"
                    + "connection:function(){return {baseUrl:'http://127.0.0.1:8189'};},"
                    + "characters:function(){return {skipped:0,characters:[{"
                    + "id:'launcher-ci-probe',name:'Launcher CI Probe',"
                    + "prompt:'portrait illustration',negativePrompt:'',"
                    + "originalPrompt:'portrait illustration',originalNegativePrompt:''"
                    + "}]};}"
                    + "};return 'installed';})()";
            assertEquals("The Android test could not install the Image Studio bridge fixture.",
                    "installed", awaitJsString(instrumentation, gameWeb, bridgeFixture, 10_000L));

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
                    "document.getElementById('wwis-generation-settings').dataset.clicked||''", 5_000L);
            assertEquals("The Image Studio settings button was not clicked.", "yes", clicked);

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
            assertEquals("The Android bridge discovered the wrong character count.", 1,
                    discoveryResult.optInt("found", -1));
            assertEquals("The Android bridge did not register the discovered character.", 1,
                    discoveryResult.optInt("added", -1));

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
            assertTrue("The discovered WML character is missing from the image review filters: "
                    + characterCounts, characterCounts.has("launcher-ci-probe"));

            String trigger = "(function(){"
                    + "window.__waywardCiImage={state:'enqueue'};"
                    + "(async function(){"
                    + "var prompt='A peaceful watercolor landscape of a small wooden cottage beside a river, green hills and wildflowers, warm morning light, detailed digital painting, no people, no text';"
                    + "var enqueueResponse=await window.fetch('http://127.0.0.1:8189/api/batch/enqueue',{"
                    + "method:'POST',headers:{'Content-Type':'application/json'},"
                    + "body:JSON.stringify({jobId:'launcher-native-provider-ci-smoke',start:true,items:[{"
                    + "talentId:'launcher-ci-probe',imageType:'portrait',prompt:prompt,negativePrompt:'blurry, low quality',weight:100"
                    + "}]})});"
                    + "var enqueueBody=await enqueueResponse.json().catch(function(){return {};});"
                    + "if(!enqueueResponse.ok)throw new Error('batch enqueue HTTP '+enqueueResponse.status+': '+JSON.stringify(enqueueBody).slice(0,240));"
                    + "window.__waywardCiImage={state:'queued',accepted:enqueueBody.accepted||0,alreadyCached:enqueueBody.alreadyCached||0};"
                    + "var deadline=Date.now()+240000;var batchStatus=null;"
                    + "while(Date.now()<deadline){"
                    + "var statusResponse=await window.fetch('http://127.0.0.1:8189/api/batch/status');"
                    + "batchStatus=await statusResponse.json();"
                    + "window.__waywardCiImage={state:'processing',done:batchStatus.done||0,total:batchStatus.total||0,completed:batchStatus.completed||0,cached:batchStatus.cached||0,errored:batchStatus.errored||0,lastError:batchStatus.lastError||''};"
                    + "if((batchStatus.done||0)>=(batchStatus.total||0)&&!batchStatus.running)break;"
                    + "await new Promise(function(resolve){setTimeout(resolve,500);});"
                    + "}"
                    + "if(!batchStatus||(batchStatus.total||0)<1||(batchStatus.done||0)<(batchStatus.total||0))throw new Error('batch job timed out: '+JSON.stringify(batchStatus));"
                    + "if((batchStatus.completed||0)!==1||(batchStatus.errored||0)!==0)throw new Error('Image Studio batch failed: '+JSON.stringify(batchStatus));"
                    + "var packResponse=await window.fetch('http://127.0.0.1:8189/api/pack?characters=launcher-ci-probe');"
                    + "if(!packResponse.ok)throw new Error('pack HTTP '+packResponse.status);"
                    + "var pack=await packResponse.json();var entry=pack.entries&&pack.entries['launcher-ci-probe'];"
                    + "if(!entry||!entry.imagePath)throw new Error('generated image missing from /api/pack: '+JSON.stringify(pack).slice(0,300));"
                    + "var imageUrl='http://127.0.0.1:8189/images/'+entry.imagePath.split('/').map(encodeURIComponent).join('/');"
                    + "var imageResponse=await window.fetch(imageUrl);"
                    + "if(!imageResponse.ok)throw new Error('cached image HTTP '+imageResponse.status);"
                    + "var blob=await imageResponse.blob();var dataUrl=await new Promise(function(resolve,reject){"
                    + "var reader=new FileReader();reader.onload=function(){resolve(reader.result);};reader.onerror=reject;reader.readAsDataURL(blob);});"
                    + "var img=document.createElement('img');img.id='wayward-ci-cloudflare-image';"
                    + "img.alt='Image Studio cached Cloudflare image';"
                    + "img.style.cssText='position:fixed;z-index:2147483647;right:20px;top:20px;width:340px;height:340px;object-fit:contain;background:#fff;border:6px solid #2d6b49;border-radius:12px;box-shadow:0 4px 24px #0008';"
                    + "img.onload=function(){var rect=img.getBoundingClientRect();var style=getComputedStyle(img);"
                    + "window.__waywardCiImage={state:'loaded',naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,"
                    + "visible:rect.width>0&&rect.height>0&&rect.right>0&&rect.bottom>0&&style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)>0,"
                    + "mimeType:blob.type||'',imagePath:entry.imagePath,entryCount:pack.entryCount,cacheCompleted:batchStatus.completed,cacheCount:batchStatus.cached};};"
                    + "img.onerror=function(){window.__waywardCiImage={state:'img_error',naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,imagePath:entry.imagePath};};"
                    + "document.body.appendChild(img);img.src=dataUrl;"
                    + "})().catch(function(error){window.__waywardCiImage={state:'error',errorType:error&&error.name?String(error.name):'Error',message:error&&error.message?String(error.message).slice(0,240):'unknown'};});"
                    + "return 'dispatched';})()";
            String dispatch = awaitJsString(instrumentation, gameWeb, trigger, 10_000L);
            assertEquals("The game page did not dispatch its Image Studio batch request.", "dispatched", dispatch);

            long deadline = System.currentTimeMillis() + 260_000L;
            JSONObject imageState = new JSONObject();
            while (System.currentTimeMillis() < deadline) {
                String stateJson = awaitJsString(instrumentation, gameWeb,
                        "JSON.stringify(window.__waywardCiImage||{state:'pending'})", 10_000L);
                imageState = new JSONObject(stateJson);
                String state = imageState.optString("state", "pending");
                if ("loaded".equals(state) || "error".equals(state) || "img_error".equals(state)) break;
                Thread.sleep(500L);
            }
            assertEquals("Cloudflare image did not complete the real Image Studio batch/cache pipeline. "
                    + imageState + "; pipeline=" + ImagePipelineDiagnostics.readRecent(context, 120),
                    "loaded", imageState.optString("state", ""));
            assertTrue("The cached image did not decode in Android WebView: " + imageState,
                    imageState.optInt("naturalWidth", 0) > 0 && imageState.optInt("naturalHeight", 0) > 0);
            assertTrue("The generated image element decoded but was not visibly laid out on screen: " + imageState,
                    imageState.optBoolean("visible", false));
            resultSummary = "state=loaded\nvisibleOnScreen=true\n"
                    + "gameHtmlBytes=" + gameHtml.length + "\n"
                    + "gameHtmlSourceCommit=5e5c78c4e32198e460ba040256e920d37ed1711c\n"
                    + "gameHtmlBlob=8d998b50e82febe18b5c1d1159b16663b9169775\n"
                    + "cloudflareEndpoint=" + FLUX_ENDPOINT + "\n"
                    + "providerType=cloudflare-worker\n"
                    + "imagePath=" + imageState.optString("imagePath") + "\n"
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
        String dispatch = "(function(){"
                + "var nodes=Array.from(document.querySelectorAll('button,[role=button],input[type=button],a,div,span'));"
                + "var yes=nodes.find(function(e){var t=String(e.innerText||e.value||e.getAttribute('aria-label')||'').replace(/\\s+/g,' ').trim();"
                + "return (t==='예'||/^yes$/i.test(t))&&e.getClientRects().length>0;});"
                + "if(!yes)return 'age_confirmation_yes_button_not_found';"
                + "var target=yes.closest('button,[role=button],a')||yes;target.click();return 'age_confirmation_accepted';"
                + "})()";
        String result = "";
        long deadline = System.currentTimeMillis() + 10_000L;
        while (System.currentTimeMillis() < deadline) {
            result = awaitJsString(instrumentation, gameWeb, dispatch, 5_000L);
            if ("age_confirmation_accepted".equals(result)) break;
            Thread.sleep(100L);
        }
        assertEquals("The Android test did not dismiss Wayward's age confirmation gate.",
                "age_confirmation_accepted", result);
        Thread.sleep(700L);
        String visibleGate = awaitJsString(instrumentation, gameWeb,
                "(function(){return String(Array.from(document.querySelectorAll('body *')).some(function(e){"
                        + "if(e.children.length>0||String(e.textContent||'').trim()!=='연령 확인')return false;"
                        + "var s=getComputedStyle(e),r=e.getBoundingClientRect();"
                        + "return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;}));})()",
                5_000L);
        assertEquals("The Wayward age confirmation gate remained visible after acceptance.", "false", visibleGate);
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
        assertEquals("The test settings button fixture was not present in the game WebView.", "yes",
                awaitJsString(instrumentation, gameWeb,
                        "document.getElementById('wwis-generation-settings').dataset.clicked||''", 5_000L));
        awaitJsString(instrumentation, gameWeb,
                "(function(){document.getElementById('wwis-generation-settings').dataset.clicked='';return 'reset';})()",
                5_000L);

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
                    "document.getElementById('wwis-generation-settings').dataset.clicked||''", 5_000L);
            if ("yes".equals(clicked)) break;
            Thread.sleep(100L);
        }
        assertEquals("The settings button in the active game session was not opened from the separate launcher home task.",
                "yes", clicked);
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
