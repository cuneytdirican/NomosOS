/**
 * UYAP "Safahat" (dosya işlem geçmişi) parser'ı.
 * Safahat kayıtları NomosOS'ta olay akışına (TimelineEvent) ve süre/görev önerilerine
 * kaynak olur; bu yüzden tarih alanı ZORUNLUDUR — ayrıştırılamayan tarih parse'ı düşürür.
 */

import {
  cellsOf,
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
import { parseDosyaNo, parseIntOrNull, parseTrTemporal } from "../../lib/text";
import type { PageContext, PageSignature, ParseResult, SelectorIssue, UyapParser } from "../../types/parser";
import type { UyapSafahatKaydi, UyapSafahatListesi } from "../../types/uyap";

export const SELECTORS_V1 = {
  version: "v1",
  table: [
    'table[id$="safahatTable"]',
    'table[id*="safahat"]',
    'div[id*="safahat"] table.ui-datatable-data',
    "table.safahat-listesi",
  ],
  dosyaNoIpucu: ['[id$="safahatDosyaNo"]', ".safahat-dosya-no"],
} as const;

const COLUMNS: ColumnSpecs = {
  sira: { labels: ["Sıra", "Sıra No", "No"], required: false, expected: "Sıra sütunu" },
  tarih: {
    labels: ["İşlem Tarihi", "Tarih", "Safahat Tarihi", "Kayıt Tarihi"],
    required: true,
    expected: "İşlem tarihi sütunu (gg.aa.yyyy [ss:dd])",
  },
  islem: {
    labels: ["İşlem Türü", "İşlem", "Safahat", "Açıklama/İşlem", "İşlem Adı"],
    required: true,
    expected: "İşlem türü sütunu",
  },
  aciklama: { labels: ["Açıklama", "Detay", "İşlem Açıklaması"], required: false, expected: "Açıklama sütunu" },
  birim: { labels: ["Birim", "Birim Adı", "İşlemi Yapan Birim"], required: false, expected: "Birim sütunu" },
};

const SIGNATURE: PageSignature = {
  kind: "SAFAHAT",
  selectorVersion: SELECTORS_V1.version,
  urlHints: [/safahat/i],
  requiredNodes: [
    {
      field: "safahatTablosu",
      selectors: [...SELECTORS_V1.table],
      expected: "Safahat tablosu (ör. table[id$='safahatTable'])",
    },
  ],
};

export const safahatParser: UyapParser<UyapSafahatListesi> = {
  kind: "SAFAHAT",
  selectorVersion: SELECTORS_V1.version,

  matches(ctx: PageContext): boolean {
    return queryFirst(ctx.doc, [...SELECTORS_V1.table]) !== null;
  },

  parse(ctx: PageContext): ParseResult<UyapSafahatListesi> {
    const signature = verifySignature(ctx, SIGNATURE);
    if (!signature.ok) {
      return failure(ctx, SIGNATURE, "PAGE_SIGNATURE_MISMATCH", signatureMessage("SAFAHAT"), signature.issues);
    }

    const table = queryFirst(ctx.doc, [...SELECTORS_V1.table]);
    if (!table) {
      return failure(ctx, SIGNATURE, "PAGE_SIGNATURE_MISMATCH", signatureMessage("SAFAHAT"), [
        missingField("safahatTablosu", SELECTORS_V1.table.join(" | "), "Safahat tablosu"),
      ]);
    }

    const tableSelector = SELECTORS_V1.table[0];
    const columns = resolveColumns(table, tableSelector, COLUMNS);
    if (columns.issues.length > 0) {
      return failure(
        ctx,
        SIGNATURE,
        "REQUIRED_FIELD_MISSING",
        "Safahat tablosunda zorunlu sütunlar (tarih/işlem) bulunamadı.",
        columns.issues,
      );
    }

    const warnings: SelectorIssue[] = [];
    const kayitlar: UyapSafahatKaydi[] = [];
    const rows = dataRows(table);

    for (let i = 0; i < rows.length; i += 1) {
      const cells = cellsOf(rows[i]);
      const scope = `satır ${i + 1}`;

      const tarihText = columnText(cells, columns.index.tarih);
      const tarih = parseTrTemporal(tarihText);
      if (!tarih) {
        return failure(
          ctx,
          SIGNATURE,
          "UNEXPECTED_STRUCTURE",
          `Safahat tarihi okunamadı (okunan: "${tarihText ?? ""}"). Süre hesabı yanlış olmasın diye aktarım durduruldu.`,
          [missingField("tarih", `${tableSelector} td[${columns.index.tarih}]`, "gg.aa.yyyy [ss:dd] biçiminde tarih", scope)],
        );
      }

      const islem = columnText(cells, columns.index.islem);
      if (!islem) {
        return failure(ctx, SIGNATURE, "REQUIRED_FIELD_MISSING", "Safahat işlem türü okunamadı.", [
          missingField("islem", `${tableSelector} td[${columns.index.islem}]`, "Dolu işlem türü hücresi", scope),
        ]);
      }

      kayitlar.push({
        sira: parseIntOrNull(columnText(cells, columns.index.sira)),
        tarih,
        islem,
        aciklama: columnText(cells, columns.index.aciklama),
        birim: columnText(cells, columns.index.birim),
      });
    }

    if (kayitlar.length === 0) {
      return failure(ctx, SIGNATURE, "EMPTY_RESULT", "Safahat tablosunda kayıt yok.", []);
    }

    const dosyaNo = findDosyaNo(ctx, parseDosyaNo, [...SELECTORS_V1.dosyaNoIpucu]);
    if (!dosyaNo) {
      warnings.push(
        missingField(
          "dosyaNo",
          SELECTORS_V1.dosyaNoIpucu.join(" | "),
          "Safahatın ait olduğu dosya numarası sayfada bulunamadı",
        ),
      );
    }

    return success<UyapSafahatListesi>(ctx, SIGNATURE, { dosyaNo, kayitlar }, warnings);
  },
};
