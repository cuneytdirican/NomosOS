import { Inject, Injectable, NotFoundException, forwardRef } from "@nestjs/common";
import { Prisma } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { InboundService } from "../communication/inbound.service";
import { PortalAuditService } from "./portal-audit.service";
import { PortalPublicationService } from "./portal-publication.service";
import {
  PORTAL_CASE_SELECT,
  PORTAL_DOCUMENT_SELECT,
  PORTAL_HEARING_SELECT,
  PORTAL_INBOUND_SELECT,
  PORTAL_INVOICE_SELECT,
  PORTAL_OUTBOUND_SELECT,
  PORTAL_PAYMENT_SELECT,
  PORTAL_TIMELINE_SELECT,
} from "./portal-selects";
import { PORTAL_DOWNLOAD_TTL_SECONDS } from "./portal.constants";
import type { PortalMessageInput } from "./portal.schemas";
import type { PortalAuthUser } from "./portal.types";

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ PORTAL OKUMA UÇLARI — sistemin EN DAR yetkili yüzeyi                     ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ═══ ÜÇ KURAL, İSTİSNASIZ ═══
 *
 * 1. **Her sorgu `tenantId` + `clientId` süzgeçlidir.** İkisi de token'dan
 *    değil, guard'ın veritabanından okuduğu kayıttan gelir.
 *
 * 2. **Her sorgu `PortalPublicationService`'ten geçer.** Yayınlanmamış kayıt
 *    sorguya HİÇ GİRMEZ (uygulama katmanında elenmez — sorgu katmanında
 *    dışarıda kalır). Tekil uçlar `assertPublished`, liste uçları
 *    `visibleCaseIds` / `activePublicationMap` kullanır.
 *
 * 3. **Hiçbir uç `include` kullanmaz; hepsi `select` ile alan alan yazılır.**
 *    Bu, "yeni eklenen alanın sessizce müvekkile gitmesi" hatasını yapısal
 *    olarak imkânsız kılar.
 *
 * ═══ PORTALIN ASLA GÖRMEDİĞİ VERİ ═══
 *
 *   CaseNote (dosya notları) · SmartNote · Strategy/StrategyNode/StrategyVersion ·
 *   RiskScore/RiskOverride/RiskScoreHistory · SimulationRun · Task/TaskStatusLog ·
 *   Deadline · CaseAnalysisReport · Claim/Evidence (delil matrisi) ·
 *   ExpertReport/ExpertObjection · ConflictCheck/ConflictHit ·
 *   Petition/PetitionVersion (dilekçe taslakları) · ChatSession/ChatMessage ·
 *   AiUsageLog · CreditWallet/CreditTransaction · FinancialEntry (büro içi masraf) ·
 *   TimeEntry · FeeAgreement · Document.ocrText / .aiSummary / .storageKey ·
 *   Hearing.note / .prepSummary · TimelineEvent.detail · Case.amount / .judgeName ·
 *   OutboundMessage.draftBody / .piiScanJson · başka müvekkillere ait HER ŞEY.
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly publications: PortalPublicationService,
    private readonly storage: StorageService,
    private readonly audit: PortalAuditService,
    // İki modül birbirini görür (portal → iletişim: gelen mesaj yazımı;
    // iletişim → portal: gönderilen mesajın yayın kaydı). Sağlayıcılar
    // arasında döngü YOKTUR; yalnız modül grafiği döngüseldir, bu yüzden
    // `forwardRef` modül düzeyinde yeterlidir.
    @Inject(forwardRef(() => InboundService))
    private readonly inbound: InboundService
  ) {}

  /* ================================================================== *
   * GET /portal/dashboard
   * ================================================================== */

  async dashboard(user: PortalAuthUser) {
    const caseIds = await this.publications.visibleCaseIds(user);

    const [cases, hearings, finance, messages] = await Promise.all([
      this.prisma.client.case.findMany({
        where: { id: { in: caseIds }, tenantId: user.tenantId, clientId: user.clientId },
        select: { id: true, status: true },
      }),
      this.upcomingHearings(user, caseIds, 3),
      this.financeSummary(user),
      this.messageSummary(user),
    ]);

    return {
      cases: {
        /** Yayınlanmış dosyaların toplamı — büronun dosya sayısı DEĞİLDİR. */
        total: cases.length,
        active: cases.filter((c) => !CLOSED_CASE_STATUSES.has(c.status)).length,
      },
      upcomingHearings: hearings,
      finance,
      messages,
    };
  }

  /* ================================================================== *
   * GET /portal/cases · GET /portal/cases/:id
   * ================================================================== */

  async listCases(user: PortalAuthUser) {
    const publications = await this.publications.activePublicationMap(user, "DOSYA");
    if (publications.size === 0) return { items: [], total: 0 };

    const rows = await this.prisma.client.case.findMany({
      where: {
        id: { in: [...publications.keys()] },
        tenantId: user.tenantId,
        clientId: user.clientId,
      },
      select: PORTAL_CASE_SELECT,
      orderBy: { openedAt: "desc" },
    });

    // Duruşma tarihi, Case.nextHearingAt DENORMALİNDEN OKUNMAZ: o alan
    // yayınlanmamış duruşmaları da yansıtır ve müvekkile görmemesi gereken
    // bir tarihi sızdırırdı. Tarih, YAYINLANMIŞ duruşmalardan hesaplanır.
    const nextHearing = await this.nextPublishedHearingByCase(
      user,
      rows.map((row) => row.id)
    );

    const items = rows.map((row) => ({
      ...row,
      publishedAt: publications.get(row.id)?.publishedAt ?? null,
      /** Avukatın yayın notu — müvekkile gösterilen sade açıklama. */
      publicationNote: publications.get(row.id)?.note ?? null,
      nextPublishedHearingAt: nextHearing.get(row.id) ?? null,
    }));
    return { items, total: items.length };
  }

  async caseDetail(user: PortalAuthUser, caseId: string) {
    const publication = await this.publications.assertPublished(user, "DOSYA", caseId);

    const record = await this.prisma.client.case.findFirst({
      where: { id: caseId, tenantId: user.tenantId, clientId: user.clientId },
      select: PORTAL_CASE_SELECT,
    });
    // Yayın kaydı var ama dosya yoksa/başkasınınsa: aynı 404.
    if (!record) throw new NotFoundException("Kayıt bulunamadı.");

    const [documents, hearings, timeline] = await Promise.all([
      this.listDocuments(user, caseId),
      this.listHearings(user, caseId),
      this.timeline(user, caseId),
    ]);

    return {
      ...record,
      publishedAt: publication.publishedAt,
      publicationNote: publication.note,
      documents: documents.items,
      hearings: hearings.items,
      timeline: timeline.items,
    };
  }

  /* ================================================================== *
   * GET /portal/documents · GET /portal/documents/:id/download
   * ================================================================== */

  async listDocuments(user: PortalAuthUser, caseId?: string) {
    const publications = await this.publications.activePublicationMap(user, "BELGE");
    if (publications.size === 0) return { items: [], total: 0 };

    // CASCADE (spec §İş Kuralları 3): belge, ancak bağlı dosyası da yayındaysa
    // görünür. Dosyası olmayan belge, avukatın açık yayın kararıyla görünür.
    const visibleCaseIds = await this.publications.visibleCaseIds(user);
    if (caseId && !visibleCaseIds.includes(caseId)) {
      throw new NotFoundException("Kayıt bulunamadı.");
    }

    const rows = await this.prisma.client.document.findMany({
      where: {
        id: { in: [...publications.keys()] },
        tenantId: user.tenantId,
        deletedAt: null,
        ...(caseId
          ? { caseId }
          : { OR: [{ caseId: { in: visibleCaseIds } }, { caseId: null }] }),
      },
      select: PORTAL_DOCUMENT_SELECT,
      orderBy: { createdAt: "desc" },
    });

    const items = rows.map((row) => ({
      ...row,
      publishedAt: publications.get(row.id)?.publishedAt ?? null,
      publicationNote: publications.get(row.id)?.note ?? null,
    }));
    return { items, total: items.length };
  }

  /**
   * Ön-imzalı indirme bağlantısı — KISA ÖMÜRLÜ (120 sn).
   *
   * Bağlantı, S3 imzasıyla korunur ve süresi dolduğunda ölür. Kısa TTL
   * bilinçlidir: bağlantı paylaşılabilir bir nesnedir; müvekkilin sekmesinden
   * kopyalanan bir URL'in saatlerce yaşaması, yayın kararını anlamsız kılardı.
   */
  async downloadDocument(user: PortalAuthUser, documentId: string) {
    await this.publications.assertPublished(user, "BELGE", documentId);

    const document = await this.prisma.client.document.findFirst({
      where: { id: documentId, tenantId: user.tenantId, deletedAt: null },
      select: { id: true, name: true, storageKey: true, mimeType: true },
    });
    if (!document) throw new NotFoundException("Kayıt bulunamadı.");

    const url = await this.storage.getPresignedDownloadUrl(
      document.storageKey,
      PORTAL_DOWNLOAD_TTL_SECONDS,
      document.name
    );

    // İndirme, portalın en hassas eylemidir; kendi denetim satırını yazar
    // (interceptor'ın jenerik kaydına ek olarak, kaynak türüyle birlikte).
    await this.audit.log({
      tenantId: user.tenantId,
      portalUserId: user.portalUserId,
      action: "PORTAL_DOCUMENT_DOWNLOAD",
      resourceType: "Document",
      resourceId: document.id,
      ipAddress: user.ip,
    });

    return {
      url,
      expiresIn: PORTAL_DOWNLOAD_TTL_SECONDS,
      name: document.name,
      mimeType: document.mimeType,
    };
  }

  /* ================================================================== *
   * GET /portal/hearings
   * ================================================================== */

  async listHearings(user: PortalAuthUser, caseId?: string) {
    const publications = await this.publications.activePublicationMap(user, "DURUSMA");
    if (publications.size === 0) return { items: [], total: 0 };

    const visibleCaseIds = await this.publications.visibleCaseIds(user);
    if (caseId && !visibleCaseIds.includes(caseId)) {
      throw new NotFoundException("Kayıt bulunamadı.");
    }

    const rows = await this.prisma.client.hearing.findMany({
      where: {
        id: { in: [...publications.keys()] },
        tenantId: user.tenantId,
        caseId: caseId ? caseId : { in: visibleCaseIds },
      },
      select: PORTAL_HEARING_SELECT,
      orderBy: { date: "asc" },
    });

    const items = rows.map((row) => ({
      ...row,
      /**
       * Duruşma sonucu, `Hearing.note` (ara karar) ya da `prepSummary`
       * (büro içi hazırlık notu) alanlarından OKUNMAZ — ikisi de iç kayıttır.
       * Müvekkile gösterilen metin YALNIZCA avukatın yayın notudur.
       */
      publicationNote: publications.get(row.id)?.note ?? null,
    }));
    return { items, total: items.length };
  }

  /* ================================================================== *
   * GET /portal/timeline?caseId=
   * ================================================================== */

  async timeline(user: PortalAuthUser, caseId?: string) {
    const publications = await this.publications.activePublicationMap(user, "SAFAHAT_KAYDI");
    if (publications.size === 0) return { items: [], total: 0 };

    const visibleCaseIds = await this.publications.visibleCaseIds(user);
    if (caseId && !visibleCaseIds.includes(caseId)) {
      throw new NotFoundException("Kayıt bulunamadı.");
    }

    const rows = await this.prisma.client.timelineEvent.findMany({
      where: {
        id: { in: [...publications.keys()] },
        tenantId: user.tenantId,
        caseId: caseId ? caseId : { in: visibleCaseIds },
      },
      // `detail` ALINMAZ: safahat ayrıntısı büro içi teknik nottur.
      select: PORTAL_TIMELINE_SELECT,
      orderBy: { date: "desc" },
    });

    const items = rows.map((row) => ({
      id: row.id,
      caseId: row.caseId,
      date: row.date,
      /**
       * DONDURULMUŞ METİN (spec §İş Kuralları 4): avukatın onaylayıp
       * yayınladığı sade açıklama `PortalPublication.note`'ta durur. Kaynak
       * safahat kaydı sonradan değişse bile müvekkilin gördüğü metin sabittir.
       * Not yoksa kaydın başlığı gösterilir — ayrıntısı ASLA.
       */
      summary: publications.get(row.id)?.note ?? row.title,
    }));
    return { items, total: items.length };
  }

  /* ================================================================== *
   * GET /portal/invoices · GET /portal/payments
   * ================================================================== */

  async listInvoices(user: PortalAuthUser) {
    const publications = await this.publications.activePublicationMap(user, "FATURA");
    if (publications.size === 0) return { items: [], total: 0 };

    const rows = await this.prisma.client.invoice.findMany({
      where: {
        id: { in: [...publications.keys()] },
        tenantId: user.tenantId,
        clientId: user.clientId,
        // TASLAK ve IPTAL fatura, yayınlanmış olsa bile gösterilmez: taslak
        // henüz kesilmemiş bir belgedir, iptal edilen ise borç doğurmaz.
        // Yanlışlıkla yapılmış bir yayın kararı burada da elenir.
        status: { notIn: ["TASLAK", "IPTAL"] },
      },
      select: PORTAL_INVOICE_SELECT,
      orderBy: { issueDate: "desc" },
    });
    return { items: rows, total: rows.length };
  }

  async listPayments(user: PortalAuthUser) {
    const publications = await this.publications.activePublicationMap(user, "ODEME");
    if (publications.size === 0) return { items: [], total: 0 };

    const rows = await this.prisma.client.payment.findMany({
      where: {
        id: { in: [...publications.keys()] },
        tenantId: user.tenantId,
        clientId: user.clientId,
      },
      select: PORTAL_PAYMENT_SELECT,
      orderBy: { date: "desc" },
    });
    return { items: rows, total: rows.length };
  }

  /* ================================================================== *
   * GET /portal/messages · POST /portal/messages
   * ================================================================== */

  /**
   * Mesaj dizisi: müvekkilin portaldan yazdıkları + büronun ona GÖNDERDİKLERİ.
   *
   * ╔══════════════════════════════════════════════════════════════════════╗
   * ║ GİDEN MESAJIN TEK GÖRÜNÜRLÜK KAYNAĞI: MESAJ TİPİNDE YAYIN KAYDI      ║
   * ╚══════════════════════════════════════════════════════════════════════╝
   *
   * Burada eskiden bir istisna vardı: `OR: [{ channel: "PORTAL" }, ...]`.
   * "Portal kanalından gönderilmiş olmak" tek başına görünürlük sayılıyordu ve
   * o dal HİÇBİR yayın kaydı aramıyordu. İki sonucu vardı:
   *
   *   1. "Portal görünürlüğünün tek kaynağı allow-list'tir" kuralının tek
   *      istisnasıydı — yani kural iki ayrı yerde yorumlanıyordu.
   *   2. YANLIŞ GÖNDERİLMİŞ BİR MESAJ GERİ ÇEKİLEMİYORDU. Yayın kaydı hiç
   *      açılmadığı için kaldırılacak satır yoktu; elle bir MESAJ yayını açılıp
   *      kaldırılsa bile `OR`'un ilk şıkkı eşleşmeye devam ediyordu.
   *
   * Artık gönderim anında gerçek bir `PortalPublication` satırı açılır
   * (`OutboundService.send` → `PortalPublicationService.publishOutboundMessage`)
   * ve bu liste YALNIZCA o satırlara bakar. `DELETE /portal-admin/publications/:id`
   * mesajı portaldan gerçekten kaldırır.
   *
   * TASLAK METİN (`draftBody`) HİÇBİR KOŞULDA DÖNMEZ: o, AI'ın/şablonun
   * önerisidir ve avukatın onayladığı metinden farklı olabilir. Müvekkil
   * yalnızca gönderilen metni (`finalBody`) görür.
   */
  async listMessages(user: PortalAuthUser) {
    const publishedMessageIds = [
      ...(await this.publications.activePublicationMap(user, "MESAJ")).keys(),
    ];

    const [outbound, inbound, visibleCaseIds] = await Promise.all([
      publishedMessageIds.length === 0
        ? Promise.resolve([])
        : this.prisma.client.outboundMessage.findMany({
            where: {
              tenantId: user.tenantId,
              clientId: user.clientId,
              status: "GONDERILDI",
              // approvedBy dolmadan gönderim yapılamaz; yine de açıkça süzülür.
              NOT: { approvedBy: null },
              id: { in: publishedMessageIds },
            },
            select: PORTAL_OUTBOUND_SELECT,
            orderBy: { sentAt: "desc" },
            take: 200,
          }),
      this.prisma.client.inboundMessage.findMany({
        where: {
          tenantId: user.tenantId,
          clientId: user.clientId,
          channel: "PORTAL",
        },
        select: PORTAL_INBOUND_SELECT,
        orderBy: { receivedAt: "desc" },
        take: 200,
      }),
      this.publications.visibleCaseIds(user),
    ]);

    /**
     * DOSYA KİMLİĞİ DE ALLOW-LIST'E TABİDİR (denetim bulgusu 5).
     *
     * Mesajın `caseId`'si olduğu gibi dönüyordu; o dosyanın yayında olup
     * olmadığına bakılmıyordu. `POST /portal/messages` ucundaki `assertPublished`
     * müvekkilin yayınlanmamış bir dosyanın varlığını DOĞRULAMASINI engelliyor,
     * ama aynı bilgi bir mesaj üzerinden doğrudan sızıyordu. Düşük etkili
     * (yalnız UUID) ama kural tutarsızlığıydı; artık iki uç aynı kuralı okuyor.
     */
    const visibleCaseId = (caseId: string | null): string | null =>
      caseId && visibleCaseIds.includes(caseId) ? caseId : null;

    const items = [
      ...outbound.map((row) => ({
        id: row.id,
        direction: "BURODAN" as const,
        subject: row.subject,
        body: row.finalBody ?? "",
        caseId: visibleCaseId(row.caseId),
        at: row.sentAt,
      })),
      ...inbound.map((row) => ({
        id: row.id,
        direction: "BENDEN" as const,
        subject: row.subject,
        body: row.body,
        caseId: visibleCaseId(row.caseId),
        at: row.receivedAt,
      })),
    ].sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));

    return { items, total: items.length };
  }

  /**
   * Müvekkil mesaj yazar → büroda `InboundMessage` (channel = PORTAL) açılır.
   *
   * KAYIT İLETİŞİM MERKEZİ ÜZERİNDEN AÇILIR (denetim bulgusu 13). Önceden
   * portal doğrudan `inboundMessage.create` çağırıyordu ve İletişim Merkezi'nin
   * üç kazanımını boşa harcıyordu: (a) mükerrerlik imzası — çift gönderim iki
   * kayıt açıyordu, (b) deterministik esas-no eşleştirmesi — müvekkil
   * "2026/145 dosyamda…" yazsa bile mesaj dosyasız kalıyordu, (c) tek bir
   * yazma noktası. `InboundService`in `knownClientId` dalı zaten TAM BU
   * SENARYO İÇİN yazılmıştı.
   *
   * `useAi: false` GEÇİLİR: müvekkilin mesajı için dış sağlayıcıya çıkılmaz ve
   * kredi harcanmaz. `clientId` tahmin değildir — oturumun kendisinden gelir.
   * `matchStatus` deterministik bir eşleşme yoksa BEKLIYOR kalır; eşleştirme
   * kararı büro tarafındadır (İletişim Merkezi ortak kararı 5).
   */
  async createMessage(user: PortalAuthUser, input: PortalMessageInput) {
    if (input.caseId) {
      // Yayınlanmamış bir dosyanın id'si mesaja iliştirilemez: aksi hâlde
      // müvekkil, göremediği bir dosyanın varlığını doğrulayabilirdi.
      await this.publications.assertPublished(user, "DOSYA", input.caseId);
    }

    const created = await this.inbound.createFromPortal({
      tenantId: user.tenantId,
      clientId: user.clientId,
      fromRef: user.email,
      subject: input.subject ?? null,
      body: input.body,
      // Müvekkilin seçtiği dosya bir ÖNERİDİR; yayınlanmış olduğu yukarıda
      // doğrulanmıştır.
      caseId: input.caseId ?? null,
    });

    await this.audit.log({
      tenantId: user.tenantId,
      portalUserId: user.portalUserId,
      action: "PORTAL_MESSAGE_SENT",
      resourceType: "InboundMessage",
      resourceId: created.id,
      ipAddress: user.ip,
    });

    return {
      id: created.id,
      subject: created.subject,
      body: created.body,
      receivedAt: created.receivedAt,
      // Dosya kimliği yine allow-list'ten geçer: deterministik eşleştirme
      // müvekkilin GÖREMEDİĞİ bir dosyayı bulmuş olabilir.
      caseId:
        created.caseId && (await this.publications.visibleCaseIds(user)).includes(created.caseId)
          ? created.caseId
          : null,
      direction: "BENDEN" as const,
      duplicate: created.duplicate,
      message: created.duplicate
        ? "Bu mesaj daha önce iletilmişti; yeniden gönderilmedi."
        : "Mesajınız avukatınıza iletildi.",
    };
  }

  /* ================================================================== *
   * GET /portal/lawyer
   * ================================================================== */

  /**
   * Sorumlu avukat kartı — YALNIZCA İŞ İLETİŞİMİ.
   *
   * Görünen dosyaların sorumlu kullanıcıları döner. `User.phone` alanı ŞEMADA
   * YOKTUR; olmayan bir veri uydurulmaz, alan hiç dönmez. Büro telefonunun
   * gösterilmesi gerekirse önce `Tenant`/`User` şemasına eklenmelidir.
   *
   * `role` ve `isActive` gibi büro içi alanlar dönmez: müvekkilin avukatının
   * büro içindeki rolünü bilmesi gerekmez.
   */
  async lawyer(user: PortalAuthUser) {
    const caseIds = await this.publications.visibleCaseIds(user);
    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: user.tenantId },
      select: { name: true },
    });

    if (caseIds.length === 0) {
      return { officeName: tenant?.name ?? null, lawyers: [] };
    }

    const rows = await this.prisma.client.case.findMany({
      where: {
        id: { in: caseIds },
        tenantId: user.tenantId,
        clientId: user.clientId,
        responsibleUserId: { not: null },
      },
      select: {
        id: true,
        title: true,
        fileNumber: true,
        responsibleUser: {
          select: { id: true, fullName: true, email: true, barNumber: true, isActive: true },
        },
      },
    });

    const byLawyer = new Map<
      string,
      { id: string; fullName: string; email: string; barNumber: string | null; cases: string[] }
    >();
    for (const row of rows) {
      const lawyer = row.responsibleUser;
      if (!lawyer || !lawyer.isActive) continue;
      const entry = byLawyer.get(lawyer.id) ?? {
        id: lawyer.id,
        fullName: lawyer.fullName,
        email: lawyer.email,
        barNumber: lawyer.barNumber,
        cases: [],
      };
      entry.cases.push(row.fileNumber ?? row.title);
      byLawyer.set(lawyer.id, entry);
    }

    return { officeName: tenant?.name ?? null, lawyers: [...byLawyer.values()] };
  }

  /* ================================================================== *
   * Yardımcılar
   * ================================================================== */

  /** Yayınlanmış duruşmalar arasından, dosya başına en yakın gelecek tarih. */
  private async nextPublishedHearingByCase(
    user: PortalAuthUser,
    caseIds: string[]
  ): Promise<Map<string, Date>> {
    if (caseIds.length === 0) return new Map();
    const publications = await this.publications.activePublicationMap(user, "DURUSMA");
    if (publications.size === 0) return new Map();

    const rows = await this.prisma.client.hearing.findMany({
      where: {
        id: { in: [...publications.keys()] },
        tenantId: user.tenantId,
        caseId: { in: caseIds },
        date: { gte: new Date() },
        status: { in: ["PLANLANDI", "ERTELENDI"] },
      },
      select: { caseId: true, date: true },
      orderBy: { date: "asc" },
    });

    const map = new Map<string, Date>();
    for (const row of rows) {
      if (!map.has(row.caseId)) map.set(row.caseId, row.date);
    }
    return map;
  }

  private async upcomingHearings(user: PortalAuthUser, caseIds: string[], take: number) {
    if (caseIds.length === 0) return [];
    const publications = await this.publications.activePublicationMap(user, "DURUSMA");
    if (publications.size === 0) return [];

    const rows = await this.prisma.client.hearing.findMany({
      where: {
        id: { in: [...publications.keys()] },
        tenantId: user.tenantId,
        caseId: { in: caseIds },
        date: { gte: new Date() },
        status: { in: ["PLANLANDI", "ERTELENDI"] },
      },
      select: PORTAL_HEARING_SELECT,
      orderBy: { date: "asc" },
      take,
    });
    return rows.map((row) => ({
      ...row,
      publicationNote: publications.get(row.id)?.note ?? null,
    }));
  }

  /**
   * Finans özeti — YALNIZCA YAYINLANMIŞ kalemler üzerinden.
   *
   * Para aritmetiği `Prisma.Decimal` ile yapılır; JS `number` toplaması
   * kuruş kaybettirir ve müvekkile gösterilen bakiyede kuruş hatası kabul
   * edilemez (ürün ilkesi: para hesapları DETERMİNİSTİK).
   *
   * DİKKAT: bakiye, büronun defterindeki gerçek bakiye DEĞİLDİR; yayınlanmış
   * fatura ve tahsilatların farkıdır. Yanıt bunu açıkça bildirir ki arayüz
   * "toplam borcunuz" gibi yanıltıcı bir başlık kullanmasın.
   */
  private async financeSummary(user: PortalAuthUser) {
    const [invoices, payments] = await Promise.all([
      this.listInvoices(user),
      this.listPayments(user),
    ]);

    const invoiceTotal = invoices.items.reduce(
      (sum, row) => sum.add(row.total),
      new Prisma.Decimal(0)
    );
    const paymentTotal = payments.items.reduce(
      (sum, row) => sum.add(row.amount),
      new Prisma.Decimal(0)
    );

    return {
      publishedInvoiceCount: invoices.total,
      publishedPaymentCount: payments.total,
      invoiceTotal: invoiceTotal.toFixed(2),
      paymentTotal: paymentTotal.toFixed(2),
      openBalance: invoiceTotal.sub(paymentTotal).toFixed(2),
      currency: invoices.items[0]?.currency ?? "TRY",
      /** Kapsam uyarısı — arayüz bunu kullanıcıya göstermelidir. */
      scope: "Yalnızca portala yayınlanmış fatura ve tahsilatları kapsar.",
    };
  }

  /**
   * Mesaj özeti.
   *
   * "OKUNMAMIŞ MESAJ SAYISI" ÜRETİLMEZ: `OutboundMessage`/`InboundMessage`
   * şemasında okundu bilgisi (readAt) YOKTUR. Olmayan bir veriden sayı
   * uydurmak yerine, alanın desteklenmediği açıkça bildirilir. Okundu takibi
   * istenirse şemaya `PortalMessageRead` benzeri bir kayıt eklenmelidir.
   */
  private async messageSummary(user: PortalAuthUser) {
    const messages = await this.listMessages(user);
    const lastFromOffice = messages.items.find((row) => row.direction === "BURODAN");
    return {
      total: messages.total,
      lastMessageAt: messages.items[0]?.at ?? null,
      lastFromOfficeAt: lastFromOffice?.at ?? null,
      unreadTrackingAvailable: false,
    };
  }
}

/** "Aktif dosya" sayımında hariç tutulan durumlar. */
const CLOSED_CASE_STATUSES: ReadonlySet<string> = new Set(["KAPANDI", "ARSIV"]);
