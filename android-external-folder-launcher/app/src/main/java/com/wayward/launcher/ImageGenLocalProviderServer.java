package com.wayward.launcher;

import android.content.Context;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * Loopback-only HTTP adapter for the Image Studio JobRunner.
 *
 * The Bun server calls this endpoint from the same Android app process space.
 * Provider credentials are loaded from the AndroidKeyStore-encrypted registry
 * for each request and are never returned to Bun, WebView, or HTTP responses.
 */
final class ImageGenLocalProviderServer implements AutoCloseable {
    static final int PORT = 8190;
    private static final String TAG = "WaywardImageProvider";
    private static final int MAX_HEADERS = 16 * 1024;
    private static final int MAX_BODY = 64 * 1024;
    private static final int MAX_IMAGE = 25 * 1024 * 1024;
    private static final int SOCKET_TIMEOUT_MS = 190_000;

    private final Context context;
    private final String profileId;
    private final String expectedProviderId;
    private final ExecutorService handlers = Executors.newFixedThreadPool(2, runnable -> {
        Thread thread = new Thread(runnable, "wayward-provider-http");
        thread.setDaemon(true);
        return thread;
    });
    private volatile boolean closed;
    private ServerSocket server;
    private Thread acceptThread;

    ImageGenLocalProviderServer(Context context, String profileId, String expectedProviderId) {
        this.context = context.getApplicationContext();
        this.profileId = profileId == null ? "" : profileId.trim();
        this.expectedProviderId = expectedProviderId == null ? "" : expectedProviderId.trim();
        if (!this.profileId.matches("[a-f0-9]{32}")) {
            throw new IllegalArgumentException("이미지 서비스 프로필 ID가 올바르지 않습니다.");
        }
        if (!this.expectedProviderId.matches("[a-f0-9]{32}")) {
            throw new IllegalArgumentException("기본 이미지 서비스 ID가 올바르지 않습니다.");
        }
    }

    synchronized void start() throws IOException {
        if (closed) throw new IllegalStateException("이미지 서비스 어댑터가 이미 종료되었습니다.");
        if (server != null && server.isBound() && !server.isClosed()) return;
        ServerSocket socket = new ServerSocket();
        socket.setReuseAddress(false);
        socket.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), PORT), 8);
        server = socket;
        acceptThread = new Thread(this::acceptLoop, "wayward-provider-accept");
        acceptThread.setDaemon(true);
        acceptThread.start();
        Log.i(TAG, "loopback provider adapter listening on 127.0.0.1:" + PORT);
    }

    private void acceptLoop() {
        while (!closed) {
            try {
                Socket client = server.accept();
                client.setSoTimeout(SOCKET_TIMEOUT_MS);
                client.setTcpNoDelay(true);
                try {
                    handlers.execute(() -> handle(client));
                } catch (RuntimeException rejected) {
                    respondQuietly(client, 503, "application/json; charset=utf-8",
                            "{\"error\":\"이미지 서비스 요청이 너무 많습니다.\"}".getBytes(StandardCharsets.UTF_8));
                    closeQuietly(client);
                }
            } catch (IOException error) {
                if (!closed) Log.w(TAG, "provider adapter accept failed", error);
                break;
            }
        }
    }

    private void handle(Socket socket) {
        try {
            InputStream raw = new BufferedInputStream(socket.getInputStream());
            OutputStream output = socket.getOutputStream();
            String requestLine = readLine(raw, 4096);
            if (requestLine == null || requestLine.isEmpty()) {
                writeResponse(output, 400, "application/json; charset=utf-8",
                        "{\"error\":\"잘못된 요청입니다.\"}".getBytes(StandardCharsets.UTF_8));
                return;
            }
            String[] parts = requestLine.split(" ", 3);
            if (parts.length != 3 || !"HTTP/1.1".equals(parts[2])) {
                writeResponse(output, 400, "application/json; charset=utf-8",
                        "{\"error\":\"HTTP 요청 형식이 올바르지 않습니다.\"}".getBytes(StandardCharsets.UTF_8));
                return;
            }

            int headerBytes = requestLine.length();
            java.util.HashMap<String, String> headers = new java.util.HashMap<>();
            while (true) {
                String line = readLine(raw, MAX_HEADERS);
                if (line == null) throw new IOException("요청 헤더가 끝나기 전에 연결이 종료되었습니다.");
                headerBytes += line.length() + 2;
                if (headerBytes > MAX_HEADERS) {
                    writeResponse(output, 431, "application/json; charset=utf-8",
                            "{\"error\":\"요청 헤더가 너무 큽니다.\"}".getBytes(StandardCharsets.UTF_8));
                    return;
                }
                if (line.isEmpty()) break;
                int colon = line.indexOf(':');
                if (colon <= 0) continue;
                String key = line.substring(0, colon).trim().toLowerCase(Locale.ROOT);
                String value = line.substring(colon + 1).trim();
                if (!headers.containsKey(key)) headers.put(key, value);
            }

            String method = parts[0];
            String target = parts[1];
            if ("GET".equals(method) && "/health".equals(target)) {
                JSONObject status = providerStatus();
                boolean ready = status.optBoolean("ready", false);
                writeResponse(output, ready ? 200 : 503, "application/json; charset=utf-8",
                        status.toString().getBytes(StandardCharsets.UTF_8));
                return;
            }
            if (!"POST".equals(method) || !"/generate".equals(target)) {
                writeResponse(output, 404, "application/json; charset=utf-8",
                        "{\"error\":\"요청 경로를 찾을 수 없습니다.\"}".getBytes(StandardCharsets.UTF_8));
                return;
            }

            if (headers.containsKey("transfer-encoding")) {
                writeResponse(output, 400, "application/json; charset=utf-8",
                        "{\"error\":\"Transfer-Encoding 요청은 지원하지 않습니다.\"}".getBytes(StandardCharsets.UTF_8));
                return;
            }
            int length;
            try {
                length = Integer.parseInt(headers.getOrDefault("content-length", "-1"));
            } catch (NumberFormatException error) {
                length = -1;
            }
            if (length < 1 || length > MAX_BODY) {
                writeResponse(output, 413, "application/json; charset=utf-8",
                        "{\"error\":\"이미지 생성 요청 크기가 제한을 초과했습니다.\"}".getBytes(StandardCharsets.UTF_8));
                return;
            }
            byte[] request = readExactly(raw, length);
            JSONObject body = new JSONObject(new String(request, StandardCharsets.UTF_8));
            String requestedProfile = body.optString("profileId", "");
            if (!profileId.equals(requestedProfile)) {
                writeResponse(output, 403, "application/json; charset=utf-8",
                        "{\"error\":\"게임 프로필이 현재 이미지 서비스 세션과 일치하지 않습니다.\"}".getBytes(StandardCharsets.UTF_8));
                return;
            }
            String prompt = body.optString("prompt", "").trim();
            String negativePrompt = body.optString("negativePrompt", "");
            String requestId = body.optString("requestId", "");
            if (prompt.isEmpty() || prompt.length() > 4096 || negativePrompt.length() > 4096
                    || !requestId.matches("[A-Za-z0-9._-]{1,80}")) {
                writeResponse(output, 400, "application/json; charset=utf-8",
                        "{\"error\":\"프롬프트 또는 요청 ID가 올바르지 않습니다.\"}".getBytes(StandardCharsets.UTF_8));
                return;
            }

            int width = Math.max(256, Math.min(2048, body.optInt("width", 1024)));
            int height = Math.max(256, Math.min(2048, body.optInt("height", 1024)));
            ImageProviderClient.Result result = generate(requestId, prompt, negativePrompt, width, height);
            if (result.image == null || result.image.length == 0 || result.image.length > MAX_IMAGE) {
                throw new IllegalStateException("이미지 서비스가 비어 있거나 너무 큰 이미지를 반환했습니다.");
            }
            writeResponse(output, 200, safeMime(result.mimeType), result.image);
        } catch (Exception error) {
            String message = error.getMessage();
            if (message == null || message.trim().isEmpty()) message = "이미지 생성 요청에 실패했습니다.";
            if (message.length() > 240) message = message.substring(0, 240);
            Log.w(TAG, "provider request failed: " + error.getClass().getSimpleName() + ": " + message);
            respondQuietly(socket, 502, "application/json; charset=utf-8",
                    jsonError(message).getBytes(StandardCharsets.UTF_8));
        } finally {
            closeQuietly(socket);
        }
    }

    private ImageProviderClient.Result generate(String requestId, String prompt, String negativePrompt,
                                                int width, int height) throws Exception {
        ImageProviderStore.Snapshot snapshot = new ImageProviderStore(context).load();
        ImageProviderStore.Provider primary = ImageProviderStore.find(snapshot, expectedProviderId);
        if (primary == null || !expectedProviderId.equals(snapshot.defaults.get(profileId))) {
            throw new IllegalStateException("기본 이미지 서비스가 변경되었습니다. 런처에서 이미지 서버를 다시 시작해 주세요.");
        }
        if (!primary.enabled || !primary.allowInGame) {
            throw new IllegalStateException("기본 이미지 서비스가 비활성화되었거나 게임 사용이 허용되지 않았습니다.");
        }

        try {
            return ImageProviderClient.generate(primary, prompt, negativePrompt, width, height, context, requestId);
        } catch (Exception primaryError) {
            String fallbackId = snapshot.fallbacks.get(profileId);
            ImageProviderStore.Provider fallback = ImageProviderStore.find(snapshot, fallbackId);
            if (fallback == null || fallback.id.equals(primary.id) || !fallback.enabled || !fallback.allowInGame) {
                throw primaryError;
            }
            try {
                Log.i(TAG, "primary image provider failed; trying configured fallback");
                return ImageProviderClient.generate(fallback, prompt, negativePrompt, width, height, context, requestId);
            } catch (Exception fallbackError) {
                throw new IllegalStateException("기본 이미지 서비스와 대체 서비스가 모두 실패했습니다: "
                        + fallbackError.getMessage(), fallbackError);
            }
        }
    }

    private JSONObject providerStatus() {
        JSONObject result = new JSONObject();
        try {
            ImageProviderStore.Snapshot snapshot = new ImageProviderStore(context).load();
            ImageProviderStore.Provider primary = ImageProviderStore.find(snapshot, expectedProviderId);
            boolean ready = primary != null
                    && expectedProviderId.equals(snapshot.defaults.get(profileId))
                    && primary.enabled && primary.allowInGame;
            result.put("ready", ready);
            result.put("profileId", profileId);
            result.put("providerId", ready ? primary.id : "");
            result.put("providerType", ready ? primary.type : "");
            result.put("message", ready ? "configured" : "provider_not_configured");
        } catch (Exception error) {
            try {
                result.put("ready", false);
                result.put("message", "provider_store_unavailable");
            } catch (Exception ignored) {}
        }
        return result;
    }

    private static String safeMime(String raw) {
        String value = raw == null ? "" : raw.toLowerCase(Locale.ROOT).split(";", 2)[0].trim();
        if ("image/jpeg".equals(value) || "image/png".equals(value) || "image/webp".equals(value)) return value;
        return "image/png";
    }

    private static String jsonError(String message) {
        JSONObject result = new JSONObject();
        try { result.put("error", message); } catch (Exception ignored) {}
        return result.toString();
    }

    private static String readLine(InputStream input, int limit) throws IOException {
        ByteArrayOutputStream line = new ByteArrayOutputStream();
        int value;
        boolean sawAny = false;
        while ((value = input.read()) >= 0) {
            sawAny = true;
            if (value == '\n') break;
            if (value != '\r') {
                line.write(value);
                if (line.size() > limit) throw new IOException("HTTP line exceeds limit");
            }
        }
        if (!sawAny && line.size() == 0) return null;
        return line.toString(StandardCharsets.US_ASCII.name());
    }

    private static byte[] readExactly(InputStream input, int length) throws IOException {
        byte[] bytes = new byte[length];
        int offset = 0;
        while (offset < length) {
            int count = input.read(bytes, offset, length - offset);
            if (count < 0) throw new IOException("요청 본문이 Content-Length보다 짧습니다.");
            if (count == 0) continue;
            offset += count;
        }
        return bytes;
    }

    private static void writeResponse(OutputStream output, int status, String contentType, byte[] bytes)
            throws IOException {
        String reason = status == 200 ? "OK" : status == 400 ? "Bad Request"
                : status == 403 ? "Forbidden" : status == 404 ? "Not Found"
                : status == 413 ? "Payload Too Large" : status == 431 ? "Request Header Fields Too Large"
                : status == 502 ? "Bad Gateway" : status == 503 ? "Service Unavailable" : "Error";
        String headers = "HTTP/1.1 " + status + " " + reason + "\r\n"
                + "Content-Type: " + contentType + "\r\n"
                + "Content-Length: " + bytes.length + "\r\n"
                + "Cache-Control: no-store\r\n"
                + "Connection: close\r\n\r\n";
        output.write(headers.getBytes(StandardCharsets.US_ASCII));
        output.write(bytes);
        output.flush();
    }

    private static void respondQuietly(Socket socket, int status, String contentType, byte[] bytes) {
        try { writeResponse(socket.getOutputStream(), status, contentType, bytes); } catch (Exception ignored) {}
    }

    private static void closeQuietly(Socket socket) {
        try { socket.close(); } catch (Exception ignored) {}
    }

    @Override public synchronized void close() {
        if (closed) return;
        closed = true;
        if (server != null) {
            try { server.close(); } catch (Exception ignored) {}
            server = null;
        }
        handlers.shutdownNow();
        try { handlers.awaitTermination(2, TimeUnit.SECONDS); }
        catch (InterruptedException error) { Thread.currentThread().interrupt(); }
        if (acceptThread != null) acceptThread.interrupt();
        Log.i(TAG, "loopback provider adapter stopped");
    }
}
