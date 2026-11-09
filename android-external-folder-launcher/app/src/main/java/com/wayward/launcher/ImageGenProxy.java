package com.wayward.launcher;

import android.net.Uri;
import android.util.Base64;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Narrow WebView-to-loopback proxy for the Wayward ImageGen API only. */
final class ImageGenProxy {
    private static final int CONNECT_TIMEOUT_MS = 10000;
    private static final int READ_TIMEOUT_MS = 15 * 60 * 1000;
    private static final int MAX_REQUEST_BYTES = 8 * 1024 * 1024;
    private static final int MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

    private ImageGenProxy() {}

    static void dispatch(WebView web, String requestId, String method,
                         String pathAndQuery, String headersJson, String bodyBase64) {
        if (web == null || requestId == null || !requestId.matches("[A-Za-z0-9._-]{1,80}")) return;
        final String safeMethod = method == null ? "GET" : method.toUpperCase(Locale.ROOT);
        final String safePath = validatePath(pathAndQuery);
        if (safePath == null || !allowedMethod(safeMethod)) {
            deliver(web, requestId, errorResponse(400, "허용되지 않은 ImageGen 요청입니다."));
            return;
        }
        final android.content.Context appContext=web.getContext().getApplicationContext();
        final long startedAt=System.currentTimeMillis();
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                byte[] requestBody = bodyBase64 == null || bodyBase64.isEmpty()
                        ? new byte[0] : Base64.decode(bodyBase64, Base64.DEFAULT);
                if (requestBody.length > MAX_REQUEST_BYTES) {
                    deliver(web, requestId, errorResponse(413, "ImageGen 요청 본문이 너무 큽니다."));
                    return;
                }

                URL url = new URL("http://127.0.0.1:8189" + safePath);
                connection = (HttpURLConnection) url.openConnection();
                connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
                connection.setReadTimeout(READ_TIMEOUT_MS);
                connection.setInstanceFollowRedirects(false);
                connection.setRequestMethod(safeMethod);
                connection.setUseCaches(false);

                JSONObject requestHeaders = headersJson == null || headersJson.isEmpty()
                        ? new JSONObject() : new JSONObject(headersJson);
                Iterator<String> keys = requestHeaders.keys();
                while (keys.hasNext()) {
                    String name = keys.next();
                    String lower = name.toLowerCase(Locale.ROOT);
                    if (lower.equals("host") || lower.equals("origin") || lower.equals("referer")
                            || lower.equals("cookie") || lower.equals("connection")
                            || lower.equals("content-length") || lower.equals("accept-encoding")
                            || lower.equals("upgrade")) continue;
                    Object value = requestHeaders.opt(name);
                    if (value != null && value != JSONObject.NULL) {
                        connection.setRequestProperty(name, String.valueOf(value));
                    }
                }

                if (requestBody.length > 0 && !safeMethod.equals("GET") && !safeMethod.equals("HEAD")) {
                    connection.setDoOutput(true);
                    connection.setFixedLengthStreamingMode(requestBody.length);
                    try (OutputStream out = connection.getOutputStream()) {
                        out.write(requestBody);
                        out.flush();
                    }
                }

                int status = connection.getResponseCode();
                JSONObject diagnostic=new JSONObject();
                try{diagnostic.put("method",safeMethod);diagnostic.put("path",Uri.parse(safePath).getPath());diagnostic.put("status",status);diagnostic.put("elapsedMs",System.currentTimeMillis()-startedAt);}catch(Exception ignored){}
                DiagnosticsLogger.event(appContext,status>=400?"WARN":"INFO","imagegen_proxy","api_response",diagnostic);
                InputStream responseStream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                byte[] responseBody = responseStream == null ? new byte[0]
                        : readLimited(responseStream, MAX_RESPONSE_BYTES);
                if (responseStream != null) responseStream.close();

                JSONObject payload = new JSONObject();
                payload.put("status", status);
                payload.put("statusText", safeStatus(connection.getResponseMessage()));
                payload.put("headers", responseHeaders(connection.getHeaderFields()));
                payload.put("bodyBase64", Base64.encodeToString(responseBody, Base64.NO_WRAP));
                deliver(web, requestId, payload.toString());
            } catch (Exception e) {
                JSONObject diagnostic=new JSONObject();
                try{diagnostic.put("method",safeMethod);diagnostic.put("exception",e.getClass().getSimpleName());diagnostic.put("elapsedMs",System.currentTimeMillis()-startedAt);}catch(Exception ignored){}
                DiagnosticsLogger.event(appContext,"ERROR","imagegen_proxy","api_transport_error",diagnostic);
                deliver(web, requestId, errorResponse(502, e.getMessage() == null
                        ? "ImageGen 서버에 연결하지 못했습니다." : e.getMessage()));
            } finally {
                if (connection != null) connection.disconnect();
            }
        }, "wayward-imagegen-proxy").start();
    }

    private static String validatePath(String raw) {
        if (raw == null || raw.length() > 4096 || !raw.startsWith("/api/")
                || raw.indexOf('\\') >= 0 || raw.indexOf('\0') >= 0) return null;
        Uri uri = Uri.parse("http://127.0.0.1" + raw);
        for (String segment : uri.getPathSegments()) {
            if (".".equals(segment) || "..".equals(segment)) return null;
        }
        return uri.getEncodedPath() + (uri.getEncodedQuery() == null ? "" : "?" + uri.getEncodedQuery());
    }

    private static boolean allowedMethod(String method) {
        return method.equals("GET") || method.equals("POST") || method.equals("PUT")
                || method.equals("PATCH") || method.equals("DELETE") || method.equals("HEAD")
                || method.equals("OPTIONS");
    }

    private static byte[] readLimited(InputStream in, int max) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[32768];
        int total = 0;
        while (true) {
            int count = in.read(buffer);
            if (count < 0) break;
            total += count;
            if (total > max) throw new IllegalStateException("ImageGen 응답이 64MB 제한을 초과했습니다.");
            out.write(buffer, 0, count);
        }
        return out.toByteArray();
    }

    private static JSONObject responseHeaders(Map<String, List<String>> source) throws Exception {
        JSONObject result = new JSONObject();
        for (Map.Entry<String, List<String>> entry : source.entrySet()) {
            String name = entry.getKey();
            if (name == null) continue;
            String lower = name.toLowerCase(Locale.ROOT);
            if (!(lower.equals("content-type") || lower.equals("cache-control")
                    || lower.equals("etag") || lower.equals("retry-after")
                    || lower.equals("content-disposition") || lower.equals("x-request-id"))) continue;
            List<String> values = entry.getValue();
            if (values != null && !values.isEmpty()) result.put(name, values.get(0));
        }
        return result;
    }

    private static String safeStatus(String value) {
        if (value == null) return "";
        return value.replace('\r', ' ').replace('\n', ' ');
    }

    private static String errorResponse(int status, String message) {
        try {
            JSONObject body = new JSONObject();
            body.put("error", message == null ? "ImageGen proxy error" : message);
            JSONObject headers = new JSONObject();
            headers.put("Content-Type", "application/json; charset=utf-8");
            JSONObject response = new JSONObject();
            response.put("status", status);
            response.put("statusText", "Proxy Error");
            response.put("headers", headers);
            response.put("bodyBase64", Base64.encodeToString(
                    body.toString().getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP));
            return response.toString();
        } catch (Exception ignored) {
            return "{\"status\":502,\"statusText\":\"Proxy Error\",\"headers\":{},\"bodyBase64\":\"\"}";
        }
    }

    private static void deliver(WebView web, String requestId, String payload) {
        String js = "window.__waywardImageGenProxyResolve&&window.__waywardImageGenProxyResolve("
                + JSONObject.quote(requestId) + "," + JSONObject.quote(payload) + ");";
        web.post(() -> {
            try { web.evaluateJavascript(js, null); } catch (Exception ignored) {}
        });
    }
}
