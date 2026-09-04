/**
 * SÖZLEŞME GENEL RİSK SKORU — DETERMİNİSTİK SUNUCU HESABI.
 *
 * Para/skor disiplini (plans/sozlesme-analiz-ve-simulasyon-modulu-plani.md):
 * model skoru YAZAMAZ; ağırlıklı bileşim bu dosyadaki saf fonksiyonla
 * hesaplanır ve ContractAnalysisRun.overallRiskScore'a yazılır.
 *
 * FORMÜL:
 *   ağırlık      : KRITIK=10, ORTA=5, DUSUK=2
 *   ham toplam   : şerhlerin ağırlık toplamı
 *   skor         : min(100, round(hamToplam / DOYMA_NOKTASI * 100))
 *
 * DOYMA_NOKTASI = 50: 5 KRITIK ya da 10 ORTA şerh skoru 100'e taşır; bunun
 * altındaki değerler orantılı normalize edilir. Skor asla 100'ü aşamaz —
 * "sonsuz risk" diye bir durum yoktur, 100 "ağırlıklı doyma" demektir.
 */

import type { ContractAnnotationSeverity } from "@nomosos/db";

export const SEVERITY_WEIGHTS: Record<ContractAnnotationSeverity, number> = {
  KRITIK: 10,
  ORTA: 5,
  DUSUK: 2,
};

/** Ham ağırlık toplamının 100 puana normalize edildiği doyma noktası. */
export const SCORE_SATURATION_POINT = 50;

/** Skor bandı — liste kartındaki renk bandının tek kaynağı. */
export type ContractRiskBand = "DUSUK" | "ORTA" | "YUKSEK";

export const CONTRACT_RISK_BAND_LABELS: Record<ContractRiskBand, string> = {
  DUSUK: "Düşük risk",
  ORTA: "Orta risk",
  YUKSEK: "Yüksek risk",
};

/** Bandın kart görünümündeki tonu (yeşil / sarı / kırmızı). */
export const CONTRACT_RISK_BAND_TONES: Record<ContractRiskBand, "green" | "yellow" | "red"> = {
  DUSUK: "green",
  ORTA: "yellow",
  YUKSEK: "red",
};

/**
 * Skoru banda indirger. 0-29 DUSUK (yeşil), 30-59 ORTA (sarı), 60-100
 * YUKSEK (kırmızı). Sınır değerleri üst banda dahildir: 60 = YUKSEK.
 */
export function riskBandOf(score: number): ContractRiskBand {
  const clamped = Math.max(0, Math.min(100, Math.trunc(score)));
  if (clamped >= 60) return "YUKSEK";
  if (clamped >= 30) return "ORTA";
  return "DUSUK";
}

/**
 * Şerh şiddet dağılımından genel risk skorunu hesaplar.
 *
 * Yalnızca DURUMU AÇIK sayılan şerhler hesaba katılır mı? HAYIR — koşunun
 * skoru O KOŞUCA AÇILAN şerhlerin bileşimidir; avukat şerhi sonra kapatırsa
 * sözleşmenin GÜNCEL skorunu `currentRiskSummary` ayrıca hesaplar.
 */
export function computeRiskScore(severities: readonly ContractAnnotationSeverity[]): number {
  const raw = severities.reduce((sum, s) => sum + (SEVERITY_WEIGHTS[s] ?? 0), 0);
  if (raw <= 0) return 0;
  return Math.min(100, Math.round((raw / SCORE_SATURATION_POINT) * 100));
}
