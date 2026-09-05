/**
 * FİNANS & FATURALAMA ROL MATRİSİ.
 *
 * Modül 08 iş kuralı 7 ve Modül 09 iş kuralı 6'nın sunucu tarafı karşılığı.
 * Her küme BEYAZ LİSTEDİR (kara liste değil): yeni bir rol eklendiğinde kapı
 * sessizce açılmaz, açıkça eklenmesi gerekir.
 *
 *   STAJYER  → finans/faturalama uçlarının HİÇBİRİNE erişemez (okuma dâhil).
 *   SEKRETER → okur; zaman kaydı ve ödeme girer; fatura KESEMEZ/SİLEMEZ,
 *              ücret sözleşmesi yazamaz, finans hareketi oluşturamaz.
 *   AVUKAT   → finans hareketi ve taslak fatura yazar; kesinleştirme ve
 *              e-Fatura gönderimi yapamaz.
 *   PARTNER / ADMIN → tam yetkili.
 */

import { ForbiddenException } from "@nestjs/common";
import type { UserRole } from "@nomosos/shared";
import { ROLE_LABELS } from "../common/roles";
import type { AuthUser } from "../common/types";

export const FINANCE_ACCESS = {
  /** Okuma: liste, detay, özet, rapor. STAJYER hariç. */
  READ: ["ADMIN", "PARTNER", "AVUKAT", "SEKRETER"] as UserRole[],
  /** FinancialEntry oluştur/güncelle/sil. */
  ENTRY_WRITE: ["ADMIN", "PARTNER", "AVUKAT"] as UserRole[],
  /** Ücret sözleşmesi — parasal sözleşme hükmüdür, yalnız yönetim. */
  AGREEMENT_WRITE: ["ADMIN", "PARTNER"] as UserRole[],
  /**
   * Zaman kaydı girişi (İ-35: sekreter YALNIZ KENDİSİ adına girebilir —
   * başkası adına giriş TIME_MANAGE_OTHERS ister, bkz. time-entries.service).
   */
  TIME_WRITE: ["ADMIN", "PARTNER", "AVUKAT", "SEKRETER"] as UserRole[],
  /** Başkasının zaman kaydını düzenleme/silme. */
  TIME_MANAGE_OTHERS: ["ADMIN", "PARTNER"] as UserRole[],
  /** Taslak fatura oluşturma ve düzenleme. */
  INVOICE_DRAFT: ["ADMIN", "PARTNER", "AVUKAT"] as UserRole[],
  /** Fatura kesinleştirme, iptal, silme, e-Fatura gönderimi. */
  INVOICE_ISSUE: ["ADMIN", "PARTNER"] as UserRole[],
  /** Ödeme (tahsilat) kaydı. */
  PAYMENT_WRITE: ["ADMIN", "PARTNER", "AVUKAT", "SEKRETER"] as UserRole[],
  /**
   * Finans verisinin AI'a taşınması.
   *
   * Okuma kümesinden DAHA DAR tutulur ve `ROLE_SETS.FINANS` ile aynıdır:
   * asistan katmanında SEKRETER rolüne finans verisi açılmaması kararı
   * (denetim bulgusu, office-query.service.ts) burada da geçerlidir.
   */
  AI: ["ADMIN", "PARTNER", "AVUKAT"] as UserRole[],
} as const;

export function assertFinanceAccess(
  user: AuthUser,
  roles: readonly UserRole[],
  action: string,
): void {
  if (!canFinance(user, roles)) {
    throw new ForbiddenException(`${ROLE_LABELS[user.role]} rolü ${action} yetkisine sahip değil.`);
  }
}

/**
 * Finans yetkisi + rol matrisi (Faz 7C): kullanıcıya EK "FINANS" yeteneği verildiyse, AVUKAT
 * rolünün girebildiği her finans kapısından geçer (okuma, hareket yazma, taslak fatura, AI).
 * Yalnız yönetim kümeleri (AGREEMENT_WRITE, INVOICE_ISSUE, TIME_MANAGE_OTHERS) matristen açılmaz.
 */
export function canFinance(user: AuthUser, roles: readonly UserRole[]): boolean {
  if (roles.includes(user.role)) return true;
  return roles.includes("AVUKAT") && Array.isArray(user.permissions) && user.permissions.includes("FINANS");
}
