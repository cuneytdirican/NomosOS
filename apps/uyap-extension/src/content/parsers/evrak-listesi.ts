/**
 * UYAP "Evrak Listesi" parser'ı — indirilebilir evrakların künyesi.
 * İndirme bağlantısı olmayan satırlar (gizli/erişim yok) veri olarak korunur ama
 * indirilemez işaretlenir; uydurma bağlantı ÜRETİLMEZ.
 */

import {
  cellsOf,
  columnLink,
  columnText,
  dataRows,
  failure,
  findDosyaNo,
  missingField,
  queryFirst,
  resolveColumns,
  signatureMessage,
  success,
  verifySignature,
  type ColumnSpecs,
} from "./base";
import {
  fileExtension,
  parseDosyaNo,
  parseSizeToBytes,
  parseTrTemporal,
  readQueryParam,
  toAbsoluteUrl,
} from "../../lib/text";
import type { PageContext, PageSignature, ParseResult, SelectorIssue, UyapParser } from "../../types/parser";
import type { UyapEvrakKaydi, UyapEvrakListesi } from "../../types/uyap";

export const SELECTORS_V1 = {
  version: "v1",
  table: [
    'table[id$="evrakListesiTable"]',
    'table[id*="evrakListesi"]',
    'div[id*="evrak"] table.ui-datatable-data',
    "table.evrak-listesi",
  ],
  /** İndirme bağlantısı adayları (satır içinde aranır). */
  indirLink: [
    'a[href*="evrakId="]',
    "a.evrak-indir",
    'a[href*="indir"]',
    'a[href*="download"]',
    'a[href*="dokuman"]',
  ],
  evrakIdAttributes: ["data-evrakid", "data-evrak-id"],
  dosyaNoIpucu: ['[id$="evrakDosyaNo"]', ".evrak-dosya-no"],
} as const;

const COLUMNS: ColumnSpecs = {
  sira: { labels: ["Sıra", "Sıra No", "No"], required: false, expected: "Sıra sütunu" },
  tur: { labels: ["Evrak Türü", "Tür", "Evrak Tipi"], required: false, expected: "Evrak türü sütunu" },
  ad: {
    // Genel "Evrak"/"Ad" etiketleri bilinçli olarak yok: "Evrak Tarihi" ile karışırdı.
    labels: ["Evrak Adı", "Belge Adı", "Dosya Adı", "Evrak Dosya Adı"],
    required: false,
    expected: "Evrak adı sütunu",
  },
  gonderen: {
    labels: ["Gönderen", "Gönderen Birim", "Ekleyen", "Gönderen/Ekleyen"],
    required: false,
    expected: "Gönderen sütunu",
  },
  tarih: {
    labels: ["Evrak Tarihi", "Tarih", "Kayıt Tarihi", "Gönderim Tarihi"],
    required: true,
    expected: "Evrak tarihi sütunu",
  },
  boyut: { labels: ["Boyut", "Dosya Boyutu"], required: false, expected: "Boyut sütunu" },
  islem: { labels: ["İşlem", "İşlemler", "İndir"], required: false, expected: "İndirme sütunu" },
};

const SIGNATURE: PageSignature = {
  kind: "EVRAK_LISTESI",
  selectorVersion: SELECTORS_V1.version,
  urlHints: [/evrak/i, /dokuman/i],
  requiredNodes: [
    {
      field: "evrakListesiTablosu",
      selectors: [...SELECTORS_V1.table],
      expected: "Evrak listesi tablosu (ör. table[id$='evrakListesiTable'])",
    },
  ],
};

function findRowLink(row: Element, cells: readonly Element[], islemIndex: number): HTMLAnchorElement | null {
  const fromColumn = columnLink(cells, islemIndex);
  if (fromColumn) return fromColumn;
  for (const selector of SELECTORS_V1.indirLink) {
    const link = row.querySelector<HTMLAnchorElement>(selector);
    if (link) return link;
  }
  return null;
}

export const evrakListesiParser: UyapParser<UyapEvrakListesi> = {
  kind: "EVRAK_LISTESI",
  selectorVersion: SELECTORS_V1.version,

  matches(ctx: PageContext): boolean {
    return queryFirst(ctx.doc, [...SELECTORS_V1.table]) !== null;
  },

  parse(ctx: PageContext): ParseResult<UyapEvrakListesi> {
    const signature = verifySignature(ctx, SIGNATURE);
    if (!signature.ok) {
      return failure(ctx, SIGNATURE, "PAGE_SIGNATURE_MISMATCH", signatureMessage("EVRAK_LISTESI"), signature.issues);
    }

    const table = queryFirst(ctx.doc, [...SELECTORS_V1.table]);
    if (!table) {
      return failure(ctx, SIGNATURE, "PAGE_SIGNATURE_MISMATCH", signatureMessage("EVRAK_LISTESI"), [
        missingField("evrakListesiTablosu", SELECTORS_V1.table.join(" | "), "Evrak listesi tablosu"),
      ]);
    }

    const tableSelector = SELECTORS_V1.table[0];
    const columns = resolveColumns(table, tableSelector, COLUMNS);
    if (columns.issues.length > 0) {
      return failure(
        ctx,
        SIGNATURE,
        "REQUIRED_FIELD_MISSING",
        "Evrak listesi tablosunda evrak tarihi sütunu bulunamadı.",
        columns.issues,
      );
    }

    // Ad ve tür sütunlarının en az biri bulunmalı; ikisi de yoksa evrak kimliklenemez.
    if (columns.index.ad < 0 && columns.index.tur < 0) {
      return failure(ctx, SIGNATURE, "REQUIRED_FIELD_MISSING", "Evrak listesinde ne evrak adı ne de evrak türü sütunu var.", [
        missingField("ad|tur", `${tableSelector} thead th`, "Evrak adı veya evrak türü sütunlarından en az biri"),
      ]);
    }

    const warnings: SelectorIssue[] = [];
    const evraklar: UyapEvrakKaydi[] = [];
    const rows = dataRows(table);

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const cells = cellsOf(row);
      const scope = `satır ${i + 1}`;

      const tarihText = columnText(cells, columns.index.tarih);
      const tarih = parseTrTemporal(tarihText);
      if (!tarihText) {
        // Evrak tarihi Modül 06 hattına yalnızca İPUCU olarak gider (süre hesabına değil),
        // bu yüzden boş hücre parse'ı düşürmez; ancak sessiz de geçmez (denetim bulgusu 14):
        // kayıt `warnings` içinde görünür ve popup'ta izlenebilir.
        warnings.push(
          missingField("tarih", `${tableSelector} td[${columns.index.tarih}]`, "Evrak tarihi hücresi boş", scope),
        );
      }
      if (tarihText && !tarih) {
        return failure(
          ctx,
          SIGNATURE,
          "UNEXPECTED_STRUCTURE",
          `Evrak tarihi okunamadı (okunan: "${tarihText}").`,
          [missingField("tarih", `${tableSelector} td[${columns.index.tarih}]`, "gg.aa.yyyy biçiminde tarih", scope)],
        );
      }

      const ad = columnText(cells, columns.index.ad);
      const tur = columnText(cells, columns.index.tur);
      if (!ad && !tur) {
        return failure(ctx, SIGNATURE, "REQUIRED_FIELD_MISSING", "Evrak satırında ad ve tür birlikte boş.", [
          missingField("ad|tur", tableSelector, "Evrak adı veya türü dolu olmalı", scope),
        ]);
      }

      const link = findRowLink(row, cells, columns.index.islem);
      const href = link?.getAttribute("href") ?? null;
      const indirmeUrl = toAbsoluteUrl(href, ctx.url);
      if (!indirmeUrl) {
        warnings.push(
          missingField("indirmeUrl", SELECTORS_V1.indirLink.join(" | "), "Evrak indirme bağlantısı", scope),
        );
      }

      let evrakId: string | null = null;
      for (const attribute of SELECTORS_V1.evrakIdAttributes) {
        evrakId = row.getAttribute(attribute) ?? link?.getAttribute(attribute) ?? evrakId;
      }
      if (!evrakId && href) evrakId = readQueryParam(href, "evrakId", ctx.url);

      evraklar.push({
        evrakId,
        ad,
        tur,
        tarih,
        gonderen: columnText(cells, columns.index.gonderen),
        boyutBytes: parseSizeToBytes(columnText(cells, columns.index.boyut)),
        indirmeUrl,
        uzanti: fileExtension(ad) ?? (href ? fileExtension(href) : null),
      });
    }

    if (evraklar.length === 0) {
      return failure(ctx, SIGNATURE, "EMPTY_RESULT", "Evrak listesinde kayıt yok.", []);
    }

    const dosyaNo = findDosyaNo(ctx, parseDosyaNo, [...SELECTORS_V1.dosyaNoIpucu]);
    if (!dosyaNo) {
      warnings.push(
        missingField("dosyaNo", SELECTORS_V1.dosyaNoIpucu.join(" | "), "Evrakların ait olduğu dosya numarası"),
      );
    }

    return success<UyapEvrakListesi>(ctx, SIGNATURE, { dosyaNo, evraklar }, warnings);
  },
};
