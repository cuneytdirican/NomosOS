import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { SupportScope } from "@nomosos/db";
import { PrismaService } from "../../prisma/prisma.service";
import { PlatformAuditService } from "../platform-audit.service";
import {
  SUPPORT_GRANT_KEY,
  type SupportGrantMeta,
} from "../decorators/requires-support-grant.decorator";
import { supportGrantDenial } from "../support/support-grant";
import type { PlatformAuthUser } from "../platform.types";

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ DESTEK ERİŞİM KAPISI — denetim bulgusu Ö-06                              ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * `SupportAccessGrant` yazılıyor, listeleniyor, iptal ediliyordu ama HİÇBİR
 * UÇTA OKUNMUYORDU: "bu panel kullanıcısının bu kiracı için açık bir penceresi
 * var mı?" sorusu hiç sorulmuyordu. Dört-göz onayı, 24 saatlik tavan ve kapsam
 * beyaz listesi bir şeyi kapılamıyor; süresi dolan pencere hiçbir davranışı
 * değiştirmiyordu.
 *
 * Bu guard o soruyu sorar. Kapsam:
 *   - YALNIZCA `SUPPORT_AGENT` rolü için çalışır. Destek personelinin kiracı
 *     verisine erişimi spec'te "KVKK-sınırlı, SÜRELİ, salt-okur" olarak
 *     tanımlıdır; süreli olmayan bir erişim bu tanımı boşa çıkarır.
 *     Diğer roller (OPS/BILLING/SUPER) kendi yetki satırlarıyla girer —
 *     onların erişimi zaten destek talebine değil, göreve bağlıdır.
 *   - Kiracı kimliği rota parametresinden okunur (`:id`). Parametre yoksa
 *     guard karar veremez ve FAIL-CLOSED davranır.
 *
 * REDDEDİLEN HER DENEME DENETİM İZİNE YAZILIR: "süresi dolmuş pencereyle
 * içeriye bakmaya çalışıldı" bilgisi, penceresi kapanmış bir hesabın
 * davranışını izlemek için gerekli olan tek sinyaldir.
 */
@Injectable()
export class SupportGrantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<SupportGrantMeta>(SUPPORT_GRANT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!meta) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { platformUser?: PlatformAuthUser; params: Record<string, string> }>();
    const user = request.platformUser;
    if (!user) throw new ForbiddenException("Panel kimliği çözülemedi.");

    if (user.role !== "SUPPORT_AGENT") return true;

    const tenantId = request.params?.[meta.paramName];
    if (!tenantId) {
      throw new ForbiddenException(
        "Destek erişimi büro bazında verilir; bu istekte büro kimliği çözülemedi."
      );
    }

    const grants = await this.prisma.client.supportAccessGrant.findMany({
      where: { platformUserId: user.id, tenantId },
      select: { scope: true, expiresAt: true, revokedAt: true },
      orderBy: { grantedAt: "desc" },
      take: 25,
    });

    const denial = supportGrantDenial(grants, meta.scope as SupportScope, new Date());
    if (!denial) return true;

    await this.audit.log({
      actor: user,
      action: "SUPPORT_ACCESS_DENIED",
      entity: "SupportAccessGrant",
      tenantId,
      ipAddress: user.ip,
      detail:
        `Destek erişim penceresi olmadan/yetersiz kapsamla büro verisine erişim denendi ` +
        `(gereken kapsam: ${meta.scope}).`,
    });
    throw new ForbiddenException(denial);
  }
}
