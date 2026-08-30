import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@nomosos/db";
import { PrismaService } from "../../prisma/prisma.service";
import { paged, resolvePage } from "../../common/pagination";
import { PlatformAuditService } from "../platform-audit.service";
import { SUPPORT_GRANT_MAX_HOURS } from "../platform.constants";
import type { PlatformAuthUser } from "../platform.types";

/**
 * DESTEK ERİŞİM PENCERELERİ.
 *
 * BU DOSYADA BİR IMPERSONATION UCU YOKTUR VE YAZILMAYACAKTIR.
 * "Tenant kullanıcısı gibi giriş yap" bilinçli olarak kapsam dışıdır: KVKK'da
 * veri işleyen sıfatıyla erişim minimizasyonunu bozar ve büronun kendi denetim
 * izinde işlemin gerçek faile atfını imkânsız kılar (spec §Güvenlik 5).
 *
 * Pencerenin kendisi bu servis tarafından AÇILMAZ: açılış dört-göz onayından
 * sonra `PlatformApprovalExecutorService` tarafından yapılır. Burada yalnızca
 * LİSTELEME ve ERKEN İPTAL vardır — iptal daima kısıtlayıcı yöndedir, bu
 * yüzden ikinci imza aranmaz.
 */
@Injectable()
export class PlatformSupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService
  ) {}

  async list(query: {
    tenantId?: string;
    activeOnly?: string;
    page?: string;
    limit?: string;
  }) {
    const where: Prisma.SupportAccessGrantWhereInput = {};
    if (query.tenantId) where.tenantId = query.tenantId;
    if (query.activeOnly === "true") {
      where.revokedAt = null;
      where.expiresAt = { gt: new Date() };
    }

    const page = resolvePage(query);
    const [rows, total] = await Promise.all([
      this.prisma.client.supportAccessGrant.findMany({
        where,
        orderBy: { grantedAt: "desc" },
        skip: page.skip,
        take: page.take,
        include: {
          // PlatformUser GERÇEK bir ilişkidir (tenantId'nin aksine).
          platformUser: { select: { id: true, fullName: true, email: true, role: true } },
        },
      }),
      this.prisma.client.supportAccessGrant.count({ where }),
    ]);

    const tenantIds = [...new Set(rows.map((r) => r.tenantId))];
    const tenants = tenantIds.length
      ? await this.prisma.client.tenant.findMany({
          where: { id: { in: tenantIds } },
          select: { id: true, name: true },
        })
      : [];
    const tenantNames = new Map(tenants.map((t) => [t.id, t.name]));

    const now = Date.now();
    return {
      ...paged(
        rows.map((r) => ({
          id: r.id,
          tenantId: r.tenantId,
          tenantName: tenantNames.get(r.tenantId) ?? "(silinmiş büro)",
          platformUser: r.platformUser,
          reason: r.reason,
          scope: r.scope,
          grantedAt: r.grantedAt,
          expiresAt: r.expiresAt,
          revokedAt: r.revokedAt,
          revokedBy: r.revokedBy,
          isActive: !r.revokedAt && r.expiresAt.getTime() > now,
          remainingMinutes: Math.max(
            0,
            Math.floor((r.expiresAt.getTime() - now) / 60000)
          ),
        })),
        total,
        page
      ),
      note:
        `Destek erişimi SALT-OKURDUR, PII her kapsamda maskeli kalır ve azami ` +
        `${SUPPORT_GRANT_MAX_HOURS} saat sürer; süresi dolan pencere kendiliğinden kapanır. ` +
        "Kullanıcı kimliğine bürünme (impersonation) sistemde hiç yoktur.",
    };
  }

  /** ERKEN İPTAL — her zaman serbesttir (yalnızca yetkiyi daraltır). */
  async revoke(user: PlatformAuthUser, id: string) {
    const grant = await this.prisma.client.supportAccessGrant.findUnique({ where: { id } });
    if (!grant) throw new NotFoundException("Destek erişim kaydı bulunamadı.");
    if (grant.revokedAt) {
      throw new BadRequestException("Bu erişim penceresi zaten iptal edilmiş.");
    }

    await this.prisma.client.supportAccessGrant.update({
      where: { id },
      data: { revokedAt: new Date(), revokedBy: user.id },
    });

    // ÇİFT TARAFLI KAYIT: büro, erişimin kapandığını kendi denetim izinde görür.
    await this.audit.logBoth({
      actor: user,
      action: "SUPPORT_GRANT_REVOKE",
      tenantAction: "PLATFORM_DESTEK_ERISIMI",
      entity: "SupportAccessGrant",
      entityId: id,
      tenantId: grant.tenantId,
      detail:
        `Destek erişim penceresi süresinden önce kapatıldı. Kapatan: ${user.email}. ` +
        `Özgün bitiş: ${grant.expiresAt.toISOString()}.`,
    });

    return { id, revoked: true, message: "Destek erişimi kapatıldı." };
  }
}
