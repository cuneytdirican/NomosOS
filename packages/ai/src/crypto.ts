import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * AI sağlayıcı API anahtarlarının veritabanında şifreli saklanması.
 * Algoritma: AES-256-GCM. Anahtar: MASTER_ENCRYPTION_KEY (32 bayt hex, .env).
 * Saklama biçimi: base64(iv) . base64(authTag) . base64(ciphertext)
 *
 * ANAHTAR AYRIMI: her iki fonksiyon da isteğe bağlı bir `keyHex` alır. Master
 * anahtarla ŞİFRELENMEMESİ gereken sırlar (ör. platform panelinin TOTP gizli
 * anahtarı — spec §Güvenlik 7) kendi anahtarlarını geçirir. Anahtar verilmezse
 * davranış eskisiyle birebir aynıdır.
 */

const ALGORITHM = "aes-256-gcm";

function toKey(hex: string | undefined, name: string): Buffer {
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      `${name} tanımlı değil veya 32 bayt hex değil. Üretmek için: openssl rand -hex 32`
    );
  }
  return Buffer.from(hex, "hex");
}

function resolveKey(keyHex?: string): Buffer {
  if (keyHex) return toKey(keyHex, "Şifreleme anahtarı");
  return toKey(process.env.MASTER_ENCRYPTION_KEY, "MASTER_ENCRYPTION_KEY");
}

export function encryptSecret(plaintext: string, keyHex?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, resolveKey(keyHex), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(".");
}

export function decryptSecret(stored: string, keyHex?: string): string {
  const [ivB64, tagB64, dataB64] = stored.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Şifreli değer beklenen biçimde değil.");
  }
  const decipher = createDecipheriv(ALGORITHM, resolveKey(keyHex), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}
