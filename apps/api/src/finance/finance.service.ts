import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { ExportEntry } from "./finance-export";
import { Prisma, type FinancialEntryType } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../common/types";
import { normalizeQuery, paged, resolvePage } from "../common/pagination";
import { endOfDay, parseDateParam, startOfDay } from "../common/dates";
import { assertFinanceAccess, FINANCE_ACCESS } from "./finance-access";
import { dec, formatMoneyTr, fromSum, moneyOut, rateOut } from "./money";
import {
  FINANCIAL_ENTRY_TYPES,
  type CreateFinancialEntryInput,
  type FinanceEntryListParams,
  type FinancialEntryTypeValue,
  type UpdateFinancialEntryInput,
} from "./finance.dto";

/** Liste ve detay yanıtlarında dönen ilişki alanları. */
const ENTRY_INCLUDE = {
  client: { select: { id: true, name: true, type: true } },
  case: { select: { id: true, title: true, fileNumber: true, status: true } },
} satisfies Prisma.FinancialEntryInclude;

type EntryWithRelations = Prisma.FinancialEntryGetPayload<{ include: typeof ENTRY_INCLUDE }>;

/**
 * Aktif `$transaction` istemcisi.
 *
 * Ö-12: avans bakiyesi okuması, o bakiyeyi koruyan kilidin ARKASINDA yapılmak
 * zorundadır; bu yüzden okuma fonksiyonları transaction istemcisini alabilmelidir.
 */
type FinanceTx = Omit<
  Prisma.TransactionClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * Modül 08 — Finans hareketleri (FinancialEntry) CRUD'u.
 *
 * TASARIM NOTLARI
 *
 * 1. TENANT SÜZGECİ: her sorgu `tenantId` içerir; müvekkil ve dosya kimlikleri
 *    yazma öncesi ayrıca tenant'a ait mi diye doğrulanır (başka büronun id'si
 *    ile yapılan istek 400/404 alır, veri sızmaz).
 *
 * 2. FATURALANMIŞ KAYIT DEĞİŞTİRİLEMEZ: `invoiceId` dolu bir hareket PATCH/DELETE
 *    edilemez (409). Faturaya yansımış bir tutarın geriye dönük değiştirilmesi,
 *    kesilmiş faturayla muhasebe kaydını çelişkiye düşürür. Düzeltme yolu:
 *    faturayı iptal et (bağ çözülür) veya TERS KAYIT (storno) gir.
 *
 * 3. AVANS MAHSUBU: masraf/harç kaydı `isBillable: false` ile girildiğinde
 *    "müvekkilden alınan avanstan karşılandı" anlamına gelir. Bu durumda avans
 *    bakiyesi kontrol edilir ve bakiye eksiye düşecekse istek 400 ile reddedilir
 *    (Modül 08, iş kuralı 3).
 *
 * 4. PARA: hiçbir yerde `number` aritmetiği yok; tüm toplamlar Prisma.Decimal.
 */
@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ liste

  /** Faz 6 — Luca/Logo dışa aktarımı için düz kayıt listesi (en fazla 5000). */
  async exportEntries(user: AuthUser, params: { from?: string; to?: string; clientId?: string }): Promise<ExportEntry[]> {
    assertFinanceAccess(user, FINANCE_ACCESS.READ, "muhasebe dışa aktarımı");
    const where = this.buildWhere(user.tenantId, { from: params.from, to: params.to, clientId: params.clientId });
    const rows = await this.prisma.client.financialEntry.findMany({ where, include: ENTRY_INCLUDE, orderBy: [{ date: "asc" }, { createdAt: "asc" }], take: 5000 });
    return rows.map((r) => ({
      date: r.date,
      type: r.type,
      amount: r.amount.toFixed(2),
      currency: r.currency,
      description: r.description,
      clientName: (r as { client?: { name?: string } | null }).client?.name ?? null,
      caseLabel: (r as { case?: { title?: string; fileNumber?: string | null } | null }).case ? `${(r as { case?: { fileNumber?: string | null } }).case?.fileNumber ?? ""} ${(r as { case?: { title?: string } }).case?.title ?? ""}`.trim() : null,
      vatRate: r.vatRate ? r.vatRate.toFixed(2) : null,
    }));
  }

  async list(user: AuthUser, params: FinanceEntryListParams) {
    assertFinanceAccess(user, FINANCE_ACCESS.READ, "finans kayıtlarını görüntüleme");
    const pageParams = resolvePage(params);
    const where = this.buildWhere(user.tenantId, params);

    const [items, total, sums] = await Promise.all([
      this.prisma.client.financialEntry.findMany({
        where,
        include: ENTRY_INCLUDE,
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        skip: pageParams.skip,
        take: pageParams.take,
      }),
      this.prisma.client.financialEntry.count({ where }),
      // Süzgece uyan TÜM kayıtların (sayfa değil) para birimi bazlı toplamı.
      this.prisma.client.financialEntry.groupBy({
        by: ["currency", "type"],
        where,
        _sum: { amount: true },
      }),
    ]);

    return {
      ...paged(items.map((e) => this.serialize(e)), total, pageParams),
      totalsByCurrency: this.foldTypeSums(sums),
    };
  }

  async detail(user: AuthUser, id: string) {
    assertFinanceAccess(user, FINANCE_ACCESS.READ, "finans kaydı görüntüleme");
    const entry = await this.prisma.client.financialEntry.findFirst({
      where: { id, tenantId: user.tenantId },
      include: ENTRY_INCLUDE,
    });
    if (!entry) throw new NotFoundException("Finans kaydı bulunamadı.");
    return this.serialize(entry);
  }

  // ---------------------------------------------------------------- oluştur

  async create(user: AuthUser, input: CreateFinancialEntryInput) {
    assertFinanceAccess(user, FINANCE_ACCESS.ENTRY_WRITE, "finans hareketi oluşturma");

    const client = await this.requireClient(user.tenantId, input.clientId);
    if (input.caseId) {
      await this.requireCaseOfClient(user.tenantId, input.caseId, input.clientId);
    }

    const amount = dec(input.amount);
    const date = input.date ?? new Date();

    /**
     * AVANS BAKİYESİ KONTROLÜ YAZMA İŞLEMİYLE AYNI TRANSACTION'DADIR
     * (denetim bulgusu Ö-12).
     *
     * Eskiden `assertAdvanceCovers` transaction'ın DIŞINDAYDI ve `create` ayrı,
     * kilitsiz bir çağrıydı. İki eşzamanlı `POST /finance/entries` (MASRAF,
     * 10.000,00) isteği AYNI 10.000 TL'lik bakiyeyi okuyor, ikisi de kapıdan
     * geçiyor, ikisi de yazıyordu → avans bakiyesi −10.000,00 TL. İş kuralı 3
     * ("bakiye eksiye düşemez") ihlal ediliyordu.
     *
     * Doğru desen AYNI DEPODA yazılıydı: `payments.service.ts:122-126`
     * `$transaction` + `SELECT … FOR UPDATE`; oradaki yorum tam bu sınıf hatanın
     * (denetim bulgusu 4) nasıl kapatıldığını anlatıyor. Finans tarafına
     * uygulanmamıştı.
     *
     * KİLİT NESNESİ: müvekkil satırı. Avans bakiyesi `FinancialEntry`
     * satırlarının toplamıdır; toplamı kilitlemenin yolu, o toplamı besleyen
     * TÜM satırların sahibi olan `Client` satırını kilitlemektir. İkinci istek
     * birincinin yazması bitene kadar bekler ve GÜNCEL bakiyeyi okur.
     */
    const created = await this.prisma.client.$transaction(async (tx) => {
      if (this.isAdvanceSettlement(input.type, input.isBillable)) {
        await tx.$executeRaw`SELECT id FROM "Client" WHERE id = ${input.clientId} AND "tenantId" = ${user.tenantId} FOR UPDATE`;
        await this.assertAdvanceCovers(
          tx,
          user.tenantId,
          input.clientId,
          input.currency,
          amount,
          null,
        );
      }

      return tx.financialEntry.create({
        data: {
          tenantId: user.tenantId,
          clientId: input.clientId,
          caseId: input.caseId ?? null,
          type: input.type as FinancialEntryType,
          amount,
          currency: input.currency,
          date,
          description: input.description ?? null,
          isBillable: input.isBillable,
          vatRate: input.vatRate === null || input.vatRate === undefined ? null : dec(input.vatRate),
        },
        include: ENTRY_INCLUDE,
      });
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "FINANCE_ENTRY_CREATE",
      entity: "FinancialEntry",
      entityId: created.id,
      detail: `${input.type} ${formatMoneyTr(amount, input.currency)} — ${client.name}`,
    });
    return this.serialize(created);
  }

  // -------------------------------------------------------------- güncelle

  async update(user: AuthUser, id: string, input: UpdateFinancialEntryInput) {
    assertFinanceAccess(user, FINANCE_ACCESS.ENTRY_WRITE, "finans hareketi güncelleme");
    const existing = await this.requireEntry(user.tenantId, id);
    this.assertNotInvoiced(existing, "değiştirilemez");

    if (input.caseId) {
      await this.requireCaseOfClient(user.tenantId, input.caseId, existing.clientId);
    }

    const nextType = (input.type ?? existing.type) as FinancialEntryTypeValue;
    const nextBillable = input.isBillable ?? existing.isBillable;
    const nextCurrency = input.currency ?? existing.currency;
    const nextAmount = input.amount === undefined ? dec(existing.amount) : dec(input.amount);

    // Ö-12: kontrol ve yazma AYNI transaction'da, müvekkil satırı kilitli.
    const updated = await this.prisma.client.$transaction(async (tx) => {
      if (this.isAdvanceSettlement(nextType, nextBillable)) {
        const clientId = existing.clientId ?? "";
        await tx.$executeRaw`SELECT id FROM "Client" WHERE id = ${clientId} AND "tenantId" = ${user.tenantId} FOR UPDATE`;
        // Kaydın kendisi bakiyeden düşülmüş sayıldığı için hesaptan HARİÇ tutulur.
        await this.assertAdvanceCovers(tx, user.tenantId, clientId, nextCurrency, nextAmount, existing.id);
      }

      return tx.financialEntry.update({
        where: { id },
        data: {
          ...(input.caseId !== undefined ? { caseId: input.caseId } : {}),
          ...(input.type !== undefined ? { type: input.type as FinancialEntryType } : {}),
          ...(input.amount !== undefined ? { amount: nextAmount } : {}),
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          ...(input.date !== undefined ? { date: input.date } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.isBillable !== undefined ? { isBillable: input.isBillable } : {}),
          ...(input.vatRate !== undefined
            ? { vatRate: input.vatRate === null ? null : dec(input.vatRate) }
            : {}),
        },
        include: ENTRY_INCLUDE,
      });
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "FINANCE_ENTRY_UPDATE",
      entity: "FinancialEntry",
      entityId: id,
      detail: `Güncellenen alanlar: ${Object.keys(input).join(", ")}`,
    });
    return this.serialize(updated);
  }

  // ------------------------------------------------------------------- sil

  async remove(user: AuthUser, id: string) {
    assertFinanceAccess(user, FINANCE_ACCESS.ENTRY_WRITE, "finans hareketi silme");
    const existing = await this.requireEntry(user.tenantId, id);
    this.assertNotInvoiced(existing, "silinemez");

    await this.prisma.client.financialEntry.delete({ where: { id } });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "FINANCE_ENTRY_DELETE",
      entity: "FinancialEntry",
      entityId: id,
      detail: `${existing.type} ${formatMoneyTr(existing.amount, existing.currency)}`,
    });
    return { ok: true, id };
  }

  // ------------------------------------------------------------- yardımcılar

  /** Diğer servislerin (faturalama) aynı biçimi üretebilmesi için dışa açık. */
  serialize(entry: EntryWithRelations) {
    return {
      id: entry.id,
      clientId: entry.clientId,
      client: entry.client,
      caseId: entry.caseId,
      case: entry.case,
      type: entry.type,
      amount: moneyOut(entry.amount),
      amountFormatted: formatMoneyTr(entry.amount, entry.currency),
      currency: entry.currency,
      date: entry.date,
      description: entry.description,
      invoiceId: entry.invoiceId,
      isBillable: entry.isBillable,
      vatRate: entry.vatRate === null ? null : rateOut(entry.vatRate),
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  }

  private buildWhere(tenantId: string, params: FinanceEntryListParams): Prisma.FinancialEntryWhereInput {
    const where: Prisma.FinancialEntryWhereInput = { tenantId };

    if (params.clientId) where.clientId = params.clientId;
    if (params.caseId) where.caseId = params.caseId;
    if (params.type) {
      const types = params.type
        .split(",")
        .map((t) => t.trim().toUpperCase())
        .filter((t) => t.length > 0);
      const invalid = types.find((t) => !(FINANCIAL_ENTRY_TYPES as readonly string[]).includes(t));
      if (invalid) throw new BadRequestException(`Geçersiz finans hareketi tipi: ${invalid}`);
      where.type = { in: types as FinancialEntryType[] };
    }
    if (params.currency) {
      const code = normalizeQuery(params.currency)?.toUpperCase();
      if (code && !/^[A-Z]{3}$/.test(code)) {
        throw new BadRequestException("Para birimi üç harfli ISO kodu olmalıdır.");
      }
      if (code) where.currency = code;
    }
    if (params.from || params.to) {
      where.date = {
        ...(params.from ? { gte: startOfDay(parseDateParam(params.from, "başlangıç")) } : {}),
        ...(params.to ? { lte: endOfDay(parseDateParam(params.to, "bitiş")) } : {}),
      };
    }
    if (params.invoiced === "true") where.invoiceId = { not: null };
    if (params.invoiced === "false") where.invoiceId = null;
    if (params.isBillable === "true") where.isBillable = true;
    if (params.isBillable === "false") where.isBillable = false;

    return where;
  }

  /** groupBy(currency,type) sonucunu para birimi bazlı sözlüğe indirger. */
  private foldTypeSums(
    rows: { currency: string; type: FinancialEntryType; _sum: { amount: Prisma.Decimal | null } }[],
  ) {
    const map = new Map<string, Record<string, Prisma.Decimal>>();
    for (const row of rows) {
      const bucket = map.get(row.currency) ?? {};
      bucket[row.type] = fromSum(row._sum.amount);
      map.set(row.currency, bucket);
    }
    return [...map.entries()].map(([currency, byType]) => ({
      currency,
      byType: Object.fromEntries(
        Object.entries(byType).map(([type, amount]) => [type, moneyOut(amount)]),
      ),
    }));
  }

  private isAdvanceSettlement(type: string, isBillable: boolean): boolean {
    return (type === "MASRAF" || type === "HARC") && isBillable === false;
  }

  /**
   * AVANS BAKİYESİ KONTROLÜ (Modül 08, iş kuralı 3).
   *
   * Bakiye = Σ(AVANS) − Σ(yansıtılmayan MASRAF + HARC). Bakiye eksiye düşemez;
   * düşecekse istek 400 ile reddedilir ve kullanıcıya kalan avans bildirilir.
   */
  private async assertAdvanceCovers(
    tx: FinanceTx,
    tenantId: string,
    clientId: string,
    currency: string,
    amount: Prisma.Decimal,
    excludeEntryId: string | null,
  ): Promise<void> {
    const balance = await this.advanceBalance(tenantId, clientId, currency, excludeEntryId, tx);
    if (balance.lt(amount)) {
      throw new BadRequestException(
        `Avans bakiyesi yetersiz. Mahsup edilmek istenen tutar ${formatMoneyTr(amount, currency)}, ` +
          `kullanılabilir avans bakiyesi ${formatMoneyTr(balance, currency)}. ` +
          "Önce avans tahsilatı girin veya masrafı yansıtılabilir (isBillable: true) olarak kaydedin.",
      );
    }
  }

  /** Tek müvekkil + tek para birimi için avans bakiyesi. */
  async advanceBalance(
    tenantId: string,
    clientId: string,
    currency: string,
    excludeEntryId: string | null = null,
    /**
     * Aktif transaction istemcisi. Ö-12: bakiye okuması, onu koruyan kilidin
     * ARKASINDA yapılmalıdır; dışarıdan okunan bakiye yazma anında bayat olur.
     */
    tx?: FinanceTx,
  ): Promise<Prisma.Decimal> {
    const db = tx ?? this.prisma.client;
    const rows = await db.financialEntry.groupBy({
      by: ["type"],
      where: {
        tenantId,
        clientId,
        currency,
        ...(excludeEntryId ? { id: { not: excludeEntryId } } : {}),
        OR: [{ type: "AVANS" }, { type: { in: ["MASRAF", "HARC"] }, isBillable: false }],
      },
      _sum: { amount: true },
    });

    let received = new Prisma.Decimal(0);
    let applied = new Prisma.Decimal(0);
    for (const row of rows) {
      if (row.type === "AVANS") received = received.plus(fromSum(row._sum.amount));
      else applied = applied.plus(fromSum(row._sum.amount));
    }
    return received.minus(applied);
  }

  private assertNotInvoiced(entry: { invoiceId: string | null }, verb: string): void {
    if (entry.invoiceId) {
      throw new ConflictException(
        `Bu finans kaydı bir faturaya işlenmiş olduğu için ${verb}. ` +
          "Önce ilgili faturayı iptal edin ya da düzeltme için ters kayıt (storno) girin.",
      );
    }
  }

  private async requireEntry(tenantId: string, id: string) {
    const entry = await this.prisma.client.financialEntry.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        clientId: true,
        caseId: true,
        type: true,
        amount: true,
        currency: true,
        invoiceId: true,
        isBillable: true,
      },
    });
    if (!entry) throw new NotFoundException("Finans kaydı bulunamadı.");
    return entry;
  }

  private async requireClient(tenantId: string, clientId: string) {
    const client = await this.prisma.client.client.findFirst({
      where: { id: clientId, tenantId },
      select: { id: true, name: true },
    });
    if (!client) throw new BadRequestException("Müvekkil bulunamadı.");
    return client;
  }

  private async requireCaseOfClient(tenantId: string, caseId: string, clientId: string | null) {
    const found = await this.prisma.client.case.findFirst({
      where: { id: caseId, tenantId },
      select: { id: true, clientId: true, title: true },
    });
    if (!found) throw new BadRequestException("Dosya bulunamadı.");
    if (clientId && found.clientId !== clientId) {
      throw new BadRequestException("Seçilen dosya bu müvekkile ait değil.");
    }
    return found;
  }
}
