/**
 * Dilekçe bölümleri — anahtar üretimi, sürüm gövdesi ve UDF eşlemesi.
 *
 * Şablon (PetitionTemplate.sectionsJson) bölümleri BAŞLIKLA tanımlar
 * ([{title, hint, required}]); sürüm (PetitionVersion.sectionsJson) ise
 * gövdeyi taşır. Bu dosya ikisi arasındaki köprüdür ve iki güvenceyi verir:
 *
 *  1. BÖLÜM ANAHTARI KARARLI: başlıktan deterministik üretilir ("SONUÇ VE İSTEM"
 *     → "sonuc_ve_istem"), böylece tek bölüm yeniden yazımı doğru bölümü bulur.
 *  2. TEK BÖLÜM DEĞİŞİR: `replaceSection` hedef bölüm dışındaki bölümlerin
 *     gövdesini BAYT BAYT korur (Modül 22, kabul kriteri 2).
 */

import { PETITION_SECTION_TITLES, type PetitionInput, type PetitionParty } from "@nomosos/udf";

/** Şablondaki bölüm tanımı. */
export interface TemplateSection {
  title: string;
  hint?: string;
  required?: boolean;
}

/** Sürümdeki bölüm gövdesi. */
export interface PetitionSectionBody {
  key: string;
  title: string;
  body: string;
  /** Gövdeyi kim yazdı: şablon iskeleti, AI önerisi ya da avukat. */
  origin: "TEMPLATE" | "AI" | "MANUAL";
  hint?: string;
  required?: boolean;
}

const TR_MAP: Record<string, string> = {
  ç: "c",
  ğ: "g",
  ı: "i",
  ö: "o",
  ş: "s",
  ü: "u",
  â: "a",
  î: "i",
  û: "u",
};

/**
 * Başlıktan kararlı bölüm anahtarı üretir: "SONUÇ VE İSTEM" → "sonuc_ve_istem".
 *
 * Türkçe küçültme "İ" için "i" + birleşik nokta (U+0307) üretebildiğinden
 * NFD ayrıştırması sonrası birleşik işaretler temizlenir.
 */
export function sectionKey(title: string): string {
  const lowered = title.toLocaleLowerCase("tr-TR");
  let out = "";
  for (const ch of lowered) {
    out += TR_MAP[ch] ?? ch;
  }
  return (
    out
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "bolum"
  );
}

/** PetitionTemplate.sectionsJson ayrıştırması — bozuk JSON'da Türkçe hata. */
export function parseTemplateSections(json: string): TemplateSection[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("Şablonun bölüm tanımı okunamadı (geçersiz JSON).");
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("Şablonda en az bir bölüm tanımlı olmalıdır.");
  }
  return raw.map((item, index) => {
    const obj = (item ?? {}) as Record<string, unknown>;
    const title = typeof obj.title === "string" ? obj.title.trim() : "";
    if (!title) {
      throw new Error(`Şablonun ${index + 1}. bölümünde başlık (title) yok.`);
    }
    return {
      title,
      hint: typeof obj.hint === "string" ? obj.hint : undefined,
      required: obj.required === true,
    };
  });
}

/** Şablon iskeletinden boş sürüm bölümleri üretir. */
export function sectionsFromTemplate(sections: readonly TemplateSection[]): PetitionSectionBody[] {
  return sections.map((s) => ({
    key: sectionKey(s.title),
    title: s.title,
    body: "",
    origin: "TEMPLATE" as const,
    hint: s.hint,
    required: s.required,
  }));
}

/** PetitionVersion.sectionsJson ayrıştırması. */
export function parseVersionSections(json: string): PetitionSectionBody[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("Dilekçe sürümünün bölümleri okunamadı (geçersiz JSON).");
  }
  if (!Array.isArray(raw)) return [];
  return raw.map((item, index) => {
    const obj = (item ?? {}) as Record<string, unknown>;
    const title = typeof obj.title === "string" ? obj.title : `BÖLÜM ${index + 1}`;
    return {
      key: typeof obj.key === "string" && obj.key ? obj.key : sectionKey(title),
      title,
      body: typeof obj.body === "string" ? obj.body : "",
      origin:
        obj.origin === "AI" || obj.origin === "MANUAL" || obj.origin === "TEMPLATE"
          ? obj.origin
          : "MANUAL",
      hint: typeof obj.hint === "string" ? obj.hint : undefined,
      required: obj.required === true,
    };
  });
}

/**
 * Sürüm metnini üretir. ATIF ÇIKARIMI VE TEYİT BU METİN ÜZERİNDE YAPILIR;
 * bölüm başlıkları da dahil edilir ki "HUKUKİ SEBEPLER" altındaki künyeler
 * gözden kaçmasın.
 */
export function sectionsToPlainText(sections: readonly PetitionSectionBody[]): string {
  return sections
    .map((s) => `${s.title}\n${s.body}`.trim())
    .filter((block) => block.length > 0)
    .join("\n\n");
}

/**
 * Tek bölümü değiştirir; diğer bölümlerin gövdesi BAYT BAYT korunur.
 * Bölüm bulunamazsa Türkçe hata fırlatır (sessizce ekleme yapmaz).
 */
export function replaceSection(
  sections: readonly PetitionSectionBody[],
  key: string,
  body: string,
  origin: PetitionSectionBody["origin"],
): PetitionSectionBody[] {
  const index = sections.findIndex((s) => s.key === key);
  if (index < 0) {
    throw new Error(
      `Dilekçede "${key}" anahtarlı bölüm yok. Mevcut bölümler: ${sections.map((s) => s.key).join(", ")}`,
    );
  }
  const next = sections.map((s) => ({ ...s }));
  next[index] = { ...next[index], body, origin };
  return next;
}

/* ------------------------------------------------------------------ *
 * UDF eşlemesi
 * ------------------------------------------------------------------ */

const SUBJECT_KEY = sectionKey(PETITION_SECTION_TITLES.subject);
const EXPLANATIONS_KEY = sectionKey(PETITION_SECTION_TITLES.explanations);
const LEGAL_GROUNDS_KEY = sectionKey(PETITION_SECTION_TITLES.legalGrounds);
const EVIDENCE_KEY = sectionKey(PETITION_SECTION_TITLES.evidence);
const REQUEST_KEY = sectionKey(PETITION_SECTION_TITLES.request);
const ATTACHMENTS_KEY = sectionKey(PETITION_SECTION_TITLES.attachments);

export const UDF_MAPPED_KEYS = new Set([
  SUBJECT_KEY,
  EXPLANATIONS_KEY,
  LEGAL_GROUNDS_KEY,
  EVIDENCE_KEY,
  REQUEST_KEY,
  ATTACHMENTS_KEY,
]);

function lines(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*\d+[-.)]\s*/, "").trim())
    .filter(Boolean);
}

export interface PetitionUdfContext {
  courtName: string;
  caseNumber?: string;
  plaintiffs: PetitionParty[];
  defendants: PetitionParty[];
  plaintiffLabel?: string;
  defendantLabel?: string;
  attorneyName?: string;
  attorneyBarNumber?: string;
  signerTitle?: string;
}

/**
 * Sürüm bölümlerini @nomosos/udf PetitionInput'una çevirir.
 *
 * UDF şablonu sabit bir iskelet üretir (KONU / AÇIKLAMALAR / HUKUKİ SEBEPLER /
 * DELİLLER / SONUÇ VE İSTEM / EKLER). Şablona özgü EK bölümler ("USULE İLİŞKİN
 * İTİRAZLARIMIZ", "İSTİNAF SEBEPLERİMİZ" gibi) kaybolmasın diye AÇIKLAMALAR
 * bloğuna kendi başlıklarıyla, sıralarını koruyarak eklenir. Hiçbir bölüm gövdesi
 * atılmaz.
 */
export function toUdfPetitionInput(
  sections: readonly PetitionSectionBody[],
  ctx: PetitionUdfContext,
): PetitionInput {
  const byKey = new Map(sections.map((s) => [s.key, s]));
  const explanations: string[] = [];

  for (const section of sections) {
    if (UDF_MAPPED_KEYS.has(section.key)) {
      if (section.key === EXPLANATIONS_KEY) {
        explanations.push(...lines(section.body));
      }
      continue;
    }
    if (!section.body.trim()) continue;
    // Eşlenmemiş bölüm: başlığıyla birlikte açıklamalara girer.
    explanations.push(`${section.title}: ${section.body.trim()}`);
  }

  return {
    courtName: ctx.courtName,
    caseNumber: ctx.caseNumber,
    plaintiffLabel: ctx.plaintiffLabel,
    defendantLabel: ctx.defendantLabel,
    plaintiffs: ctx.plaintiffs,
    defendants: ctx.defendants,
    attorney: ctx.attorneyName
      ? { name: ctx.attorneyName, barNumber: ctx.attorneyBarNumber }
      : undefined,
    subject: byKey.get(SUBJECT_KEY)?.body.trim() || "Dilekçemizin sunulmasıdır.",
    explanations,
    legalGrounds: lines(byKey.get(LEGAL_GROUNDS_KEY)?.body ?? ""),
    evidence: lines(byKey.get(EVIDENCE_KEY)?.body ?? ""),
    request: (byKey.get(REQUEST_KEY)?.body ?? "").split(/\r?\n{2,}/).filter((p) => p.trim()),
    attachments: lines(byKey.get(ATTACHMENTS_KEY)?.body ?? ""),
    signerTitle: ctx.signerTitle,
  };
}

/** Dosya adı için güvenli kısaltma (S3 anahtarında ve indirme adında kullanılır). */
export function safeFileName(value: string, max = 60): string {
  const ascii = sectionKey(value).replace(/_/g, "-");
  return (ascii.slice(0, max) || "dilekce").replace(/^-+|-+$/g, "");
}
