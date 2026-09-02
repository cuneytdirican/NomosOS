import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../common/types";
import { ROLE_LABELS } from "../common/roles";
import { paged, resolvePage } from "../common/pagination";
import { endOfDay, parseDateParam, startOfDay } from "../common/dates";
import { assertFinanceAccess, canFinance, FINANCE_ACCESS } from "../finance/finance-access";
import { dec, minutesToHours, moneyOut } from "../finance/money";
import type { CreateTimeEntryInput, UpdateTimeEntryInput } from "./billing.dto";

const TIME_INCLUDE = {
  user: { select: { id: true, fullName: true, role: true } },
  case: { select: { id: true, title: true, fileNumber: true } },
  client: { select: { id: true, name: true } },
} satisfies Prisma.TimeEntryInclude;

type TimeEntryWithRelations = Prisma.TimeEntryGetPayload<{ include: typeof TIME_INCLUDE }>;

export interface TimeEntryListParams {
  userId?: string;
  caseId?: string;
  clientId?: string;
  from?: string;
  to?: string;
  billable?: string;
  /** "true" → yalnız faturalanmamış kayıtlar (fatura hazırlığı ekranı). */
  uninvoiced?: string;
  page?: string;
  limit?: string;
}

/**
 * Modül 09 — Zaman kayıtları (timesheet).
 *
 * KİLİTLEME KURALI: `invoiceId` dolu bir kayıt FATURALANMIŞTIR; düzenlenemez ve
 * silinemez (409). Fatura iptal edilince bağ çözülür ve kayıt yeniden
 * faturalanabilir hâle gelir (bkz. invoices.service.ts → `cancel`).
 *
 * SÜRE HASSASİYETİ: `minutes` TAMSAYI DAKİKADIR. Saate çevrim yalnızca
 * gösterim ve fatura satırında yapılır (`minutesToHours`), asla float ile
 * saklanmaz — 20 dakikalık bir kayıt 0.333… saat olarak saklansaydı 100 kayıt
 * sonunda kuruş farkı doğardı.
 */
@Injectable()
export class TimeEntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser, params: TimeEntryListParams) {
    assertFinanceAccess(user, FINANCE_ACCESS.READ, "zaman kayıtlarını görüntüleme");
    const pageParams = resolvePage(params);
    const where = this.buildWhere(user.tenantId, params);

    const [items, total, agg] = await Promise.all([
      this.prisma.client.timeEntry.findMany({
        where,
        include: TIME_INCLUDE,
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        skip: pageParams.skip,
        take: pageParams.take,
      }),
      this.prisma.client.timeEntry.count({ where }),
      this.prisma.client.timeEntry.aggregate({ where, _sum: { minutes: true } }),
    ]);

    const totalMinutes = agg._sum.minutes ?? 0;
    return {
      ...paged(items.map((e) => this.serialize(e)), total, pageParams),
      totalMinutes,
      totalHours: minutesToHours(totalMinutes).toFixed(2),
    };
  }

  /**
   * GET /billing/time-entries/summary — kullanıcı ve dosya bazlı toplamlar.
   *
   * Tutar hesabı: Σ( saat × saat ücreti ). Saat ücreti kayıttaki `hourlyRate`
   * anlık görüntüsünden gelir; boş olan kayıtlar `unratedMinutes` altında ayrı
   * raporlanır — tutar UYDURULMAZ, eksik olduğu açıkça söylenir.
   */
  async summary(user: AuthUser, params: TimeEntryListParams) {
    assertFinanceAccess(user, FINANCE_ACCESS.READ, "zaman kaydı özetini görüntüleme");
    const where = this.buildWhere(user.tenantId, params);

    // İ-33: özet sınırsız satır okuyordu — tek seferde bir yıllık veri okunurken
    // bellek şişer ve istek yavaşlar. Tavan 10.000 kayıt; aşılırsa yanıt açıkça
    // KISMİ döner (uydurma yok).
    const SUMMARY_ROW_CAP = 10_000;
    const rows = await this.prisma.client.timeEntry.findMany({
      where,
      select: {
        userId: true,
        caseId: true,
        clientId: true,
        minutes: true,
        billable: true,
        hourlyRate: true,
        invoiceId: true,
      },
      take: SUMMARY_ROW_CAP,
      orderBy: { date: "desc" },
    });
    const totalRows = await this.prisma.client.timeEntry.count({ where });
    const truncated = totalRows > rows.length;

    const byUser = new Map<string, { minutes: number; billableMinutes: number; amount: Prisma.Decimal; unratedMinutes: number }>();
    const byCase = new Map<string, { minutes: number; billableMinutes: number; amount: Prisma.Decimal; unratedMinutes: number }>();

    let totalMinutes = 0;
    let billableMinutes = 0;
    let invoicedMinutes = 0;
    let totalAmount = new Prisma.Decimal(0);
    let unratedMinutes = 0;

    for (const row of rows) {
      totalMinutes += row.minutes;
      if (row.billable) billableMinutes += row.minutes;
      if (row.invoiceId) invoicedMinutes += row.minutes;

      const amount = row.hourlyRate
        ? minutesToHours(row.minutes).mul(dec(row.hourlyRate)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
        : new Prisma.Decimal(0);
      if (!row.hourlyRate && row.billable) unratedMinutes += row.minutes;
      totalAmount = totalAmount.plus(amount);

      const userBucket = byUser.get(row.userId) ?? {
        minutes: 0,
        billableMinutes: 0,
        amount: new Prisma.Decimal(0),
        unratedMinutes: 0,
      };
      userBucket.minutes += row.minutes;
      if (row.billable) userBucket.billableMinutes += row.minutes;
      if (!row.hourlyRate && row.billable) userBucket.unratedMinutes += row.minutes;
      userBucket.amount = userBucket.amount.plus(amount);
      byUser.set(row.userId, userBucket);

      const caseKey = row.caseId ?? "__DOSYASIZ__";
      const caseBucket = byCase.get(caseKey) ?? {
        minutes: 0,
        billableMinutes: 0,
        amount: new Prisma.Decimal(0),
        unratedMinutes: 0,
      };
      caseBucket.minutes += row.minutes;
      if (row.billable) caseBucket.billableMinutes += row.minutes;
      if (!row.hourlyRate && row.billable) caseBucket.unratedMinutes += row.minutes;
      caseBucket.amount = caseBucket.amount.plus(amount);
      byCase.set(caseKey, caseBucket);
    }

    const [users, cases] = await Promise.all([
      this.prisma.client.user.findMany({
        where: { tenantId: user.tenantId, id: { in: [...byUser.keys()] } },
        select: { id: true, fullName: true, role: true },
      }),
      this.prisma.client.case.findMany({
        where: {
          tenantId: user.tenantId,
          id: { in: [...byCase.keys()].filter((k) => k !== "__DOSYASIZ__") },
        },
        select: { id: true, title: true, fileNumber: true },
      }),
    ]);
    const userMap = new Map(users.map((u) => [u.id, u]));
    const caseMap = new Map(cases.map((c) => [c.id, c]));

    return {
      totals: {
        entryCount: rows.length,
        totalMinutes,
        totalHours: minutesToHours(totalMinutes).toFixed(2),
        billableMinutes,
        billableHours: minutesToHours(billableMinutes).toFixed(2),
        invoicedMinutes,
        uninvoicedMinutes: totalMinutes - invoicedMinutes,
        amount: moneyOut(totalAmount),
        /** Saat ücreti girilmemiş faturalanabilir dakika — tutara YANSIMAZ. */
        unratedMinutes,
      },
      byUser: [...byUser.entries()]
        .map(([userId, b]) => ({
          userId,
          user: userMap.get(userId) ?? null,
          minutes: b.minutes,
          hours: minutesToHours(b.minutes).toFixed(2),
          billableMinutes: b.billableMinutes,
          amount: moneyOut(b.amount),
          unratedMinutes: b.unratedMinutes,
        }))
        .sort((a, b) => b.minutes - a.minutes),
      byCase: [...byCase.entries()]
        .map(([caseId, b]) => ({
          caseId: caseId === "__DOSYASIZ__" ? null : caseId,
          case: caseId === "__DOSYASIZ__" ? null : (caseMap.get(caseId) ?? null),
          minutes: b.minutes,
          hours: minutesToHours(b.minutes).toFixed(2),
          billableMinutes: b.billableMinutes,
          amount: moneyOut(b.amount),
          unratedMinutes: b.unratedMinutes,
        }))
        .sort((a, b) => b.minutes - a.minutes),
      truncated,
      truncatedRowCount: truncated ? totalRows : null,
      note:
        "Tutarlar, kayıttaki saat ücreti anlık görüntüsünden hesaplanır. Saat ücreti " +
        "girilmemiş kayıtlar tutara dâhil edilmez; `unratedMinutes` bunları gösterir.",
    };
  }

  async create(user: AuthUser, input: CreateTimeEntryInput) {
    assertFinanceAccess(user, FINANCE_ACCESS.TIME_WRITE, "zaman kaydı oluşturma");

    // Başkası adına kayıt: yalnız ADMIN/PARTNER.
    const targetUserId = input.userId ?? user.userId;
    if (targetUserId !== user.userId && !canFinance(user, FINANCE_ACCESS.TIME_MANAGE_OTHERS)) {
      throw new ForbiddenException(
        `${ROLE_LABELS[user.role]} rolü başkası adına zaman kaydı giremez.`,
      );
    }
    await this.requireTenantUser(user.tenantId, targetUserId);

    const { clientId, caseId } = await this.resolveScope(user.tenantId, input.caseId ?? null, input.clientId ?? null);

    const created = await this.prisma.client.timeEntry.create({
      data: {
        tenantId: user.tenantId,
        userId: targetUserId,
        caseId,
        clientId,
        date: input.date,
        minutes: input.minutes,
        description: input.description,
        billable: input.billable,
        hourlyRate: input.hourlyRate ? dec(input.hourlyRate) : null,
      },
      include: TIME_INCLUDE,
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "TIME_ENTRY_CREATE",
      entity: "TimeEntry",
      entityId: created.id,
      detail: `${created.minutes} dk — ${created.description.slice(0, 80)}`,
    });
    return this.serialize(created);
  }

  async update(user: AuthUser, id: string, input: UpdateTimeEntryInput) {
    assertFinanceAccess(user, FINANCE_ACCESS.TIME_WRITE, "zaman kaydı güncelleme");
    const existing = await this.requireEntry(user.tenantId, id);
    this.assertNotInvoiced(existing, "değiştirilemez");
    this.assertOwnership(user, existing.userId, "düzenleyemez");

    const scope =
      input.caseId !== undefined || input.clientId !== undefined
        ? await this.resolveScope(
            user.tenantId,
            input.caseId !== undefined ? input.caseId : existing.caseId,
            input.clientId !== undefined ? input.clientId : existing.clientId,
          )
        : null;

    const updated = await this.prisma.client.timeEntry.update({
      where: { id },
      data: {
        ...(scope ? { caseId: scope.caseId, clientId: scope.clientId } : {}),
        ...(input.date !== undefined ? { date: input.date } : {}),
        ...(input.minutes !== undefined ? { minutes: input.minutes } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.billable !== undefined ? { billable: input.billable } : {}),
        ...(input.hourlyRate !== undefined
          ? { hourlyRate: input.hourlyRate === null ? null : dec(input.hourlyRate) }
          : {}),
      },
      include: TIME_INCLUDE,
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "TIME_ENTRY_UPDATE",
      entity: "TimeEntry",
      entityId: id,
      detail: `Güncellenen alanlar: ${Object.keys(input).join(", ")}`,
    });
    return this.serialize(updated);
  }

  async remove(user: AuthUser, id: string) {
    assertFinanceAccess(user, FINANCE_ACCESS.TIME_WRITE, "zaman kaydı silme");
    const existing = await this.requireEntry(user.tenantId, id);
    this.assertNotInvoiced(existing, "silinemez");
    this.assertOwnership(user, existing.userId, "silemez");

    await this.prisma.client.timeEntry.delete({ where: { id } });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "TIME_ENTRY_DELETE",
      entity: "TimeEntry",
      entityId: id,
      detail: `${existing.minutes} dk`,
    });
    return { ok: true, id };
  }

  // ------------------------------------------------------------- yardımcılar

  serialize(e: TimeEntryWithRelations) {
    return {
      id: e.id,
      userId: e.userId,
      user: e.user,
      caseId: e.caseId,
      case: e.case,
      clientId: e.clientId,
      client: e.client,
      date: e.date,
      minutes: e.minutes,
      hours: minutesToHours(e.minutes).toFixed(2),
      description: e.description,
      billable: e.billable,
      hourlyRate: e.hourlyRate === null ? null : moneyOut(e.hourlyRate),
      invoiceId: e.invoiceId,
      /** Faturalanmış kayıt kilitlidir. */
      locked: e.invoiceId !== null,
      createdAt: e.createdAt,
    };
  }

  private buildWhere(tenantId: string, params: TimeEntryListParams): Prisma.TimeEntryWhereInput {
    const where: Prisma.TimeEntryWhereInput = { tenantId };
    if (params.userId) where.userId = params.userId;
    if (params.caseId) where.caseId = params.caseId;
    if (params.clientId) where.clientId = params.clientId;
    if (params.billable === "true") where.billable = true;
    if (params.billable === "false") where.billable = false;
    if (params.uninvoiced === "true") where.invoiceId = null;
    if (params.uninvoiced === "false") where.invoiceId = { not: null };
    if (params.from || params.to) {
      where.date = {
        ...(params.from ? { gte: startOfDay(parseDateParam(params.from, "başlangıç")) } : {}),
        ...(params.to ? { lte: endOfDay(parseDateParam(params.to, "bitiş")) } : {}),
      };
    }
    return where;
  }

  /**
   * Dosya ve müvekkil tutarlılığı: dosya verildiyse müvekkil dosyadan TÜRETİLİR.
   * Böylece "A müvekkilinin dosyası, B müvekkiline yazılmış zaman kaydı" durumu
   * oluşamaz ve fatura üretimi yanlış müvekkile satır taşımaz.
   */
  private async resolveScope(
    tenantId: string,
    caseId: string | null,
    clientId: string | null,
  ): Promise<{ caseId: string | null; clientId: string | null }> {
    if (caseId) {
      const found = await this.prisma.client.case.findFirst({
        where: { id: caseId, tenantId },
        select: { id: true, clientId: true },
      });
      if (!found) throw new BadRequestException("Dosya bulunamadı.");
      if (clientId && clientId !== found.clientId) {
        throw new BadRequestException("Seçilen dosya bu müvekkile ait değil.");
      }
      return { caseId: found.id, clientId: found.clientId };
    }
    if (clientId) {
      const client = await this.prisma.client.client.findFirst({
        where: { id: clientId, tenantId },
        select: { id: true },
      });
      if (!client) throw new BadRequestException("Müvekkil bulunamadı.");
      return { caseId: null, clientId: client.id };
    }
    throw new BadRequestException("Zaman kaydı için dosya veya müvekkilden en az biri seçilmelidir.");
  }

  private assertNotInvoiced(entry: { invoiceId: string | null }, verb: string): void {
    if (entry.invoiceId) {
      throw new ConflictException(
        `Bu zaman kaydı faturalanmış olduğu için ${verb}. Düzeltmek için önce ilgili ` +
          "faturayı iptal edin; iptalde kayıt yeniden faturalanabilir hâle gelir.",
      );
    }
  }

  private assertOwnership(user: AuthUser, ownerId: string, verb: string): void {
    if (ownerId !== user.userId && !canFinance(user, FINANCE_ACCESS.TIME_MANAGE_OTHERS)) {
      throw new ForbiddenException(
        `${ROLE_LABELS[user.role]} rolü başkasının zaman kaydını ${verb}.`,
      );
    }
  }

  private async requireEntry(tenantId: string, id: string) {
    const found = await this.prisma.client.timeEntry.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        userId: true,
        caseId: true,
        clientId: true,
        minutes: true,
        invoiceId: true,
      },
    });
    if (!found) throw new NotFoundException("Zaman kaydı bulunamadı.");
    return found;
  }

  private async requireTenantUser(tenantId: string, userId: string) {
    const found = await this.prisma.client.user.findFirst({
      where: { id: userId, tenantId },
      select: { id: true },
    });
    if (!found) throw new BadRequestException("Seçilen kullanıcı büronuzda bulunamadı.");
    return found;
  }
}
