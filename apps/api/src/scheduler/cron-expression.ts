import { BadRequestException } from "@nestjs/common";
import { SCHEDULER_TZ_OFFSET_MINUTES } from "./scheduler.constants";

/**
 * 5 ALANLI CRON — AYRIŞTIRICI VE "SONRAKİ ÇALIŞMA" HESABI.
 *
 * NEDEN KENDİ AYRIŞTIRICIMIZ VAR:
 *   BullMQ cron desenini KENDİ İÇİNDE (`cron-parser`) çözer; kuyruğa deseni
 *   verip geçmek yeterlidir. Ancak bizim iki şeye daha ihtiyacımız var:
 *     1. PATCH /jobs/:key ile gelen ifadeyi KAYDETMEDEN ÖNCE doğrulamak —
 *        bozuk bir ifade sessizce yazılırsa iş bir daha hiç çalışmaz;
 *     2. `ScheduledJob.nextRunAt` alanını Redis AYAKTA OLMASA DA doldurmak —
 *        panel "bir sonraki çalışma" satırını kuyruğa sormaz.
 *   `cron-parser` `apps/api/package.json`'da doğrudan bağımlılık değildir
 *   (yalnız BullMQ'nun geçişli bağımlılığıdır) ve o dosya bu ajanın
 *   sahipliğinde değildir; bu yüzden hesap burada, bağımlılıksız yapılır.
 *
 * SAAT DİLİMİ: ifade TÜRKİYE YEREL SAATİYLE yorumlanır (SCHEDULER_TIMEZONE).
 * Türkiye'de yaz saati YOKTUR, ofset sabit +03:00'tür; bu yüzden sabit ofsetli
 * çevrim ile IANA veritabanı aynı sonucu verir — BullMQ'ya `tz` olarak IANA
 * adı verilse de iki taraf aynı anı hesaplar.
 *
 * DESTEKLENEN SÖZDİZİM (Vixie cron alt kümesi):
 *   `*` · `a` · `a-b` · `＊/n` · `a-b/n` · virgüllü liste · gün/ay adları.
 *   `@daily` gibi takma adlar, `L`/`W`/`#` gibi Quartz uzantıları DESTEKLENMEZ
 *   ve açık hata mesajıyla reddedilir — sessizce kabul edip yanlış zamanda
 *   çalışmaktansa kaydı reddetmek tercih edilir.
 */

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const TZ_OFFSET_MS = SCHEDULER_TZ_OFFSET_MINUTES * MS_PER_MINUTE;

/** İleriye doğru taranacak azami gün — "31 Şubat" gibi hiç gerçekleşmeyen
 *  ifadelerde sonsuz döngüyü engeller. 4 yıl artık yılı da kapsar. */
const MAX_SCAN_DAYS = 366 * 4;

export interface CronSpec {
  /** Ayrıştırılmış özgün ifade (normalize edilmiş boşluklarla). */
  expression: string;
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  /** 0 = Pazar … 6 = Cumartesi. `7` girildiyse `0`a indirgenir. */
  daysOfWeek: number[];
  /** Alan `*` değil mi? Ay-günü / hafta-günü BİRLİKTE kısıtlıysa VEYA uygulanır. */
  domRestricted: boolean;
  dowRestricted: boolean;
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const DOW_NAMES: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

const FIELD_LABELS = ["Dakika", "Saat", "Ayın günü", "Ay", "Haftanın günü"];

function fail(message: string): never {
  throw new BadRequestException(message);
}

/** Tek bir alanı çözer; sıralı ve tekrarsız değer listesi döner. */
function parseField(
  raw: string,
  index: number,
  min: number,
  max: number,
  names?: Record<string, number>
): { values: number[]; restricted: boolean } {
  const label = FIELD_LABELS[index];
  const field = raw.trim();
  if (field.length === 0) fail(`${label} alanı boş olamaz.`);

  const restricted = field !== "*";
  const out = new Set<number>();

  for (const part of field.split(",")) {
    const chunk = part.trim();
    if (chunk.length === 0) fail(`${label} alanında boş liste öğesi var: "${field}".`);

    const [rangePart, stepPart, ...extra] = chunk.split("/");
    if (extra.length > 0) fail(`${label} alanında birden çok "/" kullanılamaz: "${chunk}".`);

    let step = 1;
    if (stepPart !== undefined) {
      step = Number(stepPart);
      if (!Number.isInteger(step) || step < 1) {
        fail(`${label} alanındaki adım değeri pozitif tam sayı olmalıdır: "${chunk}".`);
      }
    }

    let from: number;
    let to: number;
    if (rangePart === "*") {
      from = min;
      to = max;
    } else if (rangePart.includes("-")) {
      const [a, b, ...rest] = rangePart.split("-");
      if (rest.length > 0) fail(`${label} alanında geçersiz aralık: "${chunk}".`);
      from = toNumber(a, label, min, max, names);
      to = toNumber(b, label, min, max, names);
      if (from > to) {
        fail(`${label} alanında aralığın başı sonundan büyük olamaz: "${chunk}".`);
      }
    } else {
      from = toNumber(rangePart, label, min, max, names);
      // Adımlı tekil değer (`5/10`) Vixie cron'da `5-max/10` anlamına gelir.
      to = stepPart === undefined ? from : max;
    }

    for (let v = from; v <= to; v += step) out.add(v);
  }

  const values = [...out].sort((a, b) => a - b);
  if (values.length === 0) fail(`${label} alanı hiçbir değer üretmiyor: "${field}".`);
  return { values, restricted };
}

function toNumber(
  token: string,
  label: string,
  min: number,
  max: number,
  names?: Record<string, number>
): number {
  const trimmed = token.trim().toLowerCase();
  if (trimmed.length === 0) fail(`${label} alanında eksik değer var.`);

  let value: number;
  if (names && trimmed in names) {
    value = names[trimmed];
  } else {
    if (!/^\d+$/.test(trimmed)) {
      fail(
        `${label} alanında anlaşılmayan değer: "${token}". ` +
          "Yalnız sayılar, aralık (a-b), adım (*/n) ve virgüllü liste desteklenir; " +
          "@daily takma adları ve L/W/# uzantıları desteklenmez."
      );
    }
    value = Number(trimmed);
  }

  // Haftanın günü alanında 7 = Pazar (0 ile eşdeğer) — yaygın uzlaşı.
  if (max === 6 && value === 7) value = 0;

  if (value < min || value > max) {
    fail(`${label} alanı ${min}-${max} aralığında olmalıdır (gelen: "${token}").`);
  }
  return value;
}

/** Cron ifadesini çözer. Geçersizse Türkçe 400 fırlatır. */
export function parseCron(expression: string): CronSpec {
  if (typeof expression !== "string") fail("Cron ifadesi metin olmalıdır.");
  const normalized = expression.trim().replace(/\s+/g, " ");
  if (normalized.startsWith("@")) {
    fail(
      `Cron takma adları (${normalized}) desteklenmez. 5 alanlı ifade yazın, ` +
        'örn. günlük 07:00 için "0 7 * * *".'
    );
  }
  const fields = normalized.split(" ");
  if (fields.length !== 5) {
    fail(
      `Cron ifadesi 5 alanlı olmalıdır (dakika saat ayın-günü ay haftanın-günü); ` +
        `${fields.length} alan geldi: "${normalized}".`
    );
  }

  const minute = parseField(fields[0], 0, 0, 59);
  const hour = parseField(fields[1], 1, 0, 23);
  const dom = parseField(fields[2], 2, 1, 31);
  const month = parseField(fields[3], 3, 1, 12, MONTH_NAMES);
  const dow = parseField(fields[4], 4, 0, 6, DOW_NAMES);

  return {
    expression: normalized,
    minutes: minute.values,
    hours: hour.values,
    daysOfMonth: dom.values,
    months: month.values,
    daysOfWeek: dow.values,
    domRestricted: dom.restricted,
    dowRestricted: dow.restricted,
  };
}

/** Doğrulama amaçlı — fırlatmaz. */
export function isValidCron(expression: string): boolean {
  try {
    parseCron(expression);
    return true;
  } catch {
    return false;
  }
}

/**
 * Vixie cron gün eşleşmesi.
 *
 * KURAL: ayın günü ve haftanın günü İKİSİ BİRDEN kısıtlıysa VEYA uygulanır
 * (`0 0 1 * mon` → ayın 1'i VEYA her pazartesi). Biri `*` ise yalnız diğeri
 * belirleyicidir. Bu, standart cron davranışıdır; VE uygulamak "her ayın 1'i
 * pazartesiye denk gelirse" gibi bambaşka bir takvim üretirdi.
 */
function dayMatches(spec: CronSpec, dayOfMonth: number, dayOfWeek: number): boolean {
  if (!spec.domRestricted && !spec.dowRestricted) return true;
  if (spec.domRestricted && spec.dowRestricted) {
    return spec.daysOfMonth.includes(dayOfMonth) || spec.daysOfWeek.includes(dayOfWeek);
  }
  if (spec.domRestricted) return spec.daysOfMonth.includes(dayOfMonth);
  return spec.daysOfWeek.includes(dayOfWeek);
}

/**
 * `from` anından SONRAKİ ilk çalışma anı (UTC `Date`), ya da ifade hiç
 * gerçekleşmiyorsa (`0 0 30 2 *` gibi) `null`.
 *
 * Hesap TR yerel duvar saatinde yapılır: `from` +03:00 kaydırılır, alanlar
 * UTC getter'larıyla YEREL alanlar gibi okunur, bulunan an geri kaydırılır.
 * Böylece sunucunun `TZ` değişkeni sonucu etkilemez.
 *
 * `from` dakikası dahil DEĞİLDİR (bir sonraki dakikadan başlanır); aksi hâlde
 * cron tam tetiklendiği dakikada "sonraki çalışma = şimdi" derdi.
 */
export function nextRun(spec: CronSpec, from: Date): Date | null {
  const local = new Date(from.getTime() + TZ_OFFSET_MS);
  // Dakikaya yuvarla ve bir dakika ilerlet.
  const cursor = new Date(Math.floor(local.getTime() / MS_PER_MINUTE) * MS_PER_MINUTE + MS_PER_MINUTE);

  const startYear = cursor.getUTCFullYear();
  const startMonth = cursor.getUTCMonth();
  const startDate = cursor.getUTCDate();
  const startHour = cursor.getUTCHours();
  const startMinute = cursor.getUTCMinutes();

  let day = new Date(Date.UTC(startYear, startMonth, startDate));

  for (let i = 0; i < MAX_SCAN_DAYS; i += 1) {
    const isFirstDay = i === 0;
    const month = day.getUTCMonth() + 1;

    if (spec.months.includes(month) && dayMatches(spec, day.getUTCDate(), day.getUTCDay())) {
      for (const hour of spec.hours) {
        if (isFirstDay && hour < startHour) continue;
        for (const minute of spec.minutes) {
          if (isFirstDay && hour === startHour && minute < startMinute) continue;
          const localHit = new Date(
            Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, minute)
          );
          return new Date(localHit.getTime() - TZ_OFFSET_MS);
        }
      }
    }
    day = new Date(day.getTime() + MS_PER_DAY);
  }
  return null;
}

/**
 * Kayıtlı (dolayısıyla daha önce doğrulanmış ama sonradan bozulmuş olabilecek)
 * bir ifade için sonraki çalışma. ASLA fırlatmaz — açılışta veya liste ucunda
 * tek bozuk satır tüm yanıtı düşürmemelidir.
 */
export function safeNextRun(expression: string, from: Date): Date | null {
  try {
    return nextRun(parseCron(expression), from);
  } catch {
    return null;
  }
}
