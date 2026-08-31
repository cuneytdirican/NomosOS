/**
 * SÖZLEŞME DURUM MAKİNESİ.
 *
 *   TASLAK ──► MUZAKERE ──► IMZAYA_HAZIR ──► IMZADA ──► YURURLUKTE ──┬─► SONA_ERDI
 *                  ▲             ▲    ▲                              └─► FESIH
 *                  │             └────┘  (imza süreci iptalinde geri dönüş)
 *                  └──────────────────┘
 *
 * KURALLAR:
 *  1. İLERİ ATLAMA YOKTUR. TASLAK'tan doğrudan IMZADA'ya geçilemez: bir metnin
 *     imzaya çıkması için önce müzakerenin kapanması ve nihai sürümün
 *     işaretlenmesi gerekir (docs/moduller/20, iş kuralı 1).
 *  2. GERİYE DÖNÜŞ YALNIZ İMZA ÖNCESİNE. IMZADA → IMZAYA_HAZIR | MUZAKERE,
 *     IMZAYA_HAZIR → MUZAKERE. Yürürlüğe girmiş sözleşme geriye alınamaz;
 *     yanlış giriş düzeltmesi denetim kaydıyla yapılır.
 *  3. YURURLUKTE'YE GEÇİŞ ŞARTA BAĞLIDIR: imzalı belge (SignatureRequest
 *     IMZALANDI ya da elle bağlanmış imzalı nüsha) veya avukatın AÇIK elle
 *     onayı gerekir. Sistem kendiliğinden "yürürlükte" demez.
 *  4. SONA_ERDI ve FESIH NİHAİDİR.
 */

import { BadRequestException } from "@nestjs/common";
import type { ContractStatus } from "@nomosos/db";

export const CONTRACT_TRANSITIONS: Record<ContractStatus, readonly ContractStatus[]> = {
  TASLAK: ["MUZAKERE"],
  MUZAKERE: ["IMZAYA_HAZIR"],
  IMZAYA_HAZIR: ["IMZADA", "MUZAKERE"],
  IMZADA: ["YURURLUKTE", "IMZAYA_HAZIR", "MUZAKERE"],
  YURURLUKTE: ["SONA_ERDI", "FESIH"],
  SONA_ERDI: [],
  FESIH: [],
};

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  TASLAK: "Taslak",
  MUZAKERE: "Müzakere",
  IMZAYA_HAZIR: "İmzaya hazır",
  IMZADA: "İmzada",
  YURURLUKTE: "Yürürlükte",
  SONA_ERDI: "Sona erdi",
  FESIH: "Fesih",
};

/** Bir daha değişmeyen durumlar. */
export const TERMINAL_CONTRACT_STATUSES: readonly ContractStatus[] = ["SONA_ERDI", "FESIH"];

/** Metnin artık değiştirilemeyeceği durumlar (yeni sürüm eklenemez). */
export const LOCKED_FOR_NEW_VERSION: readonly ContractStatus[] = [
  "IMZADA",
  "YURURLUKTE",
  "SONA_ERDI",
  "FESIH",
];

export function isTerminalContractStatus(status: ContractStatus): boolean {
  return TERMINAL_CONTRACT_STATUSES.includes(status);
}

export function canTransitionContract(from: ContractStatus, to: ContractStatus): boolean {
  if (from === to) return false; // Aynı duruma "geçiş" anlamsızdır; çağıran erken döner.
  return CONTRACT_TRANSITIONS[from].includes(to);
}

/**
 * Geçişi zorlar. Geçersizse 400 + ANLAMLI mesaj döner: kullanıcı hangi
 * durumdan nereye gidebileceğini yanıtın kendisinden öğrenir.
 */
export function assertContractTransition(from: ContractStatus, to: ContractStatus): void {
  if (from === to) {
    throw new BadRequestException(
      `Sözleşme zaten "${CONTRACT_STATUS_LABELS[from]}" durumunda.`,
    );
  }
  if (canTransitionContract(from, to)) return;

  if (isTerminalContractStatus(from)) {
    throw new BadRequestException(
      `Sözleşme "${CONTRACT_STATUS_LABELS[from]}" durumundadır ve sonuçlanmıştır; ` +
        "durumu değiştirilemez. Yeni bir sözleşme kaydı oluşturun.",
    );
  }

  const allowed = CONTRACT_TRANSITIONS[from];
  throw new BadRequestException(
    `"${CONTRACT_STATUS_LABELS[from]}" durumundan "${CONTRACT_STATUS_LABELS[to]}" durumuna ` +
      "doğrudan geçilemez. İzin verilen geçişler: " +
      `${allowed.map((s) => CONTRACT_STATUS_LABELS[s]).join(", ")}.` +
      (to === "IMZADA" && from === "TASLAK"
        ? " Önce müzakereyi başlatıp nihai sürümü imzaya hazır işaretleyin."
        : ""),
  );
}
