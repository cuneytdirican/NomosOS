import { z } from "zod";

/**
 * İÇTİHAT HAVUZ TOPLU İÇE AKTARIM ŞEMALARI (ai-egitim-stratejisi.md D1).
 *
 * Halüsinasyon zinciri havuz GİRİŞİNDE başlar: biçimsiz künye burada reddedilir,
 * CITATION_VERIFY'ın doğrulayacağı biçimde olmayan kayıt havuza hiç girmez.
 * Esas/karar no Türk künye biçimine göre denetlenir (rakam + / . - ayraçları).
 */

/** Türk künye numarası: "2016/1234", "2016/1234 E." biçimindeki sayısal gövde. */
const DOCKET_NO_REGEX = /^[0-9][0-9/\-.]{1,28}$/;

const docketNo = (label: string) =>
  z
    .string()
    .trim()
    .regex(DOCKET_NO_REGEX, `${label} künye biçimine uymuyor (örn. "2016/1234"; yalnız rakam, "/", ".", "-").`)
    .max(30, `${label} en fazla 30 karakter olabilir.`);

export const poolRecordSchema = z.object({
  court: z
    .string()
    .trim()
    .min(3, "Mahkeme/daire adı en az 3 karakter olmalıdır (örn. Yargıtay 9. Hukuk Dairesi).")
    .max(200, "Mahkeme/daire adı en fazla 200 karakter olabilir."),
  chamber: z.string().trim().max(200).optional(),
  caseNumber: docketNo("Esas no"),
  decisionNumber: docketNo("Karar no"),
  /** ISO tarih (YYYY-MM-DD). Yıl aralığı service katmanında denetlenir. */
  decisionDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Karar tarihi YYYY-MM-DD biçiminde olmalıdır.")
    .optional(),
  summary: z.string().trim().max(4000, "Özet en fazla 4000 karakter olabilir.").optional(),
  fullText: z.string().max(200_000, "Karar metni en fazla 200.000 karakter olabilir.").optional(),
  sourceUrl: z.string().trim().url("Kaynak adres geçerli bir URL olmalıdır.").max(500).optional(),
});
export type PoolRecord = z.infer<typeof poolRecordSchema>;

export const poolImportSchema = z.object({
  /** Kaydı havuza sokan kaynak etiketi — CaseLawDocument.sourceAdapter'a yazılır. */
  sourceAdapter: z
    .string()
    .trim()
    .min(2, "Kaynak etiketi en az 2 karakter olmalıdır (örn. PLATFORM_ICAKTARIM, LEXPERA_DOSYA).")
    .max(50)
    .regex(/^[A-Z0-9_]+$/, "Kaynak etiketi yalnız BÜYÜK harf, rakam ve alt çizgi olabilir."),
  sourceNote: z.string().trim().max(300, "Kaynak notu en fazla 300 karakter olabilir.").optional(),
  records: z
    .array(poolRecordSchema)
    .min(1, "İçe aktarılacak en az bir kayıt gerekir.")
    .max(500, "Tek partide en fazla 500 kayıt (daha fazlaysa partilere bölün)."),
});
export type PoolImportInput = z.infer<typeof poolImportSchema>;

export const poolRecordsQuerySchema = z.object({
  sourceAdapter: z.string().trim().max(50).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type PoolRecordsQuery = z.infer<typeof poolRecordsQuerySchema>;

/** Kabul edilebilir karar yılı aralığı — dışında kalan tarih kesinlikle reddedilir. */
export const MIN_DECISION_YEAR = 1900;

/** Geleceğe ait karar tarihi hatalıdır; yıl için üst sınır. */
export function maxDecisionYear(now = new Date()): number {
  return now.getFullYear() + 1;
}

/**
 * Tarih aralık denetimi (zod şemada değil burada: hata mesajı yılbaşıyla
 * değiştiği için sabit mesaj yazmak yanlış olurdu).
 */
export function isPlausibleDecisionDate(iso: string, now = new Date()): boolean {
  const year = parseInt(iso.slice(0, 4), 10);
  if (!Number.isFinite(year)) return false;
  return year >= MIN_DECISION_YEAR && year <= maxDecisionYear(now);
}
