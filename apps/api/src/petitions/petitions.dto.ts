/**
 * Dilekçe Stüdyosu giriş şemaları (modüle özgü, yerel).
 */

import { z } from "zod";

export const PETITION_TYPES = [
  "DAVA_DILEKCESI",
  "CEVAP",
  "CEVABA_CEVAP",
  "IKINCI_CEVAP",
  "ISTINAF",
  "TEMYIZ",
  "ITIRAZ",
  "DELIL_LISTESI",
  "ISLAH",
  "BILIRKISI_ITIRAZ",
  "ICRA_TAKIP_TALEBI",
  "SIKAYET",
  "BEYAN",
  "DIGER",
] as const;

export const PETITION_STATUSES = [
  "TASLAK",
  "TEYIT_EDILIYOR",
  "TEYIT_EDILDI",
  "INCELEMEDE",
  "HAZIR",
  "DISA_AKTARILDI",
  "GONDERILDI",
] as const;

/** POST /petitions — şablondan boş taslak açar. */
export const createPetitionSchema = z.object({
  caseId: z.string().uuid("Geçerli bir dosya kimliği gönderin."),
  type: z.enum(PETITION_TYPES),
  templateId: z.string().uuid().optional(),
  title: z.string().trim().min(3).max(200).optional(),
});
export type CreatePetitionInput = z.infer<typeof createPetitionSchema>;

const sectionBodySchema = z.object({
  key: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1),
  body: z.string().default(""),
  origin: z.enum(["TEMPLATE", "AI", "MANUAL"]).optional(),
  hint: z.string().optional(),
  required: z.boolean().optional(),
});

/** POST /petitions/:id/versions — yeni (DEĞİŞTİRİLEMEZ) sürüm. */
export const createPetitionVersionSchema = z.object({
  sections: z.array(sectionBodySchema).min(1, "En az bir bölüm gönderin."),
  note: z.string().trim().max(500).optional(),
});
export type CreatePetitionVersionInput = z.infer<typeof createPetitionVersionSchema>;

/**
 * PATCH /petitions/:id/status
 *
 * `confirmedStatuteCitations`: HAZIR geçişinde avukatın "bu mevzuat atıflarını
 * yürürlükteki metinden teyit ettim" beyanı. İçtihat atıfları için BÖYLE BİR
 * BEYAN YOLU YOKTUR — onlar deterministik olarak doğrulanmak zorundadır.
 */
export const changePetitionStatusSchema = z.object({
  status: z.enum(PETITION_STATUSES),
  confirmedStatuteCitations: z.array(z.string().trim().min(1)).max(100).optional(),
  note: z.string().trim().max(500).optional(),
});
export type ChangePetitionStatusInput = z.infer<typeof changePetitionStatusSchema>;

/** POST /petitions/:id/generate — PETITION_DRAFT. */
export const generatePetitionSchema = z.object({
  /** Şablonun üslup notunun üzerine geçen ek talimat. */
  styleNote: z.string().trim().max(500).optional(),
  piiApproved: z.boolean().optional(),
  note: z.string().trim().max(500).optional(),
});
export type GeneratePetitionInput = z.infer<typeof generatePetitionSchema>;

/** POST /petitions/:id/sections/:key/rewrite — PETITION_SECTION_REWRITE. */
export const rewriteSectionSchema = z.object({
  instruction: z.string().trim().min(3, "Ne yapılmasını istediğinizi yazın.").max(1000),
  piiApproved: z.boolean().optional(),
});
export type RewriteSectionInput = z.infer<typeof rewriteSectionSchema>;

/**
 * POST /petitions/:id/export/udf
 *
 * TTL TAVANI 15 DAKİKADIR (900 sn). Dışa aktarılan UDF, müvekkilin GERÇEK
 * TCKN/adres bilgisini taşır ve ön-imzalı bağlantı kimlik doğrulaması
 * gerektirmez; bağlantı tarayıcı geçmişine ve vekil günlüklerine düşer.
 * 24 saatlik bir bağlantı, kimlik doğrulamasız açık bir kapıdır.
 */
export const exportUdfSchema = z.object({
  /** Ön-imzalı indirme bağlantısının geçerlilik süresi (saniye, tavan 900). */
  expiresIn: z.number().int().min(60).max(900).optional(),
  /**
   * Dışa aktarımda da mevzuat beyanı istenir: kapı burada BİR KEZ DAHA
   * çalıştığı için beyansız bir yol kalmaz (savunma derinliği).
   */
  confirmedStatuteCitations: z.array(z.string().trim().min(1)).max(100).optional(),
});
export type ExportUdfInput = z.infer<typeof exportUdfSchema>;
