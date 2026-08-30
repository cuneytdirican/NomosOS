import type { AdminRole } from "./platform-permissions";

/**
 * Platform JWT gövdesi.
 *
 * DİKKAT: `tenantId` ALANI YOKTUR ve olmamalıdır. Panel kimliği bir büroya ait
 * değildir; kiracı verisine erişim yalnızca süreli SupportAccessGrant üzerinden
 * ve salt-okur olarak mümkündür (impersonation yasaktır).
 */
export interface PlatformJwtPayload {
  sub: string;
  role: AdminRole;
  aud: string;
  /**
   * OTURUM SÜRÜMÜ (`PlatformUser.tokenVersion`).
   *
   * Guard, DB'deki değerle eşleşmeyen token'ı reddeder. Parola değişimi, 2FA
   * sıfırlama ve rol düşürme sayacı artırdığı için ele geçirilmiş bir oturum
   * 8 saat beklemeden ANINDA düşer (spec §Güvenlik 3).
   *
   * Alan opsiyoneldir ki eski (sürümsüz) token'lar tip düzeyinde temsil
   * edilebilsin; guard bunları AÇIKÇA REDDEDER — "sürümsüzü kabul et" davranışı
   * kapıyı yarı açık bırakırdı.
   */
  tv?: number;
}

/** İki adımlı girişin ara (challenge) token'ı. */
export interface PlatformChallengePayload {
  sub: string;
  aud: string;
  /** "login" → mevcut gizli anahtarla doğrula · "setup" → yeni anahtarı kur */
  kind: "login" | "setup";
  /** Yalnız kind="setup": AES-256-GCM ile şifrelenmiş TOTP gizli anahtarı. */
  enc?: string;
  /**
   * Challenge kimliği — TEK KULLANIMLIK yapmanın anahtarı.
   *
   * Başarısız kod denemeleri bu kimliğe karşı sayılır; sınır aşılınca token
   * iptal edilir. Sayaç olmadan aynı challenge 10 dakika boyunca sınırsız
   * denemeye açık kalırdı (denetim bulgusu 10.2).
   */
  jti: string;
}

/** Guard'ın request.platformUser'a koyduğu kimlik. */
export interface PlatformAuthUser {
  id: string;
  email: string;
  fullName: string;
  role: AdminRole;
  /** İstek IP'si — PlatformAuditLog'a yazılır. */
  ip: string;
  /** 2FA kurulu mu? (istemciye `twoFactorReady` olarak döner) */
  twoFactorReady: boolean;
}
