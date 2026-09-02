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
