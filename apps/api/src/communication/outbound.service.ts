/**
 * GİDEN MESAJ — İNSAN ONAYININ ZORLANDIĞI YER.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ TEK CÜMLELİK SÖZLEŞME:                                                   ║
 * ║   AI/şablon taslak yazar → AVUKAT onaylar → sistem gönderir.             ║
 * ║   `approvedBy` boşken gönderim YOKTUR (HTTP 409).                        ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ONAY NASIL ZORLANIYOR — dört ayrı kapı, biri delinse diğerleri tutar:
 *
 *  1. DURUM KAPISI. `send()` yalnız `status === ONAYLANDI` iken çalışır.
 *  2. KİMLİK KAPISI. `approvedBy` null ise 409 — durum sütunu elle
 *     kurcalansa bile (veri taşıma, hatalı betik) gönderim geçmez. Bu kontrol
 *     durum kontrolünden AYRI tutulmuştur; ikisi aynı `if` olsaydı tek bir
 *     hatalı UPDATE ikisini birden atlatırdı.
 *  3. DÜZENLEME KAPISI. Onaylanmış bir mesaj düzenlenirse ONAY DÜŞER
 *     (`approvedBy = null`, durum → TASLAK). Aksi hâlde "onaylat, sonra metni
 *     değiştir, sonra gönder" ile onay makinesi tamamen anlamsızlaşırdı.
 *  4. ROL KAPISI. Onay yetkisi AVUKAT ve üstündedir; SEKRETER taslak
 *     hazırlayabilir, onaylayamaz (Modül 19 iş kuralı 2 + kabul kriteri 7).
 *
 * Ayrıca `finalBody` boşken gönderim yapılmaz: gönderilen metin daima açıkça
 * onaylanmış metindir, "taslağın kendisi" değil.
 */

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  forwardRef,
} from "@nestjs/common";
import { scanPii } from "@nomosos/ai";
import type { OutboundMessage, Prisma } from "@nomosos/db";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { paged, resolvePage } from "../common/pagination";
import { ROLE_SETS, assertRole } from "../common/roles";
import type { AuthUser } from "../common/types";
import { PortalPublicationService } from "../portal/portal-publication.service";
import { ChannelNotConfiguredError, ChannelProviderRegistry } from "./channel-providers";
import { CommunicationService } from "./communication.service";
import { MessageTemplateService } from "./message-templates.service";
import { OutboundAiService } from "./outbound-ai.service";
import { classifyOutboundPii, type PiiClassification } from "./pii-classify";
import type {
  ApproveOutboundInput,
  CreateOutboundInput,
  RejectOutboundInput,
  SendOutboundInput,
  UpdateOutboundInput,
} from "./communication.dto";

/** Metnin hâlâ düzenlenebilir olduğu durumlar. */
const EDITABLE_STATUSES = ["TASLAK", "ONAY_BEKLIYOR", "ONAYLANDI"] as const;

@Injectable()
export class OutboundService {
  private readonly logger = new Logger(OutboundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly communication: CommunicationService,
    private readonly templates: MessageTemplateService,
    private readonly ai: OutboundAiService,
    private readonly channels: ChannelProviderRegistry,
    // Portal görünürlüğü bu servisin kararı DEĞİLDİR; kararı yazan tek yer
    // portal modülüdür (bkz. publishOutboundMessage).
    @Inject(forwardRef(() => PortalPublicationService))
    private readonly portalPublications: PortalPublicationService,
  ) {}

  /* ---------------------------------------------------------------- *
   * Okuma
   * ---------------------------------------------------------------- */

  async list(
    user: AuthUser,
    query: { status?: string; clientId?: string; caseId?: string; channel?: string; page?: string; limit?: string },
  ) {
    const page = resolvePage(query);
    const where: Prisma.OutboundMessageWhereInput = {
      tenantId: user.tenantId,
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.clientId ? { clientId: query.clientId } : {}),
      ...(query.caseId ? { caseId: query.caseId } : {}),
      ...(query.channel ? { channel: query.channel as never } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.client.outboundMessage.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.take,
        include: {
          client: { select: { id: true, name: true } },
          case: { select: { id: true, title: true, fileNumber: true } },
          template: { select: { id: true, key: true, name: true } },
        },
      }),
      this.prisma.client.outboundMessage.count({ where }),
    ]);
    return paged(items.map((m) => this.decorate(m)), total, page);
  }

  /** Onay kuyruğu — büro adına çıkacak her metnin toplandığı tek yer. */
  async approvalQueue(user: AuthUser, query: { page?: string; limit?: string }) {
    const page = resolvePage(query);
    const where: Prisma.OutboundMessageWhereInput = {
      tenantId: user.tenantId,
      status: { in: ["TASLAK", "ONAY_BEKLIYOR"] },
    };
    const [items, total] = await Promise.all([
      this.prisma.client.outboundMessage.findMany({
        where,
        orderBy: { createdAt: "asc" },
        skip: page.skip,
        take: page.take,
        include: {
          client: { select: { id: true, name: true } },
          case: { select: { id: true, title: true, fileNumber: true } },
        },
      }),
      this.prisma.client.outboundMessage.count({ where }),
    ]);
    return paged(items.map((m) => this.decorate(m)), total, page);
  }

  async detail(user: AuthUser, id: string) {
    return this.decorate(await this.require(user, id));
  }

  private async require(user: AuthUser, id: string): Promise<OutboundMessage> {
    const found = await this.prisma.client.outboundMessage.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!found) throw new NotFoundException("Giden mesaj bulunamadı.");
    return found;
  }

  /** Kayda, gönderilebilirlik durumunu açıkça yazan bir zarf ekler. */
  private decorate<T extends OutboundMessage>(message: T) {
    const blockers: string[] = [];
    if (message.status === "GONDERILDI") blockers.push("Mesaj zaten gönderildi.");
    if (message.status === "IPTAL") blockers.push("Mesaj iptal edildi.");
    if (!message.approvedBy) blockers.push("Mesaj henüz onaylanmadı.");
    if (!message.finalBody) blockers.push("Onaylanmış nihai metin yok.");

    return {
      ...message,
      piiScan: message.piiScanJson ? safeParse(message.piiScanJson) : null,
      canSend: blockers.length === 0,
      sendBlockers: blockers,
      /** Onay ekranı diff'i: solda AI/şablon önerisi, sağda gönderilecek metin. */
      diff: { draftBody: message.draftBody, finalBody: message.finalBody },
    };
  }

  /* ---------------------------------------------------------------- *
   * Oluşturma
   * ---------------------------------------------------------------- */

  /**
   * Taslak oluşturur. ÜÇ KAYNAK: şablon, elle metin, AI.
   *
   * Hangi kaynaktan gelirse gelsin sonuç aynıdır: `status = TASLAK`,
   * `approvedBy = null`. AI taslağının ayrıcalığı yoktur.
   */
  async create(user: AuthUser, input: CreateOutboundInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "giden mesaj taslağı oluşturma");

    const client = await this.communication.requireClient(user.tenantId, input.clientId);
    if (input.caseId) await this.communication.requireCase(user.tenantId, input.caseId, client.id);

    let draftBody: string;
    let subject: string | null = input.subject ?? null;
    let source: "AI" | "SABLON" | "ELLE";
    let aiMeta: Record<string, unknown> | null = null;

    if (input.useAi) {
      // `caseId` zorunluluğu DTO'da zorlanır (dosya bağlamsız özet yazılmaz).
      const drafted = await this.ai.draft(user, {
        clientName: client.name,
        clientId: client.id,
        caseId: input.caseId as string,
        channel: input.channel,
        instruction: input.instruction,
        piiApproved: input.piiApproved,
      });
      draftBody = drafted.body;
      aiMeta = { ...drafted.meta, glossary: drafted.glossary, nextStepForClient: drafted.nextStepForClient };
      source = "AI";
    } else if (input.templateId) {
      const template = await this.templates.requireTemplate(user, input.templateId);
      const rendered = await this.templates.render(user, template, {
        clientId: client.id,
        caseId: input.caseId ?? null,
        variables: input.variables,
      });
      draftBody = rendered.body;
      subject = subject ?? rendered.subject;
      source = "SABLON";
    } else {
      draftBody = (input.draftBody as string).trim();
      source = "ELLE";
    }

    const created = await this.prisma.client.outboundMessage.create({
      data: {
        tenantId: user.tenantId,
        clientId: client.id,
        caseId: input.caseId ?? null,
        channel: input.channel,
        templateId: input.templateId ?? null,
        subject,
        draftBody,
        // finalBody BİLEREK BOŞ: onay anında, avukatın gördüğü metin yazılır.
        finalBody: null,
        status: "TASLAK",
        createdBy: user.userId,
      },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "OUTBOUND_DRAFT_CREATE",
      entity: "OutboundMessage",
      entityId: created.id,
      detail: `kaynak=${source} kanal=${created.channel}`,
    });

    return { ...this.decorate(created), source, ai: aiMeta };
  }

  /* ---------------------------------------------------------------- *
   * Düzenleme ve onay
   * ---------------------------------------------------------------- */

  /**
   * Avukat metni düzenler → `finalBody`.
   *
   * `draftBody`'YE DOKUNULMAZ (iş kuralı 3). ONAYLANMIŞ bir mesaj düzenlenirse
   * onay DÜŞER: onaylanan metin ile gönderilecek metin farklılaşamaz.
   */
  async update(user: AuthUser, id: string, input: UpdateOutboundInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "giden mesaj düzenleme");
    const message = await this.require(user, id);
    this.assertEditable(message);

    const approvalDropped = message.status === "ONAYLANDI";

    const updated = await this.prisma.client.outboundMessage.update({
      where: { id: message.id },
      data: {
        ...(input.finalBody !== undefined ? { finalBody: input.finalBody } : {}),
        ...(input.subject !== undefined ? { subject: input.subject } : {}),
        ...(approvalDropped
          ? { status: "TASLAK", approvedBy: null, approvedAt: null, piiScanJson: null }
          : {}),
      },
    });

    if (approvalDropped) {
      await this.audit.log({
        tenantId: user.tenantId,
        userId: user.userId,
        action: "OUTBOUND_APPROVAL_REVOKED",
        entity: "OutboundMessage",
        entityId: id,
        detail: "Metin onaydan sonra düzenlendi; onay düşürüldü ve yeniden onay gerekiyor.",
      });
    }

    return {
      ...this.decorate(updated),
      ...(approvalDropped
        ? {
            warning:
              "Metin değiştirildiği için ÖNCEKİ ONAY DÜŞÜRÜLDÜ. Mesajın gönderilebilmesi için " +
              "yeniden onaylanması gerekir.",
          }
        : {}),
    };
  }

  /** Taslağı onay kuyruğuna sunar (sekreter → avukat). */
  async submit(user: AuthUser, id: string) {
    assertRole(user, ROLE_SETS.OPERASYON, "giden mesajı onaya sunma");
    const message = await this.require(user, id);
    if (message.status !== "TASLAK") {
      throw new ConflictException(
        `Yalnızca TASLAK durumundaki mesaj onaya sunulabilir (mevcut durum: ${message.status}).`,
      );
    }
    const updated = await this.prisma.client.outboundMessage.update({
      where: { id: message.id },
      data: { status: "ONAY_BEKLIYOR" },
    });
    return this.decorate(updated);
  }

  /**
   * ONAY — `approvedBy` burada, YALNIZCA burada dolar.
   *
   * Onaydan önce KVKK taraması yapılır ve sonucu `piiScanJson`'a yazılır. Üçüncü
   * kişi kişisel verisi bulunursa onay ENGELLENİR (409); avukat devam etmek
   * isterse `piiApproved: true` + `piiOverrideNote` ile gerekçesini yazar ve bu
   * gerekçe AuditLog'a geçer (kabul kriteri 8).
   */
  async approve(user: AuthUser, id: string, input: ApproveOutboundInput) {
    // ONAY YETKİSİ AVUKAT VE ÜSTÜ. Sekreter taslak hazırlar, onaylayamaz.
    assertRole(user, ROLE_SETS.HUKUKI, "giden mesaj onaylama");
    const message = await this.require(user, id);

    if (message.status === "GONDERILDI") {
      throw new ConflictException("Gönderilmiş mesaj yeniden onaylanamaz.");
    }
    if (message.status === "IPTAL") {
      throw new ConflictException("İptal edilmiş mesaj onaylanamaz.");
    }

    // Onaylanan metin belirsiz kalamaz: düzenlenmemişse taslağın kendisi
    // onaylanır ve `finalBody`'ye AÇIKÇA yazılır.
    const finalBody = (message.finalBody ?? message.draftBody).trim();
    if (finalBody.length === 0) {
      throw new BadRequestException("Boş metin onaylanamaz.");
    }

    // ── ÇÖZÜLMEMİŞ YER TUTUCU KAPISI (Modül 19 kabul kriteri 9) ────────────
    // Bu denetim YALNIZCA arayüzde vardı; şablon yolunda sunucu ayrıca
    // `missingPlaceholders` ile 400 döndüğü için risk düşüktü, ama AI/elle
    // taslakta ya da API'nin doğrudan çağrılmasında müvekkile ham "{{dosyaNo}}"
    // gidebiliyordu. Kural artık sunucuda da karşılığını buluyor.
    const unresolved = findUnresolvedPlaceholders(finalBody, message.subject);
    if (unresolved.length > 0) {
      throw new BadRequestException(
        `Metinde çözülmemiş değişken kaldı: ${unresolved.join(", ")}. ` +
          "Müvekkile ham yer tutucu gönderilemez; değişkenleri doldurup tekrar deneyin.",
      );
    }

    const scan = await this.scanForRecipient(user.tenantId, message.clientId, finalBody, message.subject);
    if (scan.thirdParty.length > 0 && input.piiApproved !== true) {
      throw new ConflictException({
        requiresPiiApproval: true,
        reasonCode: "UCUNCU_KISI_KISISEL_VERI",
        findings: scan.thirdParty,
        message:
          "Gönderilecek metinde ALICIYA AİT OLMAYAN kişisel veri tespit edildi " +
          `(${scan.thirdParty.map((f) => `${f.kind}×${f.count}`).join(", ")}). ` +
          "Üçüncü kişinin kimlik/iletişim bilgisini müvekkile iletmek ayrı bir KVKK " +
          "değerlendirmesi gerektirir. Devam etmek istiyorsanız isteği `piiApproved: true` ve " +
          "`piiOverrideNote` (gerekçe) ile tekrarlayın.",
      });
    }
    if (scan.thirdParty.length > 0 && !input.piiOverrideNote?.trim()) {
      throw new BadRequestException(
        "Üçüncü kişi kişisel verisi içeren bir metni onaylamak için gerekçe (`piiOverrideNote`) " +
          "zorunludur; gerekçesiz karar denetim değeri taşımaz.",
      );
    }

    const updated = await this.prisma.client.outboundMessage.update({
      where: { id: message.id },
      data: {
        finalBody,
        status: "ONAYLANDI",
        approvedBy: user.userId,
        approvedAt: new Date(),
        piiScanJson: JSON.stringify(scan.summary),
      },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "OUTBOUND_APPROVE",
      entity: "OutboundMessage",
      entityId: id,
      detail:
        `kanal=${message.channel} uzunluk=${finalBody.length} ` +
        `ucuncuKisiPii=${scan.thirdParty.length > 0 ? "VAR" : "yok"}` +
        (scan.thirdParty.length > 0 ? ` gerekce=${input.piiOverrideNote?.trim()}` : ""),
    });

    return this.decorate(updated);
  }

  /** Reddet — gerekçe zorunludur, mesaj IPTAL olur ve metni korunur. */
  async reject(user: AuthUser, id: string, input: RejectOutboundInput) {
    assertRole(user, ROLE_SETS.HUKUKI, "giden mesaj reddetme");
    const message = await this.require(user, id);
    if (message.status === "GONDERILDI") {
      throw new ConflictException("Gönderilmiş mesaj reddedilemez.");
    }

    const updated = await this.prisma.client.outboundMessage.update({
      where: { id: message.id },
      data: {
        status: "IPTAL",
        approvedBy: null,
        approvedAt: null,
        failureReason: `Reddedildi: ${input.reason}`,
      },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "OUTBOUND_REJECT",
      entity: "OutboundMessage",
      entityId: id,
      detail: input.reason,
    });
    return this.decorate(updated);
  }

  /* ---------------------------------------------------------------- *
   * Gönderim
   * ---------------------------------------------------------------- */

  /**
   * GÖNDERİM. Onay yoksa 409 — bu ucun tek gerçek işi budur.
   *
   * Sıra bilinçlidir: önce onay kapıları, sonra KVKK yeniden taraması, EN SON
   * sağlayıcı çağrısı. Sağlayıcıya, geçilmesi gereken her kapıdan geçmiş bir
   * metin dışında hiçbir şey ulaşmaz.
   */
  async send(user: AuthUser, id: string, input: SendOutboundInput) {
    assertRole(user, ROLE_SETS.HUKUKI, "giden mesaj gönderme");
    const message = await this.require(user, id);

    // --- KAPI 1: durum -----------------------------------------------------
    if (message.status === "GONDERILDI") {
      throw new ConflictException("Bu mesaj zaten gönderildi.");
    }
    if (message.status === "IPTAL") {
      throw new ConflictException("İptal edilmiş mesaj gönderilemez.");
    }

    // --- KAPI 2: onaylayan kimliği ----------------------------------------
    // DURUM KONTROLÜNDEN AYRI: durum sütunu elle değiştirilse bile burası tutar.
    if (!message.approvedBy || !message.approvedAt) {
      throw new ConflictException(
        "Bu mesaj onaylanmadan gönderilemez. Önce POST /outbound-messages/:id/approve ile " +
          "avukat onayı alınmalıdır.",
      );
    }
    if (message.status !== "ONAYLANDI") {
      throw new ConflictException(
        `Yalnızca ONAYLANDI durumundaki mesaj gönderilebilir (mevcut durum: ${message.status}).`,
      );
    }

    // --- KAPI 3: onaylanmış metin -----------------------------------------
    const body = message.finalBody?.trim();
    if (!body) {
      throw new ConflictException(
        "Onaylanmış nihai metin (finalBody) bulunamadı; gönderilecek metin belirsiz.",
      );
    }

    // --- KAPI 4: KVKK, GÖNDERİM ÖNCESİ YENİDEN --------------------------
    // Onaydan sonra metin değişmiş olamaz (düzenleme onayı düşürür), ama
    // müvekkil kaydı değişmiş olabilir: kayıtlı telefonu silinen bir müvekkilin
    // "kendi verisi" sayılan numarası artık üçüncü kişi verisidir.
    const scan = await this.scanForRecipient(user.tenantId, message.clientId, body, message.subject);
    if (scan.thirdParty.length > 0 && input.piiApproved !== true) {
      throw new ConflictException({
        requiresPiiApproval: true,
        reasonCode: "UCUNCU_KISI_KISISEL_VERI",
        findings: scan.thirdParty,
        message:
          "Gönderim öncesi taramada alıcıya ait olmayan kişisel veri tespit edildi. " +
          "Göndermek için `piiApproved: true` ve `piiOverrideNote` (gerekçe) gereklidir.",
      });
    }
    // İKİ KAPI SİMETRİK OLMALIDIR. `approve()` üçüncü kişi verisinde hem onay
    // hem GEREKÇE isterken, `send()` yalnızca onaya bakıyordu; denetim kaydına
    // `ucuncuKisiPiiGerekce=undefined` yazılabiliyordu. Üstelik bu kapı tam da
    // "onaydan sonra müvekkil kaydı değişti" durumu için konmuştu — yani
    // gerekçenin en çok gerektiği yerde gerekçesiz geçiliyordu.
    if (scan.thirdParty.length > 0 && !input.piiOverrideNote?.trim()) {
      throw new BadRequestException(
        "Üçüncü kişi kişisel verisi içeren bir metni göndermek için gerekçe " +
          "(`piiOverrideNote`) zorunludur; gerekçesiz karar denetim değeri taşımaz.",
      );
    }

    const recipient = await this.resolveRecipient(user.tenantId, message);

    // --- Sağlayıcı ---------------------------------------------------------
    const provider = this.channels.resolve(message.channel);
    let result;
    try {
      result = await provider.send({
        channel: message.channel,
        to: recipient,
        subject: message.subject,
        body,
        templateKey: null,
      });
    } catch (err) {
      return this.handleSendFailure(user, message, err, scan);
    }

    const sentAt = new Date();
    const [updated] = await this.prisma.client.$transaction([
      this.prisma.client.outboundMessage.update({
        where: { id: message.id },
        data: {
          status: "GONDERILDI",
          sentAt,
          providerRef: result.providerRef,
          failureReason: null,
          piiScanJson: JSON.stringify(scan.summary),
        },
      }),
      // Gönderilen mesaj İLETİŞİM GEÇMİŞİNE düşer: "müvekkile ne söylendi?"
      // sorusunun cevabı tek tabloda toplanır.
      this.prisma.client.communicationLog.create({
        data: {
          tenantId: user.tenantId,
          clientId: message.clientId,
          caseId: message.caseId,
          direction: "GIDEN",
          channel: message.channel,
          subject: message.subject,
          body,
          contactRef: recipient,
          occurredAt: sentAt,
          recordedBy: user.userId,
          // ── KAYNAK VE ONAY ZİNCİRİ (denetim bulgusu 9) ────────────────────
          // Bu iki alan olmadan, onay makinesinden geçip GERÇEKTEN gönderilmiş
          // bir mesaj ile bir kullanıcının elle düştüğü "gönderdim" notu tek
          // tabloda ayırt edilemiyordu. Yorumda vaat edilen "müvekkile ne
          // söylendi, kim onayladı?" sorusu ancak şimdi tek sorguyla
          // cevaplanabilir: `outboundMessageId` → `approvedBy`.
          source: "SISTEM",
          outboundMessageId: message.id,
        },
      }),
    ]);

    // ── PORTAL GÖRÜNÜRLÜĞÜ: KARARI ALLOW-LIST YAZAR ────────────────────────
    //
    // PORTAL kanalından gönderim, mesajı müvekkile açma kararının kendisidir —
    // ama bu karar bir YAYIN KAYDINA dönüşmeden portalda görünürlük üretmemeli.
    // Aksi hâlde (eski davranış) mesaj portalda görünüyor ama GERİ ÇEKİLEMİYORDU:
    // kaldırılacak bir satır yoktu. Kayıt burada açılır, `DELETE
    // /portal-admin/publications/:id` ile geri çekilir.
    //
    // Yayın kaydı yazılamazsa gönderim BOZULMAZ (mesaj gerçekten gitti); hata
    // günlüğe düşer ve avukat mesajı elle yayınlayabilir.
    if (message.channel === "PORTAL") {
      try {
        await this.portalPublications.publishOutboundMessage({
          tenantId: user.tenantId,
          clientId: message.clientId,
          outboundMessageId: message.id,
          // Sorumluluk ONAYLAYANDADIR: portal görünürlüğü, onaylanan metnin
          // müvekkile iletilmesi kararının doğrudan sonucudur.
          publishedBy: message.approvedBy,
        });
      } catch (err) {
        this.logger.error(
          `Portal yayın kaydı açılamadı (mesaj ${message.id}): ${(err as Error).message}. ` +
            "Mesaj gönderildi ancak portalda GÖRÜNMEYECEK; Portal Yönetimi ekranından elle yayınlayın.",
        );
      }
    }

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "OUTBOUND_SEND",
      entity: "OutboundMessage",
      entityId: id,
      detail:
        `kanal=${message.channel} saglayici=${provider.name} ref=${result.providerRef} ` +
        `onaylayan=${message.approvedBy}` +
        (scan.thirdParty.length > 0 ? ` ucuncuKisiPiiGerekce=${input.piiOverrideNote?.trim()}` : ""),
    });

    return { ...this.decorate(updated), provider: provider.name, providerNote: result.note ?? null };
  }

  /**
   * Gönderim hatası. İKİ FARKLI SONUÇ:
   *
   *   YAPILANDIRILMAMIŞ KANAL → mesaj ONAYLANDI kalır (yeniden gönderilebilir),
   *                             503 döner. Bu bir mesaj hatası değil, kurulum
   *                             eksikliğidir; onayı yakmak yanlış olurdu.
   *   DİĞER HATALAR           → BASARISIZ. Sessizce kaybolmaz: durum, gerekçe
   *                             ve denetim kaydı kalır (iş kuralı 7).
   */
  private async handleSendFailure(
    user: AuthUser,
    message: OutboundMessage,
    err: unknown,
    scan: PiiClassification,
  ): Promise<never> {
    const notConfigured = err instanceof ChannelNotConfiguredError;
    const reason = err instanceof Error ? err.message : "Bilinmeyen gönderim hatası.";

    await this.prisma.client.outboundMessage.update({
      where: { id: message.id },
      data: {
        ...(notConfigured ? {} : { status: "BASARISIZ" }),
        failureReason: reason.slice(0, 1000),
        piiScanJson: JSON.stringify(scan.summary),
      },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: notConfigured ? "OUTBOUND_SEND_NOT_CONFIGURED" : "OUTBOUND_SEND_FAILED",
      entity: "OutboundMessage",
      entityId: message.id,
      detail: reason.slice(0, 500),
    });

    if (notConfigured) {
      this.logger.warn(`Kanal yapılandırılmamış (${message.channel}): ${reason}`);
      throw new ServiceUnavailableException(reason);
    }
    this.logger.error(`Giden mesaj gönderilemedi (${message.id}): ${reason}`);
    throw new ServiceUnavailableException(
      `Mesaj gönderilemedi ve BAŞARISIZ olarak işaretlendi: ${reason}`,
    );
  }

  /* ---------------------------------------------------------------- *
   * Yardımcılar
   * ---------------------------------------------------------------- */

  private assertEditable(message: OutboundMessage): void {
    if (!(EDITABLE_STATUSES as readonly string[]).includes(message.status)) {
      throw new ConflictException(
        `Bu mesaj artık düzenlenemez (durum: ${message.status}). Gönderilmiş veya iptal edilmiş ` +
          "bir mesajın metni değiştirilemez; yeni bir taslak oluşturun.",
      );
    }
  }

  /**
   * Alıcı adresi — kanala göre müvekkil kaydından okunur.
   *
   * Adres bulunamazsa gönderim YAPILMAZ: "kime gittiği belirsiz" bir mesaj
   * göndermek, göndermemekten kötüdür.
   */
  private async resolveRecipient(tenantId: string, message: OutboundMessage): Promise<string> {
    const client = await this.communication.requireClient(tenantId, message.clientId);
    const address =
      message.channel === "EPOSTA"
        ? client.email
        : message.channel === "SMS" || message.channel === "WHATSAPP"
          ? client.phone
          : `portal:${client.id}`;

    if (!address) {
      throw new BadRequestException(
        message.channel === "EPOSTA"
          ? "Müvekkil kaydında e-posta adresi yok; e-posta gönderilemez."
          : "Müvekkil kaydında telefon numarası yok; SMS/WhatsApp gönderilemez.",
      );
    }
    return address;
  }

  /**
   * Giden metnin KVKK taraması + "kimin verisi" sınıflandırması.
   *
   * Müvekkilin KENDİ e-postası/telefonu/TCKN'si/IBAN'ı metinde geçebilir ve bu
   * olağandır. Riskli olan ÜÇÜNCÜ KİŞİ verisidir; ayrım burada yapılır.
   */
  private async scanForRecipient(
    tenantId: string,
    clientId: string,
    body: string,
    subject: string | null,
  ): Promise<PiiClassification> {
    const client = await this.communication.requireClient(tenantId, clientId);
    const contacts = await this.prisma.client.clientContact.findMany({
      where: { clientId },
      select: { email: true, phone: true },
    });

    const scan = scanPii(`${subject ?? ""}\n${body}`);
    return classifyOutboundPii(scan.findings, {
      emails: [client.email, ...contacts.map((c) => c.email)],
      phones: [client.phone, ...contacts.map((c) => c.phone)],
      tckns: [client.tckn],
      ibans: [client.iban],
    });
  }
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Metinde kalan `{{degisken}}` yer tutucuları (tekrarsız).
 *
 * Şablon motorunun çözemediği ya da elle yazılırken kopyalanan bir yer tutucu,
 * müvekkile "Sayın {{muvekkilAdi}}" diye bir mesaj gitmesi demektir. Kalıp
 * bilinçli olarak DARDIR (`{{ harf/rakam/_ }}`): metinde geçen matematiksel
 * ya da kod benzeri süslü parantezleri yer tutucu sanmamak için.
 */
function findUnresolvedPlaceholders(body: string, subject: string | null): string[] {
  const out: string[] = [];
  const re = /\{\{\s*[A-Za-z0-9_]+\s*\}\}/g;
  for (const text of [subject ?? "", body]) {
    for (const match of text.match(re) ?? []) {
      const normalized = match.replace(/\s+/g, "");
      if (!out.includes(normalized)) out.push(normalized);
    }
  }
  return out;
}
