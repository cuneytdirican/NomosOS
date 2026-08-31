import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import {
  PLATFORM_ANON_KEY,
  PLATFORM_ANY_ROLE_KEY,
  PLATFORM_PERMISSION_KEY,
  type PlatformPermissionMeta,
} from "../decorators/platform-permission.decorator";
import { ACTION_LABELS, canMutate, isFourEyesAction, levelOf } from "../platform-permissions";
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
      // denetim bulgusu K-11 — YAPISAL DÖRT-GÖZ KONTROLÜ (aşağıya bkz.).
      const structural = approvalRoutingError(meta);
      if (structural) throw new InternalServerErrorException(structural);

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

/**
 * YAPISAL DÖRT-GÖZ KONTROLÜ — denetim bulgusu K-11.
 *
 * Dört-göz kuralı bugüne kadar yalnız SERVİS DİSİPLİNİYLE yürüyordu: bir
 * controller `approvals.request(...)` çağırmayı unutursa hiçbir şey uyarmıyor,
 * işlem tek imzayla uygulanıyordu (`createPlan` tam olarak buydu). Panelin
 * dört-göz rozeti ise aynı aksiyon için "ikinci imza gerekir" diyordu.
 *
 * Bu fonksiyon o boşluğu KAPATIR ve saf olduğu için birim testlenebilir:
 *   - seviyesi `four_eyes` olan aksiyon `@WritePermission` ile bağlanamaz;
 *     tek meşru bağ `@ApprovalWritePermission`'dır,
 *   - dört-göz OLMAYAN aksiyon `@ApprovalWritePermission` taşıyamaz (bayat
 *     beyan: kullanıcıya asla gelmeyecek bir onay sözü verilir).
 *
 * Hata 500'dür, 403 değil: bu bir yetki reddi değil, YAPILANDIRMA hatasıdır ve
 * sessizce geçmemelidir.
 */
export function approvalRoutingError(meta: PlatformPermissionMeta): string | null {
  const fourEyes = isFourEyesAction(meta.action);
  const label = ACTION_LABELS[meta.action] ?? meta.action;
  if (fourEyes && !meta.viaApproval) {
    return (
      `Yapılandırma hatası: "${label}" işlemi dört-göz onayına tabidir ve bu uç ` +
      "işlemi DOĞRUDAN uygulayamaz. Ucu `@ApprovalWritePermission` ile bağlayın " +
      "ve servisi `approvals.request(...)` çağıracak biçimde yazın."
    );
  }
  if (!fourEyes && meta.viaApproval) {
    return (
      `Yapılandırma hatası: "${label}" işlemi yetki matrisinde dört-göz DEĞİL, ` +
      "ama uç `@ApprovalWritePermission` ile bağlanmış. Ya matris satırını " +
      "`four_eyes` yapın ya da ucu `@WritePermission` ile bağlayın."
    );
  }
  return null;
}
