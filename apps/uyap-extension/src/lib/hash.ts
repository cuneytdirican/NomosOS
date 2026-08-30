/**
 * İçerik hash'i — idempotent aktarımın temeli.
 *
 * Aynı evrak/safahat kaydı ikinci kez yakalandığında kuyruğa GİRMEZ; sunucu tarafında da
 * aynı hash ikinci kez commit edilmez (docs/05 § 2.4, Modül 06 iş kuralı 6).
 * SHA-256 hesabı Web Crypto (crypto.subtle) ile yapılır; service worker ve content script
 * güvenli bağlamda çalıştığı için her ikisinde de kullanılabilir.
 */

/** Ham baytların SHA-256 özeti (hex). */
export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  // Görünümün (subarray) kendi tamponunu değil yalnız kendi baytlarını hash'lemek için
  // taze bir kopya alınır; ayrıca SharedArrayBuffer tipi belirsizliği de böylece kalkar.
  const copy = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer as ArrayBuffer);
  return toHex(digest);
}

/** UTF-8 metnin SHA-256 özeti (hex). */
export async function sha256Text(text: string): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(text));
}

function toHex(buffer: ArrayBuffer): string {
  const view = new Uint8Array(buffer);
  let hex = "";
  for (let i = 0; i < view.length; i += 1) {
    hex += view[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Deterministik JSON: anahtarlar sıralanır, `undefined` alanlar atılır.
 * Aynı mantıksal içerik → her zaman aynı metin → her zaman aynı hash.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map((item) => normalize(item));
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) continue;
      sorted[key] = normalize(source[key]);
    }
    return sorted;
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

/** Herhangi bir yapının içerik hash'i (kuyruk idempotens anahtarı). */
export async function contentHash(value: unknown): Promise<string> {
  return sha256Text(canonicalJson(value));
}

/**
 * Safahat kaydı gibi "aynı olay" tespitinde kullanılan hash.
 * Dosya no + tarih + işlem + açıklama üzerinden hesaplanır; UYAP sıra numarası
 * sayfalama ile değişebildiği için hash'e DAHİL EDİLMEZ.
 */
export async function eventHash(input: {
  readonly uyapDosyaNo: string;
  readonly tarih: string;
  readonly islem: string;
  readonly aciklama: string | null;
}): Promise<string> {
  return contentHash({
    kind: "SAFAHAT",
    uyapDosyaNo: input.uyapDosyaNo,
    tarih: input.tarih,
    islem: input.islem,
    aciklama: input.aciklama ?? null,
  });
}

/** Duruşma kaydı için içerik hash'i. */
export async function hearingHash(input: {
  readonly uyapDosyaNo: string;
  readonly tarih: string;
  readonly salon: string | null;
  readonly tur: string | null;
}): Promise<string> {
  return contentHash({
    kind: "DURUSMA",
    uyapDosyaNo: input.uyapDosyaNo,
    tarih: input.tarih,
    salon: input.salon ?? null,
    tur: input.tur ?? null,
  });
}

/** base64 metni bayt dizisine çevirir (content script → service worker aktarımı). */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Bayt dizisini base64'e çevirir (büyük dosyalarda yığın taşmasını önlemek için parçalı). */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}
