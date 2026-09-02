/**
 * KIDEM VE İHBAR TAZMİNATI MOTORU (geliştirme planı A3).
 *
 * Dayanaklar:
 *   - 1475 s.K. m.14: kıdem tazminatı — her tam yıl için 30 gün ücret;
 *     artan süre 1 yılı aşarsa tam yıl, yeniden 6 ay = 1 yıl, 6 aydan küçük
 *     artan süre için 6 ay (m.14/2 son parantez içi).
 *   - İş K. m.17: ihbar tazminatı — kıdeme göre 2/4/6/8 hafta.
 *   - Tavan: en yüksek devlet memuruna ödenen azami emekli ikramiyesi tutarı
 *     (Bu SABİT DEĞİLDİR; parametre olarak girilir, varsayılan kod içinde taşımaz).
 *
 * İLKE (vekalet-ucreti.ts ile aynı): hesabın HER ADIMI görünür — arayüz
 * adımları aynen gösterir; avukat denetleyebilir.
 *
 * UYARI: Bu motor HESAP makinesidir; dava değerini belirlemez. Giyim/taahhüt
 * kesintileri, fazlalık yargılaması farkları, fesih usulsüzlüğü (m.21 işe iade)
 * ve tazminatın fesih hukuka uygunluğuna bağlılığı kapsam DIŞIDIR — çıktıda
 * açıkça belirtilir.
 */

export interface KidemIhbarInput {
  /** Brüt ücret (TL, aylık). */
  monthlyGross: number;
  /** İşe giriş tarihi (YYYY-AA-GG). */
  startDate: string;
  /** İşten çıkış tarihi (YYYY-AA-GG). */
  endDate: string;
  /** Kıdem tazminatı tavanı (TL, aylık brüt) — dönem tavanı; 0 = tavan yok. */
  ceiling?: number;
  /** İhbar tazminatı hesaplansın mı? (işveren feshi / haklı olmayan fesih) */
  includeNotice?: boolean;
}

export interface CalcStep {
  label: string;
  detail: string;
  value?: string;
}

export interface KidemIhbarResult {
  /** Tam yıl sayısı. */
  fullYears: number;
  /** Artan ay sayısı (tam yıl artan). */
  remainingMonths: number;
  /** Kıdem tazminatı için ödenecek gün. */
  kidemDays: number;
  /** Günlük brüt ücret (tavan uygulanmışsa tavan üzerinden). */
  dailyGross: number;
  /** Kıdem tazminatı (TL). */
  kidemTazminat: number;
  /** İhbar süresi (hafta) — null: hesaplanmadı. */
  ihbarWeeks: number | null;
  /** İhbar tazminatı (TL) — null: hesaplanmadı. */
  ihbarTazminat: number | null;
  /** Tavan uygulandı mı? */
  ceilingApplied: boolean;
  /** Hesap adımları — arayüzde aynen gösterilir. */
  steps: CalcStep[];
  /** Uyarılar — kapsam dışı hususlar. */
  warnings: string[];
}

/** İki tarih arası tam yıl ve artan ay — takvim esası (m.14). */
function yearsAndMonthsBetween(start: Date, end: Date): { years: number; months: number; days: number } {
  let years = end.getUTCFullYear() - start.getUTCFullYear();
  let months = end.getUTCMonth() - start.getUTCMonth();
  let days = end.getUTCDate() - start.getUTCDate();
  if (days < 0) {
    months -= 1;
    // Önceki ayın gün sayısıyla tamamla.
    const prevMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 0));
    days += prevMonth.getUTCDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years, months, days };
}

export function calculateKidemIhbar(input: KidemIhbarInput): KidemIhbarResult {
  const steps: CalcStep[] = [];
  const warnings: string[] = [];

  if (!(input.monthlyGross > 0)) throw new Error("Brüt ücret sıfırdan büyük olmalıdır.");
  const start = new Date(`${input.startDate}T00:00:00Z`);
  const end = new Date(`${input.endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Tarihler YYYY-AA-GG biçiminde olmalıdır.");
  }
  if (end <= start) throw new Error("Çıkış tarihi giriş tarihinden sonra olmalıdır.");

  const { years, months, days } = yearsAndMonthsBetween(start, end);
  steps.push({
    label: "Kıdem süresi",
    detail: `${input.startDate} → ${input.endDate}`,
    value: `${years} yıl ${months} ay ${days} gün`,
  });

  // Kıdem günü: her yıl 30 gün + artan süre kuralı (m.14/2).
  let kidemDays = years * 30;
  steps.push({
    label: "Tam yıllar",
    detail: `${years} yıl × 30 gün`,
    value: `${years * 30} gün`,
  });
  if (months >= 6) {
    // 6 ay–1 yıl arası artan: 1 yıl sayılır (30 gün); yeniden 6 ay = 30 gün.
    kidemDays += months >= 12 ? 360 : months >= 6 ? 30 : 0;
    if (months >= 6 && months < 12) {
      kidemDays += 0; // yukarıda eklendi — okunurluk için adım yazılır:
      steps.push({
        label: "Artan süre (6 ay–1 yıl)",
        detail: `${months} ay artan süre → 1 tam yıl sayılır`,
        value: "30 gün",
      });
    }
  }
  // 6 aydan küçük artan süre kıdem tazminatına eklenmez — ancak ihbar süresine eklenir.
  // (Basitleştirilmiş kural: months >= 6 → 30 gün.)

  // Tavan uygulaması.
  const ceiling = input.ceiling ?? 0;
  const ceilingApplied = ceiling > 0 && input.monthlyGross > ceiling;
  const effectiveMonthly = ceilingApplied ? ceiling : input.monthlyGross;
  if (ceilingApplied) {
    steps.push({
      label: "Tavan uygulaması",
      detail: `Brüt ücret ${input.monthlyGross.toFixed(2)} TL tavanı aştı; tavan esas alındı`,
      value: `${ceiling.toFixed(2)} TL (tavan)`,
    });
  }
  const dailyGross = effectiveMonthly / 30;
  steps.push({
    label: "Günlük brüt ücret",
    detail: `${effectiveMonthly.toFixed(2)} TL / 30`,
    value: `${dailyGross.toFixed(2)} TL`,
  });

  const kidemTazminat = Math.round(dailyGross * kidemDays * 100) / 100;
  steps.push({
    label: "Kıdem tazminatı",
    detail: `${kidemDays} gün × ${dailyGross.toFixed(2)} TL`,
    value: `${kidemTazminat.toFixed(2)} TL`,
  });

  // İhbar tazminatı — İş K. m.17 kıdem aralıkları.
  let ihbarWeeks: number | null = null;
  let ihbarTazminat: number | null = null;
  if (input.includeNotice !== false) {
    if (years < 0) ihbarWeeks = null;
    const totalMonths = years * 12 + months;
    if (totalMonths < 6) ihbarWeeks = 2;
    else if (totalMonths < 18) ihbarWeeks = 4;
    else if (totalMonths < 36) ihbarWeeks = 6;
    else ihbarWeeks = 8;
    // İhbar tazminatı brüt ücret üzerinden (tavan UYGULANMAZ — ücret üzerinden).
    const dailyOriginal = input.monthlyGross / 30;
    ihbarTazminat = Math.round(dailyOriginal * ihbarWeeks * 7 * 100) / 100;
    steps.push({
      label: `İhbar tazminatı (${ihbarWeeks} hafta)`,
      detail: `Kıdem ${years} yıl ${months} ay → m.17: ${ihbarWeeks} hafta · ${dailyOriginal.toFixed(2)} TL × ${ihbarWeeks * 7} gün`,
      value: `${ihbarTazminat.toFixed(2)} TL`,
    });
  }

  warnings.push(
    "Kıdem tazminatı tavanı döneme göre değişir — güncel tavanı teyit ederek girin.",
    "Fesih usulsüzse işe iade (İş K. m.21) ve ücret/diğer alacaklar ayrıca değerlendirilmelidir.",
    "Giyecek ve tahsisat kesintileri, fazla mesai ve sosyal yardımlar brüt ücrete eklenebilir (Yargıtay içtihadına göre).",
  );

  return {
    fullYears: years,
    remainingMonths: months,
    kidemDays,
    dailyGross: Math.round(dailyGross * 100) / 100,
    kidemTazminat,
    ihbarWeeks,
    ihbarTazminat,
    ceilingApplied,
    steps,
    warnings,
  };
}
