/**
 * SÜRÜM FARKI — SUNUCUDA ÜRETİLİR.
 *
 * NEDEN SUNUCUDA: metinler istemciye tam gelmeden karşılaştırma tutarlı olur
 * ve diff DENETİM İZİNE yazılır (kim, hangi iki sürümü karşılaştırdı —
 * ContractVersionDiff.createdBy). İstemcide üçüncü bir diff kopyası tutmak
 * ayırışma riski doğururdu.
 *
 * İKİ KATMAN:
 *  1. diffLines — satır bazlı klasik LCS. Tablo belleği O(n·m) olduğundan
 *     SATIR sayısı tavana bağlanmıştır; aşılırsa kaba fallback (tüm satırlar
 *     "çıktı + girdi") uygulanır — sessiz yalan yok.
 *  2. diffPages — SAYFA PENCERELİ fark (ölçeklendirme). Yüzlerce sayfalık
 *     sözleşmelerde tüm metin üzerinde tek LCS tablosu hem O(n·m) bellek hem
 *     (daha kötüsü) TEK İSTEKTE yüzlerce sayfalık fark demektir. Bunun yerine
 *     her sürüm sanal sayfalara bölünür (contract-analysis-chunks), AYNI
 *     numaralı sayfa ± 1 penceresi karşılaştırılır; değişmeyen sayfalar ATLANIR
 *     ve sonuç SAYFALANMIŞ döner (yalnız değişen sayfalar listede görünür).
 */

import { splitIntoPages } from "./contract-analysis-chunks";

/** LCS tablosunun güvenli hesaplanacağı azami toplam satır sayısı. */
export const MAX_DIFF_LINES = 4000;

export interface LineDiff {
  added: string[];
  removed: string[];
  changed: { before: string; after: string }[];
}

/** Metni karşılaştırma satırlarına böler (satır sonu normalizasyonu). */
export function splitLines(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd());
}

/**
 * İki metnin satır bazlı farkı.
 *
 * Değişen satır eşleştirmesi: LCS yürüyüşünde ardışık "çıktı" bloğu hemen
 * ardından "girdi" bloğu geliyorsa, iki bloğun min uzunluğu kadar satırı
 * "değişen" çifti olarak eşleştirilir; artanlar added/removed kalır. Bu bir
 * SUNUM yardımıdır — farkın kendisi yalnızca eklenen/çıkan satırlardan oluşur.
 */
export function diffLines(a: string, b: string): LineDiff {
  const aLines = splitLines(a);
  const bLines = splitLines(b);

  if (aLines.length + bLines.length > MAX_DIFF_LINES) {
    return { added: [...bLines], removed: [...aLines], changed: [] };
  }

  // LCS uzunluk tablosu — (n+1) x (m+1).
  const n = aLines.length;
  const m = bLines.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i][j] =
        aLines[i] === bLines[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  // Yürüyüş: ortak satırlar atlanır, farklar remove/add bloklarına yazılır.
  const added: string[] = [];
  const removed: string[] = [];
  const changed: { before: string; after: string }[] = [];

  let i = 0;
  let j = 0;
  const removedRun: string[] = [];
  const addedRun: string[] = [];

  const flushRuns = () => {
    const pairs = Math.min(removedRun.length, addedRun.length);
    for (let k = 0; k < pairs; k += 1) {
      changed.push({ before: removedRun[k], after: addedRun[k] });
    }
    for (let k = pairs; k < removedRun.length; k += 1) removed.push(removedRun[k]);
    for (let k = pairs; k < addedRun.length; k += 1) added.push(addedRun[k]);
    removedRun.length = 0;
    addedRun.length = 0;
  };

  while (i < n || j < m) {
    if (i < n && j < m && aLines[i] === bLines[j]) {
      flushRuns();
      i += 1;
      j += 1;
    } else if (j < m && (i >= n || table[i + 1][j] <= table[i][j + 1])) {
      addedRun.push(bLines[j]);
      j += 1;
    } else {
      removedRun.push(aLines[i]);
      i += 1;
    }
  }
  flushRuns();

  return { added, removed, changed };
}

/** Diff özet ölçüleri — ContractVersionDiff sayı alanlarının kaynağı. */
export function diffCounts(diff: LineDiff): { addedCount: number; removedCount: number; changedCount: number } {
  return {
    addedCount: diff.added.length,
    removedCount: diff.removed.length,
    changedCount: diff.changed.length,
  };
}

// ===========================================================================
// SAYFA PENCERELİ FARK — çok sayfalı sözleşmeler için ölçeklendirme katmanı
// ===========================================================================

/** Sayfa penceresi: A sayfası, B'nin aynı numaralı sayfası ± bu kadar sayfayla eşlenir. */
export const DIFF_PAGE_WINDOW = 1;

export type PageDiffStatus = "DEGISTI" | "EKLENDI" | "SILINDI";

/** Tek sayfanın farkı — yalnızca DEĞİŞEN sayfalar için kayıt üretilir. */
export interface PageDiffEntry {
  /** 1 tabanlı sayfa numarası (sanal sayfa — bkz. contract-analysis-chunks). */
  page: number;
  status: PageDiffStatus;
  added: string[];
  removed: string[];
  changed: { before: string; after: string }[];
}

export interface PagedDiff {
  /** Değişen sayfalar (DEGISTI/EKLENDI/SILINDI), sayfa numarasına göre sıralı. */
  pages: PageDiffEntry[];
  counts: { addedCount: number; removedCount: number; changedCount: number };
  pageCounts: { a: number; b: number };
  /** Birebir eşleşen (atlanan) sayfa sayısı — özet gösterimin kaynağı. */
  unchangedPages: number;
}

/**
 * İki metnin SAYFA PENCERELİ farkı.
 *
 * Eşleme kuralı: A sayfası i için önce B'nin [i-1, i+1] penceresinde BİREBİR
 * AYNI sayfa aranır (bulunursa sayfa ATLANIR — değişmemiştir). Birebir eş
 * yoksa penceredeki eşlenmemiş en yakın B sayfasıyla SATIR bazlı LCS koşar
 * (sayfa başına ~40 satır — tablo küçüktür). Pencerede hiç aday kalmadıysa
 * sayfa silinmiş/eklenmiş sayılır.
 *
 * Pencere ±1'dir: ortadan sayfa EKLENMESİ/ÇIKARILMASI sonrası kayan sayfa
 * numaraları emilir. Arka arkaya iki ekleme pencereyi aşar; kalan sayfalar
 * DEGISTI listelenir — sonuç YANLIŞ olmaz, yalnızca daha kalabalık görünür.
 */
export function diffPages(aText: string, bText: string, window: number = DIFF_PAGE_WINDOW): PagedDiff {
  const aPages = splitIntoPages(aText);
  const bPages = splitIntoPages(bText);
  const candidates = (i: number): number[] => {
    const out: number[] = [];
    for (let j = i - window; j <= i + window; j += 1) {
      if (j >= 0 && j < bPages.length) out.push(j);
    }
    return out;
  };

  // 1. tur — birebir eşleşen sayfalar atlanır (değişmeyen sayfa fark üretmez).
  const consumed = new Set<number>();
  const aMatched = new Set<number>();
  for (let i = 0; i < aPages.length; i += 1) {
    for (const j of candidates(i)) {
      if (consumed.has(j)) continue;
      if (aPages[i].text === bPages[j].text) {
        consumed.add(j);
        aMatched.add(i);
        break;
      }
    }
  }

  const entries: PageDiffEntry[] = [];

  // 2. tur — eşleşmeyen A sayfaları penceredeki en yakın eşlenmemiş B sayfasıyla
  // satır bazlı karşılaştırılır; aday yoksa sayfa SİLİNMİŞTİR.
  for (let i = 0; i < aPages.length; i += 1) {
    if (aMatched.has(i)) continue;
    const partner = candidates(i).find((j) => !consumed.has(j));
    if (partner === undefined) {
      entries.push({
        page: i + 1,
        status: "SILINDI",
        added: [],
        removed: splitLines(aPages[i].text),
        changed: [],
      });
      continue;
    }
    consumed.add(partner);
    const lineDiff = diffLines(aPages[i].text, bPages[partner].text);
    if (lineDiff.added.length === 0 && lineDiff.removed.length === 0 && lineDiff.changed.length === 0) {
      // Birebir eşleşmedi ama satır farkı boş (ör. yalnız baş/son boş satır
      // farkı): değişmemiş sayılır, kayıt üretme.
      continue;
    }
    entries.push({ page: i + 1, status: "DEGISTI", ...lineDiff });
  }

  // 3. tur — hiçbir A sayfasıyla eşlenmeyen B sayfaları EKLENMİŞTİR.
  for (let j = 0; j < bPages.length; j += 1) {
    if (consumed.has(j)) continue;
    entries.push({
      page: j + 1,
      status: "EKLENDI",
      added: splitLines(bPages[j].text),
      removed: [],
      changed: [],
    });
  }

  entries.sort((x, y) => x.page - y.page);

  return {
    pages: entries,
    counts: {
      addedCount: entries.reduce((s, e) => s + e.added.length, 0),
      removedCount: entries.reduce((s, e) => s + e.removed.length, 0),
      changedCount: entries.reduce((s, e) => s + e.changed.length, 0),
    },
    pageCounts: { a: aPages.length, b: bPages.length },
    unchangedPages: aMatched.size,
  };
}

/** Sayfa farkının özet ölçüleri — ContractVersionDiff sayı alanlarının kaynağı. */
export function pagedDiffCounts(diff: PagedDiff): { addedCount: number; removedCount: number; changedCount: number } {
  return diff.counts;
}
