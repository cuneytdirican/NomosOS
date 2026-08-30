import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import {
  PLATFORM_ANON_KEY,
  PLATFORM_ANY_ROLE_KEY,
  PLATFORM_PERMISSION_KEY,
  type PlatformPermissionMeta,
} from "../decorators/platform-permission.decorator";
import { ACTION_LABELS, canMutate, levelOf } from "../platform-permissions";
import type { PlatformAuthUser } from "../platform.types";

/** Hata mesajlarında kullanılan Türkçe rol adları. */
const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Süper yönetici",
  OPS_ADMIN: "Operasyon yöneticisi",
  BILLING_ADMIN: "Finans yöneticisi",
  SUPPORT_AGENT: "Destek personeli",
  ANALYST_READONLY: "Analist (salt-okur)",
};

/**
 * YETKİ MATRİSİ YAPTIRIMI — sunucu tarafı.
 *
 * `apps/admin/src/lib/rbac.ts` istemcide düğme gizler; bu guard kapıyı kapatır.
 * Spec §İş Kuralları 3: "UI'da gizleme yeterli sayılmaz".
 *
 * FAIL-CLOSED: bir uç ne `@ReadPermission`/`@WritePermission` ne de
 * `@AnyPlatformRole` taşıyorsa 403 döner. Yetki bildirmeyi unutmak, ucu
 * herkese açmaz — kapalı bırakır.
 *
 * İKİ KAT ANALİST KİLİDİ:
 *   (a) rol ANALYST_READONLY ise GET dışındaki her metot doğrudan 403,
 *   (b) `canMutate()` bu rol için her koşulda false.
 */
@Injectable()
export class PlatformPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(PLATFORM_ANON_KEY, targets)) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { platformUser?: PlatformAuthUser }>();
    const user = request.platformUser;
    if (!user) {
      // PlatformJwtGuard önce çalışır; buraya düşmek yapılandırma hatasıdır.
      throw new ForbiddenException("Panel kimliği çözülemedi.");
    }

    const method = (request.method ?? "GET").toUpperCase();

    // (a) Analist sözleşmesi: hiçbir koşulda yazma yok.
    if (user.role === "ANALYST_READONLY" && method !== "GET") {
      throw new ForbiddenException(
        "Analist (salt-okur) rolü hiçbir değişiklik yapamaz. Bu rol yalnızca " +
          "toplulaştırılmış Kurul Raporu verisini görüntüleyebilir."
      );
    }

    if (this.reflector.getAllAndOverride<boolean>(PLATFORM_ANY_ROLE_KEY, targets)) return true;

    const meta = this.reflector.getAllAndOverride<PlatformPermissionMeta>(
      PLATFORM_PERMISSION_KEY,
      targets
    );
    if (!meta) {
      throw new ForbiddenException(
        "Bu uç için yetki tanımı yapılmamış; güvenlik gereği erişim kapalıdır."
      );
    }

    const label = ACTION_LABELS[meta.action] ?? meta.action;
    const roleLabel = ROLE_LABELS[user.role] ?? user.role;

    if (meta.mode === "write") {
      if (!canMutate(user.role, meta.action)) {
        throw new ForbiddenException(`${roleLabel} rolü "${label}" işlemini yapamaz.`);
      }
      return true;
    }

    if (levelOf(user.role, meta.action) === "none") {
      throw new ForbiddenException(`${roleLabel} rolü "${label}" verisini göremez.`);
    }
    return true;
  }
}
