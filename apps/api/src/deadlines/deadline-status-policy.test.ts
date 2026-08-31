/**
 * K-13 REGRESYON TESTİ — süre durum geçiş politikası.
 *
 * Bulgunun özü: sekreter tek istekle KACIRILDI süreyi TAMAMLANDI yapabiliyordu;
 * risk sinyali ve süre performansı rapor sayacı böylece siliniyordu. Politika
 * `deadline-status-policy.ts`'e alındı ama dosyanın kendi başlığı birim testi
 * vaat ediyordu ve öyle bir dosya YOKTU (denetim, "Test borcu" md. 3).
 * Bu test o vaadi kapatır; politikadan kural çekilirse kırmızıya döner.
 */

import { describe, expect, it } from "vitest";
import {
  evaluateDeadlineStatusTransition,
  TERMINAL_DEADLINE_STATUSES,
  type TransitionInput,
} from "./deadline-status-policy";

const T = (over: Partial<TransitionInput>): TransitionInput => ({
  from: "BEKLIYOR",
  to: "TAMAMLANDI",
  role: "AVUKAT",
  note: null,
  title: "İstinaf süresi",
  ...over,
});

describe("K-13: KACIRILDI'dan çıkış dar kapıdır", () => {
  it("SEKRETER ve STAJYER çıkamaz — yetki reddi döner", () => {
    for (const role of ["SEKRETER", "STAJYER"] as const) {
      const r = evaluateDeadlineStatusTransition(T({ from: "KACIRILDI", to: "TAMAMLANDI", role, note: "yanlış işaretlenmiş" }));
      expect(r?.kind).toBe("YETKI");
      if (r?.kind === "YETKI") expect(r.requiredRoles).toEqual(["ADMIN", "PARTNER"]);
    }
  });

  it("AVUKAT bile çıkamaz — yalnız ADMIN/PARTNER", () => {
    const r = evaluateDeadlineStatusTransition(
      T({ from: "KACIRILDI", to: "TAMAMLANDI", role: "AVUKAT", note: "gerekçe" }),
    );
    expect(r?.kind).toBe("YETKI");
  });

  it("ADMIN/PARTNER çıkabilir ama gerekçe ZORUNLU", () => {
    for (const role of ["ADMIN", "PARTNER"] as const) {
      const noNote = evaluateDeadlineStatusTransition(T({ from: "KACIRILDI", to: "TAMAMLANDI", role, note: "  " }));
      expect(noNote?.kind).toBe("GEREKCE");
      const ok = evaluateDeadlineStatusTransition(
        T({ from: "KACIRILDI", to: "TAMAMLANDI", role, note: "yanlış tebliğ tarihi girilmişti" }),
      );
      expect(ok).toBeNull();
    }
  });

  it("KACIRILDI terminal DEĞİLDİR — yanlış işaretleme düzeltilebilir", () => {
    expect(TERMINAL_DEADLINE_STATUSES).not.toContain("KACIRILDI");
  });
});

describe("KACIRILDI'ya giriş", () => {
  it("SEKRETER işaretleyemez, AVUKAT+ gerekçesiz işaretleyemez", () => {
    expect(
      evaluateDeadlineStatusTransition(T({ to: "KACIRILDI", role: "SEKRETER", note: "x" }))?.kind,
    ).toBe("YETKI");
    expect(
      evaluateDeadlineStatusTransition(T({ to: "KACIRILDI", role: "AVUKAT", note: null }))?.kind,
    ).toBe("GEREKCE");
  });

  it("AVUKAT gerekçeli işaretleyebilir", () => {
    expect(
      evaluateDeadlineStatusTransition(T({ to: "KACIRILDI", role: "AVUKAT", note: "tebliğ e-postası geç geldi" })),
    ).toBeNull();
  });
});

describe("diğer kurallar", () => {
  it("aynı duruma geçiş reddedilir", () => {
    expect(evaluateDeadlineStatusTransition(T({ from: "BEKLIYOR", to: "BEKLIYOR" }))?.kind).toBe("AYNI_DURUM");
  });

  it("terminal durumdan çıkış yoktur (TAMAMLANDI/IPTAL)", () => {
    for (const from of TERMINAL_DEADLINE_STATUSES) {
      const r = evaluateDeadlineStatusTransition(T({ from, to: "BEKLIYOR", role: "ADMIN", note: "x" }));
      expect(r?.kind).toBe("TERMINAL");
    }
  });

  it("ONAYLANDI/IPTAL hukuki yetki ister; TAMAMLANDI operasyoneldir, STAJYER kapatamaz", () => {
    expect(
      evaluateDeadlineStatusTransition(T({ to: "ONAYLANDI", role: "SEKRETER" }))?.kind,
    ).toBe("YETKI");
    expect(
      evaluateDeadlineStatusTransition(T({ to: "IPTAL", role: "SEKRETER" }))?.kind,
    ).toBe("YETKI");
    expect(evaluateDeadlineStatusTransition(T({ to: "TAMAMLANDI", role: "SEKRETER" }))).toBeNull();
    expect(evaluateDeadlineStatusTransition(T({ to: "TAMAMLANDI", role: "STAJYER" }))?.kind).toBe("YETKI");
  });
});
