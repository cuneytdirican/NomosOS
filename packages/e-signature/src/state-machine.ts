/**
 * İMZA SÜRECİ DURUM MAKİNESİ — çekirdeğin tek doğru kaynağı.
 *
 *   OLUSTURULDU ──► GONDERILDI ──► IMZALANDI      (nihai)
 *        │               ├───────► REDDEDILDI     (nihai)
 *        │               ├───────► SURESI_DOLDU   (nihai)
 *        └───────────────┴───────► IPTAL          (nihai)
 *
 * NEDEN GERİ DÖNÜŞ YOK: imzalanmış, reddedilmiş ya da süresi dolmuş bir süreç
 * yeniden "gönderildi" olamaz. Yeni bir tur gerekiyorsa YENİ `SignatureRequest`
 * açılır — imza kanıt paketleri ve iz kaydı böylece bozulmadan kalır
 * (docs/moduller/20, iş kuralı 7: imza kanıt paketleri silinemez).
 *
 * Sağlayıcıdan gelen durum bu tabloya UYMUYORSA çekirdek kaydı sessizce
 * ezmez: `assertTransition` hata fırlatır, uyumsuzluk görünür olur.
 */

import { SignatureStateError } from "./errors";
import type { SignatureRequestStatus } from "./types";

export const SIGNATURE_TRANSITIONS: Record<SignatureRequestStatus, readonly SignatureRequestStatus[]> = {
  OLUSTURULDU: ["GONDERILDI", "IPTAL"],
  GONDERILDI: ["IMZALANDI", "REDDEDILDI", "SURESI_DOLDU", "IPTAL"],
  IMZALANDI: [],
  REDDEDILDI: [],
  SURESI_DOLDU: [],
  IPTAL: [],
};

/** Nihai (bir daha değişmeyen) durumlar. */
export const TERMINAL_SIGNATURE_STATUSES: readonly SignatureRequestStatus[] = [
  "IMZALANDI",
  "REDDEDILDI",
  "SURESI_DOLDU",
  "IPTAL",
];

/** İnsan-okur durum etiketleri (hata mesajları ve UI). */
export const SIGNATURE_STATUS_LABELS: Record<SignatureRequestStatus, string> = {
  OLUSTURULDU: "oluşturuldu",
  GONDERILDI: "imzacılara gönderildi",
  IMZALANDI: "imzalandı",
  REDDEDILDI: "reddedildi",
  SURESI_DOLDU: "süresi doldu",
  IPTAL: "iptal edildi",
};

export function isTerminalSignatureStatus(status: SignatureRequestStatus): boolean {
  return TERMINAL_SIGNATURE_STATUSES.includes(status);
}

export function canTransitionSignature(
  from: SignatureRequestStatus,
  to: SignatureRequestStatus,
): boolean {
  if (from === to) return true; // Yinelenen bildirim (idempotens) geçiş sayılmaz.
  return SIGNATURE_TRANSITIONS[from].includes(to);
}

/**
 * Geçişi zorlar; geçersizse ANLAMLI Türkçe hata fırlatır.
 * @throws {SignatureStateError}
 */
export function assertSignatureTransition(
  from: SignatureRequestStatus,
  to: SignatureRequestStatus,
  providerKey = "-",
): void {
  if (canTransitionSignature(from, to)) return;
  const allowed = SIGNATURE_TRANSITIONS[from];
  const message = isTerminalSignatureStatus(from)
    ? `İmza süreci "${SIGNATURE_STATUS_LABELS[from]}" durumunda ve sonuçlanmıştır; ` +
      `"${SIGNATURE_STATUS_LABELS[to]}" durumuna geçirilemez. Yeni bir imza süreci başlatın.`
    : `İmza süreci "${SIGNATURE_STATUS_LABELS[from]}" durumundan ` +
      `"${SIGNATURE_STATUS_LABELS[to]}" durumuna geçirilemez. İzin verilen geçişler: ` +
      `${allowed.map((s) => SIGNATURE_STATUS_LABELS[s]).join(", ")}.`;
  throw new SignatureStateError(from, to, message, providerKey);
}
