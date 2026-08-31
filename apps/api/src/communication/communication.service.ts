/**
 * İLETİŞİM GEÇMİŞİ — birleşik kayıt ve zaman çizelgesi.
 *
 * `CommunicationLog` iki şeyi taşır:
 *   (a) İNSANIN NOT ETTİĞİ görüşmeler — telefon, yüz yüze, elden teslim.
 *   (b) SİSTEMİN GERÇEKTEN GÖNDERDİĞİ mesajlar (OutboundService, gönderim
 *       başarılı olduğunda yazar).
 *
 * Yazılmadığı yer de önemlidir: gönderilmemiş taslaklar buraya GİRMEZ. Bir
 * iletişim geçmişi, "olmuş" şeylerin kaydıdır; onay bekleyen bir taslağın
 * müvekkil geçmişinde görünmesi, avukatı "bunu göndermiştik" yanılgısına
 * düşürürdü. Taslaklar zaman çizelgesinde AYRI BİR TÜR olarak, açıkça
 * "gönderilmedi" etiketiyle görünür.
 */

import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { scanPii } from "@nomosos/ai";
import type { CommChannel, CommDirection, Prisma } from "@nomosos/db";
import { classifyOutboundPii } from "./pii-classify";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { parseDateParam, parseRangeEnd } from "../common/dates";
import { normalizeQuery, paged, resolvePage } from "../common/pagination";
import { ROLE_SETS, assertRole } from "../common/roles";
import type { AuthUser } from "../common/types";
import { COMM_CHANNELS, COMM_DIRECTIONS } from "./communication.dto";
import type { CreateCommunicationInput, UpdateCommunicationInput } from "./communication.dto";

export interface CommunicationListQuery {
  clientId?: string;
  caseId?: string;
  channel?: string;
  direction?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: string;
  limit?: string;
}

/** Sorgu parametresindeki kanal adını doğrular (geçersizse 400). */
function parseChannel(value: string | undefined): CommChannel | undefined {
  if (!value) return undefined;
  if (!(COMM_CHANNELS as readonly string[]).includes(value)) {
    throw new BadRequestException(`Geçersiz kanal: ${value}. Beklenen: ${COMM_CHANNELS.join(", ")}.`);
  }
  return value as CommChannel;
}

function parseDirection(value: string | undefined): CommDirection | undefined {
  if (!value) return undefined;
  if (!(COMM_DIRECTIONS as readonly string[]).includes(value)) {
    throw new BadRequestException(`Geçersiz yön: ${value}. Beklenen: ${COMM_DIRECTIONS.join(", ")}.`);
  }
  return value as CommDirection;
}

@Injectable()
export class CommunicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /* ---------------------------------------------------------------- *
   * Tenant süzgeçli varlık çözümü — modülün TÜM servisleri buradan geçer
   * ---------------------------------------------------------------- */

  /**
   * Müvekkilin bu büroya ait olduğunu doğrular.
   *
   * `findFirst({ id, tenantId })` — `findUnique({ id })` DEĞİL. Başka bir
   * büronun müvekkil kimliğiyle yapılan istek 404 alır, "yetkiniz yok" bile
   * demez: kaydın VARLIĞI da bilgi sızıntısıdır (kabul kriteri 10).
   */
  async requireClient(tenantId: string, clientId: string) {
    const client = await this.prisma.client.client.findFirst({
      where: { id: clientId, tenantId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        tckn: true,
        iban: true,
        isActive: true,
      },
    });
    if (!client) throw new NotFoundException("Müvekkil bulunamadı.");
    return client;
  }

  /** Dosyanın bu büroya ait olduğunu doğrular; müvekkil uyumu da denetlenir. */
  async requireCase(tenantId: string, caseId: string, expectedClientId?: string) {
    const found = await this.prisma.client.case.findFirst({
      where: { id: caseId, tenantId },
      select: {
        id: true,
        clientId: true,
        title: true,
        fileNumber: true,
        courtName: true,
        subject: true,
        type: true,
        status: true,
        amount: true,
        responsibleUserId: true,
      },
    });
    if (!found) throw new NotFoundException("Dosya bulunamadı.");
    if (expectedClientId && found.clientId !== expectedClientId) {
      throw new BadRequestException(
        "Seçilen dosya bu müvekkile ait değil. Mesaj yanlış müvekkilin dosyasına bağlanamaz.",
      );
    }
    return found;
  }

  /* ---------------------------------------------------------------- *
   * CRUD
   * ---------------------------------------------------------------- */

  async list(user: AuthUser, query: CommunicationListQuery) {
    const page = resolvePage(query);
    const q = normalizeQuery(query.q);
    const channel = parseChannel(query.channel);
    const direction = parseDirection(query.direction);

    const where: Prisma.CommunicationLogWhereInput = {
      tenantId: user.tenantId,
      ...(query.clientId ? { clientId: query.clientId } : {}),
      ...(query.caseId ? { caseId: query.caseId } : {}),
      ...(channel ? { channel } : {}),
      ...(direction ? { direction } : {}),
      ...(query.from || query.to
        ? {
            occurredAt: {
              ...(query.from ? { gte: parseDateParam(query.from, "başlangıç") } : {}),
              ...(query.to ? { lte: parseRangeEnd(query.to, "bitiş") } : {}),
            },
          }
        : {}),
      ...(q
        ? {
            OR: [
              { subject: { contains: q, mode: "insensitive" } },
              { body: { contains: q, mode: "insensitive" } },
              { contactRef: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.client.communicationLog.findMany({
        where,
        orderBy: { occurredAt: "desc" },
        skip: page.skip,
        take: page.take,
        include: {
          client: { select: { id: true, name: true } },
          case: { select: { id: true, title: true, fileNumber: true } },
        },
      }),
      this.prisma.client.communicationLog.count({ where }),
    ]);

    return paged(items, total, page);
  }

  async detail(user: AuthUser, id: string) {
    const found = await this.prisma.client.communicationLog.findFirst({
      where: { id, tenantId: user.tenantId },
      include: {
        client: { select: { id: true, name: true } },
        case: { select: { id: true, title: true, fileNumber: true } },
      },
    });
    if (!found) throw new NotFoundException("İletişim kaydı bulunamadı.");
    return found;
  }

  /**
   * Elle iletişim kaydı — telefon görüşmesi, yüz yüze görüşme, elden teslim.
   *
   * SEKRETER de kaydedebilir (ROLE_SETS.OPERASYON): bu bir hukuki tasarruf
   * değil, büro hafızasına not düşmektir. Kaydı kimin girdiği `recordedBy`'da
   * saklanır.
   */
  async create(user: AuthUser, input: CreateCommunicationInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "iletişim kaydı oluşturma");

    let clientId = input.clientId ?? null;
    if (clientId) await this.requireClient(user.tenantId, clientId);
    if (input.caseId) {
      const found = await this.requireCase(user.tenantId, input.caseId, clientId ?? undefined);
      // Dosya verildiyse müvekkil bellidir; ikisini ayrı ayrı sormaya gerek yok.
      clientId = clientId ?? found.clientId;
    }

    const created = await this.prisma.client.communicationLog.create({
      data: {
        tenantId: user.tenantId,
        clientId,
        caseId: input.caseId ?? null,
        direction: input.direction,
        channel: input.channel,
        subject: input.subject ?? null,
        body: input.body,
        contactRef: input.contactRef ?? null,
        occurredAt: input.occurredAt ?? new Date(),
        recordedBy: user.userId,
        // ── KAYNAK AYRIMI (denetim bulgusu 9) ────────────────────────────
        // Bu uç bir GÖNDERİM ucu DEĞİLDİR; olmuş bir görüşmeyi kaydeder.
        // Onay makinesinden geçen gerçek gönderimler `OutboundService.send`
        // tarafından `source: "SISTEM"` + `outboundMessageId` ile yazılır.
        // İkisinin tek tabloda ayırt edilebilmesi, "kim onayladı?" sorusunun
        // ön koşuludur.
        source: "ELLE",
        outboundMessageId: null,
      },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "COMMUNICATION_CREATE",
      entity: "CommunicationLog",
      entityId: created.id,
      detail: `${created.direction}/${created.channel} kaynak=ELLE`,
    });

    /**
     * GİDEN elle kayıtta KVKK UYARISI — ENGELLEYİCİ DEĞİL, UYARICI.
     *
     * Bu uçta gönderim yapılmaz (olay zaten olmuştur), bu yüzden onay kapısı
     * kurmak anlamsızdır: geçmişi engelleyemeyiz. Ama metinde alıcıya ait
     * OLMAYAN kişisel veri varsa avukat bunu bilmelidir — kayıt bir gün delil
     * olarak sunulabilir ve içindeki üçüncü kişi verisi ayrı bir sorumluluktur.
     */
    let piiNotice: string | null = null;
    if (input.direction === "GIDEN" && clientId) {
      piiNotice = await this.thirdPartyPiiNotice(
        user.tenantId,
        clientId,
        input.body,
        input.subject ?? null,
      );
    }

    return { ...created, ...(piiNotice ? { piiNotice } : {}) };
  }

  /**
   * Metinde ALICIYA AİT OLMAYAN kişisel veri var mı? Varsa insan-okur uyarı.
   *
   * `OutboundService` ile aynı sınıflandırmayı kullanır: müvekkilin kendi
   * e-postası/telefonu/TCKN'si/IBAN'ı olağandır, riskli olan üçüncü kişi
   * verisidir. Tarama başarısız olursa kayıt bozulmaz (uyarı üretilmez).
   */
  private async thirdPartyPiiNotice(
    tenantId: string,
    clientId: string,
    body: string,
    subject: string | null,
  ): Promise<string | null> {
    try {
      const client = await this.requireClient(tenantId, clientId);
      const contacts = await this.prisma.client.clientContact.findMany({
        where: { clientId },
        select: { email: true, phone: true },
      });
      const scan = scanPii(`${subject ?? ""}\n${body}`);
      const classified = classifyOutboundPii(scan.findings, {
        emails: [client.email, ...contacts.map((c) => c.email)],
        phones: [client.phone, ...contacts.map((c) => c.phone)],
        tckns: [client.tckn],
        ibans: [client.iban],
      });
      if (classified.thirdParty.length === 0) return null;
      return (
        "UYARI: Bu kayıtta alıcıya ait OLMAYAN kişisel veri tespit edildi " +
        `(${classified.thirdParty.map((f) => `${f.kind}×${f.count}`).join(", ")}). ` +
        "Kayıt oluşturuldu; içeriğin üçüncü kişi verisi taşıması ayrı bir KVKK " +
        "değerlendirmesi gerektirebilir."
      );
    } catch {
      return null;
    }
  }

  async update(user: AuthUser, id: string, input: UpdateCommunicationInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "iletişim kaydı güncelleme");
    const existing = await this.detail(user, id);

    if (input.clientId) await this.requireClient(user.tenantId, input.clientId);
    if (input.caseId) {
      await this.requireCase(
        user.tenantId,
        input.caseId,
        (input.clientId ?? existing.clientId) ?? undefined,
      );
    }

    const updated = await this.prisma.client.communicationLog.update({
      where: { id: existing.id },
      data: {
        ...(input.clientId !== undefined ? { clientId: input.clientId } : {}),
        ...(input.caseId !== undefined ? { caseId: input.caseId } : {}),
        ...(input.subject !== undefined ? { subject: input.subject } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.contactRef !== undefined ? { contactRef: input.contactRef } : {}),
        ...(input.occurredAt !== undefined ? { occurredAt: input.occurredAt } : {}),
      },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "COMMUNICATION_UPDATE",
      entity: "CommunicationLog",
      entityId: id,
    });
    return updated;
  }

  /**
   * Kayıt silme — YALNIZ ADMIN/PARTNER.
   *
   * İletişim geçmişi, "müvekkile ne söylendi?" sorusunun kanıtıdır ve meslekî
   * sorumluluk tartışmasında delil değeri taşır. Bu yüzden silme yetkisi
   * operasyon rollerine açılmaz ve silinen kaydın özeti AuditLog'a yazılır:
   * kaydın kendisi gider, silinmiş OLDUĞU bilgisi kalır.
   */
  async remove(user: AuthUser, id: string) {
    assertRole(user, ROLE_SETS.ONAY, "iletişim kaydı silme");
    const existing = await this.detail(user, id);

    await this.prisma.client.communicationLog.delete({ where: { id: existing.id } });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "COMMUNICATION_DELETE",
      entity: "CommunicationLog",
      entityId: id,
      detail:
        `${existing.direction}/${existing.channel} · ${existing.occurredAt.toISOString()} · ` +
        `konu: ${existing.subject ?? "(yok)"} · ${existing.body.length} karakter`,
    });
    return { deleted: true, id };
  }

  /* ---------------------------------------------------------------- *
   * Birleşik zaman çizelgesi
   * ---------------------------------------------------------------- */

  /**
   * Tüm kanalların birleşik kronolojisi.
   *
   * ÜÇ KAYNAK, SIFIR MÜKERRER:
   *   KAYIT        ← CommunicationLog (elle notlar + GÖNDERİLMİŞ mesajlar)
   *   GELEN        ← InboundMessage
   *   GIDEN_TASLAK ← OutboundMessage, YALNIZ status ≠ GONDERILDI
   *
   * Son koşul mükerrerliği kapatır: gönderilen mesaj `CommunicationLog`'a
   * yazıldığı için, hem oradan hem `OutboundMessage`'dan gelseydi zaman
   * çizelgesinde iki kez görünürdü.
   */
  async timeline(
    user: AuthUser,
    params: { clientId?: string; caseId?: string; limit?: string },
  ) {
    if (!params.clientId && !params.caseId) {
      throw new BadRequestException("Zaman çizelgesi için `clientId` veya `caseId` gereklidir.");
    }
    if (params.clientId) await this.requireClient(user.tenantId, params.clientId);
    if (params.caseId) await this.requireCase(user.tenantId, params.caseId, params.clientId);

    const take = Math.min(200, Math.max(1, Number(params.limit) || 100));
    const scope = {
      tenantId: user.tenantId,
      ...(params.clientId ? { clientId: params.clientId } : {}),
      ...(params.caseId ? { caseId: params.caseId } : {}),
    };

    const [logs, inbound, drafts] = await Promise.all([
      this.prisma.client.communicationLog.findMany({
        where: scope,
        orderBy: { occurredAt: "desc" },
        take,
      }),
      this.prisma.client.inboundMessage.findMany({
        where: scope,
        orderBy: { receivedAt: "desc" },
        take,
      }),
      this.prisma.client.outboundMessage.findMany({
        where: { ...scope, status: { not: "GONDERILDI" } },
        orderBy: { createdAt: "desc" },
        take,
      }),
    ]);

    const entries = [
      ...logs.map((l) => ({
        kind: "KAYIT" as const,
        id: l.id,
        at: l.occurredAt,
        direction: l.direction,
        channel: l.channel,
        subject: l.subject,
        body: l.body,
        clientId: l.clientId,
        caseId: l.caseId,
        status: null as string | null,
        note: null as string | null,
      })),
      ...inbound.map((m) => ({
        kind: "GELEN" as const,
        id: m.id,
        at: m.receivedAt,
        direction: "GELEN" as const,
        channel: m.channel,
        subject: m.subject,
        body: m.body,
        clientId: m.clientId,
        caseId: m.caseId,
        status: m.matchStatus as string,
        note:
          m.matchStatus === "BEKLIYOR"
            ? "Dosya eşleştirmesi bekliyor; bağlantı henüz onaylanmadı."
            : null,
      })),
      ...drafts.map((m) => ({
        kind: "GIDEN_TASLAK" as const,
        id: m.id,
        at: m.createdAt,
        direction: "GIDEN" as const,
        channel: m.channel,
        subject: m.subject,
        body: m.finalBody ?? m.draftBody,
        clientId: m.clientId,
        caseId: m.caseId,
        status: m.status as string,
        note: "BU MESAJ HENÜZ GÖNDERİLMEDİ.",
      })),
    ];

    // Deterministik sıra: tarihe göre azalan, eşitlikte kimliğe göre.
    entries.sort((a, b) => b.at.getTime() - a.at.getTime() || a.id.localeCompare(b.id));

    return {
      items: entries.slice(0, take),
      counts: { kayit: logs.length, gelen: inbound.length, gidenTaslak: drafts.length },
      notice:
        "Gönderilmemiş taslaklar GIDEN_TASLAK türüyle ve 'gönderilmedi' notuyla listelenir; " +
        "gönderilmiş mesajlar KAYIT türünde görünür.",
    };
  }

  /**
   * Yanıtsız gelen mesajlar (Modül 19 iş kuralı 6).
   *
   * "Yanıtsız" DETERMİNİSTİK tanımlanır: mesaj geldikten SONRA aynı müvekkile
   * gönderilmiş (GONDERILDI) bir mesaj yoksa yanıtsızdır. Tahmin yok, AI yok.
   * Müvekkili çözülememiş mesajlar da yanıtsız sayılır — kimseye bağlanamamış
   * bir mesaj, cevaplanma ihtimali en düşük olandır.
   */
  async unanswered(user: AuthUser, hoursParam?: string) {
    const hours = Math.min(720, Math.max(1, Number(hoursParam) || 48));
    const threshold = new Date(Date.now() - hours * 60 * 60 * 1000);

    const candidates = await this.prisma.client.inboundMessage.findMany({
      where: { tenantId: user.tenantId, receivedAt: { lte: threshold } },
      orderBy: { receivedAt: "asc" },
      take: 200,
      include: { client: { select: { id: true, name: true } } },
    });

    const items = [];
    for (const message of candidates) {
      if (message.clientId) {
        const replied = await this.prisma.client.outboundMessage.count({
          where: {
            tenantId: user.tenantId,
            clientId: message.clientId,
            status: "GONDERILDI",
            sentAt: { gt: message.receivedAt },
          },
        });
        if (replied > 0) continue;
      }
      items.push({
        id: message.id,
        receivedAt: message.receivedAt,
        channel: message.channel,
        fromRef: message.fromRef,
        subject: message.subject,
        clientId: message.clientId,
        clientName: message.client?.name ?? null,
        caseId: message.caseId,
        matchStatus: message.matchStatus,
        waitingHours: Math.floor((Date.now() - message.receivedAt.getTime()) / 3_600_000),
      });
    }

    return {
      thresholdHours: hours,
      items,
      total: items.length,
      notice:
        "Bu liste, gelişinden sonra aynı müvekkile GÖNDERİLMİŞ bir mesaj bulunmayan gelen " +
        "mesajlardan oluşur. Müvekkili henüz çözülmemiş mesajlar da listeye dâhildir.",
    };
  }
}
