package com.wayward.launcher;

public final class ComfyEndpointTest {
    public static void main(String[] args) {
        equal("http://192.168.31.41:8188", ComfyEndpoint.normalize(" http://192.168.31.41 "));
        equal("http://10.0.0.5:8188", ComfyEndpoint.normalize("http://10.0.0.5:8188/"));
        equal("http://100.70.2.3:8188", ComfyEndpoint.normalize("http://100.70.2.3:8188"));
        equal("https://my-pc.tailnet.ts.net:8188", ComfyEndpoint.normalize("https://my-pc.tailnet.ts.net"));
        equal("http://wayward-pc.local:8188", ComfyEndpoint.normalize("http://wayward-pc.local:8188"));

        rejects("");
        rejects("http://127.0.0.1:8188");
        rejects("http://localhost:8188");
        rejects("http://8.8.8.8:8188");
        rejects("http://192.168.1.2:8188/admin");
        rejects("http://user:pass@192.168.1.2:8188");
        rejects("http://192.168.1.2:8188?token=x");
        rejects("ftp://192.168.1.2:8188");
        rejects("http://192.168.1.2:70000");
        rejects("http://192.168.1.2:0");
        rejects("http://100.63.255.1:8188");
        rejects("https://public.example.com:8188");
        System.out.println("ComfyEndpoint tests passed.");
    }

    private static void equal(String expected, String actual) {
        if (!expected.equals(actual)) throw new AssertionError("expected " + expected + ", got " + actual);
    }
    private static void rejects(String value) {
        try {
            ComfyEndpoint.normalize(value);
            throw new AssertionError("expected rejection: " + value);
        } catch (IllegalArgumentException expected) {
            System.out.println("PASS rejected " + value);
        }
    }
}
