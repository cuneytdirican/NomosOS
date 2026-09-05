import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { NotificationKind, NotificationStatus, Prisma } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { paged, resolvePage } from "../common/pagination";
import { NOTIFICATION_PAGE_SIZE } from "./scheduler.constants";
import type { AuthUser } from "../common/types";

/** Okunmamış sayılan durumlar. `IPTAL` ve `OKUNDU` sayılmaz. */
const UNREAD_STATUSES: NotificationStatus[] = ["BEKLIYOR", "GONDERILDI"];

export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  SURE_YAKLASIYOR: "Yaklaşan süre",
  SURE_GECTI: "Geçmiş süre",
  DURUSMA_YARIN: "Yarınki duruşma",
  GOREV_ATANDI: "Görev atandı",
  ONAY_BEKLIYOR: "Onay bekliyor",
  KREDI_AZALDI: "Kredi azaldı",
  SOZLESME_YENILEME: "Sözleşme yenileme",
  VEKALET_SURESI: "Vekalet süresi",
  SOZLESME_KRITIK_SHERH: "Kritik sözleşme şerhi",
  KVKK_SAKLAMA: "KVKK saklama süresi denetimi",
  ODEME_GECIKTI: "Abonelik ödemesi gecikti",
  DENEME_BITIYOR: "Deneme süresi bitiyor",
  FATURA_KESILDI: "Abonelik faturası kesildi",
};
const KIND_LABELS = NOTIFICATION_KIND_LABELS;

export interface NotificationPreferenceInput {
  kind: NotificationKind;
  inApp: boolean;
  email: boolean;
  push: boolean;
}

/**
 * KİRACI BİLDİRİM UÇLARI.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ GÖRÜNÜRLÜK KURALI: kullanıcı YALNIZ kendi bildirimlerini ve büro geneli  ║
 * ║ (userId = null) bildirimleri görür. Bir avukat, başka bir avukatın süre  ║
 * ║ hatırlatmasını GÖREMEZ — bildirim metni dosya adı, esas numarası ve      ║
 * ║ hukuki dayanak taşır; bunlar dosya bazlı bilgilerdir ve büro içinde de   ║
 * ║ herkese açık değildir.                                                   ║
 * ║                                                                          ║
 * ║ Her sorgu HEM `tenantId` HEM alıcı süzgeci taşır. `tenantId` tek başına  ║
 * ║ yeterli değildir (büro içi ayrım), alıcı süzgeci tek başına yeterli      ║
 * ║ değildir (kimlik başka kiracıda tekrar edebilir).                        ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------------ //
  // Bildirim tercihleri (Enterprise++): tür × kanal; kayıt yoksa hepsi açık.
  // ------------------------------------------------------------------ //

  async getPreferences(user: AuthUser) {
    const rows = await this.prisma.client.notificationPreference.findMany({
      where: { tenantId: user.tenantId, userId: user.userId },
    });
    const byKind = new Map(rows.map((r) => [r.kind, r]));
    return {
      items: (Object.keys(KIND_LABELS) as NotificationKind[]).map((kind) => {
        const r = byKind.get(kind);
        return {
          kind,
          label: KIND_LABELS[kind],
          inApp: r?.inApp ?? true,
          email: r?.email ?? true,
          push: r?.push ?? true,
        };
      }),
      /** Dürüstlük: e-posta/push sağlayıcısı bağlı mı — tercih saklanır, dağıtım sağlayıcıya bağlı. */
      channels: { inApp: true, email: false, push: false },
    };
  }

  async setPreferences(user: AuthUser, items: NotificationPreferenceInput[]) {
    for (const item of items) {
      if (!(item.kind in KIND_LABELS)) {
        throw new BadRequestException(`Geçersiz bildirim türü: ${item.kind}`);
      }
      await this.prisma.client.notificationPreference.upsert({
        where: { tenantId_userId_kind: { tenantId: user.tenantId, userId: user.userId, kind: item.kind } },
        create: { tenantId: user.tenantId, userId: user.userId, kind: item.kind, inApp: item.inApp, email: item.email, push: item.push },
        update: { inApp: item.inApp, email: item.email, push: item.push },
      });
    }
    return this.getPreferences(user);
  }

  /** Kullanıcının görebileceği bildirimleri seçen süzgeç — TEK KAYNAK. */
  private visibleTo(user: AuthUser): Prisma.NotificationOutboxWhereInput {
    return {
      tenantId: user.tenantId,
      // `userId: null` = büro geneli duyuru. Zamanlanmış işler böyle kayıt
      // ÜRETMEZ (daima somut alıcı yazar); alan ileride duyuru kanalı içindir.
      OR: [{ userId: user.userId }, { userId: null }],
      status: { not: "IPTAL" },
    };
  }

  /**
   * Faz 2 — platform duyuruları. Hedefleme `targetJson`: PLAN_BAZLI → { planKeys },
   * TENANT_BAZLI → { tenantIds }. Süresi dolan ya da yayınlanmamış duyuru görünmez.
   */
  async activeAnnouncements(tenantId: string) {
    const now = new Date();
    const [rows, subscription] = await Promise.all([
      this.prisma.client.announcement.findMany({
        where: { publishedAt: { lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        orderBy: { publishedAt: "desc" },
        take: 20,
        select: { id: true, title: true, body: true, severity: true, audience: true, targetJson: true, publishedAt: true, expiresAt: true },
      }),
      this.prisma.client.subscription.findFirst({ where: { tenantId }, select: { planKey: true } }),
    ]);
    const planKey = subscription?.planKey ?? null;
    const items = rows
      .filter((a) => announcementTargetsTenant(a, tenantId, planKey))
      .map(({ targetJson: _t, ...rest }) => rest);
    return { items };
  }

  async list(
    user: AuthUser,
    query: { status?: string; kind?: string; unreadOnly?: string; page?: string; limit?: string }
  ) {
    const where: Prisma.NotificationOutboxWhereInput = this.visibleTo(user);

    if (query.unreadOnly === "true") {
      where.status = { in: UNREAD_STATUSES };
    } else if (query.status) {
      const status = query.status.toUpperCase() as NotificationStatus;
      if (!["BEKLIYOR", "GONDERILDI", "OKUNDU"].includes(status)) {
        throw new BadRequestException(
          "Geçersiz durum süzgeci. Kabul edilenler: BEKLIYOR, GONDERILDI, OKUNDU."
        );
      }
      where.status = status;
    }

    if (query.kind) {
      const kind = query.kind.toUpperCase() as NotificationKind;
      if (!(kind in KIND_LABELS)) {
        throw new BadRequestException(
          `Geçersiz bildirim türü. Kabul edilenler: ${Object.keys(KIND_LABELS).join(", ")}.`
        );
      }
      where.kind = kind;
    }

    const page = resolvePage(query, NOTIFICATION_PAGE_SIZE);
    const [rows, total, unreadCount] = await Promise.all([
      this.prisma.client.notificationOutbox.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.client.notificationOutbox.count({ where }),
      this.unreadCount(user),
    ]);

    return { ...paged(rows.map(toDto), total, page), unreadCount };
  }

  async unreadCount(user: AuthUser): Promise<number> {
    return this.prisma.client.notificationOutbox.count({
      where: { ...this.visibleTo(user), status: { in: UNREAD_STATUSES } },
    });
  }

  /**
   * Tek bildirimi okundu işaretler.
   *
   * `updateMany` + tam süzgeç kullanılır: `update({ where: { id } })` başka bir
   * kiracının kaydını da bulur ve güncellerdi. Etkilenen satır 0 ise 404 döner
   * — "var ama senin değil" ile "yok" arasında ayrım YAPILMAZ; ayrım yapmak
   * kimliklerin varlığını sızdırırdı.
   */
  async markRead(user: AuthUser, id: string) {
    const existing = await this.prisma.client.notificationOutbox.findFirst({
      where: { ...this.visibleTo(user), id },
    });
    if (!existing) {
      throw new NotFoundException("Bildirim bulunamadı.");
    }
    if (existing.userId === null) {
      // Büro geneli duyuruyu bir kişi okuduğunda herkesten gizlenmesi yanlış
      // olurdu; kişi bazlı okundu bilgisi ayrı bir tablo ister.
      throw new BadRequestException(
        "Büro geneli duyurular kişi bazında okundu işaretlenemez."
      );
    }
    if (existing.status === "OKUNDU") {
      return toDto(existing);
    }

    await this.prisma.client.notificationOutbox.updateMany({
      where: { id, tenantId: user.tenantId, userId: user.userId },
      data: { status: "OKUNDU", readAt: new Date() },
    });
    return toDto({ ...existing, status: "OKUNDU", readAt: new Date() });
  }

  /** Kullanıcının TÜM okunmamış bildirimlerini okundu yapar. */
  async markAllRead(user: AuthUser): Promise<{ updated: number }> {
    const result = await this.prisma.client.notificationOutbox.updateMany({
      where: {
        tenantId: user.tenantId,
        // Büro geneli duyurular (userId: null) KAPSAM DIŞI — bkz. markRead.
        userId: user.userId,
        status: { in: UNREAD_STATUSES },
      },
      data: { status: "OKUNDU", readAt: new Date() },
    });
    return { updated: result.count };
  }
}

function toDto(row: {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  resourceType: string | null;
  resourceId: string | null;
  status: NotificationStatus;
  scheduledFor: Date | null;
  sentAt: Date | null;
  readAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    kind: row.kind,
    kindLabel: KIND_LABELS[row.kind],
    title: row.title,
    body: row.body,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    status: row.status,
    isRead: row.status === "OKUNDU",
    scheduledFor: row.scheduledFor,
    sentAt: row.sentAt,
    readAt: row.readAt,
    createdAt: row.createdAt,
    // `dedupeKey` BİLİNÇLİ OLARAK DIŞA VERİLMEZ: iç idempotentlik ayrıntısıdır
    // ve kaynak kimliklerini (deadlineId, userId) düz metin taşır.
  };
}

/** Duyuru hedefi bu kiracıyı kapsıyor mu? (saf; testlenebilir) */
export function announcementTargetsTenant(
  a: { audience: string; targetJson: string | null },
  tenantId: string,
  planKey: string | null,
): boolean {
  if (a.audience === "TUM") return true;
  let target: { planKeys?: unknown; tenantIds?: unknown } = {};
  try {
    target = a.targetJson ? (JSON.parse(a.targetJson) as typeof target) : {};
  } catch {
    return false;
  }
  if (a.audience === "PLAN_BAZLI") return Array.isArray(target.planKeys) && planKey !== null && target.planKeys.includes(planKey);
  if (a.audience === "TENANT_BAZLI") return Array.isArray(target.tenantIds) && target.tenantIds.includes(tenantId);
  return false;
}
