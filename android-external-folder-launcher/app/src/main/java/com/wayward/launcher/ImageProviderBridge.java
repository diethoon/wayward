package com.wayward.launcher;

import android.content.Context;
import android.graphics.BitmapFactory;
import android.util.Base64;
import android.webkit.WebView;

import org.json.JSONObject;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** Restricted WML bridge for selecting a saved provider and generating an image without exposing its key. */
final class ImageProviderBridge {
    private static final ThreadPoolExecutor EXECUTOR = new ThreadPoolExecutor(
            2, 2, 30, TimeUnit.SECONDS, new ArrayBlockingQueue<>(8),
            runnable -> {
                Thread thread = new Thread(runnable, "wayward-image-provider");
                thread.setDaemon(true);
                return thread;
            },
            new ThreadPoolExecutor.AbortPolicy());

    private ImageProviderBridge() {}

    static String list(Context context, String profileId) {
        return ImageProviderStore.publicJson(context, profileId);
    }

    static void generate(Context context, WebView web, String profileId,
                         String requestId, String providerId, String prompt,
                         int width, int height) {
        if (web == null || requestId == null || !requestId.matches("[A-Za-z0-9._-]{1,80}")) {
            record(context, "native_request_rejected", "reasonCode", "invalid_request_id");
            return;
        }
        JSONObject requested = details();
        put(requested, "requestId", requestId);
        put(requested, "promptLength", prompt == null ? 0 : prompt.length());
        put(requested, "requestedWidth", width);
        put(requested, "requestedHeight", height);
        record(context, "native_request_received", requested);

        if (prompt == null || prompt.trim().isEmpty() || prompt.length() > 4096) {
            record(context, "native_request_rejected", "reasonCode", "invalid_prompt_length");
            deliver(context, web, requestId, failure("프롬프트는 1~4,096자로 입력해 주세요."));
            return;
        }

        try {
            EXECUTOR.execute(() -> {
                long started = System.nanoTime();
                try {
                    record(context, "native_worker_started", "requestId", requestId);
                    ImageProviderStore.Snapshot snapshot = new ImageProviderStore(context).load();
                    String selectedId = providerId == null ? "" : providerId.trim();
                    boolean useProfileFallback = selectedId.isEmpty();
                    if (useProfileFallback) selectedId = snapshot.defaults.get(profileId);
                    ImageProviderStore.Provider provider = ImageProviderStore.find(snapshot, selectedId);
                    if (provider == null || !provider.enabled) {
                        record(context, "provider_selection_failed", "requestId", requestId);
                        throw new IllegalStateException("이 게임 프로필에 사용할 기본 이미지 서비스를 찾지 못했습니다. 런처에서 서비스를 등록하고 지정해 주세요.");
                    }

                    JSONObject selected = details();
                    put(selected, "requestId", requestId);
                    put(selected, "providerId", provider.id);
                    put(selected, "providerType", provider.type);
                    put(selected, "hasProvider", true);
                    record(context, "provider_selected", selected);

                    ImageProviderClient.Result image;
                    boolean fallbackUsed = false;
                    try {
                        if (!provider.allowInGame) {
                            record(context, "provider_permission_denied", "requestId", requestId);
                            throw new IllegalStateException("기본 이미지 서비스의 게임 사용 권한이 꺼져 있습니다.");
                        }
                        image = ImageProviderClient.generate(provider, prompt, width, height);
                    } catch (Exception primaryError) {
                        String fallbackId = useProfileFallback ? snapshot.fallbacks.get(profileId) : null;
                        ImageProviderStore.Provider fallback = ImageProviderStore.find(snapshot, fallbackId);
                        if (fallback == null || fallback.id.equals(provider.id)
                                || !fallback.enabled || !fallback.allowInGame) {
                            throw primaryError;
                        }
                        try {
                            image = ImageProviderClient.generate(fallback, prompt, width, height);
                            provider = fallback;
                            fallbackUsed = true;
                        } catch (Exception fallbackError) {
                            throw new IllegalStateException("기본 서비스 요청에 실패했고 대체 서비스 요청도 실패했습니다: "
                                    + fallbackError.getMessage(), fallbackError);
                        }
                    }

                    JSONObject received = details();
                    put(received, "requestId", requestId);
                    put(received, "providerId", provider.id);
                    put(received, "providerType", provider.type);
                    put(received, "fallbackUsed", fallbackUsed);
                    put(received, "mimeType", image.mimeType);
                    put(received, "imageBytes", image.image.length);
                    put(received, "imageFormat", imageFormat(image.image));
                    BitmapFactory.Options bounds = new BitmapFactory.Options();
                    bounds.inJustDecodeBounds = true;
                    BitmapFactory.decodeByteArray(image.image, 0, image.image.length, bounds);
                    put(received, "imageWidth", bounds.outWidth);
                    put(received, "imageHeight", bounds.outHeight);
                    put(received, "mimeDetected", bounds.outMimeType == null ? "" : bounds.outMimeType);
                    record(context, "native_image_received", received);

                    JSONObject result = new JSONObject();
                    result.put("ok", true);
                    result.put("providerId", provider.id);
                    result.put("fallbackUsed", fallbackUsed);
                    result.put("mimeType", image.mimeType);
                    String dataUrl = "data:" + image.mimeType + ";base64,"
                            + Base64.encodeToString(image.image, Base64.NO_WRAP);
                    result.put("dataUrl", dataUrl);

                    JSONObject built = details();
                    put(built, "requestId", requestId);
                    put(built, "mimeType", image.mimeType);
                    put(built, "dataUrlLength", dataUrl.length());
                    put(built, "imageBytes", image.image.length);
                    record(context, "native_data_url_built", built);
                    deliver(context, web, requestId, result.toString());

                    JSONObject success = details();
                    put(success, "requestId", requestId);
                    put(success, "providerId", provider.id);
                    put(success, "providerType", provider.type);
                    put(success, "fallbackUsed", fallbackUsed);
                    put(success, "imageBytes", image.image.length);
                    put(success, "elapsedMs", (System.nanoTime() - started) / 1_000_000L);
                    record(context, "native_generation_succeeded", success);
                    DiagnosticsLogger.event(context, "INFO", "image_provider", "generation_succeeded", success);
                } catch (Throwable error) {
                    JSONObject failed = details();
                    put(failed, "requestId", requestId);
                    put(failed, "errorType", error.getClass().getSimpleName());
                    put(failed, "elapsedMs", (System.nanoTime() - started) / 1_000_000L);
                    record(context, "native_generation_failed", failed);
                    String message = error.getMessage() == null ? "이미지 생성 요청에 실패했습니다." : error.getMessage();
                    deliver(context, web, requestId, failure(message));
                    JSONObject details = details();
                    put(details, "errorType", error.getClass().getSimpleName());
                    // Provider error bodies can echo prompts or credentials; never persist them in diagnostics.
                    DiagnosticsLogger.event(context, "WARN", "image_provider", "generation_failed", details);
                }
            });
        } catch (Exception rejected) {
            record(context, "native_queue_rejected", "requestId", requestId);
            deliver(context, web, requestId, failure("이미지 생성 요청이 많습니다. 진행 중인 작업이 끝난 뒤 다시 시도해 주세요."));
        }
    }

    private static JSONObject details() {
        return new JSONObject();
    }

    private static void put(JSONObject target, String key, Object value) {
        try { target.put(key, value); } catch (Exception ignored) {}
    }

    private static void record(Context context, String event, String key, Object value) {
        JSONObject details = details();
        put(details, key, value);
        ImagePipelineDiagnostics.record(context, event, details);
    }

    private static void record(Context context, String event, JSONObject details) {
        ImagePipelineDiagnostics.record(context, event, details);
    }

    private static String imageFormat(byte[] bytes) {
        if (bytes == null || bytes.length < 4) return "unknown";
        if ((bytes[0] & 255) == 0xff && (bytes[1] & 255) == 0xd8 && (bytes[2] & 255) == 0xff) return "jpeg";
        if (bytes.length >= 8 && bytes[0] == (byte) 0x89 && bytes[1] == 0x50
                && bytes[2] == 0x4e && bytes[3] == 0x47) return "png";
        if (bytes[0] == 'G' && bytes[1] == 'I' && bytes[2] == 'F') return "gif";
        if (bytes.length >= 12 && bytes[0] == 'R' && bytes[1] == 'I'
                && bytes[2] == 'F' && bytes[3] == 'F' && bytes[8] == 'W'
                && bytes[9] == 'E' && bytes[10] == 'B' && bytes[11] == 'P') return "webp";
        return "unknown";
    }

    private static String failure(String message) {
        try {
            JSONObject value = new JSONObject();
            value.put("ok", false);
            value.put("error", message == null ? "이미지 생성 요청에 실패했습니다." : message);
            return value.toString();
        } catch (Exception ignored) {
            return "{\"ok\":false,\"error\":\"이미지 생성 요청에 실패했습니다.\"}";
        }
    }

    private static void deliver(Context context, WebView web, String requestId, String payload) {
        JSONObject queued = details();
        put(queued, "requestId", requestId);
        put(queued, "dataUrlLength", payload == null ? 0 : payload.length());
        if (web == null) {
            record(context, "native_delivery_failed", "reasonCode", "webview_missing");
            return;
        }
        String script = "(function(){var fn=window.__waywardImageProvidersResolve;"
                + "if(typeof fn!=='function')return 'resolver_missing';"
                + "fn(" + JSONObject.quote(requestId) + "," + JSONObject.quote(payload) + ");"
                + "return 'resolver_called';})()";
        boolean posted = web.post(() -> {
            try {
                boolean hasUrl = web.getUrl() != null;
                JSONObject state = details();
                put(state, "requestId", requestId);
                put(state, "webViewUrlPresent", hasUrl);
                record(context, "native_webview_delivery_started", state);
                if (!hasUrl) {
                    record(context, "native_delivery_failed", "reasonCode", "webview_url_missing");
                    return;
                }
                web.evaluateJavascript(script, value -> {
                    String result = value == null ? "" : value.replace("\"", "");
                    JSONObject callback = details();
                    put(callback, "requestId", requestId);
                    put(callback, "reasonCode", result.length() > 80 ? result.substring(0, 80) : result);
                    record(context, "native_js_evaluate_callback", callback);
                    if (result.contains("resolver_called")) {
                        record(context, "native_js_resolver_invoked", "requestId", requestId);
                    } else {
                        record(context, "native_js_resolver_missing", "requestId", requestId);
                    }
                });
            } catch (Throwable error) {
                JSONObject failed = details();
                put(failed, "requestId", requestId);
                put(failed, "errorType", error.getClass().getSimpleName());
                record(context, "native_webview_evaluate_failed", failed);
            }
        });
        put(queued, "deliveryQueued", posted);
        record(context, "native_delivery_queued", queued);
        if (!posted) record(context, "native_delivery_failed", "reasonCode", "webview_post_rejected");
    }
}
