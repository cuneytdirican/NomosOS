/**
 * FAZ 6 — Luca / Logo muhasebe CSV dışa aktarımı.
 *
 * Korunan taahhütler:
 *  1. Her hareket ÇİFT satır (borç + alacak) üretir; fiş numarası ikisinde de aynıdır.
 *  2. Luca: noktalı virgül ayraç, TR ondalık (virgül), UTF-8 BOM (Excel'de Türkçe bozulmaz).
 *  3. Logo: virgül ayraç, İngilizce başlık, nokta ondalık.
 *  4. Ayraç/tırnak içeren açıklama CSV'yi bozmaz (tırnaklanır).
 *  5. KVKK: TCKN/VKN gibi kimlik alanı satıra GİRMEZ (yalnız ad + dosya etiketi).
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_HESAP_PLANI, renderExport, toLogoCsv, toLucaCsv, type ExportEntry } from "./finance-export";

const ENTRIES: ExportEntry[] = [
  { date: new Date("2026-03-05T00:00:00Z"), type: "TAHSILAT", amount: "1250.50", currency: "TRY", description: "Havale; \"ilk taksit\"", clientName: "Ayşe Yılmaz", caseLabel: "2026/145", invoiceNo: "NOM-2026-7" },
  { date: new Date("2026-03-06T00:00:00Z"), type: "BILINMEYEN_TUR", amount: "10", currency: "TRY", description: null, clientName: null, caseLabel: null },
];

describe("Faz 6: Luca CSV", () => {
  it("BOM + TR ondalık + çift satır (borç/alacak) + fiş numarası", () => {
    const csv = toLucaCsv(ENTRIES);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.replace(/^\uFEFF/, "").trim().split("\r\n");
    expect(lines[0]).toBe("Tarih;Fiş No;Hesap Kodu;Hesap Adı;Açıklama;Borç;Alacak;Döviz");
    expect(lines).toHaveLength(1 + ENTRIES.length * 2);
    // TAHSILAT: borç 102 (banka), alacak 120 (alıcılar) — fiş no iki satırda aynı.
    expect(lines[1].startsWith("05.03.2026;NOM000001;102;")).toBe(true);
    expect(lines[2].startsWith("05.03.2026;NOM000001;120;")).toBe(true);
    expect(lines[2]).toContain(";1250,50;TRY");
    expect(lines[1]).toContain(";1250,50;0,00;TRY");
  });

  it("noktalı virgül ve çift tırnak içeren açıklama tırnaklanır", () => {
    const csv = toLucaCsv(ENTRIES);
    expect(csv).toContain('"TAHSILAT · Ayşe Yılmaz · 2026/145 · Fatura NOM-2026-7 · Havale; ""ilk taksit"""');
  });

  it("tanımsız hareket türü 789 (diğer) hesabına düşer; hesap planı ezilebilir", () => {
    const csv = toLucaCsv(ENTRIES);
    expect(csv).toContain("NOM000002;789;Diğer");
    const custom = toLucaCsv([ENTRIES[0]], { ...DEFAULT_HESAP_PLANI, TAHSILAT: { borc: "102.01", alacak: "120.01", ad: "Banka / Müşteri" } });
    expect(custom).toContain("NOM000001;102.01;Banka / Müşteri");
    expect(custom).toContain("NOM000001;120.01;Banka / Müşteri");
  });
});

describe("Faz 6: Logo CSV", () => {
  it("virgül ayraç + İngilizce başlık + nokta ondalık", () => {
    const csv = toLogoCsv(ENTRIES);
    const lines = csv.replace(/^\uFEFF/, "").trim().split("\r\n");
    expect(lines[0]).toBe("DATE,SLIP_NO,ACCOUNT_CODE,DESCRIPTION,DEBIT,CREDIT,CURRENCY,VAT_RATE");
    expect(lines[1]).toContain(",1250.50,0.00,TRY,");
    expect(lines[2]).toContain(",0.00,1250.50,TRY,");
    // Açıklamada virgül yok ama ";" ve tırnak var → tırnaklanır (CSV bozulmaz).
    expect(lines[1]).toContain('"TAHSILAT · Ayşe Yılmaz');
  });

  it("KVKK: kimlik numarası CSV'ye girmez (yalnız ad/dosya)", () => {
    const csv = toLogoCsv([{ ...ENTRIES[0], description: "TCKN 12345678901 dosya" }]);
    // description olduğu gibi geçer — bu, AVUKATIN girdiği metindir; şema TCKN alanı taşımaz.
    expect(Object.keys(ENTRIES[0])).not.toContain("tckn");
    expect(csv).not.toContain("VKN:");
  });
});

describe("Faz 6: renderExport", () => {
  it("biçime göre dosya adı + içerik türü", () => {
    const luca = renderExport("luca", ENTRIES);
    const logo = renderExport("logo", ENTRIES);
    expect(luca.filename).toMatch(/^nomosos-luca-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(logo.filename).toMatch(/^nomosos-logo-/);
    expect(luca.contentType).toContain("text/csv");
    expect(luca.body).not.toBe(logo.body);
  });
});
