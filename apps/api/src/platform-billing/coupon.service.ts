/**
 * KUPONLAR (Faz 3) — platform satış ekibi tanımlar, büro abonelik/kredi ödemesinde kullanır.
 * Geçerlilik `couponValidity` (saf) ile denetlenir; kullanım sayacı ÖDEME ANINDA artar
 * (checkout başlatmak kuponu tüketmez).
 */

import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type Coupon } from "@nomosos/db";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service";
import { PlatformAuditService } from "../platform/platform-audit.service";
import type { PlatformAuthUser } from "../platform/platform.types";
import { couponValidity } from "../billing/subscription-pricing";

export const couponCreateSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,32}$/, "Kupon kodu 3-32 karakter; A-Z, 0-9, _ ve - olabilir."),
  kind: z.enum(["YUZDE", "SABIT"]),
  value: z.coerce.number().positive("Değer pozitif olmalıdır.").max(100000),
  appliesTo: z.enum(["TUM", "ABONELIK", "KREDI"]).default("TUM"),
  validFrom: z.coerce.date().nullable().optional(),
  validUntil: z.coerce.date().nullable().optional(),
  maxRedemptions: z.coerce.number().int().positive().nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
export type CouponCreateInput = z.infer<typeof couponCreateSchema>;
export const couponPatchSchema = z.object({
  isActive: z.boolean().optional(),
  validUntil: z.coerce.date().nullable().optional(),
  maxRedemptions: z.coerce.number().int().positive().nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
export type CouponPatchInput = z.infer<typeof couponPatchSchema>;

export function couponDto(c: Coupon) {
  return {
    id: c.id,
    code: c.code,
    kind: c.kind,
    value: c.value.toFixed(2),
    appliesTo: c.appliesTo,
    validFrom: c.validFrom,
    validUntil: c.validUntil,
    maxRedemptions: c.maxRedemptions,
    redeemedCount: c.redeemedCount,
    isActive: c.isActive,
    note: c.note,
    createdAt: c.createdAt,
    label: c.kind === "YUZDE" ? `%${c.value.toFixed(0)}` : `${c.value.toFixed(2)} TRY`,
  };
}

@Injectable()
export class CouponService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
  ) {}

  async list() {
    const rows = await this.prisma.client.coupon.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
    return { items: rows.map(couponDto) };
  }

  async create(user: PlatformAuthUser, input: CouponCreateInput) {
    if (input.kind === "YUZDE" && input.value > 100) throw new BadRequestException("Yüzde indirimi 100'ü aşamaz.");
    if (input.validFrom && input.validUntil && input.validFrom > input.validUntil) {
      throw new BadRequestException("Başlangıç tarihi bitişten sonra olamaz.");
    }
    try {
      const row = await this.prisma.client.coupon.create({
        data: {
          code: input.code,
          kind: input.kind,
          value: new Prisma.Decimal(input.value).toDecimalPlaces(2),
          appliesTo: input.appliesTo,
          validFrom: input.validFrom ?? null,
          validUntil: input.validUntil ?? null,
          maxRedemptions: input.maxRedemptions ?? null,
          note: input.note ?? null,
          createdBy: user.id,
        },
      });
      await this.audit.log({ actor: user, action: "COUPON_CREATE", entity: "Coupon", entityId: row.id, detail: `${row.code} ${couponDto(row).label} (${row.appliesTo})` });
      return couponDto(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException(`"${input.code}" kodlu kupon zaten var.`);
      }
      throw err;
    }
  }

  async patch(user: PlatformAuthUser, id: string, input: CouponPatchInput) {
    const existing = await this.prisma.client.coupon.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Kupon bulunamadı.");
    const row = await this.prisma.client.coupon.update({
      where: { id },
      data: {
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.validUntil !== undefined ? { validUntil: input.validUntil } : {}),
        ...(input.maxRedemptions !== undefined ? { maxRedemptions: input.maxRedemptions } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
      },
    });
    await this.audit.log({ actor: user, action: "COUPON_UPDATE", entity: "Coupon", entityId: id, detail: JSON.stringify(input) });
    return couponDto(row);
  }

  /** Geçerli kupon ya da Türkçe gerekçeyle hata. */
  async requireValid(code: string, scope: "ABONELIK" | "KREDI", now = new Date()): Promise<Coupon> {
    const c = await this.prisma.client.coupon.findUnique({ where: { code: code.trim().toUpperCase() } });
    if (!c) throw new BadRequestException("Kupon bulunamadı.");
    const v = couponValidity(c, scope, now);
    if (!v.ok) throw new BadRequestException(v.reason);
    return c;
  }

  /** Geçerliyse kupon, değilse null (sessiz — dönem faturası üretimi durmasın). */
  async findValid(code: string | null | undefined, scope: "ABONELIK" | "KREDI", now = new Date()): Promise<Coupon | null> {
    if (!code) return null;
    const c = await this.prisma.client.coupon.findUnique({ where: { code: code.trim().toUpperCase() } });
    if (!c) return null;
    return couponValidity(c, scope, now).ok ? c : null;
  }

  /** Ödeme kesinleşince sayaç artar. */
  async redeem(code: string, tx: Prisma.TransactionClient): Promise<void> {
    await tx.coupon.updateMany({ where: { code }, data: { redeemedCount: { increment: 1 } } });
  }
}
