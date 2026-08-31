/**
 * MÜVEKKİLE DÖNÜK BAĞLAM — birim testleri.
 *
 * En önemli test, "ne YOK" testidir: strateji, risk, iç not ve karşı taraf
 * kimliği bu yapıya HİÇ GİREMEZ (Modül 19 iş kuralı 8). Bu, çalışma anında
 * filtrelenen bir şey değil, tipin taşımadığı bir şeydir; test o sözleşmeyi
 * kayda geçirir.
 */

import { describe, expect, it } from "vitest";
import { buildClientFacingCaseContext } from "./client-facing-context";

const INPUT = {
  fileNumber: "2026/145",
  courtName: "İstanbul 12. İş Mahkemesi",
  caseType: "DAVA",
  status: "DERDEST",
  subject: "İşe iade istemi",
  timeline: [
    { date: "2026-08-26", title: "Beyan dilekçesi sunuldu", detail: null },
    { date: "2026-08-05", title: "Bilirkişi raporu sunuldu", detail: "Rapor lehe görünüyor" },
  ],
  hearings: [{ at: "2026-10-14T07:30:00.000Z", type: "DURUSMA" }],
  deadlines: [{ title: "Rapora itiraz", dueDate: "2026-09-09" }],
};

describe("buildClientFacingCaseContext", () => {
  it("dosya künyesi, duruşma, safahat ve süreyi etiketli satırlara yazar", () => {
    const { text } = buildClientFacingCaseContext(INPUT);
    expect(text).toContain("[DOSYA] İstanbul 12. İş Mahkemesi · 2026/145");
    expect(text).toContain("[KONU] İşe iade istemi");
    expect(text).toContain("[DURUŞMA] 2026-10-14T07:30:00.000Z");
    expect(text).toContain("[SAFAHAT] 2026-08-05 Bilirkişi raporu sunuldu — Rapor lehe görünüyor");
    expect(text).toContain("[SÜRE] 2026-09-09 · Rapora itiraz");
  });

  it("DURUŞMAYI SAFAHATTAN ÖNCE yazar — müvekkilin en çok sorduğu şey odur", () => {
    const { text } = buildClientFacingCaseContext(INPUT);
    expect(text.indexOf("[DURUŞMA]")).toBeLessThan(text.indexOf("[SAFAHAT]"));
  });

  it("bağlamda strateji/risk/iç not/karşı taraf İZİ BULUNMAZ", () => {
    const { text } = buildClientFacingCaseContext(INPUT);
    for (const forbidden of ["[STRATEJI]", "[RISK]", "[NOT]", "[TARAF]", "[FINANS]", "[BELGE]"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("sayı sınırlarını uygular ve düşen satırları RAPORLAR", () => {
    const many = {
      ...INPUT,
      timeline: Array.from({ length: 30 }, (_, i) => ({
        date: `2026-08-${String((i % 28) + 1).padStart(2, "0")}`,
        title: `Olay ${i}`,
      })),
    };
    const { text, droppedRows } = buildClientFacingCaseContext(many, { maxTimeline: 5 });
    expect(text.split("\n").filter((l) => l.startsWith("[SAFAHAT]"))).toHaveLength(5);
    expect(droppedRows).toBe(25);
  });

  it("karakter bütçesini AŞMAZ", () => {
    const many = {
      ...INPUT,
      timeline: Array.from({ length: 12 }, (_, i) => ({
        date: "2026-08-01",
        title: "x".repeat(200),
        detail: `${i}`,
      })),
    };
    const { text, droppedRows } = buildClientFacingCaseContext(many, { maxChars: 600 });
    expect(text.length).toBeLessThanOrEqual(600);
    expect(droppedRows).toBeGreaterThan(0);
  });

  it("künyesi eksik dosyada UYDURMAZ, eksikliği yazar", () => {
    const { text } = buildClientFacingCaseContext({});
    expect(text).toContain("(dosya künyesi eksik)");
  });
});
