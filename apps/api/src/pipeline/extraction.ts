/**
 * Adım 4 — VERİ ÇIKARMA.
 *
 * NEDEN AYRI BİR "DOCUMENT_EXTRACT" AJANI YOK?
 * --------------------------------------------
 * Ajan kataloğunda (packages/legal-ai/agents/registry.ts) belge tabanlı iki ajan
 * vardır: DOC_CLASSIFIER ve DEADLINE_DETECTOR. Katalog dışına çıkıp bu modülde
 * HAM PROMPT yazmak, promptların tek kaynakta toplanması ilkesini bozardı.
 * Bu yüzden veri çıkarma iki bacaklıdır:
 *
 *   (a) AI bacağı  → DOC_CLASSIFIER çıktısındaki `extractedDates` ve `summary`
 *                    (tarihler zaten kaynak alıntısıyla ve guard'dan geçmiş gelir).
 *   (b) KURAL bacağı → aşağıdaki deterministik kalıplar: "istenen belge",
 *                    "verilen süre", "talep" cümleleri. Kalıp eşleşen CÜMLENİN
 *                    KENDİSİ alıntı olarak saklanır; hiçbir tespit kaynaksız değildir.
 *
 * Ayrı bir DOCUMENT_EXTRACT ajanı Faz 3'te kataloğa eklendiğinde bu dosyanın
 * (b) bacağı yedek/çapraz kontrol olarak kalır.
 */

import type { TextFinding } from "./pipeline.types";

/** Cümleye böler (Türkçe noktalama + madde numaralarını korur). */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.;:!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 15 && s.length <= 600);
}

/**
 * Türkçe aksanlarını ASCII'ye indirger.
 *
 * NEDEN: OCR ve eski UYAP çıktıları aksanları sık kaybeder ("süre" → "sure",
 * "müzekkere" → "muzekkere"). Kalıpları aksanlı yazmak, tam da en çok ihtiyaç
 * duyulan bozuk metinlerde tespiti kaçırırdı. Bu yüzden EŞLEŞME katlanmış metin
 * üzerinde yapılır; ALINTI ise daima ORİJİNAL cümledir.
 */
const FOLD_MAP: Record<string, string> = {
  ç: "c", Ç: "c", ğ: "g", Ğ: "g", ı: "i", İ: "i", î: "i",
  ö: "o", Ö: "o", ş: "s", Ş: "s", ü: "u", Ü: "u", â: "a", û: "u",
};

export function foldTr(value: string): string {
  return value.replace(/[çÇğĞıİîöÖşŞüÜâû]/g, (ch) => FOLD_MAP[ch] ?? ch).toLowerCase();
}

/** "İstenen belge" kalıpları — mahkeme/müzekkere dilinde yaygın fiiller (katlanmış metne göre). */
const REQUESTED_DOC_PATTERNS = [
  /ibraz\w*\s+(?:ist|edilmes)/,
  /sunulmas/,
  /celbi/,
  /dosyaya\s+(?:kazandirilmas|sunulmas|ibraz)/,
  /muzekkere\s+yaz/,
  /getirtilmes/,
];

/** "Verilen süre" kalıpları — süre TESPİTİ; hesap YAPILMAZ (motorun işi). */
const DURATION_PATTERNS = [
  /\b(?:bir|iki|uc|dort|bes|alti|yedi|on|onbes|on\s?bes|\d{1,3})\s*(?:gun|hafta|ay)lik\s*(?:kesin\s*)?(?:ek\s*)?sure/,
  /\b(?:\d{1,3}|bir|iki|uc|yedi|on|onbes|on\s?bes)\s*(?:gun|hafta|ay)\s*(?:kesin\s*)?sure/,
  /sure\s*(?:veril|tanin)/,
  /kesin\s*sure/,
];

/** "Talep" kalıpları — mahkemenin/karşı tarafın bizden beklediği işlem. */
const DEMAND_PATTERNS = [
  /beyanda\s+bulun/,
  /itiraz\s+(?:edilmesi|hakki|suresi)/,
  /cevap\s+(?:verilmesi|dilekcesi)/,
  /geregi\w*\s+(?:yapilmas|ifas)/,
  /odenmesi/,
  /hazir\s+bulun/,
];

/**
 * Deterministik tespit çıkarımı.
 *
 * Her bulgu, eşleşmenin geçtiği CÜMLENİN TAMAMINI alıntı olarak taşır; öneri
 * kartında avukat bu alıntıyı okuyup kararını verir.
 */
export function extractFindings(text: string): TextFinding[] {
  const sentences = splitSentences(text);
  const findings: TextFinding[] = [];
  const seen = new Set<string>();

  const push = (kind: TextFinding["kind"], label: string, quote: string): void => {
    const key = `${kind}:${quote.slice(0, 80)}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ kind, label, quote });
  };

  for (const sentence of sentences) {
    // Eşleşme aksansız (katlanmış) metinde; alıntı ORİJİNAL cümle.
    const probe = foldTr(sentence);
    if (REQUESTED_DOC_PATTERNS.some((p) => p.test(probe))) {
      push("ISTENEN_BELGE", "Sunulması / getirtilmesi istenen belge", sentence);
    }
    if (DURATION_PATTERNS.some((p) => p.test(probe))) {
      push("VERILEN_SURE", "Belgede geçen süre ifadesi", sentence);
    }
    if (DEMAND_PATTERNS.some((p) => p.test(probe))) {
      push("TALEP", "Yerine getirilmesi beklenen işlem", sentence);
    }
  }

  // Aynı belgeden onlarca öneri doğmasın: tür başına en fazla 5 tespit.
  return capPerKind(findings, 5);
}

function capPerKind(findings: TextFinding[], max: number): TextFinding[] {
  const counts = new Map<string, number>();
  const kept: TextFinding[] = [];
  for (const finding of findings) {
    const count = counts.get(finding.kind) ?? 0;
    if (count >= max) continue;
    counts.set(finding.kind, count + 1);
    kept.push(finding);
  }
  return kept;
}

/**
 * Sınıflandırma çıktısındaki tarihlerden duruşma tarihi tespiti.
 * `label` alanı "duruşma" içeren tarihler duruşma güncelleme önerisine dönüşür.
 */
export function findHearingDate(
  extractedDates: ReadonlyArray<{ label: string; date: string; sourceQuote?: string }>
): TextFinding | undefined {
  const hit = extractedDates.find((d) => /durusma|celse/.test(foldTr(d.label)));
  if (!hit) return undefined;
  // Kaynaksız tarih ilerlemez (guard zaten eler; burası ikinci kapı).
  if (!hit.sourceQuote?.trim()) return undefined;
  return {
    kind: "DURUSMA_TARIHI",
    label: hit.label,
    quote: hit.sourceQuote.trim(),
    isoDate: hit.date,
  };
}

/** Sınıflandırma çıktısındaki tebliğ tarihi (süre tespitine girdi olur). */
export function findNotifiedAt(
  extractedDates: ReadonlyArray<{ label: string; date: string }>
): string | undefined {
  return extractedDates.find((d) => /teblig|tefhim/.test(foldTr(d.label)))?.date;
}
