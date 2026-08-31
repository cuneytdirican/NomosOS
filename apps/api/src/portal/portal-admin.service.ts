import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { InvoiceStatus, PortalResourceType } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { assertRole, ROLE_SETS } from "../common/roles";
import { FINANCE_ACCESS, assertFinanceAccess } from "../finance/finance-access";
import { resolvePage, paged } from "../common/pagination";
import type { AuthUser } from "../common/types";
import { PortalPublicationService } from "./portal-publication.service";
import { hashPortalToken, newPortalToken } from "./portal-token";
import { PORTAL_INVITE_TTL_HOURS, PORTAL_RESET_CREATED_BY } from "./portal.constants";
import type { PortalBulkPublishInput, PortalInviteInput, PortalPublishInput } from "./portal.schemas";

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ BÜRO TARAFI PORTAL YÖNETİMİ — `/api/v1/portal-admin/**`                  ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Portal modülünün İKİNCİ YÜZÜ. Aynı modülde yaşar ama BÜRO kimliğiyle
 * (`JwtAuthGuard` + `TenantStatusGuard`, global zincir) çalışır: burada
 * `request.user` bir avukattır, `request.portalUser` yoktur.
 *
 * Yayınlama, portalın TEK GÜVENLİK KARARIDIR ve bu yüzden:
 *   - her yayın kaydı KİMİN yayınladığını taşır (`publishedBy`),
 *   - her yayın/geri çekme büro `AuditLog`'una PORTAL_* eylemiyle düşer,
 *   - yayınlanan kaynağın SEÇİLEN MÜVEKKİLE ait olduğu doğrulanır,
 *   - "tüm dosyayı yayınla" gibi geniş bir kısayol YOKTUR (görev tanımı §4).
 */
@Injectable()
export class PortalAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly publications: PortalPublicationService,
    private readonly audit: AuditService
  ) {}

  /* ================================================================== *
   * Portal kullanıcıları
   * ================================================================== */

  /**
   * ROL KAPISI (denetim bulgusu 2): bu uç müvekkilin portal kullanıcılarının
   * e-postalarını ve son giriş zamanlarını döner — kimin portala erişimi
   * olduğu, portal erişimini YÖNETEN rollerin bilgisidir.
   */
  async listUsers(user: AuthUser, clientId: string) {
    assertRole(user, ROLE_SETS.HUKUKI, "portal kullanıcılarını görüntüleme");
    await this.requireClient(user.tenantId, clientId);
    const rows = await this.prisma.client.portalUser.findMany({
      where: { tenantId: user.tenantId, clientId },
      // `passwordHash` ASLA seçilmez.
      select: {
        id: true,
        email: true,
        fullName: true,
        isActive: true,
        lastLoginAt: true,
        invitedBy: true,
        invitedAt: true,
        activatedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    const pendingInvites = await this.prisma.client.portalInvite.findMany({
      where: {
        tenantId: user.tenantId,
        clientId,
        usedAt: null,
        expiresAt: { gt: new Date() },
        // Parola sıfırlama kayıtları aynı tabloda durur; davet listesine girmez.
        NOT: { createdBy: PORTAL_RESET_CREATED_BY },
      },
      // `tokenHash` DÖNMEZ.
      select: { id: true, email: true, expiresAt: true, createdBy: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });

    return { users: rows, pendingInvites };
  }

  /**
   * Portal daveti üretir.
   *
   * HAM TOKEN YALNIZCA BU YANITTA, BİR KEZ DÖNER; veritabanına SHA-256 özeti
   * yazılır ve ham değer bir daha elde edilemez. Avukat bağlantıyı müvekkiline
   * kendi kanalından iletir (portal için e-posta gönderim altyapısı
   * yapılandırılmamıştır; sahte bir "gönderildi" akışı uydurulmaz).
   */
  async invite(user: AuthUser, input: PortalInviteInput) {
    assertRole(user, ROLE_SETS.HUKUKI, "portal daveti gönderme");
    const client = await this.requireClient(user.tenantId, input.clientId);
    if (!client.isActive) {
      throw new BadRequestException(
        "Pasif müvekkil için portal daveti oluşturulamaz. Önce müvekkil kaydını aktifleştirin."
      );
    }

    const existing = await this.prisma.client.portalUser.findUnique({
      where: { tenantId_email: { tenantId: user.tenantId, email: input.email } },
      select: { id: true, clientId: true, isActive: true },
    });
    if (existing) {
      throw new ConflictException(
        existing.clientId === input.clientId
          ? "Bu e-posta için zaten bir portal hesabı var."
          : "Bu e-posta büronuzda BAŞKA bir müvekkilin portal hesabına bağlı. " +
            "Aynı e-posta iki müvekkile bağlanamaz."
      );
    }

    const raw = newPortalToken();
    const expiresAt = new Date(Date.now() + PORTAL_INVITE_TTL_HOURS * 3_600_000);

    // Aynı e-posta için bekleyen eski davetler tüketilir: elde birden çok
    // geçerli bağlantı kalmasın.
    await this.prisma.client.portalInvite.updateMany({
      where: {
        tenantId: user.tenantId,
        email: input.email,
        usedAt: null,
        NOT: { createdBy: PORTAL_RESET_CREATED_BY },
      },
      data: { usedAt: new Date() },
    });

    const invite = await this.prisma.client.portalInvite.create({
      data: {
        tenantId: user.tenantId,
        clientId: input.clientId,
        email: input.email,
        tokenHash: hashPortalToken(raw),
        expiresAt,
        createdBy: user.userId,
      },
      select: { id: true, email: true, expiresAt: true },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "PORTAL_INVITE_CREATED",
      entity: "PortalInvite",
      entityId: invite.id,
      detail: `${input.email} → ${client.name}`,
    });

    return {
      invite,
      /** HAM TOKEN — yalnızca burada, yalnızca bir kez. */
      token: raw,
      /**
       * BAĞLANTI BİÇİMİ ÖNEMLİDİR: token adres FRAGMENT'inde (`#`) taşınır.
       * Yol parametresi olarak yazılırsa (`/davet/<token>`) ham token tarayıcı
       * geçmişine, ters vekil/CDN erişim günlüklerine ve `Referer` başlığına
       * düşer; o günlüğü okuyabilen biri daveti kendi belirlediği parolayla
       * kullanabilir. Fragment sunucuya HİÇ GİTMEZ.
       */
      inviteUrlTemplate: "{PORTAL_ADRESI}/davet#{TOKEN}",
      note:
        "Bu bağlantıyı müvekkilinize güvenli bir kanaldan iletin. Adres şu biçimde " +
        "olmalıdır: https://portal.orneksite.com/davet#" +
        "<jeton>. Jetonun '#' işaretinden SONRA gelmesi bir ayrıntı değildir: " +
        "'#' sonrası sunucuya hiç gönderilmez ve hiçbir günlüğe yazılmaz. Jeton bir " +
        "daha gösterilemez; kaybolursa yeni davet oluşturun.",
    };
  }

  /** Portal erişimini kapatır — mevcut oturumlar ANINDA geçersizleşir. */
  async deactivateUser(user: AuthUser, portalUserId: string) {
    assertRole(user, ROLE_SETS.HUKUKI, "portal erişimini kapatma");
    return this.setUserActive(user, portalUserId, false);
  }

  /** Portal erişimini yeniden açar. */
  async activateUser(user: AuthUser, portalUserId: string) {
    assertRole(user, ROLE_SETS.HUKUKI, "portal erişimini açma");
    return this.setUserActive(user, portalUserId, true);
  }

  private async setUserActive(user: AuthUser, portalUserId: string, isActive: boolean) {
    const record = await this.prisma.client.portalUser.findFirst({
      where: { id: portalUserId, tenantId: user.tenantId },
      select: { id: true, email: true, clientId: true },
    });
    if (!record) throw new NotFoundException("Portal kullanıcısı bulunamadı.");

    const updated = await this.prisma.client.portalUser.update({
      where: { id: record.id },
      data: { isActive },
      select: { id: true, email: true, fullName: true, isActive: true },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: isActive ? "PORTAL_USER_ACTIVATED" : "PORTAL_USER_DEACTIVATED",
      entity: "PortalUser",
      entityId: record.id,
      detail: record.email,
    });

    return updated;
  }

  /* ================================================================== *
   * Yayın yönetimi
   * ================================================================== */

  /**
   * Avukat neyi yayınladığını görür (yayından kaldırılanlar dâhil, işaretli).
   *
   * ROL KAPISI (denetim bulgusu 2): "bu müvekkile ne açılmış?" dökümü, yayın
   * kararının kendisiyle aynı hassasiyettedir ve yayınlama yetkisi olan
   * rollerle sınırlıdır. Ayrıca FATURA/ODEME yayınları listelendiğinde tutar
   * taşımasa da hangi finansal kaydın müvekkile açıldığını gösterir.
   */
  async listPublications(
    user: AuthUser,
    query: { clientId: string; resourceType?: string; includeUnpublished?: string }
  ) {
    assertRole(user, ROLE_SETS.HUKUKI, "portal yayın listesini görüntüleme");
    await this.requireClient(user.tenantId, query.clientId);
    const includeUnpublished = query.includeUnpublished === "true";

    const rows = await this.prisma.client.portalPublication.findMany({
      where: {
        tenantId: user.tenantId,
        clientId: query.clientId,
        ...(query.resourceType
          ? { resourceType: assertResourceType(query.resourceType) }
          : {}),
        ...(includeUnpublished ? {} : { unpublishedAt: null }),
      },
      select: {
        id: true,
        resourceType: true,
        resourceId: true,
        note: true,
        publishedBy: true,
        publishedAt: true,
        unpublishedAt: true,
        /** false → sahiplik doğrulanamadı; görünürlük tek kapıya dayanıyor. */
        ownershipVerified: true,
      },
      orderBy: { publishedAt: "desc" },
    });

    const unverified = rows.filter((r) => !r.ownershipVerified && r.unpublishedAt === null);
    return {
      items: rows.map((row) => ({
        ...row,
        ownershipWarning: row.ownershipVerified
          ? null
          : "Bu kaydın müvekkile aidiyeti sistemce doğrulanamadı; görünürlük yalnızca " +
            "yayın kararına dayanıyor.",
      })),
      total: rows.length,
      /** Arayüzün ayrı bir uyarı bandı çizmesi için özet (denetim bulgusu 4). */
      ownershipUnverifiedCount: unverified.length,
    };
  }

  /**
   * Tek kaynağı yayınlar.
   *
   * YENİ SATIR OLUŞTURULMAZ, `upsert` YAPILIR: benzersizlik kısıtı
   * `[tenantId, resourceType, resourceId, clientId]`'dir ve yayından kaldırılan
   * kayıt SİLİNMEZ (damgalanır). Yeniden yayında `create` denenirse benzersizlik
   * ihlali alınırdı; doğrusu aynı satırın `unpublishedAt`'ini temizlemektir.
   */
  async publish(user: AuthUser, input: PortalPublishInput) {
    assertRole(user, ROLE_SETS.HUKUKI, "portala yayınlama");
    await this.requireClient(user.tenantId, input.clientId);
    const ownership = await this.publications.assertOwnedByClient(
      user.tenantId,
      input.clientId,
      input.resourceType,
      input.resourceId
    );
    await this.assertParentCasePublished(user.tenantId, input.clientId, input.resourceType, input.resourceId);

    const row = await this.upsertPublication(user, input, ownership.verified);

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "PORTAL_PUBLISH",
      entity: "PortalPublication",
      entityId: row.id,
      detail:
        `${input.resourceType}:${input.resourceId} → müvekkil ${input.clientId}` +
        // Denetim satırı iki durumu ARTIK AYIRT EDER: sahipliği doğrulanmış
        // yayın ile yalnızca avukat kararına dayanan yayın aynı şey değildir.
        (ownership.verified ? "" : " · SAHİPLİK DOĞRULANAMADI (tek kapılı yayın kararı)"),
    });

    return { ...row, ownershipWarning: ownership.warning };
  }

  /**
   * TOPLU YAYIN — açıkça seçilmiş id'ler (en fazla 100).
   *
   * "Bu dosyanın TÜM belgelerini yayınla" gibi bir kısayol BİLEREK YAZILMADI:
   * portalın tek güvenlik kararı yayın kararıdır ve o karar her kaynak için
   * ayrı ayrı, avukatın gözüyle verilmelidir. Bu uç, arayüzde çoklu seçim
   * yapan avukatın işini kısaltır; kararı otomatikleştirmez.
   *
   * KISMİ BAŞARI DÖNER: sahiplik doğrulaması tutmayan id'ler `skipped`
   * listesine düşer ve diğerleri yayınlanır. Tek bir hatalı id yüzünden 50
   * kaynağın yayınlanmaması, avukatı "hepsini tek tek dene" döngüsüne sokardı.
   */
  async publishBulk(user: AuthUser, input: PortalBulkPublishInput) {
    assertRole(user, ROLE_SETS.HUKUKI, "portala yayınlama");
    await this.requireClient(user.tenantId, input.clientId);

    const published: string[] = [];
    const skipped: { resourceId: string; reason: string }[] = [];
    /** Sahipliği doğrulanamayan (tek kapılı) yayınlar — avukata ayrıca bildirilir. */
    const ownershipUnverified: string[] = [];

    for (const resourceId of [...new Set(input.resourceIds)]) {
      try {
        const ownership = await this.publications.assertOwnedByClient(
          user.tenantId,
          input.clientId,
          input.resourceType,
          resourceId
        );
        await this.assertParentCasePublished(
          user.tenantId,
          input.clientId,
          input.resourceType,
          resourceId
        );
        await this.upsertPublication(user, { ...input, resourceId }, ownership.verified);
        if (!ownership.verified) ownershipUnverified.push(resourceId);
        published.push(resourceId);
      } catch (err) {
        skipped.push({
          resourceId,
          reason: err instanceof Error ? err.message : "Yayınlanamadı.",
        });
      }
    }

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "PORTAL_PUBLISH_BULK",
      entity: "PortalPublication",
      detail:
        `${input.resourceType} — yayınlanan ${published.length}, atlanan ${skipped.length} ` +
        `(müvekkil ${input.clientId})` +
        (ownershipUnverified.length > 0
          ? ` · SAHİPLİK DOĞRULANAMAYAN ${ownershipUnverified.length} kayıt: ` +
            ownershipUnverified.join(", ")
          : ""),
    });

    return {
      published,
      skipped,
      publishedCount: published.length,
      ownershipUnverified,
      ...(ownershipUnverified.length > 0
        ? {
            ownershipWarning:
              `${ownershipUnverified.length} kaydın hangi müvekkile ait olduğu sistemce ` +
              "DOĞRULANAMADI (bir dosyaya bağlı değiller). Bu kayıtlar için görünürlük " +
              "yalnızca sizin yayın kararınıza dayanıyor; ikinci bir kontrol yapılamadı.",
          }
        : {}),
    };
  }

  /**
   * Yayından kaldırır. KAYIT SİLİNMEZ, `unpublishedAt` damgalanır.
   *
   * İki sebep: (1) benzersizlik kısıtı yüzünden yeniden yayında aynı satır
   * güncellenmelidir, (2) "bu belge bir dönem müvekkile açıktı" bilgisi KVKK
   * açısından silinmemesi gereken bir kayıttır.
   *
   * DOSYA yayını geri çekildiğinde altındaki belge/duruşma/safahat kayıtları
   * AYRICA geri çekilmez — gerek yoktur: portal sorgusu cascade'i her okumada
   * uygular (`PortalPublicationService`), yani tek işlemle hepsi görünmez olur
   * (spec §Kabul Kriterleri 3).
   */
  async unpublish(user: AuthUser, publicationId: string) {
    assertRole(user, ROLE_SETS.HUKUKI, "yayından kaldırma");

    const record = await this.prisma.client.portalPublication.findFirst({
      where: { id: publicationId, tenantId: user.tenantId },
      select: { id: true, resourceType: true, resourceId: true, clientId: true, unpublishedAt: true },
    });
    if (!record) throw new NotFoundException("Yayın kaydı bulunamadı.");

    if (record.unpublishedAt) {
      return { ...record, alreadyUnpublished: true };
    }

    const updated = await this.prisma.client.portalPublication.update({
      where: { id: record.id },
      data: { unpublishedAt: new Date() },
      select: {
        id: true,
        resourceType: true,
        resourceId: true,
        clientId: true,
        unpublishedAt: true,
      },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "PORTAL_UNPUBLISH",
      entity: "PortalPublication",
      entityId: record.id,
      detail: `${record.resourceType}:${record.resourceId} → müvekkil ${record.clientId}`,
    });

    return updated;
  }

  /* ================================================================== *
   * Yayın adayları — arayüzün seçim listesi
   * ================================================================== */

  /**
   * Müvekkile ait, YAYINLANABİLİR kaynakların listesi + yayın durumu.
   *
   * Bu uç bir KOLAYLIKTIR, bir yetki genişletmesi değildir: büro kullanıcısı
   * bu kayıtları zaten kendi uçlarından görebiliyor. Buradaki katkı, her
   * kaydın yanına "portalda yayında mı?" bilgisini koymaktır — avukat neyi
   * açtığını tek ekranda görsün.
   */
  async publishable(
    user: AuthUser,
    query: { clientId: string; resourceType: string; page?: string; limit?: string }
  ) {
    const resourceType = assertResourceType(query.resourceType);

    // ── ROL KAPISI (denetim bulgusu 2) ─────────────────────────────────────
    //
    // Bu uç "bir kolaylık" olarak yazılmıştı ve hiçbir rol kontrolü taşımıyordu.
    // Ama FATURA aday listesi fatura numarasını ve TUTARINI, ODEME listesi
    // tahsilat TUTARINI ve yöntemini döner — oysa `FINANCE_ACCESS.READ` uyarınca
    // STAJYER faturalama uçlarının hiçbirine erişemez. Yani
    // `GET /billing/invoices` 403 alan bir kullanıcı, aynı token ile buradan
    // aynı tutarları okuyabiliyordu: dikey yetki yükseltmesi, sonucu finansal
    // veri açılımı.
    //
    // Kapı, verinin GERÇEK sahibinin matrisiyle hizalanır: finansal türlerde
    // finans okuma yetkisi, diğerlerinde yayınlama (HUKUKI) yetkisi aranır.
    if (resourceType === "FATURA" || resourceType === "ODEME") {
      assertFinanceAccess(
        user,
        FINANCE_ACCESS.READ,
        "fatura/tahsilat kayıtlarını görüntüleme"
      );
    }
    assertRole(user, ROLE_SETS.HUKUKI, "portal yayın adaylarını görüntüleme");

    await this.requireClient(user.tenantId, query.clientId);
    const page = resolvePage(query, 50);

    const caseIds = (
      await this.prisma.client.case.findMany({
        where: { tenantId: user.tenantId, clientId: query.clientId },
        select: { id: true },
      })
    ).map((row) => row.id);

    const { items, total } = await this.candidates(
      user.tenantId,
      query.clientId,
      resourceType,
      caseIds,
      page
    );

    const publishedIds = new Set(
      (
        await this.prisma.client.portalPublication.findMany({
          where: {
            tenantId: user.tenantId,
            clientId: query.clientId,
            resourceType,
            unpublishedAt: null,
            resourceId: { in: items.map((item) => item.id) },
          },
          select: { resourceId: true },
        })
      ).map((row) => row.resourceId)
    );

    return paged(
      items.map((item) => ({ ...item, isPublished: publishedIds.has(item.id) })),
      total,
      page
    );
  }

  /* ================================================================== *
   * Portal denetim izi (KVKK)
   * ================================================================== */

  /** "Müvekkil neyi, ne zaman gördü?" — portal denetim kayıtları. */
  async auditTrail(
    user: AuthUser,
    query: { clientId: string; page?: string; limit?: string }
  ) {
    assertRole(user, ROLE_SETS.HUKUKI, "portal denetim izini görüntüleme");
    await this.requireClient(user.tenantId, query.clientId);
    const page = resolvePage(query, 50);

    const portalUserIds = (
      await this.prisma.client.portalUser.findMany({
        where: { tenantId: user.tenantId, clientId: query.clientId },
        select: { id: true },
      })
    ).map((row) => row.id);

    if (portalUserIds.length === 0) return paged([], 0, page);

    const where = { tenantId: user.tenantId, portalUserId: { in: portalUserIds } };
    const [items, total] = await Promise.all([
      this.prisma.client.portalAuditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.client.portalAuditLog.count({ where }),
    ]);
    return paged(items, total, page);
  }

  /* ================================================================== *
   * Yardımcılar
   * ================================================================== */

  private async upsertPublication(
    user: AuthUser,
    input: { clientId: string; resourceType: PortalResourceType; resourceId: string; note?: string },
    ownershipVerified: boolean
  ) {
    return this.prisma.client.portalPublication.upsert({
      where: {
        tenantId_resourceType_resourceId_clientId: {
          tenantId: user.tenantId,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          clientId: input.clientId,
        },
      },
      create: {
        tenantId: user.tenantId,
        clientId: input.clientId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        publishedBy: user.userId,
        note: input.note,
        ownershipVerified,
      },
      update: {
        // Yeniden yayın: damga temizlenir, sorumluluk ve tarih tazelenir.
        unpublishedAt: null,
        publishedBy: user.userId,
        publishedAt: new Date(),
        note: input.note,
        // Sahiplik HER yayında yeniden çözülür: belge bu arada bir dosyaya
        // bağlanmış olabilir (doğrulanır) ya da bağı kopmuş olabilir.
        ownershipVerified,
      },
      select: {
        id: true,
        resourceType: true,
        resourceId: true,
        clientId: true,
        note: true,
        publishedAt: true,
        unpublishedAt: true,
        ownershipVerified: true,
      },
    });
  }

  /**
   * Belge/duruşma/safahat yayınlanırken bağlı dosyanın da yayında olmasını arar.
   *
   * Portal sorgusu cascade'i zaten uyguluyor — yani üst dosya yayında değilse
   * kayıt müvekkile GÖRÜNMEZ. Buradaki kontrol bir güvenlik kapısı değil,
   * SESSİZ BAŞARISIZLIĞA karşı bir uyarıdır: avukat "yayınladım" der, müvekkil
   * hiçbir şey görmez ve kimse nedenini anlamaz. Hata mesajı ne yapılacağını
   * söyler.
   */
  private async assertParentCasePublished(
    tenantId: string,
    clientId: string,
    resourceType: PortalResourceType,
    resourceId: string
  ): Promise<void> {
    let caseId: string | null = null;
    if (resourceType === "BELGE") {
      caseId =
        (
          await this.prisma.client.document.findFirst({
            where: { id: resourceId, tenantId },
            select: { caseId: true },
          })
        )?.caseId ?? null;
    } else if (resourceType === "DURUSMA") {
      caseId =
        (
          await this.prisma.client.hearing.findFirst({
            where: { id: resourceId, tenantId },
            select: { caseId: true },
          })
        )?.caseId ?? null;
    } else if (resourceType === "SAFAHAT_KAYDI") {
      caseId =
        (
          await this.prisma.client.timelineEvent.findFirst({
            where: { id: resourceId, tenantId },
            select: { caseId: true },
          })
        )?.caseId ?? null;
    }
    if (!caseId) return;

    const parent = await this.prisma.client.portalPublication.findFirst({
      where: {
        tenantId,
        clientId,
        resourceType: "DOSYA",
        resourceId: caseId,
        unpublishedAt: null,
      },
      select: { id: true },
    });
    if (!parent) {
      throw new BadRequestException(
        "Bu kaydın bağlı olduğu dosya portalda yayınlanmamış. Önce dosyayı yayınlayın " +
          "(DOSYA tipinde yayın kaydı); aksi hâlde kayıt müvekkile görünmez."
      );
    }
  }

  /** Yayın adaylarını türüne göre çeker (alanlar arayüz listesi için sadedir). */
  private async candidates(
    tenantId: string,
    clientId: string,
    resourceType: PortalResourceType,
    caseIds: string[],
    page: { skip: number; take: number }
  ): Promise<{ items: { id: string; label: string; at: Date | null }[]; total: number }> {
    const empty = { items: [], total: 0 };
    switch (resourceType) {
      case "DOSYA": {
        const where = { tenantId, clientId };
        const [rows, total] = await Promise.all([
          this.prisma.client.case.findMany({
            where,
            select: { id: true, title: true, fileNumber: true, openedAt: true },
            orderBy: { openedAt: "desc" },
            skip: page.skip,
            take: page.take,
          }),
          this.prisma.client.case.count({ where }),
        ]);
        return {
          items: rows.map((r) => ({
            id: r.id,
            label: r.fileNumber ? `${r.fileNumber} — ${r.title}` : r.title,
            at: r.openedAt,
          })),
          total,
        };
      }
      case "BELGE": {
        if (caseIds.length === 0) return empty;
        const where = { tenantId, caseId: { in: caseIds } };
        const [rows, total] = await Promise.all([
          this.prisma.client.document.findMany({
            where,
            select: { id: true, name: true, createdAt: true },
            orderBy: { createdAt: "desc" },
            skip: page.skip,
            take: page.take,
          }),
          this.prisma.client.document.count({ where }),
        ]);
        return {
          items: rows.map((r) => ({ id: r.id, label: r.name, at: r.createdAt })),
          total,
        };
      }
      case "DURUSMA": {
        if (caseIds.length === 0) return empty;
        const where = { tenantId, caseId: { in: caseIds } };
        const [rows, total] = await Promise.all([
          this.prisma.client.hearing.findMany({
            where,
            select: { id: true, date: true, type: true, courtroom: true },
            orderBy: { date: "desc" },
            skip: page.skip,
            take: page.take,
          }),
          this.prisma.client.hearing.count({ where }),
        ]);
        return {
          items: rows.map((r) => ({
            id: r.id,
            label: `${r.type}${r.courtroom ? ` — ${r.courtroom}` : ""}`,
            at: r.date,
          })),
          total,
        };
      }
      case "SAFAHAT_KAYDI": {
        if (caseIds.length === 0) return empty;
        const where = { tenantId, caseId: { in: caseIds } };
        const [rows, total] = await Promise.all([
          this.prisma.client.timelineEvent.findMany({
            where,
            select: { id: true, title: true, date: true },
            orderBy: { date: "desc" },
            skip: page.skip,
            take: page.take,
          }),
          this.prisma.client.timelineEvent.count({ where }),
        ]);
        return {
          items: rows.map((r) => ({ id: r.id, label: r.title, at: r.date })),
          total,
        };
      }
      case "FATURA": {
        const where = {
          tenantId,
          clientId,
          status: { notIn: ["TASLAK", "IPTAL"] as InvoiceStatus[] },
        };
        const [rows, total] = await Promise.all([
          this.prisma.client.invoice.findMany({
            where,
            select: { id: true, invoiceNo: true, total: true, issueDate: true },
            orderBy: { issueDate: "desc" },
            skip: page.skip,
            take: page.take,
          }),
          this.prisma.client.invoice.count({ where }),
        ]);
        return {
          items: rows.map((r) => ({
            id: r.id,
            label: `${r.invoiceNo ?? "(numarasız)"} — ${r.total.toFixed(2)}`,
            at: r.issueDate,
          })),
          total,
        };
      }
      case "ODEME": {
        const where = { tenantId, clientId };
        const [rows, total] = await Promise.all([
          this.prisma.client.payment.findMany({
            where,
            select: { id: true, amount: true, date: true, method: true },
            orderBy: { date: "desc" },
            skip: page.skip,
            take: page.take,
          }),
          this.prisma.client.payment.count({ where }),
        ]);
        return {
          items: rows.map((r) => ({
            id: r.id,
            label: `${r.amount.toFixed(2)} — ${r.method}`,
            at: r.date,
          })),
          total,
        };
      }
      case "MESAJ": {
        // Giden mesajlar İletişim Merkezi modülünün kuyruğundan yönetilir;
        // aday listesi orada anlamlıdır. Burada boş döner — yayınlamak için
        // POST /portal-admin/publications ile mesaj id'si verilebilir.
        return empty;
      }
      default: {
        const exhaustive: never = resourceType;
        void exhaustive;
        return empty;
      }
    }
  }

  /** Müvekkilin bu büroya ait olduğunu doğrular (her uçta ilk adım). */
  private async requireClient(tenantId: string, clientId: string) {
    const client = await this.prisma.client.client.findFirst({
      where: { id: clientId, tenantId },
      select: { id: true, name: true, isActive: true },
    });
    if (!client) throw new NotFoundException("Müvekkil bulunamadı.");
    return client;
  }
}

/** Sorgu parametresinden gelen kaynak türünü doğrular. */
function assertResourceType(value: string): PortalResourceType {
  const allowed: PortalResourceType[] = [
    "DOSYA",
    "BELGE",
    "DURUSMA",
    "SAFAHAT_KAYDI",
    "FATURA",
    "MESAJ",
    "ODEME",
  ];
  if (!(allowed as string[]).includes(value)) {
    throw new BadRequestException(
      `Geçersiz kaynak türü: ${value}. Beklenen: ${allowed.join(", ")}`
    );
  }
  return value as PortalResourceType;
}
