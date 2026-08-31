import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma, type InvoiceStatus } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../common/types";
import { paged, resolvePage } from "../common/pagination";
import {
  endOfDay,
  formatTrDate,
  parseDateParam,
  startOfDay,
  trCalendarYear,
} from "../common/dates";
import { assertFinanceAccess, FINANCE_ACCESS } from "../finance/finance-access";
import { ACCRUAL_TYPES } from "../finance/finance.dto";
import { dec, formatMoneyTr, fromSum, minutesToHours, moneyOut, rateOut } from "../finance/money";
import { computeInvoiceTotals, resolvePaymentStatus, type InvoiceLineInput } from "./invoice-math";
import {
  InvoiceNumberService,
  resolveSeriesPrefix,
  withInvoiceNumberRetry,
} from "./invoice-number.service";
import { FeeAgreementsService } from "./fee-agreements.service";
import { EInvoiceService } from "./e-invoice/e-invoice.service";
import { buildUblInvoicePayload, resolveCustomerIdentification } from "./e-invoice/ubl-tr-mapping";
import {
  INVOICE_STATUSES,
  type CancelInvoiceInput,
  type CreateInvoiceInput,
  type FinalizeInvoiceInput,
  type InvoiceFromTimeEntriesInput,
  type InvoiceLineInputDto,
  type UpdateInvoiceInput,
} from "./billing.dto";

/**
 * OTOMATİK ÜRETİLEN FİNANS KAYITLARININ İMZASI.
 *
 * Fatura kesinleştiğinde tahakkuk, ödeme girildiğinde tahsilat kaydı üretilir.
 * Bu kayıtların iptalde geri alınabilmesi için açıklamalarına sabit bir imza
 * konur; böylece kullanıcının ELLE girdiği kayıtlarla karışmazlar.
 */
export const AUTO_ACCRUAL_MARKER = "[OTO-TAHAKKUK]";
export const AUTO_COLLECTION_MARKER = "[OTO-TAHSILAT]";

const INVOICE_INCLUDE = {
  client: {
    select: {
      id: true,
      name: true,
      type: true,
      tckn: true,
      taxNumber: true,
      taxOffice: true,
      address: true,
      email: true,
      phone: true,
    },
  },
  lines: true,
  payments: { orderBy: { date: "desc" } },
} satisfies Prisma.InvoiceInclude;

type InvoiceWithRelations = Prisma.InvoiceGetPayload<{ include: typeof INVOICE_INCLUDE }>;

export interface InvoiceListParams {
  status?: string;
  clientId?: string;
  from?: string;
  to?: string;
  eInvoiceStatus?: string;
  page?: string;
  limit?: string;
}

/**
 * Modül 09 — Faturalar.
 *
 * ═══════════════════════ DETERMİNİSTİK TUTAR SÖZLEŞMESİ ═══════════════════════
 * Fatura toplamları HER YAZMADA satırlardan yeniden hesaplanır
 * (`computeInvoiceTotals`); istemcinin gönderdiği hiçbir toplam kabul edilmez.
 * AI hiçbir tutar alanına yazamaz — bu modülde LLM çağrısı YOKTUR.
 *
 * ═══════════════════════ ÇİFT FATURALAMA KORUMASI ═══════════════════════
 * Bir zaman kaydı veya masraf kalemi İKİ FATURAYA giremez. Koruma üç katmanlı:
 *   1. Kaynak kayıtlar TASLAK OLUŞTURULURKEN işaretlenir (`invoiceId`), fatura
 *      kesinleşince değil — aksi hâlde iki taslak aynı kayıtları içerebilirdi.
 *   2. İşaretleme `updateMany({ where: { id: { in: … }, invoiceId: null } })`
 *      ile yapılır ve ETKİLENEN SATIR SAYISI beklenene eşit değilse işlem
 *      GERİ ALINIR (409). Bu, iki eşzamanlı isteğin aynı kaydı kapmasını
 *      veritabanı düzeyinde engeller — `SELECT` ile kontrol edip sonra
 *      `UPDATE` etmek yarış koşuluna açıktı.
 *   3. Fatura silinir/iptal edilirse bağ çözülür ve kayıtlar yeniden
 *      faturalanabilir hâle gelir.
 *
 * ═══════════════════════ FİNANSLA MUTABAKAT ═══════════════════════
 * Kesinleştirmede bir `FinancialEntry(TAHAKKUK)` üretilir; tutarı
 * `fatura toplamı − faturaya kaynak olan MEVCUT tahakkuk kayıtları` kadardır.
 * Böylece aynı alacak iki kez sayılmaz (bkz. `syncInvoiceAccrual`).
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbers: InvoiceNumberService,
    private readonly agreements: FeeAgreementsService,
    private readonly eInvoice: EInvoiceService,
  ) {}

  // ================================================================== LİSTE

  async list(user: AuthUser, params: InvoiceListParams) {
    assertFinanceAccess(user, FINANCE_ACCESS.READ, "faturaları görüntüleme");
    const pageParams = resolvePage(params);
    const where: Prisma.InvoiceWhereInput = { tenantId: user.tenantId };

    if (params.status) {
      const statuses = params.status.split(",").map((s) => s.trim().toUpperCase());
      const invalid = statuses.find((s) => !(INVOICE_STATUSES as readonly string[]).includes(s));
      if (invalid) throw new BadRequestException(`Geçersiz fatura durumu: ${invalid}`);
      where.status = { in: statuses as InvoiceStatus[] };
    }
    if (params.clientId) where.clientId = params.clientId;
    if (params.from || params.to) {
      where.issueDate = {
        ...(params.from ? { gte: startOfDay(parseDateParam(params.from, "başlangıç")) } : {}),
        ...(params.to ? { lte: endOfDay(parseDateParam(params.to, "bitiş")) } : {}),
      };
    }

    const [items, total] = await Promise.all([
      this.prisma.client.invoice.findMany({
        where,
        include: INVOICE_INCLUDE,
        orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
        skip: pageParams.skip,
        take: pageParams.take,
      }),
      this.prisma.client.invoice.count({ where }),
    ]);
    return paged(items.map((i) => this.serialize(i)), total, pageParams);
  }

  async detail(user: AuthUser, id: string) {
    assertFinanceAccess(user, FINANCE_ACCESS.READ, "fatura görüntüleme");
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id, tenantId: user.tenantId },
      include: INVOICE_INCLUDE,
    });
    if (!invoice) throw new NotFoundException("Fatura bulunamadı.");
    return this.serialize(invoice);
  }

  // ============================================================ OLUŞTURMA

  /** POST /billing/invoices — elle girilen satırlarla taslak fatura. */
  async create(user: AuthUser, input: CreateInvoiceInput) {
    assertFinanceAccess(user, FINANCE_ACCESS.INVOICE_DRAFT, "fatura oluşturma");
    const client = await this.requireClient(user.tenantId, input.clientId);

    const totals = computeInvoiceTotals(input.lines.map((l) => this.toLineInput(l)));
    const timeEntryIds = this.collectSourceIds(input.lines, "TIME_ENTRY");
    const expenseEntryIds = this.collectSourceIds(input.lines, "EXPENSE");

    // Kaynak kayıtların tenant'a ait ve serbest olduğu, işaretleme sırasında
    // atomik olarak doğrulanır (aşağıdaki updateMany sayı kontrolü).
    const created = await this.prisma.client.$transaction(async (tx) => {
      const invoice = await tx.invoice.create({
        data: {
          tenantId: user.tenantId,
          clientId: input.clientId,
          issueDate: input.issueDate ?? new Date(),
          dueDate: input.dueDate ?? null,
          subtotal: totals.subtotal,
          vatAmount: totals.vatAmount,
          total: totals.total,
          currency: input.currency,
          status: "TASLAK",
          note: input.note ?? null,
          createdBy: user.userId,
          lines: {
            create: totals.lines.map((l) => ({
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              vatRate: l.vatRate,
              lineTotal: l.lineTotal,
              sourceType: l.sourceType,
              sourceId: l.sourceId,
            })),
          },
        },
        include: INVOICE_INCLUDE,
      });

      await this.claimTimeEntries(tx, user.tenantId, input.clientId, timeEntryIds, invoice.id);
      await this.claimFinancialEntries(tx, user.tenantId, input.clientId, expenseEntryIds, invoice.id);
      return invoice;
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "INVOICE_CREATE",
      entity: "Invoice",
      entityId: created.id,
      detail: `${client.name} — ${formatMoneyTr(created.total, created.currency)} (TASLAK, ${totals.lines.length} satır)`,
    });
    return this.serialize(created);
  }

  /**
   * POST /billing/invoices/from-time-entries
   *
   * Faturalanmamış zaman kayıtlarından satır üretir. Satırlar
   * (kullanıcı × dosya × saat ücreti) bazında GRUPLANIR: aynı avukatın aynı
   * dosyadaki çalışmaları tek satırda toplanır, böylece hem fatura okunur olur
   * hem de saat yuvarlaması yalnız bir kez uygulanır.
   */
  async createFromTimeEntries(user: AuthUser, input: InvoiceFromTimeEntriesInput) {
    assertFinanceAccess(user, FINANCE_ACCESS.INVOICE_DRAFT, "fatura oluşturma");
    const client = await this.requireClient(user.tenantId, input.clientId);

    const from = startOfDay(input.from);
    const to = endOfDay(input.to);

    const candidates = await this.prisma.client.timeEntry.findMany({
      where: {
        tenantId: user.tenantId,
        clientId: input.clientId,
        billable: true,
        invoiceId: null,
        date: { gte: from, lte: to },
        ...(input.caseId ? { caseId: input.caseId } : {}),
        ...(input.timeEntryIds?.length ? { id: { in: input.timeEntryIds } } : {}),
      },
      include: {
        user: { select: { id: true, fullName: true } },
        case: { select: { id: true, title: true, fileNumber: true } },
      },
      orderBy: [{ userId: "asc" }, { caseId: "asc" }, { date: "asc" }],
    });

    // Açıkça id verildiyse, istenip de alınamayanları KULLANICIYA SÖYLE.
    // Bu kontrol boşluk kontrolünden ÖNCE gelir: "hiç kayıt yok" genel mesajı
    // yerine, hangi kayıtların neden alınamadığı bildirilir.
    if (input.timeEntryIds?.length) {
      const found = new Set(candidates.map((c) => c.id));
      const missing = input.timeEntryIds.filter((id) => !found.has(id));
      if (missing.length > 0) {
        throw new BadRequestException({
          message:
            "Seçilen zaman kayıtlarından bazıları faturalanamaz: zaten faturalanmış, " +
            "faturalanabilir işaretli değil, başka müvekkile ait ya da tarih aralığı dışında.",
          unavailableTimeEntryIds: missing,
        });
      }
    }

    if (candidates.length === 0) {
      throw new BadRequestException(
        "Seçilen aralıkta faturalanabilir ve henüz faturalanmamış zaman kaydı bulunamadı. " +
          "Kayıtlar zaten faturalanmış, faturalanamaz (billable=false) veya aralık dışında olabilir.",
      );
    }

    /**
     * SAAT ÜCRETİ, KAYDIN KENDİ TARİHİNE GÖRE ÇÖZÜLÜR (denetim bulgusu Ö-15).
     *
     * Eskiden referans tarih `input.issueDate ?? new Date()` — yani FATURANIN
     * DÜZENLEME TARİHİ — idi ve önbellek anahtarı tarih içermiyordu. Sonucu:
     *   Sözleşme A: 5.000 TL/saat (01.01–30.06.2026)
     *   Sözleşme B: 8.000 TL/saat (01.07.2026'dan itibaren)
     *   Mart 2026'da girilmiş 10 saat, 15.08.2026 tarihli faturaya alınır
     *   → 80.000,00 TL + KDV kesilir; DOĞRUSU 50.000,00 TL'dir.
     * Müvekkile fazla fatura kesiliyordu.
     *
     * Kârlılık raporu bu işi ZATEN DOĞRU yapıyordu (`karlilik.report.ts`:
     * `fa2."startDate" <= t."date" AND (fa2."endDate" IS NULL OR fa2."endDate" >= t."date")`),
     * yani iki modül aynı emeği farklı ücretle değerliyordu.
     *
     * `FeeAgreementsService.resolveBillingTerms` `referenceDate` parametresini
     * zaten alıyordu; çağıran yanlış tarihi geçiyordu. Önbellek anahtarına da
     * tarih eklendi — aksi hâlde ilk kaydın ücreti sonrakilere yapışırdı.
     */
    const termsCache = new Map<string, Awaited<ReturnType<FeeAgreementsService["resolveBillingTerms"]>>>();
    const resolveTerms = async (caseId: string | null, referenceDate: Date) => {
      const key = `${caseId ?? "__NULL__"}|${referenceDate.toISOString().slice(0, 10)}`;
      const cached = termsCache.get(key);
      if (cached) return cached;
      const resolved = await this.agreements.resolveBillingTerms(
        user.tenantId,
        input.clientId,
        caseId,
        referenceDate,
      );
      termsCache.set(key, resolved);
      return resolved;
    };

    interface Group {
      userId: string;
      userName: string;
      caseId: string | null;
      caseLabel: string;
      rate: Prisma.Decimal;
      vatRate: Prisma.Decimal;
      currency: string;
      minutes: number;
      entryIds: string[];
    }
    const groups = new Map<string, Group>();
    const unrated: { id: string; description: string; caseLabel: string }[] = [];
    /** Karşılaşılan para birimleri — birden fazlaysa fatura KESİLMEZ. */
    const currencies = new Map<string, string[]>();

    for (const entry of candidates) {
      // Ö-15: referans, faturanın tarihi DEĞİL, ÇALIŞMANIN yapıldığı tarihtir.
      const terms = await resolveTerms(entry.caseId, entry.date);
      const rate = entry.hourlyRate ? dec(entry.hourlyRate) : terms.hourlyRate;
      const caseLabel = entry.case ? (entry.case.fileNumber ?? entry.case.title) : "Dosyasız çalışma";

      if (!rate) {
        unrated.push({ id: entry.id, description: entry.description, caseLabel });
        continue;
      }

      /**
       * PARA BİRİMİ GRUP ANAHTARININ PARÇASIDIR (denetim bulgusu 2).
       *
       * Eski anahtar `userId|caseId|rate|vatRate` idi ve para birimi hiç yer
       * almıyordu; fatura para birimi ise İLK çözülen sözleşmeninkine
       * sabitlenip sonrakiler SESSİZCE yok sayılıyordu. Aynı müvekkilin A
       * dosyasında USD 300/saat, B dosyasında TRY 5.000/saat sözleşmesi varsa
       * tek çağrı 300 ile 5.000'i aynı `subtotal` içinde topluyordu.
       * `computeInvoiceTotals` bunu yakalayamaz — Decimal aritmetiği doğrudur,
       * GİRDİ anlamsızdır. Sonra `syncInvoiceAccrual` bu tutarı finansa yazıyor
       * ve `FinanceSummaryService`'in "farklı para birimleri KESİNLİKLE
       * toplanmaz" sözleşmesi KAYNAĞINDA bozuluyordu.
       *
       * Kur çevrimi yapılmayan bir sistemde karışık girdi hesaplanamaz;
       * `unrated` bloğuyla aynı mantıkla REDDEDİLİR.
       */
      const entryCurrency = terms.currency ?? "TRY";
      const seen = currencies.get(entryCurrency) ?? [];
      seen.push(entry.id);
      currencies.set(entryCurrency, seen);

      const vatRate = input.vatRate ? dec(input.vatRate) : terms.vatRate;
      const key =
        `${entry.userId}|${entry.caseId ?? "-"}|${rate.toFixed(2)}|` +
        `${vatRate.toFixed(2)}|${entryCurrency}`;
      const group = groups.get(key) ?? {
        userId: entry.userId,
        userName: entry.user.fullName,
        caseId: entry.caseId,
        caseLabel,
        rate,
        vatRate,
        currency: entryCurrency,
        minutes: 0,
        entryIds: [],
      };
      group.minutes += entry.minutes;
      group.entryIds.push(entry.id);
      groups.set(key, group);
    }

    if (unrated.length > 0) {
      throw new BadRequestException({
        message:
          "Bazı zaman kayıtları için saat ücreti belirlenemedi. Saat ücreti ya kaydın " +
          "kendisinde ya da müvekkile/dosyaya ait AKTİF saatlik ücret sözleşmesinde " +
          "tanımlı olmalıdır. Tutar UYDURULMAZ; bu yüzden fatura oluşturulmadı.",
        unratedTimeEntries: unrated,
      });
    }

    if (currencies.size > 1) {
      throw new BadRequestException({
        message:
          "Seçilen zaman kayıtları FARKLI PARA BİRİMLERİNDEKİ ücret sözleşmelerine bağlı " +
          `(${[...currencies.keys()].join(", ")}). NomosOS kur çevrimi yapmaz; farklı para ` +
          "birimleri tek faturada toplanamaz — toplanırsa tutar anlamsız olur ve müvekkil " +
          "carisi bozulur. Her para birimi için AYRI fatura kesin.",
        mixedCurrencies: [...currencies.keys()],
        timeEntryIdsByCurrency: Object.fromEntries(currencies),
      });
    }

    const currency = [...currencies.keys()][0] ?? "TRY";

    const lines: InvoiceLineInput[] = [...groups.values()].map((g) => ({
      description:
        `${g.userName} — ${g.caseLabel} (${formatTrDate(from)}–${formatTrDate(to)}), ` +
        `${g.minutes} dk`,
      quantity: minutesToHours(g.minutes),
      unitPrice: g.rate,
      vatRate: g.vatRate,
      sourceType: "TIME_ENTRY",
      // Grup birden çok kaydı temsil eder; kaynak izi `sourceId` yerine
      // TimeEntry.invoiceId üzerinden kurulur (çoklu kaynak tek satır).
      sourceId: null,
    }));

    const totals = computeInvoiceTotals(lines);
    const allEntryIds = [...groups.values()].flatMap((g) => g.entryIds);

    const created = await this.prisma.client.$transaction(async (tx) => {
      const invoice = await tx.invoice.create({
        data: {
          tenantId: user.tenantId,
          clientId: input.clientId,
          issueDate: input.issueDate ?? new Date(),
          dueDate: input.dueDate ?? null,
          subtotal: totals.subtotal,
          vatAmount: totals.vatAmount,
          total: totals.total,
          currency,
          status: "TASLAK",
          note: input.note ?? null,
          createdBy: user.userId,
          lines: {
            create: totals.lines.map((l) => ({
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              vatRate: l.vatRate,
              lineTotal: l.lineTotal,
              sourceType: l.sourceType,
              sourceId: l.sourceId,
            })),
          },
        },
        include: INVOICE_INCLUDE,
      });

      // ÇİFT FATURALAMA KORUMASI — atomik sahiplenme.
      await this.claimTimeEntries(tx, user.tenantId, input.clientId, allEntryIds, invoice.id);
      return invoice;
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "INVOICE_CREATE_FROM_TIME",
      entity: "Invoice",
      entityId: created.id,
      detail:
        `${client.name} — ${formatMoneyTr(created.total, created.currency)} · ` +
        `${allEntryIds.length} zaman kaydı, ${totals.lines.length} satır`,
    });

    return {
      ...this.serialize(created),
      sourceTimeEntryCount: allEntryIds.length,
    };
  }

  // ============================================================ GÜNCELLEME

  /** PATCH /billing/invoices/:id — YALNIZ TASLAK. */
  async update(user: AuthUser, id: string, input: UpdateInvoiceInput) {
    assertFinanceAccess(user, FINANCE_ACCESS.INVOICE_DRAFT, "fatura düzenleme");
    const existing = await this.requireInvoice(user.tenantId, id);
    this.assertDraft(existing, "düzenlenebilir");

    const updated = await this.prisma.client.$transaction(async (tx) => {
      if (input.lines) {
        const totals = computeInvoiceTotals(input.lines.map((l) => this.toLineInput(l)));

        /**
         * SERBEST BIRAKMA İLE YENİDEN SAHİPLENME SİMETRİK OLMALIDIR.
         *
         * `releaseSources` `invoiceId = id` olan BÜTÜN zaman kayıtlarını
         * koşulsuz çözüyor; yeniden sahiplenme ise yalnız `sourceId` DOLU
         * satırlara bakıyordu. `createFromTimeEntries` satırları
         * `sourceType:"TIME_ENTRY"` ama `sourceId:null` ile ürettiği için
         * (grup satırı birden çok kaydı temsil eder) `collectSourceIds` HER
         * ZAMAN boş dizi döndürüyor, `claimTimeEntries` hiçbir şey yapmıyordu.
         *
         * Sonuç (denetim bulgusu 1): from-time-entries → PATCH (ör. yalnız bir
         * satır açıklamasını düzeltmek) → fatura o saatleri hâlâ faturalıyor
         * AMA tüm zaman kayıtları `invoiceId = null`'a dönüyor, `uninvoiced`
         * süzgecinde yeniden görünüyor ve İKİNCİ bir fatura aynı saatleri
         * tekrar kesebiliyordu. Üç katmanlı çift-faturalama korumasının tamamı
         * bu yolda devre dışı kalıyordu.
         *
         * Düzeltme: faturanın ÖNCEKİ zaman kayıtları serbest bırakmadan ÖNCE
         * okunur ve satırlar yazıldıktan sonra GERİ sahiplenilir.
         *
         * Tek istisna: yeni satır kümesinde hiç `TIME_ENTRY` satırı kalmadıysa
         * kullanıcı bu kalemleri faturadan bilerek çıkarmıştır; o hâlde kayıtlar
         * gerçekten serbest bırakılır (aksi hâlde kalıcı olarak kilitli kalır).
         */
        const previousTimeEntries = await tx.timeEntry.findMany({
          where: { tenantId: user.tenantId, invoiceId: id },
          select: { id: true },
        });
        const keepsTimeEntryLines = input.lines.some((l) => l.sourceType === "TIME_ENTRY");

        await this.releaseSources(tx, user.tenantId, id);
        await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
        await tx.invoiceLine.createMany({
          data: totals.lines.map((l) => ({
            invoiceId: id,
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            vatRate: l.vatRate,
            lineTotal: l.lineTotal,
            sourceType: l.sourceType,
            sourceId: l.sourceId,
          })),
        });
        const timeEntryIds = [
          ...new Set([
            ...(keepsTimeEntryLines ? previousTimeEntries.map((e) => e.id) : []),
            ...this.collectSourceIds(input.lines, "TIME_ENTRY"),
          ]),
        ];
        await this.claimTimeEntries(tx, user.tenantId, existing.clientId, timeEntryIds, id);
        await this.claimFinancialEntries(
          tx,
          user.tenantId,
          existing.clientId,
          this.collectSourceIds(input.lines, "EXPENSE"),
          id,
        );

        await tx.invoice.update({
          where: { id },
          data: { subtotal: totals.subtotal, vatAmount: totals.vatAmount, total: totals.total },
        });
      }

      return tx.invoice.update({
        where: { id },
        data: {
          ...(input.issueDate !== undefined ? { issueDate: input.issueDate } : {}),
          ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
          ...(input.note !== undefined ? { note: input.note } : {}),
        },
        include: INVOICE_INCLUDE,
      });
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "INVOICE_UPDATE",
      entity: "Invoice",
      entityId: id,
      detail: `Güncellenen alanlar: ${Object.keys(input).join(", ")}`,
    });
    return this.serialize(updated);
  }

  /** DELETE /billing/invoices/:id — YALNIZ TASLAK. */
  async remove(user: AuthUser, id: string) {
    assertFinanceAccess(user, FINANCE_ACCESS.INVOICE_ISSUE, "fatura silme");
    const existing = await this.requireInvoice(user.tenantId, id);
    this.assertDraft(existing, "silinebilir");

    await this.prisma.client.$transaction(async (tx) => {
      await this.releaseSources(tx, user.tenantId, id);
      // Satırlar Cascade ile düşer.
      await tx.invoice.delete({ where: { id } });
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "INVOICE_DELETE",
      entity: "Invoice",
      entityId: id,
      detail: `TASLAK fatura silindi (${formatMoneyTr(existing.total, existing.currency)})`,
    });
    return { ok: true, id };
  }

  // ========================================================== KESİNLEŞTİRME

  /**
   * POST /billing/invoices/:id/finalize — TASLAK → GONDERILDI.
   *
   * Numara BU ANDA atanır (taslaklar numara tüketmez). Numara üretimi advisory
   * kilitli işlem içindedir ve unique ihlalinde yeniden denenir
   * (bkz. invoice-number.service.ts).
   */
  async finalize(user: AuthUser, id: string, input: FinalizeInvoiceInput) {
    assertFinanceAccess(user, FINANCE_ACCESS.INVOICE_ISSUE, "fatura kesinleştirme");
    const existing = await this.requireInvoice(user.tenantId, id);
    this.assertDraft(existing, "kesinleştirilebilir");

    const lineCount = await this.prisma.client.invoiceLine.count({ where: { invoiceId: id } });
    if (lineCount === 0) {
      throw new BadRequestException("Satırı olmayan fatura kesinleştirilemez.");
    }

    const seriesPrefix = resolveSeriesPrefix(input?.seriesPrefix);
    const dueDate = input?.dueDate !== undefined ? input.dueDate : existing.dueDate;

    const finalized = await withInvoiceNumberRetry(() =>
      this.prisma.client.$transaction(async (tx) => {
        const current = await tx.invoice.findUnique({
          where: { id },
          include: { lines: true },
        });
        if (!current || current.tenantId !== user.tenantId) {
          throw new NotFoundException("Fatura bulunamadı.");
        }
        if (current.status !== "TASLAK") {
          throw new ConflictException("Fatura bu sırada başka bir işlemle kesinleştirilmiş.");
        }

        // TOPLAMLAR YENİDEN HESAPLANIR — kesinleşen belge satırlarla tutmalı.
        const totals = computeInvoiceTotals(
          current.lines.map((l) => ({
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            vatRate: l.vatRate,
            sourceType: l.sourceType,
            sourceId: l.sourceId,
          })),
        );

        // Seri yılı TÜRKİYE YEREL TAKVİMİNDEN alınır: 01.01.2027 01:00
        // (İstanbul) UTC'de hâlâ 2026'dır ve numara bir önceki yılın serisine
        // düşerdi (denetim bulgusu 17). VUK tarafında referans mükellefin
        // yerel takvimidir.
        const invoiceNo = await this.numbers.next(
          tx,
          user.tenantId,
          trCalendarYear(current.issueDate),
          seriesPrefix,
        );

        const updated = await tx.invoice.update({
          where: { id },
          data: {
            invoiceNo,
            status: "GONDERILDI",
            dueDate,
            subtotal: totals.subtotal,
            vatAmount: totals.vatAmount,
            total: totals.total,
          },
          include: INVOICE_INCLUDE,
        });

        await this.syncInvoiceAccrual(tx, user.tenantId, updated);
        return updated;
      }),
    );

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "INVOICE_FINALIZE",
      entity: "Invoice",
      entityId: id,
      detail: `${finalized.invoiceNo} — ${formatMoneyTr(finalized.total, finalized.currency)}`,
    });
    return this.serialize(finalized);
  }

  /**
   * POST /billing/invoices/:id/cancel
   *
   * İptalde: kaynak kayıtların bağı çözülür (yeniden faturalanabilir),
   * otomatik tahakkuk kaydı silinir. Numara İADE EDİLMEZ — VUK gereği iptal
   * edilen numara yeniden kullanılamaz, boşluk kalır ve iz korunur.
   */
  async cancel(user: AuthUser, id: string, input: CancelInvoiceInput) {
    assertFinanceAccess(user, FINANCE_ACCESS.INVOICE_ISSUE, "fatura iptali");
    const existing = await this.requireInvoice(user.tenantId, id);

    if (existing.status === "IPTAL") {
      throw new ConflictException("Fatura zaten iptal edilmiş.");
    }
    if (existing.status === "TASLAK") {
      throw new ConflictException(
        "Taslak fatura iptal edilmez, silinir (DELETE /billing/invoices/:id).",
      );
    }

    const paymentCount = await this.prisma.client.payment.count({ where: { invoiceId: id } });
    if (paymentCount > 0) {
      throw new ConflictException(
        `Bu faturaya bağlı ${paymentCount} tahsilat kaydı var; fatura doğrudan iptal edilemez. ` +
          "Önce ödeme kayıtlarını kaldırın ya da iade faturası düzenleyin.",
      );
    }

    const canceled = await this.prisma.client.$transaction(async (tx) => {
      await this.releaseSources(tx, user.tenantId, id);
      await tx.financialEntry.deleteMany({
        where: {
          tenantId: user.tenantId,
          invoiceId: id,
          description: { startsWith: AUTO_ACCRUAL_MARKER },
        },
      });
      return tx.invoice.update({
        where: { id },
        data: {
          status: "IPTAL",
          note: [existing.note, `İptal gerekçesi: ${input.reason}`].filter(Boolean).join("\n"),
        },
        include: INVOICE_INCLUDE,
      });
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "INVOICE_CANCEL",
      entity: "Invoice",
      entityId: id,
      detail: `${existing.invoiceNo ?? "(numarasız)"} — ${input.reason}`,
    });
    return this.serialize(canceled);
  }

  // ============================================================== e-FATURA

  /** GET /billing/e-invoice/status — sağlayıcı özeti (kimlik bilgisi İÇERMEZ). */
  describeProvider(user: AuthUser) {
    assertFinanceAccess(user, FINANCE_ACCESS.READ, "e-Fatura ayarlarını görüntüleme");
    return this.eInvoice.describe(user.tenantId);
  }

  /** GET /billing/taxpayer-check?vkn= */
  async checkTaxpayer(user: AuthUser, vkn: string) {
    assertFinanceAccess(user, FINANCE_ACCESS.READ, "mükellef sorgulama");
    const digits = (vkn ?? "").replace(/\D/g, "");
    if (digits.length !== 10 && digits.length !== 11) {
      throw new BadRequestException("VKN 10 hane, TCKN 11 hane olmalıdır.");
    }
    const adapter = this.eInvoice.resolve(user.tenantId);
    return adapter.checkTaxpayer(digits);
  }

  /**
   * POST /billing/invoices/:id/e-invoice/send
   *
   * YAPILANDIRILMAMIŞ KURULUMDA HİÇBİR ALAN DEĞİŞMEZ: adaptör daha ilk adımda
   * (mükellef sorgusu) anlamlı bir Türkçe 503 fırlatır ve fatura bulunduğu
   * durumda (TASLAK ise TASLAK, e-Fatura durumu YOK) kalır. Sahte bir
   * "GÖNDERİLDİ/KABUL" geçişi YAPILMAZ.
   */
  async sendEInvoice(user: AuthUser, id: string) {
    assertFinanceAccess(user, FINANCE_ACCESS.INVOICE_ISSUE, "e-Fatura gönderme");
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id, tenantId: user.tenantId },
      include: INVOICE_INCLUDE,
    });
    if (!invoice) throw new NotFoundException("Fatura bulunamadı.");

    const adapter = this.eInvoice.resolve(user.tenantId);
    const identification = resolveCustomerIdentification(invoice.client);

    // (1) Mükellef sorgusu — e-Fatura mı e-Arşiv mi? Yapılandırılmamış
    //     adaptörde burada 503 fırlar ve fatura HİÇ DEĞİŞMEZ.
    if (!identification) {
      throw new BadRequestException(
        "Alıcının VKN (10 hane) veya TCKN (11 hane) bilgisi eksik; e-Fatura/e-Arşiv " +
          "belgesi düzenlenemez. Müvekkil kartından vergi kimlik bilgisini tamamlayın.",
      );
    }
    const taxpayer = await adapter.checkTaxpayer(identification.value);

    // (2) Buradan sonrası yalnızca YAPILANDIRILMIŞ sağlayıcıda çalışır.
    if (invoice.status === "TASLAK") {
      throw new ConflictException(
        "Taslak fatura gönderilemez. Önce POST /billing/invoices/:id/finalize ile " +
          "kesinleştirin (numara bu anda atanır).",
      );
    }
    if (invoice.status === "IPTAL") {
      throw new ConflictException("İptal edilmiş fatura gönderilemez.");
    }
    if (invoice.eInvoiceStatus === "GONDERILDI" || invoice.eInvoiceStatus === "KABUL") {
      throw new ConflictException(
        "Bu fatura zaten gönderilmiş. Çift fatura riskine karşı yeniden gönderim yapılmaz; " +
          "önce durum sorgusuyla (getStatus) mutabakat yapın.",
      );
    }

    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: user.tenantId },
      select: { name: true },
    });

    const totals = computeInvoiceTotals(
      invoice.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        vatRate: l.vatRate,
        sourceType: l.sourceType,
        sourceId: l.sourceId,
      })),
    );

    // ETTN sabit tutulur: sağlayıcı tarafında idempotency anahtarıdır, zaman
    // aşımında yeniden gönderim çift fatura üretmesin (Modül 09, kural 9).
    const uuid = invoice.eInvoiceUuid ?? randomUUID();
    const payload = buildUblInvoicePayload({
      invoice,
      client: invoice.client,
      tenant: { name: tenant?.name ?? "NomosOS Kullanıcısı" },
      documentKind: taxpayer.isEInvoiceUser ? "E_FATURA" : "E_ARSIV",
      uuid,
      vatBreakdown: totals.vatBreakdown,
    });

    await this.prisma.client.invoice.update({
      where: { id },
      data: { eInvoiceUuid: uuid, eInvoiceStatus: "BEKLIYOR" },
    });

    const result = await adapter.sendInvoice(payload);

    const updated = await this.prisma.client.invoice.update({
      where: { id },
      data: {
        eInvoiceUuid: result.gibUuid || uuid,
        eInvoiceStatus: result.status === "KABUL" ? "KABUL" : "GONDERILDI",
      },
      include: INVOICE_INCLUDE,
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "INVOICE_EINVOICE_SEND",
      entity: "Invoice",
      entityId: id,
      // Kimlik bilgisi ASLA yazılmaz; yalnız sağlayıcı anahtarı ve belge tipi.
      detail: `saglayici=${adapter.key} belgeTipi=${payload.documentKind} durum=${result.status}`,
    });
    return this.serialize(updated);
  }

  // ================================================= ÖDEME SONRASI MUTABAKAT

  /**
   * Faturanın ödeme durumunu yeniden hesaplar. `PaymentsService` çağırır.
   * İPTAL/İADE/TASLAK faturaların durumu DEĞİŞTİRİLMEZ.
   */
  async recalcPaymentStatus(
    tx: Prisma.TransactionClient,
    tenantId: string,
    invoiceId: string,
  ): Promise<{ status: InvoiceStatus; paid: Prisma.Decimal; remaining: Prisma.Decimal; overpaid: Prisma.Decimal; total: Prisma.Decimal }> {
    const invoice = await tx.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, tenantId: true, status: true, total: true, currency: true },
    });
    if (!invoice || invoice.tenantId !== tenantId) {
      throw new NotFoundException("Fatura bulunamadı.");
    }

    // PARA BİRİMİ SÜZGECİ (denetim bulgusu Ö-14).
    //
    // Eskiden faturaya bağlı TÜM tahsilatlar para birimi ayrılmadan toplanıyordu.
    // `Payment.currency` kolonu artık var; toplama yalnız FATURANIN para
    // birimindeki tahsilatlar girer. `payments.service.ts` zaten uyuşmazlığı
    // 400 ile reddediyor, ama bu ikinci kapıdır: geçmişten kalan ya da başka bir
    // yoldan yazılmış uyumsuz bir satır faturayı "ÖDENDİ" yapamaz.
    const agg = await tx.payment.aggregate({
      where: { invoiceId, tenantId, currency: invoice.currency },
      _sum: { amount: true },
    });
    const paid = fromSum(agg._sum.amount);
    const resolved = resolvePaymentStatus(dec(invoice.total), paid);

    const frozen: InvoiceStatus[] = ["TASLAK", "IPTAL", "IADE"];
    if (!frozen.includes(invoice.status)) {
      await tx.invoice.update({ where: { id: invoiceId }, data: { status: resolved.status } });
    }

    return {
      status: frozen.includes(invoice.status) ? invoice.status : (resolved.status as InvoiceStatus),
      paid,
      remaining: resolved.remaining,
      overpaid: resolved.overpaid,
      total: dec(invoice.total),
    };
  }

  // ============================================================ YARDIMCILAR

  serialize(invoice: InvoiceWithRelations) {
    const paid = invoice.payments.reduce((acc, p) => acc.plus(dec(p.amount)), new Prisma.Decimal(0));
    const remaining = dec(invoice.total).minus(paid);
    return {
      id: invoice.id,
      clientId: invoice.clientId,
      client: {
        id: invoice.client.id,
        name: invoice.client.name,
        type: invoice.client.type,
        taxNumber: invoice.client.taxNumber,
        taxOffice: invoice.client.taxOffice,
        // KVKK: TCKN ham hâlde dönmez; yalnız varlığı ve son 2 hanesi bildirilir.
        tcknMasked: invoice.client.tckn ? `*******${invoice.client.tckn.slice(-2)}` : null,
      },
      invoiceNo: invoice.invoiceNo,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      subtotal: moneyOut(invoice.subtotal),
      vatAmount: moneyOut(invoice.vatAmount),
      total: moneyOut(invoice.total),
      totalFormatted: formatMoneyTr(invoice.total, invoice.currency),
      currency: invoice.currency,
      status: invoice.status,
      eInvoiceStatus: invoice.eInvoiceStatus,
      eInvoiceUuid: invoice.eInvoiceUuid,
      note: invoice.note,
      createdBy: invoice.createdBy,
      createdAt: invoice.createdAt,
      updatedAt: invoice.updatedAt,
      lines: invoice.lines.map((l) => ({
        id: l.id,
        description: l.description,
        quantity: l.quantity.toFixed(2),
        unitPrice: moneyOut(l.unitPrice),
        vatRate: rateOut(l.vatRate),
        lineTotal: moneyOut(l.lineTotal),
        lineVat: moneyOut(dec(l.lineTotal).mul(l.vatRate).div(100)),
        sourceType: l.sourceType,
        sourceId: l.sourceId,
      })),
      payments: invoice.payments.map((p) => ({
        id: p.id,
        amount: moneyOut(p.amount),
        date: p.date,
        method: p.method,
        reference: p.reference,
      })),
      paidTotal: moneyOut(paid),
      remaining: moneyOut(remaining),
      remainingFormatted: formatMoneyTr(remaining, invoice.currency),
      editable: invoice.status === "TASLAK",
    };
  }

  private toLineInput(line: InvoiceLineInputDto): InvoiceLineInput {
    return {
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      vatRate: line.vatRate,
      sourceType: line.sourceType,
      sourceId: line.sourceId ?? null,
    };
  }

  private collectSourceIds(lines: readonly InvoiceLineInputDto[], sourceType: string): string[] {
    return [
      ...new Set(
        lines
          .filter((l) => l.sourceType === sourceType && l.sourceId)
          .map((l) => l.sourceId as string),
      ),
    ];
  }

  /**
   * ATOMİK SAHİPLENME — zaman kayıtları.
   *
   * `invoiceId: null` koşulu UPDATE'in KENDİSİNDEDİR: iki eşzamanlı istek aynı
   * kaydı işaretlemeye çalışırsa ikincisi 0 satır günceller ve işlem geri alınır.
   * Ayrıca `clientId` eşleşmesi aranır — başka müvekkilin kaydı faturaya giremez.
   */
  private async claimTimeEntries(
    tx: Prisma.TransactionClient,
    tenantId: string,
    clientId: string,
    ids: string[],
    invoiceId: string,
  ): Promise<void> {
    if (ids.length === 0) return;
    const result = await tx.timeEntry.updateMany({
      where: { id: { in: ids }, tenantId, clientId, invoiceId: null, billable: true },
      data: { invoiceId },
    });
    if (result.count !== ids.length) {
      throw new ConflictException(
        `Zaman kayıtlarından ${ids.length - result.count} tanesi faturaya eklenemedi: ` +
          "bu sırada başka bir fatura tarafından alınmış, faturalanabilir değil ya da " +
          "başka bir müvekkile ait olabilir. Fatura oluşturulmadı.",
      );
    }
  }

  /** ATOMİK SAHİPLENME — masraf/harç (FinancialEntry) kalemleri. */
  private async claimFinancialEntries(
    tx: Prisma.TransactionClient,
    tenantId: string,
    clientId: string,
    ids: string[],
    invoiceId: string,
  ): Promise<void> {
    if (ids.length === 0) return;
    const result = await tx.financialEntry.updateMany({
      where: { id: { in: ids }, tenantId, clientId, invoiceId: null, isBillable: true },
      data: { invoiceId },
    });
    if (result.count !== ids.length) {
      throw new ConflictException(
        `Finans kalemlerinden ${ids.length - result.count} tanesi faturaya eklenemedi: ` +
          "zaten faturalanmış, yansıtılabilir değil ya da başka müvekkile ait olabilir.",
      );
    }
  }

  /** Fatura silinince/iptal edilince kaynak kayıtların bağını çözer. */
  private async releaseSources(
    tx: Prisma.TransactionClient,
    tenantId: string,
    invoiceId: string,
  ): Promise<void> {
    await tx.timeEntry.updateMany({
      where: { tenantId, invoiceId },
      data: { invoiceId: null },
    });
    // Otomatik üretilen tahakkuk kaydı BURADA çözülmez; onu `cancel` siler.
    await tx.financialEntry.updateMany({
      where: {
        tenantId,
        invoiceId,
        NOT: { description: { startsWith: AUTO_ACCRUAL_MARKER } },
      },
      data: { invoiceId: null },
    });
  }

  /**
   * FATURA → FİNANS MUTABAKATI.
   *
   * Kesinleşen fatura, müvekkil alacağı olarak finansa yansımalıdır. Ancak
   * faturaya kaynak olarak bağlanmış ve ZATEN tahakkuk niteliğinde olan
   * kayıtlar (TAHAKKUK / VEKALET_UCRETI / DANISMANLIK) tutardan DÜŞÜLÜR;
   * aksi hâlde aynı alacak iki kez sayılır ve müvekkil bakiyesi şişerdi.
   *
   * Kalan tutar sıfır veya negatifse kayıt üretilmez.
   */
  private async syncInvoiceAccrual(
    tx: Prisma.TransactionClient,
    tenantId: string,
    invoice: { id: string; clientId: string; invoiceNo: string | null; total: Prisma.Decimal; currency: string; issueDate: Date },
  ): Promise<void> {
    const alreadyAccrued = await tx.financialEntry.aggregate({
      where: {
        tenantId,
        invoiceId: invoice.id,
        type: { in: [...ACCRUAL_TYPES] },
        NOT: { description: { startsWith: AUTO_ACCRUAL_MARKER } },
      },
      _sum: { amount: true },
    });

    const net = dec(invoice.total).minus(fromSum(alreadyAccrued._sum.amount));
    if (net.lte(0)) return;

    await tx.financialEntry.create({
      data: {
        tenantId,
        clientId: invoice.clientId,
        type: "TAHAKKUK",
        amount: net,
        currency: invoice.currency,
        date: invoice.issueDate,
        description: `${AUTO_ACCRUAL_MARKER} ${invoice.invoiceNo ?? invoice.id} numaralı fatura tahakkuku`,
        invoiceId: invoice.id,
        // Zaten faturalanmış bir tahakkuk yeniden yansıtılamaz.
        isBillable: false,
      },
    });
  }

  private assertDraft(invoice: { status: InvoiceStatus }, verb: string): void {
    if (invoice.status !== "TASLAK") {
      throw new ConflictException(
        `Yalnızca TASLAK durumundaki fatura ${verb}. Bu fatura ${invoice.status} durumunda; ` +
          "kesinleşmiş belgede düzeltme ancak iptal + yeni fatura ile yapılır.",
      );
    }
  }

  private async requireInvoice(tenantId: string, id: string) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        clientId: true,
        invoiceNo: true,
        status: true,
        total: true,
        currency: true,
        dueDate: true,
        note: true,
        eInvoiceStatus: true,
      },
    });
    if (!invoice) throw new NotFoundException("Fatura bulunamadı.");
    return invoice;
  }

  private async requireClient(tenantId: string, clientId: string) {
    const client = await this.prisma.client.client.findFirst({
      where: { id: clientId, tenantId },
      select: { id: true, name: true },
    });
    if (!client) throw new BadRequestException("Müvekkil bulunamadı.");
    return client;
  }
}
