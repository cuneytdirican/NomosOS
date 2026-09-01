/**
 * NomosOS deterministik süre motoru.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * BU DOSYADA AI/LLM YOKTUR VE OLMAYACAKTIR.
 * Kesin hukuki süre hesabı asla dil modeline bırakılmaz. AI'ın rolü yalnızca
 * TESPİTTİR (tebliğ tarihi ve kural önerisi); GÜN HESABI buradadır.
 * Yanlış hesap avukata meslek sorumluluğu doğurur.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ALGORİTMA (HMK m.90-94, m.104; 7201 s. Tebligat Kanunu):
 *
 *   Adım 0 — Tetik: tebliğ / tefhim / olay tarihi.
 *   Adım 1 — Tebligat yöntemi düzeltmesi:
 *            ETEBLIGAT → 7201 s.K. m.7/a: elektronik tebligat, muhatabın
 *            elektronik adresine ulaştığı tarihi izleyen BEŞİNCİ günün sonunda
 *            yapılmış sayılır → geçerli tebliğ tarihi = ulaşma + 5 gün.
 *            (Madde numarası "EK m.7/a" DEĞİL, "m.7/a"dır: hüküm 7 nci maddeden
 *            sonra gelmek üzere eklenmiştir; 7201 s.K.'nın ayrıca "Ek Madde 1,
 *            Ek Madde 2…" şeklinde bağımsız ek maddeleri vardır.)
 *            DURUSMADA (tefhim) → tebliğ tarihi = duruşma tarihi.
 *            ELDEN / POSTA / DIGER → düzeltme yok.
 *   Adım 2 — Başlangıç:
 *            GUN → HMK m.92/1 (İİK m.19 / CMK m.39 / İYUK m.8/1): "Süre, gün
 *            olarak belirlenmiş ise tebliğ veya tefhim edildiği gün hesaba
 *            katılmaz"; süre ertesi gün işlemeye başlar.
 *            HAFTA/AY/YIL → HMK m.91 + m.92/2: süre tebliğ/tefhim tarihinden
 *            işlemeye başlar ve son hafta/ay/yılda KARŞILIK GELEN günde biter.
 *   Adım 3 — Süre ekleme:
 *            GUN → takvim günü sayılır (ilk gün hariç): son gün = tebliğ + N gün.
 *            HAFTA/AY/YIL → HMK m.92/2: "süre; ... başladığı güne son hafta, ay
 *            veya yılda karşılık gelen günün tatil saatinde biter". Karşılık
 *            gelen gün yoksa (31 Ocak + 1 ay) ayın son günü esas alınır.
 *   Adım 4 — Adli tatil (HMK m.104): kural adli tatile tabiyse ve sürenin BİTİMİ
 *            adli tatile (20 Temmuz – 31 Ağustos, HMK m.102) rastlıyorsa süre,
 *            ayrıca bir karara gerek olmaksızın adli tatilin bittiği günden
 *            itibaren bir hafta uzatılmış sayılır. (İYUK m.8/3 ve CMK m.331/4
 *            için farklı rejimler `recessRule` ile seçilir.)
 *   Adım 5 — Tatil kaydırması (HMK m.93): "Resmî tatil günleri süreye dâhildir.
 *            Sürenin son gününün resmî tatil gününe rastlaması hâlinde süre,
 *            tatili takip eden ilk iş günü çalışma saati sonunda biter."
 *            Hafta sonu da bu kapsamda değerlendirilir.
 *            Adli tatil bir resmî tatil DEĞİLDİR; kaydırmayı tetiklemez.
 *            ARİFE (yarım gün) de resmî tatil DEĞİLDİR; kaydırmayı tetiklemez.
 *   Adım 5b — Kaydırma sonrası adli tatil kontrolü: ham son gün adli tatilin
 *            hemen öncesindeki bir hafta sonuna düşerse (ör. 19 Temmuz Pazar),
 *            m.93 kaydırması son günü adli tatilin İÇİNE taşır; bu hâlde m.104
 *            uzaması yeniden değerlendirilir.
 *
 * Her adım `steps[]` içine yazılır; belirsizlikler `warnings[]` içine düşer.
 */

import {
  addDays,
  addMonths,
  addYears,
  formatTrDate,
  isValidDate,
  toIsoDateKey,
  toUtcDate,
  trWeekdayName,
} from "./date-utils";
import {
  buildHolidayIndex,
  fixedOfficialHolidays,
  halfDayHolidaysOn,
  isInJudicialRecess,
  isNonWorkingDay,
  judicialRecessEndFor,
  judicialRecessRange,
  nextWorkingDay,
  officialHolidaysOn,
  toHolidayInputs,
} from "./holidays";
import {
  DEADLINE_STEP_CODES,
  type DeadlineComputationInput,
  type DeadlineComputationResult,
  type DeadlineComputationStep,
  type DurationUnit,
  type HolidayInput,
  type ProcedureCode,
  type RecessExtensionRule,
  type ServiceMethod,
} from "./types";

/**
 * 7201 s. Tebligat Kanunu **m.7/a** — elektronik tebligatta varsayılan tebliğ
 * gün sayısı: "…muhatabın elektronik adresine ulaştığı tarihi izleyen beşinci
 * günün sonunda yapılmış sayılır."
 *
 * Bu bir *tebliğ tarihi* varsayımıdır, sürenin son günü değildir; bu nedenle
 * bulunan tarihe HMK m.93 kaydırması UYGULANMAZ.
 */
export const ETEBLIGAT_VARSAYIM_GUN = 5;

/** HMK m.104 — adli tatil bitiminden itibaren uzama süresi (gün). */
export const HMK_104_UZAMA_GUN = 7;

/** İYUK m.8/3 — ara vermenin sona erdiği günü izleyen tarihten itibaren uzama (gün). */
export const IYUK_8_UZAMA_GUN = 7;

/** CMK m.331/4 — adli tatil bitiminden itibaren uzama süresi (gün). */
export const CMK_331_UZAMA_GUN = 3;

const UNIT_LABEL: Record<DurationUnit, string> = {
  GUN: "gün",
  HAFTA: "hafta",
  AY: "ay",
  YIL: "yıl",
};

const SERVICE_METHOD_LABEL: Record<ServiceMethod, string> = {
  ELDEN: "elden tebliğ",
  POSTA: "posta yoluyla tebliğ",
  ETEBLIGAT: "elektronik tebligat (UETS)",
  DURUSMADA: "duruşmada tefhim",
  DIGER: "diğer",
};

/**
 * Usul kanununa göre madde referansları.
 *
 * Mekanik her kolda aynıdır ama DAYANAK farklıdır; hesap izi dilekçeye
 * kopyalanabilir bir belge niteliğinde olduğu için doğru maddeyi göstermek
 * gerekir (İİK m.62 itirazında "HMK m.93" yazmak hatalıdır).
 */
interface ProcedureArticles {
  /** Gün sürelerinde ilk günün sayılmaması. */
  gunBaslangic: string;
  /** Hafta/ay/yıl sürelerinde başlangıç ve bitiş. */
  haftaAyYil: string;
  /** Son günün resmî tatile rastlaması hâlinde kaydırma. */
  tatilKaydirmasi: string;
}

const PROCEDURE_ARTICLES: Record<ProcedureCode, ProcedureArticles> = {
  HMK: {
    gunBaslangic: "HMK m.92/1",
    haftaAyYil: "HMK m.91 + m.92/2",
    tatilKaydirmasi: "HMK m.93",
  },
  // İİK m.19: "Gün olarak tayin olunan sürelerde ilk gün hesaba katılmaz…
  // Sürenin son günü resmî bir tatil gününe rastlarsa süre bu günü takip eden
  // günde biter."
  IIK: {
    gunBaslangic: "İİK m.19/2",
    haftaAyYil: "İİK m.19/3",
    tatilKaydirmasi: "İİK m.19/4",
  },
  CMK: {
    gunBaslangic: "CMK m.39/1",
    haftaAyYil: "CMK m.39/2",
    tatilKaydirmasi: "CMK m.39/3",
  },
  IYUK: {
    gunBaslangic: "İYUK m.8/1",
    haftaAyYil: "İYUK m.8/1",
    tatilKaydirmasi: "İYUK m.8/2",
  },
};

/**
 * Süreyi, tebliğ tarihine göre ileri taşır ve HMK m.92 uyarınca son günü verir.
 *
 * `start` **sürenin başladığı gün** (tebliğ/tefhim günü) olarak yorumlanır; bu gün
 * hesaba katılmadığından `GUN` biriminde sonuç `start + value` gündür.
 *
 * @throws `value` pozitif tam sayı değilse veya birim tanınmıyorsa.
 */
export function addDuration(start: Date, value: number, unit: DurationUnit): Date {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Süre değeri pozitif bir tam sayı olmalıdır; alınan: ${String(value)}.`);
  }
  const base = toUtcDate(start);
  switch (unit) {
    case "GUN":
      return addDays(base, value);
    case "HAFTA":
      return addDays(base, value * 7);
    case "AY":
      return addMonths(base, value);
    case "YIL":
      return addYears(base, value);
    default: {
      const exhaustive: never = unit;
      throw new Error(`Bilinmeyen süre birimi: "${String(exhaustive)}".`);
    }
  }
}

function uzamaGunSayisi(rule: RecessExtensionRule): number {
  switch (rule) {
    case "IYUK_8":
      return IYUK_8_UZAMA_GUN;
    case "CMK_331":
      return CMK_331_UZAMA_GUN;
    case "HMK_104":
    default:
      return HMK_104_UZAMA_GUN;
  }
}

function uzamaDayanagi(rule: RecessExtensionRule): string {
  switch (rule) {
    case "IYUK_8":
      return "İYUK m.8/3";
    case "CMK_331":
      return "CMK m.331/4";
    case "HMK_104":
    default:
      return "HMK m.104";
  }
}

/**
 * Adli tatil uzamasını uygular.
 *
 * ⚠ TEYİT GEREKİR (hukuki denetim bulgusu 7) — `IYUK_8` çapası:
 * Kod, İYUK m.8/3'ün "ara vermenin sona erdiği günü İZLEYEN TARİHTEN itibaren
 * yedi gün" lafzını çapayı bir gün ileri alarak (1 Eylül + 7 = 8 Eylül)
 * uyguluyor. Denetim raporu, Danıştay yerleşik uygulamasının yedi günü
 * 1–7 Eylül olarak saydığını ve son günün 07.09 olması gerektiğini, ancak
 * bunun bir Danıştay kararıyla teyit edilmesi gerektiğini bildirmiştir.
 * İYUK'taki 60 günlük süre HAK DÜŞÜRÜCÜDÜR; bir gün fazla hesaplamak dava
 * reddi demektir. Teyit alınana kadar mevcut (bir gün geniş) davranış
 * korunmuş, kullanıcıya `warnings[]` ile açık uyarı verilmiştir.
 * Değişiklik yapılacaksa: `const anchor = recessEnd;` yeterlidir.
 *
 * HMK m.104 ve CMK m.331/4'te "tatilin bittiği GÜNDEN itibaren" denildiğinden
 * bitiş gününün kendisi esastır (31 Ağustos + 7 = 7 Eylül ✔).
 */
function applyRecessExtension(recessEnd: Date, rule: RecessExtensionRule): Date {
  const days = uzamaGunSayisi(rule);
  // F2-Ö-09: İYUK m.8/3 uzatması Danıştay uygulamasında 1–7 Eylül'dir; çapa
  // recessEnd'İN KENDİSİDİR (bugün +1 atlamak uzatmayı bir gün genişletir).
  // Eski `addDays(recessEnd, 1)` 60 günlük dava açma süresini de bir gün
  // taşırıyordu. Karar: çapa recessEnd; tartışmalı hesap iz dizisinde görünür.
  const anchor = recessEnd;
  return addDays(anchor, days);
}

function describeDay(date: Date): string {
  return `${formatTrDate(date)} ${trWeekdayName(date)}`;
}

/**
 * DETERMİNİSTİK SÜRE HESABI.
 *
 * Girdi tarihleri gün hassasiyetindedir ve UTC gün bileşenlerine göre yorumlanır;
 * sunucunun yerel saat dilimi sonucu DEĞİŞTİRMEZ.
 *
 * @throws Girdi geçersizse Türkçe hata mesajıyla.
 */
export function computeDeadline(input: DeadlineComputationInput): DeadlineComputationResult {
  // ── Girdi doğrulama ───────────────────────────────────────────────────────
  if (!input || typeof input !== "object") {
    throw new Error("Süre hesabı için girdi nesnesi zorunludur.");
  }
  if (!input.rule) {
    throw new Error("Süre kuralı (rule) zorunludur.");
  }
  if (input.triggerDate == null) {
    throw new Error("Tetik tarihi (triggerDate) zorunludur.");
  }
  if (!isValidDate(input.triggerDate) && typeof input.triggerDate !== "string") {
    throw new Error("Geçersiz tetik tarihi (triggerDate): geçerli bir tarih değeri değil.");
  }

  const { durationValue, durationUnit, legalBasis } = input.rule;
  if (!Number.isInteger(durationValue) || durationValue <= 0) {
    throw new Error(
      `Süre değeri pozitif bir tam sayı olmalıdır; alınan: ${String(durationValue)}.`,
    );
  }
  if (!(durationUnit in UNIT_LABEL)) {
    throw new Error(`Bilinmeyen süre birimi: "${String(durationUnit)}".`);
  }

  const suppliedHolidays: HolidayInput[] = Array.isArray(input.holidays) ? input.holidays : [];
  const recessRule: RecessExtensionRule = input.recessRule ?? "HMK_104";
  const procedureCode: ProcedureCode = input.procedureCode ?? "HMK";
  const articles = PROCEDURE_ARTICLES[procedureCode];

  // HMK m.104 "ayrıca bir karara gerek olmaksızın" uygulanır; uzamanın
  // uygulanMAması bilinçli bir tercih olmalıdır. Bu nedenle VARSAYILAN "uygula".
  const applyRecess = input.applyJudicialRecess !== false;

  // Takvimi verilmemiş yıllar için sabit tarihli (kanunla kesin belirli) resmî
  // tatilleri otomatik tamamla. 1 Ocak 2027 gibi bir günü atlayıp yalnızca
  // uyarı vermek, yanlış tarihi düzeltmez (denetim bulgusu 10).
  const { holidays, autoFilledYears } = withFixedHolidaysForMissingYears(
    suppliedHolidays,
    input.triggerDate,
    input.rule,
  );
  const holidayIndex = buildHolidayIndex(holidays);

  const steps: DeadlineComputationStep[] = [];
  const warnings: string[] = [];
  const push = (step: string, date: Date, explanation: string) => {
    steps.push({ step, date: new Date(date), explanation });
  };

  // ── Adım 0: Tetik tarihi ──────────────────────────────────────────────────
  const triggerDate = toUtcDate(input.triggerDate);
  const methodLabel = input.serviceMethod ? SERVICE_METHOD_LABEL[input.serviceMethod] : undefined;
  push(
    DEADLINE_STEP_CODES.TETIK,
    triggerDate,
    `Tetik tarihi (tebliğ/tefhim/olay): ${describeDay(triggerDate)}` +
      (methodLabel ? ` — yöntem: ${methodLabel}.` : "."),
  );

  // ── Adım 1: Tebligat yöntemi düzeltmesi ───────────────────────────────────
  let notificationDate = triggerDate;
  switch (input.serviceMethod) {
    case "ETEBLIGAT": {
      notificationDate = addDays(triggerDate, ETEBLIGAT_VARSAYIM_GUN);
      push(
        DEADLINE_STEP_CODES.TEBLIGAT_DUZELTMESI,
        notificationDate,
        `7201 sayılı Tebligat Kanunu m.7/a: elektronik tebligat, muhatabın elektronik ` +
          `adresine ulaştığı tarihi izleyen ${ETEBLIGAT_VARSAYIM_GUN}. günün sonunda yapılmış sayılır. ` +
          `Geçerli tebliğ tarihi: ${describeDay(notificationDate)}.`,
      );
      break;
    }
    case "DURUSMADA": {
      push(
        DEADLINE_STEP_CODES.TEBLIGAT_DUZELTMESI,
        notificationDate,
        `Duruşmada yüze karşı tefhim: tebliğ tarihi duruşma tarihidir ` +
          `(${describeDay(notificationDate)}); ayrıca tebligat beklenmez.`,
      );
      break;
    }
    default: {
      push(
        DEADLINE_STEP_CODES.TEBLIGAT_DUZELTMESI,
        notificationDate,
        `${methodLabel ? `Tebligat yöntemi: ${methodLabel}. ` : ""}` +
          `Bu yöntemde tebliğ tarihine ekleme yapılmaz; geçerli tebliğ tarihi ` +
          `${describeDay(notificationDate)}.`,
      );
      break;
    }
  }

  // ── Adım 2: Sürenin işlemeye başladığı gün ────────────────────────────────
  // GUN sürelerinde: ilk gün sayılmaz (HMK m.92/1 · İİK m.19/2 · CMK m.39/1).
  // HAFTA/AY/YIL sürelerinde: süre tebliğ gününden işler, son hafta/ay/yılda
  // KARŞILIK GELEN günde biter (HMK m.91 + m.92/2). "Başladığı gün" ifadesi
  // burada tebliğ gününü işaret eder; bu ayrım yapılmazsa hesap izi kendi
  // içinde çelişkili görünür (denetim bulgusu 16).
  const periodStart = addDays(notificationDate, 1);
  push(
    DEADLINE_STEP_CODES.BASLANGIC,
    durationUnit === "GUN" ? periodStart : notificationDate,
    durationUnit === "GUN"
      ? `${articles.gunBaslangic}: süre gün olarak belirlendiğinden tebliğ/tefhim günü ` +
        `(${describeDay(notificationDate)}) hesaba katılmaz. Süre ${describeDay(periodStart)} ` +
        `günü işlemeye başlar.`
      : `${articles.haftaAyYil}: süre, tebliğ/tefhim tarihi olan ` +
        `${describeDay(notificationDate)} gününden işlemeye başlar ve son ` +
        `${UNIT_LABEL[durationUnit]}da bu güne KARŞILIK GELEN günün tatil saatinde biter.`,
  );

  // ── Adım 3: Süre ekleme ───────────────────────────────────────────────────
  let dueDate = addDuration(notificationDate, durationValue, durationUnit);
  const unitLabel = UNIT_LABEL[durationUnit];
  if (durationUnit === "GUN") {
    push(
      DEADLINE_STEP_CODES.SURE_EKLEME,
      dueDate,
      `${durationValue} ${unitLabel}lük süre, ${describeDay(periodStart)} gününden itibaren ` +
        `takvim günü olarak sayılır (${legalBasis}). Ham son gün: ${describeDay(dueDate)}.`,
    );
  } else {
    const clamped = clampedToMonthEnd(notificationDate, dueDate, durationUnit);
    push(
      DEADLINE_STEP_CODES.SURE_EKLEME,
      dueDate,
      `${articles.haftaAyYil}: ${durationValue} ${unitLabel}lık süre, tebliğ/tefhim tarihine ` +
        `(${formatTrDate(notificationDate)}) son ${unitLabel}da karşılık gelen günün tatil ` +
        `saatinde biter (${legalBasis}). ` +
        (clamped
          ? `Son ayda ${notificationDate.getUTCDate()}. gün bulunmadığından ayın son günü esas alındı. `
          : "") +
        `Ham son gün: ${describeDay(dueDate)}.`,
    );
    if (clamped) {
      warnings.push(
        `Sürenin bittiği ayda tebliğ gününe (ayın ${notificationDate.getUTCDate()}.) karşılık ` +
          `gelen gün bulunmadığından ${articles.haftaAyYil} uyarınca ayın son günü (${formatTrDate(dueDate)}) esas alınmıştır.`,
      );
    }
  }

  // ── Adım 4: Adli tatil uzaması (HMK m.104 / İYUK m.8/3 / CMK m.331/4) ─────
  const rawDueDate = dueDate;
  let appliedRecess = false;

  /** Adli tatile rastlayan son güne uzamayı uygular; uygulandıysa `true`. */
  const extendForRecess = (candidate: Date, viaShift: boolean): boolean => {
    const recessEnd = judicialRecessEndFor(candidate, holidayIndex);
    if (!recessEnd) return false;
    const extended = applyRecessExtension(recessEnd, recessRule);
    const basis = uzamaDayanagi(recessRule);
    const days = uzamaGunSayisi(recessRule);
    push(
      DEADLINE_STEP_CODES.ADLI_TATIL,
      extended,
      `${basis}: sürenin bitimi adli tatile ` +
        `(${formatTrDate(judicialRecessRange(recessEnd.getUTCFullYear()).start)} – ` +
        `${formatTrDate(recessEnd)}) rastladığından süre, ayrıca bir karara gerek olmaksızın ` +
        `adli tatilin bittiği ${recessRule === "IYUK_8" ? "günü izleyen tarihten" : "günden"} itibaren ` +
        `${days} gün uzatılmış sayılır. ` +
        (viaShift
          ? `(Ham son gün ${formatTrDate(rawDueDate)} adli tatilin hemen öncesindeki çalışılmayan ` +
            `güne rastladığından, ${articles.tatilKaydirmasi} kaydırması son günü adli tatilin ` +
            `içine taşımıştır; uzama bu tarih üzerinden uygulanmıştır.) `
          : "") +
        `Yeni son gün: ${describeDay(extended)}.`,
    );
    dueDate = extended;
    return true;
  };

  if (applyRecess && isInJudicialRecess(dueDate, holidayIndex)) {
    appliedRecess = extendForRecess(dueDate, false);
  }

  // ── Adım 5: Tatil kaydırması (HMK m.93 / İİK m.19/4 / CMK m.39/3) ─────────
  const shiftStep = (from: Date): Date => {
    const to = nextWorkingDay(from, holidayIndex);
    if (to.getTime() !== from.getTime()) {
      const blockers = collectBlockingDays(from, to, holidayIndex);
      push(
        DEADLINE_STEP_CODES.TATIL_KAYDIRMASI,
        to,
        `${articles.tatilKaydirmasi}: son gün (${describeDay(from)}) çalışılmayan güne ` +
          `rastladığından (${blockers.join(", ")}) süre, tatili takip eden ilk iş günü olan ` +
          `${describeDay(to)} çalışma saati sonunda biter.`,
      );
    } else {
      push(
        DEADLINE_STEP_CODES.TATIL_KAYDIRMASI,
        to,
        `${articles.tatilKaydirmasi}: son gün (${describeDay(to)}) iş günüdür; kaydırma gerekmedi.`,
      );
    }
    return to;
  };

  dueDate = shiftStep(dueDate);

  // ── Adım 5b: Kaydırma son günü adli tatilin İÇİNE taşıdıysa ───────────────
  // Ham son gün 19 Temmuz Pazar ise m.93 kaydırması onu 20 Temmuz'a — adli
  // tatilin ilk gününe — taşır. Sürenin fiilî bitişi adli tatile düştüğüne göre
  // m.104 uzaması burada da uygulanmalıdır (denetim bulgusu 5).
  if (applyRecess && !appliedRecess && isInJudicialRecess(dueDate, holidayIndex)) {
    appliedRecess = extendForRecess(dueDate, true);
    if (appliedRecess) dueDate = shiftStep(dueDate);
  }

  const endsInRecess = isInJudicialRecess(rawDueDate, holidayIndex) || (!appliedRecess && isInJudicialRecess(dueDate, holidayIndex));
  if (!applyRecess && endsInRecess) {
    warnings.push(
      `Sürenin son günü (${formatTrDate(dueDate)}) adli tatile denk geliyor; kural adli tatile ` +
        `tabi olmadığı için ${uzamaDayanagi(recessRule)} uzaması UYGULANMADI. Dosyanın HMK m.103'teki ` +
        `istisnalar kapsamında olup olmadığını teyit ediniz.`,
    );
  }

  // ── Sonuç adımı ───────────────────────────────────────────────────────────
  push(
    DEADLINE_STEP_CODES.SON_GUN,
    dueDate,
    `SON GÜN: ${describeDay(dueDate)} — ${legalBasis}. İşlem bu günün çalışma/tatil ` +
      `saati sonuna kadar yapılmalıdır.`,
  );

  // ── Uyarılar ──────────────────────────────────────────────────────────────
  collectWarnings({
    warnings,
    holidayIndex,
    holidayCount: suppliedHolidays.length,
    autoFilledYears,
    triggerDate,
    dueDate,
    recessRule,
    applyRecess,
  });

  return {
    dueDate: new Date(dueDate),
    steps,
    legalBasis,
    warnings,
  };
}

/** Ay/yıl eklemesinde ayın son gününe sabitleme yapılıp yapılmadığını saptar. */
function clampedToMonthEnd(start: Date, result: Date, unit: DurationUnit): boolean {
  if (unit !== "AY" && unit !== "YIL") return false;
  return result.getUTCDate() !== start.getUTCDate();
}

/** Kaydırmayı tetikleyen günlerin insan-okur açıklamalarını toplar. */
function collectBlockingDays(
  from: Date,
  to: Date,
  holidayIndex: ReturnType<typeof buildHolidayIndex>,
): string[] {
  const labels: string[] = [];
  for (let d = from; d.getTime() < to.getTime(); d = addDays(d, 1)) {
    if (!isNonWorkingDay(d, holidayIndex)) continue;
    const named = officialHolidaysOn(d, holidayIndex)
      .map((h) => h.name)
      .filter((n): n is string => Boolean(n));
    labels.push(
      named.length > 0
        ? `${formatTrDate(d)} ${named.join(" / ")}`
        : `${formatTrDate(d)} ${trWeekdayName(d)}`,
    );
  }
  return labels;
}

/**
 * Takvimi verilmemiş yıllar için sabit tarihli resmî tatilleri ekler.
 *
 * Dinî bayramlar hicri takvime bağlı olduğundan otomatik üretilemez; bu yüzden
 * `collectWarnings` ilgili yıl için uyarıyı korur. Ancak 1 Ocak, 23 Nisan,
 * 29 Ekim gibi kanunla kesin belirli günleri atlamak — hafta içine denk
 * geldiklerinde hafta sonu kontrolü de yakalamadığı için — doğrudan yanlış
 * tarih üretir (denetim bulgusu 10).
 */
function withFixedHolidaysForMissingYears(
  supplied: HolidayInput[],
  triggerDate: Date | string,
  rule: { durationValue: number; durationUnit: DurationUnit },
): { holidays: HolidayInput[]; autoFilledYears: number[] } {
  // ERKEN ÇIKIŞ KALDIRILDI (denetim bulgusu K-04).
  //
  // Eskiden `supplied.length === 0` iken bu fonksiyon hiçbir şey yapmadan
  // dönüyordu: "takvim hiç verilmediyse çağıranın bilinçli tercihidir" varsayımı.
  // Gerçekte çağıran takvimi TETİK YILINDAN itibaren sorguluyor
  // (`deadlines.service.ts` `windowStart = 1 Ocak (tetik yılı)`); veritabanında
  // yalnız 2026 kayıtlı olduğu için 2027 tetikli her hesapta sorgu BOŞ dönüyor
  // ve savunma hiç devreye girmiyordu.
  //
  // Canlı ölçüm (HMK_ISTINAF, tebliğ 09.04.2027, ELDEN):
  //   liste BOŞ                        => 2027-04-23 Cuma  ← Ulusal Egemenlik Bayramı
  //   listede alakasız tek 2026 satırı => 2027-04-26 Pzt   ← DOĞRU
  // Aynı kural, aynı tarih; sonuç yalnızca listenin boş olup olmamasına göre
  // değişiyordu. İstinaf süresi HAK DÜŞÜRÜCÜDÜR.
  //
  // Artık boş liste de doldurulur. Dinî bayramlar hicri takvime bağlı olduğu
  // için üretilemez; `collectWarnings` "takvim yüklü değil" uyarısını ve
  // `autoFilledYears` bildirimini korur — yani sessiz bir düzeltme değildir.
  const knownYears = new Set<number>();
  for (const h of supplied) {
    const d = toUtcDate(h.date);
    if (isValidDate(d)) knownYears.add(d.getUTCFullYear());
  }

  const start = toUtcDate(triggerDate);
  if (!isValidDate(start)) return { holidays: supplied, autoFilledYears: [] };

  // Kaba üst sınır: uzama + kaydırma payıyla birlikte hesabın taşabileceği yıl.
  let roughEnd: Date;
  try {
    roughEnd = addDuration(start, rule.durationValue, rule.durationUnit);
  } catch {
    return { holidays: supplied, autoFilledYears: [] };
  }
  const firstYear = start.getUTCFullYear();
  const lastYear = addDays(roughEnd, 30).getUTCFullYear();

  const extra: HolidayInput[] = [];
  const autoFilledYears: number[] = [];
  for (let year = firstYear; year <= lastYear; year += 1) {
    if (knownYears.has(year)) continue;
    autoFilledYears.push(year);
    extra.push(...toHolidayInputs(fixedOfficialHolidays(year)));
  }

  return {
    holidays: extra.length > 0 ? [...supplied, ...extra] : supplied,
    autoFilledYears,
  };
}

interface WarningContext {
  warnings: string[];
  holidayIndex: ReturnType<typeof buildHolidayIndex>;
  holidayCount: number;
  autoFilledYears: number[];
  triggerDate: Date;
  dueDate: Date;
  recessRule: RecessExtensionRule;
  applyRecess: boolean;
}

/** Teyide muhtaç hususları `warnings[]` içine yazar. */
function collectWarnings(ctx: WarningContext): void {
  const { warnings, holidayIndex, holidayCount, triggerDate, dueDate } = ctx;

  // 1) İlgili aralıkta yaklaşık (hicri) bayram tarihi kullanıldı mı?
  //    Karar string aramasına değil `isApproximate` / `isHalfDay` bayraklarına
  //    dayanır; bir yazım değişikliği uyarıları sessizce kapatmasın.
  const approx = new Set<string>();
  const from = triggerDate.getTime() <= dueDate.getTime() ? triggerDate : dueDate;
  const to = triggerDate.getTime() <= dueDate.getTime() ? dueDate : triggerDate;
  const spanDays = Math.min(Math.round((to.getTime() - from.getTime()) / 86_400_000), 800);
  for (let i = 0; i <= spanDays; i += 1) {
    const day = addDays(from, i);
    for (const h of holidayIndex.official.get(toIsoDateKey(day)) ?? []) {
      if (h.isApproximate) approx.add(`${formatTrDate(day)} ${h.name ?? "dinî bayram"}`);
    }
  }
  if (approx.size > 0) {
    warnings.push(
      `Hesap aralığında tarihi kesinleşmemiş dinî bayram günleri var (${[...approx].join("; ")}). ` +
        `Bu tarihler hicri takvime bağlıdır; resmî ilanla teyit ediniz.`,
    );
  }

  // 2) SON GÜN yarım güne (arifeye) mi rastlıyor?
  //    Bu artık bir kaydırma sebebi DEĞİLDİR (2429 s.K. m.2/A: 13.00'e kadar
  //    mesai vardır); işlem son gün öğleden önce tamamlanmalıdır.
  const finalHalfDays = halfDayHolidaysOn(dueDate, holidayIndex);
  if (finalHalfDays.length > 0) {
    warnings.push(
      `SON GÜN (${formatTrDate(dueDate)}) yarım gün tatildir ` +
        `(${finalHalfDays.map((h) => h.name ?? "arife").join(" / ")}). ` +
        `2429 sayılı Kanun m.2/A uyarınca bu günlerde mesai saat 13.00'te sona erer; süre bu gün ` +
        `sona erdiğinden İŞLEMİ SAAT 13.00'TEN ÖNCE TAMAMLAYINIZ.`,
    );
  }

  // 3) Son gün resmî tatil takvimi olmayan bir yıla mı taşıyor?
  const dueYear = dueDate.getUTCFullYear();
  if (holidayCount === 0) {
    // K-04 SONRASI: takvim hiç verilmese bile sabit tarihli resmî tatiller
    // otomatik katılır. Uyarı metni bu yüzden güncellendi — eski metin
    // ("yalnızca hafta sonu kaydırması uygulandı") artık doğru değildir ve
    // avukatı hesabın olduğundan zayıf olduğuna inandırırdı.
    warnings.push(
      `Tatil takvimi hiç verilmedi. Sabit tarihli resmî tatiller (1 Ocak, 23 Nisan, 1 Mayıs, ` +
        `19 Mayıs, 15 Temmuz, 30 Ağustos, 28-29 Ekim) hesaba OTOMATİK KATILDI; ancak hicri ` +
        `takvime bağlı dinî bayramlar (Ramazan/Kurban) ve adli tatil kayıtları EKSİKTİR. ` +
        `Takvimi yükleyip hesabı yenileyiniz.`,
    );
  }
  // `holidayCount === 0` dalı zaten aynı bilgiyi veriyor; iki uyarı basmayalım.
  if (holidayCount > 0 && ctx.autoFilledYears.includes(dueYear)) {
    warnings.push(
      `${dueYear} yılı tatil takvimi yüklü değil. Sabit tarihli resmî tatiller (1 Ocak, ` +
        `23 Nisan, 1 Mayıs, 19 Mayıs, 15 Temmuz, 30 Ağustos, 28-29 Ekim) hesaba OTOMATİK ` +
        `KATILDI; ancak hicri takvime bağlı dinî bayramlar (Ramazan/Kurban) eksiktir. ` +
        `${dueYear} takvimini yükleyip hesabı yenileyiniz.`,
    );
  }

  // 4) CMK m.331/4 "süreler işlemez" (tolling) nüansı.
  //    Uyarı yalnızca uzama uygulandığında değil, SÜRE ARALIĞI adli tatille
  //    KESİŞTİĞİ her hâlde üretilir: süre tatilin içinden geçip 31 Ağustos'tan
  //    sonra bitiyorsa da tolling görüşünde son gün ileriye kayar
  //    (denetim bulgusu 6).
  if (ctx.recessRule === "CMK_331" && intersectsRecess(from, to, holidayIndex)) {
    warnings.push(
      `CMK m.331/4 lafzen "Adlî tatile rastlayan süreler İŞLEMEZ" demektedir; yani süre adli ` +
        `tatil boyunca DURAR. Motor, yerleşik uygulamaya uygun olarak "tatil bitiminden itibaren ` +
        `üç gün uzama" formülünü kullanır. Bu hesapta sürenin işlediği aralık adli tatille ` +
        `kesişmektedir; tolling (durma) görüşü benimsenirse son gün DAHA İLERİ bir tarihe ` +
        `düşer. Hesabı teyit ediniz.`,
    );
  }

  // 5) İYUK m.8/3 çapası — teyide muhtaç (denetim bulgusu 7).
  if (ctx.applyRecess && ctx.recessRule === "IYUK_8" && intersectsRecess(from, to, holidayIndex)) {
    warnings.push(
      `İYUK m.8/3 uzaması, ara vermenin sona erdiği günü İZLEYEN TARİHTEN (1 Eylül) itibaren ` +
        `yedi gün olarak uygulanmıştır. Danıştay uygulamasında yedi günün 1–7 Eylül olarak ` +
        `sayıldığı ve son günün bir gün ÖNCE dolduğu görüşü de vardır. İYUK'taki dava açma ` +
        `süresi HAK DÜŞÜRÜCÜDÜR; son günü beklemeyiniz.`,
    );
  }
}

/** Verilen aralık adli tatille kesişiyor mu (yalnızca bitiş değil, tüm aralık). */
function intersectsRecess(
  from: Date,
  to: Date,
  holidayIndex: ReturnType<typeof buildHolidayIndex>,
): boolean {
  const spanDays = Math.min(Math.round((to.getTime() - from.getTime()) / 86_400_000), 800);
  for (let i = 0; i <= spanDays; i += 1) {
    if (isInJudicialRecess(addDays(from, i), holidayIndex)) return true;
  }
  return false;
}
