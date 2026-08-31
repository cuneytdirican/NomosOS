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

/**
 * Bir değer bu modülün ürettiği şifreli biçimde mi?
 *
 * GEÇİŞ İÇİN GEREKLİ: `AiProviderConfig.headersJson` eskiden DÜZ METİN
 * saklanıyordu (denetim bulgusu K-08). Şifrelemeye geçildikten sonra veritabanında
 * her iki biçimden kayıt bulunabilir; okuyucu hangisiyle karşılaştığını
 * ayırt edebilmelidir. Biçim: base64(iv:12B).base64(tag:16B).base64(ct)
 * — düz metin bir JSON gövdesi ("{...}") bu desene UYMAZ.
 */
export function isEncryptedSecret(stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split(".");
  if (parts.length !== 3) return false;
  const b64 = /^[A-Za-z0-9+/]+={0,2}$/;
  if (!parts.every((p) => p.length > 0 && b64.test(p))) return false;
  // iv 12 bayt (base64 16 karakter), authTag 16 bayt (base64 24 karakter).
  return (
    Buffer.from(parts[0], "base64").length === 12 && Buffer.from(parts[1], "base64").length === 16
  );
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
