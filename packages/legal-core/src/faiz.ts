/**
 * FAİZ HESAPLAYICI (geliştirme planı A3) — kanuni ve asgari temerrüt faizi.
 *
 * Dayanaklar:
 *   - 3095 sayılı Türk Kanunu Medenîsi m.4: borç para faizinde yıllık %9'un
 *     aşamayacağı temerrüt faizi (asgari); TBK m.88: yıllık %5 kanuni faiz.
 *   - Temerrüt faizi oranı (ağırlaştırılmış) tüketici işlemlerinde aylık asgari
 *     ücrete göre belirlenir ve DÖNEMSEL DEĞİŞİR — motor ORAN PARAMETRE ALIR;
 *     kod içinde oran taşımaz (taşınan oran bayatlar).
 *
 * Basit faiz (bileşik DEĞİL — Yargıtay icra takibinde basit faiz esastır);
 * gün esası: 3095 tarihinden itibaren tam gün sayımı, takvim yılı/365.
 */

export interface FaizInput {
  /** Ana para (TL). */
  principal: number;
  /** Başlangıç (YYYY-AA-GG) — temerrüt/başlangıç tarihi. */
  fromDate: string;
  /** Bitiş (YYYY-AA-GG). */
  toDate: string;
  /** Yıllık faiz oranı — yüzde (örn. 24.75 için 24.75). */
  annualRatePercent: number;
}

export interface FaizResult {
  days: number;
  interest: number;
  total: number;
  steps: Array<{ label: string; detail?: string; value?: string }>;
}

export function calculateSimpleInterest(input: FaizInput): FaizResult {
  if (!(input.principal > 0)) throw new Error("Ana para sıfırdan büyük olmalıdır.");
  if (!(input.annualRatePercent > 0)) throw new Error("Faiz oranı sıfırdan büyük olmalıdır.");
  const from = new Date(`${input.fromDate}T00:00:00Z`);
  const to = new Date(`${input.toDate}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new Error("Tarihler YYYY-AA-GG biçiminde olmalıdır.");
  }
  if (to <= from) throw new Error("Bitiş tarihi başlangıçtan sonra olmalıdır.");

  const days = Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60_000));
  // Basit faiz: anapara × oran × gün / 365 / 100.
  const interest = Math.round(((input.principal * input.annualRatePercent * days) / 365 / 100) * 100) / 100;
  const total = Math.round((input.principal + interest) * 100) / 100;

  return {
    days,
    interest,
    total,
    steps: [
      { label: "Dönem", detail: `${input.fromDate} → ${input.toDate}`, value: `${days} gün` },
      {
        label: "Günlük faiz",
        detail: `${input.principal.toLocaleString("tr-TR")} TL × %${input.annualRatePercent} / 365`,
        value: `${((input.principal * input.annualRatePercent) / 365 / 100).toFixed(4)} TL/gün`,
      },
      {
        label: "İşlemiş faiz (basit)",
        detail: `${days} gün × günlük faiz`,
        value: `${interest.toFixed(2)} TL`,
      },
      { label: "Ana para + faiz", value: `${total.toFixed(2)} TL` },
    ],
  };
}

/* ------------------------------------------------------------------ *
 * Faz 6 — DÖNEMLİ FAİZ: oran, dönem tablosundan tarihe göre değişir.
 * (3095 s.K. kanuni faiz, TCMB avans faizi, ticari temerrüt faizi.)
 * ------------------------------------------------------------------ */

export interface RatePeriod {
  /** Dönemin başladığı gün (YYYY-AA-GG); bir sonraki dönemin başına kadar geçerli. */
  validFrom: string;
  annualRatePercent: number;
}

export interface PeriodInterestInput {
  principal: number;
  fromDate: string;
  toDate: string;
  /** Artan tarih sırasında olması gerekmez; fonksiyon sıralar. */
  periods: RatePeriod[];
}

export interface PeriodInterestSegment {
  from: string;
  to: string;
  days: number;
  annualRatePercent: number;
  interest: number;
}

export interface PeriodInterestResult {
  days: number;
  interest: number;
  total: number;
  segments: PeriodInterestSegment[];
  steps: Array<{ label: string; detail?: string; value?: string }>;
  warnings: string[];
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Basit faiz, dönem tablosuyla: [from, to) aralığı dönem sınırlarında bölünür, her dilim kendi
 * yıllık oranıyla (yıl 365 gün) hesaplanır. Aralığın başında geçerli dönem yoksa uyarı verir ve
 * o kısım FAİZSİZ kalır (oran uydurulmaz).
 */
export function calculatePeriodInterest(input: PeriodInterestInput): PeriodInterestResult {
  if (!(input.principal > 0)) throw new Error("Ana para sıfırdan büyük olmalıdır.");
  const from = new Date(`${input.fromDate}T00:00:00Z`);
  const to = new Date(`${input.toDate}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new Error("Tarihler YYYY-AA-GG biçiminde olmalıdır.");
  if (to <= from) throw new Error("Bitiş tarihi başlangıçtan sonra olmalıdır.");
  const periods = [...input.periods]
    .map((p) => ({ start: new Date(`${p.validFrom}T00:00:00Z`), rate: p.annualRatePercent }))
    .filter((p) => !Number.isNaN(p.start.getTime()) && p.rate > 0)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const warnings: string[] = [];
  const segments: PeriodInterestSegment[] = [];
  const DAY = 86_400_000;

  // Kesme noktaları: from, aralık içindeki dönem başlangıçları, to.
  const cuts = [from.getTime(), ...periods.map((p) => p.start.getTime()).filter((t) => t > from.getTime() && t < to.getTime()), to.getTime()];
  const uniqueCuts = [...new Set(cuts)].sort((a, b) => a - b);
  let interestCents = 0;
  for (let i = 0; i < uniqueCuts.length - 1; i++) {
    const segFrom = uniqueCuts[i];
    const segTo = uniqueCuts[i + 1];
    const days = Math.round((segTo - segFrom) / DAY);
    const period = [...periods].reverse().find((p) => p.start.getTime() <= segFrom);
    if (!period) {
      warnings.push(`${isoDay(new Date(segFrom))} – ${isoDay(new Date(segTo))} aralığı için tanımlı faiz dönemi yok; bu dilim faizsiz bırakıldı. Platform panelinden dönem oranını girin.`);
      segments.push({ from: isoDay(new Date(segFrom)), to: isoDay(new Date(segTo)), days, annualRatePercent: 0, interest: 0 });
      continue;
    }
    const segInterestCents = Math.round((input.principal * 100 * period.rate * days) / 365 / 100);
    interestCents += segInterestCents;
    segments.push({ from: isoDay(new Date(segFrom)), to: isoDay(new Date(segTo)), days, annualRatePercent: period.rate, interest: segInterestCents / 100 });
  }
  const days = Math.round((to.getTime() - from.getTime()) / DAY);
  const interest = interestCents / 100;
  const total = Math.round((input.principal + interest) * 100) / 100;
  return {
    days,
    interest,
    total,
    segments,
    warnings,
    steps: [
      { label: "Dönem", detail: `${input.fromDate} → ${input.toDate}`, value: `${days} gün` },
      ...segments.map((sg) => ({
        label: `Dilim ${sg.from} – ${sg.to}`,
        detail: sg.annualRatePercent > 0 ? `${input.principal.toLocaleString("tr-TR")} TL × %${sg.annualRatePercent} × ${sg.days} / 365` : "tanımlı oran yok",
        value: `${sg.interest.toFixed(2)} TL`,
      })),
      { label: "İşlemiş faiz (dönemli, basit)", value: `${interest.toFixed(2)} TL` },
      { label: "Ana para + faiz", value: `${total.toFixed(2)} TL` },
    ],
  };
}
