import { describe, expect, it } from "vitest";

import {
  buildCaseContext,
  estimateTokens,
  type CaseContextInput,
} from "../context/case-context";

function makeInput(eventCount = 40): CaseContextInput {
  return {
    piiScanned: true,
    case: {
      caseNumber: "2026/145",
      courtName: "İstanbul 12. İş Mahkemesi",
      caseType: "DAVA",
      status: "DERDEST",
      subject: "İşe iade istemi",
      clientLabel: "A.Y.",
    },
    parties: [
      { role: "DAVACI", name: "A.Y.", isClient: true },
      { role: "DAVALI", name: "XYZ Lojistik A.Ş.", counselName: "Av. B.K." },
    ],
    timeline: Array.from({ length: eventCount }, (_, i) => ({
      date: `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
      type: "BELGE",
      description: `Safahat kaydı ${i + 1}: dosyaya evrak sunulmuştur ve işlem yapılmıştır.`,
    })),
    deadlines: [
      { title: "Bilirkişi raporuna itiraz", dueDate: "2026-08-26", status: "ONAYLANDI" },
      { title: "Delil listesi sunumu", dueDate: "2026-09-15", status: "BEKLIYOR" },
    ],
    documents: Array.from({ length: 20 }, (_, i) => ({
      documentId: `doc-${i}`,
      title: `Belge ${i + 1}`,
      documentClass: "DILEKCE",
      date: `2026-0${(i % 9) + 1}-10`,
      summary: `Belge ${i + 1} özeti: taraf beyanlarını ve delil dayanaklarını içermektedir.`,
    })),
    evidenceGaps: ["Davalının savunmasına dayanak tutanak sunulmamıştır."],
    strategySummary: "İspat yükü ve fesih usulü eksenli iki argüman.",
    hearing: { scheduledAt: "2026-10-14 10:30", courtName: "İstanbul 12. İş Mahkemesi" },
  };
}

describe("case-context", () => {
  it("token bütçesini asla aşmaz ve kırpmayı raporlar", () => {
    for (const budget of [50, 120, 400, 1200]) {
      const built = buildCaseContext(makeInput(), { tokenBudget: budget });
      expect(built.estimatedTokens).toBeLessThanOrEqual(budget);
      expect(estimateTokens(built.text)).toBeLessThanOrEqual(budget);
    }

    const tight = buildCaseContext(makeInput(), { tokenBudget: 80 });
    expect(tight.truncated).toBe(true);
    expect(tight.droppedItemCount).toBeGreaterThan(0);
  });

  it("bol bütçede hiçbir şey kırpılmaz", () => {
    const built = buildCaseContext(makeInput(5), { tokenBudget: 20000 });
    expect(built.truncated).toBe(false);
    expect(built.droppedItemCount).toBe(0);
    expect(built.includedSections).toContain("case");
    expect(built.includedSections).toContain("timeline");
  });

  it("en yeni safahat kaydını önce yazar", () => {
    const built = buildCaseContext(
      {
        piiScanned: true,
        case: { caseNumber: "2026/145" },
        timeline: [
          { date: "2024-01-01", description: "ESKI KAYIT" },
          { date: "2026-08-26", description: "YENI KAYIT" },
          { date: "2025-05-05", description: "ORTA KAYIT" },
        ],
      },
      { tokenBudget: 5000 },
    );
    const yeni = built.text.indexOf("YENI KAYIT");
    const orta = built.text.indexOf("ORTA KAYIT");
    const eski = built.text.indexOf("ESKI KAYIT");
    expect(yeni).toBeGreaterThan(-1);
    expect(yeni).toBeLessThan(orta);
    expect(orta).toBeLessThan(eski);
  });

  it("yaklaşan süreyi en yakından uzağa sıralar", () => {
    const built = buildCaseContext(
      {
        piiScanned: true,
        case: { caseNumber: "2026/145" },
        deadlines: [
          { title: "UZAK SURE", dueDate: "2026-12-01" },
          { title: "YAKIN SURE", dueDate: "2026-08-26" },
        ],
      },
      { tokenBudget: 5000 },
    );
    expect(built.text.indexOf("YAKIN SURE")).toBeLessThan(built.text.indexOf("UZAK SURE"));
  });

  it("veri minimizasyonu: görev tipi neyi gerektiriyorsa onu koyar", () => {
    const input = makeInput(5);

    const forClient = buildCaseContext(input, {
      taskType: "CLIENT_STATUS_SUMMARY",
      tokenBudget: 5000,
    });
    // Müvekkil özetine karşı taraf vekili, delil boşlukları ve strateji girmez.
    expect(forClient.includedSections).not.toContain("parties");
    expect(forClient.includedSections).not.toContain("evidence");
    expect(forClient.includedSections).not.toContain("strategy");
    expect(forClient.text).not.toContain("Av. B.K.");

    const forConflict = buildCaseContext(input, {
      taskType: "CONFLICT_INFERENCE",
      tokenBudget: 5000,
    });
    expect(forConflict.includedSections).toEqual(["case", "parties"]);
    expect(forConflict.text).not.toContain("Safahat kaydı");
  });

  it("include seçeneğiyle bölüm açıkça kapatılabilir", () => {
    const built = buildCaseContext(makeInput(5), {
      taskType: "CASE_CHAT",
      tokenBudget: 5000,
      include: { documents: false },
    });
    expect(built.includedSections).not.toContain("documents");
    expect(built.omittedSections).toContain("documents");
  });

  it("politika dışına çıkılarak eklenen bölümü denetim için raporlar", () => {
    // Müvekkil özeti politikasında "parties" YOKTUR; zorla eklenirse iz bırakmalıdır
    // (KVKK amaç sınırlılığı — apps/api bunu AiUsageLog/AuditLog'a yazar).
    const built = buildCaseContext(makeInput(3), {
      taskType: "CLIENT_STATUS_SUMMARY",
      tokenBudget: 5000,
      include: { parties: true },
    });
    expect(built.includedSections).toContain("parties");
    expect(built.policyOverrides).toEqual(["parties"]);

    const temiz = buildCaseContext(makeInput(3), {
      taskType: "CLIENT_STATUS_SUMMARY",
      tokenBudget: 5000,
    });
    expect(temiz.policyOverrides).toEqual([]);
  });

  it("geçersiz token bütçesinde Türkçe hata verir", () => {
    expect(() => buildCaseContext(makeInput(1), { tokenBudget: 0 })).toThrow(/token bütçesi/i);
  });

  it("PII taraması bildirilmeden bağlam kurulmaz", () => {
    const input = { ...makeInput(1), piiScanned: false } as unknown as CaseContextInput;
    expect(() => buildCaseContext(input, { tokenBudget: 5000 })).toThrow(/PII taramas/i);
  });
});
