package com.wayward.launcher;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.ByteBuffer;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Encrypts the upload credential using an app-private Android Keystore key. */
final class DiagnosticsTokenStore {
    private static final String PREFS = "wayward_diagnostics_auth";
    private static final String VALUE = "encrypted_upload_token";
    private static final String ALIAS = "wayward-launcher-diagnostics-aes";
    private DiagnosticsTokenStore() {}

    static boolean has(Context context) { return !get(context).isEmpty(); }

    static synchronized void save(Context context, String token) throws Exception {
        String normalized = token == null ? "" : token.trim();
        if (normalized.length() < 32 || normalized.length() > 256) {
            throw new IllegalArgumentException("Invalid diagnostics token");
        }
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
        byte[] iv = cipher.getIV();
        byte[] encrypted = cipher.doFinal(normalized.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        ByteBuffer payload = ByteBuffer.allocate(iv.length + encrypted.length);
        payload.put(iv).put(encrypted);
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString(VALUE, Base64.encodeToString(payload.array(), Base64.NO_WRAP)).apply();
    }

    static synchronized String get(Context context) {
        String stored = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(VALUE, "");
        if (stored == null || stored.isEmpty()) return "";
        try {
            byte[] payload = Base64.decode(stored, Base64.DEFAULT);
            if (payload.length < 29) throw new IllegalStateException("Stored diagnostics key is incomplete");
            ByteBuffer buffer = ByteBuffer.wrap(payload);
            byte[] iv = new byte[12];
            buffer.get(iv);
            byte[] encrypted = new byte[buffer.remaining()];
            buffer.get(encrypted);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(128, iv));
            return new String(cipher.doFinal(encrypted), java.nio.charset.StandardCharsets.UTF_8);
        } catch (Exception error) {
            clear(context);
            return "";
        }
    }

    static synchronized void clear(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(VALUE).apply();
    }

    private static SecretKey getOrCreateKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        java.security.Key key = store.getKey(ALIAS, null);
        if (key instanceof SecretKey) return (SecretKey) key;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build());
        return generator.generateKey();
    }
}
