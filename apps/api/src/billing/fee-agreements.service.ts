import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type AgreementStatus, type FeeType } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../common/types";
import { paged, resolvePage } from "../common/pagination";
import { assertFinanceAccess, FINANCE_ACCESS } from "../finance/finance-access";
import { dec, defaultVatRate, formatMoneyTr, moneyOut, rateOut } from "../finance/money";
import {
  AGREEMENT_STATUSES,
  FEE_TYPES,
  HOURLY_FEE_TYPES,
  type CreateFeeAgreementInput,
  type FeeTypeValue,
  type UpdateFeeAgreementInput,
} from "./billing.dto";

const AGREEMENT_INCLUDE = {
  client: { select: { id: true, name: true, type: true } },
  case: { select: { id: true, title: true, fileNumber: true } },
} satisfies Prisma.FeeAgreementInclude;

type AgreementWithRelations = Prisma.FeeAgreementGetPayload<{ include: typeof AGREEMENT_INCLUDE }>;

/**
 * Modül 09 — Ücret sözleşmeleri.
 *
 * Sözleşme, faturalamanın KURAL KAYNAĞIDIR: saat ücreti ve KDV oranı buradan
 * okunur (koda gömülmez). Bu yüzden yazma yetkisi yalnızca ADMIN/PARTNER'dedir.
 *
 * TİP BAZLI ZORUNLULUKLAR hem Zod (`billing.dto.ts` → `refineFeeAgreement`) hem
 * de burada — PATCH sonrası BİRLEŞMİŞ kayıt üzerinden — doğrulanır. Kısmi
 * güncelleme, tipi SAATLIK'e çevirip `hourlyRate`'i boş bırakarak tutarsız bir
 * sözleşme üretebilirdi; `assertTypeRequirements` bunu engeller.
 */
@Injectable()
export class FeeAgreementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    user: AuthUser,
    params: { clientId?: string; caseId?: string; type?: string; status?: string; page?: string; limit?: string },
  ) {
    assertFinanceAccess(user, FINANCE_ACCESS.READ, "ücret sözleşmelerini görüntüleme");
    const pageParams = resolvePage(params);
    const where: Prisma.FeeAgreementWhereInput = { tenantId: user.tenantId };

    if (params.clientId) where.clientId = params.clientId;
    if (params.caseId) where.caseId = params.caseId;
    if (params.type) {
      if (!(FEE_TYPES as readonly string[]).includes(params.type)) {
        throw new BadRequestException("Geçersiz ücret sözleşmesi tipi.");
      }
      where.type = params.type as FeeType;
    }
    if (params.status) {
      if (!(AGREEMENT_STATUSES as readonly string[]).includes(params.status)) {
        throw new BadRequestException("Geçersiz sözleşme durumu.");
      }
      where.status = params.status as AgreementStatus;
    }

    const [items, total] = await Promise.all([
      this.prisma.client.feeAgreement.findMany({
        where,
        include: AGREEMENT_INCLUDE,
        orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
        skip: pageParams.skip,
        take: pageParams.take,
      }),
      this.prisma.client.feeAgreement.count({ where }),
    ]);
    return paged(items.map((a) => this.serialize(a)), total, pageParams);
  }

  async detail(user: AuthUser, id: string) {
    assertFinanceAccess(user, FINANCE_ACCESS.READ, "ücret sözleşmesi görüntüleme");
    const found = await this.prisma.client.feeAgreement.findFirst({
      where: { id, tenantId: user.tenantId },
      include: AGREEMENT_INCLUDE,
    });
    if (!found) throw new NotFoundException("Ücret sözleşmesi bulunamadı.");
    return this.serialize(found);
  }

  async create(user: AuthUser, input: CreateFeeAgreementInput) {
    assertFinanceAccess(user, FINANCE_ACCESS.AGREEMENT_WRITE, "ücret sözleşmesi oluşturma");

    const client = await this.requireClient(user.tenantId, input.clientId);
    if (input.caseId) await this.requireCaseOfClient(user.tenantId, input.caseId, input.clientId);
    if (input.endDate && input.endDate < input.startDate) {
      throw new BadRequestException("Bitiş tarihi başlangıç tarihinden önce olamaz.");
    }
    this.assertTypeRequirements({
      type: input.type,
      amount: input.amount ?? null,
      hourlyRate: input.hourlyRate ?? null,
      successPercent: input.successPercent ?? null,
    });

    const created = await this.prisma.client.feeAgreement.create({
      data: {
        tenantId: user.tenantId,
        clientId: input.clientId,
        caseId: input.caseId ?? null,
        type: input.type as FeeType,
        amount: input.amount ? dec(input.amount) : null,
        hourlyRate: input.hourlyRate ? dec(input.hourlyRate) : null,
        successPercent: input.successPercent ? dec(input.successPercent) : null,
        currency: input.currency,
        // Oran KODA GÖMÜLMEZ: gönderilmediyse yapılandırılabilir varsayılan.
        vatRate: input.vatRate ? dec(input.vatRate) : defaultVatRate(),
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        terms: input.terms ?? null,
        status: input.status as AgreementStatus,
      },
      include: AGREEMENT_INCLUDE,
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "FEE_AGREEMENT_CREATE",
      entity: "FeeAgreement",
      entityId: created.id,
      detail: `${created.type} — ${client.name}${created.amount ? ` ${formatMoneyTr(created.amount, created.currency)}` : ""}`,
    });
    return this.serialize(created);
  }

  async update(user: AuthUser, id: string, input: UpdateFeeAgreementInput) {
    assertFinanceAccess(user, FINANCE_ACCESS.AGREEMENT_WRITE, "ücret sözleşmesi güncelleme");
    const existing = await this.requireAgreement(user.tenantId, id);

    if (input.caseId) await this.requireCaseOfClient(user.tenantId, input.caseId, existing.clientId);

    // BİRLEŞMİŞ kayıt üzerinden doğrulama (kısmi güncelleme tutarsızlık üretmesin).
    const merged = {
      type: (input.type ?? existing.type) as FeeTypeValue,
      amount:
        input.amount !== undefined ? input.amount : existing.amount ? existing.amount.toString() : null,
      hourlyRate:
        input.hourlyRate !== undefined
          ? input.hourlyRate
          : existing.hourlyRate
            ? existing.hourlyRate.toString()
            : null,
      successPercent:
        input.successPercent !== undefined
          ? input.successPercent
          : existing.successPercent
            ? existing.successPercent.toString()
            : null,
    };
    this.assertTypeRequirements(merged);

    const startDate = input.startDate ?? existing.startDate;
    const endDate = input.endDate !== undefined ? input.endDate : existing.endDate;
    if (endDate && endDate < startDate) {
      throw new BadRequestException("Bitiş tarihi başlangıç tarihinden önce olamaz.");
    }

    const updated = await this.prisma.client.feeAgreement.update({
      where: { id },
      data: {
        ...(input.caseId !== undefined ? { caseId: input.caseId } : {}),
        ...(input.type !== undefined ? { type: input.type as FeeType } : {}),
        ...(input.amount !== undefined ? { amount: input.amount === null ? null : dec(input.amount) } : {}),
        ...(input.hourlyRate !== undefined
          ? { hourlyRate: input.hourlyRate === null ? null : dec(input.hourlyRate) }
          : {}),
        ...(input.successPercent !== undefined
          ? { successPercent: input.successPercent === null ? null : dec(input.successPercent) }
          : {}),
        ...(input.vatRate !== undefined ? { vatRate: dec(input.vatRate) } : {}),
        ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
        ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
        ...(input.terms !== undefined ? { terms: input.terms } : {}),
        ...(input.status !== undefined ? { status: input.status as AgreementStatus } : {}),
      },
      include: AGREEMENT_INCLUDE,
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "FEE_AGREEMENT_UPDATE",
      entity: "FeeAgreement",
      entityId: id,
      detail: `Güncellenen alanlar: ${Object.keys(input).join(", ")}`,
    });
    return this.serialize(updated);
  }

  /**
   * Silme YALNIZCA TASLAK sözleşmede mümkündür.
   * Yürürlüğe girmiş bir ücret sözleşmesi, kesilmiş faturaların dayanağıdır;
   * silinmez, durumu FESIH/SONA_ERDI yapılır (iz kalır).
   */
  async remove(user: AuthUser, id: string) {
    assertFinanceAccess(user, FINANCE_ACCESS.AGREEMENT_WRITE, "ücret sözleşmesi silme");
    const existing = await this.requireAgreement(user.tenantId, id);
    if (existing.status !== "TASLAK") {
      throw new ConflictException(
        "Yalnızca TASLAK durumundaki ücret sözleşmesi silinebilir. Yürürlükteki sözleşme " +
          "kesilmiş faturaların dayanağıdır; silmek yerine durumunu FESIH veya SONA_ERDI yapın.",
      );
    }

    await this.prisma.client.feeAgreement.delete({ where: { id } });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "FEE_AGREEMENT_DELETE",
      entity: "FeeAgreement",
      entityId: id,
      detail: `${existing.type} (TASLAK)`,
    });
    return { ok: true, id };
  }

  /**
   * FATURALAMA TARİFE ÇÖZÜCÜSÜ.
   *
   * Öncelik sırası (deterministik, ilk eşleşen kazanır):
   *   1. Dosyaya özel AKTİF saatlik sözleşme
   *   2. Müvekkile ait (dosyasız) AKTİF saatlik sözleşme
   *   3. Dosyaya özel AKTİF diğer sözleşme (yalnız KDV oranı için)
   *   4. Müvekkile ait AKTİF diğer sözleşme (yalnız KDV oranı için)
   * Tarih filtresi: `startDate <= referans <= endDate` (endDate null = süresiz).
   */
  async resolveBillingTerms(
    tenantId: string,
    clientId: string,
    caseId: string | null,
    referenceDate: Date,
  ): Promise<{ hourlyRate: Prisma.Decimal | null; vatRate: Prisma.Decimal; agreementId: string | null; currency: string | null }> {
    const candidates = await this.prisma.client.feeAgreement.findMany({
      where: {
        tenantId,
        clientId,
        status: "AKTIF",
        startDate: { lte: referenceDate },
        // İki ayrı VEYA koşulu aynı nesnede `OR` anahtarını ezerdi; AND altında
        // ayrı ayrı verilir (süre geçerliliği + dosya kapsamı).
        AND: [
          { OR: [{ endDate: null }, { endDate: { gte: referenceDate } }] },
          caseId ? { OR: [{ caseId }, { caseId: null }] } : { caseId: null },
        ],
      },
      orderBy: { startDate: "desc" },
    });
    if (candidates.length === 0) {
      return { hourlyRate: null, vatRate: defaultVatRate(), agreementId: null, currency: null };
    }

    const hourly =
      candidates.find((a) => a.caseId === caseId && HOURLY_FEE_TYPES.includes(a.type as FeeTypeValue) && a.hourlyRate) ??
      candidates.find((a) => a.caseId === null && HOURLY_FEE_TYPES.includes(a.type as FeeTypeValue) && a.hourlyRate) ??
      null;
    const forVat =
      hourly ?? candidates.find((a) => a.caseId === caseId) ?? candidates[0];

    return {
      hourlyRate: hourly?.hourlyRate ?? null,
      vatRate: forVat.vatRate,
      agreementId: (hourly ?? forVat).id,
      currency: (hourly ?? forVat).currency,
    };
  }

  // ------------------------------------------------------------- yardımcılar

  serialize(a: AgreementWithRelations) {
    return {
      id: a.id,
      clientId: a.clientId,
      client: a.client,
      caseId: a.caseId,
      case: a.case,
      type: a.type,
      amount: a.amount === null ? null : moneyOut(a.amount),
      hourlyRate: a.hourlyRate === null ? null : moneyOut(a.hourlyRate),
      successPercent: a.successPercent === null ? null : rateOut(a.successPercent),
      currency: a.currency,
      vatRate: rateOut(a.vatRate),
      startDate: a.startDate,
      endDate: a.endDate,
      terms: a.terms,
      status: a.status,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    };
  }

  private assertTypeRequirements(data: {
    type: string;
    amount: string | null;
    hourlyRate: string | null;
    successPercent: string | null;
  }): void {
    const has = (v: string | null) => v !== null && v !== "";
    const fail = (message: string) => {
      throw new BadRequestException(message);
    };

    switch (data.type) {
      case "SABIT":
      case "DOSYA_BAZLI":
      case "AYLIK_DANISMANLIK":
        if (!has(data.amount)) fail("Bu sözleşme tipinde sözleşme bedeli (amount) zorunludur.");
        break;
      case "SAATLIK":
        if (!has(data.hourlyRate)) fail("Saatlik sözleşmede saat ücreti (hourlyRate) zorunludur.");
        break;
      case "BASARI_PRIMI":
        if (!has(data.successPercent)) {
          fail("Başarı primli sözleşmede prim oranı (successPercent) zorunludur.");
        }
        break;
      case "KARMA":
        if (!has(data.amount) && !has(data.hourlyRate)) {
          fail("Karma sözleşmede sabit bedel veya saat ücretinden en az biri zorunludur.");
        }
        break;
    }
  }

  private async requireAgreement(tenantId: string, id: string) {
    const found = await this.prisma.client.feeAgreement.findFirst({
      where: { id, tenantId },
    });
    if (!found) throw new NotFoundException("Ücret sözleşmesi bulunamadı.");
    return found;
  }

  private async requireClient(tenantId: string, clientId: string) {
    const client = await this.prisma.client.client.findFirst({
      where: { id: clientId, tenantId },
      select: { id: true, name: true },
    });
    if (!client) throw new BadRequestException("Müvekkil bulunamadı.");
    return client;
  }

  private async requireCaseOfClient(tenantId: string, caseId: string, clientId: string) {
    const found = await this.prisma.client.case.findFirst({
      where: { id: caseId, tenantId },
      select: { id: true, clientId: true },
    });
    if (!found) throw new BadRequestException("Dosya bulunamadı.");
    if (found.clientId !== clientId) {
      throw new BadRequestException("Seçilen dosya bu müvekkile ait değil.");
    }
    return found;
  }
}
