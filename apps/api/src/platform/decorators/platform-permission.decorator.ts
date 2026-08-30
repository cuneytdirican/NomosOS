import { SetMetadata } from "@nestjs/common";
import type { AdminAction } from "../platform-permissions";

export const PLATFORM_PERMISSION_KEY = "platform:permission";

export interface PlatformPermissionMeta {
  action: AdminAction;
  /** read → seviye "none" olmamalı · write → canMutate() true olmalı */
  mode: "read" | "write";
}

/**
 * Okuma yetkisi: matriste bu rol için seviye "none" ise 403.
 * ("read"/"masked" seviyeleri geçer; maskeleme kararını SERVİS verir.)
 */
export const ReadPermission = (action: AdminAction) =>
  SetMetadata<string, PlatformPermissionMeta>(PLATFORM_PERMISSION_KEY, { action, mode: "read" });

/**
 * Yazma yetkisi: `canMutate()` gerekir ("full" veya "four_eyes").
 * ANALYST_READONLY burada HER KOŞULDA 403 alır.
 */
export const WritePermission = (action: AdminAction) =>
  SetMetadata<string, PlatformPermissionMeta>(PLATFORM_PERMISSION_KEY, { action, mode: "write" });

export const PLATFORM_ANY_ROLE_KEY = "platform:any-role";

/**
 * Yetki matrisi dışı, her role açık uç (yalnız `/auth/me` gibi kimlik uçları).
 *
 * Yetki guard'ı FAIL-CLOSED çalışır: metadata'sı olmayan bir uç 403 döner.
 * Yeni bir uç yazıp yetkisini belirtmeyi unutmak, kapıyı açık bırakmaz.
 */
export const AnyPlatformRole = () => SetMetadata(PLATFORM_ANY_ROLE_KEY, true);

export const PLATFORM_ANON_KEY = "platform:anon";

/** Kimlik gerektirmeyen platform ucu (login, 2FA doğrulama). */
export const PlatformAnonymous = () => SetMetadata(PLATFORM_ANON_KEY, true);
