/**
 * UYAP "Dosya Sorgulama / Dosyalarım" listesi parser'ı.
 * Selector seti sürümlüdür: UYAP arayüzü değişince SELECTORS_V2 eklenir, V1 korunur.
 */

import {
  columnLink,
  columnText,
  cellsOf,
  dataRows,
  failure,
  missingField,
  queryFirst,
  resolveColumns,
  signatureMessage,
  success,
  textOf,
  verifySignature,
  type ColumnSpecs,
} from "./base";
import { parseDosyaNo, parseIntOrNull, parseTrDate, readQueryParam, toAbsoluteUrl } from "../../lib/text";
import type { PageContext, PageSignature, ParseResult, SelectorIssue, UyapParser } from "../../types/parser";
import type { UyapDosyaListesi, UyapDosyaOzeti } from "../../types/uyap";

export const SELECTORS_V1 = {
  version: "v1",
  /** Liste tablosu — sırayla denenir, ilk eşleşen kullanılır. */
  table: [
    'table[id$="dosyaListesiTable"]',
    'table[id*="dosyaListesi"]',
    'table[id*="dosyaSorgulaSonuc"]',
    // Dar kapsamlı tutulur: "dosya" kelimesini içeren HER kapsayıcı eşleşseydi
    // dosya DETAY sayfasındaki taraflar tablosu da liste sanılırdı.
    'div[id*="dosyaSorgula"] table.ui-datatable-data',
    'div[id*="dosyalarim"] table.ui-datatable-data',
    "table.dosya-listesi",
  ],
  /** Toplam kayıt bilgisini taşıyan alan (opsiyonel). */
  toplamKayit: [".ui-paginator-current", ".toplam-kayit", "[data-toplam-kayit]"],
  /** Satırda UYAP dosya kimliğini taşıyabilecek öznitelikler. */
  rowIdAttributes: ["data-dosyaid", "data-dosya-id", "data-rowkey", "data-rk"],
  /** Detay bağlantısı. */
  detayLink: ['a[href*="dosyaId="]', 'a[href*="dosyaDetay"]', "a.dosya-detay", "a[href]"],
} as const;

const COLUMNS: ColumnSpecs = {
  birim: {
    labels: ["Birim", "Birim Adı", "Mahkeme", "Yargı Birimi", "Birim/Mahkeme", "Daire"],
    required: true,
    expected: "Yargı birimi/mahkeme adı sütunu",
  },
  dosyaNo: {
    // Dikkat: yalnız "Dosya" gibi çok genel bir etiket EKLENMEZ — "Dosya Türü"
    // sütunuyla karışır ve yanlış sütundan veri okunurdu.
    labels: ["Dosya No", "Dosya Numarası", "Esas No", "Esas Numarası"],
    required: true,
    expected: "Dosya/esas numarası sütunu (ör. 2026/145)",
  },
  dosyaTuru: {
    labels: ["Dosya Türü", "Tür", "Dosya Tipi"],
    required: false,
    expected: "Dosya türü sütunu",
  },
  acilisTarihi: {
    labels: ["Açılış Tarihi", "Açılış", "Dosya Açılış Tarihi"],
    required: false,
    expected: "Açılış tarihi sütunu",
  },
  durum: {
    labels: ["Dosya Durumu", "Durum"],
    required: false,
    expected: "Dosya durumu sütunu",
  },
};

const SIGNATURE: PageSignature = {
  kind: "DOSYA_LISTESI",
  selectorVersion: SELECTORS_V1.version,
  urlHints: [/dosya[_-]?sorgula/i, /dosyalarim/i, /dosya[_-]?listesi/i],
  requiredNodes: [
    {
      field: "dosyaListesiTablosu",
      selectors: [...SELECTORS_V1.table],
      expected: "Dosya listesi tablosu (ör. table[id$='dosyaListesiTable'])",
    },
  ],
};

function readRowId(row: Element): string | null {
  for (const attribute of SELECTORS_V1.rowIdAttributes) {
    const value = row.getAttribute(attribute);
    if (value && value.trim()) return value.trim();
  }
  return null;
}

function parseTotal(ctx: PageContext): number | null {
  const node = queryFirst(ctx.doc, [...SELECTORS_V1.toplamKayit]);
  if (!node) return null;
  const attribute = node.getAttribute("data-toplam-kayit");
  if (attribute) return parseIntOrNull(attribute);
  // "1 - 10 / 24" biçiminde son sayı toplam kayıttır.
  const numbers = textOf(node).match(/\d+/g);
  if (!numbers || numbers.length === 0) return null;
  return parseIntOrNull(numbers[numbers.length - 1]);
}

export const dosyaListesiParser: UyapParser<UyapDosyaListesi> = {
  kind: "DOSYA_LISTESI",
  selectorVersion: SELECTORS_V1.version,

  // Ön eleme DOM tabanlıdır: yalnız URL ipucuna güvenip parse denemeyiz, aksi halde
  // ilgisiz sayfalarda sahte "parser kırıldı" alarmı üretirdik.
  matches(ctx: PageContext): boolean {
    return queryFirst(ctx.doc, [...SELECTORS_V1.table]) !== null;
  },

  parse(ctx: PageContext): ParseResult<UyapDosyaListesi> {
    const signature = verifySignature(ctx, SIGNATURE);
    if (!signature.ok) {
      return failure(ctx, SIGNATURE, "PAGE_SIGNATURE_MISMATCH", signatureMessage("DOSYA_LISTESI"), signature.issues);
    }

    const table = queryFirst(ctx.doc, [...SELECTORS_V1.table]);
    if (!table) {
      return failure(ctx, SIGNATURE, "PAGE_SIGNATURE_MISMATCH", signatureMessage("DOSYA_LISTESI"), [
        missingField("dosyaListesiTablosu", SELECTORS_V1.table.join(" | "), "Dosya listesi tablosu"),
      ]);
    }

    const tableSelector = SELECTORS_V1.table[0];
    const columns = resolveColumns(table, tableSelector, COLUMNS);
    if (columns.issues.length > 0) {
      return failure(
        ctx,
        SIGNATURE,
        "REQUIRED_FIELD_MISSING",
        "Dosya listesi tablosunda zorunlu sütunlar bulunamadı. UYAP sütun düzeni değişmiş olabilir.",
        columns.issues,
      );
    }

    const warnings: SelectorIssue[] = [];
    const rows = dataRows(table);
    const dosyalar: UyapDosyaOzeti[] = [];

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const scope = `satır ${i + 1}`;
      const cells = cellsOf(row);

      const birim = columnText(cells, columns.index.birim);
      if (!birim) {
        return failure(ctx, SIGNATURE, "REQUIRED_FIELD_MISSING", "Dosya listesinde birim adı okunamadı.", [
          missingField("birim", `${tableSelector} td[${columns.index.birim}]`, "Dolu birim/mahkeme hücresi", scope),
        ]);
      }

      const dosyaNoText = columnText(cells, columns.index.dosyaNo);
      const dosyaNo = parseDosyaNo(dosyaNoText);
      if (!dosyaNo) {
        return failure(
          ctx,
          SIGNATURE,
          "UNEXPECTED_STRUCTURE",
          `Dosya numarası beklenen biçimde değil (okunan: "${dosyaNoText ?? ""}"). Yanlış dosyaya veri yazmamak için aktarım durduruldu.`,
          [missingField("dosyaNo", `${tableSelector} td[${columns.index.dosyaNo}]`, "YYYY/NNN biçiminde dosya numarası", scope)],
        );
      }

      const acilisText = columnText(cells, columns.index.acilisTarihi);
      const acilisTarihi = parseTrDate(acilisText);
      if (acilisText && !acilisTarihi) {
        warnings.push(
          missingField("acilisTarihi", `${tableSelector} td[${columns.index.acilisTarihi}]`, "gg.aa.yyyy biçiminde tarih", scope),
        );
      }

      const link = columnLink(cells, columns.index.dosyaNo) ?? row.querySelector<HTMLAnchorElement>('a[href*="dosyaId="]');
      const href = link?.getAttribute("href") ?? null;
      const detayUrl = toAbsoluteUrl(href, ctx.url);
      const uyapDosyaId = readRowId(row) ?? (href ? readQueryParam(href, "dosyaId", ctx.url) : null);

      dosyalar.push({
        uyapDosyaId,
        dosyaNo: dosyaNo.dosyaNo,
        yil: dosyaNo.yil,
        sira: dosyaNo.sira,
        birim,
        dosyaTuru: columnText(cells, columns.index.dosyaTuru),
        durum: columnText(cells, columns.index.durum),
        acilisTarihi,
        detayUrl,
      });
    }

    if (dosyalar.length === 0) {
      return failure(ctx, SIGNATURE, "EMPTY_RESULT", "Dosya listesi tablosunda kayıt yok.", []);
    }

    return success<UyapDosyaListesi>(ctx, SIGNATURE, { dosyalar, toplamKayit: parseTotal(ctx) }, warnings);
  },
};
