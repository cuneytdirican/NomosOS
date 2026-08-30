/**
 * UYAP "Duruşmalarım / Duruşma Bilgileri" parser'ı.
 * Duruşma tarihi NomosOS ajandasına ve duruşma hazırlık paketine kaynak olur;
 * tarih ayrıştırılamıyorsa kayıt AKTARILMAZ (yanlış ajanda girişi meslek riski doğurur).
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
import { combineDateAndTime, parseDosyaNo, parseTrTemporal } from "../../lib/text";
import type { PageContext, PageSignature, ParseResult, SelectorIssue, UyapParser } from "../../types/parser";
import type { UyapDurusmaKaydi, UyapDurusmaListesi } from "../../types/uyap";

export const SELECTORS_V1 = {
  version: "v1",
  table: [
    'table[id$="durusmaListesiTable"]',
    'table[id*="durusma"]',
    'div[id*="durusma"] table.ui-datatable-data',
    "table.durusma-listesi",
  ],
  dosyaNoIpucu: ['[id$="durusmaDosyaNo"]', ".durusma-dosya-no"],
} as const;

const COLUMNS: ColumnSpecs = {
  dosyaNo: {
    labels: ["Dosya No", "Esas No", "Dosya Numarası"],
    required: false,
    expected: "Dosya numarası sütunu",
  },
  birim: { labels: ["Birim", "Birim Adı", "Mahkeme"], required: false, expected: "Birim sütunu" },
  tarih: {
    labels: ["Duruşma Tarihi", "Tarih", "Duruşma Günü"],
    required: true,
    expected: "Duruşma tarihi sütunu",
  },
  saat: { labels: ["Saat", "Duruşma Saati"], required: false, expected: "Saat sütunu" },
  salon: { labels: ["Salon", "Duruşma Salonu", "Yer"], required: false, expected: "Salon sütunu" },
  tur: {
    labels: ["Duruşma Türü", "Tür", "İşlem Türü", "Duruşma Tipi"],
    required: false,
    expected: "Duruşma türü sütunu",
  },
  aciklama: { labels: ["Açıklama", "Not", "Detay"], required: false, expected: "Açıklama sütunu" },
};

const SIGNATURE: PageSignature = {
  kind: "DURUSMA",
  selectorVersion: SELECTORS_V1.version,
  urlHints: [/durusma/i, /celse/i],
  requiredNodes: [
    {
      field: "durusmaListesiTablosu",
      selectors: [...SELECTORS_V1.table],
      expected: "Duruşma listesi tablosu (ör. table[id$='durusmaListesiTable'])",
    },
  ],
};

export const durusmaParser: UyapParser<UyapDurusmaListesi> = {
  kind: "DURUSMA",
  selectorVersion: SELECTORS_V1.version,

  matches(ctx: PageContext): boolean {
    return queryFirst(ctx.doc, [...SELECTORS_V1.table]) !== null;
  },

  parse(ctx: PageContext): ParseResult<UyapDurusmaListesi> {
    const signature = verifySignature(ctx, SIGNATURE);
    if (!signature.ok) {
      return failure(ctx, SIGNATURE, "PAGE_SIGNATURE_MISMATCH", signatureMessage("DURUSMA"), signature.issues);
    }

    const table = queryFirst(ctx.doc, [...SELECTORS_V1.table]);
    if (!table) {
      return failure(ctx, SIGNATURE, "PAGE_SIGNATURE_MISMATCH", signatureMessage("DURUSMA"), [
        missingField("durusmaListesiTablosu", SELECTORS_V1.table.join(" | "), "Duruşma listesi tablosu"),
      ]);
    }

    const tableSelector = SELECTORS_V1.table[0];
    const columns = resolveColumns(table, tableSelector, COLUMNS);
    if (columns.issues.length > 0) {
      return failure(
        ctx,
        SIGNATURE,
        "REQUIRED_FIELD_MISSING",
        "Duruşma tablosunda duruşma tarihi sütunu bulunamadı.",
        columns.issues,
      );
    }

    const warnings: SelectorIssue[] = [];
    const durusmalar: UyapDurusmaKaydi[] = [];
    const rows = dataRows(table);
    const sayfaDosyaNo = findDosyaNo(ctx, parseDosyaNo, [...SELECTORS_V1.dosyaNoIpucu]);

    for (let i = 0; i < rows.length; i += 1) {
      const cells = cellsOf(rows[i]);
      const scope = `satır ${i + 1}`;

      const tarihText = columnText(cells, columns.index.tarih);
      const saatText = columnText(cells, columns.index.saat);
      const tarih = columns.index.saat >= 0 ? combineDateAndTime(tarihText, saatText) : parseTrTemporal(tarihText);
      if (!tarih) {
        return failure(
          ctx,
          SIGNATURE,
          "UNEXPECTED_STRUCTURE",
          `Duruşma tarihi okunamadı (okunan: "${tarihText ?? ""}"). Ajandaya yanlış tarih yazmamak için aktarım durduruldu.`,
          [missingField("tarih", `${tableSelector} td[${columns.index.tarih}]`, "gg.aa.yyyy [ss:dd] biçiminde tarih", scope)],
        );
      }

      const satirDosyaNo = parseDosyaNo(columnText(cells, columns.index.dosyaNo));

      durusmalar.push({
        dosyaNo: satirDosyaNo?.dosyaNo ?? sayfaDosyaNo,
        birim: columnText(cells, columns.index.birim),
        tarih,
        salon: columnText(cells, columns.index.salon),
        tur: columnText(cells, columns.index.tur),
        aciklama: columnText(cells, columns.index.aciklama),
      });
    }

    if (durusmalar.length === 0) {
      return failure(ctx, SIGNATURE, "EMPTY_RESULT", "Duruşma listesinde kayıt yok.", []);
    }

    if (durusmalar.some((kayit) => kayit.dosyaNo === null)) {
      warnings.push(
        missingField(
          "dosyaNo",
          `${tableSelector} thead th ≈ "Dosya No"`,
          "Duruşmanın ait olduğu dosya numarası (satırda veya sayfada)",
        ),
      );
    }

    return success<UyapDurusmaListesi>(ctx, SIGNATURE, { durusmalar }, warnings);
  },
};
