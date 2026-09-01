/**
 * E9 — RANDEVU (rakip analizi): büro ajandası + müvekkil portal self-servisi.
 *
 * ÇAKIŞMA KAPİSİ: aynı büroda zaman aralığı ÇAKIŞAN iki randevu OLAMAZ.
 * Kıyaslama yarı-açık aralıkla yapılır ([start, end)): bitiş anı başlangıca
 * eşitse çakışma YOKTUR — 10:00-10:30 ve 10:30-11:00 art arda kurulabilir.
 *
 * PORTAL SELF-SERVİSİ: müvekkil portal hesabıyla randevu ALIR (kimlik
 * oturumdan; clientId istemciden ASLA alınmaz — portal sözleşmesi). Süre
 * sabittir (30 dk) — müvekkil süreyi değil zamanı seçer.
 */

import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { assertRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";
import type { PortalAuthUser } from "../portal/portal.types";

/** Portal randevu süresi (dakika) — müvekkil süreyi seçmez. */
export const PORTAL_RANDEVU_SURESI_DK = 30;

export const RANDEVU_STATULERI = ["PLANLANDI", "IPTAL", "TAMAMLANDI"] as const;
export type RandevuStatus = (typeof RANDEVU_STATULERI)[number];

export interface RandevuGirdisi {
  title: string;
  startAt: Date;
  endAt: Date;
  clientId?: string | null;
  note?: string | null;
}

@Injectable()
export class RandevuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** GET /randevular — büro ajandası (tarih aralıklı). */
  async list(user: AuthUser, params: { from?: string; to?: string; status?: string }) {
    const where: Prisma.RandevuWhereInput = { tenantId: user.tenantId };
    if (params.status && (RANDEVU_STATULERI as readonly string[]).includes(params.status)) {
      where.status = params.status;
    }
    if (params.from || params.to) {
      where.startAt = {
        ...(params.from ? { gte: new Date(params.from) } : {}),
        ...(params.to ? { lte: new Date(params.to) } : {}),
      };
    }
    const [rows, total] = await Promise.all([
      this.prisma.client.randevu.findMany({
        where,
        orderBy: { startAt: "asc" },
        take: 200,
        include: { client: { select: { id: true, name: true } } },
      }),
      this.prisma.client.randevu.count({ where }),
    ]);
    return { rows, total };
  }

  /** POST /randevular — büro randevusu (tüm roller alabilir; sekreter ajandasıdır). */
  async create(user: AuthUser, input: RandevuGirdisi) {
    this.dogrula(input);
    const row = await this.olustur({
      tenantId: user.tenantId,
      input,
      createdBy: user.userId,
      portalUserId: null,
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "RANDEVU_CREATE",
      entity: "Randevu",
      entityId: row.id,
      detail: `${input.title} · ${input.startAt.toISOString()}`,
    });
    return row;
  }

  /** PATCH /randevular/:id — durum değişimi (OPERASYON). */
  async updateStatus(user: AuthUser, id: string, status: RandevuStatus) {
    assertRole(user, ROLE_SETS.OPERASYON, "randevu durumu değiştirme");
    const existing = await this.prisma.client.randevu.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!existing) throw new NotFoundException("Randevu bulunamadı.");
    const row = await this.prisma.client.randevu.update({
      where: { id },
      data: { status },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "RANDEVU_STATUS",
      entity: "Randevu",
      entityId: id,
      detail: `${existing.status} → ${status}`,
    });
    return row;
  }

  /**
   * PORTAL: müvekkilin kendi randevuları (yalnız kendi client kaydına bağlı
   * randevular + kendi oluşturdukları).
   */
  async portalList(portalUser: PortalAuthUser) {
    return this.prisma.client.randevu.findMany({
      where: {
        tenantId: portalUser.tenantId,
        status: "PLANLANDI",
        OR: [{ clientId: portalUser.clientId }, { portalUserId: portalUser.portalUserId }],
        startAt: { gte: new Date() },
      },
      orderBy: { startAt: "asc" },
      take: 50,
      select: { id: true, title: true, startAt: true, endAt: true, status: true, note: true },
    });
  }

  /** PORTAL: müvekkil self-servis randevu — süre sabit 30 dk. */
  async portalCreate(portalUser: PortalAuthUser, input: { title: string; startAt: Date }) {
    const endAt = new Date(input.startAt.getTime() + PORTAL_RANDEVU_SURESI_DK * 60_000);
    if (input.startAt.getTime() <= Date.now()) {
      throw new ConflictException("Geçmiş bir zamana randevu alınamaz.");
    }
    const row = await this.olustur({
      tenantId: portalUser.tenantId,
      input: { title: input.title, startAt: input.startAt, endAt, note: null },
      clientId: portalUser.clientId,
      portalUserId: portalUser.portalUserId,
      createdBy: null,
    });
    return row;
  }

  /** PORTAL: müvekkil kendi PLANLANDI randevusunu iptal eder. */
  async portalCancel(portalUser: PortalAuthUser, id: string) {
    const existing = await this.prisma.client.randevu.findFirst({
      where: { id, tenantId: portalUser.tenantId, portalUserId: portalUser.portalUserId },
    });
    if (!existing) throw new NotFoundException("Randevu bulunamadı.");
    if (existing.status !== "PLANLANDI") {
      throw new ConflictException("Yalnız planlanmış randevu iptal edilebilir.");
    }
    return this.prisma.client.randevu.update({ where: { id }, data: { status: "IPTAL" } });
  }

  /* ------------------ ortak ------------------ */

  private dogrula(input: RandevuGirdisi) {
    if (input.endAt.getTime() <= input.startAt.getTime()) {
      throw new ConflictException("Randevu bitişi başlangıçtan sonra olmalıdır.");
    }
  }

  private async olustur(args: {
    tenantId: string;
    input: RandevuGirdisi;
    clientId?: string | null;
    portalUserId?: string | null;
    createdBy?: string | null;
  }) {
    const { input } = args;
    this.dogrula(input);

    // ÇAKIŞMA KAPISI: aynı büroda PLANLANDI randevularla yarı-açık aralık
    // kesişimi (start < yeni.end && end > yeni.start).
    const cakisan = await this.prisma.client.randevu.findFirst({
      where: {
        tenantId: args.tenantId,
        status: "PLANLANDI",
        startAt: { lt: input.endAt },
        endAt: { gt: input.startAt },
      },
      select: { id: true },
    });
    if (cakisan) {
      throw new ConflictException(
        "Bu zaman aralığında başka bir randevu var. Çakışmayan bir saat seçin.",
      );
    }

    return this.prisma.client.randevu.create({
      data: {
        tenantId: args.tenantId,
        clientId: args.clientId ?? input.clientId ?? null,
        portalUserId: args.portalUserId ?? null,
        title: input.title,
        startAt: input.startAt,
        endAt: input.endAt,
        note: input.note ?? null,
        createdBy: args.createdBy ?? null,
      },
    });
  }
}
