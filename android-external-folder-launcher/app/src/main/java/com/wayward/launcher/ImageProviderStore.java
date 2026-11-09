package com.wayward.launcher;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Encrypted, app-private provider registry. API credentials never enter WebView storage. */
final class ImageProviderStore {
    private static final String KEY_ALIAS = "wayward.image.providers.v1";
    private static final byte[] MAGIC = new byte[] { 'W', 'I', 'P', '1' };
    private static final int IV_BYTES = 12;
    private static final int MAX_FILE_BYTES = 2 * 1024 * 1024;

    static final class Provider {
        String id = "";
        String name = "";
        String type = "cloudflare-worker";
        String endpoint = "";
        String model = "";
        String apiKey = "";
        String authHeader = "Authorization";
        String authPrefix = "Bearer ";
        String requestTemplate = "";
        String responsePath = "image";
        String responseEncoding = "AUTO";
        boolean enabled = true;
        boolean allowInGame = false;

        JSONObject toJson() throws Exception {
            JSONObject value = new JSONObject();
            value.put("id", id);
            value.put("name", name);
            value.put("type", type);
            value.put("endpoint", endpoint);
            value.put("model", model);
            value.put("apiKey", apiKey);
            value.put("authHeader", authHeader);
            value.put("authPrefix", authPrefix);
            value.put("requestTemplate", requestTemplate);
            value.put("responsePath", responsePath);
            value.put("responseEncoding", responseEncoding);
            value.put("enabled", enabled);
            value.put("allowInGame", allowInGame);
            return value;
        }

        static Provider fromJson(JSONObject value) {
            Provider provider = new Provider();
            provider.id = value.optString("id", "");
            provider.name = value.optString("name", "");
            provider.type = value.optString("type", "custom-json");
            provider.endpoint = value.optString("endpoint", "");
            provider.model = value.optString("model", "");
            provider.apiKey = value.optString("apiKey", "");
            provider.authHeader = value.optString("authHeader", "Authorization");
            provider.authPrefix = value.optString("authPrefix", "Bearer ");
            provider.requestTemplate = value.optString("requestTemplate", "");
            provider.responsePath = value.optString("responsePath", "image");
            provider.responseEncoding = value.optString("responseEncoding", "AUTO");
            provider.enabled = value.optBoolean("enabled", true);
            provider.allowInGame = value.optBoolean("allowInGame", false);
            return provider;
        }
    }

    static final class Snapshot {
        final ArrayList<Provider> providers = new ArrayList<>();
        final LinkedHashMap<String, String> defaults = new LinkedHashMap<>();
    }

    private final File target;

    ImageProviderStore(Context context) {
        target = new File(context.getFilesDir(), "image-providers.enc");
    }

    synchronized Snapshot load() throws Exception {
        if (!target.isFile()) return new Snapshot();
        byte[] packed = readLimited(target, MAX_FILE_BYTES);
        if (packed.length < MAGIC.length + 1 + IV_BYTES + 16) {
            throw new IllegalStateException("이미지 서비스 저장 파일이 손상되었습니다.");
        }
        for (int i = 0; i < MAGIC.length; i++) {
            if (packed[i] != MAGIC[i]) throw new IllegalStateException("지원하지 않는 이미지 서비스 저장 형식입니다.");
        }
        int ivLength = packed[MAGIC.length] & 0xff;
        if (ivLength != IV_BYTES || packed.length <= MAGIC.length + 1 + ivLength) {
            throw new IllegalStateException("이미지 서비스 암호화 헤더가 올바르지 않습니다.");
        }
        byte[] iv = new byte[ivLength];
        System.arraycopy(packed, MAGIC.length + 1, iv, 0, ivLength);
        int encryptedOffset = MAGIC.length + 1 + ivLength;
        byte[] encrypted = new byte[packed.length - encryptedOffset];
        System.arraycopy(packed, encryptedOffset, encrypted, 0, encrypted.length);

        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, getKey(false), new GCMParameterSpec(128, iv));
        byte[] plain = cipher.doFinal(encrypted);
        JSONObject root = new JSONObject(new String(plain, java.nio.charset.StandardCharsets.UTF_8));
        Snapshot snapshot = new Snapshot();
        JSONArray providers = root.optJSONArray("providers");
        if (providers != null) {
            if (providers.length() > 100) throw new IllegalStateException("등록할 수 있는 이미지 서비스는 최대 100개입니다.");
            for (int i = 0; i < providers.length(); i++) {
                JSONObject item = providers.optJSONObject(i);
                if (item == null) continue;
                Provider provider = Provider.fromJson(item);
                if (provider.id.matches("[a-f0-9]{32}") && !provider.name.trim().isEmpty()) {
                    snapshot.providers.add(provider);
                }
            }
        }
        JSONObject defaults = root.optJSONObject("defaults");
        if (defaults != null) {
            java.util.Iterator<String> keys = defaults.keys();
            while (keys.hasNext()) {
                String profileId = keys.next();
                String providerId = defaults.optString(profileId, "");
                if (profileId.matches("[a-f0-9]{32}") && providerId.matches("[a-f0-9]{32}")) {
                    snapshot.defaults.put(profileId, providerId);
                }
            }
        }
        return snapshot;
    }

    synchronized void save(Snapshot snapshot) throws Exception {
        if (snapshot == null || snapshot.providers.size() > 100) {
            throw new IllegalArgumentException("이미지 서비스는 최대 100개까지 등록할 수 있습니다.");
        }
        JSONObject root = new JSONObject();
        root.put("schemaVersion", 1);
        JSONArray providers = new JSONArray();
        for (Provider provider : snapshot.providers) {
            validateProvider(provider);
            providers.put(provider.toJson());
        }
        root.put("providers", providers);
        JSONObject defaults = new JSONObject();
        for (Map.Entry<String, String> entry : snapshot.defaults.entrySet()) {
            if (entry.getKey().matches("[a-f0-9]{32}") && entry.getValue().matches("[a-f0-9]{32}")) {
                defaults.put(entry.getKey(), entry.getValue());
            }
        }
        root.put("defaults", defaults);

        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getKey(true));
        byte[] encrypted = cipher.doFinal(root.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
        byte[] iv = cipher.getIV();
        if (iv == null || iv.length != IV_BYTES) throw new IllegalStateException("이미지 서비스 암호화 초기화에 실패했습니다.");

        ByteArrayOutputStream packed = new ByteArrayOutputStream(MAGIC.length + 1 + iv.length + encrypted.length);
        packed.write(MAGIC);
        packed.write(iv.length);
        packed.write(iv);
        packed.write(encrypted);
        byte[] bytes = packed.toByteArray();
        if (bytes.length > MAX_FILE_BYTES) throw new IllegalStateException("이미지 서비스 설정 저장 용량을 초과했습니다.");

        File parent = target.getParentFile();
        if (parent != null && !parent.isDirectory() && !parent.mkdirs() && !parent.isDirectory()) {
            throw new IllegalStateException("이미지 서비스 저장 폴더를 만들지 못했습니다.");
        }
        File temp = new File(target.getParentFile(), target.getName() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(temp)) {
            out.write(bytes);
            out.flush();
            out.getFD().sync();
        }
        try {
            Files.move(temp.toPath(), target.toPath(),
                    StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (java.nio.file.AtomicMoveNotSupportedException ignored) {
            Files.move(temp.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING);
        }
    }

    static String publicJson(Context context, String profileId) {
        try {
            Snapshot snapshot = new ImageProviderStore(context).load();
            JSONObject root = new JSONObject();
            JSONArray list = new JSONArray();
            for (Provider provider : snapshot.providers) {
                if (!provider.enabled) continue;
                JSONObject item = new JSONObject();
                item.put("id", provider.id);
                item.put("name", provider.name);
                item.put("type", provider.type);
                item.put("model", provider.model);
                item.put("gameEnabled", provider.allowInGame);
                list.put(item);
            }
            root.put("providers", list);
            root.put("defaultProviderId", snapshot.defaults.containsKey(profileId) ? snapshot.defaults.get(profileId) : JSONObject.NULL);
            return root.toString();
        } catch (Exception error) {
            try {
                JSONObject result = new JSONObject();
                result.put("providers", new JSONArray());
                result.put("defaultProviderId", JSONObject.NULL);
                result.put("error", "이미지 서비스 목록을 읽지 못했습니다.");
                return result.toString();
            } catch (Exception ignored) {
                return "{\"providers\":[],\"defaultProviderId\":null}";
            }
        }
    }

    static Provider find(Snapshot snapshot, String id) {
        if (snapshot == null || id == null) return null;
        for (Provider provider : snapshot.providers) if (id.equals(provider.id)) return provider;
        return null;
    }

    static void validateProvider(Provider provider) {
        if (provider == null) throw new IllegalArgumentException("이미지 서비스 설정이 없습니다.");
        if (provider.id == null || !provider.id.matches("[a-f0-9]{32}")) {
            throw new IllegalArgumentException("서비스 ID가 올바르지 않습니다.");
        }
        if (provider.name == null || provider.name.trim().isEmpty() || provider.name.length() > 60) {
            throw new IllegalArgumentException("서비스 이름은 1~60자로 입력해 주세요.");
        }
        if (!"cloudflare-worker".equals(provider.type)
                && !"openai-compatible".equals(provider.type)
                && !"custom-json".equals(provider.type)) {
            throw new IllegalArgumentException("지원하지 않는 서비스 유형입니다.");
        }
        if (provider.endpoint == null || provider.endpoint.trim().isEmpty() || provider.endpoint.length() > 2048) {
            throw new IllegalArgumentException("서비스 주소를 입력해 주세요.");
        }
        if (provider.apiKey != null && provider.apiKey.length() > 4096) {
            throw new IllegalArgumentException("API 키가 너무 깁니다.");
        }
        if (provider.authHeader == null || !provider.authHeader.matches("[A-Za-z0-9-]{1,64}")) {
            throw new IllegalArgumentException("인증 헤더 이름이 올바르지 않습니다.");
        }
        if (provider.authPrefix == null || provider.authPrefix.length() > 128
                || provider.authPrefix.indexOf('\r') >= 0 || provider.authPrefix.indexOf('\n') >= 0) {
            throw new IllegalArgumentException("인증 접두사가 올바르지 않습니다.");
        }
        if (provider.requestTemplate == null || provider.requestTemplate.length() > 64 * 1024) {
            throw new IllegalArgumentException("요청 JSON 템플릿이 너무 큽니다.");
        }
        if (provider.responsePath == null || provider.responsePath.length() > 160) {
            throw new IllegalArgumentException("응답 이미지 경로가 너무 깁니다.");
        }
    }

    private SecretKey getKey(boolean create) throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) return (SecretKey) keyStore.getKey(KEY_ALIAS, null);
        if (!create) throw new IllegalStateException("이 기기의 암호화 키를 찾지 못했습니다. 서비스 설정을 다시 등록해야 합니다.");
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build());
        return generator.generateKey();
    }

    private static byte[] readLimited(File file, int limit) throws Exception {
        if (file.length() > limit) throw new IllegalStateException("이미지 서비스 설정 파일이 너무 큽니다.");
        try (FileInputStream in = new FileInputStream(file);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int total = 0;
            int count;
            while ((count = in.read(buffer)) >= 0) {
                if (count == 0) continue;
                total += count;
                if (total > limit) throw new IllegalStateException("이미지 서비스 설정 파일이 너무 큽니다.");
                out.write(buffer, 0, count);
            }
            return out.toByteArray();
        }
    }
}
