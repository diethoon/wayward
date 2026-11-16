package com.wayward.launcher;

import android.content.Context;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/** Synchronous HTTP adapter. Call from a worker thread; never exposes provider credentials to JS. */
final class ImageProviderClient {
    private static final int CONNECT_TIMEOUT_MS = 15000;
    private static final int READ_TIMEOUT_MS = 180000;
    private static final int MAX_JSON_BYTES = 2 * 1024 * 1024;
    private static final int MAX_IMAGE_BYTES = 25 * 1024 * 1024;

    static final class Result {
        final byte[] image;
        final String mimeType;

        Result(byte[] image, String mimeType) {
            this.image = image;
            this.mimeType = mimeType == null || mimeType.isEmpty() ? "image/png" : mimeType;
        }
    }

    private static final class HttpResult {
        final int status;
        final String contentType;
        final byte[] body;

        HttpResult(int status, String contentType, byte[] body) {
            this.status = status;
            this.contentType = contentType == null ? "" : contentType;
            this.body = body;
        }
    }

    private ImageProviderClient() {}

    static Result generate(ImageProviderStore.Provider provider, String prompt,
                           int width, int height) throws Exception {
        return generate(provider, prompt, "", width, height, null, "");
    }

    static Result generate(ImageProviderStore.Provider provider, String prompt,
                           int width, int height, Context diagnosticContext,
                           String diagnosticRequestId) throws Exception {
        return generate(provider, prompt, "", width, height, diagnosticContext, diagnosticRequestId);
    }

    static Result generate(ImageProviderStore.Provider provider, String prompt, String negativePrompt,
                           int width, int height, Context diagnosticContext,
                           String diagnosticRequestId) throws Exception {
        ImageProviderStore.validateProvider(provider);
        if (prompt == null || prompt.trim().isEmpty()) throw new IllegalArgumentException("이미지 프롬프트를 입력해 주세요.");
        if (prompt.length() > 4096) throw new IllegalArgumentException("프롬프트는 4,096자 이내로 입력해 주세요.");
        int safeWidth = Math.max(256, Math.min(2048, width));
        int safeHeight = Math.max(256, Math.min(2048, height));
        String size = safeWidth + "x" + safeHeight;

        String endpoint;
        JSONObject body = new JSONObject();
        if ("cloudflare-worker".equals(provider.type)) {
            endpoint = provider.endpoint.trim();
            body.put("prompt", prompt);
            if (negativePrompt != null && !negativePrompt.trim().isEmpty()) body.put("negativePrompt", negativePrompt.trim());
            if (provider.model != null && !provider.model.trim().isEmpty()) body.put("model", provider.model.trim());
        } else if ("openai-compatible".equals(provider.type)) {
            endpoint = openAiEndpoint(provider.endpoint);
            if (provider.model == null || provider.model.trim().isEmpty()) {
                throw new IllegalArgumentException("모델 ID를 입력해 주세요.");
            }
            body.put("model", provider.model.trim());
            if (negativePrompt != null && !negativePrompt.trim().isEmpty()) {
                body.put("negative_prompt", negativePrompt.trim());
            }
            body.put("prompt", prompt);
            body.put("n", 1);
            body.put("size", size);
        } else if ("custom-json".equals(provider.type)) {
            endpoint = provider.endpoint.trim();
            String template = provider.requestTemplate == null ? "" : provider.requestTemplate.trim();
            if (template.isEmpty()) throw new IllegalArgumentException("사용자 지정 요청 JSON을 입력해 주세요.");
            String expanded = template
                    .replace("{{prompt}}", escapeJsonValue(prompt))
                    .replace("{{negativePrompt}}", escapeJsonValue(negativePrompt == null ? "" : negativePrompt))
                    .replace("{{model}}", escapeJsonValue(provider.model == null ? "" : provider.model))
                    .replace("{{width}}", Integer.toString(safeWidth))
                    .replace("{{height}}", Integer.toString(safeHeight))
                    .replace("{{size}}", escapeJsonValue(size));
            body = new JSONObject(expanded);
        } else {
            throw new IllegalArgumentException("지원하지 않는 이미지 서비스 유형입니다.");
        }

        long requestStarted = System.nanoTime();
        HttpResult response;
        try {
            response = post(endpoint, body.toString().getBytes(StandardCharsets.UTF_8), provider);
        } catch (Exception error) {
            JSONObject diagnostic = new JSONObject();
            try {
                diagnostic.put("requestId", diagnosticRequestId == null ? "" : diagnosticRequestId);
                diagnostic.put("providerType", provider.type);
                diagnostic.put("errorType", error.getClass().getSimpleName());
                diagnostic.put("elapsedMs", (System.nanoTime() - requestStarted) / 1_000_000L);
            } catch (Exception ignored) {}
            ImagePipelineDiagnostics.record(diagnosticContext, "provider_http_request_failed", diagnostic);
            throw error;
        }
        JSONObject httpDiagnostic = new JSONObject();
        try {
            httpDiagnostic.put("requestId", diagnosticRequestId == null ? "" : diagnosticRequestId);
            httpDiagnostic.put("providerType", provider.type);
            httpDiagnostic.put("responseStatus", response.status);
            httpDiagnostic.put("responseContentType", response.contentType.split(";")[0].trim().toLowerCase(Locale.ROOT));
            httpDiagnostic.put("responseBytes", response.body.length);
            httpDiagnostic.put("elapsedMs", (System.nanoTime() - requestStarted) / 1_000_000L);
        } catch (Exception ignored) {}
        ImagePipelineDiagnostics.record(diagnosticContext,
                response.status >= 200 && response.status < 300 ? "provider_http_response" : "provider_http_error",
                httpDiagnostic);
        if (response.status < 200 || response.status >= 300) {
            throw new IllegalStateException(httpError(response));
        }
        if (response.contentType.toLowerCase(Locale.ROOT).startsWith("image/")) {
            return new Result(response.body, mimeOnly(response.contentType));
        }

        JSONObject json;
        try {
            json = new JSONObject(new String(response.body, StandardCharsets.UTF_8));
        } catch (Exception error) {
            throw new IllegalStateException("이미지 서비스 응답을 JSON으로 해석하지 못했습니다. 응답 형식 설정을 확인해 주세요.");
        }

        if ("cloudflare-worker".equals(provider.type)) {
            if (!json.optBoolean("success", true)) {
                String error = json.optString("error", "Worker에서 이미지 생성을 거부했습니다.");
                throw new IllegalStateException(limit(error, 240));
            }
            String value = json.optString("image", "");
            if (value.isEmpty()) {
                JSONObject result = json.optJSONObject("result");
                if (result != null) value = result.optString("image", "");
            }
            if (value.isEmpty()) throw new IllegalStateException("Worker 응답에 image 필드가 없습니다.");
            String mime = json.optString("mimeType", "image/jpeg");
            return new Result(decodeBase64(value), mimeOnly(mime));
        }

        if ("openai-compatible".equals(provider.type)) {
            JSONArray data = json.optJSONArray("data");
            if (data == null || data.length() == 0 || data.optJSONObject(0) == null) {
                throw new IllegalStateException(apiMessage(json, "이미지 데이터가 응답에 없습니다."));
            }
            JSONObject first = data.optJSONObject(0);
            String encoded = first.optString("b64_json", "");
            if (!encoded.isEmpty()) return new Result(decodeBase64(encoded), "image/png");
            String imageUrl = first.optString("url", "");
            if (!imageUrl.isEmpty()) return downloadImage(imageUrl);
            throw new IllegalStateException("OpenAI 호환 응답에 data[0].url 또는 data[0].b64_json이 없습니다.");
        }

        String path = provider.responsePath == null ? "" : provider.responsePath.trim();
        Object selected = selectJsonPath(json, path);
        if (selected == null || selected == JSONObject.NULL) {
            throw new IllegalStateException("응답 이미지 경로를 찾지 못했습니다: " + path);
        }
        String value = String.valueOf(selected).trim();
        String encoding = provider.responseEncoding == null ? "AUTO" : provider.responseEncoding.toUpperCase(Locale.ROOT);
        if ("URL".equals(encoding) || ("AUTO".equals(encoding) && looksLikeUrl(value))) {
            return downloadImage(value);
        }
        if (value.startsWith("data:image/")) {
            int comma = value.indexOf(',');
            if (comma < 0) throw new IllegalStateException("data URL 응답이 올바르지 않습니다.");
            String mime = value.substring(5, value.indexOf(';') > 0 ? value.indexOf(';') : comma);
            return new Result(decodeBase64(value.substring(comma + 1)), mimeOnly(mime));
        }
        return new Result(decodeBase64(value), "image/png");
    }

    static void validateEndpoint(String raw) throws Exception {
        if (raw == null || raw.trim().isEmpty()) throw new IllegalArgumentException("서비스 주소를 입력해 주세요.");
        URI uri = new URI(raw.trim());
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        String host = uri.getHost();
        if (host == null || host.isEmpty() || uri.getUserInfo() != null || uri.getFragment() != null) {
            throw new IllegalArgumentException("서비스 주소가 올바른 URL이 아닙니다.");
        }
        if ("https".equals(scheme)) return;
        if (!"http".equals(scheme) || !isPrivateHost(host)) {
            throw new IllegalArgumentException("인터넷 서비스는 HTTPS 주소를 사용해 주세요. HTTP는 사설 LAN 주소에서만 허용됩니다.");
        }
    }

    private static HttpResult post(String endpoint, byte[] body,
                                   ImageProviderStore.Provider provider) throws Exception {
        validateEndpoint(endpoint);
        if (body.length > MAX_JSON_BYTES) throw new IllegalArgumentException("이미지 요청 JSON이 너무 큽니다.");
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(endpoint).openConnection();
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setUseCaches(false);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Accept", "application/json, image/*");
            if (provider.apiKey != null && !provider.apiKey.isEmpty()) {
                String header = provider.authHeader == null ? "Authorization" : provider.authHeader;
                String prefix = provider.authPrefix == null ? "Bearer " : provider.authPrefix;
                if (header.indexOf('\r') >= 0 || header.indexOf('\n') >= 0
                        || prefix.indexOf('\r') >= 0 || prefix.indexOf('\n') >= 0
                        || provider.apiKey.indexOf('\r') >= 0 || provider.apiKey.indexOf('\n') >= 0) {
                    throw new IllegalArgumentException("인증 헤더 값에 줄바꿈 문자를 사용할 수 없습니다.");
                }
                connection.setRequestProperty(header, prefix + provider.apiKey);
            }
            connection.setFixedLengthStreamingMode(body.length);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(body);
                out.flush();
            }
            int status = connection.getResponseCode();
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            String type = connection.getContentType();
            byte[] bytes = stream == null ? new byte[0]
                    : readLimited(stream, type != null && type.toLowerCase(Locale.ROOT).startsWith("image/")
                    ? MAX_IMAGE_BYTES : MAX_JSON_BYTES);
            if (stream != null) stream.close();
            return new HttpResult(status, type, bytes);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static Result downloadImage(String rawUrl) throws Exception {
        validateEndpoint(rawUrl);
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(rawUrl).openConnection();
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestMethod("GET");
            connection.setRequestProperty("Accept", "image/*");
            int status = connection.getResponseCode();
            if (status >= 300 && status < 400) {
                throw new IllegalStateException("이미지 URL이 리디렉션을 반환했습니다. 리디렉션이 끝난 HTTPS 이미지 주소를 직접 입력해 주세요.");
            }
            if (status < 200 || status >= 300) throw new IllegalStateException("이미지 URL 다운로드 실패(HTTP " + status + ").");
            String type = connection.getContentType();
            if (type == null || !type.toLowerCase(Locale.ROOT).startsWith("image/")) {
                throw new IllegalStateException("응답 URL이 이미지 파일을 반환하지 않았습니다.");
            }
            try (InputStream in = connection.getInputStream()) {
                return new Result(readLimited(in, MAX_IMAGE_BYTES), mimeOnly(type));
            }
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static Object selectJsonPath(JSONObject root, String path) throws Exception {
        if (path == null || path.isEmpty()) return null;
        Object current = root;
        for (String part : path.split("\\.")) {
            if (current instanceof JSONObject) current = ((JSONObject) current).opt(part);
            else if (current instanceof JSONArray) {
                int index;
                try { index = Integer.parseInt(part); } catch (NumberFormatException error) { return null; }
                current = ((JSONArray) current).opt(index);
            } else return null;
            if (current == null) return null;
        }
        return current;
    }

    private static String openAiEndpoint(String raw) {
        String value = raw.trim().replaceAll("/+$", "");
        if (value.endsWith("/v1/images/generations")) return value;
        if (value.endsWith("/v1")) return value + "/images/generations";
        return value + "/v1/images/generations";
    }

    private static String escapeJsonValue(String value) {
        String quoted = JSONObject.quote(value == null ? "" : value);
        return quoted.substring(1, quoted.length() - 1);
    }

    private static byte[] decodeBase64(String raw) throws Exception {
        String value = raw == null ? "" : raw.trim();
        if (value.startsWith("data:")) {
            int comma = value.indexOf(',');
            if (comma < 0) throw new IllegalArgumentException("이미지 data URL이 올바르지 않습니다.");
            value = value.substring(comma + 1);
        }
        byte[] bytes;
        try {
            bytes = Base64.decode(value, Base64.DEFAULT);
        } catch (IllegalArgumentException error) {
            throw new IllegalStateException("응답 이미지가 올바른 Base64 데이터가 아닙니다.");
        }
        if (bytes.length == 0 || bytes.length > MAX_IMAGE_BYTES) {
            throw new IllegalStateException("응답 이미지가 비어 있거나 25MB 제한을 초과했습니다.");
        }
        return bytes;
    }

    private static byte[] readLimited(InputStream in, int limit) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[32768];
        int total = 0;
        int count;
        while ((count = in.read(buffer)) >= 0) {
            if (count == 0) continue;
            total += count;
            if (total > limit) throw new IllegalStateException("이미지 서비스 응답이 용량 제한을 초과했습니다.");
            out.write(buffer, 0, count);
        }
        return out.toByteArray();
    }

    private static String httpError(HttpResult response) {
        String body = new String(response.body, StandardCharsets.UTF_8);
        try {
            JSONObject json = new JSONObject(body);
            return "이미지 서비스 요청 실패(HTTP " + response.status + "): "
                    + limit(apiMessage(json, "서비스에서 오류를 반환했습니다."), 240);
        } catch (Exception ignored) {
            return "이미지 서비스 요청 실패(HTTP " + response.status + "). 주소·키·모델 설정을 확인해 주세요.";
        }
    }

    private static String apiMessage(JSONObject json, String fallback) {
        JSONObject error = json.optJSONObject("error");
        if (error != null) {
            String message = error.optString("message", "");
            if (!message.isEmpty()) return message;
        }
        String message = json.optString("error", "");
        if (!message.isEmpty()) return message;
        return fallback;
    }

    private static String mimeOnly(String contentType) {
        if (contentType == null) return "image/png";
        String mime = contentType.split(";")[0].trim().toLowerCase(Locale.ROOT);
        return mime.startsWith("image/") ? mime : "image/png";
    }

    private static boolean looksLikeUrl(String value) {
        return value.startsWith("https://") || value.startsWith("http://");
    }

    private static boolean isPrivateHost(String host) {
        String value = host.toLowerCase(Locale.ROOT);
        if ("localhost".equals(value) || value.endsWith(".local")) return true;
        try {
            byte[] address = InetAddress.getByName(value).getAddress();
            if (address.length == 4) {
                int a = address[0] & 255, b = address[1] & 255;
                return a == 10 || a == 127 || (a == 172 && b >= 16 && b <= 31)
                        || (a == 192 && b == 168) || (a == 169 && b == 254);
            }
            if (address.length == 16) return InetAddress.getByName(value).isSiteLocalAddress()
                    || InetAddress.getByName(value).isLoopbackAddress() || InetAddress.getByName(value).isLinkLocalAddress();
        } catch (Exception ignored) {}
        return false;
    }

    private static String limit(String value, int max) {
        if (value == null) return "";
        return value.length() <= max ? value : value.substring(0, max) + "…";
    }
}
