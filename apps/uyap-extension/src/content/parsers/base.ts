/**
 * Parser altyapısı — sürümlü selector katmanının ortak çekirdeği.
 *
 * DAYANIKLILIK STRATEJİSİ
 * 1. Her parser selector'larını tek bir sabit nesnede toplar (SELECTORS_V1).
 * 2. `parse()` çağrılmadan ÖNCE sayfa imzası doğrulanır; beklenen yapı yoksa parse
 *    HİÇ denenmez ve açık hata döner (PAGE_SIGNATURE_MISMATCH).
 * 3. Tablo sütunları sabit indeksle değil, BAŞLIK METNİYLE bulunur (Türkçe duyarsız
 *    normalizasyon + eşanlamlı etiket listesi). UYAP sütun sırası değişse bile veri
 *    doğru okunur.
 * 4. Zorunlu bir alan okunamazsa satır sessizce atlanmaz — parse başarısız olur ve
 *    KIRILAN SELECTOR raporlanır. Sessiz yanlış veri asla üretilmez.
 * 5. Zorunlu olmayan alanlar okunamazsa sonuç `warnings` ile döner; veri güvenilirdir.
 */

import { cleanText, normalizeTr } from "../../lib/text";
import type {
  PageContext,
  PageSignature,
  ParseError,
  ParseFailure,
  ParseFailureCode,
  ParseSuccess,
  SelectorIssue,
} from "../../types/parser";
import type { UyapPageKind } from "../../types/uyap";

/** Bir seçici listesindeki ilk eşleşen düğümü döndürür. */
export function queryFirst(root: ParentNode, selectors: readonly string[]): Element | null {
  for (const selector of selectors) {
    const found = root.querySelector(selector);
    if (found) return found;
  }
  return null;
}

/** Bir seçici listesindeki ilk eşleşen selector'ın TÜM düğümlerini döndürür. */
export function queryAll(root: ParentNode, selectors: readonly string[]): Element[] {
  for (const selector of selectors) {
    const found = Array.from(root.querySelectorAll(selector));
    if (found.length > 0) return found;
  }
  return [];
}

/** Düğüm metni (boşluk temizlenmiş). */
export function textOf(node: Element | null | undefined): string {
  return cleanText(node?.textContent ?? "");
}

/**
 * Sayfa imzasını doğrular.
 * DOM yapısı asıl imzadır; URL yalnızca ipucudur (UYAP tek sayfa uygulaması gibi
 * davranabildiğinden adres her zaman güvenilir değildir).
 */
export function verifySignature(
  ctx: PageContext,
  signature: PageSignature,
): { readonly ok: boolean; readonly issues: SelectorIssue[] } {
  const issues: SelectorIssue[] = [];
  for (const node of signature.requiredNodes) {
    const min = node.min ?? 1;
    const found = queryAll(ctx.doc, node.selectors);
    if (found.length < min) {
      issues.push({
        field: node.field,
        selector: node.selectors.join(" | "),
        expected: node.expected,
      });
    }
  }
  return { ok: issues.length === 0, issues };
}

/** URL ipuçlarından en az biri tutuyor mu? */
export function urlHintMatches(url: string, signature: PageSignature): boolean {
  if (signature.urlHints.length === 0) return true;
  return signature.urlHints.some((pattern) => pattern.test(url));
}

export function success<T>(
  ctx: PageContext,
  signature: PageSignature,
  data: T,
  warnings: SelectorIssue[] = [],
): ParseSuccess<T> {
  return {
    ok: true,
    kind: signature.kind,
    selectorVersion: signature.selectorVersion,
    url: ctx.url,
    parsedAt: new Date().toISOString(),
    data,
    warnings,
  };
}

export function failure(
  ctx: PageContext,
  signature: PageSignature,
  code: ParseFailureCode,
  message: string,
  issues: readonly SelectorIssue[],
): ParseError {
  return {
    ok: false,
    kind: signature.kind,
    selectorVersion: signature.selectorVersion,
    url: ctx.url,
    parsedAt: new Date().toISOString(),
    failure: { code, message, issues },
  };
}

/** Sayfa imzası tutmadığında kullanılan standart Türkçe mesaj. */
export function signatureMessage(kind: UyapPageKind): string {
  return `UYAP ${kind} sayfası beklenen yapıda değil. Sayfa düzeni değişmiş olabilir; yanlış veri aktarmamak için okuma yapılmadı.`;
}

/* ------------------------------------------------------------------ */
/* Tablo yardımcıları                                                  */
/* ------------------------------------------------------------------ */

export interface ColumnSpec {
  /** Kabul edilen başlık metinleri (Türkçe duyarsız karşılaştırılır). */
  readonly labels: readonly string[];
  readonly required: boolean;
  readonly expected: string;
}

export type ColumnSpecs = Readonly<Record<string, ColumnSpec>>;

export interface ColumnResolution {
  /** Alan adı → sütun indeksi. Bulunamayan alanlar için -1. */
  readonly index: Readonly<Record<string, number>>;
  readonly issues: readonly SelectorIssue[];
}

/** Tablonun başlık satırını bulur (thead varsa oradan, yoksa th içeren ilk satır). */
export function headerRow(table: Element): Element | null {
  const theadRows = Array.from(table.querySelectorAll("thead tr"));
  if (theadRows.length > 0) {
    // Çok satırlı başlıkta sütun adları en alt satırdadır.
    return theadRows[theadRows.length - 1];
  }
  const rows = Array.from(table.querySelectorAll("tr"));
  return rows.find((row) => row.querySelector("th") !== null) ?? null;
}

/** Satırın hücreleri (th ve td birlikte). */
export function cellsOf(row: Element): Element[] {
  return Array.from(row.querySelectorAll(":scope > th, :scope > td"));
}

/**
 * Sütunları BAŞLIK METNİNDEN çözer — sabit indeks kullanılmaz.
 * UYAP sütun ekler/yerini değiştirirse parser çalışmaya devam eder.
 */
export function resolveColumns(
  table: Element,
  tableSelector: string,
  specs: ColumnSpecs,
): ColumnResolution {
  const issues: SelectorIssue[] = [];
  const index: Record<string, number> = {};

  const header = headerRow(table);
  if (!header) {
    for (const field of Object.keys(specs)) index[field] = -1;
    issues.push({
      field: "baslikSatiri",
      selector: `${tableSelector} thead tr`,
      expected: "Tablonun başlık satırı bulunamadı.",
    });
    return { index, issues };
  }

  const headers = cellsOf(header).map((cell) => normalizeTr(textOf(cell)));
  const entries = Object.entries(specs);

  /**
   * İKİ AŞAMALI ÇÖZÜM (denetim bulgusu 13).
   *
   * Eskiden her alan bağımsız çözülüyordu ve İKİ ALANIN AYNI SÜTUNA düşmesi hiç
   * denetlenmiyordu: ör. safahat'ta ayrı bir "İşlem Türü" sütunu yoksa "İşlem" etiketi
   * "İşlem Açıklaması" başlığına tolerans yoluyla eşleşiyor, `islem` ile `aciklama`
   * AYNI hücreden okunuyordu — açık hata değil, SESSİZ YANLIŞ ALAN.
   *
   * Yeni davranış: önce tam eşleşmeler bağlanır (sütunu "sahiplenir"), sonra kalan
   * alanlar yalnızca SAHİPSİZ sütunlarda tolerans arar. Sahipli bir sütuna düşen
   * zorunlu alan çözülemez sayılır → REQUIRED_FIELD_MISSING (fail-closed).
   */
  const owner = new Map<number, string>();
  const pending: Array<[string, ColumnSpec, readonly string[]]> = [];

  // 1) Tam eşleşmeler
  for (const [field, spec] of entries) {
    const normalizedLabels = spec.labels.map((label) => normalizeTr(label));
    const exact = headers.findIndex((headerText) =>
      normalizedLabels.some((label) => headerText === label),
    );
    if (exact >= 0 && !owner.has(exact)) {
      owner.set(exact, field);
      index[field] = exact;
      continue;
    }
    index[field] = -1;
    pending.push([field, spec, normalizedLabels]);
  }

  // 2) "İçerir" toleransı — yalnızca sahipsiz sütunlarda.
  // Eşik bilinçlidir: kısa etiketler (ör. "tür") toleransa GİRMEZ, aksi halde
  // "Dosya Türü" ile "Dosya Durumu" gibi sütunlar birbirine karışırdı.
  for (const [field, , normalizedLabels] of pending) {
    const found = headers.findIndex(
      (headerText, columnIndex) =>
        !owner.has(columnIndex) &&
        normalizedLabels.some(
          (label) =>
            label.length >= 5 &&
            headerText.length >= 4 &&
            (headerText.includes(label) || label.includes(headerText)),
        ),
    );
    if (found >= 0) {
      owner.set(found, field);
      index[field] = found;
    }
  }

  for (const [field, spec] of entries) {
    if (index[field] < 0 && spec.required) {
      issues.push({
        field,
        selector: `${tableSelector} thead th ≈ "${spec.labels.join(" | ")}"`,
        expected: spec.expected,
      });
    }
  }

  return { index, issues };
}

/** Veri satırları (başlık ve "kayıt bulunamadı" satırları hariç). */
export function dataRows(table: Element): Element[] {
  const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
  const rows = bodyRows.length > 0 ? bodyRows : Array.from(table.querySelectorAll("tr"));
  return rows.filter((row) => {
    if (row.querySelector(":scope > th") && !row.querySelector(":scope > td")) return false;
    const cells = cellsOf(row);
    if (cells.length === 0) return false;
    // PrimeFaces "kayıt yok" satırı tek hücreli olur.
    if (cells.length === 1) {
      const normalized = normalizeTr(textOf(cells[0]));
      if (
        normalized.includes("kayit bulunamadi") ||
        normalized.includes("kayit yok") ||
        normalized.includes("sonuc bulunamadi") ||
        normalized === ""
      ) {
        return false;
      }
    }
    return true;
  });
}

/** Belirli sütunun metni; sütun yoksa null. */
export function columnText(cells: readonly Element[], columnIndex: number): string | null {
  if (columnIndex < 0 || columnIndex >= cells.length) return null;
  const value = textOf(cells[columnIndex]);
  return value.length > 0 ? value : null;
}

/** Belirli sütundaki ilk bağlantı. */
export function columnLink(cells: readonly Element[], columnIndex: number): HTMLAnchorElement | null {
  if (columnIndex < 0 || columnIndex >= cells.length) return null;
  return cells[columnIndex].querySelector<HTMLAnchorElement>("a[href]");
}

/**
 * Etiket-değer düzenindeki bilgi panellerini okur.
 * "Dosya No" → "2026/145" biçiminde normalize edilmiş anahtarlarla Map döner.
 */
export function readLabelValueMap(
  root: ParentNode,
  rowSelectors: readonly string[],
  labelSelectors: readonly string[],
  valueSelectors: readonly string[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of queryAll(root, rowSelectors)) {
    const labelNode = queryFirst(row, labelSelectors);
    const valueNode = queryFirst(row, valueSelectors);
    if (!labelNode || !valueNode) continue;
    const key = normalizeTr(textOf(labelNode).replace(/[:：]\s*$/, ""));
    const value = textOf(valueNode);
    if (key && value && !map.has(key)) map.set(key, value);
  }
  return map;
}

/** Etiket-değer haritasından eşanlamlı etiketlerle değer okur. */
export function labelValue(map: Map<string, string>, labels: readonly string[]): string | null {
  for (const label of labels) {
    const key = normalizeTr(label);
    const direct = map.get(key);
    if (direct) return direct;
  }
  // Tolerans eşiği: kısa etiketler yanlış alanla eşleşmesin diye en az 5 karakter.
  for (const label of labels) {
    const key = normalizeTr(label);
    if (key.length < 5) continue;
    for (const [mapKey, value] of map) {
      if (mapKey.length >= 4 && (mapKey.includes(key) || key.includes(mapKey))) return value;
    }
  }
  return null;
}

/**
 * Sayfada ilgili dosya numarasını arar (safahat/evrak/duruşma sayfalarında bağlam gerekir).
 * Sıra: özel öznitelikler → künye alanları → URL parametresi. Bulunamazsa null döner
 * (tahmin YAPILMAZ; çağıran aktarımı durdurur).
 */
export const DOSYA_NO_HINT_SELECTORS = [
  "[data-dosyano]",
  "[data-dosya-no]",
  '[id$="dosyaNoOutput"]',
  ".dosya-no",
  "table.dosya-bilgi-tablo",
  '[id$="dosyaBilgileriPanel"]',
  "h1.dosya-baslik",
  ".dosya-baslik",
] as const;

export function findDosyaNo(
  ctx: PageContext,
  parse: (input: string | null | undefined) => { dosyaNo: string } | null,
  extraSelectors: readonly string[] = [],
): string | null {
  for (const selector of [...extraSelectors, ...DOSYA_NO_HINT_SELECTORS]) {
    const node = ctx.doc.querySelector(selector);
    if (!node) continue;
    const attribute = node.getAttribute("data-dosyano") ?? node.getAttribute("data-dosya-no");
    const fromAttribute = parse(attribute);
    if (fromAttribute) return fromAttribute.dosyaNo;
    const fromText = parse(textOf(node));
    if (fromText) return fromText.dosyaNo;
  }
  try {
    const url = new URL(ctx.url, "https://avukat.uyap.gov.tr/");
    const fromQuery = parse(url.searchParams.get("dosyaNo"));
    if (fromQuery) return fromQuery.dosyaNo;
  } catch {
    /* geçersiz URL — yok say */
  }
  return null;
}

/** Zorunlu alan raporu üretir. */
export function missingField(
  field: string,
  selector: string,
  expected: string,
  scope?: string,
): SelectorIssue {
  return scope ? { field, selector, expected, scope } : { field, selector, expected };
}

/** Kırılan alanları tek Türkçe cümlede özetler (popup ve log için). */
export function describeIssues(failureInfo: ParseFailure): string {
  if (failureInfo.issues.length === 0) return failureInfo.message;
  const fields = failureInfo.issues.map((issue) => issue.field).join(", ");
  return `${failureInfo.message} Kırılan alanlar: ${fields}.`;
}
