/**
 * F2 · E2 REGRESYON TESTİ — gece risk işi ve panel fotoğrafı.
 *
 * Korunan taahhütler:
 *  1. Fotoğrafın saf toplama katmanı (bant dağılımı, ortalama, top-N).
 *  2. İş KAYIT DEFTERİNDE kayıtlı (zamanlayıcı tetiklemeden kod çalışmaz).
 *  3. İş AI ÇAĞIRMAZ — gece koşusu yalnız deterministik tabanı tazeler.
 *  4. Aktif dosya filtresi: kapanmış dosyalar hesaplanmaz.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSnapshotRow,
  DASHBOARD_TOP_CASES,
  NIGHTLY_ACTIVE_CASE_STATUSES,
} from "./risk-nightly.service";
import { JOB_KEYS } from "../scheduler/scheduler.constants";

describe("buildSnapshotRow — fotoğrafın saf toplama katmanı", () => {
  const cases = [
    { caseId: "c1", fileNumber: "2026/10", title: "Alacak", genelScore: 80, genelBand: "YUKSEK" as const },
    { caseId: "c2", fileNumber: "2026/11", title: "İşe iade", genelScore: 55, genelBand: "ORTA" as const },
    { caseId: "c3", fileNumber: "2026/12", title: "Tapu", genelScore: 90, genelBand: "YUKSEK" as const },
    { caseId: "c4", fileNumber: "2026/13", title: "İcra", genelScore: 20, genelBand: "DUSUK" as const },
  ];

  it("bant dağılımı, yüksek risk sayısı ve ortalama doğru toplanır", () => {
    const row = buildSnapshotRow(cases);
    expect(row.caseCount).toBe(4);
    expect(row.highRiskCount).toBe(2);
    expect(row.avgGenelScore).toBe(Math.round((80 + 55 + 90 + 20) / 4));
    expect(JSON.parse(row.bandDistributionJson)).toEqual({ DUSUK: 1, ORTA: 1, YUKSEK: 2 });
  });

  it("top listesi en riskliye göre sıralanır ve N ile sınırlanır", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      caseId: `c${i}`,
      fileNumber: `2026/${i}`,
      title: `Dosya ${i}`,
      genelScore: i * 5,
      genelBand: "ORTA" as const,
    }));
    const row = buildSnapshotRow(many);
    const top = JSON.parse(row.topCasesJson) as { genel: number }[];
    expect(top).toHaveLength(DASHBOARD_TOP_CASES);
    expect(top[0].genel).toBe(95); // en yüksek
    expect(top.map((t) => t.genel)).toEqual([...top.map((t) => t.genel)].sort((a, b) => b - a));
  });

  it("boş büro: caseCount=0, ortalama null, dağılım sıfırlar", () => {
    const row = buildSnapshotRow([]);
    expect(row.caseCount).toBe(0);
    expect(row.avgGenelScore).toBeNull();
    expect(JSON.parse(row.bandDistributionJson)).toEqual({ DUSUK: 0, ORTA: 0, YUKSEK: 0 });
    expect(JSON.parse(row.topCasesJson)).toEqual([]);
  });
});

describe("F2 · E2: iş kayıt defteri ve ürün ilkesi", () => {
  const nightlyService = readFileSync(
    join(process.cwd(), "src", "risk", "risk-nightly.service.ts"),
    "utf-8",
  );

  it("anahtar kayıt defterinde ve platform işlerinde bulunur", () => {
    const registry = readFileSync(
      join(process.cwd(), "src", "scheduler", "job-registry.service.ts"),
      "utf-8",
    );
    expect(registry).toContain("riskNightly: RiskNightlyJob");
    expect(JOB_KEYS.RISK_NIGHTLY).toBe("risk-nightly");
  });

  it("gece işi AI ÇAĞIRMAZ — AI koşusu servis dosyasında geçmez", () => {
    // runAssessment/AiRunner yalnız RiskService'tedir; gece servisi onu
    // ithal etmez. İçe aktarma listesi bunu mekanik olarak doğrular.
    const imports = nightlyService.split("\n").filter((l) => l.startsWith("import "));
    const aiImports = imports.filter((l) => /ai-runner|AiRunner|runAssessment/i.test(l));
    expect(aiImports).toEqual([]);
  });

  it("computedBy NULL yazılır — şema sözleşmesi gece hesabı ayrıştırır", () => {
    expect(nightlyService).toContain("computedBy: null");
  });

  it("aktif dosya filtresi kapanmış dosyaları DIŞARIDA bırakır", () => {
    expect(NIGHTLY_ACTIVE_CASE_STATUSES).not.toContain("KAPANDI");
    expect(NIGHTLY_ACTIVE_CASE_STATUSES).not.toContain("ARSIV");
    expect(NIGHTLY_ACTIVE_CASE_STATUSES).not.toContain("KESINLESTI");
  });

  it("deterministik taban risk kurallarından gelir (kopya hesap yok)", () => {
    expect(nightlyService).toContain("computeAllDimensions(snapshot)");
    expect(nightlyService).toContain("computeGenel(dimensions, appliedAdjustments)");
  });
});
