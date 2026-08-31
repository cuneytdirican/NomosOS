/**
 * Türkiye resmî tatil takvimi ve adli tatil (adli ara verme) yardımcıları.
 *
 * Hukuki dayanaklar:
 * - 2429 sayılı Ulusal Bayram ve Genel Tatiller Hakkında Kanun (resmî tatiller).
 * - HMK m.102: "Adli tatil, her yıl yirmi temmuzda başlar, otuz bir ağustosta sona erer."
 * - İYUK m.61: İdari yargıda çalışmaya ara verme de 20 Temmuz – 31 Ağustos arasıdır.
 *
 * DİKKAT — dinî bayramlar: Ramazan ve Kurban Bayramı tarihleri hicri takvime bağlıdır
 * ve resmî ilanla kesinleşir. Aşağıdaki tarihler hesaplanmış/öngörülmüş tarihlerdir,
 * adlarında `(yaklaşık)` ibaresi taşır ve süre motoru bunlara denk gelen hesaplarda
 * `warnings[]` üretir.
 */

import {
  addDays,
  dateOnly,
  isWeekend,
  parseDateOnly,
  toIsoDateKey,
  toUtcDate,
} from "./date-utils";
import type { HolidayInput, HolidayType } from "./types";

/**
 * Dinî bayram gibi kesinleşmemiş tarihleri işaretleyen ibare.
 *
 * Yalnızca İNSAN OKUR metin içindir; motor kararları `isApproximate`
 * bayrağına dayanır (string arama kırılgandır).
 */
export const APPROXIMATE_HOLIDAY_MARKER = "(yaklaşık)";

/**
 * Yarım gün tatilleri işaretleyen ibare (ör. arife günleri).
 *
 * Yalnızca İNSAN OKUR metin içindir; motor kararları `isHalfDay`
 * bayrağına dayanır.
 */
export const HALF_DAY_HOLIDAY_MARKER = "(yarım gün)";

/** Adli tatil başlangıcı — 20 Temmuz (HMK m.102). */
export const JUDICIAL_RECESS_START = { month: 7, day: 20 } as const;

/** Adli tatil bitişi — 31 Ağustos (HMK m.102). */
export const JUDICIAL_RECESS_END = { month: 8, day: 31 } as const;

export interface TrHoliday {
  /** `"YYYY-MM-DD"` biçiminde takvim günü. */
  date: string;
  name: string;
  type: "RESMI_TATIL";
  /**
   * Arife günü (2429 s.K. m.2/A) — saat 13.00'e kadar mesai vardır.
   * TAM TATİL DEĞİLDİR: HMK m.93 kaydırmasını tetiklemez.
   */
  isHalfDay?: boolean;
  /** Hicri takvime bağlı, resmî ilanla kesinleşecek tarih. */
  isApproximate?: boolean;
}

/**
 * 2026 yılı resmî tatilleri. `packages/db` seed'i bu listeyi doğrudan
 * kullanır (tek kaynak).
 *
 * Sabit tarihli (kanunla belirli) günler KESİNDİR. Dinî bayramlar
 * `isApproximate: true` taşır ve teyide muhtaçtır.
 *
 * ARİFE GÜNLERİ (2429 s.K. m.2/A):
 * - Ramazan Bayramı: "arefe günü saat 13.00'ten itibaren 3,5 gün"
 * - Kurban Bayramı:  "arefe günü saat 13.00'ten itibaren 4,5 gün"
 * - 28 Ekim:         saat 13.00'ten itibaren yarım gün
 * Bu günlerde ÖĞLEDEN ÖNCE MESAİ VARDIR; süre o gün biter, kaymaz.
 */
export const TR_HOLIDAYS_2026: TrHoliday[] = [
  { date: "2026-01-01", name: "Yılbaşı", type: "RESMI_TATIL" },
  {
    date: "2026-03-19",
    name: `Ramazan Bayramı Arifesi ${HALF_DAY_HOLIDAY_MARKER} ${APPROXIMATE_HOLIDAY_MARKER}`,
    type: "RESMI_TATIL",
    isHalfDay: true,
    isApproximate: true,
  },
  { date: "2026-03-20", name: "Ramazan Bayramı 1. gün (yaklaşık)", type: "RESMI_TATIL", isApproximate: true },
  { date: "2026-03-21", name: "Ramazan Bayramı 2. gün (yaklaşık)", type: "RESMI_TATIL", isApproximate: true },
  { date: "2026-03-22", name: "Ramazan Bayramı 3. gün (yaklaşık)", type: "RESMI_TATIL", isApproximate: true },
  { date: "2026-04-23", name: "Ulusal Egemenlik ve Çocuk Bayramı", type: "RESMI_TATIL" },
  { date: "2026-05-01", name: "Emek ve Dayanışma Günü", type: "RESMI_TATIL" },
  { date: "2026-05-19", name: "Atatürk'ü Anma, Gençlik ve Spor Bayramı", type: "RESMI_TATIL" },
  {
    date: "2026-05-26",
    name: `Kurban Bayramı Arifesi ${HALF_DAY_HOLIDAY_MARKER} ${APPROXIMATE_HOLIDAY_MARKER}`,
    type: "RESMI_TATIL",
    isHalfDay: true,
    isApproximate: true,
  },
  { date: "2026-05-27", name: "Kurban Bayramı 1. gün (yaklaşık)", type: "RESMI_TATIL", isApproximate: true },
  { date: "2026-05-28", name: "Kurban Bayramı 2. gün (yaklaşık)", type: "RESMI_TATIL", isApproximate: true },
  { date: "2026-05-29", name: "Kurban Bayramı 3. gün (yaklaşık)", type: "RESMI_TATIL", isApproximate: true },
  { date: "2026-05-30", name: "Kurban Bayramı 4. gün (yaklaşık)", type: "RESMI_TATIL", isApproximate: true },
  { date: "2026-07-15", name: "Demokrasi ve Millî Birlik Günü", type: "RESMI_TATIL" },
  { date: "2026-08-30", name: "Zafer Bayramı", type: "RESMI_TATIL" },
  {
    date: "2026-10-28",
    name: `Cumhuriyet Bayramı Arifesi ${HALF_DAY_HOLIDAY_MARKER}`,
    type: "RESMI_TATIL",
    isHalfDay: true,
  },
  { date: "2026-10-29", name: "Cumhuriyet Bayramı", type: "RESMI_TATIL" },
];

/**
 * 2027 yılı resmî tatilleri (denetim bulgusu K-04).
 *
 * NEDEN EKLENDİ: motorun tatil penceresi tetik yılından açılıyor
 * (`deadlines.service.ts` `windowStart = 1 Ocak (tetik yılı)`); veritabanında
 * yalnız 2026 varken 2027 tetikli her hesapta sorgu BOŞ dönüyor, savunma hiç
 * devreye girmiyor ve motor "23.04.2027 Cuma" gibi adliyenin kapalı olduğu bir
 * günü son gün olarak veriyordu. İstinaf süresi hak düşürücüdür.
 *
 * Motorun otomatik tamamlaması artık boş listede de çalışır, ama o yalnız SABİT
 * TARİHLİ günleri kapsar; dinî bayramlar ve adli tatil takvimden gelmelidir.
 *
 * DİKKAT: dinî bayram tarihleri hicri takvime bağlıdır ve Diyanet ilanıyla
 * kesinleşir. Aşağıdakiler ÖNGÖRÜLEN tarihlerdir; `isApproximate: true`
 * taşıdıkları için motor bunlara denk gelen her hesapta `warnings[]` üretir ve
 * avukattan teyit ister.
 */
export const TR_HOLIDAYS_2027: TrHoliday[] = [
  { date: "2027-01-01", name: "Yılbaşı", type: "RESMI_TATIL" },
  {
    date: "2027-03-08",
    name: `Ramazan Bayramı Arifesi ${HALF_DAY_HOLIDAY_MARKER} ${APPROXIMATE_HOLIDAY_MARKER}`,
    type: "RESMI_TATIL",
    isHalfDay: true,
    isApproximate: true,
  },
  { date: "2027-03-09", name: `Ramazan Bayramı 1. gün ${APPROXIMATE_HOLIDAY_MARKER}`, type: "RESMI_TATIL", isApproximate: true },
  { date: "2027-03-10", name: `Ramazan Bayramı 2. gün ${APPROXIMATE_HOLIDAY_MARKER}`, type: "RESMI_TATIL", isApproximate: true },
  { date: "2027-03-11", name: `Ramazan Bayramı 3. gün ${APPROXIMATE_HOLIDAY_MARKER}`, type: "RESMI_TATIL", isApproximate: true },
  { date: "2027-04-23", name: "Ulusal Egemenlik ve Çocuk Bayramı", type: "RESMI_TATIL" },
  { date: "2027-05-01", name: "Emek ve Dayanışma Günü", type: "RESMI_TATIL" },
  {
    date: "2027-05-15",
    name: `Kurban Bayramı Arifesi ${HALF_DAY_HOLIDAY_MARKER} ${APPROXIMATE_HOLIDAY_MARKER}`,
    type: "RESMI_TATIL",
    isHalfDay: true,
    isApproximate: true,
  },
  { date: "2027-05-16", name: `Kurban Bayramı 1. gün ${APPROXIMATE_HOLIDAY_MARKER}`, type: "RESMI_TATIL", isApproximate: true },
  { date: "2027-05-17", name: `Kurban Bayramı 2. gün ${APPROXIMATE_HOLIDAY_MARKER}`, type: "RESMI_TATIL", isApproximate: true },
  { date: "2027-05-18", name: `Kurban Bayramı 3. gün ${APPROXIMATE_HOLIDAY_MARKER}`, type: "RESMI_TATIL", isApproximate: true },
  { date: "2027-05-19", name: "Atatürk'ü Anma, Gençlik ve Spor Bayramı", type: "RESMI_TATIL" },
  { date: "2027-07-15", name: "Demokrasi ve Millî Birlik Günü", type: "RESMI_TATIL" },
  { date: "2027-08-30", name: "Zafer Bayramı", type: "RESMI_TATIL" },
  {
    date: "2027-10-28",
    name: `Cumhuriyet Bayramı Arifesi ${HALF_DAY_HOLIDAY_MARKER}`,
    type: "RESMI_TATIL",
    isHalfDay: true,
  },
  { date: "2027-10-29", name: "Cumhuriyet Bayramı", type: "RESMI_TATIL" },
];

/** Yıl → takvim eşlemesi. Tohum ve zamanlayıcı buradan okur (tek kaynak). */
export const TR_HOLIDAYS_BY_YEAR: Record<number, TrHoliday[]> = {
  2026: TR_HOLIDAYS_2026,
  2027: TR_HOLIDAYS_2027,
};

/** Takvimi elde bulunan yıllar. Diğer yıllarda motor `warnings[]` üretir. */
export const SUPPORTED_HOLIDAY_YEARS: number[] = [2026, 2027];

/**
 * Herhangi bir yıl için **sabit tarihli** (kanunla belirli, hicri takvime bağlı
 * olmayan) resmî tatilleri döndürür. Dinî bayramlar DAHİL DEĞİLDİR.
 *
 * Motor, takvimi yüklü olmayan yıllara taşan hesaplarda bu listeyi otomatik
 * olarak devreye sokar (bkz. `computeDeadline`): 1 Ocak 2027 gibi kanunla kesin
 * belirli bir günü atlamak, yalnızca uyarı vermekten çok daha tehlikelidir.
 */
export function fixedOfficialHolidays(year: number): TrHoliday[] {
  const iso = (m: number, d: number) => toIsoDateKey(dateOnly(year, m, d));
  return [
    { date: iso(1, 1), name: "Yılbaşı", type: "RESMI_TATIL" },
    { date: iso(4, 23), name: "Ulusal Egemenlik ve Çocuk Bayramı", type: "RESMI_TATIL" },
    { date: iso(5, 1), name: "Emek ve Dayanışma Günü", type: "RESMI_TATIL" },
    { date: iso(5, 19), name: "Atatürk'ü Anma, Gençlik ve Spor Bayramı", type: "RESMI_TATIL" },
    { date: iso(7, 15), name: "Demokrasi ve Millî Birlik Günü", type: "RESMI_TATIL" },
    { date: iso(8, 30), name: "Zafer Bayramı", type: "RESMI_TATIL" },
    {
      date: iso(10, 28),
      name: `Cumhuriyet Bayramı Arifesi ${HALF_DAY_HOLIDAY_MARKER}`,
      type: "RESMI_TATIL",
      isHalfDay: true,
    },
    { date: iso(10, 29), name: "Cumhuriyet Bayramı", type: "RESMI_TATIL" },
  ];
}

/** `TrHoliday[]` → motorun kabul ettiği `HolidayInput[]`. */
export function toHolidayInputs(list: TrHoliday[]): HolidayInput[] {
  return list.map((h) => ({
    date: parseDateOnly(h.date),
    name: h.name,
    type: h.type as HolidayType,
    isHalfDay: h.isHalfDay === true,
    isApproximate: h.isApproximate === true,
  }));
}

/** Verilen yılın adli tatil aralığı (her iki uç dâhil). */
export function judicialRecessRange(year: number): { start: Date; end: Date } {
  return {
    start: dateOnly(year, JUDICIAL_RECESS_START.month, JUDICIAL_RECESS_START.day),
    end: dateOnly(year, JUDICIAL_RECESS_END.month, JUDICIAL_RECESS_END.day),
  };
}

/**
 * Verilen yılın adli tatilini günlük satırlara açar (Holiday tablosuna yazmak için).
 * 20 Temmuz – 31 Ağustos arası 43 gündür.
 */
export function expandJudicialRecess(year: number): HolidayInput[] {
  const { start, end } = judicialRecessRange(year);
  const days: HolidayInput[] = [];
  for (let d = start; d.getTime() <= end.getTime(); d = addDays(d, 1)) {
    days.push({
      date: new Date(d),
      name: "Adli tatil (20 Temmuz – 31 Ağustos)",
      type: "ADLI_TATIL",
    });
  }
  return days;
}

/** Tatil listesinden hızlı arama indeksi. */
export interface HolidayIndex {
  /** `"YYYY-MM-DD"` → o güne düşen RESMİ tatiller. */
  official: Map<string, HolidayInput[]>;
  /** `"YYYY-MM-DD"` → o güne düşen ADLİ TATİL satırları. */
  recess: Map<string, HolidayInput[]>;
  /** Listede geçen yıllar. */
  years: Set<number>;
}

/** Tatil listesini indeksler. Geçersiz tarih taşıyan satırlarda hata fırlatır. */
export function buildHolidayIndex(holidays: HolidayInput[] = []): HolidayIndex {
  const index: HolidayIndex = { official: new Map(), recess: new Map(), years: new Set() };
  for (const h of holidays) {
    const d = toUtcDate(h.date);
    const key = toIsoDateKey(d);
    const bucket = h.type === "ADLI_TATIL" ? index.recess : index.official;
    const existing = bucket.get(key);
    const normalized: HolidayInput = {
      date: d,
      name: h.name,
      type: h.type,
      // Bayraklar yoksa isimden geriye düşülür: veritabanı kolonları eklenmeden
      // önce yazılmış kayıtlar da doğru yorumlansın.
      isHalfDay: h.isHalfDay ?? h.name?.includes(HALF_DAY_HOLIDAY_MARKER) ?? false,
      isApproximate: h.isApproximate ?? h.name?.includes(APPROXIMATE_HOLIDAY_MARKER) ?? false,
    };
    if (existing) existing.push(normalized);
    else bucket.set(key, [normalized]);
    index.years.add(d.getUTCFullYear());
  }
  return index;
}

/**
 * O güne düşen resmî tatilleri döndürür (adli tatil satırları hariç —
 * adli tatil resmî tatil DEĞİLDİR, mahkemeler nöbetçi usulüyle çalışır).
 */
export function officialHolidaysOn(date: Date, holidays: HolidayInput[] | HolidayIndex = []): HolidayInput[] {
  const index = Array.isArray(holidays) ? buildHolidayIndex(holidays) : holidays;
  return index.official.get(toIsoDateKey(date)) ?? [];
}

/**
 * Gün resmî tatil mi (yarım günler DÂHİL).
 *
 * DİKKAT: HMK m.93 kaydırması için bunu değil `isNonWorkingDay`'i kullanın;
 * yarım gün tatilde mesai vardır ve süre kaymaz.
 */
export function isOfficialHoliday(date: Date, holidays: HolidayInput[] | HolidayIndex = []): boolean {
  return officialHolidaysOn(date, holidays).length > 0;
}

/**
 * Gün TAM GÜN resmî tatil mi — HMK m.93 / İİK m.19 / CMK m.39 anlamında.
 *
 * Arife (yarım gün) günleri `false` döndürür: 2429 s.K. m.2/A uyarınca arife
 * günü saat 13.00'e kadar mesai yapılır, gün "resmî tatil gününe rastlamış"
 * sayılmaz ve süre o günün çalışma saati sonunda biter.
 */
export function isFullDayOfficialHoliday(
  date: Date,
  holidays: HolidayInput[] | HolidayIndex = [],
): boolean {
  return officialHolidaysOn(date, holidays).some((h) => h.isHalfDay !== true);
}

/** O güne düşen yarım gün (arife) tatilleri. */
export function halfDayHolidaysOn(
  date: Date,
  holidays: HolidayInput[] | HolidayIndex = [],
): HolidayInput[] {
  return officialHolidaysOn(date, holidays).filter((h) => h.isHalfDay === true);
}

/**
 * Gün adli tatile denk geliyor mu.
 *
 * Öncelik listedeki `ADLI_TATIL` satırlarındadır; liste bu yıl için veri
 * içermiyorsa HMK m.102'deki kanuni aralığa (20 Temmuz – 31 Ağustos) düşülür.
 */
export function isInJudicialRecess(date: Date, holidays: HolidayInput[] | HolidayIndex = []): boolean {
  const d = toUtcDate(date);
  const index = Array.isArray(holidays) ? buildHolidayIndex(holidays) : holidays;
  if (index.recess.has(toIsoDateKey(d))) return true;
  const { start, end } = judicialRecessRange(d.getUTCFullYear());
  return d.getTime() >= start.getTime() && d.getTime() <= end.getTime();
}

/**
 * Verilen günün içinde bulunduğu adli tatilin BİTİŞ gününü döndürür.
 * Kanuni bitişten (31 Ağustos) sonra da `ADLI_TATIL` işaretli günler varsa
 * (mevzuat değişikliği/idari karar) liste izlenerek uzatılır.
 *
 * @returns Gün adli tatile denk gelmiyorsa `null`.
 */
export function judicialRecessEndFor(
  date: Date,
  holidays: HolidayInput[] | HolidayIndex = [],
): Date | null {
  const d = toUtcDate(date);
  const index = Array.isArray(holidays) ? buildHolidayIndex(holidays) : holidays;
  if (!isInJudicialRecess(d, index)) return null;

  const legalEnd = judicialRecessRange(d.getUTCFullYear()).end;
  let end = d.getTime() > legalEnd.getTime() ? d : legalEnd;
  // Listede kanuni bitişin ötesine taşan adli tatil günleri varsa takip et.
  for (let i = 0; i < 400; i += 1) {
    const next = addDays(end, 1);
    if (!index.recess.has(toIsoDateKey(next))) break;
    end = next;
  }
  return end;
}

/**
 * Gün "çalışılmayan gün" mü — yani hafta sonu ya da TAM GÜN resmî tatil mi
 * (HMK m.93 / İİK m.19 / CMK m.39).
 *
 * BURAYA DÂHİL OLMAYANLAR:
 * - ADLİ TATİL: süreyi durdurmaz, yalnızca HMK m.104 uzamasını tetikler.
 * - YARIM GÜN (arife): 2429 s.K. m.2/A uyarınca 13.00'e kadar mesai vardır;
 *   gün resmî tatile "rastlamış" sayılmaz, süre kaymaz. Motor bunun için
 *   yalnızca "işlemi öğleden önce tamamlayınız" uyarısı üretir.
 */
export function isNonWorkingDay(date: Date, holidays: HolidayInput[] | HolidayIndex = []): boolean {
  return isWeekend(date) || isFullDayOfficialHoliday(date, holidays);
}

/**
 * Verilen gün ve sonrasındaki İLK iş gününü döndürür.
 * Gün zaten iş günüyse aynı gün döner (HMK m.93 kaydırması için istenen davranış).
 */
export function nextWorkingDay(date: Date, holidays: HolidayInput[] | HolidayIndex = []): Date {
  const index = Array.isArray(holidays) ? buildHolidayIndex(holidays) : holidays;
  let d = toUtcDate(date);
  for (let i = 0; i <= 60; i += 1) {
    if (!isNonWorkingDay(d, index)) return d;
    d = addDays(d, 1);
  }
  throw new Error(
    "Ardışık 60 günden fazla tatil bulundu; tatil takvimi hatalı görünüyor. Hesap durduruldu.",
  );
}

/** Verilen günden SONRAKİ ilk iş günü (verilen gün iş günü olsa bile ileriye gider). */
export function strictNextWorkingDay(date: Date, holidays: HolidayInput[] | HolidayIndex = []): Date {
  return nextWorkingDay(addDays(date, 1), holidays);
}

/** Verilen gün ve öncesindeki son iş günü. */
export function previousWorkingDay(date: Date, holidays: HolidayInput[] | HolidayIndex = []): Date {
  const index = Array.isArray(holidays) ? buildHolidayIndex(holidays) : holidays;
  let d = toUtcDate(date);
  for (let i = 0; i <= 60; i += 1) {
    if (!isNonWorkingDay(d, index)) return d;
    d = addDays(d, -1);
  }
  throw new Error(
    "Ardışık 60 günden fazla tatil bulundu; tatil takvimi hatalı görünüyor. Hesap durduruldu.",
  );
}
