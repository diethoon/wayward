/* Browser-only encryption for personal Google Drive cloud saves.
 * The passphrase and AES key never leave this browser context.
 */
(() => {
  'use strict';

  const FORMAT = 'wayward-google-drive-save';
  const VERSION = 1;
  const ITERATIONS = 310000;
  const AAD = new TextEncoder().encode('wayward-google-drive-save:v1');
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
    }
    return btoa(binary);
  }

  function base64ToBytes(value) {
    if (typeof value !== 'string' || !value) throw new Error('암호화 데이터가 올바르지 않습니다.');
    let binary;
    try { binary = atob(value); }
    catch (_) { throw new Error('암호화 데이터의 인코딩이 올바르지 않습니다.'); }
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function deriveKey(passphrase, salt, iterations) {
    if (typeof passphrase !== 'string' || passphrase.length < 1) {
      throw new Error('암호화 비밀번호를 입력해 주세요.');
    }
    if (!globalThis.crypto || !crypto.subtle) {
      throw new Error('이 브라우저에서 안전한 암호화를 사용할 수 없습니다. HTTPS 또는 localhost 환경을 확인해 주세요.');
    }
    const material = await crypto.subtle.importKey(
      'raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptSnapshot(snapshot, passphrase) {
    if (!snapshot || typeof snapshot !== 'object') throw new Error('세이브 데이터가 없습니다.');
    if (typeof passphrase !== 'string' || passphrase.length < 10) {
      throw new Error('세이브 암호화 비밀번호는 10자 이상으로 설정해 주세요.');
    }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt, ITERATIONS);
    const plaintext = encoder.encode(JSON.stringify(snapshot));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: AAD, tagLength: 128 },
      key,
      plaintext
    );
    return {
      format: FORMAT,
      version: VERSION,
      kdf: 'PBKDF2-SHA-256',
      iterations: ITERATIONS,
      cipher: 'AES-256-GCM',
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(encrypted)),
      encryptedAt: Date.now()
    };
  }

  async function decryptSnapshot(envelope, passphrase) {
    if (!envelope || envelope.format !== FORMAT || envelope.version !== VERSION ||
        envelope.kdf !== 'PBKDF2-SHA-256' || envelope.cipher !== 'AES-256-GCM') {
      throw new Error('지원하지 않는 Google Drive 세이브 파일입니다.');
    }
    const iterations = Number(envelope.iterations);
    if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 1000000) {
      throw new Error('암호화 설정이 올바르지 않습니다.');
    }
    try {
      const salt = base64ToBytes(envelope.salt);
      const iv = base64ToBytes(envelope.iv);
      const ciphertext = base64ToBytes(envelope.ciphertext);
      if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 16) {
        throw new Error('암호화 데이터의 길이가 올바르지 않습니다.');
      }
      const key = await deriveKey(passphrase, salt, iterations);
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, additionalData: AAD, tagLength: 128 },
        key,
        ciphertext
      );
      const snapshot = JSON.parse(decoder.decode(plaintext));
      if (!snapshot || snapshot.schema !== 'wayward-cloud-save' ||
          snapshot.version !== 1 || !snapshot.state || typeof snapshot.state !== 'object') {
        throw new Error('세이브 데이터의 형식이 올바르지 않습니다.');
      }
      return snapshot;
    } catch (error) {
      if (error && /세이브|암호화|형식|길이|비밀번호|브라우저/.test(String(error.message || error))) throw error;
      throw new Error('복호화에 실패했습니다. 암호화 비밀번호가 틀렸거나 파일이 손상되었을 수 있습니다.');
    }
  }

  // Stable cross-device key embedded in the addon. Obfuscation only; not secret against source inspection.
  const EMBEDDED_KEY_OBF = new Uint8Array([206,167,211,150,21,254,232,183,223,207,239,209,207,199,79,236,249,7,254,171,114,127,240,126,197,143,170,94,243,203,33,9]);
  const EMBEDDED_KEY_MASK = new Uint8Array([161,61,95,130,199,73,11,230,213,162,124,25,63,128,100,178,232,193,90,115,13,79,98,155,126,145,192,83,175,72,214,32]);
  function embeddedKeyBytes() { return EMBEDDED_KEY_OBF.map((value, index) => value ^ EMBEDDED_KEY_MASK[index]); }
  async function encryptSnapshotEmbedded(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') throw new Error('세이브 데이터가 없습니다.');
    if (!globalThis.crypto || !crypto.subtle) throw new Error('이 브라우저에서 안전한 암호화를 사용할 수 없습니다.');
    const key = await crypto.subtle.importKey('raw', embeddedKeyBytes(), { name: 'AES-GCM' }, false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = encoder.encode(JSON.stringify(snapshot));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD, tagLength: 128 }, key, plaintext);
    return { format: FORMAT, version: VERSION, keyMode: 'embedded-addon-v2', cipher: 'AES-256-GCM', iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(encrypted)), encryptedAt: Date.now() };
  }
  async function decryptSnapshotEmbedded(envelope) {
    if (!envelope || envelope.format !== FORMAT || envelope.version !== VERSION || envelope.keyMode !== 'embedded-addon-v2' || envelope.cipher !== 'AES-256-GCM') throw new Error('지원하지 않는 자동 암호화 세이브 형식입니다.');
    try {
      const iv = base64ToBytes(envelope.iv), ciphertext = base64ToBytes(envelope.ciphertext);
      if (iv.length !== 12 || ciphertext.length < 16) throw new Error('암호화 데이터의 길이가 올바르지 않습니다.');
      const key = await crypto.subtle.importKey('raw', embeddedKeyBytes(), { name: 'AES-GCM' }, false, ['decrypt']);
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: AAD, tagLength: 128 }, key, ciphertext);
      const snapshot = JSON.parse(decoder.decode(plaintext));
      if (!snapshot || snapshot.schema !== 'wayward-cloud-save' || snapshot.version !== 1 || !snapshot.state || typeof snapshot.state !== 'object') throw new Error('세이브 데이터의 형식이 올바르지 않습니다.');
      return snapshot;
    } catch (error) {
      if (error && /세이브|암호화|형식|길이/.test(String(error.message || error))) throw error;
      throw new Error('자동 복호화에 실패했습니다. 세이브 파일이 손상되었을 수 있습니다.');
    }
  }
  globalThis.WMLGoogleDriveCrypto = Object.freeze({ encryptSnapshot, decryptSnapshot, encryptSnapshotEmbedded, decryptSnapshotEmbedded });
})();


/* Backward-compatible OPAQUE-account encryption API used by the existing Worker integration. */
(function (root) {
  "use strict";
  const encoder = new TextEncoder();
  const KEY_SALT = encoder.encode("Wayward cloud save key v1");

  function encodeBase64Url(bytes) {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function decodeBase64Url(text) {
    if (typeof text !== "string" || !/^[A-Za-z0-9_-]+$/.test(text)) {
      throw new Error("암호화 데이터 형식이 올바르지 않습니다.");
    }
    const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    return Uint8Array.from(binary, ch => ch.charCodeAt(0));
  }

  async function deriveKey(exportKey, username) {
    if (typeof exportKey !== "string" || !exportKey) {
      throw new Error("세이브 암호화 키가 없습니다. 다시 로그인해 주세요.");
    }
    const material = await crypto.subtle.importKey(
      "raw", decodeBase64Url(exportKey), "HKDF", false, ["deriveKey"]
    );
    return crypto.subtle.deriveKey({
      name: "HKDF",
      hash: "SHA-256",
      salt: KEY_SALT,
      info: encoder.encode("account:" + String(username).toLowerCase()),
    }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }

  function additionalData(username) {
    return encoder.encode("wayward-cloud-save:v1:" + String(username).toLowerCase());
  }

  async function encryptSnapshot(snapshot, exportKey, username) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(exportKey, username);
    const plaintext = encoder.encode(JSON.stringify(snapshot));
    const ciphertext = await crypto.subtle.encrypt({
      name: "AES-GCM",
      iv,
      additionalData: additionalData(username),
      tagLength: 128,
    }, key, plaintext);

    return {
      schema: "wayward-cloud-save-encrypted",
      version: 1,
      algorithm: "AES-GCM-256",
      iv: encodeBase64Url(iv),
      ciphertext: encodeBase64Url(new Uint8Array(ciphertext)),
    };
  }

  async function decryptSnapshot(envelope, exportKey, username) {
    if (!envelope || envelope.schema !== "wayward-cloud-save-encrypted" ||
        envelope.version !== 1 || envelope.algorithm !== "AES-GCM-256") {
      throw new Error("지원하지 않는 암호화 세이브입니다.");
    }
    const iv = decodeBase64Url(envelope.iv);
    const ciphertext = decodeBase64Url(envelope.ciphertext);
    if (iv.length !== 12 || ciphertext.length < 16 || ciphertext.length > 20 * 1024 * 1024) {
      throw new Error("암호화 세이브 크기 또는 형식이 올바르지 않습니다.");
    }

    const key = await deriveKey(exportKey, username);
    let plaintext;
    try {
      plaintext = await crypto.subtle.decrypt({
        name: "AES-GCM",
        iv,
        additionalData: additionalData(username),
        tagLength: 128,
      }, key, ciphertext);
    } catch (_) {
      throw new Error("세이브 복호화에 실패했습니다. 비밀번호 또는 저장 데이터가 올바른지 확인해 주세요.");
    }
    let snapshot;
    try {
      snapshot = JSON.parse(new TextDecoder().decode(plaintext));
    } catch (_) {
      throw new Error("복호화한 세이브 데이터가 올바른 JSON이 아닙니다.");
    }
    if (!snapshot || snapshot.schema !== "wayward-cloud-save" ||
        snapshot.version !== 1 || !snapshot.state ||
        typeof snapshot.state !== "object" || Array.isArray(snapshot.state)) {
      throw new Error("복호화한 세이브 형식이 올바르지 않습니다.");
    }
    return snapshot;
  }

  root.WMLCloudSaveCrypto = Object.freeze({ encryptSnapshot, decryptSnapshot });
})(globalThis);
