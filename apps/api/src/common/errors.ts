/**
 * DIŞ SİSTEM HATALARININ SADELEŞTİRİLMESİ.
 *
 * SORUN: Sağlayıcı ve depo hatalarının ham gövdesi (`await res.text()`)
 * kurumsal vekil adreslerini, iç hata izlerini, kimi sağlayıcıda istek
 * başlıklarını ve kısmi anahtar ipuçlarını taşıyabilir. Bu metinler doğrudan
 * istemciye dönüyor, üstelik `PipelineRun.errorMessage`'a yazılıp
 * `GET /documents/:id` ile HER ROLE gösteriliyordu.
 *
 * ÇÖZÜM: ham mesaj YALNIZCA sunucu günlüğüne yazılır; istemciye sabit Türkçe
 * mesaj + korelasyon kimliği döner. Destek, kimlikle günlükteki tam izi bulur.
 */

import { BadGatewayException, Logger, ServiceUnavailableException } from "@nestjs/common";
import { randomBytes } from "node:crypto";

/** Kısa, günlükte aranabilir korelasyon kimliği. */
export function newCorrelationId(): string {
  return randomBytes(4).toString("hex");
}

export interface SanitizedFailure {
  /** İstemciye gösterilecek Türkçe mesaj (ham ayrıntı YOK). */
  message: string;
  ref: string;
}

/**
 * Ham hatayı günlüğe yazar, istemciye gidecek güvenli metni üretir.
 *
 * @param what Kullanıcıya "ne yapılamadı" cümlesi (ör. "AI sağlayıcısına ulaşılamadı").
 * @param remedy Kullanıcının atabileceği adım (ör. "Ayarlar → AI Sağlayıcı…").
 */
export function sanitizeExternalError(
  logger: Logger,
  what: string,
  err: unknown,
  remedy?: string,
): SanitizedFailure {
  const ref = newCorrelationId();
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  logger.error(`[${ref}] ${what} — ham hata: ${raw}`);
  return {
    ref,
    message: `${what} (ref: ${ref}).${remedy ? ` ${remedy}` : ""}`,
  };
}

/** Sağlayıcıya ulaşılamadığında fırlatılacak, ayrıntı sızdırmayan istisna. */
export function providerUnreachable(logger: Logger, err: unknown): BadGatewayException {
  const { message } = sanitizeExternalError(
    logger,
    "AI sağlayıcısına ulaşılamadı",
    err,
    "Ayarlar → AI Sağlayıcı ekranından bağlantıyı test edin.",
  );
  return new BadGatewayException(message);
}

/** Belge deposu (S3/MinIO) hatalarında kullanılacak istisna. */
export function storageUnavailable(
  logger: Logger,
  what: string,
  err: unknown,
): ServiceUnavailableException {
  const { message } = sanitizeExternalError(
    logger,
    what,
    err,
    "Belge deposuna şu an erişilemiyor; sistem yöneticinizle görüşün.",
  );
  return new ServiceUnavailableException(message);
}
