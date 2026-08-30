import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * AI sağlayıcı API anahtarlarının veritabanında şifreli saklanması.
 * Algoritma: AES-256-GCM. Anahtar: MASTER_ENCRYPTION_KEY (32 bayt hex, .env).
 * Saklama biçimi: base64(iv) . base64(authTag) . base64(ciphertext)
 */

const ALGORITHM = "aes-256-gcm";

function getMasterKey(): Buffer {
  const hex = process.env.MASTER_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "MASTER_ENCRYPTION_KEY tanımlı değil veya 32 bayt hex değil. Üretmek için: openssl rand -hex 32"
    );
  }
  return Buffer.from(hex, "hex");
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getMasterKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(".");
}

export function decryptSecret(stored: string): string {
  const [ivB64, tagB64, dataB64] = stored.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Şifreli değer beklenen biçimde değil.");
  }
  const decipher = createDecipheriv(ALGORITHM, getMasterKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}
