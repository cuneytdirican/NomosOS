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
}

/** İki adımlı girişin ara (challenge) token'ı. */
export interface PlatformChallengePayload {
  sub: string;
  aud: string;
  /** "login" → mevcut gizli anahtarla doğrula · "setup" → yeni anahtarı kur */
  kind: "login" | "setup";
  /** Yalnız kind="setup": AES-256-GCM ile şifrelenmiş TOTP gizli anahtarı. */
  enc?: string;
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
