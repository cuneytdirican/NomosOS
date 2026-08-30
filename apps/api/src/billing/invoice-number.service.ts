import { Injectable, InternalServerErrorException } from "@nestjs/common";
import type { Prisma } from "@nomosos/db";

/**
 * FATURA NUMARASI ÜRETİMİ — YARIŞ KOŞULU KORUMALI.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ Fatura numarası VUK gereği ARDIŞIK ve BOŞLUKSUZ olmalıdır. Taslaklar     ║
 * ║ numara TÜKETMEZ; numara yalnızca kesinleştirme (finalize) anında atanır. ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * BİÇİM: `SSSYYYYNNNNNNNNN` (UBL-TR `cbc:ID` 16 hane kuralı)
 *   SSS       → 3 harfli seri (varsayılan `INVOICE_NUMBER_PREFIX` ya da "NOM")
 *   YYYY      → düzenleme yılı
 *   NNNNNNNNN → tenant + seri + yıl içinde 9 haneli ardışık sıra
 * Örnek: `NOM2026000000001`
 *
 * ─────────────────────── EŞZAMANLILIK KORUMASI (3 katman) ───────────────────
 *
 * 1. POSTGRES ADVISORY LOCK — `pg_advisory_xact_lock(hashtext(a), hashtext(b))`.
 *    Aynı (tenant, seri, yıl) için numara üreten iki işlem SIRAYA GİRER; kilit
 *    işlem (transaction) bitince otomatik bırakılır. Böylece "son numarayı oku →
 *    bir artır" penceresinde ikinci istek okuyamaz.
 * 2. VERİTABANI KISITI — `@@unique([tenantId, invoiceNo])`. Kilit bir şekilde
 *    atlansa bile (farklı sürüm, replika) çakışma P2002 ile REDDEDİLİR; sessiz
 *    çift numara oluşamaz.
 * 3. YENİDEN DENEME — P2002 yakalanırsa numara yeniden hesaplanıp işlem tekrar
 *    denenir (çağıran taraf, `withInvoiceNumberRetry`).
 *
 * NOT: `invoiceNo` NULL olan taslaklar unique kısıtını ihlal etmez (Postgres'te
 * NULL'lar birbirinden farklı sayılır) — bu yüzden birden çok numarasız taslak
 * bir arada durabilir.
 */

const SEQUENCE_WIDTH = 9;
const DEFAULT_PREFIX = "NOM";

export function resolveSeriesPrefix(explicit?: string): string {
  const candidate = (explicit ?? process.env.INVOICE_NUMBER_PREFIX ?? DEFAULT_PREFIX)
    .trim()
    .toUpperCase();
  return /^[A-Z]{2,4}$/.test(candidate) ? candidate : DEFAULT_PREFIX;
}

/** Prisma P2002 (unique ihlali) mi? */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "P2002"
  );
}

@Injectable()
export class InvoiceNumberService {
  /**
   * Bir sonraki fatura numarasını üretir. **İşlem (transaction) İÇİNDE
   * çağrılmalıdır** — advisory kilit işlem ömrüne bağlıdır.
   */
  async next(
    tx: Prisma.TransactionClient,
    tenantId: string,
    year: number,
    seriesPrefix: string,
  ): Promise<string> {
    const prefix = `${seriesPrefix}${year}`;

    // (1) Aynı seri için numara üretenleri sıraya sok. Kilit, işlem bitince düşer.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"nomosos:invoice-no"}), hashtext(${`${tenantId}:${prefix}`}))`;

    /**
     * (2) SERİDEKİ EN BÜYÜK SIRA — SAYISAL, TEK SORGUDA, PENCERESİZ.
     *
     * ÖNCEKİ SÜRÜM: `orderBy invoiceNo desc` + `take: 25` ile ilk 25 satır
     * taranıyor, 9 haneli olmayan eski biçimler (ör. tohum verisindeki
     * "NOM2026-000001") atlanıyordu. İki varsayıma dayanıyordu ve ikisi de
     * kırılgandı (denetim bulgusu 5):
     *
     *   (a) SIRALAMANIN BYTE SIRASI OLDUĞU. Postgres'in yaygın `en_US.UTF-8` /
     *       ICU collation'larında birinci geçişte NOKTALAMA YOK SAYILIR:
     *       "NOM2026-000001" fiilen "NOM2026000001" gibi sıralanır ve
     *       "NOM2026000000005" gibi GEÇERLİ numaraların ÜSTÜNE çıkar.
     *   (b) ESKİ BİÇİMLİ KAYIT SAYISININ 25'İ AŞMAYACAĞI. Aşarsa pencerenin
     *       tamamı atlanan satırlarla dolar, `lastSequence` 0 kalır, servis
     *       zaten var olan …000000001'i döndürür → P2002 → `withInvoiceNumberRetry`
     *       aynı sonucu üç kez üretir → kesinleştirme KALICI OLARAK 500'e düşer.
     *       Daha sinsi hâli: pencere kısmen dolduğunda gerçek en büyük numara
     *       hiç görülmez ve VUK'un aradığı ardışıklık sessizce bozulur.
     *
     * ŞİMDİ: biçim SQL'de süzülür (`~` regex), sıra SAYIYA çevrilip `MAX`
     * alınır. Sonuç collation'dan bağımsızdır ve pencere yoktur. Advisory kilit
     * ve unique kısıt olduğu gibi kalır.
     */
    // `prefix` = 2-4 BÜYÜK HARF + 4 haneli yıl (resolveSeriesPrefix zorlar);
    // regex metakarakteri içeremez, bu yüzden desene doğrudan gömülebilir.
    // `::int` CASTİ ZORUNLUDUR: Prisma sayısal bağlamayı `bigint` olarak
    // gönderir ve Postgres'te `substring(text, bigint)` aşırı yüklemesi YOKTUR
    // (42883). Cast olmadan kesinleştirme çalışma zamanında 500'e düşer.
    const rows = await tx.$queryRaw<{ max: number | null }[]>`
      SELECT COALESCE(MAX(SUBSTRING("invoiceNo" FROM ${prefix.length + 1}::int)::bigint), 0)::int AS max
      FROM "Invoice"
      WHERE "tenantId" = ${tenantId}
        AND "invoiceNo" ~ ${`^${prefix}\\d{${SEQUENCE_WIDTH}}$`}
    `;
    const lastSequence = rows[0]?.max ?? 0;

    const nextSequence = lastSequence + 1;
    if (nextSequence >= 10 ** SEQUENCE_WIDTH) {
      throw new InternalServerErrorException(
        `${prefix} serisinde fatura numarası kapasitesi doldu. Yeni bir seri ön eki tanımlayın.`,
      );
    }

    return `${prefix}${String(nextSequence).padStart(SEQUENCE_WIDTH, "0")}`;
  }
}

/**
 * Numara çakışmasında (P2002) işlemi yeniden dener.
 *
 * Advisory kilit normalde çakışmayı önler; bu sarmalayıcı, kilidin devrede
 * olmadığı kurulumlara (örn. farklı bir veritabanı motoru) karşı SON GÜVENLİK
 * AĞIDIR. Başka bir hata türü aynen yukarı fırlatılır.
 */
export async function withInvoiceNumberRetry<T>(
  operation: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      lastError = err;
    }
  }
  throw lastError;
}
