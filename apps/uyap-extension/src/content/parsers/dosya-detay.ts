/**
 * UYAP "Dosya Detay" sayfası parser'ı — dosya künyesi + taraflar.
 */

import {
  cellsOf,
  columnText,
  dataRows,
  failure,
  labelValue,
  missingField,
  queryFirst,
  readLabelValueMap,
  resolveColumns,
  signatureMessage,
  success,
  verifySignature,
  type ColumnSpecs,
} from "./base";
import { parseDosyaNo, parseIntOrNull, parseTrDate, readQueryParam } from "../../lib/text";
import type { PageContext, PageSignature, ParseResult, SelectorIssue, UyapParser } from "../../types/parser";
import type { UyapDosyaDetay, UyapTaraf } from "../../types/uyap";

export const SELECTORS_V1 = {
  version: "v1",
  /** Dosya künyesi paneli. */
  bilgiPanel: [
    '[id$="dosyaBilgileriPanel"]',
    "table.dosya-bilgi-tablo",
    '[id*="dosyaDetay"] .ui-panel-content',
    ".dosya-detay-bilgi",
  ],
  /** Künye satırları (etiket-değer çiftleri). */
  bilgiSatir: [
    "table.dosya-bilgi-tablo tr",
    '[id$="dosyaBilgileriPanel"] tr',
    ".dosya-bilgi-satir",
    "dl.dosya-bilgi > div",
  ],
  bilgiEtiket: [".etiket", "th", "dt", "td:first-child"],
  bilgiDeger: [".deger", "dd", "td:nth-child(2)"],
  /** Taraflar tablosu. */
  taraflarTable: ['table[id$="taraflarTable"]', 'table[id*="taraf"]', "table.taraf-listesi"],
  /** Gizli alandaki UYAP dosya kimliği. */
  dosyaIdInput: ['input[id$="dosyaId"]', "[data-dosyaid]"],
} as const;

const TARAF_COLUMNS: ColumnSpecs = {
  sira: { labels: ["Sıra", "Sıra No", "No"], required: false, expected: "Sıra sütunu" },
  rol: {
    labels: ["Taraf Sıfatı", "Sıfat", "Taraf Rolü", "Rol", "Taraf Türü"],
    required: true,
    expected: "Taraf sıfatı sütunu (Davacı/Davalı/Alacaklı/Borçlu…)",
  },
  ad: {
    labels: ["Adı Soyadı / Ünvanı", "Adı Soyadı", "Ad Soyad", "Adı/Ünvanı", "Taraf Adı", "Ünvan"],
    required: true,
    expected: "Taraf ad/ünvan sütunu",
  },
  vekil: { labels: ["Vekili", "Vekil", "Vekil/Temsilci"], required: false, expected: "Vekil sütunu" },
};

const LABELS = {
  birim: ["Birim Adı", "Birim", "Mahkeme", "Yargı Birimi"],
  dosyaNo: ["Dosya No", "Dosya Numarası", "Esas No", "Esas Numarası"],
  dosyaTuru: ["Dosya Türü", "Dosya Tipi"],
  acilisTarihi: ["Açılış Tarihi", "Dosya Açılış Tarihi"],
  durum: ["Dosya Durumu", "Durum"],
  konu: ["Dava Konusu", "Konu", "Takip Türü", "Dava Türü"],
  gorevli: ["Hâkim", "Hakim", "İcra Müdürü", "Görevli"],
} as const;

const SIGNATURE: PageSignature = {
  kind: "DOSYA_DETAY",
  selectorVersion: SELECTORS_V1.version,
  urlHints: [/dosya[_-]?detay/i, /dosyaId=/i, /dosya[_-]?goruntule/i],
  requiredNodes: [
    {
      field: "dosyaBilgiPaneli",
      selectors: [...SELECTORS_V1.bilgiPanel],
      expected: "Dosya künyesi paneli",
    },
    {
      field: "taraflarTablosu",
      selectors: [...SELECTORS_V1.taraflarTable],
      expected: "Taraflar tablosu",
    },
  ],
};

export const dosyaDetayParser: UyapParser<UyapDosyaDetay> = {
  kind: "DOSYA_DETAY",
  selectorVersion: SELECTORS_V1.version,

  matches(ctx: PageContext): boolean {
    const hasPanel = queryFirst(ctx.doc, [...SELECTORS_V1.bilgiPanel]) !== null;
    const hasTaraf = queryFirst(ctx.doc, [...SELECTORS_V1.taraflarTable]) !== null;
    return hasPanel && hasTaraf;
  },

  parse(ctx: PageContext): ParseResult<UyapDosyaDetay> {
    const signature = verifySignature(ctx, SIGNATURE);
    if (!signature.ok) {
      return failure(ctx, SIGNATURE, "PAGE_SIGNATURE_MISMATCH", signatureMessage("DOSYA_DETAY"), signature.issues);
    }

    const info = readLabelValueMap(
      ctx.doc,
      [...SELECTORS_V1.bilgiSatir],
      [...SELECTORS_V1.bilgiEtiket],
      [...SELECTORS_V1.bilgiDeger],
    );

    if (info.size === 0) {
      return failure(ctx, SIGNATURE, "REQUIRED_FIELD_MISSING", "Dosya künyesi okunamadı (etiket-değer satırları bulunamadı).", [
        missingField("bilgiSatir", SELECTORS_V1.bilgiSatir.join(" | "), "Etiket-değer satırları"),
      ]);
    }

    const warnings: SelectorIssue[] = [];

    const birim = labelValue(info, LABELS.birim);
    if (!birim) {
      return failure(ctx, SIGNATURE, "REQUIRED_FIELD_MISSING", "Dosya detayında birim adı bulunamadı.", [
        missingField("birim", `künye etiketi ≈ "${LABELS.birim.join(" | ")}"`, "Birim/mahkeme adı"),
      ]);
    }

    const dosyaNoText = labelValue(info, LABELS.dosyaNo);
    const dosyaNo = parseDosyaNo(dosyaNoText);
    if (!dosyaNo) {
      return failure(
        ctx,
        SIGNATURE,
        "UNEXPECTED_STRUCTURE",
        `Dosya detayında dosya numarası beklenen biçimde değil (okunan: "${dosyaNoText ?? ""}").`,
        [missingField("dosyaNo", `künye etiketi ≈ "${LABELS.dosyaNo.join(" | ")}"`, "YYYY/NNN biçiminde dosya numarası")],
      );
    }

    const acilisText = labelValue(info, LABELS.acilisTarihi);
    const acilisTarihi = parseTrDate(acilisText);
    if (acilisText && !acilisTarihi) {
      warnings.push(missingField("acilisTarihi", "künye: Açılış Tarihi", "gg.aa.yyyy biçiminde tarih"));
    }

    /* --- Taraflar --- */
    const taraflarTable = queryFirst(ctx.doc, [...SELECTORS_V1.taraflarTable]);
    if (!taraflarTable) {
      return failure(ctx, SIGNATURE, "PAGE_SIGNATURE_MISMATCH", signatureMessage("DOSYA_DETAY"), [
        missingField("taraflarTablosu", SELECTORS_V1.taraflarTable.join(" | "), "Taraflar tablosu"),
      ]);
    }

    const tableSelector = SELECTORS_V1.taraflarTable[0];
    const columns = resolveColumns(taraflarTable, tableSelector, TARAF_COLUMNS);
    if (columns.issues.length > 0) {
      return failure(
        ctx,
        SIGNATURE,
        "REQUIRED_FIELD_MISSING",
        "Taraflar tablosunda zorunlu sütunlar bulunamadı.",
        columns.issues,
      );
    }

    const taraflar: UyapTaraf[] = [];
    const rows = dataRows(taraflarTable);
    for (let i = 0; i < rows.length; i += 1) {
      const cells = cellsOf(rows[i]);
      const scope = `taraf satırı ${i + 1}`;
      const rol = columnText(cells, columns.index.rol);
      const ad = columnText(cells, columns.index.ad);
      if (!rol || !ad) {
        return failure(ctx, SIGNATURE, "REQUIRED_FIELD_MISSING", "Taraf satırında sıfat veya ad okunamadı.", [
          missingField(!rol ? "tarafRol" : "tarafAd", tableSelector, "Dolu taraf sıfatı ve ad hücresi", scope),
        ]);
      }
      taraflar.push({
        rol,
        ad,
        vekil: columnText(cells, columns.index.vekil),
        sira: parseIntOrNull(columnText(cells, columns.index.sira)),
      });
    }

    if (taraflar.length === 0) {
      warnings.push(missingField("taraflar", tableSelector, "En az bir taraf satırı"));
    }

    const idInput = queryFirst(ctx.doc, [...SELECTORS_V1.dosyaIdInput]);
    const uyapDosyaId =
      readQueryParam(ctx.url, "dosyaId") ??
      idInput?.getAttribute("value") ??
      idInput?.getAttribute("data-dosyaid") ??
      null;

    const detay: UyapDosyaDetay = {
      uyapDosyaId,
      dosyaNo: dosyaNo.dosyaNo,
      yil: dosyaNo.yil,
      sira: dosyaNo.sira,
      birim,
      dosyaTuru: labelValue(info, LABELS.dosyaTuru),
      durum: labelValue(info, LABELS.durum),
      acilisTarihi,
      detayUrl: ctx.url,
      konu: labelValue(info, LABELS.konu),
      gorevli: labelValue(info, LABELS.gorevli),
      taraflar,
    };

    return success<UyapDosyaDetay>(ctx, SIGNATURE, detay, warnings);
  },
};
