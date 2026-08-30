/**
 * Türk hukuk uygulamasında standart dilekçe iskeletini üretir.
 *
 * Düzen (uygulamada yerleşik sıra):
 *   T.C. / MAHKEME ADI / SAYIN HÂKİMLİĞİ'NE   → ortalı, kalın
 *   ESAS NO, DOSYA NO
 *   DAVACI / VEKİLİ / DAVALI (+ TCKN, adres)
 *   KONU
 *   AÇIKLAMALAR
 *   HUKUKİ SEBEPLER
 *   DELİLLER
 *   SONUÇ VE İSTEM
 *   EKLER (opsiyonel)
 *   Tarih + Ad-Soyad + İmza bloğu          → sağa yaslı
 *
 * Bu modül yalnızca metin/yerleşim üretir; UDF'e çevirme işini builder yapar.
 */

import { createUdf } from "./builder";
import { UDF_DEFAULT_FONT_FAMILY, UDF_DEFAULT_FONT_SIZE } from "./spec";
import type {
  CreateUdfOptions,
  UdfDocument,
  UdfParagraph,
  UdfStyleRun,
  UdfTextStyle,
} from "./types";

/** Dilekçedeki taraf (davacı/davalı/borçlu/alacaklı vb.). */
export interface PetitionParty {
  /** Gerçek kişide ad-soyad, tüzel kişide unvan. */
  name: string;
  /** T.C. Kimlik No veya Vergi Kimlik No. */
  identityNumber?: string;
  address?: string;
}

/** Dilekçeyi imzalayan vekil. */
export interface PetitionAttorney {
  /** "Av." ön eki olmadan ad-soyad; ön ek otomatik eklenir. */
  name: string;
  /** Bağlı olduğu baro, ör. "Ankara Barosu". */
  barName?: string;
  /** Baro sicil numarası. */
  barNumber?: string;
  address?: string;
}

/** Dilekçe şablonu girdisi. */
export interface PetitionInput {
  /** Ör. "ANKARA 3. ASLİYE HUKUK MAHKEMESİ". */
  courtName: string;
  /** Varsayılan: "SAYIN HÂKİMLİĞİ'NE". İcra dairelerinde "MÜDÜRLÜĞÜ'NE" verilebilir. */
  courtSalutation?: string;
  /** Başa "T.C." satırı eklensin mi (varsayılan: true). */
  includeTcHeader?: boolean;
  /** Esas No, ör. "2026/1234". */
  caseNumber?: string;
  /** İcra/dosya numarası, ör. "2026/5678 E.". */
  fileNumber?: string;
  /** Davacı/alacaklı tarafı etiketi (varsayılan "DAVACI"). */
  plaintiffLabel?: string;
  /** Davalı/borçlu tarafı etiketi (varsayılan "DAVALI"). */
  defendantLabel?: string;
  plaintiffs: PetitionParty[];
  defendants: PetitionParty[];
  attorney?: PetitionAttorney;
  /** KONU bölümünün metni. */
  subject: string;
  /** AÇIKLAMALAR bölümü; her madde numaralandırılır. */
  explanations: string[];
  /** HUKUKİ SEBEPLER; boşsa metne görünür yer tutucu basılır (sistem dayanak UYDURMAZ). */
  legalGrounds?: string[];
  /** DELİLLER; boşsa metne görünür yer tutucu basılır. */
  evidence?: string[];
  /** SONUÇ VE İSTEM metni (tek paragraf veya paragraf listesi). */
  request: string | string[];
  /** EKLER listesi (opsiyonel). */
  attachments?: string[];
  /** Dilekçe tarihi. Verilmezse bugünün tarihi kullanılır. */
  date?: Date | string;
  /** İmza bloğundaki unvan, ör. "Davacı Vekili". */
  signerTitle?: string;
  /** İmza bloğundaki ad. Verilmezse vekil adı, o da yoksa ilk davacı kullanılır. */
  signerName?: string;
  /** Belge geneli yazı tipi. */
  defaultStyle?: UdfTextStyle;
}

/** Şablonun ürettiği bölüm başlıkları (test ve UI için sabit). */
export const PETITION_SECTION_TITLES = {
  subject: "KONU",
  explanations: "AÇIKLAMALAR",
  legalGrounds: "HUKUKİ SEBEPLER",
  evidence: "DELİLLER",
  request: "SONUÇ VE İSTEM",
  attachments: "EKLER",
} as const;

/** Bölüm başlıklarının sıralı listesi. */
export const PETITION_SECTION_ORDER: readonly string[] = [
  PETITION_SECTION_TITLES.subject,
  PETITION_SECTION_TITLES.explanations,
  PETITION_SECTION_TITLES.legalGrounds,
  PETITION_SECTION_TITLES.evidence,
  PETITION_SECTION_TITLES.request,
];

const DEFAULT_SALUTATION = "SAYIN HÂKİMLİĞİ'NE";

/**
 * DÜZELTİLDİ (hukuki denetim, bulgu 16): boş bırakılan alanlara sistem KENDİ hukuki
 * sebebini/delilini yazıyordu ("HMK, TBK ve ilgili sair mevzuat hükümleri."). İcra (İİK),
 * idari (İYUK) veya ceza dilekçesinde bu dayanak YANLIŞTIR ve avukatın beyanı değil
 * sistemin varsayımıdır; legal-ai tarafındaki "[BAĞLAMDA EKSİK: …]" ilkesiyle de çelişir.
 * Artık mahkemeye giden metne görünür bir YER TUTUCU basılır: avukat doldurmadan
 * gönderirse eksiklik gözden kaçmaz.
 */
export const LEGAL_GROUNDS_PLACEHOLDER = "[HUKUKİ SEBEPLER — DOLDURULACAK]";
export const EVIDENCE_PLACEHOLDER = "[DELİLLER — DOLDURULACAK]";
const LABEL_INDENT = 20;

/** Türkiye saatiyle "GG.AA.YYYY". */
const TR_DATE_FORMATTER = new Intl.DateTimeFormat("tr-TR", {
  timeZone: "Europe/Istanbul",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/**
 * Tarihi "GG.AA.YYYY" biçiminde yazar.
 *
 * DÜZELTİLDİ (hukuki denetim, bulgu 17): `getDate()/getMonth()/getFullYear()` SUNUCUNUN
 * yerel saat dilimini kullanıyordu; UTC'de koşan bir sunucuda TR saatiyle 00:00-03:00
 * arasında üretilen dilekçe BİR GÜN GERİYE tarihleniyordu. Artık biçimlendirme her zaman
 * Europe/Istanbul üzerinden yapılır (eklenti tarafındaki `TR_UTC_OFFSET` ile tutarlı).
 */
export function formatPetitionDate(value: Date | string | undefined): string {
  if (typeof value === "string") return value;
  return TR_DATE_FORMATTER.format(value ?? new Date());
}

/** "ETİKET: değer" paragrafı — etiket kısmı kalın bir run olarak işaretlenir. */
function labeledParagraph(label: string, value: string): UdfParagraph {
  const prefix = `${label}: `;
  const runs: UdfStyleRun[] = [{ startOffset: 0, length: prefix.length, style: { bold: true } }];
  return { text: `${prefix}${value}`, runs };
}

/** Kalın bölüm başlığı paragrafı. */
function sectionHeading(title: string): UdfParagraph {
  return { text: title, style: { bold: true }, layout: { spaceAbove: 6 } };
}

/** Boş (dikey boşluk) paragrafı. */
function blank(): UdfParagraph {
  return { text: "" };
}

function partyParagraphs(label: string, parties: PetitionParty[]): UdfParagraph[] {
  const result: UdfParagraph[] = [];
  parties.forEach((party, index) => {
    const suffix = parties.length > 1 ? ` ${index + 1}` : "";
    const identity = party.identityNumber ? ` (T.C. Kimlik No: ${party.identityNumber})` : "";
    result.push(labeledParagraph(`${label}${suffix}`, `${party.name}${identity}`));
    if (party.address) {
      result.push({ text: party.address, layout: { leftIndent: LABEL_INDENT } });
    }
  });
  return result;
}

function attorneyParagraphs(attorney: PetitionAttorney | undefined): UdfParagraph[] {
  if (!attorney) return [];
  const name = attorney.name.trim().toLowerCase().startsWith("av.")
    ? attorney.name.trim()
    : `Av. ${attorney.name.trim()}`;
  const barParts: string[] = [];
  if (attorney.barName) barParts.push(attorney.barName);
  if (attorney.barNumber) barParts.push(`Sicil No: ${attorney.barNumber}`);
  const suffix = barParts.length > 0 ? ` (${barParts.join(", ")})` : "";
  const result: UdfParagraph[] = [labeledParagraph("VEKİLİ", `${name}${suffix}`)];
  if (attorney.address) {
    result.push({ text: attorney.address, layout: { leftIndent: LABEL_INDENT } });
  }
  return result;
}

/** Dilekçe girdisinden UdfDocument üretir. */
export function buildPetitionDocument(input: PetitionInput): UdfDocument {
  const paragraphs: UdfParagraph[] = [];
  const headingStyle: UdfTextStyle = { bold: true };

  // --- Başlık bloğu (ortalı) ---
  if (input.includeTcHeader !== false) {
    paragraphs.push({ text: "T.C.", style: headingStyle, layout: { alignment: "center" } });
  }
  paragraphs.push({
    text: input.courtName.trim().toLocaleUpperCase("tr-TR"),
    style: headingStyle,
    layout: { alignment: "center" },
  });
  paragraphs.push({
    text: (input.courtSalutation ?? DEFAULT_SALUTATION).trim(),
    style: headingStyle,
    layout: { alignment: "center" },
  });
  paragraphs.push(blank());

  // --- Dosya bilgileri ---
  if (input.caseNumber) paragraphs.push(labeledParagraph("ESAS NO", input.caseNumber));
  if (input.fileNumber) paragraphs.push(labeledParagraph("DOSYA NO", input.fileNumber));
  if (input.caseNumber || input.fileNumber) paragraphs.push(blank());

  // --- Taraflar ---
  paragraphs.push(...partyParagraphs(input.plaintiffLabel ?? "DAVACI", input.plaintiffs));
  paragraphs.push(...attorneyParagraphs(input.attorney));
  paragraphs.push(...partyParagraphs(input.defendantLabel ?? "DAVALI", input.defendants));
  paragraphs.push(blank());

  // --- KONU ---
  paragraphs.push(labeledParagraph(PETITION_SECTION_TITLES.subject, input.subject.trim()));
  paragraphs.push(blank());

  // --- AÇIKLAMALAR ---
  paragraphs.push(sectionHeading(`${PETITION_SECTION_TITLES.explanations}:`));
  const explanations = input.explanations.filter((item) => item.trim() !== "");
  explanations.forEach((item, index) => {
    paragraphs.push({
      text: `${index + 1}- ${item.trim()}`,
      layout: { alignment: "justify", firstLineIndent: 20 },
    });
  });
  if (explanations.length === 0) {
    paragraphs.push({ text: "1- ", layout: { alignment: "justify" } });
  }
  paragraphs.push(blank());

  // --- HUKUKİ SEBEPLER ---
  paragraphs.push(sectionHeading(`${PETITION_SECTION_TITLES.legalGrounds}:`));
  const grounds = (input.legalGrounds ?? []).filter((item) => item.trim() !== "");
  if (grounds.length === 0) {
    // Sistem kendi hukuki sebebini YAZMAZ; görünür yer tutucu bırakır (bulgu 16).
    paragraphs.push({ text: LEGAL_GROUNDS_PLACEHOLDER, style: { bold: true } });
  } else {
    paragraphs.push({ text: grounds.map((item) => item.trim()).join(", ") + "." });
  }
  paragraphs.push(blank());

  // --- DELİLLER ---
  paragraphs.push(sectionHeading(`${PETITION_SECTION_TITLES.evidence}:`));
  const evidence = (input.evidence ?? []).filter((item) => item.trim() !== "");
  if (evidence.length === 0) {
    paragraphs.push({ text: EVIDENCE_PLACEHOLDER, style: { bold: true } });
  } else {
    evidence.forEach((item, index) => {
      paragraphs.push({
        text: `${index + 1}- ${item.trim()}`,
        layout: { leftIndent: LABEL_INDENT },
      });
    });
  }
  paragraphs.push(blank());

  // --- SONUÇ VE İSTEM ---
  paragraphs.push(sectionHeading(`${PETITION_SECTION_TITLES.request}:`));
  const requestParagraphs = Array.isArray(input.request) ? input.request : [input.request];
  for (const item of requestParagraphs) {
    if (item.trim() === "") continue;
    paragraphs.push({ text: item.trim(), layout: { alignment: "justify", firstLineIndent: 20 } });
  }
  paragraphs.push(blank());

  // --- EKLER (opsiyonel) ---
  const attachments = (input.attachments ?? []).filter((item) => item.trim() !== "");
  if (attachments.length > 0) {
    paragraphs.push(sectionHeading(`${PETITION_SECTION_TITLES.attachments}:`));
    attachments.forEach((item, index) => {
      paragraphs.push({
        text: `${index + 1}- ${item.trim()}`,
        layout: { leftIndent: LABEL_INDENT },
      });
    });
    paragraphs.push(blank());
  }

  // --- Tarih + imza bloğu (sağa yaslı) ---
  const dateText = formatPetitionDate(input.date);
  paragraphs.push({ text: dateText, layout: { alignment: "right" } });
  const signerTitle = input.signerTitle ?? (input.attorney ? "Davacı Vekili" : "Davacı");
  const signerName =
    input.signerName ??
    (input.attorney
      ? attorneyDisplayName(input.attorney)
      : (input.plaintiffs[0]?.name ?? ""));
  paragraphs.push({ text: signerTitle, layout: { alignment: "right" } });
  if (signerName) {
    paragraphs.push({ text: signerName, style: { bold: true }, layout: { alignment: "right" } });
  }
  paragraphs.push({ text: "(İmza)", layout: { alignment: "right" } });

  return {
    metadata: {
      title: `${input.courtName} - Dilekçe`,
    },
    defaultStyle: {
      fontFamily: UDF_DEFAULT_FONT_FAMILY,
      fontSize: UDF_DEFAULT_FONT_SIZE,
      ...(input.defaultStyle ?? {}),
    },
    paragraphs,
  };
}

function attorneyDisplayName(attorney: PetitionAttorney): string {
  const name = attorney.name.trim();
  return name.toLowerCase().startsWith("av.") ? name : `Av. ${name}`;
}

/** Dilekçe girdisinden doğrudan UDF baytları üretir. */
export async function createPetitionUdf(
  input: PetitionInput,
  options: CreateUdfOptions = {},
): Promise<Uint8Array> {
  return createUdf(buildPetitionDocument(input), options);
}
