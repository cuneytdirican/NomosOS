/**
 * PORTAL VEKALETNAME CANLILIK KONTROLÜ — denetim bulgusu K-12 kalıntısı.
 *
 * SORUN: K-12'nin düzeltilmesi yalnızca YAZMA-ANI yan etkisi koydu — azil veya
 * istifa `revoke()` çağrıldığında portal hesabı kapanıyordu. Ama vekaletname
 * doğal süre dolumuna ulaştığında (`expiresAt` geçtiğinde) hiçbir kod yolu
 * çalışmıyordu: `revoke()` çağıran ne bir API nereden bir zamanlanmış iş yoktu.
 * Canlı kanıt: `expiresAt` sekiz ay geriye alındığında portal erişimi açık
 * kaldı (`/portal/cases` → 200), oysa büro tarafı aynı vekaletnameyi YETERSİZ
 * sayıyordu (`poa-scope.service.ts` DETERMİNİSTİK KAPI 1).
 *
 * ÇÖZÜM: OKUMA-ANI kontrolü. `PortalJwtGuard` her portal isteğinde müvekkilin
 * vekaletname tablosuna bakar. Müvekkilin HİÇ vekaletname kaydı yoksa portal
 * erişimi sürer (portal hesabı yalnızca vekaletname varlığına bağlı değildir:
 * belge ve ödeme görünürlüğü `PortalPublication` mekanizmasıyla ayrıca
 * denetlenir). Kayıt VAR ve hiçbiri canlı değilse (azil + süre dolumu + pasif)
 * erişim ANINDA kesilir — `revoke()`'ın "diğer canlı vekaletname kalmadıysa
 * portalı askıya al" kuralının (poa.service.ts) okuma-anı ikizi.
 *
 * Canlılık tanımı büro tarafıyla BİREBİR aynı üçlü: `isActive` + `revokedAt`
 * + `expiresAt` (bkz. poa.service.ts statusWhere "AKTIF" dalı). Ayrı bir
 * tanım yazmak, büro "aktif" derken portalın "kapalı" kalmasına yol açardı.
 */

import type { Prisma } from "@nomosos/db";
import { startOfDay } from "../../common/dates";

/** Müvekkilin kayıtlı TÜM vekaletnameleri — canlı olup olmadığına bakılmaksızın. */
export function allPoaWhere(
  tenantId: string,
  clientId: string,
): Prisma.PowerOfAttorneyWhereInput {
  return { tenantId, clientId };
}

/**
 * Müvekkilin CANLI vekaletnameleri.
 *
 * `today` günün BAŞI olarak alınır: büro tarafında süre dolumu
 * `expiresAt < startOfDay(bugün)` biçiminde hesaplanır; gün ortasında süresi
 * dolan bir vekaletname aynı gün içinde hâlâ canlı sayılır (iki taraf arasında
 * gün kayması olmamalıdır).
 */
export function livePoaWhere(
  tenantId: string,
  clientId: string,
  today: Date,
): Prisma.PowerOfAttorneyWhereInput {
  return {
    tenantId,
    clientId,
    isActive: true,
    revokedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gte: startOfDay(today) } }],
  };
}

/**
 * Erişim kesme kararı — saf fonksiyon, birim testi buradan geçer.
 *
 * - Hiç kayıt yok → erişim AÇIK (portal hesabı vekaletnameye bağlı değildir).
 * - Kayıt var, canlı var → erişim AÇIK.
 * - Kayıt var, canlı YOK → erişim KAPALI. Vekalet ilişkisi biten müvekkilin
 *   dosya, belge ve fatura görmeye devam etmesi KVKK ve meslek kuralları
 *   açısından savunulamaz (denetim raporu, K-12).
 */
export function poaLivenessBlocked(totalCount: number, liveCount: number): boolean {
  return totalCount > 0 && liveCount === 0;
}
