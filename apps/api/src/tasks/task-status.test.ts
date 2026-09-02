/**
 * İ-57 SÖZLEŞME TESTİ — gerekçeli geçişler mobil istemciyle senkron.
 *
 * Mobile `gorevler.tsx`'teki `noteRequiredFor` bu tablonun KOPYASIDIR; sunucu
 * tarafını değiştiren bu testi kırmadan geçemez ve kopyayı güncellemeye
 * zorlanır.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REJECTION_TRANSITIONS,
  isRejectionTransition,
} from "./task-status";

describe("İ-57: ret geçişleri — sunucu sözleşmesi", () => {
  it("yalnız KONTROLDE/ONAY_BEKLIYOR → DEVAM_EDIYOR gerekçe ister", () => {
    expect(REJECTION_TRANSITIONS).toEqual([
      { from: "KONTROLDE", to: "DEVAM_EDIYOR" },
      { from: "ONAY_BEKLIYOR", to: "DEVAM_EDIYOR" },
    ]);
    expect(isRejectionTransition("KONTROLDE", "DEVAM_EDIYOR")).toBe(true);
    expect(isRejectionTransition("ONAY_BEKLIYOR", "DEVAM_EDIYOR")).toBe(true);
    // Normal başlangıç (ACIK → DEVAM_EDIYOR) ret DEĞİLDİR.
    expect(isRejectionTransition("ACIK", "DEVAM_EDIYOR")).toBe(false);
    expect(isRejectionTransition("DEVAM_EDIYOR", "IPTAL")).toBe(false);
  });

  it("mobil kopya aynı tabloyu kullanıyor (kaynak taahhüdü)", () => {
    const mobile = readFileSync(
      join(process.cwd(), "..", "mobile", "app", "(tabs)", "gorevler.tsx"),
      "utf-8",
    );
    // Kopya bu iki kaynağı açıkça sayar; tablo değişirse kopya güncellenmelidir.
    expect(mobile).toContain('from !== "KONTROLDE" && from !== "ONAY_BEKLIYOR"');
    expect(mobile).toContain('return to === "DEVAM_EDIYOR"');
    expect(mobile).toContain("task-status.ts");
  });
});
