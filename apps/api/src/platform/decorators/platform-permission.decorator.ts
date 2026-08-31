import { SetMetadata } from "@nestjs/common";
import type { AdminAction } from "../platform-permissions";

export const PLATFORM_PERMISSION_KEY = "platform:permission";

export interface PlatformPermissionMeta {
  action: AdminAction;
  /** read → seviye "none" olmamalı · write → canMutate() true olmalı */
  mode: "read" | "write";
  /**
   * denetim bulgusu K-11 — YAPISAL DÖRT-GÖZ BEYANI.
   *
   * `true` ise bu uç işlemi DOĞRUDAN uygulamaz; `PlatformApprovalsService`
   * üzerinden bir onay talebi üretir (202). `PlatformPermissionGuard` iki yönlü
   * kontrol eder:
   *   - dört-göz bir aksiyon `viaApproval` beyanı OLMADAN yazma ucuna
   *     bağlanamaz (sessizce tek imzayla uygulanamaz),
   *   - dört-göz OLMAYAN bir aksiyon `viaApproval` beyanı taşıyamaz (bayat
   *     beyan, kullanıcıya var olmayan bir onay sözü verir).
   */
  viaApproval?: boolean;
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

/**
 * DÖRT-GÖZ YAZMA UCU (denetim bulgusu K-11).
 *
 * Seviyesi `four_eyes` olan bir aksiyonun tek meşru yazma biçimi budur: uç
 * `approvals.request(...)` çağırır ve 202 döner. `@WritePermission` ile
 * bağlanan dört-göz aksiyonu, guard tarafından ÇALIŞMA ZAMANINDA reddedilir —
 * yapılandırma hatası sessizce tek imzalı bir yola dönüşmez.
 */
export const ApprovalWritePermission = (action: AdminAction) =>
  SetMetadata<string, PlatformPermissionMeta>(PLATFORM_PERMISSION_KEY, {
    action,
    mode: "write",
    viaApproval: true,
  });

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
