package com.wayward.launcher;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;
import java.util.regex.Pattern;

/** Validates a ComfyUI host that is reachable only on a private LAN or a Tailscale network. */
final class ComfyEndpoint {
    private static final Pattern DNS_LABEL = Pattern.compile("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?");
    private ComfyEndpoint() {}

    static String normalizeOptional(String input) {
        if (input == null || input.trim().isEmpty()) return "";
        return normalize(input);
    }

    static String normalize(String input) {
        if (input == null || input.trim().isEmpty()) {
            throw new IllegalArgumentException("PC의 ComfyUI 주소를 입력해 주세요.");
        }
        final URI uri;
        try {
            uri = new URI(input.trim());
        } catch (URISyntaxException error) {
            throw new IllegalArgumentException("주소 형식이 올바르지 않습니다.");
        }
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (scheme == null || host == null) {
            throw new IllegalArgumentException("http:// 또는 https://로 시작하는 PC 주소를 입력해 주세요.");
        }
        scheme = scheme.toLowerCase(Locale.ROOT);
        if (!"http".equals(scheme) && !"https".equals(scheme)) {
            throw new IllegalArgumentException("ComfyUI 연결은 http 또는 https만 지원합니다.");
        }
        if (uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null) {
            throw new IllegalArgumentException("주소에 계정 정보, 쿼리 또는 fragment를 넣을 수 없습니다.");
        }
        String path = uri.getRawPath();
        if (path != null && !path.isEmpty() && !"/".equals(path)) {
            throw new IllegalArgumentException("ComfyUI 주소에는 경로를 붙이지 말고 서버 주소만 입력해 주세요.");
        }

        host = host.toLowerCase(Locale.ROOT);
        if (!isPrivateHost(host)) {
            throw new IllegalArgumentException(
                    "보안을 위해 사설 LAN IP(10.x/172.16~31.x/192.168.x), Tailscale(100.64~127.x 또는 .ts.net), .local 주소만 허용합니다.");
        }
        int port = uri.getPort() == -1 ? 8188 : uri.getPort();
        if (port < 1 || port > 65535) throw new IllegalArgumentException("포트는 1~65535 범위여야 합니다.");
        return scheme + "://" + host + ":" + port;
    }

    private static boolean isPrivateHost(String host) {
        if (host.indexOf(':') >= 0 || host.indexOf('%') >= 0) return false;
        String[] octets = host.split(Pattern.quote("."), -1);
        boolean ipv4Candidate = octets.length == 4;
        if (ipv4Candidate) {
            for (String octet : octets) {
                if (octet.isEmpty()) {
                    ipv4Candidate = false;
                    break;
                }
                for (int i = 0; i < octet.length(); i++) {
                    char digit = octet.charAt(i);
                    if (digit < '0' || digit > '9') {
                        ipv4Candidate = false;
                        break;
                    }
                }
                if (!ipv4Candidate) break;
            }
        }
        // A four-label DNS name such as my-pc.tailnet.ts.net is not an IPv4 candidate.
        // Numeric dotted hosts still require strict IPv4 validation and cannot fall
        // through to the DNS suffix allow-list when their octets are invalid.
        if (ipv4Candidate) {
            int[] ip = new int[4];
            for (int i = 0; i < 4; i++) {
                if (octets[i].length() > 3) return false;
                try { ip[i] = Integer.parseInt(octets[i]); }
                catch (NumberFormatException ignored) { return false; }
                if (ip[i] < 0 || ip[i] > 255) return false;
                if (octets[i].length() > 1 && octets[i].charAt(0) == '0') return false;
            }
            return ip[0] == 10
                    || (ip[0] == 172 && ip[1] >= 16 && ip[1] <= 31)
                    || (ip[0] == 192 && ip[1] == 168)
                    || (ip[0] == 100 && ip[1] >= 64 && ip[1] <= 127);
        }
        if (octets.length == 4 && host.matches("[0-9.]+")) return false;
        if (host.endsWith(".ts.net") || host.endsWith(".local")) {
            String[] labels = host.split("\\.", -1);
            if (labels.length < 2) return false;
            for (String label : labels) {
                if (label.isEmpty() || label.length() > 63 || !DNS_LABEL.matcher(label).matches()) return false;
            }
            return true;
        }
        return false;
    }
}
