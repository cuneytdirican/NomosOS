/**
 * İCRA AŞAMA ŞERİDİ — deterministik geçiş makinesi.
 *
 * Modül 05 iş kuralı 1: aşama şeridi tek yönlüdür ve keyfi sıçramaya kapalıdır.
 * TAKIP_TALEBI → ODEME_EMRI_TEBLIG → (ITIRAZ → ITIRAZIN_KALDIRILMASI →) KESINLESME
 *              → HACIZ → SATIS → TAHSILAT → KAPANDI
 * ACIZ_VESIKASI, haciz/satış sonucunun sonuçsuz kalması hâlinde girilir.
 *
 * BU DOSYADA AI YOKTUR: hangi geçişin mümkün olduğu bir hukuk kuralıdır, bir
 * tahmin değildir. AI Copilot yalnızca "şu aşamada şunlar yapılabilir" der;
 * aşamayı avukat değiştirir ve geçerliliği burası denetler.
 */

import { UnprocessableEntityException } from "@nestjs/common";
import type { EnforcementStage } from "@nomosos/db";

export const ENFORCEMENT_STAGES = [
  "TAKIP_TALEBI",
  "ODEME_EMRI_TEBLIG",
  "ITIRAZ",
  "ITIRAZIN_KALDIRILMASI",
  "KESINLESME",
  "HACIZ",
  "SATIS",
  "TAHSILAT",
  "ACIZ_VESIKASI",
  "KAPANDI",
] as const satisfies readonly EnforcementStage[];

/** Hata mesajlarında kullanılan Türkçe aşama adları. */
export const STAGE_LABELS: Record<EnforcementStage, string> = {
  TAKIP_TALEBI: "Takip talebi",
  ODEME_EMRI_TEBLIG: "Ödeme emri tebliği",
  ITIRAZ: "İtiraz",
  ITIRAZIN_KALDIRILMASI: "İtirazın kaldırılması/iptali",
  KESINLESME: "Kesinleşme",
  HACIZ: "Haciz",
  SATIS: "Satış",
  TAHSILAT: "Tahsilat",
  ACIZ_VESIKASI: "Aciz vesikası",
  KAPANDI: "Kapandı",
};

/**
 * İzin verilen geçişler.
 *
 * Geriye dönüş bilinçli olarak DAR tutulur: yalnızca hukuken gerçekleşebilen
 * dönüşler açıktır (kısmi tahsilat sonrası yeniden haciz; itirazın kaldırılması
 * talebinin reddi hâlinde dosyanın itirazda kalması gibi).
 */
export const STAGE_TRANSITIONS: Record<EnforcementStage, readonly EnforcementStage[]> = {
  TAKIP_TALEBI: ["ODEME_EMRI_TEBLIG", "KAPANDI"],
  ODEME_EMRI_TEBLIG: ["ITIRAZ", "KESINLESME", "KAPANDI"],
  // İtiraz takibi durdurur: ya itirazın kaldırılması/iptali yoluna gidilir,
  // ya itiraz geri alınır/hükümsüz kalır ve takip kesinleşir, ya da dosya kapanır.
  ITIRAZ: ["ITIRAZIN_KALDIRILMASI", "KESINLESME", "KAPANDI"],
  // Talep reddedilirse dosya itiraz aşamasına döner; kabul edilirse kesinleşir.
  ITIRAZIN_KALDIRILMASI: ["KESINLESME", "ITIRAZ", "KAPANDI"],
  KESINLESME: ["HACIZ", "TAHSILAT", "KAPANDI"],
  HACIZ: ["SATIS", "TAHSILAT", "ACIZ_VESIKASI", "KAPANDI"],
  SATIS: ["TAHSILAT", "ACIZ_VESIKASI", "HACIZ", "KAPANDI"],
  // Kısmi tahsilat sonrası bakiye için yeniden haciz/satış istenebilir.
  TAHSILAT: ["HACIZ", "SATIS", "ACIZ_VESIKASI", "KAPANDI"],
  ACIZ_VESIKASI: ["HACIZ", "TAHSILAT", "KAPANDI"],
  KAPANDI: [],
};

/** Kapanmış sayılan aşama — buradan çıkış yoktur. */
export const TERMINAL_STAGES: readonly EnforcementStage[] = ["KAPANDI"];

export function isValidStage(value: string): value is EnforcementStage {
  return (ENFORCEMENT_STAGES as readonly string[]).includes(value);
}

/**
 * Geçiş geçerli mi? Değilse 422 + izin verilen aşamalar.
 *
 * 422 seçilmiştir (400 değil): istek biçimsel olarak doğrudur, iş kuralı reddeder
 * (Modül 05 kabul kriteri 3).
 */
export function assertStageTransition(
  fileLabel: string,
  from: EnforcementStage,
  to: EnforcementStage,
): void {
  if (from === to) {
    throw new UnprocessableEntityException({
      message: `${fileLabel} dosyası zaten «${STAGE_LABELS[to]}» aşamasında.`,
      currentStage: from,
      allowedStages: STAGE_TRANSITIONS[from],
    });
  }
  if (TERMINAL_STAGES.includes(from)) {
    throw new UnprocessableEntityException({
      message:
        `${fileLabel} dosyası «${STAGE_LABELS[from]}» aşamasındadır ve aşaması değiştirilemez. ` +
        "Takibi yeniden yürütmek için yeni bir icra dosyası açın.",
      currentStage: from,
      allowedStages: [],
    });
  }
  if (!STAGE_TRANSITIONS[from].includes(to)) {
    throw new UnprocessableEntityException({
      message:
        `${fileLabel} dosyası «${STAGE_LABELS[from]}» aşamasından doğrudan «${STAGE_LABELS[to]}» ` +
        `aşamasına geçirilemez. Bu aşamadan geçilebilecek aşamalar: ` +
        `${STAGE_TRANSITIONS[from].map((s) => STAGE_LABELS[s]).join(", ") || "yok"}.`,
      currentStage: from,
      requestedStage: to,
      allowedStages: STAGE_TRANSITIONS[from],
    });
  }
}
