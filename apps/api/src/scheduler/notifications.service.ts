import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { NotificationKind, NotificationStatus, Prisma } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { paged, resolvePage } from "../common/pagination";
import { NOTIFICATION_PAGE_SIZE } from "./scheduler.constants";
import type { AuthUser } from "../common/types";

/** Okunmamış sayılan durumlar. `IPTAL` ve `OKUNDU` sayılmaz. */
const UNREAD_STATUSES: NotificationStatus[] = ["BEKLIYOR", "GONDERILDI"];

const KIND_LABELS: Record<NotificationKind, string> = {
  SURE_YAKLASIYOR: "Yaklaşan süre",
  SURE_GECTI: "Geçmiş süre",
  DURUSMA_YARIN: "Yarınki duruşma",
  GOREV_ATANDI: "Görev atandı",
  ONAY_BEKLIYOR: "Onay bekliyor",
  KREDI_AZALDI: "Kredi azaldı",
  SOZLESME_YENILEME: "Sözleşme yenileme",
  VEKALET_SURESI: "Vekalet süresi",
  SOZLESME_KRITIK_SHERH: "Kritik sözleşme şerhi",
};

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
