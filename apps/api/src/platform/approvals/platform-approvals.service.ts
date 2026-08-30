import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type { ApprovalStatus, Prisma } from "@nomosos/db";
import { PrismaService } from "../../prisma/prisma.service";
import { PlatformAuditService } from "../platform-audit.service";
import { APPROVAL_EXPIRY_HOURS } from "../platform.constants";
import { canMutate } from "../platform-permissions";
import { paged, resolvePage, type PageParams } from "../../common/pagination";
import type { PlatformAuthUser } from "../platform.types";
import { PlatformApprovalExecutorService } from "./platform-approval-executor.service";
import {
  APPROVAL_LABELS,
  APPROVAL_REQUIRED_PERMISSION,
  isApprovalAction,
  type ApprovalActionKey,
} from "./approval-actions";

export interface CreateApprovalInput {
  action: ApprovalActionKey;
  payload: Record<string, unknown>;
  tenantId?: string | null;
  /** Kullanıcıya dönecek Türkçe özet. */
  summary: string;
}

/**
 * DÖRT-GÖZ ONAY KUYRUĞU.
 *
 * İKİ DEMİR KURAL (spec §İş Kuralları 4, kabul kriteri 5):
 *   1. TALEP EDEN KENDİ TALEBİNİ ONAYLAYAMAZ → 403.
 *   2. 72 saatte zaman aşımına düşen talep onaylanamaz → SURESI_DOLDU.
 *
 * Üçüncü, daha az görünür ama en az onlar kadar önemli kural: ONAYLAYAN,
 * işlemi kendi başına yapabilecek yetkiye sahip olmalıdır. Aksi hâlde yetkisiz
 * bir ikinci imza dört-göz kuralını biçimsel olarak sağlar, fiilen deler.
 */
@Injectable()
export class PlatformApprovalsService {
  private readonly logger = new Logger(PlatformApprovalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
    private readonly executor: PlatformApprovalExecutorService
  ) {}

  /**
   * Onay talebi oluşturur. İŞLEMİ YAPMAZ — yalnızca kaydeder.
   * Domain servisleri (tenant, abonelik, ödeme…) bu metodu çağırır.
   */
  async request(user: PlatformAuthUser, input: CreateApprovalInput) {
    const expiresAt = new Date(Date.now() + APPROVAL_EXPIRY_HOURS * 60 * 60 * 1000);
    const record = await this.prisma.client.platformApprovalRequest.create({
      data: {
        requestedBy: user.id,
        action: input.action,
        payloadJson: JSON.stringify(input.payload),
        tenantId: input.tenantId ?? null,
        expiresAt,
      },
    });

    await this.audit.log({
      actor: user,
      action: "APPROVAL_REQUEST_CREATE",
      entity: "PlatformApprovalRequest",
      entityId: record.id,
      tenantId: input.tenantId ?? null,
      detail: `${APPROVAL_LABELS[input.action]} talebi açıldı. ${input.summary}`,
    });

    return {
      approvalRequired: true,
      approvalRequest: this.toDto(record),
      message:
        `Bu işlem dört-göz onayına tabidir ve doğrudan uygulanmadı. ` +
        `Talep kaydı oluşturuldu; SİZDEN FARKLI bir yetkilinin onaylaması gerekir. ` +
        `Talep ${APPROVAL_EXPIRY_HOURS} saat içinde onaylanmazsa kendiliğinden düşer.`,
    };
  }

  /**
   * Süresi geçen bekleyen talepleri SURESI_DOLDU'ya çeker.
   *
   * Gerçek zamanlayıcı (cron) Faz 6'ya bırakıldığı için tarama, kuyruğa her
   * bakışta ve her karar öncesinde tembel olarak çalıştırılır. Böylece süresi
   * dolmuş bir talep hiçbir okuma yolunda "bekliyor" görünmez.
   */
  async expireStale(): Promise<number> {
    const result = await this.prisma.client.platformApprovalRequest.updateMany({
      where: { status: "BEKLIYOR", expiresAt: { lte: new Date() } },
      data: { status: "SURESI_DOLDU" },
    });
    if (result.count > 0) {
      this.logger.log(`${result.count} onay talebi zaman aşımına uğradı (72 saat).`);
    }
    return result.count;
  }

  async list(query: { status?: string; tenantId?: string; page?: string; limit?: string }) {
    await this.expireStale();

    const where: Prisma.PlatformApprovalRequestWhereInput = {};
    if (query.status) {
      const status = query.status.toUpperCase();
      if (!["BEKLIYOR", "ONAYLANDI", "REDDEDILDI", "SURESI_DOLDU"].includes(status)) {
        throw new BadRequestException(
          "Geçersiz durum süzgeci. Kabul edilen değerler: BEKLIYOR, ONAYLANDI, REDDEDILDI, SURESI_DOLDU."
        );
      }
      where.status = status as ApprovalStatus;
    }
    if (query.tenantId) where.tenantId = query.tenantId;

    const page: PageParams = resolvePage(query);
    const [rows, total] = await Promise.all([
      this.prisma.client.platformApprovalRequest.findMany({
        where,
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.client.platformApprovalRequest.count({ where }),
    ]);

    const names = await this.resolveNames(rows);
    return paged(
      rows.map((row) => ({
        ...this.toDto(row),
        requestedByName: names.users.get(row.requestedBy) ?? "(silinmiş kullanıcı)",
        decidedByName: row.decidedBy ? names.users.get(row.decidedBy) ?? "(silinmiş kullanıcı)" : null,
        tenantName: row.tenantId ? names.tenants.get(row.tenantId) ?? "(silinmiş büro)" : null,
      })),
      total,
      page
    );
  }

  async decide(
    id: string,
    user: PlatformAuthUser,
    decision: "approve" | "reject",
    note?: string
  ) {
    await this.expireStale();

    const record = await this.prisma.client.platformApprovalRequest.findUnique({ where: { id } });
    if (!record) throw new NotFoundException("Onay talebi bulunamadı.");

    if (record.status !== "BEKLIYOR") {
      throw new BadRequestException(
        record.status === "SURESI_DOLDU"
          ? `Bu talep ${APPROVAL_EXPIRY_HOURS} saatlik süre içinde karara bağlanmadığı için düşmüştür. ` +
            "İşlem hâlâ gerekliyse yeni bir talep açın."
          : "Bu talep zaten karara bağlanmış."
      );
    }

    // DEMİR KURAL 1 — talep eden ≠ onaylayan.
    if (record.requestedBy === user.id) {
      throw new ForbiddenException(
        "Kendi açtığınız onay talebini karara bağlayamazsınız. Dört-göz ilkesi gereği " +
          "işlemi sizden farklı bir yetkilinin onaylaması gerekir."
      );
    }

    // DEMİR KURAL 3 — onaylayanın işlem yetkisi olmalı.
    if (isApprovalAction(record.action)) {
      const needed = APPROVAL_REQUIRED_PERMISSION[record.action];
      if (!canMutate(user.role, needed)) {
        throw new ForbiddenException(
          `Rolünüz "${APPROVAL_LABELS[record.action]}" işlemini yapma yetkisine sahip olmadığı için ` +
            "bu talebi onaylayamaz. Onay, işlemi bizzat yapabilecek bir yetkiliden gelmelidir."
        );
      }
    }

    // DEMİR KURAL 2 — AÇIK süre kontrolü.
    //
    // Süre aşımı yalnız `expireStale()`'e emanet EDİLEMEZ (denetim bulgusu 13):
    // o toplu güncellemenin tek bir başarısız/kısmi koşusu (kilit çakışması,
    // saat kayması, ileride cron'a taşınırken bu çağrının düşürülmesi) süresi
    // dolmuş bir talebi onaylanabilir bırakırdı. Aşağıdaki atomik sahiplenme
    // de aynı koşulu WHERE'inde taşır; bu iki kapı birbirinin yedeğidir.
    if (record.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException(
        `Bu talep ${APPROVAL_EXPIRY_HOURS} saatlik süre içinde karara bağlanmadığı için ` +
          "düşmüştür. İşlem hâlâ gerekliyse yeni bir talep açın."
      );
    }

    if (decision === "reject") {
      const claimed = await this.claim(id, user, "REDDEDILDI", note);
      if (!claimed) throw this.alreadyDecided();
      const updated = await this.prisma.client.platformApprovalRequest.findUniqueOrThrow({
        where: { id },
      });
      await this.audit.log({
        actor: user,
        action: "APPROVAL_REJECT",
        entity: "PlatformApprovalRequest",
        entityId: id,
        tenantId: record.tenantId,
        detail: `${record.action} talebi reddedildi.${note ? ` Not: ${note}` : ""}`,
      });
      return { approvalRequest: this.toDto(updated), message: "Talep reddedildi; işlem uygulanmadı." };
    }

    /**
     * ATOMİK SAHİPLENME — ÖNCE talep tüketilir, SONRA işlem uygulanır.
     *
     * Eski akış `findUnique` → durum kontrolü → `execute()` → `update()`
     * şeklindeydi ve hiçbiri koşullu yazma değildi: iki eşzamanlı onay isteği
     * (iki farklı onaylayıcı ya da bir çift tıklama) ikisi de `BEKLIYOR`
     * okuyup `execute()`'u İKİ KEZ çalıştırabiliyordu. Sonuç, muhasebede
     * çifte iade ve denetim izinde iki `PAYMENT_REFUND` satırıydı
     * (denetim bulgusu 2). Executor'ların kendi durum kontrolleri de aynı
     * TOCTOU'ya sahipti; onları düzeltmek yetmezdi, TALEP TÜKETİMİ tek
     * seferlik olmalıydı.
     *
     * `updateMany` + WHERE(status=BEKLIYOR, expiresAt>now) tek bir atomik
     * UPDATE'tir: yarışı yalnız bir istek kazanır, diğeri 0 satır günceller.
     *
     * Uygulama başarısız olursa talep `BEKLIYOR`'a GERİ ALINIR — "onaylandı
     * ama yapılmadı" gibi yanıltıcı bir kayıt kalmaz (özgün tasarımın korunan
     * ilkesi).
     */
    const claimed = await this.claim(id, user, "ONAYLANDI", note);
    if (!claimed) throw this.alreadyDecided();

    let outcome: string;
    try {
      outcome = await this.executor.execute(record, user);
    } catch (err) {
      await this.prisma.client.platformApprovalRequest.updateMany({
        where: { id, status: "ONAYLANDI", decidedBy: user.id },
        data: { status: "BEKLIYOR", decidedBy: null, decidedAt: null, decisionNote: null },
      });
      this.logger.warn(
        `Onay talebi ${id} uygulanamadı, BEKLIYOR'a geri alındı: ${(err as Error).message}`
      );
      throw err;
    }

    const updated = await this.prisma.client.platformApprovalRequest.findUniqueOrThrow({
      where: { id },
    });

    await this.audit.log({
      actor: user,
      action: "APPROVAL_APPROVE",
      entity: "PlatformApprovalRequest",
      entityId: id,
      tenantId: record.tenantId,
      detail:
        `${record.action} talebi onaylandı ve uygulandı. Talep eden: ${record.requestedBy}. ` +
        `Sonuç: ${outcome}${note ? ` Not: ${note}` : ""}`,
    });

    return { approvalRequest: this.toDto(updated), message: outcome };
  }

  /**
   * Talebi tek atomik UPDATE ile sahiplenir.
   * `false` dönerse: talep bu sırada başkası tarafından karara bağlanmış ya da
   * süresi dolmuş demektir.
   */
  private async claim(
    id: string,
    user: PlatformAuthUser,
    status: "ONAYLANDI" | "REDDEDILDI",
    note?: string
  ): Promise<boolean> {
    const result = await this.prisma.client.platformApprovalRequest.updateMany({
      where: { id, status: "BEKLIYOR", expiresAt: { gt: new Date() } },
      data: { status, decidedBy: user.id, decidedAt: new Date(), decisionNote: note },
    });
    return result.count === 1;
  }

  private alreadyDecided(): BadRequestException {
    return new BadRequestException(
      "Bu talep aynı anda başka bir yetkili tarafından karara bağlandı ya da süresi doldu. " +
        "İşlem TEKRARLANMADI; kuyruğu yenileyip talebin son durumuna bakın."
    );
  }

  private async resolveNames(rows: { requestedBy: string; decidedBy: string | null; tenantId: string | null }[]) {
    const userIds = new Set<string>();
    const tenantIds = new Set<string>();
    for (const row of rows) {
      userIds.add(row.requestedBy);
      if (row.decidedBy) userIds.add(row.decidedBy);
      if (row.tenantId) tenantIds.add(row.tenantId);
    }
    const [users, tenants] = await Promise.all([
      userIds.size
        ? this.prisma.client.platformUser.findMany({
            where: { id: { in: [...userIds] } },
            select: { id: true, fullName: true, email: true },
          })
        : Promise.resolve([]),
      // Platform tablolarında tenantId FK DEĞİLDİR; `include` yoktur, ad ayrı
      // sorguyla birleştirilir.
      tenantIds.size
        ? this.prisma.client.tenant.findMany({
            where: { id: { in: [...tenantIds] } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);
    return {
      users: new Map(users.map((u) => [u.id, `${u.fullName} (${u.email})`])),
      tenants: new Map(tenants.map((t) => [t.id, t.name])),
    };
  }

  private toDto(row: {
    id: string;
    requestedBy: string;
    action: string;
    payloadJson: string;
    tenantId: string | null;
    status: ApprovalStatus;
    decidedBy: string | null;
    decidedAt: Date | null;
    decisionNote: string | null;
    expiresAt: Date;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      action: row.action,
      actionLabel: isApprovalAction(row.action) ? APPROVAL_LABELS[row.action] : row.action,
      // payload istemciye ÖZET olarak döner; içinde parola hash'i gibi alanlar
      // olabileceği için ham JSON değil ayıklanmış nesne gönderilir.
      payload: safePayload(row.payloadJson),
      requestedBy: row.requestedBy,
      tenantId: row.tenantId,
      status: row.status,
      decidedBy: row.decidedBy,
      decidedAt: row.decidedAt,
      decisionNote: row.decisionNote,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    };
  }
}

/** Payload'dan sır niteliğindeki alanları ayıklar. */
function safePayload(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (/passwordHash|password|secret|token/i.test(key)) continue;
    if (key === "newUser" && value && typeof value === "object") {
      const { email, fullName } = value as Record<string, unknown>;
      out.newUser = { email, fullName };
      continue;
    }
    out[key] = value;
  }
  return out;
}
