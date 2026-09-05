/**
 * FAZ 1 kural paketi + 2028-2032 tatil takvimi (avukat gözüyle boşluk analizi).
 * Her yeni kural için: anahtar var, süre/dayanak tutarlı, motorla örnek hesap.
 */
import { describe, expect, it } from "vitest";
import {
  DEADLINE_RULES_VERSION,
  SUPPORTED_HOLIDAY_YEARS,
  SYSTEM_DEADLINE_RULES,
  TR_HOLIDAYS_2028,
  TR_HOLIDAYS_2032,
  TR_HOLIDAYS_BY_YEAR,
  computeDeadline,
  expandJudicialRecess,
  findSystemRule,
  parseDateOnly,
  projectedYearHolidays,
  toHolidayInputs,
  toIsoDateKey,
  toRuleInput,
} from "../index";

const FAZ1_KEYS = [
  "AYM_BIREYSEL_BASVURU",
  "AIHM_BASVURU",
  "IYUK_SAVUNMA",
  "IYUK_ISTINAF",
  "IYUK_TEMYIZ",
  "IYUK_YD_ITIRAZ",
  "IIK_SATIS_ISTEME",
  "IIK_KIYMET_TAKDIRI_ITIRAZ",
  "IIK_SIRA_CETVELI_SIKAYET",
  "IIK_IHTIYATI_HACZE_ITIRAZ",
  "IIK_ILAM_ZAMANASIMI",
  "IIK_ITIRAZIN_KALDIRILMASI",
  "IIK_TAHLIYE_EMRI_ITIRAZ",
  "CMK_ITIRAZ",
  "CMK_ESKI_HALE_GETIRME",
  "KVKK_VERI_SORUMLUSU_CEVAP",
  "KVKK_KURUL_SIKAYET",
  "TMK_MIRASIN_REDDI",
  "TTK_KAMBIYO_ZAMANASIMI",
  "SMK_BULTEN_ITIRAZ",
  "HMK_YARGILAMANIN_YENILENMESI",
  "IS_ISE_IADE_ARABULUCU_BASVURU",
] as const;

function holidaysFor(year: number) {
  return [...toHolidayInputs(TR_HOLIDAYS_BY_YEAR[year]), ...expandJudicialRecess(year)];
}

function runRule(key: string, trigger: string) {
  const rule = findSystemRule(key)!;
  return computeDeadline({
    ruleKey: key,
    triggerDate: parseDateOnly(trigger),
    rule: toRuleInput(rule),
    holidays: [...holidaysFor(2026), ...holidaysFor(2027)],
    applyJudicialRecess: rule.judicialRecessApplies,
    recessRule: rule.recessRule,
    procedureCode: rule.procedureCode,
  });
}

describe("Faz 1 kural paketi", () => {
  it("22 yeni kural sette; usul kodu ve adli tatil ayarı ailesine uygun", () => {
    for (const key of FAZ1_KEYS) {
      const rule = findSystemRule(key);
      expect(rule, key).toBeDefined();
    }
    expect(SYSTEM_DEADLINE_RULES.filter((r) => (FAZ1_KEYS as readonly string[]).includes(r.key))).toHaveLength(22);
    for (const key of FAZ1_KEYS.filter((k) => k.startsWith("IIK_"))) {
      expect(findSystemRule(key)!.judicialRecessApplies, key).toBe(false);
      expect(findSystemRule(key)!.procedureCode, key).toBe("IIK");
    }
    for (const key of FAZ1_KEYS.filter((k) => k.startsWith("IYUK_"))) {
      expect(findSystemRule(key)!.recessRule, key).toBe("IYUK_8");
    }
    for (const key of FAZ1_KEYS.filter((k) => k.startsWith("CMK_"))) {
      expect(findSystemRule(key)!.recessRule, key).toBe("CMK_331");
    }
    expect(findSystemRule("AYM_BIREYSEL_BASVURU")!.judicialRecessApplies).toBe(false);
    expect(DEADLINE_RULES_VERSION).toMatch(/^\d{4}\.\d{2}$/);
  });

  it("AYM bireysel başvuru: 01.09.2026 tebliğ → 01.10.2026 (adli tatil dışı, düz 30 gün)", () => {
    const r = runRule("AYM_BIREYSEL_BASVURU", "2026-09-01");
    expect(toIsoDateKey(r.dueDate)).toBe("2026-10-01");
  });

  it("İİK m.106 satış isteme: 10.03.2026 haciz → 1 yıl = 10.03.2027 Ramazan Bayramı → 12.03.2027 (uyarı: öngörülen tatil)", () => {
    const r = runRule("IIK_SATIS_ISTEME", "2026-03-10");
    expect(toIsoDateKey(r.dueDate)).toBe("2027-03-12");
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("İYUK istinaf 30 gün adli tatile rastlarsa m.8/3 uzaması uygulanır (tatil bitiminden 7 gün)", () => {
    // 15.07.2026 tebliğ → 14.08.2026 adli tatil içinde → 31.08 + 7 gün = 07.09.2026
    const r = runRule("IYUK_ISTINAF", "2026-07-15");
    expect(toIsoDateKey(r.dueDate)).toBe("2026-09-07");
  });

  it("CMK itiraz 7 gün: 05.10.2026 tefhim → 12.10.2026", () => {
    const r = runRule("CMK_ITIRAZ", "2026-10-05");
    expect(toIsoDateKey(r.dueDate)).toBe("2026-10-12");
  });

  it("TMK mirasın reddi 3 ay: 20.11.2026 → 20.02.2027 (Cumartesi → 22.02.2027 Pazartesi)", () => {
    const r = runRule("TMK_MIRASIN_REDDI", "2026-11-20");
    expect(toIsoDateKey(r.dueDate)).toBe("2027-02-22");
  });
});

describe("2028-2032 tatil takvimi", () => {
  it("desteklenen yıllar 2032'ye kadar; her yılda 8 sabit + 9 dinî (öngörülen) gün", () => {
    expect(SUPPORTED_HOLIDAY_YEARS).toEqual([2026, 2027, 2028, 2029, 2030, 2031, 2032]);
    for (const y of [2028, 2029, 2030, 2031, 2032]) {
      const list = TR_HOLIDAYS_BY_YEAR[y];
      expect(list, String(y)).toHaveLength(17);
      expect(list.filter((h) => h.isApproximate)).toHaveLength(9);
      expect(list.every((h) => h.date.startsWith(`${y}-`)), String(y)).toBe(true);
      const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date)).map((h) => h.date);
      expect(list.map((h) => h.date)).toEqual(sorted);
    }
  });

  it("2028 Ramazan Bayramı 26-28 Şubat, arife 25 Şubat yarım gün; 2032 Kurban 22-25 Mart", () => {
    const ram = TR_HOLIDAYS_2028.filter((h) => h.name.startsWith("Ramazan"));
    expect(ram.map((h) => h.date)).toEqual(["2028-02-25", "2028-02-26", "2028-02-27", "2028-02-28"]);
    expect(ram[0].isHalfDay).toBe(true);
    const kurban = TR_HOLIDAYS_2032.filter((h) => h.name.startsWith("Kurban"));
    expect(kurban.map((h) => h.date)).toEqual(["2032-03-21", "2032-03-22", "2032-03-23", "2032-03-24", "2032-03-25"]);
  });

  it("projectedYearHolidays sabit günleri kesin, dinî günleri öngörü olarak işaretler", () => {
    const list = projectedYearHolidays(2040, "2040-01-10", "2040-03-20");
    expect(list.find((h) => h.date === "2040-10-29")?.isApproximate).toBeUndefined();
    expect(list.find((h) => h.date === "2040-01-11")?.isApproximate).toBe(true);
  });
});
