/**
 * İCRA TAKİP MODÜLÜ — yaşam döngüsü, safahat, malvarlığı, tahsilat.
 *
 * Modül 05. Bu servis DETERMİNİSTİKTİR: aşama geçişleri kural makinesinden
 * (enforcement-stage.ts), bakiye hesabı Decimal aritmetiğinden
 * (balance.service.ts), süreler @nomosos/legal-core'dan geçer. AI yalnızca
 * copilot.service.ts içinde ve YALNIZCA ÖNERİ üretmek için kullanılır.
 *
 * Her sorgu `tenantId` süzgeçlidir; icra kayıtları `EnforcementFile` üzerinden
 * bir `Case`'e bağlı olduğu için hem dosya hem alt kayıt seviyesinde kiracı
 * kontrolü yapılır (alt kayıtların kendi `tenantId` alanı vardır).
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  Prisma,
  type AssetStatus,
  type EnforcementFile,
  type EnforcementStage,
} from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { assertRole, hasRole, ROLE_SETS } from "../common/roles";
import { assertFinanceAccess, FINANCE_ACCESS } from "../finance/finance-access";
import { normalizeQuery, paged, resolvePage } from "../common/pagination";
import { touchCase } from "../common/case-denormals";
import { formatTrDate, parseDateParam, trCalendarDay } from "../common/dates";
import type { AuthUser } from "../common/types";
import { EnforcementBalanceService } from "./balance.service";
import { CollectionScoreService, SCORE_BAND_LABELS } from "./collection-score.service";
import { EnforcementDeadlinesService } from "./enforcement-deadlines.service";
import {
  assertStageTransition,
  isValidStage,
  STAGE_LABELS,
  STAGE_TRANSITIONS,
} from "./enforcement-stage";
import {
  ASSET_STATUSES,
  ENFORCEMENT_TYPES,
  type ChangeStageInput,
  type CreateActionInput,
  type CreateAssetInput,
  type CreateCollectionInput,
  type CreateEnforcementInput,
  type SuggestDeadlinesInput,
  type UpdateActionInput,
  type UpdateAssetInput,
  type UpdateEnforcementInput,
} from "./enforcement.dto";
import {
  requiredMoney,
  serializeAction,
  serializeAsset,
  serializeCollection,
  serializeFile,
} from "./enforcement.serialize";

/**
 * Malvarlığı durum şeridi. Serbest bırakma her aşamadan mümkündür (haciz
 * kaldırılabilir); satılmış bir kalem ise artık dosyadan çıkmıştır.
 */
const ASSET_TRANSITIONS: Record<AssetStatus, readonly AssetStatus[]> = {
  TESPIT_EDILDI: ["HACZEDILDI", "SERBEST_BIRAKILDI"],
  HACZEDILDI: ["SATISA_CIKARILDI", "SATILDI", "SERBEST_BIRAKILDI"],
  SATISA_CIKARILDI: ["SATILDI", "HACZEDILDI", "SERBEST_BIRAKILDI"],
  SATILDI: [],
  SERBEST_BIRAKILDI: ["TESPIT_EDILDI", "HACZEDILDI"],
};

const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  TESPIT_EDILDI: "Tespit edildi",
  HACZEDILDI: "Haczedildi",
  SATISA_CIKARILDI: "Satışa çıkarıldı",
  SATILDI: "Satıldı",
  SERBEST_BIRAKILDI: "Serbest bırakıldı",
};

/** SATIS aşamasına geçiş için dosyada bulunması şart olan işlem (kural 4). */
const SEIZURE_PROOF_ACTIONS = ["HACIZ_UYGULAMA"] as const;

@Injectable()
export class EnforcementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly balance: EnforcementBalanceService,
    private readonly score: CollectionScoreService,
    private readonly deadlines: EnforcementDeadlinesService,
  ) {}

  // ================================================================== //
  // Takip dosyası yaşam döngüsü
  // ================================================================== //

  /**
   * GET /enforcement
   *
   * OKUMA UÇLARINDA DA ROL KAPISI VARDIR (denetim bulgusu 8).
   *
   * Eskiden bu uçlar servise yalnız `user.tenantId` geçiriyordu; `AuthUser`
   * nesnesi servise hiç ulaşmadığı için rol kontrolü YAPISAL OLARAK
   * imkânsızdı. Sonuç: STAJYER rolü alacak tutarını, tahsilat geçmişini,
   * borçlunun malvarlığı kayıtlarını ve tahsil kabiliyeti skorunu okuyabiliyordu
   * — oysa `FINANCE_ACCESS.READ` ve `ROLE_SETS.FINANS` bu rolü AÇIKÇA dışlıyor.
   * İcra bakiyesi finansal veridir; okuma kapısı finans modülüyle aynı olmalıdır.
   */
  async list(
    user: AuthUser,
    params: {
      stage?: string;
      trackingType?: string;
      clientId?: string;
      q?: string;
      page?: string;
      limit?: string;
    },
  ) {
    // Liste satırları `collectedTotal` ve tahsilat skoru taşır — finansal veri.
    assertFinanceAccess(user, FINANCE_ACCESS.READ, "icra takip listesini görüntüleme");
    const tenantId = user.tenantId;
    const where: Prisma.EnforcementFileWhereInput = { tenantId };
    const pageParams = resolvePage(params);

    if (params.stage) {
      if (!isValidStage(params.stage)) throw new BadRequestException("Geçersiz icra aşaması.");
      where.stage = params.stage;
    }
    if (params.trackingType) {
      if (!(ENFORCEMENT_TYPES as readonly string[]).includes(params.trackingType)) {
        throw new BadRequestException("Geçersiz takip tipi.");
      }
      where.trackingType = params.trackingType as Prisma.EnforcementFileWhereInput["trackingType"];
    }
    if (params.clientId) {
      where.case = { clientId: params.clientId };
    }
    const q = normalizeQuery(params.q);
    if (q) {
      where.OR = [
        { fileNumber: { contains: q, mode: "insensitive" } },
        { officeName: { contains: q, mode: "insensitive" } },
        { debtorInfo: { contains: q, mode: "insensitive" } },
        { case: { title: { contains: q, mode: "insensitive" } } },
        { case: { client: { name: { contains: q, mode: "insensitive" } } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.client.enforcementFile.findMany({
        where,
        orderBy: { requestDate: "desc" },
        skip: pageParams.skip,
        take: pageParams.take,
        include: {
          case: {
            select: {
              id: true,
              title: true,
              fileNumber: true,
              status: true,
              client: { select: { id: true, name: true } },
              responsibleUser: { select: { id: true, fullName: true } },
            },
          },
          _count: { select: { actions: true, assets: true, collections: true } },
        },
      }),
      this.prisma.client.enforcementFile.count({ where }),
    ]);

    // Tahsil edilen toplam ve son skor, listede rozet olarak gösterilir.
    const ids = items.map((i) => i.id);
    const [collectedRows, scoreRows] = await Promise.all([
      ids.length
        ? this.prisma.client.collectionRecord.groupBy({
            by: ["enforcementFileId"],
            where: { tenantId, enforcementFileId: { in: ids } },
            _sum: { amount: true },
          })
        : Promise.resolve([]),
      ids.length
        ? this.prisma.client.collectionScore.findMany({
            where: { tenantId, enforcementFileId: { in: ids } },
            orderBy: { computedAt: "desc" },
            select: { enforcementFileId: true, score: true, band: true, computedAt: true },
          })
        : Promise.resolve([]),
    ]);
    const collectedBy = new Map(collectedRows.map((r) => [r.enforcementFileId, r._sum.amount]));
    const scoreBy = new Map<string, (typeof scoreRows)[number]>();
    for (const row of scoreRows) {
      if (!scoreBy.has(row.enforcementFileId)) scoreBy.set(row.enforcementFileId, row);
    }

    const shaped = items.map((item) => {
      const latestScore = scoreBy.get(item.id);
      return {
        ...serializeFile(item),
        collectedTotal: requiredMoney(collectedBy.get(item.id) ?? new Prisma.Decimal(0)),
        latestScore: latestScore
          ? {
              score: latestScore.score,
              band: latestScore.band,
              bandLabel: SCORE_BAND_LABELS[latestScore.band],
              computedAt: latestScore.computedAt,
            }
          : null,
      };
    });

    return paged(shaped, total, pageParams);
  }

  /** POST /enforcement — Case'e bağlı icra dosyası açar. */
  async create(user: AuthUser, input: CreateEnforcementInput) {
    assertRole(user, ROLE_SETS.HUKUKI, "icra takibi açma");

    const relatedCase = await this.prisma.client.case.findFirst({
      where: { id: input.caseId, tenantId: user.tenantId },
      select: { id: true, type: true, title: true, fileNumber: true, clientId: true },
    });
    if (!relatedCase) {
      throw new BadRequestException("Dosya bulunamadı. Önce dosya (Case) kaydı oluşturun.");
    }
    // Şema bunu zorlamaz; iş kuralı burada uygulanır.
    if (relatedCase.type !== "ICRA") {
      throw new UnprocessableEntityException(
        `«${relatedCase.fileNumber ?? relatedCase.title}» dosyasının türü ICRA değil (${relatedCase.type}). ` +
          "İcra takibi yalnızca ICRA türündeki dosyalara bağlanabilir.",
      );
    }

    let created: EnforcementFile;
    try {
      created = await this.prisma.client.enforcementFile.create({
        data: {
          tenantId: user.tenantId,
          caseId: input.caseId,
          officeName: input.officeName,
          fileNumber: input.fileNumber,
          trackingType: input.trackingType,
          principalAmount: input.principalAmount,
          interestRate: input.interestRate ?? null,
          currency: input.currency ?? "TRY",
          requestDate: input.requestDate,
          interestStartDate: input.interestStartDate ?? null,
          paymentOrderServedAt: input.paymentOrderServedAt ?? null,
          debtorInfo: input.debtorInfo ?? null,
          stage: input.paymentOrderServedAt ? "ODEME_EMRI_TEBLIG" : "TAKIP_TALEBI",
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException(
          "Bu dosyaya bağlı bir icra takibi zaten var. Bir dosyaya yalnızca bir icra takibi bağlanabilir.",
        );
      }
      throw err;
    }

    await this.prisma.client.timelineEvent.create({
      data: {
        tenantId: user.tenantId,
        caseId: input.caseId,
        userId: user.userId,
        title: `İcra takibi açıldı: ${created.officeName} ${created.fileNumber}`,
        detail: `${created.trackingType} · Asıl alacak ${requiredMoney(created.principalAmount)} ${created.currency}`,
        source: "SISTEM",
      },
    });
    await touchCase(this.prisma.client, input.caseId);
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "ENFORCEMENT_CREATE",
      entity: "EnforcementFile",
      entityId: created.id,
      detail: `${created.officeName} ${created.fileNumber} (${created.trackingType})`,
    });

    // Ödeme emri tarihi baştan girildiyse İİK itiraz süresi ÖNERİ olarak açılır.
    const deadlineSuggestions = input.paymentOrderServedAt
      ? await this.proposeDeadlines(user, created)
      : { created: [], skipped: [] };

    return { ...serializeFile(created), deadlineSuggestions };
  }

  /** GET /enforcement/:id — safahat + malvarlığı + tahsilat + bakiye + skor. */
  async detail(user: AuthUser, id: string, asOfParam?: string) {
    // Yanıt bakiyeyi, tahsilat kayıtlarını ve malvarlığını GÖMÜLÜ döndürür;
    // bu yüzden kapı finans okuma kapısıdır.
    assertFinanceAccess(user, FINANCE_ACCESS.READ, "icra dosyası detayını görüntüleme");
    const tenantId = user.tenantId;
    const file = await this.prisma.client.enforcementFile.findFirst({
      where: { id, tenantId },
      include: {
        case: {
          select: {
            id: true,
            title: true,
            fileNumber: true,
            type: true,
            status: true,
            client: { select: { id: true, name: true, type: true } },
            responsibleUser: { select: { id: true, fullName: true } },
          },
        },
        actions: { orderBy: { date: "desc" } },
        assets: { orderBy: { discoveredAt: "desc" } },
        collections: { orderBy: { date: "desc" } },
      },
    });
    if (!file) throw new NotFoundException("İcra dosyası bulunamadı.");

    const asOf = asOfParam ? parseDateParam(asOfParam, "asOf") : undefined;
    const [balance, latestScore] = await Promise.all([
      this.balance.compute(tenantId, id, asOf),
      this.score.latest(tenantId, id),
    ]);

    return {
      ...serializeFile(file),
      actions: file.actions.map(serializeAction),
      assets: file.assets.map(serializeAsset),
      collections: file.collections.map(serializeCollection),
      balance,
      latestScore,
      stageLabel: STAGE_LABELS[file.stage],
      allowedStages: STAGE_TRANSITIONS[file.stage],
    };
  }

  /** PATCH /enforcement/:id */
  async update(user: AuthUser, id: string, input: UpdateEnforcementInput) {
    assertRole(user, ROLE_SETS.HUKUKI, "icra dosyası güncelleme");
    const existing = await this.requireFile(user.tenantId, id);

    /**
     * PARASAL ÇAPALARIN GERİYE DÖNÜK DEĞİŞİMİ (denetim bulgusu 13).
     *
     * Bakiye TÜRETİLMİŞ bir değerdir: `principalAmount`, `requestDate`,
     * `interestStartDate`, `interestRate` ya da `currency` değişince dünkü
     * 347.500 TL'lik bakiye bugün bambaşka bir rakam olur ve TÜM geçmiş hesap
     * geriye dönük kayar. Dosyada tahsilat kaydı varsa bu, muhasebe izini
     * sessizce yeniden yazmaktır.
     *
     * İki koruma: (a) tahsilat varken bu alanlar YALNIZ onay yetkisiyle ve
     * ZORUNLU gerekçeyle değişir, (b) denetim izine alan adı değil ESKİ → YENİ
     * DEĞER yazılır (`INVOICE_FINALIZE`/`PAYMENT_CREATE` ile aynı disiplin).
     */
    const monetaryAnchors = [
      "principalAmount",
      "requestDate",
      "interestStartDate",
      "interestRate",
      "currency",
    ] as const;
    const changedAnchors = monetaryAnchors.filter((k) => {
      const next = (input as Record<string, unknown>)[k];
      if (next === undefined) return false;
      return !sameValue((existing as unknown as Record<string, unknown>)[k], next);
    });

    if (changedAnchors.length > 0) {
      const collectionCount = await this.prisma.client.collectionRecord.count({
        where: { tenantId: user.tenantId, enforcementFileId: id },
      });
      if (collectionCount > 0) {
        assertRole(
          user,
          ROLE_SETS.ONAY,
          "tahsilat kaydı bulunan dosyada asıl alacak/faiz/tarih çapasını değiştirme",
        );
        if (!input.changeReason?.trim()) {
          throw new UnprocessableEntityException({
            message:
              `${this.fileLabel(existing)} dosyasında ${collectionCount} tahsilat kaydı var. ` +
              `Bakiye türetilmiş bir değer olduğu için ${changedAnchors.join(", ")} alanlarının ` +
              "değiştirilmesi GEÇMİŞ HESABI da değiştirir. Değişikliğin gerekçesini " +
              "`changeReason` alanına yazınız; gerekçe denetim izine kaydedilir.",
            changedFields: changedAnchors,
            requiredField: "changeReason",
          });
        }
      }
    }

    const data: Prisma.EnforcementFileUncheckedUpdateInput = {};
    if (input.officeName !== undefined) data.officeName = input.officeName;
    if (input.fileNumber !== undefined) data.fileNumber = input.fileNumber;
    if (input.trackingType !== undefined) data.trackingType = input.trackingType;
    if (input.principalAmount !== undefined) data.principalAmount = input.principalAmount;
    if (input.interestRate !== undefined) data.interestRate = input.interestRate;
    if (input.currency !== undefined) data.currency = input.currency;
    if (input.requestDate !== undefined) data.requestDate = input.requestDate;
    if (input.interestStartDate !== undefined) data.interestStartDate = input.interestStartDate;
    if (input.paymentOrderServedAt !== undefined) data.paymentOrderServedAt = input.paymentOrderServedAt;
    if (input.objectionDate !== undefined) data.objectionDate = input.objectionDate;
    if (input.finalizedAt !== undefined) data.finalizedAt = input.finalizedAt;
    if (input.debtorInfo !== undefined) data.debtorInfo = input.debtorInfo;

    const updated = await this.prisma.client.enforcementFile.update({ where: { id }, data });
    await touchCase(this.prisma.client, existing.caseId);

    // Denetim izi: parasal alanlarda ESKİ → YENİ DEĞER yazılır. Yalnız alan
    // adını yazmak ("güncellenen alanlar: principalAmount") bir tutarın neden
    // ve ne kadar değiştiğini 10 yıl sonra yanıtlanamaz kılıyordu.
    const anchorTrail = changedAnchors.map((k) => {
      const before = (existing as unknown as Record<string, unknown>)[k];
      const after = (updated as unknown as Record<string, unknown>)[k];
      return `${k}: ${displayValue(before)} → ${displayValue(after)}`;
    });
    const otherFields = Object.keys(input).filter(
      (k) => k !== "changeReason" && !(changedAnchors as readonly string[]).includes(k),
    );

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "ENFORCEMENT_UPDATE",
      entity: "EnforcementFile",
      entityId: id,
      detail:
        `${this.fileLabel(existing)} — ` +
        [
          anchorTrail.length > 0 ? `PARASAL ÇAPA: ${anchorTrail.join(" · ")}` : null,
          otherFields.length > 0 ? `diğer alanlar: ${otherFields.join(", ")}` : null,
          input.changeReason ? `gerekçe: ${input.changeReason}` : null,
        ]
          .filter(Boolean)
          .join(" | "),
    });

    /**
     * SÜRE ENTEGRASYONU (Modül 05 kural 2): tebliğ/itiraz tarihi DEĞİŞTİYSE
     * İİK süreleri yeniden hesaplanır ve ONAY BEKLEYEN öneri olarak sunulur.
     * Var olan kayıt tekrarlanmaz (persistCandidates idempotenttir).
     */
    const triggerChanged =
      (input.paymentOrderServedAt !== undefined &&
        !sameDay(existing.paymentOrderServedAt, updated.paymentOrderServedAt)) ||
      (input.objectionDate !== undefined && !sameDay(existing.objectionDate, updated.objectionDate));

    const deadlineSuggestions = triggerChanged
      ? await this.proposeDeadlines(user, updated)
      : { created: [], skipped: [] };

    return { ...serializeFile(updated), deadlineSuggestions };
  }

  /**
   * PATCH /enforcement/:id/stage — aşama geçişi.
   *
   * Geçerlilik üç katmanda denetlenir:
   *  1. Şerit kuralı (enforcement-stage.ts) — geçersiz sıçrama 422.
   *  2. Kanıt kuralı — SATIS için haciz uygulaması şart (Modül 05 kural 4).
   *  3. Kapanış kuralı — bakiye sıfır değilse gerekçe şart (kural 9).
   */
  async changeStage(user: AuthUser, id: string, input: ChangeStageInput) {
    assertRole(user, ROLE_SETS.HUKUKI, "icra aşaması değiştirme");
    const existing = await this.requireFile(user.tenantId, id);
    const label = this.fileLabel(existing);
    const from = existing.stage;
    const to = input.stage;

    assertStageTransition(label, from, to);
    await this.assertStagePreconditions(user, existing, to, input);

    const now = new Date();
    /**
     * ÖDEME EMRİ TEBLİĞ TARİHİ AŞAMAYLA BİRLİKTE ÇAPALANIR.
     *
     * `ITIRAZ` (objectionDate) ve `KAPANDI` (closedAt) için zaten yapılan şey,
     * `ODEME_EMRI_TEBLIG` için YAPILMIYORDU — ve süre motoru itiraz süresini
     * YALNIZCA `paymentOrderServedAt` doluyken tetiklediği için bu yoldan
     * ilerleyen dosyada İİK m.62 süresi hiç doğmuyordu (denetim bulgusu 7).
     * Ön koşul denetimi `assertStagePreconditions` içindedir; burada yazılır.
     */
    const servedAt =
      to === "ODEME_EMRI_TEBLIG"
        ? (existing.paymentOrderServedAt ?? input.servedAt ?? null)
        : existing.paymentOrderServedAt;

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const result = await tx.enforcementFile.update({
        where: { id },
        data: {
          stage: to,
          // Aşama, ilgili tarih alanlarını da çapalar (boşsa doldurur, ezmez).
          paymentOrderServedAt: servedAt,
          finalizedAt: to === "KESINLESME" ? (existing.finalizedAt ?? now) : existing.finalizedAt,
          objectionDate: to === "ITIRAZ" ? (existing.objectionDate ?? now) : existing.objectionDate,
          closedAt: to === "KAPANDI" ? (existing.closedAt ?? now) : existing.closedAt,
        },
      });
      await tx.timelineEvent.create({
        data: {
          tenantId: user.tenantId,
          caseId: existing.caseId,
          userId: user.userId,
          date: now,
          title: `İcra aşaması değişti: ${STAGE_LABELS[from]} → ${STAGE_LABELS[to]}`,
          detail: [input.note, input.closureReason].filter(Boolean).join(" · ") || undefined,
          source: "SISTEM",
        },
      });
      return result;
    });

    await touchCase(this.prisma.client, existing.caseId);
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "ENFORCEMENT_STAGE_CHANGE",
      entity: "EnforcementFile",
      entityId: id,
      detail:
        `${label}: ${from} → ${to}` +
        (input.closureReason ? ` (kapanış gerekçesi: ${input.closureReason})` : "") +
        (input.overrideReason
          ? ` (ÖN KOŞUL AŞILDI — gerekçe: ${input.overrideReason})`
          : "") +
        (to === "ODEME_EMRI_TEBLIG" && servedAt
          ? ` (tebliğ tarihi: ${formatTrDate(servedAt)})`
          : "") +
        (input.note ? ` (${input.note})` : ""),
    });

    // Tebliğ (İİK m.62 itiraz süresi), itiraz (m.67 itirazın iptali) ve
    // kesinleşme aşamalarında süreler ÖNERİ olarak açılır.
    const deadlineSuggestions =
      to === "ITIRAZ" || to === "KESINLESME" || to === "ODEME_EMRI_TEBLIG"
        ? await this.proposeDeadlines(user, updated)
        : { created: [], skipped: [] };

    return {
      ...serializeFile(updated),
      stageLabel: STAGE_LABELS[updated.stage],
      allowedStages: STAGE_TRANSITIONS[updated.stage],
      deadlineSuggestions,
    };
  }

  /** DELETE /enforcement/:id — takip kaydını siler, Case'e dokunmaz. */
  async remove(user: AuthUser, id: string) {
    assertRole(user, ROLE_SETS.ONAY, "icra takibi silme");
    const existing = await this.requireFile(user.tenantId, id);

    const collectionCount = await this.prisma.client.collectionRecord.count({
      where: { tenantId: user.tenantId, enforcementFileId: id },
    });
    if (collectionCount > 0) {
      // Tahsilat kaydı silinmesi muhasebe izini koparır (hazırlık notu 15).
      throw new UnprocessableEntityException(
        `${this.fileLabel(existing)} dosyasında ${collectionCount} tahsilat kaydı bulunuyor ve ` +
          "silinemez. Takibi kapatmak için aşamayı KAPANDI'ya alın; muhasebe izi korunur.",
      );
    }

    await this.prisma.client.enforcementFile.delete({ where: { id } });
    await this.prisma.client.timelineEvent.create({
      data: {
        tenantId: user.tenantId,
        caseId: existing.caseId,
        userId: user.userId,
        title: `İcra takibi silindi: ${this.fileLabel(existing)}`,
        source: "SISTEM",
      },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "ENFORCEMENT_DELETE",
      entity: "EnforcementFile",
      entityId: id,
      detail: this.fileLabel(existing),
    });
    return { ok: true, id };
  }

  // ================================================================== //
  // Safahat (aksiyonlar)
  // ================================================================== //

  async listActions(
    user: AuthUser,
    fileId: string,
    params: { type?: string; page?: string; limit?: string },
  ) {
    // Safahat kayıtları masraf/harç TUTARI taşır (MASRAF, HARC_ODEME, TAHSILAT).
    assertFinanceAccess(user, FINANCE_ACCESS.READ, "icra işlem günlüğünü görüntüleme");
    const tenantId = user.tenantId;
    await this.requireFile(tenantId, fileId);
    const pageParams = resolvePage(params);
    const where: Prisma.EnforcementActionWhereInput = { tenantId, enforcementFileId: fileId };
    if (params.type) where.type = params.type as Prisma.EnforcementActionWhereInput["type"];

    const [items, total] = await Promise.all([
      this.prisma.client.enforcementAction.findMany({
        where,
        orderBy: { date: "desc" },
        skip: pageParams.skip,
        take: pageParams.take,
      }),
      this.prisma.client.enforcementAction.count({ where }),
    ]);
    return paged(items.map(serializeAction), total, pageParams);
  }

  /**
   * POST /enforcement/:id/actions — safahat kaydı.
   *
   * Her aksiyon aynı zamanda Case'in resmî kronolojisine (TimelineEvent) yazılır
   * ve `Case.lastActivityAt` tazelenir; icra dosyası UYAP'a girmeden takip
   * edilebilsin diye (Modül 05 kullanıcı hikâyesi 4).
   */
  async createAction(user: AuthUser, fileId: string, input: CreateActionInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "icra işlemi kaydetme");
    const file = await this.requireFile(user.tenantId, fileId);

    const action = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.enforcementAction.create({
        data: {
          tenantId: user.tenantId,
          enforcementFileId: fileId,
          type: input.type,
          date: input.date,
          description: input.description,
          amount: input.amount ?? null,
          resultNote: input.resultNote ?? null,
          createdBy: user.userId,
        },
      });
      await tx.timelineEvent.create({
        data: {
          tenantId: user.tenantId,
          caseId: file.caseId,
          userId: user.userId,
          date: input.date,
          title: `İcra işlemi: ${input.type}`,
          detail: [input.description, input.resultNote, input.amount ? `Tutar: ${input.amount}` : null]
            .filter(Boolean)
            .join(" · "),
          source: "SISTEM",
        },
      });
      return created;
    });

    await touchCase(this.prisma.client, file.caseId);
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "ENFORCEMENT_ACTION_CREATE",
      entity: "EnforcementAction",
      entityId: action.id,
      detail: `${this.fileLabel(file)} — ${action.type}: ${action.description.slice(0, 120)}`,
    });

    // İTİRAZ işlemi girildiğinde tarih çapası dosyaya işlenir ve İİK m.67
    // süresi öneri olarak açılır (Modül 05 kural 3). Aşamayı AVUKAT değiştirir.
    let deadlineSuggestions: Awaited<ReturnType<EnforcementService["proposeDeadlines"]>> = {
      created: [],
      skipped: [],
    };
    if (input.type === "ITIRAZ" && !file.objectionDate) {
      const updated = await this.prisma.client.enforcementFile.update({
        where: { id: fileId },
        data: { objectionDate: input.date },
      });
      deadlineSuggestions = await this.proposeDeadlines(user, updated);
    } else if (input.type === "IHALE") {
      const current = await this.prisma.client.enforcementFile.findUniqueOrThrow({ where: { id: fileId } });
      deadlineSuggestions = await this.proposeDeadlines(user, current);
    }

    const warnings: string[] = [];
    if (input.type === "ITIRAZ" && file.stage !== "ITIRAZ") {
      warnings.push(
        "İtiraz işlemi kaydedildi ancak dosya aşaması hâlâ " +
          `«${STAGE_LABELS[file.stage]}». İtiraz takibi durdurur; aşamayı İTİRAZ olarak ` +
          "güncellemeyi değerlendirin (aşama değişikliği avukat kararıdır, otomatik yapılmaz).",
      );
    }

    return { ...serializeAction(action), deadlineSuggestions, warnings };
  }

  async updateAction(user: AuthUser, actionId: string, input: UpdateActionInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "icra işlemi güncelleme");
    const existing = await this.requireAction(user.tenantId, actionId);

    const data: Prisma.EnforcementActionUncheckedUpdateInput = {};
    if (input.type !== undefined) data.type = input.type;
    if (input.date !== undefined) data.date = input.date;
    if (input.description !== undefined) data.description = input.description;
    if (input.amount !== undefined) data.amount = input.amount;
    if (input.resultNote !== undefined) data.resultNote = input.resultNote;

    const updated = await this.prisma.client.enforcementAction.update({ where: { id: actionId }, data });
    await touchCase(this.prisma.client, existing.enforcementFile.caseId);
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "ENFORCEMENT_ACTION_UPDATE",
      entity: "EnforcementAction",
      entityId: actionId,
      detail: `Güncellenen alanlar: ${Object.keys(input).join(", ")}`,
    });
    return serializeAction(updated);
  }

  async removeAction(user: AuthUser, actionId: string) {
    const existing = await this.requireAction(user.tenantId, actionId);
    // Kendi kaydını herkes silebilir; başkasınınkini yalnız ortak/yönetici.
    if (existing.createdBy !== user.userId && !hasRole(user, ROLE_SETS.ONAY)) {
      assertRole(user, ROLE_SETS.ONAY, "başkasının icra işlem kaydını silme");
    }

    await this.prisma.client.enforcementAction.delete({ where: { id: actionId } });
    await touchCase(this.prisma.client, existing.enforcementFile.caseId);
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "ENFORCEMENT_ACTION_DELETE",
      entity: "EnforcementAction",
      entityId: actionId,
      detail: `${existing.type}: ${existing.description.slice(0, 120)}`,
    });
    return { ok: true, id: actionId };
  }

  // ================================================================== //
  // Malvarlığı
  // ================================================================== //

  async listAssets(user: AuthUser, fileId: string, params: { status?: string }) {
    // Borçlunun malvarlığı ve tahmini değerleri finansal veridir.
    assertFinanceAccess(user, FINANCE_ACCESS.READ, "borçlu malvarlığı kayıtlarını görüntüleme");
    const tenantId = user.tenantId;
    await this.requireFile(tenantId, fileId);
    const where: Prisma.AssetRecordWhereInput = { tenantId, enforcementFileId: fileId };
    if (params.status) {
      if (!(ASSET_STATUSES as readonly string[]).includes(params.status)) {
        throw new BadRequestException("Geçersiz malvarlığı durumu.");
      }
      where.status = params.status as AssetStatus;
    }
    const items = await this.prisma.client.assetRecord.findMany({
      where,
      orderBy: { discoveredAt: "desc" },
    });
    return items.map(serializeAsset);
  }

  async createAsset(user: AuthUser, fileId: string, input: CreateAssetInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "malvarlığı kaydı ekleme");
    const file = await this.requireFile(user.tenantId, fileId);

    const asset = await this.prisma.client.assetRecord.create({
      data: {
        tenantId: user.tenantId,
        enforcementFileId: fileId,
        assetType: input.assetType,
        description: input.description,
        estimatedValue: input.estimatedValue ?? null,
        status: input.status ?? "TESPIT_EDILDI",
        discoveredAt: input.discoveredAt,
        note: input.note ?? null,
      },
    });
    await touchCase(this.prisma.client, file.caseId);
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "ENFORCEMENT_ASSET_CREATE",
      entity: "AssetRecord",
      entityId: asset.id,
      detail: `${this.fileLabel(file)} — ${asset.assetType}: ${asset.description.slice(0, 120)}`,
    });
    return serializeAsset(asset);
  }

  /** PATCH /assets/:id — durum şeridi denetlenir. */
  async updateAsset(user: AuthUser, assetId: string, input: UpdateAssetInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "malvarlığı kaydı güncelleme");
    const existing = await this.requireAsset(user.tenantId, assetId);

    if (input.status !== undefined && input.status !== existing.status) {
      const allowed = ASSET_TRANSITIONS[existing.status];
      if (!allowed.includes(input.status)) {
        throw new UnprocessableEntityException({
          message:
            `«${existing.description.slice(0, 60)}» kaydı ` +
            `«${ASSET_STATUS_LABELS[existing.status]}» durumundan ` +
            `«${ASSET_STATUS_LABELS[input.status]}» durumuna geçirilemez. ` +
            `İzin verilen durumlar: ${allowed.map((s) => ASSET_STATUS_LABELS[s]).join(", ") || "yok"}.`,
          currentStatus: existing.status,
          allowedStatuses: allowed,
        });
      }
    }

    const data: Prisma.AssetRecordUncheckedUpdateInput = {};
    if (input.assetType !== undefined) data.assetType = input.assetType;
    if (input.description !== undefined) data.description = input.description;
    if (input.estimatedValue !== undefined) data.estimatedValue = input.estimatedValue;
    if (input.status !== undefined) data.status = input.status;
    if (input.discoveredAt !== undefined) data.discoveredAt = input.discoveredAt;
    if (input.note !== undefined) data.note = input.note;

    const updated = await this.prisma.client.assetRecord.update({ where: { id: assetId }, data });
    await touchCase(this.prisma.client, existing.enforcementFile.caseId);
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "ENFORCEMENT_ASSET_UPDATE",
      entity: "AssetRecord",
      entityId: assetId,
      detail:
        input.status && input.status !== existing.status
          ? `Durum: ${existing.status} → ${input.status}`
          : `Güncellenen alanlar: ${Object.keys(input).join(", ")}`,
    });
    return serializeAsset(updated);
  }

  // ================================================================== //
  // Tahsilat
  // ================================================================== //

  async listCollections(user: AuthUser, fileId: string) {
    assertFinanceAccess(user, FINANCE_ACCESS.READ, "icra tahsilat geçmişini görüntüleme");
    const tenantId = user.tenantId;
    await this.requireFile(tenantId, fileId);
    const items = await this.prisma.client.collectionRecord.findMany({
      where: { tenantId, enforcementFileId: fileId },
      orderBy: { date: "desc" },
    });
    const balance = await this.balance.compute(tenantId, fileId);
    return { items: items.map(serializeCollection), balance };
  }

  /**
   * POST /enforcement/:id/collections — tahsilat girişi.
   *
   * TEK İŞLEMDE (transaction):
   *   a) CollectionRecord yazılır,
   *   b) istenirse FinancialEntry (TAHSILAT) açılır — müvekkil carisine yansır,
   *   c) tahsilat safahata (EnforcementAction TAHSILAT + TimelineEvent) düşer.
   * Ardından bakiye DETERMİNİSTİK olarak yeniden hesaplanır; borç kapandıysa
   * aşama TAHSILAT'a alınır (şerit izin veriyorsa).
   */
  async createCollection(user: AuthUser, fileId: string, input: CreateCollectionInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "tahsilat kaydetme");

    /**
     * AYNI TABLO, AYNI YETKİ KAPISI (denetim bulgusu 7).
     *
     * Tahsilat kaydının KENDİSİ operasyon işidir ve SEKRETER girebilir. Ama
     * `createFinancialEntry` müvekkil CARİSİNE yazar; aynı kaydı
     * `/finance/entries` üzerinden açmak `FINANCE_ACCESS.ENTRY_WRITE` ister ve
     * SEKRETER oradan HARİÇTİR. İkinci bir giriş kapısı bırakmak, beyaz liste
     * olarak kurulmuş finans matrisini fiilen kara listeye çevirirdi: sekreter,
     * finans modülünde reddedilen yazmayı icra modülünden yapardı.
     *
     * Bu yüzden cari etkisi olan dal AYRICA daraltılır; tahsilat kaydı
     * OPERASYON'da kalır.
     */
    if (input.createFinancialEntry) {
      assertFinanceAccess(
        user,
        FINANCE_ACCESS.ENTRY_WRITE,
        "icra tahsilatından müvekkil cari kaydı (FinancialEntry) oluşturma"
      );
    }

    const file = await this.requireFile(user.tenantId, fileId);

    const relatedCase = await this.prisma.client.case.findFirstOrThrow({
      where: { id: file.caseId, tenantId: user.tenantId },
      select: { id: true, clientId: true, title: true, fileNumber: true },
    });

    const warnings: string[] = [];
    const before = await this.balance.compute(user.tenantId, fileId);
    const amount = new Prisma.Decimal(input.amount);
    const remainingBefore = new Prisma.Decimal(before.remaining);
    if (amount.greaterThan(remainingBefore)) {
      // Kural 5: tahsilat toplamı borcu aşmamalı. Engellemek yerine UYARIYORUZ:
      // ferî alacaklar (harç, faiz farkı) dosyaya sonradan işlenmiş olabilir.
      warnings.push(
        `Girilen tahsilat (${amount.toFixed(2)} ${file.currency}), hesaplanan kalan borcu ` +
          `(${remainingBefore.toFixed(2)} ${file.currency}) aşıyor. Ferî alacaklar dosyaya ` +
          "işlenmemiş olabilir; masraf/harç kayıtlarını ve faiz oranını kontrol ediniz.",
      );
    }
    if (input.method === "ANLASMA") {
      warnings.push(
        "Haricen/anlaşma yoluyla tahsilatta tahsil harcı yükümlülüğü doğar. Harcın " +
          "yatırılmaması dosyanın işlemden kaldırılmasına yol açabilir; harç kaydını da giriniz.",
      );
    }

    const result = await this.prisma.client.$transaction(async (tx) => {
      const collection = await tx.collectionRecord.create({
        data: {
          tenantId: user.tenantId,
          enforcementFileId: fileId,
          amount: input.amount,
          date: input.date,
          method: input.method,
          note: input.note ?? null,
          createdBy: user.userId,
        },
      });

      let financialEntryId: string | null = null;
      if (input.createFinancialEntry) {
        const entry = await tx.financialEntry.create({
          data: {
            tenantId: user.tenantId,
            clientId: relatedCase.clientId,
            caseId: file.caseId,
            type: "TAHSILAT",
            amount: input.amount,
            currency: file.currency,
            date: input.date,
            description:
              `İcra tahsilatı — ${file.officeName} ${file.fileNumber} (${input.method})` +
              (input.note ? ` · ${input.note}` : ""),
            // Tahsilat bir gelir kaydıdır, müvekkile yeniden faturalanmaz.
            isBillable: false,
          },
        });
        financialEntryId = entry.id;
      }

      // Tahsilat aynı zamanda bir icra işlemidir; safahatta görünmelidir.
      await tx.enforcementAction.create({
        data: {
          tenantId: user.tenantId,
          enforcementFileId: fileId,
          type: "TAHSILAT",
          date: input.date,
          description: `Tahsilat: ${requiredMoney(input.amount)} ${file.currency} (${input.method})`,
          amount: input.amount,
          resultNote: input.note ?? null,
          createdBy: user.userId,
        },
      });
      await tx.timelineEvent.create({
        data: {
          tenantId: user.tenantId,
          caseId: file.caseId,
          userId: user.userId,
          date: input.date,
          title: `İcra tahsilatı: ${requiredMoney(input.amount)} ${file.currency}`,
          detail: `${file.officeName} ${file.fileNumber} · ${input.method}`,
          source: "SISTEM",
        },
      });

      return { collection, financialEntryId };
    });

    await touchCase(this.prisma.client, file.caseId);

    // (a) BAKİYE YENİDEN HESAPLANIR — deterministik, Decimal.
    const after = await this.balance.compute(user.tenantId, fileId);

    // (c) Borç tamamen kapandıysa aşama TAHSILAT'a alınır (şerit izin veriyorsa).
    let stageChanged: { from: EnforcementStage; to: EnforcementStage } | null = null;
    const fullyCollected = new Prisma.Decimal(after.remaining).lessThanOrEqualTo(0);
    if (fullyCollected && file.stage !== "TAHSILAT") {
      if (STAGE_TRANSITIONS[file.stage].includes("TAHSILAT")) {
        await this.prisma.client.enforcementFile.update({
          where: { id: fileId },
          data: { stage: "TAHSILAT" },
        });
        await this.prisma.client.timelineEvent.create({
          data: {
            tenantId: user.tenantId,
            caseId: file.caseId,
            userId: user.userId,
            title: `İcra aşaması değişti: ${STAGE_LABELS[file.stage]} → ${STAGE_LABELS.TAHSILAT}`,
            detail: "Kalan borç sıfırlandığı için aşama otomatik güncellendi (deterministik kural).",
            source: "SISTEM",
          },
        });
        stageChanged = { from: file.stage, to: "TAHSILAT" };
      } else {
        warnings.push(
          `Kalan borç sıfırlandı ancak dosya «${STAGE_LABELS[file.stage]}» aşamasından doğrudan ` +
            "TAHSILAT aşamasına geçemez. Aşamayı elle ilerletiniz.",
        );
      }
    }

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "ENFORCEMENT_COLLECTION_CREATE",
      entity: "CollectionRecord",
      entityId: result.collection.id,
      detail:
        `${this.fileLabel(file)} — ${requiredMoney(input.amount)} ${file.currency} (${input.method}) · ` +
        `kalan: ${after.remaining}`,
    });

    return {
      ...serializeCollection(result.collection),
      financialEntryId: result.financialEntryId,
      balance: after,
      stageChanged,
      warnings: [...warnings, ...after.warnings],
    };
  }

  // ================================================================== //
  // Bakiye ve süre uçları
  // ================================================================== //

  /** GET /enforcement/:id/balance */
  async getBalance(user: AuthUser, fileId: string, asOfParam?: string) {
    assertFinanceAccess(user, FINANCE_ACCESS.READ, "icra bakiyesini görüntüleme");
    const tenantId = user.tenantId;
    await this.requireFile(tenantId, fileId);
    const asOf = asOfParam ? parseDateParam(asOfParam, "asOf") : undefined;
    return this.balance.compute(tenantId, fileId, asOf);
  }

  /** GET /enforcement/:id/score — en son skor kaydı (rol kapısı serviste). */
  async latestScore(user: AuthUser, fileId: string) {
    assertFinanceAccess(user, FINANCE_ACCESS.READ, "tahsil kabiliyeti skorunu görüntüleme");
    await this.requireFile(user.tenantId, fileId);
    return this.score.latest(user.tenantId, fileId);
  }

  /** GET /enforcement/:id/deadlines — hesap, kayıt YOK. */
  async previewDeadlines(user: AuthUser, fileId: string) {
    // Süre hesabı finansal değildir ama takip dosyasına erişim gerektirir.
    assertRole(user, ROLE_SETS.OPERASYON, "icra sürelerini görüntüleme");
    const tenantId = user.tenantId;
    const file = await this.requireFullFile(tenantId, fileId);
    const audit = await this.deadlines.auditDeadlines(tenantId, file);
    return {
      candidates: audit.candidates,
      recorded: audit.recorded,
      overdueOpen: audit.overdueOpen,
      upcoming: audit.upcoming,
      unrecorded: audit.unrecorded,
      notice:
        "Bu hesaplar DETERMİNİSTİK süre motorundan gelir (AI kullanılmaz). Kayıt açıldığında " +
        "süre ONAY BEKLİYOR durumunda oluşur; kesinleşmesi için avukat onayı gerekir.",
    };
  }

  /** POST /enforcement/:id/deadlines/suggest — hesap + isteğe bağlı BEKLIYOR kaydı. */
  async suggestDeadlines(user: AuthUser, fileId: string, input: SuggestDeadlinesInput) {
    const file = await this.requireFullFile(user.tenantId, fileId);
    const candidates = await this.deadlines.computeCandidates(user.tenantId, file);
    if (!input.persist) {
      return { candidates, created: [], skipped: [], persisted: false };
    }
    assertRole(user, ROLE_SETS.HUKUKI, "icra süresi oluşturma");
    const saved = await this.deadlines.persistCandidates(user, file, candidates, input.ownerId);
    return { candidates, ...saved, persisted: true };
  }

  // ================================================================== //
  // Yardımcılar
  // ================================================================== //

  /** Öneri sürelerini BEKLIYOR statüsünde açar; hata iş akışını kesmez. */
  private async proposeDeadlines(user: AuthUser, file: EnforcementFile) {
    try {
      const candidates = await this.deadlines.computeCandidates(user.tenantId, file);
      return await this.deadlines.persistCandidates(user, file, candidates);
    } catch {
      // Süre önerisi yan etkidir; ana işlemi (dosya/aksiyon kaydı) düşürmez.
      return { created: [], skipped: [{ ruleKey: "*", reason: "Süre önerisi hesaplanamadı." }] };
    }
  }

  /** Aşama geçişinin kanıt ve kapanış ön koşulları. */
  private async assertStagePreconditions(
    user: AuthUser,
    file: EnforcementFile,
    to: EnforcementStage,
    input: ChangeStageInput,
  ): Promise<void> {
    const label = this.fileLabel(file);

    /**
     * ÖDEME EMRİ TEBLİĞ AŞAMASI TARİHSİZ OLAMAZ (denetim bulgusu 7).
     *
     * Aşamanın hukuki anlamı bu tarihe bağlıdır; tarih yoksa İİK m.62 / m.168
     * itiraz süresi HİÇ hesaplanmaz, hiç önerilmez ve eksik süre raporunda bile
     * görünmez — motor tetikleyici görmediği için "eksik" diye de raporlayamaz.
     */
    if (to === "ODEME_EMRI_TEBLIG" && !file.paymentOrderServedAt && !input.servedAt) {
      throw new UnprocessableEntityException({
        message:
          `${label} dosyası, ödeme emri tebliğ TARİHİ girilmeden «Ödeme emri tebliği» ` +
          "aşamasına alınamaz. Tebliğ tarihi, İİK m.62 (kambiyoda m.168/5) itiraz süresinin " +
          "tek tetikleyicisidir; girilmezse süre hesaplanmaz ve sessiz hak kaybı doğar.",
        requiredField: "servedAt",
      });
    }

    /**
     * İTİRAZ SÜRESİ DOLMADAN TAKİP KESİNLEŞTİRİLEMEZ (denetim bulgusu 6).
     *
     * `assertStagePreconditions` yalnızca SATIS ve KAPANDI için denetim
     * yapıyordu; `KESINLESME` için HİÇBİR denetim yoktu. Şerit ise
     * `ODEME_EMRI_TEBLIG → KESINLESME → HACIZ` geçişlerini serbest bırakıyor.
     * Sonuç: ödeme emri bugün tebliğ edilmiş bir dosya aynı gün KESİNLEŞME'ye,
     * ertesi gün HACİZ'e alınabiliyordu — İİK m.62'nin 7 günlük (kambiyoda
     * m.168/5, 5 günlük) itiraz süresi dolmadan. Bu, modülün kendi
     * playbook'undaki "İtiraz gelmeden SÜRE DOLARSA takip kesinleşir"
     * maddesiyle doğrudan çelişiyordu.
     *
     * Aşama makinesi, hesabı zaten yapan DETERMİNİSTİK süre motoruna danışır;
     * tarih burada tahmin edilmez.
     */
    if (to === "KESINLESME") {
      await this.assertObjectionPeriodElapsed(user, file, label, input);
    }

    // Kural 4: haciz uygulanmadan satış aşamasına geçilemez.
    if (to === "SATIS") {
      const seizure = await this.prisma.client.enforcementAction.count({
        where: {
          tenantId: user.tenantId,
          enforcementFileId: file.id,
          type: { in: [...SEIZURE_PROOF_ACTIONS] },
        },
      });
      if (seizure === 0) {
        throw new UnprocessableEntityException({
          message:
            `${label} dosyasında haciz uygulaması (HACIZ_UYGULAMA) kaydı bulunmadığı için ` +
            "SATIŞ aşamasına geçilemez. Önce haciz tutanağını işlem günlüğüne işleyiniz.",
          requiredAction: "HACIZ_UYGULAMA",
        });
      }
    }

    // Kural 9: bakiyesi sıfır olmayan dosya, gerekçesiz kapatılamaz.
    if (to === "KAPANDI") {
      const balance = await this.balance.compute(user.tenantId, file.id);
      const remaining = new Prisma.Decimal(balance.remaining);
      const hasAcizVesikasi = file.stage === "ACIZ_VESIKASI";
      if (remaining.greaterThan(0) && !hasAcizVesikasi && !input.closureReason?.trim()) {
        throw new UnprocessableEntityException({
          message:
            `${label} dosyasının ${formatTrDate(new Date())} itibarıyla ` +
            `${remaining.toFixed(2)} ${file.currency} kalan borcu var. Kapatmak için ya aciz ` +
            "vesikası aşamasından geçmeli ya da bir kapanış gerekçesi (takipten vazgeçme, " +
            "sulh, vb.) girilmelidir.",
          remaining: remaining.toFixed(2),
          requiredField: "closureReason",
        });
      }
    }
  }

  /**
   * KESİNLEŞME ÖN KOŞULU — ödeme emri tebliğ edilmiş ve itiraz süresi dolmuş mu?
   *
   * İki kapı:
   *   1. Tebliğ tarihi yoksa kesinleşme HİÇ işaretlenemez (usulsüz tebligat /
   *      erken kesinleşme iddiasının doğrudan kaynağı).
   *   2. İtiraz süresi henüz dolmamışsa 422 — avukat bilerek geçmek isterse
   *      `overrideReason` zorunludur ve AuditLog'a yazılır (`closureReason`
   *      deseninin aynısı: kuralı kaldırmıyoruz, gerekçeyi kayda geçiriyoruz).
   *
   * Süre motoru bir aday üretemezse (kural pasif, tetikleyici yok) HESAP
   * UYDURULMAZ: geçişe izin verilir ama karar avukatın olduğu belirtilir.
   */
  private async assertObjectionPeriodElapsed(
    user: AuthUser,
    file: EnforcementFile,
    label: string,
    input: ChangeStageInput,
  ): Promise<void> {
    if (!file.paymentOrderServedAt) {
      throw new UnprocessableEntityException({
        message:
          `${label} dosyasında ödeme emri tebliğ tarihi girilmediği için takip ` +
          "KESİNLEŞTİRİLEMEZ. Takibin kesinleşmesi, ödeme emrinin usulüne uygun tebliğine ve " +
          "itiraz süresinin dolmasına bağlıdır (İİK m.62). Önce tebliğ tarihini işleyiniz.",
        requiredField: "paymentOrderServedAt",
      });
    }

    // İtiraz edilmişse kesinleşme itirazın kaldırılmasına bağlıdır; süre
    // kapısı burada uygulanmaz (şerit zaten ITIRAZ → KESINLESME'yi itirazın
    // geri alınması/hükümsüzlüğü hâli için açık tutuyor).
    if (file.objectionDate) return;

    const candidates = await this.deadlines
      .computeCandidates(user.tenantId, file)
      .catch(() => [] as Awaited<ReturnType<EnforcementDeadlinesService["computeCandidates"]>>);

    const objection = candidates.find(
      (c) => c.ruleKey === "IIK_ODEME_EMRI_ITIRAZ" || c.ruleKey === "IIK_KAMBIYO_ODEME_EMRI_ITIRAZ",
    );
    // Aday yoksa hesap uydurulmaz; avukatın kararına bırakılır.
    if (!objection || objection.isOverdue) return;

    if (!input.overrideReason?.trim()) {
      throw new UnprocessableEntityException({
        message:
          `${label} dosyasında itiraz süresi HENÜZ DOLMAMIŞTIR ` +
          `(${objection.legalBasis} — son gün ${formatTrDate(objection.dueDate)}, ` +
          `${objection.daysRemaining} gün kaldı). Süre dolmadan kesinleşme işaretlenemez; ` +
          "usulsüz tebligat/erken kesinleşme iddiası doğurur ve haciz işlemlerini sakatlar. " +
          "Borçlu itirazdan feragat etmiş gibi istisnai bir durum varsa `overrideReason` " +
          "alanına gerekçeyi yazınız; gerekçe denetim izine kaydedilir.",
        ruleKey: objection.ruleKey,
        legalBasis: objection.legalBasis,
        dueDate: objection.dueDate,
        daysRemaining: objection.daysRemaining,
        requiredField: "overrideReason",
      });
    }
  }

  private fileLabel(file: { officeName: string; fileNumber: string }): string {
    return `${file.officeName} ${file.fileNumber}`;
  }

  private async requireFile(tenantId: string, id: string) {
    const found = await this.prisma.client.enforcementFile.findFirst({ where: { id, tenantId } });
    if (!found) throw new NotFoundException("İcra dosyası bulunamadı.");
    return found;
  }

  /** requireFile ile aynı; adı, tam kaydın gerektiği yerlerde niyeti belirtir. */
  private async requireFullFile(tenantId: string, id: string): Promise<EnforcementFile> {
    return this.requireFile(tenantId, id);
  }

  private async requireAction(tenantId: string, id: string) {
    const found = await this.prisma.client.enforcementAction.findFirst({
      where: { id, tenantId },
      include: { enforcementFile: { select: { id: true, caseId: true } } },
    });
    if (!found) throw new NotFoundException("İcra işlem kaydı bulunamadı.");
    return found;
  }

  private async requireAsset(tenantId: string, id: string) {
    const found = await this.prisma.client.assetRecord.findFirst({
      where: { id, tenantId },
      include: { enforcementFile: { select: { id: true, caseId: true } } },
    });
    if (!found) throw new NotFoundException("Malvarlığı kaydı bulunamadı.");
    return found;
  }
}

/**
 * Denetim izi için değer karşılaştırması.
 * Decimal ve Date karşılaştırması `===` ile yapılamaz; metne indirgenir.
 */
function sameValue(before: unknown, after: unknown): boolean {
  return displayValue(before) === displayValue(after);
}

/** Denetim izine yazılacak okunur değer ("40000.00", "18.06.2026", "—"). */
function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (value instanceof Date) return formatTrDate(value);
  if (value instanceof Prisma.Decimal) return value.toFixed(2);
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
    return new Prisma.Decimal(value).toFixed(2);
  }
  return String(value);
}

/** İki tarihin (null olabilir) aynı TAKVİM GÜNÜNÜ gösterip göstermediği. */
function sameDay(a: Date | null, b: Date | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  // İ-24: `getTime()` eşitliği SAAT farkına duyarlıdır — 14:03 ve 15:10 aynı
  // günde olduğu hâlde farklı sayılıyordu ("gün" diyordu, gün karşılaştırmıyordu).
  // Takvim günü karşılaştırması TR bölgesine göre normalleştirilir.
  return trCalendarDay(a).getTime() === trCalendarDay(b).getTime();
}
