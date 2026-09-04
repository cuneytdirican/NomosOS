/**
 * SÖZLEŞME YAŞAM DÖNGÜSÜ (Modül 20) — kayıt, sürümler, durum makinesi.
 *
 * ÜRÜN İLKELERİ:
 *
 *  1. SÜRÜMLER DEĞİŞMEZDİR (IMMUTABLE). `ContractVersion` yalnızca oluşturulur;
 *     PATCH ve DELETE ucu YOKTUR. Müzakere turlarının izi bozulmaz
 *     (docs/moduller/20, iş kuralı 7).
 *
 *  2. DURUM MAKİNESİ TEK YERDEDİR (`contract-state-machine.ts`). Servis kendi
 *     başına durum atlatmaz; tek istisna imza sürecinin başlaması/iptalidir ve
 *     o da aynı tabloya uyar.
 *
 *  3. YURURLUKTE'YE GEÇİŞ ŞARTA BAĞLIDIR: tamamlanmış imza süreci ya da
 *     avukatın AÇIK elle onayı (`manualApproval` + gerekçe). Sistem
 *     kendiliğinden "yürürlükte" demez.
 *
 *  4. SÜRE HESABI BU SERVİSTE YAPILMAZ. Fesih ihbar günü
 *     `ContractRenewalService` içinde @nomosos/legal-core ile deterministik
 *     hesaplanır ve `Deadline(BEKLIYOR)` ÖNERİSİ olarak açılır.
 *
 *  5. HER SORGU `tenantId` SÜZGEÇLİDİR. `ContractVersion` üzerinde `tenantId`
 *     ALANI YOKTUR: o kayıtlara erişim DAİMA `contract: { tenantId }` üzerinden
 *     yapılır — bu, modülün en kolay atlanan güvenlik kuralıdır.
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { ContractStatus, ContractType, Prisma } from "@nomosos/db";
import { formatTrDate, toUtcDate } from "@nomosos/legal-core";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { startOfDay } from "../common/dates";
import { normalizeQuery, paged, resolvePage } from "../common/pagination";
import { assertRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";
import { ContractRenewalService } from "./contract-renewal.service";
import { appendContractEvent } from "./contract-events";
import { splitIntoPages } from "./contract-analysis-chunks";
import {
  CONTRACT_STATUS_LABELS,
  CONTRACT_TRANSITIONS,
  LOCKED_FOR_NEW_VERSION,
  assertContractTransition,
} from "./contract-state-machine";
import type {
  CreateContractInput,
  CreateVersionInput,
  TransitionContractInput,
  UpdateContractInput,
} from "./contracts.dto";

/** Sözleşme kaydı açabilen/güncelleyebilen roller. */
const CONTRACT_WRITE_ROLES = [...ROLE_SETS.HUKUKI, "STAJYER"] as const;

@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly renewal: ContractRenewalService,
  ) {}

  // ================================================================== //
  // LİSTE / DETAY
  // ================================================================== //

  /** GET /contracts */
  async list(
    user: AuthUser,
    params: {
      clientId?: string;
      caseId?: string;
      status?: string;
      type?: string;
      q?: string;
      page?: string;
      limit?: string;
    },
  ) {
    const page = resolvePage(params);
    const q = normalizeQuery(params.q);

    const where: Prisma.ContractWhereInput = {
      tenantId: user.tenantId,
      ...(params.clientId ? { clientId: params.clientId } : {}),
      ...(params.caseId ? { caseId: params.caseId } : {}),
      ...(params.status ? { status: params.status as ContractStatus } : {}),
      ...(params.type ? { type: params.type as ContractType } : {}),
      ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.contract.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }],
        skip: page.skip,
        take: page.take,
        include: {
          client: { select: { id: true, name: true } },
          case: { select: { id: true, fileNumber: true, title: true } },
          _count: { select: { versions: true, signatureRequests: true } },
        },
      }),
      this.prisma.client.contract.count({ where }),
    ]);

    return paged(
      rows.map((r) => ({
        ...r,
        statusLabel: CONTRACT_STATUS_LABELS[r.status],
        allowedTransitions: CONTRACT_TRANSITIONS[r.status],
      })),
      total,
      page,
    );
  }

  /** GET /contracts/:id */
  async detail(user: AuthUser, id: string) {
    const contract = await this.prisma.client.contract.findFirst({
      where: { id, tenantId: user.tenantId },
      include: {
        client: { select: { id: true, name: true, type: true } },
        case: { select: { id: true, fileNumber: true, title: true, status: true } },
        versions: {
          orderBy: { versionNo: "desc" },
          select: {
            id: true,
            versionNo: true,
            changeNote: true,
            documentId: true,
            createdBy: true,
            createdAt: true,
            // `contentText` LİSTEDE DÖNMEZ: sözleşme metinleri yüz binlerce
            // karakter olabilir; tek sürüm ucundan okunur.
          },
        },
        signatureRequests: {
          orderBy: { createdAt: "desc" },
          take: 10,
          select: {
            id: true,
            provider: true,
            providerRef: true,
            status: true,
            sentAt: true,
            completedAt: true,
            signedDocumentId: true,
            failureReason: true,
            createdAt: true,
          },
        },
      },
    });
    if (!contract) throw new NotFoundException("Sözleşme bulunamadı.");

    // DETERMİNİSTİK: fesih ihbar günü her okumada yeniden hesaplanır ki
    // kullanıcının gördüğü değer, kaydedilmiş eski bir hesap olmasın.
    const renewal = await this.renewal.compute(user.tenantId, contract);

    return {
      ...contract,
      statusLabel: CONTRACT_STATUS_LABELS[contract.status],
      allowedTransitions: CONTRACT_TRANSITIONS[contract.status],
      renewal: {
        ...renewal,
        autoRenewNote: contract.autoRenew
          ? "Sözleşmede kendiliğinden yenileme hükmü vardır. SİSTEM SÖZLEŞMEYİ KENDİLİĞİNDEN " +
            "YENİLEMEZ; yalnızca son ihbar gününü hesaplayıp uyarır."
          : null,
      },
    };
  }

  /**
   * Aralık istenmeden döndürülebilecek azami metin (karakter) — ≈50 sanal
   * sayfa. Tek istekte yüzlerce sayfa metin DÖNMEZ: uzun sürümlerde istemci
   * `pageFrom`/`pageTo` aralığı istemek ZORUNDADIR (400 ile yönlendirilir).
   */
  public static readonly VERSION_TEXT_MAX_CHARS = 150_000;

  /** Tek istekte döndürülebilecek azami sayfa aralığı genişliği. */
  public static readonly VERSION_TEXT_MAX_PAGE_WINDOW = 50;

  /**
   * GET /contract-versions/:id — sürüm metni, SAYFA ARALIĞI İLE.
   *
   * Ölçeklendirme kuralı: `?pageFrom=&pageTo=` verilmezse ve metin tavanı
   * AŞIYORSA istek 400 döner — yüzlerce sayfalık metin tek yanıtta taşınmaz.
   * Aralık verildiğinde yalnızca o sayfaların metni döner; `pageCount` ve
   * `totalChars` arayüzün sayfa seçicisini kurmasına yeter.
   */
  async versionDetail(
    user: AuthUser,
    versionId: string,
    range: { pageFrom?: string; pageTo?: string } = {},
  ) {
    const version = await this.prisma.client.contractVersion.findFirst({
      // TENANT SÜZGECİ ÜST KAYITTAN — `ContractVersion.tenantId` YOKTUR.
      where: { id: versionId, contract: { tenantId: user.tenantId } },
      include: {
        contract: { select: { id: true, title: true, type: true, status: true, currentVersionId: true } },
      },
    });
    if (!version) throw new NotFoundException("Sözleşme sürümü bulunamadı.");

    const pages = splitIntoPages(version.contentText);
    const meta = {
      pageCount: pages.length,
      totalChars: version.contentText.length,
    };

    const wantsRange = range.pageFrom !== undefined || range.pageTo !== undefined;
    if (wantsRange) {
      let pageFrom = Number(range.pageFrom ?? 1);
      let pageTo = Number(range.pageTo ?? (Number.isFinite(pageFrom) ? pageFrom : 1));
      if (
        !Number.isInteger(pageFrom) || !Number.isInteger(pageTo) ||
        pageFrom < 1 || pageTo < pageFrom
      ) {
        throw new BadRequestException(
          "Sayfa aralığı geçersiz; pageFrom ≥ 1 ve pageFrom ≤ pageTo olacak biçimde isteyin.",
        );
      }
      // KIRPMA (hata DEĞİL): istemcinin pencere aritmetiği sayfa sayısını aşabilir
      // (ör. 6 sayfalık sözleşmede "s.6-10" penceresi). İstenen aralık
      // geçerli SAYFA ARALIĞINA getirilir; taşan kısım sessizce boş döner.
      // "Tüm sözleşmeyi göremiyoruz" şikâyetinin kökü buydu.
      const pageCount = Math.max(1, pages.length);
      if (pageFrom > pageCount) {
        return {
          id: version.id,
          contractId: version.contractId,
          versionNo: version.versionNo,
          changeNote: version.changeNote,
          documentId: version.documentId,
          createdBy: version.createdBy,
          createdAt: version.createdAt,
          ...meta,
          pageFrom: pageCount,
          pageTo: pageCount,
          text: "",
          emptyReason: `İstenen aralık (${pageFrom}–${pageTo}) sürümün ${pageCount} sayfasının dışında.`,
        };
      }
      if (pageTo > pageCount) pageTo = pageCount;
      if (pageFrom > pageCount) pageFrom = pageCount;
      if (pageTo - pageFrom + 1 > ContractsService.VERSION_TEXT_MAX_PAGE_WINDOW) {
        // Pencere tavanı yalnız GERÇEK genişlik için geçerli: kırpılmış aralık
        // tavanın altındaysa (ör. 1–50 isteği 6 sayfaya kırpılır) hata YOK.
        throw new BadRequestException(
          `Tek istekte en fazla ${ContractsService.VERSION_TEXT_MAX_PAGE_WINDOW} sayfa metni döner; ` +
            "aralığı daraltın.",
        );
      }
      const slice = pages.slice(pageFrom - 1, pageTo).map((p) => p.text).join("\n\n");
      return {
        id: version.id,
        contractId: version.contractId,
        versionNo: version.versionNo,
        changeNote: version.changeNote,
        documentId: version.documentId,
        createdBy: version.createdBy,
        createdAt: version.createdAt,
        contract: version.contract,
        contentText: slice,
        pageFrom,
        pageTo,
        ...meta,
        isCurrent: version.contract.currentVersionId === version.id,
        immutable: true,
        immutableNote:
          "Sürümler DEĞİŞTİRİLEMEZ. Metni güncellemek için yeni sürüm ekleyin; " +
          "müzakere geçmişi böylece bozulmadan kalır.",
      };
    }

    if (version.contentText.length > ContractsService.VERSION_TEXT_MAX_CHARS) {
      throw new BadRequestException(
        `Sürüm metni çok uzun (${pages.length} sayfa); tek istekte tümü döndürülmez. ` +
          "Sayfa aralığı isteyin: ?pageFrom=1&pageTo=20",
      );
    }

    return {
      ...version,
      pageFrom: 1,
      pageTo: Math.max(1, pages.length),
      ...meta,
      isCurrent: version.contract.currentVersionId === version.id,
      immutable: true,
      immutableNote:
        "Sürümler DEĞİŞTİRİLEMEZ. Metni güncellemek için yeni sürüm ekleyin; " +
        "müzakere geçmişi böylece bozulmadan kalır.",
    };
  }

  /** GET /contracts/:id/versions */
  async listVersions(user: AuthUser, contractId: string) {
    await this.findOrThrow(user, contractId);
    const versions = await this.prisma.client.contractVersion.findMany({
      where: { contractId },
      orderBy: { versionNo: "desc" },
      select: {
        id: true,
        versionNo: true,
        changeNote: true,
        documentId: true,
        createdBy: true,
        createdAt: true,
      },
    });
    return { contractId, items: versions, immutable: true };
  }

  // ================================================================== //
  // OLUŞTUR / GÜNCELLE / SİL
  // ================================================================== //

  /** POST /contracts */
  async create(user: AuthUser, input: CreateContractInput) {
    assertRole(user, CONTRACT_WRITE_ROLES, "sözleşme oluşturma");

    if (input.clientId) await this.assertClient(user, input.clientId);
    if (input.caseId) await this.assertCase(user, input.caseId);
    this.assertEffectiveRange(input.effectiveFrom ?? null, input.effectiveTo ?? null);

    const created = await this.prisma.client.$transaction(async (tx) => {
      const contract = await tx.contract.create({
        data: {
          tenantId: user.tenantId,
          clientId: input.clientId ?? null,
          caseId: input.caseId ?? null,
          title: input.title,
          type: input.type,
          status: "TASLAK",
          effectiveFrom: input.effectiveFrom ? startOfDay(input.effectiveFrom) : null,
          effectiveTo: input.effectiveTo ? startOfDay(input.effectiveTo) : null,
          renewalNoticeDays: input.renewalNoticeDays ?? null,
          autoRenew: input.autoRenew ?? false,
          createdBy: user.userId,
        },
      });

      // Metin verildiyse v1 sürümü birlikte açılır ve güncel sürüm işaretlenir.
      const text = input.contentText?.trim();
      if (text) {
        const version = await tx.contractVersion.create({
          data: {
            contractId: contract.id,
            versionNo: 1,
            contentText: text,
            documentId: input.documentId ?? null,
            changeNote: "İlk sürüm",
            createdBy: user.userId,
          },
        });
        await tx.contract.update({
          where: { id: contract.id },
          data: { currentVersionId: version.id },
        });
      }
      return contract;
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CONTRACT_CREATE",
      entity: "Contract",
      entityId: created.id,
      detail: `başlık=${created.title} tip=${created.type}`,
    });

    return this.detail(user, created.id);
  }

  /** PATCH /contracts/:id */
  async update(user: AuthUser, id: string, input: UpdateContractInput) {
    assertRole(user, CONTRACT_WRITE_ROLES, "sözleşme güncelleme");
    const existing = await this.findOrThrow(user, id);

    if (existing.status === "SONA_ERDI" || existing.status === "FESIH") {
      throw new ConflictException(
        `Sözleşme "${CONTRACT_STATUS_LABELS[existing.status]}" durumundadır ve güncellenemez.`,
      );
    }
    /* ── SÜRE DOĞURAN ALANLAR HUKUKİ ROLLERE KİLİTLİ (denetim bulgusu 14b) ──
     *
     * `CONTRACT_WRITE_ROLES` STAJYER'i içerir; sözleşme kartını doldurmak,
     * başlık/tip düzeltmek bir stajyer işi olabilir. Ama `effectiveFrom`,
     * `effectiveTo`, `renewalNoticeDays` ve `autoRenew` masum kart alanları
     * DEĞİLDİR: `ContractRenewalService.suggestDeadline` bu alanlardan
     * deterministik olarak FESİH İHBAR SÜRESİ önerisi doğurur. Yani stajyer,
     * bir tarih alanını değiştirerek büronun süre takvimini etkileyebiliyordu.
     *
     * Aynı ayrım vekaletname modülünde kapsam alanları için zaten yapılmıştı.
     */
    const TERM_FIELDS = [
      "effectiveFrom",
      "effectiveTo",
      "renewalNoticeDays",
      "autoRenew",
    ] as const;
    const touchedTermFields = TERM_FIELDS.filter((f) => input[f] !== undefined);
    if (touchedTermFields.length > 0) {
      assertRole(
        user,
        ROLE_SETS.HUKUKI,
        "sözleşmenin yürürlük tarihi / fesih ihbar süresi alanlarını değiştirme",
      );
    }

    if (input.clientId) await this.assertClient(user, input.clientId);
    if (input.caseId) await this.assertCase(user, input.caseId);

    const effectiveFrom =
      input.effectiveFrom === undefined
        ? existing.effectiveFrom
        : input.effectiveFrom === null
          ? null
          : startOfDay(input.effectiveFrom);
    const effectiveTo =
      input.effectiveTo === undefined
        ? existing.effectiveTo
        : input.effectiveTo === null
          ? null
          : startOfDay(input.effectiveTo);
    this.assertEffectiveRange(effectiveFrom, effectiveTo);

    const updated = await this.prisma.client.contract.update({
      where: { id },
      data: {
        ...(input.clientId !== undefined ? { clientId: input.clientId } : {}),
        ...(input.caseId !== undefined ? { caseId: input.caseId } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.effectiveFrom !== undefined ? { effectiveFrom } : {}),
        ...(input.effectiveTo !== undefined ? { effectiveTo } : {}),
        ...(input.renewalNoticeDays !== undefined
          ? { renewalNoticeDays: input.renewalNoticeDays }
          : {}),
        ...(input.autoRenew !== undefined ? { autoRenew: input.autoRenew } : {}),
      },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CONTRACT_UPDATE",
      entity: "Contract",
      entityId: id,
      detail: `alanlar=${Object.keys(input).join(",")}`,
    });

    // Yürürlük bitişi veya ihbar süresi DEĞİŞTİYSE süre önerisi yeniden
    // hesaplanır: eski öneri otomatik iptal EDİLMEZ, yeni tarih için yenisi
    // doğar ve yanıt hangi eski önerilerin beklediğini bildirir.
    let renewalUpdate = null;
    const datesChanged =
      input.effectiveTo !== undefined || input.renewalNoticeDays !== undefined;
    if (datesChanged && updated.status === "YURURLUKTE") {
      renewalUpdate = await this.renewal.suggestDeadline(user, updated);
    }

    return { ...(await this.detail(user, id)), renewalUpdate };
  }

  /**
   * DELETE /contracts/:id
   *
   * SİLME YALNIZCA YANLIŞ KAYIT İÇİNDİR: sürümü, imza süreci veya yürürlük
   * geçmişi olan sözleşme silinemez (iş kuralı 7). Böyle bir kayıt SONA_ERDI /
   * FESIH durumuna çekilerek arşivlenir.
   */
  async remove(user: AuthUser, id: string) {
    assertRole(user, ROLE_SETS.HUKUKI, "sözleşme silme");
    const existing = await this.findOrThrow(user, id);

    if (existing.status !== "TASLAK") {
      throw new ConflictException(
        `Yalnızca "Taslak" durumundaki sözleşme silinebilir. Bu sözleşme ` +
          `"${CONTRACT_STATUS_LABELS[existing.status]}" durumunda; sona erdirmek için ` +
          "durum geçişi ucunu kullanın.",
      );
    }
    const [versions, signatures] = await Promise.all([
      this.prisma.client.contractVersion.count({ where: { contractId: id } }),
      this.prisma.client.signatureRequest.count({ where: { tenantId: user.tenantId, contractId: id } }),
    ]);
    if (signatures > 0) {
      throw new ConflictException(
        "Bu sözleşmede imza süreci kaydı var; imza kanıt izi silinemez.",
      );
    }
    if (versions > 1) {
      throw new ConflictException(
        `Bu sözleşmenin ${versions} sürümü var; müzakere geçmişi silinemez. ` +
          "Kaydı sona erdirmek için durum geçişi ucunu kullanın.",
      );
    }

    // Tek sürüm (ilk taslak) sözleşmeyle birlikte gider — Cascade.
    await this.prisma.client.contract.delete({ where: { id } });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CONTRACT_DELETE",
      entity: "Contract",
      entityId: id,
      detail: `başlık=${existing.title} sürüm=${versions}`,
    });
    return { deleted: true, id };
  }

  // ================================================================== //
  // SÜRÜMLER (IMMUTABLE)
  // ================================================================== //

  /** POST /contracts/:id/versions */
  async createVersion(user: AuthUser, contractId: string, input: CreateVersionInput) {
    // STAJYER sürüm YÜKLEYEBİLİR (iş kuralı 10).
    assertRole(user, CONTRACT_WRITE_ROLES, "sözleşme sürümü ekleme");
    const contract = await this.findOrThrow(user, contractId);

    if (LOCKED_FOR_NEW_VERSION.includes(contract.status)) {
      throw new ConflictException(
        contract.status === "IMZADA"
          ? "Sözleşme imza sürecindedir; yeni sürüm eklenemez. Önce imza sürecini iptal edin."
          : `Sözleşme "${CONTRACT_STATUS_LABELS[contract.status]}" durumundadır; ` +
            "metin artık değiştirilemez.",
      );
    }

    // Sürüm numarası ATOMİK üretilir: iki eşzamanlı yükleme aynı numarayı
    // alırsa `@@unique([contractId, versionNo])` ihlal olur. Transaction
    // içinde max+1 okunur ve aynı işlemde yazılır.
    const created = await this.prisma.client.$transaction(async (tx) => {
      const last = await tx.contractVersion.findFirst({
        where: { contractId },
        orderBy: { versionNo: "desc" },
        select: { versionNo: true },
      });
      const version = await tx.contractVersion.create({
        data: {
          contractId,
          versionNo: (last?.versionNo ?? 0) + 1,
          contentText: input.contentText,
          changeNote: input.changeNote ?? null,
          documentId: input.documentId ?? null,
          createdBy: user.userId,
        },
      });
      if (input.makeCurrent !== false) {
        await tx.contract.update({
          where: { id: contractId },
          data: { currentVersionId: version.id },
        });
      }
      return version;
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CONTRACT_VERSION_CREATE",
      entity: "ContractVersion",
      entityId: created.id,
      detail: `sözleşme=${contractId} sürüm=v${created.versionNo} uzunluk=${input.contentText.length}`,
    });

    // SÜREÇ AKIŞI (append-only): v1 = yükleme, sonrası = karşı taraftan
    // gelen revizyon. Olay yazımı ana akışı bozmaz (bkz. contract-events.ts).
    await appendContractEvent(this.prisma.client, {
      tenantId: user.tenantId,
      contractId,
      type: created.versionNo === 1 ? "YUKLENDI" : "REVIZYON_ALINDI",
      detail:
        `v${created.versionNo}` +
        (input.changeNote?.trim() ? ` — ${input.changeNote.trim()}` : "") +
        ` (metin ${input.contentText.length} karakter)`,
      user,
    });

    return {
      id: created.id,
      contractId,
      versionNo: created.versionNo,
      changeNote: created.changeNote,
      documentId: created.documentId,
      createdAt: created.createdAt,
      isCurrent: input.makeCurrent !== false,
      immutable: true,
      immutableNote: "Bu sürüm bir daha DEĞİŞTİRİLEMEZ; düzeltme yeni sürümle yapılır.",
    };
  }

  // ================================================================== //
  // DURUM MAKİNESİ
  // ================================================================== //

  /** POST /contracts/:id/transition */
  async transition(user: AuthUser, id: string, input: TransitionContractInput) {
    // Durum geçişleri AVUKAT ve üstüne aittir (iş kuralı 10) — STAJYER 403 alır.
    assertRole(user, ROLE_SETS.HUKUKI, "sözleşme durumu değiştirme");
    const contract = await this.findOrThrow(user, id);

    // TEK DOĞRU KAYNAK: geçiş tablosu. Geçersiz geçiş 400 + anlamlı mesaj.
    assertContractTransition(contract.status, input.toStatus);

    /* ── YURURLUKTE ÖZEL KAPISI ────────────────────────────────────────────
     *
     * ╔══════════════════════════════════════════════════════════════════════╗
     * ║ "İMZALANDI" DAMGASI TEK BAŞINA YETMEZ — NÜSHA ORTADA OLMALIDIR.      ║
     * ╚══════════════════════════════════════════════════════════════════════╝
     *
     * Kapı eskiden yalnızca "`status: IMZALANDI` olan bir SignatureRequest var
     * mı?" diye soruyordu. `signedDocumentId` SELECT ediliyor ama HİÇ
     * KONTROL EDİLMİYORDU; imzalanan sürümün sözleşmenin güncel sürümü olduğu
     * da doğrulanmıyordu. İki somut sonucu vardı:
     *
     *   1. İmzalı nüsha hiç alınmadan sözleşme yürürlüğe girebiliyordu
     *      (Modül 20 iş kuralı 7'nin "imza kanıt paketi" hiç oluşmuyordu).
     *   2. v1 imzalanıp ardından v2 yüklendiğinde, v1'in imzası v2'yi
     *      yürürlüğe sokabiliyordu — imzalanmamış bir metin "yürürlükteki
     *      sözleşme" oluyordu.
     *
     * Artık üç şart birden aranır: durum IMZALANDI **ve** imzalı nüsha kayıtlı
     * **ve** imzalanan sürüm güncel sürüm. Sağlanmıyorsa yol kapalı değildir —
     * ıslak imza yolu (`manualApproval` + gerekçe) açıktır ve denetime yazılır.
     */
    if (input.toStatus === "YURURLUKTE") {
      const signed = await this.prisma.client.signatureRequest.findFirst({
        where: {
          tenantId: user.tenantId,
          contractId: id,
          status: "IMZALANDI",
          // İmzalı nüsha kayıtlı DEĞİLSE bu süreç yürürlük dayanağı olamaz.
          signedDocumentId: { not: null },
          // İmzalanan sürüm, sözleşmenin GÜNCEL sürümü olmalıdır.
          ...(contract.currentVersionId ? { versionId: contract.currentVersionId } : {}),
        },
        select: { id: true, signedDocumentId: true, versionId: true, completedAt: true },
      });

      if (!signed && !input.manualApproval) {
        // Neyin eksik olduğunu SÖYLE: "imza yok" ile "imza var ama nüsha yok"
        // ve "imza var ama başka sürüme ait" farklı sorunlardır.
        const anySigned = await this.prisma.client.signatureRequest.findFirst({
          where: { tenantId: user.tenantId, contractId: id, status: "IMZALANDI" },
          select: { id: true, signedDocumentId: true, versionId: true },
        });
        const detail = !anySigned
          ? "tamamlanmış bir e-imza süreci bulunmuyor"
          : !anySigned.signedDocumentId
            ? "e-imza süreci tamamlanmış görünüyor ancak İMZALI NÜSHA sisteme alınamamış " +
              "(sağlayıcıdan indirilemedi). Süreç durumunu yeniden sorgulayın"
            : "tamamlanmış imza sözleşmenin GÜNCEL sürümüne ait değil; güncel metin " +
              "imzalanmamış";
        throw new BadRequestException(
          `Sözleşme yürürlüğe alınamaz: ${detail}. ` +
            "Islak imzalı nüsha varsa `manualApproval: true` ve bir açıklama göndererek " +
            "elle onaylayın; sistem bu onayı denetim kaydına yazar.",
        );
      }
      if (!signed && input.manualApproval && !input.note?.trim()) {
        throw new BadRequestException(
          "Elle yürürlük onayında açıklama zorunludur (ör. \"ıslak imzalı nüsha 12.06.2026'da " +
            "teslim alındı\").",
        );
      }
    }

    // Yürürlükten çıkışta (SONA_ERDI/FESIH) gerekçe aranır: hukuki iz.
    if ((input.toStatus === "FESIH" || input.toStatus === "SONA_ERDI") && !input.note?.trim()) {
      throw new BadRequestException(
        `"${CONTRACT_STATUS_LABELS[input.toStatus]}" geçişinde açıklama zorunludur.`,
      );
    }

    const updated = await this.prisma.client.contract.update({
      where: { id },
      data: { status: input.toStatus },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CONTRACT_TRANSITION",
      entity: "Contract",
      entityId: id,
      detail:
        `${contract.status} → ${input.toStatus}` +
        (input.manualApproval ? " (elle yürürlük onayı)" : "") +
        (input.note ? ` · ${input.note}` : ""),
    });

    if (contract.caseId) {
      await this.prisma.client.timelineEvent.create({
        data: {
          tenantId: user.tenantId,
          caseId: contract.caseId,
          userId: user.userId,
          title: `Sözleşme durumu: ${CONTRACT_STATUS_LABELS[input.toStatus]} — ${contract.title}`,
          detail: input.note ?? null,
          source: "SISTEM",
        },
      });
    }

    // YÜRÜRLÜĞE GİRİŞTE fesih ihbar süresi ÖNERİSİ açılır (deterministik).
    let renewal = null;
    if (input.toStatus === "YURURLUKTE") {
      renewal = await this.renewal.suggestDeadline(user, updated);
    }

    return {
      ...(await this.detail(user, id)),
      transition: {
        from: contract.status,
        to: input.toStatus,
        manualApproval: input.manualApproval ?? false,
        note: input.note ?? null,
      },
      renewalDeadline: renewal,
    };
  }

  // ================================================================== //
  // Yardımcılar
  // ================================================================== //

  /** Tenant süzgeçli tekil okuma — başka kiracının kaydı 404 döner. */
  async findOrThrow(user: AuthUser, id: string) {
    const contract = await this.prisma.client.contract.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!contract) throw new NotFoundException("Sözleşme bulunamadı.");
    return contract;
  }

  private assertEffectiveRange(from: Date | null, to: Date | null): void {
    if (from && to && toUtcDate(to) < toUtcDate(from)) {
      throw new BadRequestException(
        `Yürürlük bitişi (${formatTrDate(to)}) başlangıçtan (${formatTrDate(from)}) önce olamaz.`,
      );
    }
  }

  private async assertClient(user: AuthUser, clientId: string): Promise<void> {
    const found = await this.prisma.client.client.findFirst({
      where: { id: clientId, tenantId: user.tenantId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException("Müvekkil bulunamadı.");
  }

  private async assertCase(user: AuthUser, caseId: string): Promise<void> {
    const found = await this.prisma.client.case.findFirst({
      where: { id: caseId, tenantId: user.tenantId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException("Dosya bulunamadı.");
  }
}
