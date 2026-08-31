import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { DeadlineStatus as DbDeadlineStatus, Prisma } from "@nomosos/db";
import { DEADLINE_SOURCES, DEADLINE_STATUSES, type DeadlineStatus } from "@nomosos/shared";
import {
  computeDeadline,
  findSystemRule,
  type DeadlineComputationResult,
  type ProcedureCode,
  type RecessExtensionRule,
} from "@nomosos/legal-core";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { DeadlineRulesService } from "../deadline-rules/deadline-rules.service";
import type { AuthUser } from "../common/types";
import { assertRole, hasRole, ROLE_SETS } from "../common/roles";
import { addDays, addYears, formatTrDate, parseDateParam, parseRangeEnd, startOfDay } from "../common/dates";
import { normalizeQuery, paged, resolvePage } from "../common/pagination";
import { touchCase } from "../common/case-denormals";
import {
  evaluateDeadlineStatusTransition,
  TERMINAL_DEADLINE_STATUSES,
} from "./deadline-status-policy";
import type {
  ComputeDeadlineInput,
  CorrectDeadlineInputsInput,
  CreateDeadlineInput,
  DeadlineFromRuleInput,
  UpdateDeadlineInput,
  UpdateDeadlineStatusInput,
} from "./deadlines.dto";

/** Kapanmış sayılan durumlar — tek kaynak `deadline-status-policy.ts`. */
const TERMINAL_STATUSES = TERMINAL_DEADLINE_STATUSES;
const OPEN_STATUSES: DbDeadlineStatus[] = ["BEKLIYOR", "ONAYLANDI"];

const DEADLINE_INCLUDE = {
  owner: { select: { id: true, fullName: true } },
  // denetim bulgusu K-14 — girdiyi düzelten kişi yanıtta görünür; düzeltme izi
  // yalnız AuditLog'da kalmaz, avukatın baktığı kayıtta da durur.
  correctedBy: { select: { id: true, fullName: true } },
  case: {
    select: {
      id: true,
      title: true,
      fileNumber: true,
      courtName: true,
      type: true,
      status: true,
      client: { select: { id: true, name: true } },
      responsibleUser: { select: { id: true, fullName: true } },
    },
  },
} satisfies Prisma.DeadlineInclude;

@Injectable()
export class DeadlinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rules: DeadlineRulesService
  ) {}

  /** Yaklaşan süreler: bugünden itibaren N gün, dueDate artan. */
  async upcoming(tenantId: string, daysParam?: string) {
    const days = Math.min(365, Math.max(1, Number(daysParam) || 30));
    const now = new Date();
    const until = addDays(now, days);

    return this.prisma.client.deadline.findMany({
      where: { tenantId, dueDate: { gte: now, lte: until }, status: { in: OPEN_STATUSES } },
      orderBy: { dueDate: "asc" },
      include: DEADLINE_INCLUDE,
    });
  }

  /** GET /deadlines — filtreli liste. */
  async list(
    tenantId: string,
    params: {
      status?: string;
      caseId?: string;
      ownerId?: string;
      source?: string;
      from?: string;
      to?: string;
      days?: string;
      open?: string;
      overdue?: string;
      q?: string;
      page?: string;
      limit?: string;
    }
  ) {
    const where: Prisma.DeadlineWhereInput = { tenantId };
    const pageParams = resolvePage(params);

    if (params.status) {
      if (!(DEADLINE_STATUSES as readonly string[]).includes(params.status)) {
        throw new BadRequestException("Geçersiz süre durumu.");
      }
      where.status = params.status as DbDeadlineStatus;
    } else if (params.open === "true") {
      where.status = { in: OPEN_STATUSES };
    }

    if (params.source) {
      if (!(DEADLINE_SOURCES as readonly string[]).includes(params.source)) {
        throw new BadRequestException("Geçersiz süre kaynağı.");
      }
      where.source = params.source as Prisma.DeadlineWhereInput["source"];
    }
    if (params.caseId) where.caseId = params.caseId;
    if (params.ownerId) where.ownerId = params.ownerId;
    const q = normalizeQuery(params.q);
    if (q) {
      where.OR = [
        { title: { contains: q, mode: "insensitive" } },
        { legalBasis: { contains: q, mode: "insensitive" } },
        { case: { fileNumber: { contains: q, mode: "insensitive" } } },
      ];
    }

    const dueFilter: Prisma.DateTimeFilter = {};
    if (params.from) dueFilter.gte = parseDateParam(params.from, "from");
    if (params.to) dueFilter.lte = parseRangeEnd(params.to, "to");
    if (params.days) {
      const days = Math.min(365, Math.max(1, Number(params.days) || 30));
      dueFilter.gte = dueFilter.gte ?? new Date();
      dueFilter.lte = addDays(new Date(), days);
    }
    if (params.overdue === "true") {
      dueFilter.lt = startOfDay(new Date());
      where.status = { in: OPEN_STATUSES };
    }
    if (Object.keys(dueFilter).length > 0) where.dueDate = dueFilter;

    const [items, total] = await Promise.all([
      this.prisma.client.deadline.findMany({
        where,
        orderBy: { dueDate: "asc" },
        include: DEADLINE_INCLUDE,
        skip: pageParams.skip,
        take: pageParams.take,
      }),
      this.prisma.client.deadline.count({ where }),
    ]);
    return paged(items, total, pageParams);
  }

  async detail(tenantId: string, id: string) {
    const deadline = await this.prisma.client.deadline.findFirst({
      where: { id, tenantId },
      include: DEADLINE_INCLUDE,
    });
    if (!deadline) {
      throw new NotFoundException("Süre kaydı bulunamadı.");
    }
    return deadline;
  }

  /** POST /deadlines — manuel süre. */
  async create(user: AuthUser, input: CreateDeadlineInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "süre kaydı oluşturma");
    const relatedCase = await this.requireCase(user.tenantId, input.caseId);
    if (input.ownerId) {
      await this.requireTenantUser(user.tenantId, input.ownerId);
    }
    if (input.status === "ONAYLANDI" && !hasRole(user, ROLE_SETS.HUKUKI)) {
      throw new ForbiddenException("Süreyi onaylı olarak yalnızca avukat, ortak veya yönetici kaydedebilir.");
    }

    const deadline = await this.prisma.client.deadline.create({
      data: {
        tenantId: user.tenantId,
        caseId: input.caseId,
        title: input.title,
        dueDate: input.dueDate,
        ownerId: input.ownerId ?? undefined,
        legalBasis: input.legalBasis ?? undefined,
        triggerDate: input.triggerDate,
        serviceMethod: input.serviceMethod,
        // GÜVENLİK: bu uçtan açılan kayıt DAİMA manueldir. `source`/`ruleKey`/
        // `computeNote` istemciden alınmaz; sahte "kural motoru hesap izi"
        // üretilmesini engeller (denetim bulgusu 4).
        source: "MANUEL",
        computeNote: undefined,
        ruleKey: undefined,
        status: input.status,
      },
      include: DEADLINE_INCLUDE,
    });

    await touchCase(this.prisma.client, input.caseId);
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "DEADLINE_CREATE",
      entity: "Deadline",
      entityId: deadline.id,
      detail: `${relatedCase.fileNumber ?? relatedCase.title} — ${input.title} (${formatTrDate(input.dueDate)})`,
    });
    return deadline;
  }

  /** PATCH /deadlines/:id */
  async update(user: AuthUser, id: string, input: UpdateDeadlineInput) {
    assertRole(user, ROLE_SETS.HUKUKI, "süre kaydı güncelleme");
    const existing = await this.requireDeadline(user.tenantId, id);
    if (TERMINAL_STATUSES.includes(existing.status as DeadlineStatus)) {
      throw new BadRequestException(`«${existing.title}» süresi ${existing.status} durumunda olduğu için güncellenemez.`);
    }
    if (input.dueDate && existing.source !== "MANUEL") {
      // denetim bulgusu K-14 — eski metin üründe VAR OLMAYAN bir işlemi
      // öneriyordu ("tetikleyici tarihi düzeltip yeniden hesaplayın"); o uç
      // yazılmamıştı. Artık gösterdiği uç gerçekten mevcut.
      throw new BadRequestException(
        "Kural motorundan üretilmiş sürenin son günü doğrudan değiştirilemez. " +
          "Tetikleyici tarihi veya tebligat yöntemini «PATCH /deadlines/:id/inputs» ucundan düzeltin; " +
          "motor son günü yeniden hesaplar ve düzeltme kayda geçer."
      );
    }
    if (input.ownerId) {
      await this.requireTenantUser(user.tenantId, input.ownerId);
    }

    const updated = await this.prisma.client.deadline.update({
      where: { id },
      data: input as Prisma.DeadlineUncheckedUpdateInput,
      include: DEADLINE_INCLUDE,
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "DEADLINE_UPDATE",
      entity: "Deadline",
      entityId: id,
      detail: `${existing.title} — güncellenen alanlar: ${Object.keys(input).join(", ")}`,
    });
    return updated;
  }

  /**
   * PATCH /deadlines/:id/inputs — KURAL kaynaklı sürenin GİRDİSİNİ düzeltir ve
   * motoru YENİDEN KOŞTURUR (denetim bulgusu K-14).
   *
   * Ürün, kural kaynaklı sürenin son gününü elle değiştirmeyi haklı olarak
   * reddediyordu; ama düzeltmenin MEŞRU yolunu da açmamıştı. Sonuç: AI'ın
   * tespit ettiği tebliğ tarihi iki gün yanlışsa avukatın elinde yalnız kaydı
   * SİLMEK kalıyor, silinen kayıtla birlikte hesap izi ve denetim bağı da
   * gidiyordu.
   *
   * Burada son gün İSTEMCİDEN ALINMAZ — girdi düzeltilir, motor tekrar koşar,
   * son günü motor yazar. Motorun tekelliği bozulmadan kayıt düzeltilebilir
   * hâle gelir.
   *
   * İLK TESPİT DONDURULUR (Modül 04 KK8): `originalTriggerDate`,
   * `originalServiceMethod` ve `originalDueDate` yalnızca İLK düzeltmede
   * yazılır. Sonraki düzeltmeler bunları EZMEZ; aksi hâlde ikinci düzeltmeden
   * sonra "başlangıçta ne sanıyorduk" sorusunun cevabı kaybolurdu.
   *
   * YETKİ: `ROLE_SETS.HUKUKI` (yönetici/ortak/avukat). SEKRETER ve STAJYER
   * süre girdisini düzeltemez — düzeltme, hak düşürücü bir tarihi yeniden
   * belirlemektir; kayıt bakımı değildir.
   */
  async correctInputs(user: AuthUser, id: string, input: CorrectDeadlineInputsInput) {
    assertRole(user, ROLE_SETS.HUKUKI, "süre girdisi düzeltme");

    const existing = await this.prisma.client.deadline.findFirst({
      where: { id, tenantId: user.tenantId },
      select: {
        id: true,
        title: true,
        status: true,
        caseId: true,
        dueDate: true,
        source: true,
        ruleKey: true,
        triggerDate: true,
        serviceMethod: true,
        originalTriggerDate: true,
        originalServiceMethod: true,
        originalDueDate: true,
        correctionCount: true,
      },
    });
    if (!existing) {
      throw new NotFoundException("Süre kaydı bulunamadı.");
    }
    if (TERMINAL_STATUSES.includes(existing.status as DeadlineStatus)) {
      throw new BadRequestException(
        `«${existing.title}» süresi ${existing.status} durumunda olduğu için girdisi düzeltilemez.`
      );
    }
    // MANUEL sürede yeniden koşacak bir kural yoktur; onun son günü zaten
    // `PATCH /deadlines/:id` ile doğrudan düzeltilebiliyor.
    if (existing.source !== "KURAL" || !existing.ruleKey) {
      throw new BadRequestException(
        "Bu süre kural motorundan üretilmemiştir; girdi düzeltmesi uygulanamaz. " +
          "Manuel sürenin son günü «PATCH /deadlines/:id» ile değiştirilir."
      );
    }

    const nextTriggerDate = input.triggerDate ?? existing.triggerDate;
    if (!nextTriggerDate) {
      throw new BadRequestException(
        "Kayıtta tetikleyici tarih yok; düzeltme isteğinde tetikleyici tarih gönderilmelidir."
      );
    }
    const nextServiceMethod = input.serviceMethod ?? existing.serviceMethod ?? undefined;

    const { rule, result } = await this.runEngine(user.tenantId, {
      ruleKey: existing.ruleKey,
      triggerDate: nextTriggerDate,
      serviceMethod: nextServiceMethod,
      applyJudicialRecess: input.applyJudicialRecess,
    });

    const previousDueDate = existing.dueDate;
    const dueDateChanged = startOfDay(previousDueDate).getTime() !== startOfDay(result.dueDate).getTime();
    // İlk tespit yalnızca İLK düzeltmede dondurulur (bkz. metot açıklaması).
    const isFirstCorrection = existing.correctionCount === 0;
    const baselineTriggerDate = existing.originalTriggerDate ?? existing.triggerDate;
    const baselineDueDate = existing.originalDueDate ?? previousDueDate;

    const correctionTrail =
      `--- GİRDİ DÜZELTMESİ (${formatTrDate(new Date())}) ---\n` +
      `Gerekçe: ${input.reason}\n` +
      `Tetikleyici tarih: ${existing.triggerDate ? formatTrDate(existing.triggerDate) : "—"} → ${formatTrDate(nextTriggerDate)}\n` +
      `Tebligat yöntemi: ${existing.serviceMethod ?? "—"} → ${nextServiceMethod ?? "—"}\n` +
      `Son gün: ${formatTrDate(previousDueDate)} → ${formatTrDate(result.dueDate)}` +
      (dueDateChanged ? "" : " (değişmedi)") +
      `\nİLK TESPİT: tetik ${baselineTriggerDate ? formatTrDate(baselineTriggerDate) : "—"}, son gün ${formatTrDate(baselineDueDate)}` +
      `\nDüzeltme sırası: ${existing.correctionCount + 1}`;

    const computeNote = `${buildComputeNote(result)}\n\n${correctionTrail}`;
    const correctedAt = new Date();

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const saved = await tx.deadline.update({
        where: { id },
        data: {
          triggerDate: nextTriggerDate,
          serviceMethod: nextServiceMethod ?? null,
          dueDate: result.dueDate,
          legalBasis: result.legalBasis,
          computeNote,
          ruleKey: rule.key,
          ...(isFirstCorrection
            ? {
                originalTriggerDate: existing.triggerDate,
                originalServiceMethod: existing.serviceMethod,
                originalDueDate: previousDueDate,
              }
            : {}),
          correctedById: user.userId,
          correctedAt,
          correctionCount: { increment: 1 },
        },
        include: DEADLINE_INCLUDE,
      });
      await tx.timelineEvent.create({
        data: {
          tenantId: user.tenantId,
          caseId: existing.caseId,
          userId: user.userId,
          title:
            `Süre girdisi düzeltildi: «${existing.title}» — son gün ` +
            `${formatTrDate(previousDueDate)} → ${formatTrDate(result.dueDate)}`,
          detail: correctionTrail,
          source: "SISTEM",
        },
      });
      return saved;
    });

    await touchCase(this.prisma.client, existing.caseId);
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "DEADLINE_INPUTS_CORRECT",
      entity: "Deadline",
      entityId: id,
      detail:
        `${existing.title} — tetik ${existing.triggerDate ? formatTrDate(existing.triggerDate) : "—"} → ` +
        `${formatTrDate(nextTriggerDate)}; son gün ${formatTrDate(previousDueDate)} → ${formatTrDate(result.dueDate)}; ` +
        `gerekçe: ${input.reason}`,
    });

    return {
      deadline: updated,
      steps: result.steps,
      warnings: result.warnings,
      previousDueDate,
      dueDateChanged,
    };
  }

  /** PATCH /deadlines/:id/status */
  async updateStatus(user: AuthUser, id: string, input: UpdateDeadlineStatusInput) {
    const existing = await this.requireDeadline(user.tenantId, id);
    const from = existing.status as DeadlineStatus;
    const to = input.status as DeadlineStatus;

    // Geçiş kuralları SAF bir modülde durur ve birim testlidir
    // (`deadline-status-policy.ts`). Denetim bulgusu K-13 — kaçırılmış sürenin
    // ÇIKIŞI korumasızdı ve sekreter tek istekle risk sinyalini siliyordu —
    // tam olarak kuralın servise gömülü ve testsiz olmasından hayatta kaldı.
    const rejection = evaluateDeadlineStatusTransition({
      from,
      to,
      role: user.role,
      note: input.note,
      title: existing.title,
    });
    if (rejection) {
      throw rejection.kind === "YETKI"
        ? new ForbiddenException(rejection.message)
        : new BadRequestException(rejection.message);
    }
    // KACIRILDI hiçbir daldan geçmiyordu: her rol bir süreyi "kaçırıldı" olarak
    // kapatabiliyor, böylece panelin risk listesini ve dosya kapatma engelini
    // etkileyebiliyordu (denetim bulgusu 5). Kaçırılan süre meslek sorumluluğu
    // doğuran bir tespittir; gerekçe zorunludur.
    if (to === "KACIRILDI") {
      assertRole(user, ROLE_SETS.HUKUKI, "süreyi kaçırıldı olarak işaretleme");
      if (!input.note?.trim()) {
        throw new BadRequestException(
          "Süreyi kaçırıldı olarak işaretlerken gerekçe yazılmalıdır; bu kayıt denetim izinde kalır."
        );
      }
    }

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const result = await tx.deadline.update({
        where: { id },
        data: { status: to as DbDeadlineStatus },
        include: DEADLINE_INCLUDE,
      });
      await tx.timelineEvent.create({
        data: {
          tenantId: user.tenantId,
          caseId: existing.caseId,
          userId: user.userId,
          title: `Süre durumu: «${existing.title}» ${from} → ${to}`,
          detail: input.note?.trim() ? input.note.trim() : undefined,
          source: "SISTEM",
        },
      });
      return result;
    });

    await touchCase(this.prisma.client, existing.caseId);
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "DEADLINE_STATUS_UPDATE",
      entity: "Deadline",
      entityId: id,
      detail: `${existing.title}: ${from} → ${to}${input.note ? ` (${input.note})` : ""}`,
    });
    return updated;
  }

  /** DELETE /deadlines/:id */
  async remove(user: AuthUser, id: string) {
    assertRole(user, ROLE_SETS.HUKUKI, "süre kaydı silme");
    const existing = await this.requireDeadline(user.tenantId, id);
    // Kaçırılmış süre denetim açısından EN KRİTİK kayıttır; silinemez
    // (denetim bulgusu 22). Kapatmak isteyen IPTAL durumuna geçirmelidir.
    if (existing.status === "TAMAMLANDI" || existing.status === "KACIRILDI") {
      throw new BadRequestException(
        `${existing.status} durumundaki süre silinemez; denetim izi korunur. ` +
          "Kaydı kapatmak için IPTAL durumuna geçirin."
      );
    }

    await this.prisma.client.deadline.delete({ where: { id } });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "DEADLINE_DELETE",
      entity: "Deadline",
      entityId: id,
      detail: `${existing.title} (${formatTrDate(existing.dueDate)})`,
    });
    return { ok: true, id };
  }

  // ---------- Süre motoru ----------

  /** POST /deadlines/compute — hesaplar, KAYDETMEZ. */
  async compute(user: AuthUser, input: ComputeDeadlineInput) {
    const { rule, result } = await this.runEngine(user.tenantId, input);
    return {
      ruleKey: rule.key,
      ruleName: rule.name,
      dueDate: result.dueDate,
      steps: result.steps,
      legalBasis: result.legalBasis,
      warnings: result.warnings,
      computeNote: buildComputeNote(result),
    };
  }

  /** POST /deadlines/from-rule — hesaplar VE Deadline kaydı açar (source=KURAL, status=ONAYLANDI). */
  async createFromRule(user: AuthUser, input: DeadlineFromRuleInput) {
    assertRole(user, ROLE_SETS.HUKUKI, "kural motorundan süre oluşturma");
    const relatedCase = await this.requireCase(user.tenantId, input.caseId);
    if (input.ownerId) {
      await this.requireTenantUser(user.tenantId, input.ownerId);
    }

    const { rule, result } = await this.runEngine(user.tenantId, input);
    const computeNote = buildComputeNote(result);

    const deadline = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.deadline.create({
        data: {
          tenantId: user.tenantId,
          caseId: input.caseId,
          title: input.title ?? rule.name,
          dueDate: result.dueDate,
          ownerId: input.ownerId ?? relatedCase.responsibleUserId ?? undefined,
          source: "KURAL",
          status: "ONAYLANDI",
          legalBasis: result.legalBasis,
          computeNote,
          ruleKey: rule.key,
          triggerDate: input.triggerDate,
          serviceMethod: input.serviceMethod,
        },
        include: DEADLINE_INCLUDE,
      });
      await tx.timelineEvent.create({
        data: {
          tenantId: user.tenantId,
          caseId: input.caseId,
          userId: user.userId,
          title: `Süre hesaplandı: ${created.title} — son gün ${formatTrDate(result.dueDate)}`,
          detail: `${result.legalBasis}\n${computeNote}`,
          source: "SISTEM",
        },
      });
      return created;
    });

    await touchCase(this.prisma.client, input.caseId);
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "DEADLINE_CREATE_FROM_RULE",
      entity: "Deadline",
      entityId: deadline.id,
      detail: `${rule.key} — ${relatedCase.fileNumber ?? relatedCase.title} — son gün ${formatTrDate(result.dueDate)}`,
    });

    return { deadline, steps: result.steps, warnings: result.warnings };
  }

  /** Kural çözümü + tatil yükleme + deterministik hesap. */
  private async runEngine(tenantId: string, input: ComputeDeadlineInput) {
    const rule = await this.rules.resolveByKey(tenantId, input.ruleKey);

    // Hesap penceresi: tetikleyici tarihin yılından itibaren 3 yıl (İİK m.67 gibi 1 yıllık süreler dahil).
    const windowStart = new Date(Date.UTC(input.triggerDate.getUTCFullYear(), 0, 1));
    const windowEnd = addYears(input.triggerDate, 3);
    // denetim bulgusu Ö-16 — `isHalfDay` / `isApproximate` SÜTUNLARI ÇEKİLİR.
    // Bu iki alan `select` dışında bırakıldığında motor, bayrakları tatilin
    // _adından_ okumaya düşüyordu (`buildHolidayIndex` → `name.includes("(yarım
    // gün)")`); tek bir isim düzenlemesi hesabı sessizce bozmaya yeterdi.
    //
    // YARIM GÜNÜN DOĞRU DAVRANIŞI (motorun kuralıyla tutarlı): arife TAM TATİL
    // DEĞİLDİR. 2429 s.K. m.2/A uyarınca o gün 13.00'e kadar mesai vardır; gün
    // "resmî tatile rastlamış" sayılmaz ve HMK m.93 / İİK m.19 kaydırması
    // TETİKLENMEZ (`isNonWorkingDay` → `isFullDayOfficialHoliday`). Son gün arifeye
    // düşerse süre O GÜN sona erer; motor yalnızca «işlemi 13.00'ten önce
    // tamamlayınız» uyarısı basar (`collectWarnings` §2). Bayrak gelmezse arife tam
    // tatil sayılır ve avukata var olmayan 1-3 gün kazandırılırdı.
    // `isApproximate` ise hicri takvime bağlı bayramlarda teyit uyarısını açar.
    const holidays = await this.prisma.client.holiday.findMany({
      where: { date: { gte: windowStart, lte: windowEnd } },
      orderBy: { date: "asc" },
      select: { date: true, type: true, name: true, isHalfDay: true, isApproximate: true },
    });

    // ADLİ TATİL REJİMİ KURALDAN GELİR, İSTEMCİDEN DEĞİL (denetim bulgusu 3).
    // Kullanıcı girdisi yalnızca HMK m.103 istisnası için bilinçli bir
    // geçersiz kılmadır; gönderilmezse kuralın kendi ayarı uygulanır.
    const applyJudicialRecess = input.applyJudicialRecess ?? rule.judicialRecessApplies;

    const result: DeadlineComputationResult = computeDeadline({
      ruleKey: rule.key,
      triggerDate: input.triggerDate,
      serviceMethod: input.serviceMethod,
      rule: {
        durationValue: rule.durationValue,
        durationUnit: rule.durationUnit,
        legalBasis: rule.legalBasis,
      },
      holidays,
      applyJudicialRecess,
      recessRule: rule.recessRule as RecessExtensionRule,
      procedureCode: rule.procedureCode as ProcedureCode,
    });

    // Kullanıcı kuralın varsayılanından ayrıldıysa bunu hesap izine yaz.
    if (input.applyJudicialRecess !== undefined && input.applyJudicialRecess !== rule.judicialRecessApplies) {
      result.warnings.push(
        `Adli tatil uzaması, kuralın varsayılanından (${rule.judicialRecessApplies ? "uygulanır" : "uygulanmaz"}) ` +
          `ayrılarak kullanıcı tarafından "${applyJudicialRecess ? "uygulandı" : "uygulanmadı"}" olarak seçilmiştir. ` +
          `Bu tercihin HMK m.103 kapsamında dayanağını dosyada belgeleyiniz.`
      );
    }

    // Büro kuralı sistem kuralını eziyorsa avukat bunu görmelidir
    // (denetim bulgusu 22): dayanak metni kanuni maddeyi gösterirken süre
    // büro tarafından değiştirilmiş olabilir.
    if (rule.tenantId !== null && !rule.isSystem) {
      const systemRule = findSystemRule(rule.key);
      if (systemRule && systemRule.durationValue !== rule.durationValue) {
        result.warnings.push(
          `DİKKAT: «${rule.key}» kuralı büronuz tarafından değiştirilmiştir ` +
            `(büro: ${rule.durationValue} ${rule.durationUnit}, kanuni: ${systemRule.durationValue} ${systemRule.durationUnit} — ` +
            `${systemRule.legalBasis}). Hesap büro kuralına göre yapılmıştır.`
        );
      }
    }

    // NOT: "tatil takvimi yüklü değil" uyarısı motorda zaten üretiliyor
    // (deadline-engine → collectWarnings); burada ikinci kez eklemek gerçek
    // uyarıların önemini törpülüyordu (denetim bulgusu 17/İYİLEŞTİRME).
    return { rule, result };
  }

  // ---------- Yardımcılar ----------

  private async requireDeadline(tenantId: string, id: string) {
    const deadline = await this.prisma.client.deadline.findFirst({
      where: { id, tenantId },
      select: { id: true, title: true, status: true, caseId: true, dueDate: true, source: true },
    });
    if (!deadline) {
      throw new NotFoundException("Süre kaydı bulunamadı.");
    }
    return deadline;
  }

  private async requireCase(tenantId: string, caseId: string) {
    const found = await this.prisma.client.case.findFirst({
      where: { id: caseId, tenantId },
      select: { id: true, title: true, fileNumber: true, responsibleUserId: true },
    });
    if (!found) {
      throw new BadRequestException("Dosya bulunamadı.");
    }
    return found;
  }

  private async requireTenantUser(tenantId: string, userId: string) {
    const found = await this.prisma.client.user.findFirst({ where: { id: userId, tenantId }, select: { id: true } });
    if (!found) {
      throw new BadRequestException("Seçilen sorumlu büronuzda bulunamadı.");
    }
    return found;
  }
}

/** Hesap izini insan okunur tek metne indirger (Deadline.computeNote). */
function buildComputeNote(result: DeadlineComputationResult): string {
  const lines = result.steps.map(
    (step, index) => `${index + 1}. ${step.step} — ${formatTrDate(step.date)}: ${step.explanation}`
  );
  lines.push(`Dayanak: ${result.legalBasis}`);
  if (result.warnings.length > 0) {
    lines.push(`Uyarılar: ${result.warnings.join(" | ")}`);
  }
  return lines.join("\n");
}
