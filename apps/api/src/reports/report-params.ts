/**
 * RAPOR PARAMETRE ÇÖZÜMÜ — DÖNEM SINIRLARI BURADA TEK YERDE BELİRLENİR.
 *
 * ORTAK KARAR 2: "Tarih UTC gün bazı; rapor dönemleri kapanış tarihi
 * DAHİL/HARİÇ açıkça belirtilir."
 *
 * SÖZLEŞME — TEK KALIP:
 *   Bütün sorgular `{ gte: period.from, lt: period.endExclusive }` kullanır.
 *   `period.to` kullanıcıya gösterilen SON DAHİL GÜNDÜR; `endExclusive` onun
 *   ertesi günün UTC gün başıdır.
 *
 *   Neden `lte: endOfDay` değil? Çünkü `Deadline.dueDate` @db.Date (saatsiz),
 *   `Hearing.date` ise saat bileşenli timestamp'tir. `lt: ertesiGün00:00`
 *   ikisinde de DOĞRU çalışır; `lte: gün23:59:59.999` ise milisaniye sınırında
 *   yuvarlanan sürücü davranışlarına açıktır. Tek kalıp = tek doğruluk kaynağı.
 *
 * KARŞILAŞTIRMA DÖNEMİ: "önceki dönem", bitişik ve AYNI GÜN SAYISINDA olan
 * dönemdir (`prevEndExclusive = from`). Takvim ayı seçildiğinde bu, önceki ayın
 * gün sayısıyla değil BU ayın gün sayısıyla geriye gider — 31 günlük Ağustos
 * ile 30 günlük Temmuz'u karşılaştırmak yerine eşit uzunlukta iki pencere
 * kıyaslanır. Böylece "yüzde değişim" ay uzunluğundan etkilenmez; dönem
 * etiketleri yanıtta AÇIKÇA döner, okuyucu neyi kıyasladığını görür.
 */

import { BadRequestException } from "@nestjs/common";
import { addDays, formatTrDate, parseDateParam, startOfDay, startOfWeek } from "../common/dates";
import { REPORT_CASE_TYPES } from "./report-catalog";
import {
  PERIOD_PRESETS,
  type PeriodPreset,
  type ReportPeriod,
  type ResolvedReportParams,
} from "./report-types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * `MAX_REPORT_ROWS` KALDIRILDI (denetim bulgusu 4).
 *
 * Hiçbir yerde kullanılmayan bir sabitti; okuyana "tablo başına 1000 satır
 * sınırı var" diye yanlış bir söz veriyordu. Sınırın TEK kaynağı `limit`
 * parametresidir (varsayılan `DEFAULT_REPORT_ROWS`, üst sınır
 * `MAX_REPORT_ROWS_HARD`) ve builder'lar sorguyu `takeWithProbe(limit)` ile
 * çalıştırıp sınıra dayanıldığında tabloyu KIRPILMIŞ işaretler.
 */
/** `limit` parametresinin kabul edilen en büyük değeri. */
export const MAX_REPORT_ROWS_HARD = 5000;
export const DEFAULT_REPORT_ROWS = 500;

/**
 * Dönem uzunluğu üst sınırı (gün). 10 yıllık bir pencere, groupBy sorgularını
 * indeks dışına itip raporu dakikalara çıkarıyordu; sınır aşılırsa 400 döner —
 * sessizce kırpmak, kullanıcıya EKSİK raporu tam sanmasına yol açardı.
 */
export const MAX_PERIOD_DAYS = 1830; // ~5 yıl

/** Uzun dönem uyarı eşiği — rapor çalışır ama kullanıcı bilgilendirilir. */
const LONG_PERIOD_WARN_DAYS = 400;

function isPreset(value: string): value is PeriodPreset {
  return (PERIOD_PRESETS as readonly string[]).includes(value);
}

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function startOfQuarter(date: Date): Date {
  const q = Math.floor(date.getUTCMonth() / 3) * 3;
  return new Date(Date.UTC(date.getUTCFullYear(), q, 1));
}

function startOfYear(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
}

function daysBetween(from: Date, endExclusive: Date): number {
  return Math.round((endExclusive.getTime() - from.getTime()) / MS_PER_DAY);
}

function buildPeriod(
  from: Date,
  endExclusive: Date,
  preset: PeriodPreset,
  endInclusive: boolean,
): ReportPeriod {
  const to = addDays(endExclusive, -1);
  const days = daysBetween(from, endExclusive);
  return {
    from,
    to,
    endExclusive,
    days,
    preset,
    endInclusive,
    label: `${formatTrDate(from)} – ${formatTrDate(to)} (bitiş günü dâhil)`,
  };
}

/**
 * Ön tanımlı dönemi çözer. Dönen aralığın SON GÜNÜ daima DAHİLDİR; ön
 * tanımlarda `donemBitisDahil` parametresi geçerli DEĞİLDİR (bkz.
 * `resolveReportParams` uyarısı) — "bu ay"ın son gününü hariç tutmak
 * kullanıcının kastettiği şey olamaz.
 */
function resolvePreset(preset: PeriodPreset, now: Date): ReportPeriod {
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);

  switch (preset) {
    case "BUGUN":
      return buildPeriod(today, tomorrow, preset, true);
    case "BU_HAFTA":
      return buildPeriod(startOfWeek(today), addDays(startOfWeek(today), 7), preset, true);
    case "BU_AY":
      return buildPeriod(startOfMonth(today), tomorrow, preset, true);
    case "GECEN_AY": {
      const thisMonth = startOfMonth(today);
      const lastMonth = new Date(
        Date.UTC(thisMonth.getUTCFullYear(), thisMonth.getUTCMonth() - 1, 1),
      );
      return buildPeriod(lastMonth, thisMonth, preset, true);
    }
    case "SON_7_GUN":
      return buildPeriod(addDays(today, -6), tomorrow, preset, true);
    case "SON_30_GUN":
      return buildPeriod(addDays(today, -29), tomorrow, preset, true);
    case "SON_90_GUN":
      return buildPeriod(addDays(today, -89), tomorrow, preset, true);
    case "BU_CEYREK":
      return buildPeriod(startOfQuarter(today), tomorrow, preset, true);
    case "BU_YIL":
      return buildPeriod(startOfYear(today), tomorrow, preset, true);
    case "GECEN_YIL": {
      const thisYear = startOfYear(today);
      const lastYear = new Date(Date.UTC(thisYear.getUTCFullYear() - 1, 0, 1));
      return buildPeriod(lastYear, thisYear, preset, true);
    }
    case "OZEL":
      // Çağıran `from`/`to` vermeden OZEL seçemez — resolveReportParams engeller.
      throw new BadRequestException(
        "Özel dönem için `from` ve `to` tarihleri gereklidir (ISO, örn. 2026-08-01).",
      );
  }
}

/**
 * Bitişik ve EŞİT UZUNLUKTA önceki dönem.
 * `prevEndExclusive = from` olduğundan iki dönem ÇAKIŞMAZ — aynı kayıt iki
 * kez sayılamaz.
 */
export function previousPeriod(period: ReportPeriod): ReportPeriod {
  const endExclusive = period.from;
  const from = addDays(endExclusive, -period.days);
  const prev = buildPeriod(from, endExclusive, period.preset, period.endInclusive);
  return { ...prev, label: `${prev.label.replace(" (bitiş günü dâhil)", "")} (önceki dönem)` };
}

function readBool(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const s = String(value).toLowerCase();
  if (["true", "1", "evet", "yes"].includes(s)) return true;
  if (["false", "0", "hayir", "hayır", "no"].includes(s)) return false;
  return fallback;
}

function readUuid(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const s = String(value).trim();
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(s)) {
    throw new BadRequestException(`${label} geçerli bir kayıt kimliği olmalıdır.`);
  }
  return s;
}

/** Yaşlandırma kovaları: artan, pozitif, en fazla 6 eşik. */
function readBuckets(value: unknown): number[] {
  if (value === undefined || value === null || value === "") return [30, 60, 90];
  const list = Array.isArray(value) ? value : String(value).split(",");
  const parsed = list.map((v) => Number.parseInt(String(v).trim(), 10));
  if (parsed.some((n) => !Number.isFinite(n) || n <= 0 || n > 3650)) {
    throw new BadRequestException(
      "Yaşlandırma kovaları 1-3650 arasında gün değerleri olmalıdır (örn. 30,60,90).",
    );
  }
  if (parsed.length === 0 || parsed.length > 6) {
    throw new BadRequestException("En az 1, en fazla 6 yaşlandırma eşiği verilebilir.");
  }
  for (let i = 1; i < parsed.length; i += 1) {
    if (parsed[i] <= parsed[i - 1]) {
      throw new BadRequestException("Yaşlandırma eşikleri artan sırada olmalıdır (örn. 30,60,90).");
    }
  }
  return parsed;
}

export interface ResolveResult {
  params: ResolvedReportParams;
  warnings: string[];
}

/**
 * Ham sorgu/gövde parametrelerini doğrulanmış rapor parametrelerine çevirir.
 *
 * `raw` HEM query string HEM de `SavedReport.paramsJson` olabilir; bu yüzden
 * değerler `unknown` kabul edilip tek tek dönüştürülür (kayıtlı rapordan gelen
 * `true` boolean'ı ile URL'den gelen `"true"` metni aynı yola girer).
 */
export function resolveReportParams(
  raw: Record<string, unknown>,
  now: Date,
  options: { supportsComparison: boolean },
): ResolveResult {
  const warnings: string[] = [];

  const presetRaw = raw.donem === undefined || raw.donem === "" ? undefined : String(raw.donem);
  if (presetRaw !== undefined && !isPreset(presetRaw)) {
    throw new BadRequestException(
      `Geçersiz dönem: ${presetRaw}. Kabul edilenler: ${PERIOD_PRESETS.join(", ")}.`,
    );
  }

  const fromRaw = raw.from === undefined || raw.from === "" ? undefined : String(raw.from);
  const toRaw = raw.to === undefined || raw.to === "" ? undefined : String(raw.to);
  const endInclusiveRequested = readBool(raw.donemBitisDahil, true);

  let period: ReportPeriod;
  if (fromRaw || toRaw) {
    if (!fromRaw || !toRaw) {
      throw new BadRequestException("Özel dönemde `from` ve `to` birlikte verilmelidir.");
    }
    const from = startOfDay(parseDateParam(fromRaw, "from"));
    const boundary = startOfDay(parseDateParam(toRaw, "to"));
    // `donemBitisDahil=false` → `to` günü HARİÇ; üst sınır doğrudan o gün olur.
    const endExclusive = endInclusiveRequested ? addDays(boundary, 1) : boundary;
    if (endExclusive.getTime() <= from.getTime()) {
      throw new BadRequestException(
        "Dönem bitişi başlangıcından sonra olmalıdır (bitiş günü hariç seçildiyse en az bir gün fark gerekir).",
      );
    }
    const days = daysBetween(from, endExclusive);
    if (days > MAX_PERIOD_DAYS) {
      throw new BadRequestException(
        `Rapor dönemi en fazla ${MAX_PERIOD_DAYS} gün olabilir; seçilen dönem ${days} gün. ` +
          "Dönemi bölerek çalıştırın.",
      );
    }
    period = buildPeriod(from, endExclusive, "OZEL", endInclusiveRequested);
    if (!endInclusiveRequested) {
      period = {
        ...period,
        label: `${formatTrDate(period.from)} – ${formatTrDate(period.to)} (${formatTrDate(boundary)} HARİÇ)`,
      };
    }
  } else {
    period = resolvePreset(presetRaw ?? "BU_AY", now);
    if (raw.donemBitisDahil !== undefined && !endInclusiveRequested) {
      warnings.push(
        "`donemBitisDahil=false` yalnız `from`/`to` ile verilen özel dönemde geçerlidir; " +
          "ön tanımlı dönemin son günü daima dâhildir.",
      );
    }
  }

  if (period.days > LONG_PERIOD_WARN_DAYS) {
    warnings.push(
      `Dönem ${period.days} gün. Uzun dönemlerde rapor daha yavaş üretilir ve ayrıntı ` +
        "tabloları satır sınırına takılabilir.",
    );
  }

  const wantsComparison = readBool(raw.karsilastir, true) && options.supportsComparison;
  const comparison = wantsComparison ? previousPeriod(period) : undefined;

  const limitRaw = Number.parseInt(String(raw.limit ?? ""), 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(MAX_REPORT_ROWS_HARD, Math.max(1, limitRaw))
    : DEFAULT_REPORT_ROWS;

  const caseTypeRaw = raw.dosyaTuru === undefined || raw.dosyaTuru === "" ? undefined : String(raw.dosyaTuru);
  // Liste KATALOGDAN gelir; iki yerde ayrı yazılsaydı katalog kullanıcıya 400
  // alacağı bir seçenek sunabilirdi (denetim bulgusu 25).
  if (caseTypeRaw && !(REPORT_CASE_TYPES as readonly string[]).includes(caseTypeRaw)) {
    throw new BadRequestException(
      `Geçersiz dosya türü: ${caseTypeRaw}. Kabul edilenler: ${REPORT_CASE_TYPES.join(", ")}.`,
    );
  }

  return {
    params: {
      period,
      comparison,
      limit,
      userId: readUuid(raw.kullaniciId, "kullaniciId"),
      clientId: readUuid(raw.muvekkilId, "muvekkilId"),
      caseType: caseTypeRaw,
      agingBuckets: readBuckets(raw.kovalarGun),
      raw,
    },
    warnings,
  };
}
