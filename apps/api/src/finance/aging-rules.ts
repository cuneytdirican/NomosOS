/**
 * TAHSİLAT YAŞLANDIRMA — saf kural katmanı.
 *
 * Denetim bulgusu K-05: `finance-summary.service.ts` gecikmeyi doğru referansla
 * hesaplayıp (`dueDate ?? issueDate`) sonra atıyordu:
 *
 *     overdueDays: inv.dueDate ? overdueDays : 0,   // ← hesap çöpe
 *
 * Zincir: vade null → `notYetDue=false` → `overdueDays <= 30` → **"0-30" kovası**;
 * `overdueDays > 0` süzgeci yüzünden fatura `overdue` listesine hiç girmiyor →
 * `overdueInvoiceCount`, `oldestOverdueDays`, `averageOverdueDays` hepsi 0 →
 * risk bandı gecikme kolundan hiç yükselemiyor. Canlı ölçümde aynı fatura
 * `/finance/summary` ucunda "0-30 gün", `/reports/tahsilat-yaslandirma` ucunda
 * "91+ gün / 959 gün" görünüyordu.
 *
 * Servisin kendi belgesi zaten doğrusunu söylüyordu: "Vadesi belirtilmemiş
 * faturada düzenleme tarihi esas alınır." Rapor builder'ı da doğru yapıyordu
 * (`tahsilat-yaslandirma.report.ts`: `const reference = inv.dueDate ?? inv.issueDate;`).
 *
 * Kurallar buraya taşındı ki iki uç AYNI mantığı paylaşsın ve birim testlensin —
 * `finance-summary` için hiç test yoktu, bu bulgunun hayatta kalma sebebi budur.
 */

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** UTC gün başlangıcı (saat/dakika/saniye atılır). */
function dayStart(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * İŞARETLİ gecikme günü.
 *
 * - Pozitif: referans tarihten bu kadar gün geçmiş (gecikme).
 * - Sıfır: referans tarih bugün.
 * - **Negatif: vadesi henüz gelmemiş** — `Math.max(0, …)` ile kırpılMAZ, çünkü
 *   "vadesi gelmemiş" ile "bugün vadesi dolmuş" ayrımı tam da bu işarettedir.
 */
export function overdueDaysOf(referenceDate: Date, today: Date): number {
  return Math.floor((dayStart(today) - dayStart(referenceDate)) / MS_PER_DAY);
}

/**
 * Bir açık faturanın yaşlandırma referansı.
 *
 * VADE YOKSA DÜZENLEME TARİHİ ESAS ALINIR. Vadesiz fatura "hiç gecikmez" demek
 * değildir; 2024 tarihli, vadesiz, hiç ödenmemiş bir fatura 959 gün gecikmiştir.
 */
export function agingReferenceDate(invoice: {
  dueDate: Date | null;
  issueDate: Date;
}): Date {
  return invoice.dueDate ?? invoice.issueDate;
}

export type AgingBucket = "notDue" | "0-30" | "31-60" | "61-90" | "90+";

/**
 * Kova seçimi — yalnızca işaretli `overdueDays`'e bakar.
 *
 * `dueDate`'in null olup olmadığına BAKMAZ: eskiden `notYetDue` kararı
 * `b.dueDate !== null && …` ile veriliyordu ve vadesiz fatura "vadesi gelmemiş"
 * de sayılamayıp doğrudan "0-30" kovasına düşüyordu.
 */
export function agingBucketOf(overdueDays: number): AgingBucket {
  if (overdueDays < 0) return "notDue";
  if (overdueDays <= 30) return "0-30";
  if (overdueDays <= 60) return "31-60";
  if (overdueDays <= 90) return "61-90";
  return "90+";
}

/** Gecikmiş sayılan fatura: kalan bakiyesi var VE referans tarihi geçmiş. */
export function isOverdue(balance: { overdueDays: number }): boolean {
  return balance.overdueDays > 0;
}
