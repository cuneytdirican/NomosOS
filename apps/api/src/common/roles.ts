import { ForbiddenException } from "@nestjs/common";
import type { UserRole } from "@nomosos/shared";
import type { AuthUser } from "./types";

/** Hata mesajlarında kullanılan Türkçe rol adları. */
export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Yönetici",
  PARTNER: "Ortak",
  AVUKAT: "Avukat",
  STAJYER: "Stajyer",
  SEKRETER: "Sekreter",
};

/** Sık kullanılan rol kümeleri. */
export const ROLE_SETS = {
  /** Dosya/müvekkil üzerinde tam hukuki tasarruf. */
  HUKUKI: ["ADMIN", "PARTNER", "AVUKAT"] as UserRole[],
  /** Onay yetkisi (süre onayı, görev onayı). */
  ONAY: ["ADMIN", "PARTNER"] as UserRole[],
  /** Büro operasyonu (kayıt/iletişim bilgisi güncelleme). */
  OPERASYON: ["ADMIN", "PARTNER", "AVUKAT", "SEKRETER"] as UserRole[],
  /**
   * Finansal veriye erişim (tahsilat, masraf, vekalet ücreti).
   *
   * BEYAZ LİSTEDİR, kara liste DEĞİLDİR: eskiden yalnızca STAJYER dışlanıyordu,
   * bu yüzden SEKRETER rolü asistan üzerinden finans satırlarını okuyabiliyordu
   * ve yeni bir rol eklendiğinde kapı sessizce açılıyordu.
   */
  FINANS: ["ADMIN", "PARTNER", "AVUKAT"] as UserRole[],
  /** Herkes. */
  HERKES: ["ADMIN", "PARTNER", "AVUKAT", "STAJYER", "SEKRETER"] as UserRole[],
};

export function hasRole(user: AuthUser, roles: readonly UserRole[]): boolean {
  return roles.includes(user.role);
}

/**
 * Rol kontrolü. `action` mesajın sonuna gelir:
 * assertRole(user, ROLE_SETS.HUKUKI, "dosya durumu değiştirme") →
 * "Sekreter rolü dosya durumu değiştirme yetkisine sahip değil."
 */
export function assertRole(user: AuthUser, roles: readonly UserRole[], action: string): void {
  if (!roles.includes(user.role)) {
    throw new ForbiddenException(`${ROLE_LABELS[user.role]} rolü ${action} yetkisine sahip değil.`);
  }
}
