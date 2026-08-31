/**
 * CSV üretimi testleri — Türkçe Excel sözleşmesi ve formül enjeksiyonu kapısı.
 */

import { describe, expect, it } from "vitest";
import { CSV_BOM, buildCsv, contentDisposition, csvFileName, trDecimal } from "./report-csv";
import type { ReportResult, ReportTable } from "./report-types";

const table: ReportTable = {
  key: "test",
  title: "Test tablosu",
  definition: "Deneme",
  columns: [
    { key: "ad", label: "Müvekkil", type: "text" },
    { key: "tutar", label: "Bakiye", type: "money" },
    { key: "oran", label: "Oran", type: "percent" },
    { key: "adet", label: "Adet", type: "number" },
    { key: "tarih", label: "Tarih", type: "date" },
  ],
  rows: [
    { ad: "ABC Holding", tutar: "1234567.89", oran: 42.5, adet: 12, tarih: "2026-08-31" },
    { ad: "Noktalı; virgüllü", tutar: "-1500.00", oran: 0, adet: 0, tarih: null },
    { ad: '=HYPERLINK("http://kotu")', tutar: "0.00", oran: 100, adet: 1, tarih: "2026-01-01" },
  ],
};

const result: ReportResult = {
  key: "buro-ozet",
  name: "Büro Özeti",
  description: "test",
  generatedAt: new Date("2026-08-31T10:00:00.000Z"),
  period: {
    from: new Date("2026-08-01T00:00:00.000Z"),
    to: new Date("2026-08-31T00:00:00.000Z"),
    endExclusive: new Date("2026-09-01T00:00:00.000Z"),
    days: 31,
    preset: "BU_AY",
    label: "01.08.2026 – 31.08.2026 (bitiş günü dâhil)",
    endInclusive: true,
  },
  metrics: [],
  tables: [table],
  notes: [],
  warnings: ["Bir uyarı"],
  hiddenSections: [],
  rowCount: 3,
  durationMs: 12,
  deterministic: true,
  runByRole: "PARTNER",
};

describe("trDecimal", () => {
  it("binlik ayracı nokta, ondalık virgüldür", () => {
    expect(trDecimal("1234567.89")).toBe("1.234.567,89");
    expect(trDecimal("999.00")).toBe("999,00");
    expect(trDecimal("-1500.00")).toBe("-1.500,00");
    expect(trDecimal("0.00")).toBe("0,00");
    expect(trDecimal("12")).toBe("12");
  });

  it("büyük tutarlarda kuruş kaybetmez (float'a çevrilmez)", () => {
    // 2^53'ün üzerindeki bir tutar Number'a çevrilse son basamak kayardı.
    expect(trDecimal("90071992547409919.99")).toBe("90.071.992.547.409.919,99");
  });
});

describe("buildCsv", () => {
  const csv = buildCsv(result, table);

  it("UTF-8 BOM ile başlar (Excel Türkçe karakterleri doğru okusun)", () => {
    expect(csv.startsWith(CSV_BOM)).toBe(true);
  });

  it("ayraç noktalı virgüldür", () => {
    expect(csv).toContain("Müvekkil;Bakiye;Oran;Adet;Tarih");
  });

  it("satır sonu CRLF'tir", () => {
    expect(csv).toContain("\r\n");
    expect(csv.split("\r\n").length).toBeGreaterThan(5);
  });

  it("künye bloğu dönem ve kapanış bilgisini taşır", () => {
    expect(csv).toContain("Büro Özeti");
    expect(csv).toContain("01.08.2026 – 31.08.2026");
    expect(csv).toContain("Kapanış günü;DÂHİL");
    expect(csv).toContain("UYARI;Bir uyarı");
  });

  it("meta=false ile künye yazılmaz", () => {
    const bare = buildCsv(result, table, { includeMeta: false });
    expect(bare).not.toContain("Kapanış günü");
    expect(bare.slice(1).startsWith("Müvekkil;")).toBe(true);
  });

  it("para ve yüzde Türkçe biçimde, TIRNAKSIZ yazılır (Excel sayı olarak alsın)", () => {
    expect(csv).toContain("1.234.567,89");
    expect(csv).toContain("42,50");
  });

  it("negatif tutar SAYI kalır — formül kapısı tırnaklamaz", () => {
    expect(csv).toContain(";-1.500,00;");
    expect(csv).not.toContain("'-1.500,00");
  });

  it("ayraç içeren metin tırnaklanır", () => {
    expect(csv).toContain('"Noktalı; virgüllü"');
  });

  it("formül enjeksiyonu METİN hücresinde etkisizleştirilir", () => {
    expect(csv).toContain("'=HYPERLINK");
    // Kaçırılmış hâli tırnak içindedir çünkü içinde çift tırnak vardır.
    expect(csv).toContain('""http://kotu""');
  });

  it("tarih Türkçe biçime çevrilir, boş tarih boş kalır", () => {
    expect(csv).toContain("31.08.2026");
    expect(csv).toContain("01.01.2026");
  });
});

describe("dosya adı ve başlık", () => {
  it("dosya adı rapor anahtarı ve dönemi taşır", () => {
    expect(csvFileName(result, table)).toBe("rapor-buro-ozet-test-20260801-20260831.csv");
  });

  it("Content-Disposition hem ASCII hem RFC 5987 adı verir", () => {
    const header = contentDisposition("rapor-süre.csv");
    expect(header).toContain('filename="rapor-s_re.csv"');
    expect(header).toContain("filename*=UTF-8''");
  });
});
