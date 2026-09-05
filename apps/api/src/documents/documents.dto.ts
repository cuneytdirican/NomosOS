import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
import { DOCUMENT_CLASSES } from "@nomosos/shared";
import { nullableUuid } from "../common/zod";

/**
 * POST /documents — multipart gövdesi.
 *
 * Multipart alanları DAİMA string gelir; boş string "gönderilmedi" sayılır.
 */
const optionalText = (max: number, label: string) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().max(max, `${label} en fazla ${max} karakter olabilir.`).optional()
  );

export const uploadDocumentSchema = z.object({
  /** Belgenin bağlanacağı dosya. Boş bırakılırsa hat kendisi eşlemeye çalışır. */
  caseId: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().uuid("Dosya geçerli bir kayıt kimliği olmalıdır.").optional()
  ),
  /** Görünen ad; verilmezse yüklenen dosyanın adı kullanılır. */
  name: optionalText(300, "Belge adı"),
  /** Yükleyen sınıfı biliyorsa (AI sınıflandırmasını EZMEZ, başlangıç değeridir). */
  class: z
    .enum(DOCUMENT_CLASSES, { errorMap: () => ({ message: "Geçersiz belge sınıfı." }) })
    .optional(),
  /** MANUEL | UYAP | SISTEM | EPOSTA — verilmezse MANUEL. */
  source: z.enum(["MANUEL", "UYAP", "SISTEM", "EPOSTA", "PORTAL"]).optional(),
  /** Yinelenen yükleme uyarısını bilerek geçmek için. */
  allowDuplicate: z.preprocess((v) => v === "true" || v === true, z.boolean()).optional(),
  /** Faz 7: sanal klasör yolu ("/Dilekçeler/2026"); verilmezse "/". */
  folderPath: optionalText(200, "Klasör yolu"),
});
export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;

/** PATCH /documents/:id — sınıf / dosya bağı / ad düzeltme. */
export const updateDocumentSchema = z
  .object({
    name: z
      .string()
      .min(1, "Belge adı boş olamaz.")
      .max(300, "Belge adı en fazla 300 karakter olabilir.")
      .optional(),
    class: z
      .enum(DOCUMENT_CLASSES, { errorMap: () => ({ message: "Geçersiz belge sınıfı." }) })
      .optional(),
    /** null gönderilirse belgenin dosya bağı kaldırılır (triyaja geri döner). */
    caseId: nullableUuid("Dosya"),
    /** Faz 7: klasör yolu. */
    folderPath: optionalText(200, "Klasör yolu"),
  })
  .refine((data) => Object.keys(data).length > 0, "Güncellenecek en az bir alan gönderilmelidir.");
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;

/**
 * POST /proposals/:id/approve — onay + isteğe bağlı düzeltmeler.
 *
 * Avukat öneriyi olduğu gibi değil, DÜZELTEREK de onaylayabilir; bu alanlar
 * öneri gövdesindeki değerleri ezer.
 */
export const approveProposalSchema = z.object({
  /** GOREV: sorumlu; verilmezse dosyanın sorumlu avukatı. */
  assigneeId: z.string().uuid("Sorumlu geçerli bir kullanıcı olmalıdır.").optional(),
  /** GOREV/SAFAHAT: başlık düzeltmesi. */
  title: z.string().min(3).max(300).optional(),
  /** GOREV: son tarih. */
  dueDate: z.coerce.date({ invalid_type_error: "Son tarih geçerli bir tarih olmalıdır." }).optional(),
  /** SURE: motorda kullanılacak kural anahtarı (tespit BELİRSİZ ise ZORUNLU). */
  ruleKey: z.string().min(1).max(100).optional(),
  /** SURE: süreyi başlatan olay tarihi düzeltmesi. */
  triggerDate: z.coerce.date({ invalid_type_error: "Tetikleyici tarih geçerli olmalıdır." }).optional(),
  /** SURE: tebligat yöntemi. */
  serviceMethod: z.enum(["ELDEN", "POSTA", "ETEBLIGAT", "DURUSMADA", "DIGER"]).optional(),
  /** DOSYA_ESLESTIRME: seçilen dosya. */
  caseId: z.string().uuid("Dosya geçerli bir kayıt kimliği olmalıdır.").optional(),
  /** DURUSMA_GUNCELLEME: güncellenecek duruşma. */
  hearingId: z.string().uuid("Duruşma geçerli bir kayıt kimliği olmalıdır.").optional(),
  /** Onay notu — denetim kaydına yazılır. */
  note: z.string().max(1000, "Not en fazla 1000 karakter olabilir.").optional(),
});
export type ApproveProposalInput = z.infer<typeof approveProposalSchema>;

/** POST /proposals/:id/reject — gerekçe ZORUNLUDUR (denetim izi). */
export const rejectProposalSchema = z.object({
  reason: z
    .string()
    .min(3, "Ret gerekçesi en az 3 karakter olmalıdır.")
    .max(1000, "Ret gerekçesi en fazla 1000 karakter olabilir."),
});
export type RejectProposalInput = z.infer<typeof rejectProposalSchema>;

/* ------------------------------------------------------------------ *
 * Yükleme kısıtları
 * ------------------------------------------------------------------ */

/** Tek belge üst sınırı: 50 MB. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** İzinli uzantı → beklenen MIME tipleri. */
export const ALLOWED_UPLOADS: Record<string, string[]> = {
  pdf: ["application/pdf"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  png: ["image/png"],
  txt: ["text/plain"],
  // UDF bir zip kabıdır; tarayıcılar çoğunlukla octet-stream/zip gönderir.
  udf: ["application/zip", "application/octet-stream", "application/x-udf"],
};

/** MIME'ı belirsiz gönderen istemcilerde uzantıya güvenilir. */
const GENERIC_MIMES = new Set(["", "application/octet-stream", "binary/octet-stream"]);

export interface UploadValidationError {
  message: string;
}

/**
 * Uzantı + MIME doğrulaması.
 *
 * Uzantı listede değilse REDDEDİLİR. MIME jenerikse uzantıya güvenilir; MIME
 * belirgin ama uzantıyla çelişiyorsa reddedilir (uzantısı .pdf olan bir exe
 * yükleme denemesi burada durur).
 */
export function validateUpload(fileName: string, mimeType: string | undefined): UploadValidationError | null {
  const ext = (fileName.split(".").pop() ?? "").toLowerCase();
  const allowedMimes = ALLOWED_UPLOADS[ext];
  if (!allowedMimes) {
    return {
      message:
        `«${fileName}» yüklenemedi: desteklenmeyen dosya türü. ` +
        `İzin verilen türler: ${Object.keys(ALLOWED_UPLOADS).join(", ")}.`,
    };
  }
  const mime = (mimeType ?? "").toLowerCase();
  if (GENERIC_MIMES.has(mime)) return null;
  if (allowedMimes.includes(mime)) return null;
  return {
    message:
      `«${fileName}» yüklenemedi: dosya uzantısı (.${ext}) ile içerik türü (${mime}) uyuşmuyor.`,
  };
}

/** Faz 7: "/Dilekçeler/2026" biçimi — baştan "/", boş/çift bölü yok, ".." yok, ≤ 200 karakter. */
export function normalizeFolderPath(input: string | null | undefined): string {
  const raw = (input ?? "/").trim().replace(/\\/g, "/");
  const parts = raw.split("/").map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.some((p) => p === "." || p === "..")) throw new BadRequestException("Klasör yolu '.' veya '..' içeremez.");
  const path = "/" + parts.join("/");
  if (path.length > 200) throw new BadRequestException("Klasör yolu en fazla 200 karakter olabilir.");
  return path;
}
