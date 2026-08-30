/**
 * Adım 3 — DOSYA EŞLEME yardımcıları (DETERMİNİSTİK).
 *
 * Eşleme AI'a bırakılmaz: esas numarası ve taraf adı, metinde ya vardır ya
 * yoktur. AI'ın katkısı yalnızca sınıflandırma çıktısındaki `suggestedCaseNumber`
 * ipucudur; o da burada regex ile normalize edilip DB'de aranır. Eşik altındaki
 * her sonuç DOSYA_ESLESTIRME önerisine dönüşür — belge sessizce yanlış dosyaya
 * bağlanmaz (Modül 06, iş kuralı 2).
 */

/** "2026/145", "2026 / 145", "E. 2026/145" kalıpları. */
const CASE_NUMBER_PATTERN = /\b((?:19|20)\d{2})\s*\/\s*(\d{1,6})\b/g;

/** Metinde geçen esas numarası adaylarını `YYYY/N` biçiminde döndürür. */
export function extractCaseNumbers(text: string): string[] {
  const found = new Set<string>();
  CASE_NUMBER_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CASE_NUMBER_PATTERN.exec(text)) !== null) {
    found.add(`${match[1]}/${Number(match[2])}`);
  }
  return [...found];
}

/** Serbest metni "2026/145" biçimine indirger; çıkaramazsa undefined. */
export function normalizeCaseNumber(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const [first] = extractCaseNumbers(raw);
  return first;
}

const TR_LOWER_MAP: Record<string, string> = {
  Ç: "ç", Ğ: "ğ", I: "ı", İ: "i", Ö: "ö", Ş: "ş", Ü: "ü",
};

/** Türkçe duyarlı küçültme + noktalama/boşluk sadeleştirme. */
export function normalizeForCompare(value: string): string {
  return value
    .replace(/[ÇĞIİÖŞÜ]/g, (ch) => TR_LOWER_MAP[ch] ?? ch)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Mahkeme adı benzerliği: ortak anlamlı sözcük oranı (0..1). */
export function courtSimilarity(a: string | undefined, b: string | undefined): number {
  if (!a || !b) return 0;
  const tokensA = new Set(normalizeForCompare(a).split(" ").filter((t) => t.length > 2));
  const tokensB = new Set(normalizeForCompare(b).split(" ").filter((t) => t.length > 2));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let common = 0;
  for (const token of tokensA) if (tokensB.has(token)) common += 1;
  return common / Math.min(tokensA.size, tokensB.size);
}

/** Taraf adı belge metninde geçiyor mu? (tek harflik gürültü elenir) */
export function partyAppearsInText(partyName: string, normalizedText: string): boolean {
  const normalized = normalizeForCompare(partyName);
  if (normalized.length < 5) return false;
  return normalizedText.includes(normalized);
}

export interface CaseMatchCandidate {
  caseId: string;
  title: string;
  fileNumber: string | null;
  courtName: string | null;
  confidence: number;
  /** Eşleşmenin insan-okur gerekçesi (öneri kartında gösterilir). */
  reason: string;
}

/**
 * Adayları güvene göre sıralar; ilk aday tek başına eşiği geçiyor ve ikinciyle
 * arasında belirgin fark varsa OTOMATİK bağlanabilir demektir.
 */
export function rankCandidates(candidates: CaseMatchCandidate[]): CaseMatchCandidate[] {
  return [...candidates].sort((a, b) => b.confidence - a.confidence);
}

/**
 * Otomatik bağlama kararı.
 *
 * Tek aday + eşik üstü güven ⇒ otomatik. Birden fazla aday eşiği geçiyorsa
 * BELİRSİZDİR: hangisinin doğru olduğunu avukat seçer.
 */
export function decideAutoLink(
  ranked: CaseMatchCandidate[],
  threshold: number
): { auto: CaseMatchCandidate | null; ambiguous: boolean } {
  if (ranked.length === 0) return { auto: null, ambiguous: false };
  const [first, second] = ranked;
  if (first.confidence < threshold) return { auto: null, ambiguous: ranked.length > 1 };
  if (second && second.confidence >= threshold) return { auto: null, ambiguous: true };
  return { auto: first, ambiguous: false };
}
