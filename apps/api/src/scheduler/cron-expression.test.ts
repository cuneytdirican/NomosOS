import { describe, expect, it } from "vitest";
import { isValidCron, nextRun, parseCron, safeNextRun } from "./cron-expression";

/**
 * CRON AYRIŞTIRMA VE SONRAKİ ÇALIŞMA HESABI.
 *
 * İki şey korunur:
 *  1. BOZUK İFADE KAYDEDİLEMEZ. Sessizce kabul edilen bir ifade, işin bir daha
 *     hiç çalışmaması demektir ve bu ancak günler sonra fark edilir.
 *  2. SAAT DİLİMİ TÜRKİYE'DİR. "0 7 * * *" avukatın sabah 07:00'ıdır; UTC
 *     olarak yorumlansaydı hatırlatmalar 10:00'da giderdi.
 */

/** Beklenen UTC anını okunur yazmak için. */
function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

describe("parseCron", () => {
  it("basit günlük ifadeyi çözer", () => {
    const spec = parseCron("0 7 * * *");
    expect(spec.minutes).toEqual([0]);
    expect(spec.hours).toEqual([7]);
    expect(spec.domRestricted).toBe(false);
    expect(spec.dowRestricted).toBe(false);
  });

  it("liste, aralık ve adım söz dizimini çözer", () => {
    expect(parseCron("0,30 9-11 * * *").minutes).toEqual([0, 30]);
    expect(parseCron("0,30 9-11 * * *").hours).toEqual([9, 10, 11]);
    expect(parseCron("*/15 * * * *").minutes).toEqual([0, 15, 30, 45]);
    expect(parseCron("0 0-23/6 * * *").hours).toEqual([0, 6, 12, 18]);
  });

  it("gün ve ay adlarını kabul eder; 7'yi Pazar (0) olarak indirger", () => {
    expect(parseCron("0 9 * * mon-fri").daysOfWeek).toEqual([1, 2, 3, 4, 5]);
    expect(parseCron("0 9 1 jan *").months).toEqual([1]);
    expect(parseCron("0 9 * * 7").daysOfWeek).toEqual([0]);
  });

  it("alan sayısı yanlışsa Türkçe hata verir", () => {
    expect(() => parseCron("0 7 * *")).toThrow(/5 alanlı/);
    expect(() => parseCron("0 7 * * * *")).toThrow(/5 alanlı/);
  });

  it("aralık dışı değeri reddeder", () => {
    expect(() => parseCron("0 25 * * *")).toThrow(/0-23/);
    expect(() => parseCron("60 7 * * *")).toThrow(/0-59/);
  });

  it("takma adları ve desteklenmeyen uzantıları AÇIKÇA reddeder", () => {
    // Sessizce kabul edip yanlış zamanda çalışmaktansa kaydı reddetmek yeğdir.
    expect(() => parseCron("@daily")).toThrow(/takma ad/i);
    expect(() => parseCron("0 7 L * *")).toThrow(/anlaşılmayan/);
    expect(() => parseCron("0 7 * * 1#2")).toThrow(/anlaşılmayan/);
  });

  it("ters aralığı ve geçersiz adımı reddeder", () => {
    expect(() => parseCron("0 17-9 * * *")).toThrow(/aralığın başı/);
    expect(() => parseCron("*/0 * * * *")).toThrow(/adım/);
  });

  it("isValidCron fırlatmaz", () => {
    expect(isValidCron("0 7 * * *")).toBe(true);
    expect(isValidCron("saçmalık")).toBe(false);
  });
});

describe("nextRun — Türkiye yerel saati (UTC+3)", () => {
  it("07:00 TR = 04:00 UTC", () => {
    const spec = parseCron("0 7 * * *");
    // 01.09.2026 00:00 UTC = 03:00 TR → aynı günün 07:00 TR'si henüz gelmedi.
    expect(iso(nextRun(spec, new Date("2026-09-01T00:00:00.000Z")))).toBe(
      "2026-09-01T04:00:00.000Z"
    );
  });

  it("tetiklendiği dakikayı SONRAKİ çalışma saymaz", () => {
    const spec = parseCron("0 7 * * *");
    // Tam 07:00 TR (=04:00Z) anında sorulduğunda cevap ERTESİ gündür;
    // aksi hâlde iş "şimdi çalışacak" deyip aynı anı sonsuza dek gösterirdi.
    expect(iso(nextRun(spec, new Date("2026-09-01T04:00:00.000Z")))).toBe(
      "2026-09-02T04:00:00.000Z"
    );
  });

  it("gece yarısını TR'ye göre aşar (UTC gününe göre değil)", () => {
    const spec = parseCron("0 1 * * *"); // 01:00 TR = 22:00 UTC (önceki gün)
    expect(iso(nextRun(spec, new Date("2026-09-01T12:00:00.000Z")))).toBe(
      "2026-09-01T22:00:00.000Z"
    );
  });

  it("18:00 TR akşam duruşma hatırlatması = 15:00 UTC", () => {
    const spec = parseCron("0 18 * * *");
    expect(iso(nextRun(spec, new Date("2026-09-01T10:00:00.000Z")))).toBe(
      "2026-09-01T15:00:00.000Z"
    );
  });

  it("haftanın günü kısıtını uygular", () => {
    const spec = parseCron("0 9 * * mon");
    // 2026-09-01 Salı → sonraki Pazartesi 2026-09-07, 09:00 TR = 06:00 UTC.
    expect(iso(nextRun(spec, new Date("2026-09-01T12:00:00.000Z")))).toBe(
      "2026-09-07T06:00:00.000Z"
    );
  });

  it("ay-günü ve hafta-günü birlikte kısıtlıysa VEYA uygular (Vixie cron)", () => {
    const spec = parseCron("0 9 15 * mon");
    // 2026-09-01 Salı. Sonraki Pazartesi 07.09; ayın 15'i 15.09.
    // VEYA semantiği gereği önce gelen kazanır: 07.09.
    expect(iso(nextRun(spec, new Date("2026-09-01T12:00:00.000Z")))).toBe(
      "2026-09-07T06:00:00.000Z"
    );
  });

  it("ay sınırını ve yıl sınırını aşar", () => {
    const spec = parseCron("0 3 1 1 *"); // 1 Ocak 03:00 TR
    expect(iso(nextRun(spec, new Date("2026-09-01T00:00:00.000Z")))).toBe(
      "2027-01-01T00:00:00.000Z"
    );
  });

  it("29 Şubat gibi seyrek tarihleri artık yılda bulur", () => {
    const spec = parseCron("0 12 29 2 *");
    const result = nextRun(spec, new Date("2027-03-01T00:00:00.000Z"));
    expect(iso(result)).toBe("2028-02-29T09:00:00.000Z");
  });

  it("hiç gerçekleşmeyen ifadede sonsuz döngüye girmez, null döner", () => {
    // 30 Şubat yoktur; tarama sınırı dolar ve null dönülür.
    expect(nextRun(parseCron("0 12 30 2 *"), new Date("2026-01-01T00:00:00.000Z"))).toBeNull();
  });

  it("safeNextRun bozuk ifadede FIRLATMAZ — tek satır liste ucunu düşürmez", () => {
    expect(safeNextRun("bozuk ifade", new Date())).toBeNull();
    expect(safeNextRun("0 2 * * *", new Date("2026-09-01T00:00:00.000Z"))).toBeInstanceOf(Date);
  });
});

describe("tohumlanan cron ifadeleri", () => {
  // seed.ts ve iş sınıflarındaki varsayılanlar geçerli olmak ZORUNDA;
  // biri bozulursa o iş hiç zamanlanmaz ve bu sessizce olur.
  const seeded = ["0 2 * * *", "0 7 * * *", "0 18 * * *", "0 3 * * *", "0 1 * * *"];

  it("hepsi geçerlidir ve gelecekte bir çalışma anı üretir", () => {
    const from = new Date("2026-09-01T00:00:00.000Z");
    for (const expression of seeded) {
      expect(isValidCron(expression)).toBe(true);
      const next = nextRun(parseCron(expression), from);
      expect(next).toBeInstanceOf(Date);
      expect(next!.getTime()).toBeGreaterThan(from.getTime());
    }
  });
});
