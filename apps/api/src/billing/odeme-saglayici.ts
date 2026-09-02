/**
 * ÖDEME SAĞLAYICI SOYUTLAMASI (rakip analizi — E8).
 *
 * MEVCUT DURUM DÜRÜSTTÜR: NomosOS KENDİ sanal POS'u İŞLETMEZ. Portal ödeme
 * bağlantısı, büronun kendi sanal POS / ödeme kuruluşu (İyzico, PayTR, banka
 * sanal POS'u…) sözleşmesi üzerinden çalışır.
 *
 * Yapılandırma: `ODEME_SAGLAYICI`
 *   - `SIMULASYON` → test/demo modu: hiçbir gerçek para hareketi olmaz, ödeme
 *     simüle edilir ve kayıt düşer (test yığını bu modda koşar).
 *   - tanımsız (varsayılan) → ödeme denemesi 503 döner: "yapılandırılmadı".
 *   - Gerçek sağlayıcı anahtarları (`ODEME_SAGLAYICI_API_KEY` + sağlayıcıya
 *     göre ek alanlar) üretimde kurulur; kod tarafında her sağlayıcı AYRI
 *     adapter olarak eklenir (e-imza/e-Fatura Noop deseni).
 *
 * PARA DİSİPLİNİ: sağlayıcıdan dönen referans kayda yazılır; tutar/para birimi
 * bağlantının tutarıyla birebir eşleşmek zorundadır — sağlayıcı yanıtı tutar
 * söylüyorsa çelişkide ödeme REDDEDİLİR (para kaynağı tek doğrudur: OdemeLinki).
 */

import { HttpException, HttpStatus, Injectable } from "@nestjs/common";

export interface OdemeSonucu {
  ok: true;
  /** Sağlayıcı referansı — Payment.reference alanına yazılır. */
  ref: string;
}

export type OdemeSaglayiciTuru = "SIMULASYON" | "YOK";

export function odemeSaglayiciTuru(): OdemeSaglayiciTuru {
  const v = process.env.ODEME_SAGLAYICI?.trim().toUpperCase();
  return v === "SIMULASYON" ? "SIMULASYON" : "YOK";
}

@Injectable()
export class OdemeSaglayici {
  /**
   * Bağlantı tutarını sağlayıcıdan tahsil et. Yalnızca SIMULASYON modu
   * başarılı döner; aksi hâlde 503 — kullanıcıya asla sahte "ödendi" verilmez.
   */
  async charge(_input: { amount: string; currency: string }): Promise<OdemeSonucu> {
    const tur = odemeSaglayiciTuru();
    if (tur === "SIMULASYON") {
      // Simülasyon referansı: gerçek sağlayıcı yanıtı gibi benzersizdir.
      const ref = `SIM-${Date.now().toString(36).toUpperCase()}-${Math.random()
        .toString(36)
        .slice(2, 8)
        .toUpperCase()}`;
      return { ok: true, ref };
    }
    throw new HttpException(
      `Ödeme sağlayıcısı yapılandırılmadı (ODEME_SAGLAYICI tanımsız). Bu ödeme bağlantısı ` +
        "şu an ödeme alamaz; büronun sanal POS/ödeme kuruluşu sözleşmesi bağlandıktan sonra " +
        "aktif olur. Tutara ilişkin bir tahsilat yapılmadı.",
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
