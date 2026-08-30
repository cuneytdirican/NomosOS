/**
 * NomosOS ortak sabitleri — Türk hukuk sistemi terminolojisi.
 * Enum değerleri Prisma şemasıyla (packages/db/prisma/schema.prisma) birebir aynıdır.
 */

export const USER_ROLES = ["ADMIN", "PARTNER", "AVUKAT", "STAJYER", "SEKRETER"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const CLIENT_TYPES = ["GERCEK_KISI", "TUZEL_KISI"] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];

export const CASE_TYPES = ["DAVA", "ICRA", "ARABULUCULUK", "CEZA", "DANISMANLIK"] as const;
export type CaseType = (typeof CASE_TYPES)[number];

export const CASE_STATUSES = [
  "ACIK",
  "DERDEST",
  "KARAR",
  "ISTINAF",
  "TEMYIZ",
  "KESINLESTI",
  "ICRADA",
  "KAPANDI",
  "ARSIV",
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const PARTY_ROLES = [
  "DAVACI",
  "DAVALI",
  "MUDAHIL",
  "ALACAKLI",
  "BORCLU",
  "SANIK",
  "MUSTEKI",
  "KATILAN",
  "TANIK",
  "DIGER",
] as const;
export type PartyRole = (typeof PARTY_ROLES)[number];

export const HEARING_TYPES = ["DURUSMA", "ON_INCELEME", "KESIF", "E_DURUSMA", "MUZAKERE", "DIGER"] as const;
export type HearingType = (typeof HEARING_TYPES)[number];

export const DEADLINE_SOURCES = ["MANUEL", "KURAL", "AI_ONERISI"] as const;
export type DeadlineSource = (typeof DEADLINE_SOURCES)[number];

export const DEADLINE_STATUSES = ["BEKLIYOR", "ONAYLANDI", "TAMAMLANDI", "KACIRILDI", "IPTAL"] as const;
export type DeadlineStatus = (typeof DEADLINE_STATUSES)[number];

export const TASK_STATUSES = ["ACIK", "DEVAM_EDIYOR", "KONTROLDE", "ONAY_BEKLIYOR", "TAMAMLANDI", "IPTAL"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["DUSUK", "NORMAL", "YUKSEK", "KRITIK"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** Belge sınıflandırma taksonomisi — otomatik aksiyon hattının (Modül 06) temeli. */
export const DOCUMENT_CLASSES = [
  "DILEKCE",
  "TENSIP_ZAPTI",
  "ARA_KARAR",
  "GEREKCELI_KARAR",
  "BILIRKISI_RAPORU",
  "DURUSMA_TUTANAGI",
  "TEBLIGAT",
  "MUZEKKERE",
  "VEKALETNAME",
  "SOZLESME",
  "DELIL",
  "FATURA",
  "ICRA_EVRAKI",
  "DIGER",
] as const;
export type DocumentClass = (typeof DOCUMENT_CLASSES)[number];

export const FINANCIAL_ENTRY_TYPES = [
  "TAHAKKUK",
  "TAHSILAT",
  "AVANS",
  "MASRAF",
  "HARC",
  "VEKALET_UCRETI",
  "DANISMANLIK",
  "IADE",
] as const;
export type FinancialEntryType = (typeof FINANCIAL_ENTRY_TYPES)[number];

export const AI_PROVIDER_TYPES = ["ANTHROPIC", "OPENAI_COMPAT", "OLLAMA", "GEMINI", "CUSTOM"] as const;
export type AiProviderType = (typeof AI_PROVIDER_TYPES)[number];

/** Mahkeme türleri (UI seçim listeleri için). */
export const COURT_TYPES = [
  "Asliye Hukuk Mahkemesi",
  "Asliye Ticaret Mahkemesi",
  "İş Mahkemesi",
  "Aile Mahkemesi",
  "Tüketici Mahkemesi",
  "Kadastro Mahkemesi",
  "Fikri ve Sınai Haklar Hukuk Mahkemesi",
  "Sulh Hukuk Mahkemesi",
  "İcra Hukuk Mahkemesi",
  "İcra Ceza Mahkemesi",
  "Asliye Ceza Mahkemesi",
  "Ağır Ceza Mahkemesi",
  "Sulh Ceza Hâkimliği",
  "İdare Mahkemesi",
  "Vergi Mahkemesi",
  "Bölge Adliye Mahkemesi",
  "Bölge İdare Mahkemesi",
  "Yargıtay",
  "Danıştay",
  "Anayasa Mahkemesi",
  "İcra Dairesi",
  "Arabuluculuk Bürosu",
] as const;
export type CourtType = (typeof COURT_TYPES)[number];
