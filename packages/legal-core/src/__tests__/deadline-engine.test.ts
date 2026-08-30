import { describe, expect, it } from "vitest";

import {
  DEADLINE_STEP_CODES,
  SYSTEM_DEADLINE_RULES,
  SYSTEM_DEADLINE_RULE_KEYS,
  TR_HOLIDAYS_2026,
  addDays,
  addDuration,
  addMonths,
  addYears,
  computeDeadline,
  dateOnly,
  expandJudicialRecess,
  findSystemRule,
  formatTrDate,
  getSystemRule,
  isFullDayOfficialHoliday,
  isInJudicialRecess,
  isNonWorkingDay,
  isOfficialHoliday,
  isWeekend,
  judicialRecessEndFor,
  judicialRecessRange,
  nextWorkingDay,
  parseDateOnly,
  previousWorkingDay,
  strictNextWorkingDay,
  toHolidayInputs,
  toIsoDateKey,
  toRuleInput,
  toUtcDate,
  systemRulesForCaseType,
} from "../index";
import type {
  DeadlineComputationInput,
  DeadlineComputationResult,
  HolidayInput,
} from "../index";

// ───────────────────────────────────────────────────────────────────────────
// Ortak test verisi: 2026 resmî tatilleri + 2026 adli tatili (20.07 – 31.08)
// ───────────────────────────────────────────────────────────────────────────

const HOLIDAYS_2026: HolidayInput[] = [
  ...toHolidayInputs(TR_HOLIDAYS_2026),
  ...expandJudicialRecess(2026),
];

const d = parseDateOnly;
const iso = (date: Date) => toIsoDateKey(date);

/** Test kısayolu: makul varsayılanlarla `computeDeadline` çağırır. */
function run(
  overrides: Partial<DeadlineComputationInput> & Pick<DeadlineComputationInput, "triggerDate">,
): DeadlineComputationResult {
  return computeDeadline({
    ruleKey: overrides.ruleKey ?? "TEST",
    serviceMethod: overrides.serviceMethod,
    rule: overrides.rule ?? { durationValue: 2, durationUnit: "HAFTA", legalBasis: "TEST m.1" },
    holidays: overrides.holidays ?? HOLIDAYS_2026,
    applyJudicialRecess: overrides.applyJudicialRecess,
    recessRule: overrides.recessRule,
    procedureCode: overrides.procedureCode,
    triggerDate: overrides.triggerDate,
  });
}

/**
 * Sistem kuralıyla çalıştırır; kuralın adli tatil ayarını, rejimini ve usul
 * kanununu otomatik uygular — apps/api'deki `runEngine` ile aynı şekilde.
 */
function runSystemRule(
  key: string,
  triggerDate: Date,
  extra: Partial<DeadlineComputationInput> = {},
): DeadlineComputationResult {
  const rule = getSystemRule(key);
  return computeDeadline({
    ruleKey: key,
    triggerDate,
    rule: toRuleInput(rule),
    holidays: HOLIDAYS_2026,
    applyJudicialRecess: rule.judicialRecessApplies,
    recessRule: rule.recessRule,
    procedureCode: rule.procedureCode,
    ...extra,
  });
}

const stepDate = (result: DeadlineComputationResult, code: string): string => {
  const step = result.steps.find((s) => s.step === code);
  if (!step) throw new Error(`Adım bulunamadı: ${code}`);
  return iso(step.date);
};

// ═══════════════════════════════════════════════════════════════════════════
// 1) Tarih aritmetiği — saat dilimi bağımsızlığı ve HMK m.92/2 sabitlemesi
// ═══════════════════════════════════════════════════════════════════════════

describe("tarih aritmetiği", () => {
  it("parseDateOnly, UTC gün başı üretir ve saat bileşeni taşımaz", () => {
    const date = d("2026-08-18");
    expect(date.toISOString()).toBe("2026-08-18T00:00:00.000Z");
  });

  it("toUtcDate, saat bileşenini sıfırlar ve günü UTC'ye göre okur", () => {
    const withTime = new Date("2026-08-18T22:45:31.123Z");
    expect(toUtcDate(withTime).toISOString()).toBe("2026-08-18T00:00:00.000Z");
  });

  it("dateOnly, 1 tabanlı ay alır", () => {
    expect(iso(dateOnly(2026, 8, 18))).toBe("2026-08-18");
  });

  it("parseDateOnly, geçersiz biçimde Türkçe hata fırlatır", () => {
    expect(() => d("18.08.2026")).toThrow(/Geçersiz tarih biçimi/);
    expect(() => d("2026-02-30")).toThrow(/Takvimde bulunmayan tarih/);
  });

  it("addMonths, ayın karşılığı olmayan günde ayın son gününe sabitlenir (31 Ocak + 1 ay)", () => {
    expect(iso(addMonths(d("2026-01-31"), 1))).toBe("2026-02-28");
  });

  it("addMonths, artık yılda 29 Şubat'a sabitlenir (31 Ocak 2028 + 1 ay)", () => {
    expect(iso(addMonths(d("2028-01-31"), 1))).toBe("2028-02-29");
  });

  it("addYears, 29 Şubat + 1 yıl → 28 Şubat (artık olmayan yıl)", () => {
    expect(iso(addYears(d("2024-02-29"), 1))).toBe("2025-02-28");
  });

  it("addYears, 29 Şubat + 4 yıl → 29 Şubat (artık yıl korunur)", () => {
    expect(iso(addYears(d("2024-02-29"), 4))).toBe("2028-02-29");
  });

  it("addDays, yıl sınırını doğru geçer", () => {
    expect(iso(addDays(d("2026-12-28"), 14))).toBe("2027-01-11");
  });

  it("isWeekend, cumartesi ve pazarı tanır", () => {
    expect(isWeekend(d("2026-06-06"))).toBe(true); // Cumartesi
    expect(isWeekend(d("2026-06-07"))).toBe(true); // Pazar
    expect(isWeekend(d("2026-06-08"))).toBe(false); // Pazartesi
  });

  it("formatTrDate, gg.aa.yyyy biçimi verir", () => {
    expect(formatTrDate(d("2026-08-18"))).toBe("18.08.2026");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2) addDuration — HMK m.92/2 birim hesabı
// ═══════════════════════════════════════════════════════════════════════════

describe("addDuration", () => {
  it("GUN: tebliğ günü hesaba katılmadığından son gün = tebliğ + N gün", () => {
    expect(iso(addDuration(d("2026-06-02"), 7, "GUN"))).toBe("2026-06-09");
  });

  it("HAFTA: son haftada karşılık gelen gün (aynı gün adı)", () => {
    const result = addDuration(d("2026-08-18"), 2, "HAFTA");
    expect(iso(result)).toBe("2026-09-01");
    expect(result.getUTCDay()).toBe(d("2026-08-18").getUTCDay());
  });

  it("AY: son ayda karşılık gelen gün", () => {
    expect(iso(addDuration(d("2026-03-15"), 3, "AY"))).toBe("2026-06-15");
  });

  it("YIL: son yılda karşılık gelen gün", () => {
    expect(iso(addDuration(d("2026-03-10"), 1, "YIL"))).toBe("2027-03-10");
  });

  it("pozitif olmayan veya tam sayı olmayan süre değerini reddeder", () => {
    expect(() => addDuration(d("2026-06-02"), 0, "GUN")).toThrow(/pozitif bir tam sayı/);
    expect(() => addDuration(d("2026-06-02"), -3, "GUN")).toThrow(/pozitif bir tam sayı/);
    expect(() => addDuration(d("2026-06-02"), 1.5, "GUN")).toThrow(/pozitif bir tam sayı/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3) Tatil yardımcıları — HMK m.93 ve m.102
// ═══════════════════════════════════════════════════════════════════════════

describe("tatil ve iş günü yardımcıları", () => {
  it("hafta sonu çalışılmayan gündür", () => {
    expect(isNonWorkingDay(d("2026-06-06"), HOLIDAYS_2026)).toBe(true);
  });

  it("resmî tatil çalışılmayan gündür", () => {
    expect(isNonWorkingDay(d("2026-04-23"), HOLIDAYS_2026)).toBe(true);
  });

  it("ADLİ TATİL, HMK m.93 anlamında çalışılmayan gün DEĞİLDİR", () => {
    const aug24 = d("2026-08-24"); // Pazartesi, adli tatil içinde
    expect(isInJudicialRecess(aug24, HOLIDAYS_2026)).toBe(true);
    expect(isNonWorkingDay(aug24, HOLIDAYS_2026)).toBe(false);
  });

  it("nextWorkingDay, gün zaten iş günüyse aynı günü döner", () => {
    expect(iso(nextWorkingDay(d("2026-06-09"), HOLIDAYS_2026))).toBe("2026-06-09");
  });

  it("nextWorkingDay, arka arkaya tatilleri (Kurban + hafta sonu) atlar", () => {
    // 27-30 Mayıs Kurban Bayramı, 30 Cmt / 31 Paz → ilk iş günü 1 Haziran Pazartesi
    expect(iso(nextWorkingDay(d("2026-05-27"), HOLIDAYS_2026))).toBe("2026-06-01");
  });

  it("strictNextWorkingDay, iş günü verilse bile ileriye gider", () => {
    expect(iso(strictNextWorkingDay(d("2026-06-09"), HOLIDAYS_2026))).toBe("2026-06-10");
  });

  it("previousWorkingDay, geriye doğru ilk iş gününü bulur", () => {
    expect(iso(previousWorkingDay(d("2026-05-30"), HOLIDAYS_2026))).toBe("2026-05-26");
  });

  it("adli tatil sınırları: 20 Temmuz dâhil, 19 Temmuz hariç, 31 Ağustos dâhil, 1 Eylül hariç", () => {
    expect(isInJudicialRecess(d("2026-07-19"), HOLIDAYS_2026)).toBe(false);
    expect(isInJudicialRecess(d("2026-07-20"), HOLIDAYS_2026)).toBe(true);
    expect(isInJudicialRecess(d("2026-08-31"), HOLIDAYS_2026)).toBe(true);
    expect(isInJudicialRecess(d("2026-09-01"), HOLIDAYS_2026)).toBe(false);
  });

  it("expandJudicialRecess, 20 Temmuz – 31 Ağustos arası 43 gün üretir", () => {
    const days = expandJudicialRecess(2026);
    expect(days).toHaveLength(43);
    expect(iso(toUtcDate(days[0].date))).toBe("2026-07-20");
    expect(iso(toUtcDate(days[42].date))).toBe("2026-08-31");
  });

  it("judicialRecessEndFor, adli tatilin bitişini verir; dışındaki gün için null döner", () => {
    expect(iso(judicialRecessEndFor(d("2026-08-24"), HOLIDAYS_2026)!)).toBe("2026-08-31");
    expect(judicialRecessEndFor(d("2026-09-15"), HOLIDAYS_2026)).toBeNull();
    expect(iso(judicialRecessRange(2026).start)).toBe("2026-07-20");
  });

  it("TR_HOLIDAYS_2026, 17 resmî tatil satırı içerir ve dinî bayramları işaretler", () => {
    // 15 tam gün + 3 arife (Ramazan 19.03, Kurban 26.05, Cumhuriyet 28.10);
    // 28.10 zaten listede olduğundan toplam 17 satır.
    expect(TR_HOLIDAYS_2026).toHaveLength(17);
    const kurban = TR_HOLIDAYS_2026.filter((h) => h.name.startsWith("Kurban Bayramı ") && !h.isHalfDay);
    expect(kurban).toHaveLength(4);
    expect(kurban.every((h) => h.isApproximate === true)).toBe(true);
    // Sabit tarihli, kanunla belirli günler kesindir.
    expect(TR_HOLIDAYS_2026.find((h) => h.date === "2026-04-23")!.isApproximate).toBeUndefined();
  });

  it("2429 s.K. m.2/A — arife günleri yarım gündür ve TAM TATİL SAYILMAZ", () => {
    // Denetim bulgusu 1: yarım günü tam tatil saymak, süreyi olduğundan GEÇ
    // hesaplar ve avukata var olmayan bir gün kazandırır.
    for (const arife of ["2026-03-19", "2026-05-26", "2026-10-28"]) {
      const day = d(arife);
      const row = TR_HOLIDAYS_2026.find((h) => h.date === arife);
      expect(row?.isHalfDay).toBe(true);
      // Resmî tatil listesindedir…
      expect(isOfficialHoliday(day, HOLIDAYS_2026)).toBe(true);
      // …ama HMK m.93 anlamında çalışılmayan gün DEĞİLDİR.
      expect(isFullDayOfficialHoliday(day, HOLIDAYS_2026)).toBe(false);
      expect(isNonWorkingDay(day, HOLIDAYS_2026)).toBe(false);
    }
  });

  it("Ramazan ve Kurban arifeleri takvimde mevcuttur (2429 s.K. m.2/A)", () => {
    const halfDays = TR_HOLIDAYS_2026.filter((h) => h.isHalfDay);
    expect(halfDays.map((h) => h.date)).toEqual(["2026-03-19", "2026-05-26", "2026-10-28"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4) computeDeadline — çekirdek algoritma
// ═══════════════════════════════════════════════════════════════════════════

describe("computeDeadline — başlangıç ve süre ekleme", () => {
  it("HMK m.92/1: sürenin başladığı gün hesaba katılmaz", () => {
    // Tebliğ 2 Haziran 2026 Salı, İİK m.62 (7 gün) → 9 Haziran Salı.
    // Başlangıç günü sayılsaydı 8 Haziran Pazartesi çıkardı.
    const result = runSystemRule("IIK_ODEME_EMRI_ITIRAZ", d("2026-06-02"), {
      serviceMethod: "ELDEN",
    });
    expect(stepDate(result, DEADLINE_STEP_CODES.BASLANGIC)).toBe("2026-06-03");
    expect(iso(result.dueDate)).toBe("2026-06-09");
  });

  it("KABUL KRİTERİ: 18.08.2026 tebliğ + HMK_ISTINAF (2 hafta) → 01.09.2026", () => {
    const result = runSystemRule("HMK_ISTINAF", d("2026-08-18"), { serviceMethod: "POSTA" });
    expect(iso(result.dueDate)).toBe("2026-09-01");
    expect(result.legalBasis).toBe("HMK m.345 — 2 hafta");
  });

  it("hesap izi tüm adımları sırayla içerir", () => {
    const result = runSystemRule("HMK_ISTINAF", d("2026-08-18"), { serviceMethod: "POSTA" });
    expect(result.steps.map((s) => s.step)).toEqual([
      DEADLINE_STEP_CODES.TETIK,
      DEADLINE_STEP_CODES.TEBLIGAT_DUZELTMESI,
      DEADLINE_STEP_CODES.BASLANGIC,
      DEADLINE_STEP_CODES.SURE_EKLEME,
      DEADLINE_STEP_CODES.TATIL_KAYDIRMASI,
      DEADLINE_STEP_CODES.SON_GUN,
    ]);
    expect(stepDate(result, DEADLINE_STEP_CODES.TETIK)).toBe("2026-08-18");
    // HAFTA sürelerinde başlangıç günü TEBLİĞ günüdür (HMK m.91 + m.92/2);
    // "ilk gün sayılmaz" kuralı yalnızca GÜN sürelerine özgüdür (m.92/1).
    expect(stepDate(result, DEADLINE_STEP_CODES.BASLANGIC)).toBe("2026-08-18");
    expect(stepDate(result, DEADLINE_STEP_CODES.SURE_EKLEME)).toBe("2026-09-01");
    expect(stepDate(result, DEADLINE_STEP_CODES.SON_GUN)).toBe("2026-09-01");
  });

  it("GÜN sürelerinde HMK m.92/1, HAFTA sürelerinde HMK m.91+92/2 gösterilir", () => {
    // Denetim bulgusu 16: m.92/1 lafzen "Süre, GÜN OLARAK belirlenmiş ise…"
    // der; haftalık sürede bu maddeyi göstermek hesap izini kendi içinde
    // çelişkili yapıyordu (metin 19.08'i, hesap 18.08'i esas alıyordu).
    const gunluk = runSystemRule("IIK_ODEME_EMRI_ITIRAZ", d("2026-06-02"), { serviceMethod: "ELDEN" });
    const gunlukBaslangic = gunluk.steps.find((s) => s.step === DEADLINE_STEP_CODES.BASLANGIC)!;
    expect(gunlukBaslangic.explanation).toContain("hesaba katılmaz");

    const haftalik = runSystemRule("HMK_ISTINAF", d("2026-08-18"), { serviceMethod: "POSTA" });
    const haftalikBaslangic = haftalik.steps.find((s) => s.step === DEADLINE_STEP_CODES.BASLANGIC)!;
    expect(haftalikBaslangic.explanation).toContain("HMK m.91");
    expect(haftalikBaslangic.explanation).toContain("KARŞILIK GELEN");
    expect(haftalikBaslangic.explanation).not.toContain("hesaba katılmaz");
  });

  it("hesap izi açıklamaları madde referansı ve Türkçe metin taşır", () => {
    const result = runSystemRule("HMK_ISTINAF", d("2026-08-18"), { serviceMethod: "POSTA" });
    const baslangic = result.steps.find((s) => s.step === DEADLINE_STEP_CODES.BASLANGIC)!;
    expect(baslangic.explanation).toContain("HMK m.9");
    const sonGun = result.steps.find((s) => s.step === DEADLINE_STEP_CODES.SON_GUN)!;
    expect(sonGun.explanation).toContain("01.09.2026 Salı");
    expect(result.steps.every((s) => s.explanation.trim().length > 0)).toBe(true);
  });

  it("usul kanununa göre madde referansı seçilir (İİK m.19 / CMK m.39)", () => {
    // Denetim bulgusu 17: İİK m.62 itirazında "HMK m.93" göstermek hatalıdır;
    // dayanak İİK m.19'dur. Hesap izi dilekçeye kopyalanabilir bir belgedir.
    const icra = runSystemRule("IIK_ODEME_EMRI_ITIRAZ", d("2026-06-06"), { serviceMethod: "ELDEN" });
    const izMetni = icra.steps.map((s) => s.explanation).join(" ");
    expect(izMetni).toContain("İİK m.19");
    expect(izMetni).not.toContain("HMK m.9");

    const ceza = runSystemRule("CMK_ISTINAF", d("2026-06-06"), { serviceMethod: "DURUSMADA" });
    expect(ceza.steps.map((s) => s.explanation).join(" ")).toContain("CMK m.39");
  });
});

describe("computeDeadline — tebligat yöntemi (7201 s.K.)", () => {
  it("ETEBLIGAT: tebliğ, ulaşma tarihini izleyen 5. günün sonunda yapılmış sayılır", () => {
    const result = runSystemRule("IIK_ODEME_EMRI_ITIRAZ", d("2026-06-02"), {
      serviceMethod: "ETEBLIGAT",
    });
    expect(stepDate(result, DEADLINE_STEP_CODES.TEBLIGAT_DUZELTMESI)).toBe("2026-06-07");
    expect(stepDate(result, DEADLINE_STEP_CODES.BASLANGIC)).toBe("2026-06-08");
    expect(stepDate(result, DEADLINE_STEP_CODES.SURE_EKLEME)).toBe("2026-06-14"); // Pazar
    expect(iso(result.dueDate)).toBe("2026-06-15"); // Pazartesi'ye kayar
    // Madde numarası "EK m.7/a" DEĞİL "m.7/a"dır (denetim bulgusu 11):
    // hüküm 7 nci maddeden sonra gelmek üzere eklenmiştir; 7201 s.K.'nın
    // ayrıca bağımsız "Ek Madde 1, Ek Madde 2…" maddeleri vardır.
    const duzeltme = result.steps.find(
      (s) => s.step === DEADLINE_STEP_CODES.TEBLIGAT_DUZELTMESI,
    )!.explanation;
    expect(duzeltme).toContain("Tebligat Kanunu m.7/a");
    expect(duzeltme).not.toContain("EK m.7/a");
  });

  it("ETEBLIGAT olmayan yöntemde 5 günlük ekleme yapılmaz", () => {
    const posta = runSystemRule("IIK_ODEME_EMRI_ITIRAZ", d("2026-06-02"), { serviceMethod: "POSTA" });
    const elektronik = runSystemRule("IIK_ODEME_EMRI_ITIRAZ", d("2026-06-02"), {
      serviceMethod: "ETEBLIGAT",
    });
    expect(iso(posta.dueDate)).toBe("2026-06-09");
    expect(iso(elektronik.dueDate)).toBe("2026-06-15");
  });

  it("DURUSMADA (tefhim): tebliğ tarihi duruşma tarihidir, ekleme yapılmaz", () => {
    const result = runSystemRule("CMK_ISTINAF", d("2026-06-02"), { serviceMethod: "DURUSMADA" });
    expect(stepDate(result, DEADLINE_STEP_CODES.TEBLIGAT_DUZELTMESI)).toBe("2026-06-02");
    expect(
      result.steps.find((s) => s.step === DEADLINE_STEP_CODES.TEBLIGAT_DUZELTMESI)!.explanation,
    ).toContain("tefhim");
    expect(iso(result.dueDate)).toBe("2026-06-09");
  });

  it("serviceMethod verilmezse düzeltme uygulanmaz", () => {
    const result = run({ triggerDate: d("2026-06-02"), rule: { durationValue: 7, durationUnit: "GUN", legalBasis: "TEST" } });
    expect(stepDate(result, DEADLINE_STEP_CODES.TEBLIGAT_DUZELTMESI)).toBe("2026-06-02");
    expect(iso(result.dueDate)).toBe("2026-06-09");
  });
});

describe("computeDeadline — HMK m.93 tatil kaydırması", () => {
  it("son gün cumartesiye rastlarsa pazartesiye kayar", () => {
    // 6 Haziran 2026 Cumartesi tebliğ + 7 gün → 13 Haziran Cumartesi → 15 Haziran Pazartesi
    const result = runSystemRule("IIK_ODEME_EMRI_ITIRAZ", d("2026-06-06"), { serviceMethod: "ELDEN" });
    expect(stepDate(result, DEADLINE_STEP_CODES.SURE_EKLEME)).toBe("2026-06-13");
    expect(iso(result.dueDate)).toBe("2026-06-15");
  });

  it("son gün resmî tatile rastlarsa ilk iş gününe kayar (23 Nisan)", () => {
    const result = runSystemRule("HMK_ISLAH_USUL_ISLEMI", d("2026-04-16"), { serviceMethod: "ELDEN" });
    expect(stepDate(result, DEADLINE_STEP_CODES.SURE_EKLEME)).toBe("2026-04-23");
    expect(iso(result.dueDate)).toBe("2026-04-24");
    const kaydirma = result.steps.find((s) => s.step === DEADLINE_STEP_CODES.TATIL_KAYDIRMASI)!;
    expect(kaydirma.explanation).toContain("HMK m.93");
    expect(kaydirma.explanation).toContain("Ulusal Egemenlik ve Çocuk Bayramı");
  });

  it("arka arkaya tatil: Kurban Bayramı + hafta sonu birlikte atlanır", () => {
    // 20 Mayıs 2026 Çarşamba + 1 hafta = 27 Mayıs (Kurban 1. gün)
    // 27-28-29 bayram, 30 Cmt (bayram 4. gün), 31 Paz → 1 Haziran Pazartesi
    const result = runSystemRule("HMK_ISLAH_USUL_ISLEMI", d("2026-05-20"), { serviceMethod: "ELDEN" });
    expect(stepDate(result, DEADLINE_STEP_CODES.SURE_EKLEME)).toBe("2026-05-27");
    expect(iso(result.dueDate)).toBe("2026-06-01");
    const kaydirma = result.steps.find((s) => s.step === DEADLINE_STEP_CODES.TATIL_KAYDIRMASI)!;
    expect(kaydirma.explanation).toContain("Kurban Bayramı 1. gün");
    expect(kaydirma.explanation).toContain("31.05.2026");
  });

  it("hafta sonu ile üst üste binen resmî tatil (30 Ağustos Pazar) tek gün kaydırır", () => {
    const result = run({
      triggerDate: d("2026-08-20"),
      rule: { durationValue: 10, durationUnit: "GUN", legalBasis: "TEST m.1" },
      applyJudicialRecess: false,
    });
    expect(stepDate(result, DEADLINE_STEP_CODES.SURE_EKLEME)).toBe("2026-08-30");
    // 31 Ağustos adli tatil içinde ama iş günüdür → süre burada biter.
    expect(iso(result.dueDate)).toBe("2026-08-31");
  });

  it("son gün iş günüyse kaydırma adımı 'kaydırma gerekmedi' der", () => {
    const result = runSystemRule("HMK_ISTINAF", d("2026-08-18"), { serviceMethod: "POSTA" });
    expect(
      result.steps.find((s) => s.step === DEADLINE_STEP_CODES.TATIL_KAYDIRMASI)!.explanation,
    ).toContain("kaydırma gerekmedi");
  });
});

describe("computeDeadline — adli tatil (HMK m.104 / İYUK m.8/3 / CMK m.331/4)", () => {
  const trigger = d("2026-08-10"); // Pazartesi; +2 hafta = 24 Ağustos (adli tatil içinde)

  it("kural adli tatile tabiyse süre, tatil bitiminden itibaren bir hafta uzar", () => {
    const result = runSystemRule("HMK_CEVAP", trigger, { serviceMethod: "POSTA" });
    expect(stepDate(result, DEADLINE_STEP_CODES.SURE_EKLEME)).toBe("2026-08-24");
    expect(stepDate(result, DEADLINE_STEP_CODES.ADLI_TATIL)).toBe("2026-09-07");
    expect(iso(result.dueDate)).toBe("2026-09-07");
    expect(
      result.steps.find((s) => s.step === DEADLINE_STEP_CODES.ADLI_TATIL)!.explanation,
    ).toContain("HMK m.104");
  });

  it("kural adli tatile tabi değilse uzama uygulanmaz ama uyarı üretilir", () => {
    const result = run({
      triggerDate: trigger,
      rule: { durationValue: 2, durationUnit: "HAFTA", legalBasis: "TEST m.1" },
      applyJudicialRecess: false,
    });
    expect(iso(result.dueDate)).toBe("2026-08-24");
    expect(result.steps.some((s) => s.step === DEADLINE_STEP_CODES.ADLI_TATIL)).toBe(false);
    expect(result.warnings.join(" ")).toContain("HMK m.104 uzaması UYGULANMADI");
  });

  it("İYUK m.8/3 rejimi bir gün daha uzatır (ara vermeyi İZLEYEN tarihten + 7 gün)", () => {
    const result = run({
      triggerDate: trigger,
      rule: { durationValue: 2, durationUnit: "HAFTA", legalBasis: "İYUK m.7 — 60 gün" },
      applyJudicialRecess: true,
      recessRule: "IYUK_8",
    });
    expect(iso(result.dueDate)).toBe("2026-09-08");
    expect(
      result.steps.find((s) => s.step === DEADLINE_STEP_CODES.ADLI_TATIL)!.explanation,
    ).toContain("İYUK m.8/3");
  });

  it("CMK m.331/4 rejimi üç gün uzatır ve lafzî nüans için uyarı bırakır", () => {
    const result = run({
      triggerDate: trigger,
      rule: { durationValue: 2, durationUnit: "HAFTA", legalBasis: "CMK m.273 — 7 gün" },
      applyJudicialRecess: true,
      recessRule: "CMK_331",
    });
    expect(iso(result.dueDate)).toBe("2026-09-03");
    expect(result.warnings.join(" ")).toContain("CMK m.331/4");
  });

  it("son gün adli tatil dışındaysa uzama uygulanmaz", () => {
    const result = runSystemRule("HMK_ISTINAF", d("2026-08-18"), { serviceMethod: "POSTA" });
    expect(result.steps.some((s) => s.step === DEADLINE_STEP_CODES.ADLI_TATIL)).toBe(false);
    expect(iso(result.dueDate)).toBe("2026-09-01");
  });
});

describe("computeDeadline — ay ve yıl birimleri", () => {
  it("31 Ocak + 1 ay → 28 Şubat (Cumartesi) → 2 Mart Pazartesi; sabitleme uyarısı verilir", () => {
    const result = run({
      triggerDate: d("2026-01-31"),
      rule: { durationValue: 1, durationUnit: "AY", legalBasis: "TEST m.1" },
    });
    expect(stepDate(result, DEADLINE_STEP_CODES.SURE_EKLEME)).toBe("2026-02-28");
    expect(iso(result.dueDate)).toBe("2026-03-02");
    expect(result.warnings.join(" ")).toContain("ayın son günü");
    expect(
      result.steps.find((s) => s.step === DEADLINE_STEP_CODES.SURE_EKLEME)!.explanation,
    ).toContain("m.92/2");
  });

  it("İİK m.67 — 1 yıllık süre (İtirazın iptali)", () => {
    const result = runSystemRule("IIK_ITIRAZIN_IPTALI", d("2026-03-10"), { serviceMethod: "ELDEN" });
    expect(iso(result.dueDate)).toBe("2027-03-10"); // Çarşamba
    expect(result.legalBasis).toBe("İİK m.67 — 1 yıl");
  });

  it("artık yıl: 29 Şubat 2024 + 1 yıl → 28 Şubat 2025 (Cuma)", () => {
    const result = run({
      triggerDate: d("2024-02-29"),
      rule: { durationValue: 1, durationUnit: "YIL", legalBasis: "TEST m.1" },
      holidays: [],
    });
    expect(iso(result.dueDate)).toBe("2025-02-28");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5) Gerçek senaryolar
// ═══════════════════════════════════════════════════════════════════════════

describe("gerçek senaryolar", () => {
  it("İYUK m.7 — 60 günlük idari dava açma süresi (tebliğ 15.06.2026)", () => {
    const result = runSystemRule("IYUK_DAVA_ACMA", d("2026-06-15"), { serviceMethod: "POSTA" });
    // 15.06 + 60 gün = 14.08.2026 → adli tatil içinde → İYUK m.8/3: 01.09 + 7 = 08.09.2026
    expect(stepDate(result, DEADLINE_STEP_CODES.SURE_EKLEME)).toBe("2026-08-14");
    expect(iso(result.dueDate)).toBe("2026-09-08");
  });

  it("İş K. m.20 — işe iade davası, adli tatilde işlemeye devam eder (HMK m.103/1-b)", () => {
    const result = runSystemRule("IS_ISE_IADE", d("2026-08-10"), { serviceMethod: "ELDEN" });
    expect(getSystemRule("IS_ISE_IADE").judicialRecessApplies).toBe(false);
    expect(iso(result.dueDate)).toBe("2026-08-24");
  });

  it("İİK m.62 — e-tebligatla ödeme emri, adli tatilde süre durmaz", () => {
    const result = runSystemRule("IIK_ODEME_EMRI_ITIRAZ", d("2026-08-10"), {
      serviceMethod: "ETEBLIGAT",
    });
    // 10.08 + 5 = 15.08 tebliğ sayılır, +7 gün = 22.08 Cumartesi → 24.08 Pazartesi
    expect(stepDate(result, DEADLINE_STEP_CODES.TEBLIGAT_DUZELTMESI)).toBe("2026-08-15");
    expect(iso(result.dueDate)).toBe("2026-08-24");
  });

  it("28 Ekim ARİFESİ yarım gündür: süre KAYMAZ, aynı gün biter (2429 s.K. m.2/A)", () => {
    // Denetim bulgusu 1 — kırmızıdan yeşile çevrilen test.
    // ESKİ (HATALI) davranış: 28 Ekim tam tatil sayılıp süre 30 Ekim'e kaydırılıyor,
    // avukata 2 gün fazladan süre var deniyordu. HMK m.93 yalnızca son gün
    // "resmî tatil gününe rastlarsa" kaydırır; arife günü tam tatil değildir,
    // saat 13.00'e kadar mesai vardır ve süre o gün sona erer.
    const result = runSystemRule("HMK_ISLAH_USUL_ISLEMI", d("2026-10-21"), { serviceMethod: "ELDEN" });
    expect(stepDate(result, DEADLINE_STEP_CODES.SURE_EKLEME)).toBe("2026-10-28");
    expect(iso(result.dueDate)).toBe("2026-10-28");
    expect(
      result.steps.find((s) => s.step === DEADLINE_STEP_CODES.TATIL_KAYDIRMASI)!.explanation,
    ).toContain("kaydırma gerekmedi");
    // Kullanıcı, işlemi 13.00'ten önce tamamlaması gerektiği konusunda uyarılır.
    expect(result.warnings.join(" ")).toContain("13.00'TEN ÖNCE");
  });

  it("HMK m.93 kaydırması son günü adli tatilin İÇİNE taşırsa m.104 uygulanır", () => {
    // Denetim bulgusu 5: ham son gün 19 Temmuz 2026 PAZAR → adli tatil dışında
    // görünür, uzama uygulanmaz; ardından m.93 kaydırması son günü 20 Temmuz'a
    // (adli tatilin İLK gününe) taşır. Sürenin fiilî bitişi adli tatile
    // düştüğüne göre m.104 uzaması burada da uygulanmalıdır.
    expect(d("2026-07-19").getUTCDay()).toBe(0); // Pazar — senaryo canlı
    const result = run({
      triggerDate: d("2026-07-05"),
      rule: { durationValue: 2, durationUnit: "HAFTA", legalBasis: "TEST m.1" },
      applyJudicialRecess: true,
    });
    expect(stepDate(result, DEADLINE_STEP_CODES.SURE_EKLEME)).toBe("2026-07-19");
    expect(iso(result.dueDate)).toBe("2026-09-07");
    const adliTatil = result.steps.find((s) => s.step === DEADLINE_STEP_CODES.ADLI_TATIL)!;
    expect(adliTatil.explanation).toContain("adli tatilin içine taşımıştır");
  });

  it("CMK: süre adli tatilin İÇİNDEN GEÇİP sonra bitse de tolling uyarısı verilir", () => {
    // Denetim bulgusu 6: eski kod uyarıyı yalnızca uzama uygulandığında
    // üretiyordu; süre tatilin içinden geçip 31 Ağustos'tan SONRA bitiyorsa
    // ne uzama ne uyarı çıkıyordu (sessiz risk).
    // CMK_TEMYIZ, tefhim 25.08.2026 → 15 gün → 09.09.2026.
    const result = runSystemRule("CMK_TEMYIZ", d("2026-08-25"), { serviceMethod: "DURUSMADA" });
    expect(iso(result.dueDate)).toBe("2026-09-09");
    expect(result.steps.some((s) => s.step === DEADLINE_STEP_CODES.ADLI_TATIL)).toBe(false);
    expect(result.warnings.join(" ")).toContain("İŞLEMEZ");
    expect(result.warnings.join(" ")).toContain("CMK m.331/4");
  });

  it("2027'ye taşan hesapta 1 Ocak resmî tatili UYGULANIR (yalnızca uyarı değil)", () => {
    // Denetim bulgusu 10: HMK_ISTINAF, tebliğ 18.12.2026 Cuma + 2 hafta =
    // 01.01.2027 Cuma = Yılbaşı. Hafta içi olduğu için hafta sonu kontrolü de
    // yakalamaz; takvim yüklü olmadığı için eski motor 01.01.2027 diyordu.
    const result = runSystemRule("HMK_ISTINAF", d("2026-12-18"), { serviceMethod: "ELDEN" });
    expect(stepDate(result, DEADLINE_STEP_CODES.SURE_EKLEME)).toBe("2027-01-01");
    expect(iso(result.dueDate)).toBe("2027-01-04"); // Pazartesi
    expect(
      result.steps.find((s) => s.step === DEADLINE_STEP_CODES.TATIL_KAYDIRMASI)!.explanation,
    ).toContain("Yılbaşı");
    // Dinî bayramlar hâlâ eksik olduğu için uyarı korunur.
    expect(result.warnings.join(" ")).toContain("2027 yılı tatil takvimi yüklü değil");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6) Uyarılar (warnings)
// ═══════════════════════════════════════════════════════════════════════════

describe("uyarılar", () => {
  it("yaklaşık (hicri) bayram tarihi hesabı etkiliyorsa teyit uyarısı verir", () => {
    const result = runSystemRule("HMK_ISLAH_USUL_ISLEMI", d("2026-05-20"), { serviceMethod: "ELDEN" });
    expect(result.warnings.join(" ")).toContain("hicri takvime bağlıdır");
    expect(result.warnings.join(" ")).toContain("Kurban Bayramı");
  });

  it("SON GÜN yarım güne rastlarsa 13.00 uyarısı verir (kaydırma yerine)", () => {
    const result = runSystemRule("HMK_ISLAH_USUL_ISLEMI", d("2026-10-21"), { serviceMethod: "ELDEN" });
    expect(iso(result.dueDate)).toBe("2026-10-28");
    expect(result.warnings.join(" ")).toContain("yarım gün tatildir");
    expect(result.warnings.join(" ")).toContain("2429 sayılı Kanun m.2/A");
  });

  it("tatil takvimi hiç verilmezse uyarır", () => {
    const result = run({
      triggerDate: d("2026-04-16"),
      rule: { durationValue: 1, durationUnit: "HAFTA", legalBasis: "TEST m.1" },
      holidays: [],
    });
    expect(result.warnings.join(" ")).toContain("Tatil takvimi verilmedi");
    // Takvim yokken 23 Nisan (Perşembe) tatil sayılmaz.
    expect(iso(result.dueDate)).toBe("2026-04-23");
  });

  it("son gün takvimi yüklü olmayan bir yıla taşarsa uyarır", () => {
    const result = runSystemRule("HMK_ISTINAF", d("2026-12-28"), { serviceMethod: "ELDEN" });
    expect(iso(result.dueDate)).toBe("2027-01-11");
    expect(result.warnings.join(" ")).toContain("2027 yılı tatil takvimi yüklü değil");
    // Uyarı, sabit tarihli tatillerin otomatik katıldığını da bildirmelidir.
    expect(result.warnings.join(" ")).toContain("OTOMATİK");
  });

  it("temiz senaryoda gereksiz uyarı üretmez", () => {
    const result = runSystemRule("HMK_ISTINAF", d("2026-08-18"), { serviceMethod: "POSTA" });
    expect(result.warnings).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7) Girdi doğrulama, saflık ve determinizm
// ═══════════════════════════════════════════════════════════════════════════

describe("girdi doğrulama ve determinizm", () => {
  it("geçersiz tarihi Türkçe hata ile reddeder", () => {
    expect(() =>
      run({
        triggerDate: new Date("olmayan-tarih"),
        rule: { durationValue: 1, durationUnit: "GUN", legalBasis: "TEST" },
      }),
    ).toThrow(/Geçersiz tetik tarihi/);
    expect(() =>
      run({
        // @ts-expect-error — kasten eksik tarih
        triggerDate: null,
        rule: { durationValue: 1, durationUnit: "GUN", legalBasis: "TEST" },
      }),
    ).toThrow(/zorunludur/);
  });

  it("geçersiz süre değerini ve birimini reddeder", () => {
    expect(() =>
      run({ triggerDate: d("2026-06-02"), rule: { durationValue: 0, durationUnit: "GUN", legalBasis: "T" } }),
    ).toThrow(/pozitif bir tam sayı/);
    expect(() =>
      run({
        triggerDate: d("2026-06-02"),
        // @ts-expect-error — kasten geçersiz birim
        rule: { durationValue: 1, durationUnit: "SAAT", legalBasis: "T" },
      }),
    ).toThrow(/Bilinmeyen süre birimi/);
  });

  it("girdi Date nesnesini değiştirmez ve sonucu dışarıdan bozulmaz", () => {
    const trigger = d("2026-08-18");
    const result = runSystemRule("HMK_ISTINAF", trigger, { serviceMethod: "POSTA" });
    expect(iso(trigger)).toBe("2026-08-18");
    const sonGun = result.steps.find((s) => s.step === DEADLINE_STEP_CODES.SON_GUN)!;
    result.dueDate.setUTCFullYear(1999);
    expect(iso(sonGun.date)).toBe("2026-09-01");
  });

  it("aynı girdi her zaman aynı sonucu verir (determinizm)", () => {
    const a = runSystemRule("HMK_CEVAP", d("2026-08-10"), { serviceMethod: "ETEBLIGAT" });
    const b = runSystemRule("HMK_CEVAP", d("2026-08-10"), { serviceMethod: "ETEBLIGAT" });
    expect(iso(a.dueDate)).toBe(iso(b.dueDate));
    expect(a.steps.map((s) => `${s.step}:${iso(s.date)}`)).toEqual(
      b.steps.map((s) => `${s.step}:${iso(s.date)}`),
    );
    expect(a.warnings).toEqual(b.warnings);
  });

  it("saat bileşeni taşıyan tetik tarihi sonucu değiştirmez", () => {
    const withTime = runSystemRule("HMK_ISTINAF", new Date("2026-08-18T23:59:59.999Z"), {
      serviceMethod: "POSTA",
    });
    expect(iso(withTime.dueDate)).toBe("2026-09-01");
    expect(withTime.dueDate.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8) Sistem kural seti — packages/db seed'i ile tutarlılık
// ═══════════════════════════════════════════════════════════════════════════

describe("sistem kural seti", () => {
  it("kural sayısı beklenen değerdedir ve anahtarlar tekildir", () => {
    // Eşik, set büyüklüğüne SABİTLENMİŞTİR: eski `>= 12` eşiği 18 kurallık bir
    // sette kural silinmesini yakalamıyordu (denetim bulgusu 15).
    expect(SYSTEM_DEADLINE_RULES).toHaveLength(22);
    expect(new Set(SYSTEM_DEADLINE_RULE_KEYS).size).toBe(SYSTEM_DEADLINE_RULES.length);
  });

  it("her kuralda mevzuat maddesi referansı ve geçerli süre tanımı vardır", () => {
    for (const rule of SYSTEM_DEADLINE_RULES) {
      expect(rule.legalBasis).toMatch(/m\.\d+/);
      expect(rule.durationValue).toBeGreaterThan(0);
      expect(["GUN", "HAFTA", "AY", "YIL"]).toContain(rule.durationUnit);
      expect(rule.caseTypes.length).toBeGreaterThan(0);
      expect(rule.name.length).toBeGreaterThan(0);
      expect(rule.procedureCode).toBeDefined();
    }
  });

  it("DEĞİŞMEZ: legalBasis içindeki süre, durationValue/durationUnit ile aynıdır", () => {
    // Denetim bulgusu 15(b): eski test yalnızca BİÇİM denetliyordu
    // (`/m\.\d+/`), bu yüzden "İİK m.96 — 7 gün" gibi içerik olarak yanlış bir
    // satır da testten geçiyordu. Bu değişmez, dayanak metni ile sayısal
    // süre alanlarının ayrışmasını yakalar.
    const UNIT_WORD: Record<string, string> = {
      GUN: "gün",
      HAFTA: "hafta",
      AY: "ay",
      YIL: "yıl",
    };
    for (const rule of SYSTEM_DEADLINE_RULES) {
      const match = /—\s*(\d+)\s+(gün|hafta|ay|yıl)\s*$/.exec(rule.legalBasis);
      expect(match, `legalBasis çözümlenemedi: ${rule.key} → "${rule.legalBasis}"`).not.toBeNull();
      expect(Number(match![1]), `${rule.key} süre değeri uyuşmuyor`).toBe(rule.durationValue);
      expect(match![2], `${rule.key} süre birimi uyuşmuyor`).toBe(UNIT_WORD[rule.durationUnit]);
    }
  });

  it("ALTIN VAKA: elle hesaplanmış kanuni süreler", () => {
    // Kodun çıktısı teste yapıştırılmamıştır; her satır madde metninden
    // elle doğrulanmıştır (denetim bulgusu 15(a)).
    const beklenen: Array<[string, number, string, string]> = [
      ["HMK_CEVAP", 2, "HAFTA", "HMK m.127 — 2 hafta"],
      ["HMK_CEVABA_CEVAP", 2, "HAFTA", "HMK m.136 — 2 hafta"],
      ["HMK_IKINCI_CEVAP", 2, "HAFTA", "HMK m.136 — 2 hafta"],
      ["HMK_BILIRKISI_ITIRAZ", 2, "HAFTA", "HMK m.281 — 2 hafta"],
      ["HMK_ISLAH_USUL_ISLEMI", 1, "HAFTA", "HMK m.181 — 1 hafta"],
      ["HMK_ISTINAF", 2, "HAFTA", "HMK m.345 — 2 hafta"],
      ["HMK_TEMYIZ", 2, "HAFTA", "HMK m.361 — 2 hafta"],
      ["HMK_ISTINAFA_CEVAP", 2, "HAFTA", "HMK m.347 — 2 hafta"],
      ["HMK_TEMYIZE_CEVAP", 2, "HAFTA", "HMK m.365 — 2 hafta"],
      ["IIK_ODEME_EMRI_ITIRAZ", 7, "GUN", "İİK m.62 — 7 gün"],
      // İİK m.168/5 — kambiyo takibinde itiraz 5 GÜNDÜR (m.62'nin 7 günü DEĞİL).
      ["IIK_KAMBIYO_ODEME_EMRI_ITIRAZ", 5, "GUN", "İİK m.168/5 — 5 gün"],
      // İİK m.96/2 — istihkak iddiasına karşı diyecekleri bildirme: ÜÇ GÜN.
      ["IIK_ISTIHKAK_ITIRAZ", 3, "GUN", "İİK m.96/2 — 3 gün"],
      // 7 günlük süre m.96'ya değil, istihkak DAVASI açma mühletine aittir.
      ["IIK_ISTIHKAK_DAVA", 7, "GUN", "İİK m.97 — 7 gün"],
      ["IIK_IHALENIN_FESHI", 7, "GUN", "İİK m.134 — 7 gün"],
      ["IIK_SIKAYET", 7, "GUN", "İİK m.16 — 7 gün"],
      ["IIK_ITIRAZIN_IPTALI", 1, "YIL", "İİK m.67 — 1 yıl"],
      ["CMK_ISTINAF", 7, "GUN", "CMK m.273 — 7 gün"],
      ["CMK_TEMYIZ", 15, "GUN", "CMK m.291 — 15 gün"],
      ["IYUK_DAVA_ACMA", 60, "GUN", "İYUK m.7/1 — 60 gün"],
      // İYUK m.7/1 — vergi mahkemelerinde dava açma süresi 30 GÜNDÜR.
      ["IYUK_VERGI_DAVA_ACMA", 30, "GUN", "İYUK m.7/1 — 30 gün"],
      ["TUKETICI_HAKEM_ITIRAZ", 15, "GUN", "6502 sayılı TKHK m.70/3 — 15 gün"],
      ["IS_ISE_IADE", 2, "HAFTA", "4857 sayılı İş K. m.20 — 2 hafta"],
    ];
    expect(beklenen).toHaveLength(SYSTEM_DEADLINE_RULES.length);
    for (const [key, value, unit, basis] of beklenen) {
      expect(toRuleInput(getSystemRule(key))).toEqual({
        durationValue: value,
        durationUnit: unit,
        legalBasis: basis,
      });
    }
  });

  it("adli tatilde işlemeye devam eden süreler m.104 uzamasına tabi değildir", () => {
    // İcra takip süreleri: HMK m.104 yalnızca "BU KANUNUN tayin ettiği
    // süreler"i kapsar; İİK m.19'da adli tatil uzaması öngörülmemiştir.
    // İşçi davaları: HMK m.103/1-ç ("Hizmet akdi veya iş sözleşmesi sebebiyle
    // işçilerin açtıkları davalar") — adli tatilde de görülür.
    for (const key of [
      "IIK_ODEME_EMRI_ITIRAZ",
      "IIK_KAMBIYO_ODEME_EMRI_ITIRAZ",
      "IIK_SIKAYET",
      "IIK_ISTIHKAK_ITIRAZ",
      "IS_ISE_IADE",
    ]) {
      expect(getSystemRule(key).judicialRecessApplies).toBe(false);
    }
    for (const key of ["HMK_CEVAP", "HMK_ISTINAF", "HMK_TEMYIZ"]) {
      expect(getSystemRule(key).judicialRecessApplies).toBe(true);
    }
  });

  it("adli tatil rejimi ve usul kanunu yargı koluna göre doğrudur", () => {
    // Denetim bulgusu 3: rejim, kullanıcı girdisinden değil KURALDAN gelmelidir.
    expect(getSystemRule("CMK_ISTINAF").recessRule).toBe("CMK_331");
    expect(getSystemRule("CMK_TEMYIZ").recessRule).toBe("CMK_331");
    expect(getSystemRule("IYUK_DAVA_ACMA").recessRule).toBe("IYUK_8");
    expect(getSystemRule("IYUK_VERGI_DAVA_ACMA").recessRule).toBe("IYUK_8");
    expect(getSystemRule("HMK_CEVAP").recessRule).toBeUndefined(); // varsayılan HMK_104
    expect(getSystemRule("IIK_SIKAYET").procedureCode).toBe("IIK");
    expect(getSystemRule("CMK_TEMYIZ").procedureCode).toBe("CMK");
    expect(getSystemRule("IYUK_DAVA_ACMA").procedureCode).toBe("IYUK");
  });

  it("CMK istinaf/temyizde CMK m.331/4 (+3 gün) uygulanır, HMK m.104 (+7) DEĞİL", () => {
    // Denetim bulgusu 3: rejim API'ye ulaşmadığı için ceza istinaf/temyiz
    // süresi 4 gün GEÇ hesaplanıyordu (07.09 yerine 03.09 olmalı).
    const result = runSystemRule("CMK_ISTINAF", d("2026-08-18"), { serviceMethod: "DURUSMADA" });
    expect(stepDate(result, DEADLINE_STEP_CODES.SURE_EKLEME)).toBe("2026-08-25");
    expect(iso(result.dueDate)).toBe("2026-09-03");
    expect(
      result.steps.find((s) => s.step === DEADLINE_STEP_CODES.ADLI_TATIL)!.explanation,
    ).toContain("CMK m.331/4");
  });

  it("dosya türüne göre kural süzer ve bilinmeyen anahtarda hata verir", () => {
    expect(systemRulesForCaseType("CEZA").map((r) => r.key)).toEqual(["CMK_ISTINAF", "CMK_TEMYIZ"]);
    expect(systemRulesForCaseType("ICRA").length).toBeGreaterThan(0);
    expect(findSystemRule("YOK_BOYLE_BIR_KURAL")).toBeUndefined();
    expect(() => getSystemRule("YOK_BOYLE_BIR_KURAL")).toThrow(/Bilinmeyen süre kuralı/);
  });

  it("her sistem kuralı motorda hatasız çalışır", () => {
    for (const rule of SYSTEM_DEADLINE_RULES) {
      const result = runSystemRule(rule.key, d("2026-03-10"), { serviceMethod: "POSTA" });
      expect(result.dueDate.getTime()).toBeGreaterThan(d("2026-03-10").getTime());
      expect(isNonWorkingDay(result.dueDate, HOLIDAYS_2026)).toBe(false);
      expect(result.steps.length).toBeGreaterThanOrEqual(6);
    }
  });
});
