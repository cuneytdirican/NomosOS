import { z } from "zod";

/**
 * AI Dosya Asistanı giriş şemaları.
 *
 * NOT: `packages/shared`'e yazma yetkimiz yok (faz dosya sahipliği); bu modülün
 * kendi giriş sözleşmeleri burada, modül klasöründe tanımlanır.
 */

/** Prisma NoteKind ile birebir. */
export const NOTE_KINDS = ["GENEL", "DURUSMA_HAZIRLIK", "STRATEJI", "HATIRLATMA"] as const;
export type NoteKindValue = (typeof NOTE_KINDS)[number];

/* ------------------------------------------------------------------ *
 * Sohbet
 * ------------------------------------------------------------------ */

export const assistantChatSchema = z.object({
  caseId: z.string().uuid("Dosya kimliği geçerli olmalıdır.").optional(),
  sessionId: z.string().uuid("Oturum kimliği geçerli olmalıdır.").optional(),
  message: z
    .string()
    .trim()
    .min(2, "Soru en az 2 karakter olmalıdır.")
    .max(4000, "Soru en fazla 4000 karakter olabilir."),
  /**
   * KVKK: dış sağlayıcıya gidecek metinde kişisel veri bulunduğunda uç 409 döner.
   * Kullanıcı maskeli metni onayladığında bu bayrakla yeniden gönderilir.
   */
  piiApproved: z.boolean().optional().default(false),
  /** Bağlam parçası üst sınırı (retrieval top-K). */
  topK: z.coerce.number().int().min(1).max(24).optional(),
});
export type AssistantChatInput = z.infer<typeof assistantChatSchema>;

/* ------------------------------------------------------------------ *
 * İndeksleme
 * ------------------------------------------------------------------ */

export const indexCaseSchema = z
  .object({
    /** true ise indeksi olan belgeler de yeniden parçalanır (model değişimi sonrası). */
    force: z.boolean().optional().default(false),
    documentIds: z.array(z.string().uuid()).max(200).optional(),
  })
  .optional()
  .default({ force: false });
export type IndexCaseInput = z.infer<typeof indexCaseSchema>;

/* ------------------------------------------------------------------ *
 * Tam dosya analizi
 * ------------------------------------------------------------------ */

export const analyzeCaseSchema = z
  .object({
    piiApproved: z.boolean().optional().default(false),
    /** Analize dahil edilecek en fazla belge parçası. */
    topK: z.coerce.number().int().min(4).max(40).optional(),
  })
  .optional()
  .default({ piiApproved: false });
export type AnalyzeCaseInput = z.infer<typeof analyzeCaseSchema>;

/* ------------------------------------------------------------------ *
 * Akıllı notlar
 * ------------------------------------------------------------------ */

/**
 * POST /assistant/notes — iki mod:
 *  - `content` verilirse MANUEL not (source=MANUEL, isApproved=true) açılır; AI çalışmaz.
 *  - `content` verilmezse SMART_NOTE ajanı bir not ÖNERİSİ üretir (source=AI, isApproved=false).
 */
export const createNoteSchema = z
  .object({
    caseId: z.string().uuid("Dosya seçilmelidir."),
    kind: z.enum(NOTE_KINDS, { errorMap: () => ({ message: "Geçersiz not türü." }) }).default("GENEL"),
    content: z.string().trim().min(2).max(8000).optional(),
    /** AI moduna verilecek serbest yönerge ("yarınki duruşmaya odaklan"). */
    instruction: z.string().trim().max(1000).optional(),
    piiApproved: z.boolean().optional().default(false),
  })
  .refine((v) => v.content === undefined || v.instruction === undefined, {
    message: "Manuel not (content) ile AI yönergesi (instruction) aynı istekte gönderilemez.",
    path: ["instruction"],
  });
export type CreateNoteInput = z.infer<typeof createNoteSchema>;

/* ------------------------------------------------------------------ *
 * Büro geneli sorgu
 * ------------------------------------------------------------------ */

export const officeQuerySchema = z.object({
  question: z
    .string()
    .trim()
    .min(3, "Soru en az 3 karakter olmalıdır.")
    .max(1000, "Soru en fazla 1000 karakter olabilir."),
  /**
   * KVKK ONAYI (denetim bulgusu İ-18).
   *
   * Bu alan YOKTU ve servis `piiApproved: false` SABİTİNİ geçiyordu. Sorusunda
   * geçerli bir TCKN geçen kullanıcı 409 alıyor, 409 gövdesi "piiApproved: true
   * gönderin" diyordu — ama DTO böyle bir alanı reddediyordu. Uç kalıcı olarak
   * KIRILIYORDU. Fail-closed olması doğrudur; ÇIKMAZ olması değil.
   */
  piiApproved: z.boolean().optional().default(false),
});
export type OfficeQueryInput = z.infer<typeof officeQuerySchema>;
