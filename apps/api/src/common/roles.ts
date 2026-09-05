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

/** Faz 7C — rol matrisi: role ek verilebilen yetenek anahtarları (User.extraPermissions). */
export const PERMISSION_KEYS = ["HUKUKI", "ONAY", "OPERASYON", "FINANS"] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];
export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  HUKUKI: "Hukuki tasarruf (dosya/müvekkil üzerinde tam yetki)",
  ONAY: "Onay yetkisi (süre/görev/fatura onayı)",
  OPERASYON: "Büro operasyonu (kayıt, belge, iletişim)",
  FINANS: "Finansal veri (tahsilat, masraf, vekâlet ücreti)",
};

/** ROLE_SETS dizisi (referans kimliğiyle) → yetenek anahtarı. */
const ROLE_SET_KEY = new Map<readonly UserRole[], PermissionKey>([
  [ROLE_SETS.HUKUKI, "HUKUKI"],
  [ROLE_SETS.ONAY, "ONAY"],
  [ROLE_SETS.OPERASYON, "OPERASYON"],
  [ROLE_SETS.FINANS, "FINANS"],
]);

/**
 * Rol kümesi kontrolü + rol matrisi: kullanıcının rolü kümede yoksa bile o kümeye karşılık
 * gelen yetenek (`permissions`) EK olarak verilmişse geçer. Yalnız ROLE_SETS'in dört
 * yeteneği matrise açıktır; geçici/özel rol dizileri (`["ADMIN"]` gibi) matristen ETKİLENMEZ.
 */
export function hasRole(user: AuthUser, roles: readonly UserRole[]): boolean {
  if (roles.includes(user.role)) return true;
  const key = ROLE_SET_KEY.get(roles);
  return key !== undefined && Array.isArray(user.permissions) && user.permissions.includes(key);
}

/**
 * Rol kontrolü. `action` mesajın sonuna gelir:
 * assertRole(user, ROLE_SETS.HUKUKI, "dosya durumu değiştirme") →
 * "Sekreter rolü dosya durumu değiştirme yetkisine sahip değil."
 */
export function assertRole(user: AuthUser, roles: readonly UserRole[], action: string): void {
  if (!hasRole(user, roles)) {
    throw new ForbiddenException(`${ROLE_LABELS[user.role]} rolü ${action} yetkisine sahip değil.`);
  }
}
