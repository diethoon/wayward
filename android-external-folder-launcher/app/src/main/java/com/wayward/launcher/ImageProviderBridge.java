package com.wayward.launcher;

import android.content.Context;
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
        if (web == null || requestId == null || !requestId.matches("[A-Za-z0-9._-]{1,80}")) return;
        if (prompt == null || prompt.trim().isEmpty() || prompt.length() > 4096) {
            deliver(web, requestId, failure("프롬프트는 1~4,096자로 입력해 주세요."));
            return;
        }
        try {
            EXECUTOR.execute(() -> {
                try {
                    ImageProviderStore.Snapshot snapshot = new ImageProviderStore(context).load();
                    String selectedId = providerId == null ? "" : providerId.trim();
                    if (selectedId.isEmpty()) selectedId = snapshot.defaults.get(profileId);
                    ImageProviderStore.Provider provider = ImageProviderStore.find(snapshot, selectedId);
                    if (provider == null || !provider.enabled) {
                        throw new IllegalStateException("이 게임 프로필에 사용할 기본 이미지 서비스가 없습니다. 런처에서 서비스를 등록하고 지정해 주세요.");
                    }
                    ImageProviderClient.Result image = ImageProviderClient.generate(provider, prompt, width, height);
                    JSONObject result = new JSONObject();
                    result.put("ok", true);
                    result.put("providerId", provider.id);
                    result.put("mimeType", image.mimeType);
                    result.put("dataUrl", "data:" + image.mimeType + ";base64,"
                            + Base64.encodeToString(image.image, Base64.NO_WRAP));
                    deliver(web, requestId, result.toString());
                    JSONObject details = new JSONObject();
                    details.put("providerId", provider.id);
                    details.put("providerType", provider.type);
                    details.put("imageBytes", image.image.length);
                    DiagnosticsLogger.event(context, "INFO", "image_provider", "generation_succeeded", details);
                } catch (Throwable error) {
                    String message = error.getMessage() == null ? "이미지 생성 요청에 실패했습니다." : error.getMessage();
                    deliver(web, requestId, failure(message));
                    JSONObject details = new JSONObject();
                    try {
                        details.put("errorType", error.getClass().getSimpleName());
                        details.put("message", message.length() > 240 ? message.substring(0, 240) : message);
                    } catch (Exception ignored) {}
                    DiagnosticsLogger.event(context, "WARN", "image_provider", "generation_failed", details);
                }
            });
        } catch (Exception rejected) {
            deliver(web, requestId, failure("이미지 생성 요청이 많습니다. 진행 중인 작업이 끝난 뒤 다시 시도해 주세요."));
        }
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

    private static void deliver(WebView web, String requestId, String payload) {
        String script = "window.__waywardImageProvidersResolve&&window.__waywardImageProvidersResolve("
                + JSONObject.quote(requestId) + "," + JSONObject.quote(payload) + ");";
        web.post(() -> {
            try {
                if (web.getUrl() != null) web.evaluateJavascript(script, null);
            } catch (Exception ignored) {}
        });
    }
}
