import type { PetitionSectionBody } from "./petition-sections";

/**
 * DİLEKÇE SÜRÜM FARKI (D5 / cila — "sürüm fark görünümü").
 *
 * Sürümler DEĞİŞTİRİLEMEZ (değişmezlik ilkesi) ve her düzenleme yeni
 * PetitionVersion doğurur; bu dosya iki sürüm ARASINDAKİ farkı hesaplar.
 *
 * İki düzey:
 *   1. BÖLÜM düzeyi — anahtar eşleşmesiyle bölüm eklendi/çıkarıldı/değişti.
 *   2. SATIR düzeyi — LCS tabanlı satır farkı (Eklenme/Çıkarılma satırları).
 *
 * Kararlılık: bölüm eşleşmesi `key` üzerinden yapılır (başlık yeniden
 * yazılsa bile aynı bölüm eşleşir); `key` yoksa başlığın normalize
 * edilmiş hali kullanılır.
 */

export type LineOp = "same" | "added" | "removed";

export interface LineDiff {
  op: LineOp;
  text: string;
}

export type SectionChangeKind = "ADDED" | "REMOVED" | "CHANGED" | "UNCHANGED";

export interface SectionDiff {
  key: string;
  title: string;
  /** Karşılaşılan sürümdeki bölüm numarası (kullanıcıya gösterim için). */
  order: number;
  change: SectionChangeKind;
  fromBody: string;
  toBody: string;
  lines: LineDiff[];
  /** Değişen satır sayısı (eklenen + çıkarılan) — özet için. */
  addedLines: number;
  removedLines: number;
}

/** Normalizasyon — boşluk/fark kültürü duyarsız eşleşme. */
function normKey(s: PetitionSectionBody): string {
  return (s.key || s.title).toLocaleLowerCase("tr-TR").replace(/\s+/g, " ").trim();
}

/**
 * SATIR FARKI — klasik LCS (en uzun ortak alt dizi).
 * Dilekçe bölümleri kısa olduğundan (yüzlerce satır altı) DP tablosu güvenlidir.
 */
export function diffLines(fromText: string, toText: string): LineDiff[] {
  const a = fromText.length === 0 ? [] : fromText.split("\n");
  const b = toText.length === 0 ? [] : toText.split("\n");
  const n = a.length;
  const m = b.length;

  // DP tablosu — (n+1) × (m+1); metinler boşsa doğrudan dön.
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const out: LineDiff[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: "same", text: a[i] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      out.push({ op: "removed", text: a[i] });
      i++;
    } else {
      out.push({ op: "added", text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ op: "removed", text: a[i++] });
  while (j < m) out.push({ op: "added", text: b[j++] });
  return out;
}

/** BÖLÜM FARKI — anahtar eşleşmesi + bölüm başına satır farkı. */
export function diffSections(
  from: readonly PetitionSectionBody[],
  to: readonly PetitionSectionBody[]
): SectionDiff[] {
  const fromByKey = new Map(from.map((s) => [normKey(s), s]));

  // Sıra, HEDEF sürümün sırasıdır; sonra kaynakta olup hedefte olmayanlar.
  const out: SectionDiff[] = [];
  const seen = new Set<string>();

  to.forEach((s, index) => {
    const key = normKey(s);
    seen.add(key);
    const prev = fromByKey.get(key);
    const lines = prev ? diffLines(prev.body, s.body) : s.body.split("\n").map((t) => ({ op: "added" as LineOp, text: t }));
    const addedLines = lines.filter((l) => l.op === "added").length;
    const removedLines = lines.filter((l) => l.op === "removed").length;
    out.push({
      key: s.key || s.title,
      title: s.title,
      order: index + 1,
      change: !prev ? "ADDED" : addedLines + removedLines === 0 ? "UNCHANGED" : "CHANGED",
      fromBody: prev?.body ?? "",
      toBody: s.body,
      lines,
      addedLines,
      removedLines,
    });
  });

  from.forEach((s) => {
    const key = normKey(s);
    if (seen.has(key)) return;
    const lines = s.body.split("\n").map((t) => ({ op: "removed" as LineOp, text: t }));
    out.push({
      key: s.key || s.title,
      title: s.title,
      order: 0, // hedef sürümde yok
      change: "REMOVED",
      fromBody: s.body,
      toBody: "",
      lines,
      addedLines: 0,
      removedLines: lines.length,
    });
  });

  return out;
}

/** Özet sayaçlar. */
export function summarizeDiff(diffs: readonly SectionDiff[]) {
  return {
    addedSections: diffs.filter((d) => d.change === "ADDED").length,
    removedSections: diffs.filter((d) => d.change === "REMOVED").length,
    changedSections: diffs.filter((d) => d.change === "CHANGED").length,
    unchangedSections: diffs.filter((d) => d.change === "UNCHANGED").length,
    addedLines: diffs.reduce((acc, d) => acc + d.addedLines, 0),
    removedLines: diffs.reduce((acc, d) => acc + d.removedLines, 0),
  };
}
