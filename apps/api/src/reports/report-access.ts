/**
 * RAPORLAMA ROL MATRİSİ — SUNUCU TARAFI.
 *
 * ╔════════════════════════════════════════════════════════════════════════╗
 * ║  `SavedReport.scope = BURO` bir GÖRÜNÜRLÜK alanıdır, YETKİ DEĞİLDİR.  ║
 * ║  Büro kapsamına kaydedilmiş bir rapor, STAJYER'e finans rakamı açmaz. ║
 * ║  Yetki daima BU dosyadaki matristen okunur (Hazırlık raporu, not 5).   ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 *
 * Her küme BEYAZ LİSTEDİR (kara liste değil): yeni bir rol eklendiğinde kapı
 * sessizce açılmaz — `finance-access.ts` ile aynı sözleşme.
 *
 * KURAL KAYNAĞI (görev tanımı, madde 6):
 *   STAJYER  → finans içeren raporlara erişemez
 *              (tahsilat-yaslandirma, karlilik, ai-kullanim, icra-tahsilat).
 *   SEKRETER → karlilik ve avukat-is-yuku raporlarını göremez.
 *   AVUKAT   → kârlılık dışında tümünü görür.
 *   PARTNER / ADMIN → tümünü görür.
 *
 * İKİ KADEMELİ KAPI: rapora erişim yetmez, rapor İÇİNDEKİ finans bölümleri de
 * ayrıca süzülür (`canSeeMoney`). "buro-ozet" herkese açıktır ama tahakkuk /
 * tahsilat kartları yalnız finans okuyabilen role çıkar; STAJYER raporu görür,
 * parayı görmez ve bunu `hiddenSections` alanından ÖĞRENİR (sessiz gizleme yok).
 */

import { ForbiddenException } from "@nestjs/common";
import type { UserRole } from "@nomosos/shared";
import { ROLE_LABELS } from "../common/roles";
import type { AuthUser } from "../common/types";

export const REPORT_ACCESS = {
  /** Operasyonel raporlar — para içermez. */
  OPERASYON: ["ADMIN", "PARTNER", "AVUKAT", "STAJYER", "SEKRETER"] as UserRole[],
  /**
   * Finans içeren raporlar. STAJYER hariç — `FINANCE_ACCESS.READ` ile birebir
   * aynı küme (aynı veri, aynı kapı).
   */
  FINANS: ["ADMIN", "PARTNER", "AVUKAT", "SEKRETER"] as UserRole[],
  /** Avukat iş yükü — SEKRETER hariç (görev tanımı madde 6). */
  IS_YUKU: ["ADMIN", "PARTNER", "AVUKAT", "STAJYER"] as UserRole[],
  /** Kârlılık — yalnız yönetim. */
  YONETIM: ["ADMIN", "PARTNER"] as UserRole[],
} as const;

/**
 * Rapor İÇİNDEKİ para sütun/kartlarını görebilen roller.
 * `FINANCE_ACCESS.READ` ile aynıdır; STAJYER dışlanır.
 */
const MONEY_ROLES: UserRole[] = ["ADMIN", "PARTNER", "AVUKAT", "SEKRETER"];

/**
 * Başkalarının kullanım/iş yükü dökümünü görebilen roller.
 * AVUKAT ve SEKRETER kendi satırını görür; büro genelini yönetim görür.
 */
const CROSS_USER_ROLES: UserRole[] = ["ADMIN", "PARTNER"];

export function canSeeMoney(user: AuthUser): boolean {
  return MONEY_ROLES.includes(user.role);
}

export function canSeeOtherUsers(user: AuthUser): boolean {
  return CROSS_USER_ROLES.includes(user.role);
}

export function hasReportAccess(user: AuthUser, roles: readonly UserRole[]): boolean {
  return roles.includes(user.role);
}

export function assertReportAccess(
  user: AuthUser,
  roles: readonly UserRole[],
  action: string,
): void {
  if (!roles.includes(user.role)) {
    throw new ForbiddenException(`${ROLE_LABELS[user.role]} rolü ${action} yetkisine sahip değil.`);
  }
}

/** Kayıtlı raporu SİLEBİLENLER: sahibi ya da yönetim. */
export function canDeleteSavedReport(user: AuthUser, createdBy: string): boolean {
  return user.userId === createdBy || CROSS_USER_ROLES.includes(user.role);
}
