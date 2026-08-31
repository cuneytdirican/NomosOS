/**
 * Dönem çözümü testleri.
 *
 * ORTAK KARAR 2'nin sınavı: "rapor dönemleri kapanış tarihi DAHİL/HARİÇ açıkça
 * belirtilir". Kapanış gününün bir gün kayması, aylık ciro raporunda ayın son
 * gününü sessizce düşürür — bu yüzden sınır davranışı testle çivilenir.
 */

import { describe, expect, it } from "vitest";
import { previousPeriod, resolveReportParams, MAX_PERIOD_DAYS } from "./report-params";

const NOW = new Date("2026-08-31T09:15:00.000Z");
const OPTS = { supportsComparison: true };

function iso(date: Date): string {
  return date.toISOString();
}

describe("özel dönem (from/to)", () => {
  it("varsayılan olarak kapanış günü DAHİLDİR", () => {
    const { params } = resolveReportParams({ from: "2026-08-01", to: "2026-08-31" }, NOW, OPTS);
    expect(iso(params.period.from)).toBe("2026-08-01T00:00:00.000Z");
    expect(iso(params.period.to)).toBe("2026-08-31T00:00:00.000Z");
    // Üst sınır HARİÇTİR: 31 Ağustos 23:59'daki kayıt rapora girer.
    expect(iso(params.period.endExclusive)).toBe("2026-09-01T00:00:00.000Z");
    expect(params.period.days).toBe(31);
    expect(params.period.endInclusive).toBe(true);
  });

  it("donemBitisDahil=false verildiğinde kapanış günü DIŞARIDA kalır", () => {
    const { params } = resolveReportParams(
      { from: "2026-08-01", to: "2026-09-01", donemBitisDahil: "false" },
      NOW,
      OPTS,
    );
    expect(iso(params.period.endExclusive)).toBe("2026-09-01T00:00:00.000Z");
    expect(iso(params.period.to)).toBe("2026-08-31T00:00:00.000Z");
    expect(params.period.days).toBe(31);
    expect(params.period.endInclusive).toBe(false);
    expect(params.period.label).toContain("HARİÇ");
  });

  it("aynı gün seçildiğinde tek günlük dönem üretir", () => {
    const { params } = resolveReportParams({ from: "2026-08-15", to: "2026-08-15" }, NOW, OPTS);
    expect(params.period.days).toBe(1);
  });

  it("bitiş başlangıçtan önceyse 400 fırlatır", () => {
    expect(() =>
      resolveReportParams({ from: "2026-08-31", to: "2026-08-01" }, NOW, OPTS),
    ).toThrow();
  });

  it("bitiş hariç seçildiğinde sıfır günlük aralık reddedilir", () => {
    expect(() =>
      resolveReportParams(
        { from: "2026-08-15", to: "2026-08-15", donemBitisDahil: false },
        NOW,
        OPTS,
      ),
    ).toThrow();
  });

  it("from/to tek başına verilemez", () => {
    expect(() => resolveReportParams({ from: "2026-08-01" }, NOW, OPTS)).toThrow();
    expect(() => resolveReportParams({ to: "2026-08-01" }, NOW, OPTS)).toThrow();
  });

  it("üst sınırı aşan dönem reddedilir (sessizce kırpılmaz)", () => {
    expect(() =>
      resolveReportParams({ from: "2000-01-01", to: "2026-08-31" }, NOW, OPTS),
    ).toThrow(new RegExp(String(MAX_PERIOD_DAYS)));
  });
});

describe("ön tanımlı dönemler", () => {
  it("BU_AY ayın 1'inden bugüne (dâhil) kadardır", () => {
    const { params } = resolveReportParams({ donem: "BU_AY" }, NOW, OPTS);
    expect(iso(params.period.from)).toBe("2026-08-01T00:00:00.000Z");
    expect(iso(params.period.to)).toBe("2026-08-31T00:00:00.000Z");
  });

  it("GECEN_AY tam takvim ayıdır", () => {
    const { params } = resolveReportParams({ donem: "GECEN_AY" }, NOW, OPTS);
    expect(iso(params.period.from)).toBe("2026-07-01T00:00:00.000Z");
    expect(iso(params.period.to)).toBe("2026-07-31T00:00:00.000Z");
    expect(params.period.days).toBe(31);
  });

  it("SON_30_GUN bugünü DAHİL 30 gündür", () => {
    const { params } = resolveReportParams({ donem: "SON_30_GUN" }, NOW, OPTS);
    expect(params.period.days).toBe(30);
    expect(iso(params.period.to)).toBe("2026-08-31T00:00:00.000Z");
  });

  it("BU_CEYREK çeyreğin ilk gününden başlar", () => {
    const { params } = resolveReportParams({ donem: "BU_CEYREK" }, NOW, OPTS);
    expect(iso(params.period.from)).toBe("2026-07-01T00:00:00.000Z");
  });

  it("ön tanımlı dönemde donemBitisDahil=false yok sayılır ve UYARI döner", () => {
    const { params, warnings } = resolveReportParams(
      { donem: "GECEN_AY", donemBitisDahil: false },
      NOW,
      OPTS,
    );
    expect(params.period.endInclusive).toBe(true);
    expect(warnings.join(" ")).toContain("donemBitisDahil");
  });

  it("geçersiz ön tanım reddedilir", () => {
    expect(() => resolveReportParams({ donem: "GECEN_HAFTA" }, NOW, OPTS)).toThrow();
  });
});

describe("karşılaştırma dönemi", () => {
  it("bitişiktir ve ÇAKIŞMAZ", () => {
    const { params } = resolveReportParams({ from: "2026-08-01", to: "2026-08-31" }, NOW, OPTS);
    const prev = previousPeriod(params.period);
    expect(iso(prev.endExclusive)).toBe(iso(params.period.from));
    expect(prev.days).toBe(params.period.days);
    expect(iso(prev.from)).toBe("2026-07-01T00:00:00.000Z");
  });

  it("eşit uzunluktadır — ay uzunluğu farkı yüzdeyi bozmaz", () => {
    // Temmuz 31, Haziran 30 gün. Karşılaştırma yine 31 günlük pencere olmalı.
    const { params } = resolveReportParams({ from: "2026-07-01", to: "2026-07-31" }, NOW, OPTS);
    const prev = previousPeriod(params.period);
    expect(prev.days).toBe(31);
    expect(iso(prev.from)).toBe("2026-05-31T00:00:00.000Z");
  });

  it("rapor karşılaştırmayı desteklemiyorsa üretilmez", () => {
    const { params } = resolveReportParams({ donem: "BU_AY" }, NOW, {
      supportsComparison: false,
    });
    expect(params.comparison).toBeUndefined();
  });

  it("karsilastir=false verilirse üretilmez", () => {
    const { params } = resolveReportParams({ donem: "BU_AY", karsilastir: "false" }, NOW, OPTS);
    expect(params.comparison).toBeUndefined();
  });
});

describe("diğer parametreler", () => {
  it("limit üst sınıra oturur", () => {
    expect(resolveReportParams({ limit: "999999" }, NOW, OPTS).params.limit).toBe(5000);
    expect(resolveReportParams({ limit: "0" }, NOW, OPTS).params.limit).toBe(1);
    expect(resolveReportParams({}, NOW, OPTS).params.limit).toBe(500);
  });

  it("yaşlandırma kovaları artan olmalıdır", () => {
    expect(resolveReportParams({ kovalarGun: "30,60,90" }, NOW, OPTS).params.agingBuckets).toEqual([
      30, 60, 90,
    ]);
    expect(() => resolveReportParams({ kovalarGun: "60,30" }, NOW, OPTS)).toThrow();
    expect(() => resolveReportParams({ kovalarGun: "0,30" }, NOW, OPTS)).toThrow();
    expect(() => resolveReportParams({ kovalarGun: "abc" }, NOW, OPTS)).toThrow();
  });

  it("geçersiz kimlik reddedilir (SQL'e ham metin geçmez)", () => {
    expect(() => resolveReportParams({ kullaniciId: "'; DROP TABLE" }, NOW, OPTS)).toThrow();
    expect(() => resolveReportParams({ muvekkilId: "123" }, NOW, OPTS)).toThrow();
  });

  it("geçersiz dosya türü reddedilir", () => {
    expect(() => resolveReportParams({ dosyaTuru: "BOSANMA" }, NOW, OPTS)).toThrow();
    expect(resolveReportParams({ dosyaTuru: "ICRA" }, NOW, OPTS).params.caseType).toBe("ICRA");
  });

  it("ham parametreler denetim kaydı için korunur", () => {
    const raw = { donem: "BU_AY", limit: "10" };
    expect(resolveReportParams(raw, NOW, OPTS).params.raw).toBe(raw);
  });
});
