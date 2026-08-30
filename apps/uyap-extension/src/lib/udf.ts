/**
 * UYAP evrak indirme yardımcıları (yalnız CONTENT SCRIPT bağlamı).
 *
 * İKİ YÖNLÜ AKIŞ İLKESİ (docs/05 § 5):
 * NomosOS'ta üretilen dilekçe UDF olarak indirilir ve kullanıcı UYAP'ın evrak gönderme
 * ekranında dosyayı KENDİSİ seçer, KENDİ e-imzasını atar ve gönderimi KENDİSİ onaylar.
 * Bu eklenti hiçbir koşulda kullanıcı adına imzasız/onaysız gönderim YAPMAZ; UYAP'ta
 * form alanlarını yalnızca ön-doldurabilir.
 *
 * NOT (denetim bulguları: kod 7 / hukuki 20): "dilekçeyi diske indir" akışı (`chrome.downloads`)
 * bu dosyadan KALDIRILMIŞTIR. Eski `saveUdfToDisk` hiçbir yerden çağrılmıyordu ve `chrome.downloads`
 * content script bağlamında zaten tanımlı olmadığı için çağrılsa hata verirdi; buna rağmen
 * manifest'te `downloads` izni isteniyordu. En az yetki ilkesi gereği hem fonksiyon hem izin
 * kaldırıldı. Faz 2.5'te indirme akışı bağlanırken kod SERVICE WORKER'a yazılmalı, izin o zaman
 * (tercihen `optional_permissions` üzerinden, kullanıcı hareketiyle) istenmelidir.
 */

import { sha256Bytes } from "./hash";
import { guessMimeType, safeFileName } from "./text";

export interface DownloadedFile {
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly bytes: Uint8Array;
  readonly contentHash: string;
}

/** Çerezli indirmeye izin verilen alan adı. */
export const UYAP_DOMAIN_SUFFIX = ".uyap.gov.tr";

/**
 * İndirme adresi UYAP'a mı ait?
 *
 * DÜZELTİLDİ (hukuki/KVKK denetimi, bulgu 9): `indirmeUrl`, sayfadaki herhangi bir
 * `a[href]`'ten üretilebiliyordu (`a[href*="indir"]` gibi geniş seçiciler). Sayfada
 * üçüncü taraf bir bağlantı bulunursa `credentials: "include"` ile ÇEREZLİ istek dışarı
 * gider ve dönen içerik NomosOS'a yüklenirdi. Artık host beyaz listesi zorunludur:
 * yalnız https + `*.uyap.gov.tr` (ya da sayfanın kendi kaynağı) indirilir.
 */
export function isAllowedUyapDownloadUrl(url: string, pageOrigin?: string): boolean {
  try {
    const target = new URL(url);
    if (target.protocol !== "https:") return false;
    const host = target.hostname.toLowerCase();
    if (host === "uyap.gov.tr" || host.endsWith(UYAP_DOMAIN_SUFFIX)) return true;
    if (pageOrigin) {
      const page = new URL(pageOrigin);
      return page.protocol === "https:" && page.hostname.toLowerCase() === host;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Evrakı UYAP'tan indirir.
 *
 * ÖNEMLİ: Bu fonksiyon CONTENT SCRIPT içinde, yani UYAP sayfasının kendi kaynağında
 * çalıştırılır. `credentials: "include"` kullanıcının HÂLİHAZIRDA açık olan UYAP
 * oturumunu kullanır; çerezler okunmaz, kopyalanmaz, hiçbir yere gönderilmez.
 * Çerezli istek yalnızca UYAP alan adına atılır (bkz. `isAllowedUyapDownloadUrl`).
 */
export async function downloadUyapDocument(
  url: string,
  suggestedName: string,
  maxBytes: number,
  pageOrigin?: string,
): Promise<DownloadedFile> {
  if (!isAllowedUyapDownloadUrl(url, pageOrigin)) {
    throw new Error(
      "Evrak bağlantısı UYAP alan adına ait değil; oturum çerezinizle üçüncü tarafa istek göndermemek için indirme yapılmadı.",
    );
  }
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`UYAP evrakı indirilemedi (HTTP ${response.status}).`);
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0) {
    throw new Error("UYAP boş evrak döndürdü; aktarım yapılmadı.");
  }
  if (buffer.byteLength > maxBytes) {
    throw new Error(
      `Evrak boyutu sınırı aşıyor (${Math.round(buffer.byteLength / 1024 / 1024)} MB). Ayarlardan sınırı artırabilirsiniz.`,
    );
  }

  const bytes = new Uint8Array(buffer);
  const headerName = fileNameFromDisposition(response.headers.get("content-disposition"));
  const fileName = safeFileName(headerName ?? suggestedName, "uyap-evrak");
  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || guessMimeType(fileName);

  return {
    fileName,
    mimeType: mimeType === "application/octet-stream" ? guessMimeType(fileName) : mimeType,
    sizeBytes: bytes.byteLength,
    bytes,
    contentHash: await sha256Bytes(bytes),
  };
}

/** Content-Disposition başlığından dosya adını okur. */
export function fileNameFromDisposition(value: string | null): string | null {
  if (!value) return null;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(value);
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1].trim().replace(/^"|"$/g, ""));
    } catch {
      return null;
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(value);
  return plain ? plain[1].trim() : null;
}
