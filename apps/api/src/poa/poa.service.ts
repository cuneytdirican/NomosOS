/**
 * VEKALETNAME YÖNETİMİ (Modül 12) — kayıt, kapsam maddeleri, azil.
 *
 * ÜRÜN İLKELERİ:
 *
 *  1. AZİL GERİ ALINAMAZ. `POST /:id/revoke` bir kez işlenir; ikinci çağrı 409
 *     döner. Hatalı azil düzeltmesi yeni bir vekaletname kaydı + denetim
 *     açıklamasıyla yapılır (docs/moduller/12, iş kuralı 8).
 *
 *  2. AZİL SONRASI KAYIT SİLİNMEZ, PASİFLEŞİR. `isActive=false` olur; kayıt
 *     dosyada ve müvekkil kartında geçmiş olarak görünmeye devam eder.
 *
 *  3. ROL AYRIMI. SEKRETER vekaletname KAYDEDEBİLİR (noterden gelen belgeyi
 *     tarayıp girmek büro operasyonudur) ama SONLANDIRAMAZ ve SİLEMEZ
 *     (iş kuralı 6).
 *
 *  4. SÜRE VE KALAN GÜN HESABI BU SERVİSTE YAPILMAZ; `PoaWarningsService`
 *     @nomosos/legal-core ile deterministik hesaplar.
 *
 *  5. HER SORGU `tenantId` SÜZGEÇLİDİR — `PowerOfAttorney.tenantId` skalerdir,
 *     şema süzgeci zorlamaz.
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoaType, Prisma } from "@nomosos/db";
import { diffDays, formatTrDate, toUtcDate } from "@nomosos/legal-core";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { startOfDay } from "../common/dates";
import { normalizeQuery, paged, resolvePage } from "../common/pagination";
import { assertRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";
import {
  POA_SCOPE_CATALOG,
  parseScopeItems,
  scanScopeTextForCodes,
  scopeLabel,
} from "./poa-scope-catalog";
import type { CreatePoaInput, RevokePoaInput, UpdatePoaInput } from "./poa.dto";

/** `scopeItems` gövde girdisinin serileştirmeye giden sade biçimi. */
interface ScopeItemInputLike {
  code: string;
  present?: boolean;
  note?: string | null;
}

/** Vekaletname kaydı açabilen roller — sekreter DÂHİL (veri girişi). */
const POA_WRITE_ROLES = [...ROLE_SETS.OPERASYON] as const;

export type PoaFilterStatus = "AKTIF" | "AZLEDILDI" | "SURESI_DOLDU" | "TUMU";

@Injectable()
export class PoaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ================================================================== //
  // LİSTE
  // ================================================================== //

  /** GET /power-of-attorney */
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
    const today = startOfDay(new Date());

    const status = (params.status?.toUpperCase() ?? "TUMU") as PoaFilterStatus;
    if (!["AKTIF", "AZLEDILDI", "SURESI_DOLDU", "TUMU"].includes(status)) {
      throw new BadRequestException(
        'Durum süzgeci AKTIF, AZLEDILDI, SURESI_DOLDU veya TUMU olabilir.',
      );
    }

    // Durum ŞEMADA TEK ALAN DEĞİLDİR (isActive + revokedAt + expiresAt);
    // süzgeç bu üçlüden türetilir ve SORGUDA uygulanır.
    const statusWhere: Prisma.PowerOfAttorneyWhereInput =
      status === "AKTIF"
        ? {
            isActive: true,
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gte: today } }],
          }
        : status === "AZLEDILDI"
          ? { revokedAt: { not: null } }
          : status === "SURESI_DOLDU"
            ? { revokedAt: null, expiresAt: { lt: today } }
            : {};

    const where: Prisma.PowerOfAttorneyWhereInput = {
      tenantId: user.tenantId,
      ...(params.clientId ? { clientId: params.clientId } : {}),
      ...(params.caseId ? { caseId: params.caseId } : {}),
      ...(params.type ? { type: params.type as PoaType } : {}),
      ...(q
        ? {
            OR: [
              { notary: { contains: q, mode: "insensitive" as const } },
              { number: { contains: q, mode: "insensitive" as const } },
              { client: { name: { contains: q, mode: "insensitive" as const } } },
            ],
          }
        : {}),
      ...statusWhere,
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.powerOfAttorney.findMany({
        where,
        orderBy: [{ isActive: "desc" }, { issuedAt: "desc" }],
        skip: page.skip,
        take: page.take,
        select: {
          id: true,
          clientId: true,
          caseId: true,
          type: true,
          notary: true,
          number: true,
          issuedAt: true,
          expiresAt: true,
          revokedAt: true,
          revokeReason: true,
          isActive: true,
          scopeItemsJson: true,
          documentId: true,
          createdAt: true,
          client: { select: { id: true, name: true, type: true } },
          case: { select: { id: true, fileNumber: true, title: true, status: true } },
        },
      }),
      this.prisma.client.powerOfAttorney.count({ where }),
    ]);

    return paged(rows.map((r) => this.decorate(r, today)), total, page);
  }

  /** GET /power-of-attorney/:id */
  async detail(user: AuthUser, id: string) {
    const poa = await this.prisma.client.powerOfAttorney.findFirst({
      where: { id, tenantId: user.tenantId },
      include: {
        client: { select: { id: true, name: true, type: true } },
        case: { select: { id: true, fileNumber: true, title: true, status: true, type: true } },
        scopeChecks: {
          orderBy: { checkedAt: "desc" },
          take: 20,
          select: {
            id: true,
            caseId: true,
            question: true,
            verdict: true,
            missingPowersJson: true,
            model: true,
            checkedAt: true,
            checkedBy: true,
          },
        },
      },
    });
    if (!poa) throw new NotFoundException("Vekaletname kaydı bulunamadı.");

    const today = startOfDay(new Date());
    const decorated = this.decorate(poa, today);

    // Kapsam maddeleri girilmemişse serbest metinden ÖNERİ çıkarılır.
    // Bu bir öneridir, kayıt DEĞİLDİR: hiçbir yere yazılmaz.
    const suggestedFromText =
      decorated.scopeItems.length === 0 && poa.scope
        ? scanScopeTextForCodes(poa.scope).map((code) => ({ code, label: scopeLabel(code) }))
        : [];

    return {
      ...decorated,
      scope: poa.scope,
      scopeChecks: poa.scopeChecks.map((c) => ({
        ...c,
        missingPowers: safeJson<unknown[]>(c.missingPowersJson) ?? [],
      })),
      suggestedScopeFromText: suggestedFromText,
      suggestionNote: suggestedFromText.length
        ? "Bu maddeler vekaletname METNİNDE anahtar kelime taramasıyla bulunmuştur ve " +
          "KAYDEDİLMEMİŞTİR. Olumsuz ifadeleri (\"sulh olmaya yetkili değildir\") ayırt edemez; " +
          "işaretlemeden önce metni okuyun."
        : null,
    };
  }

  /** Katalog — arayüzün onay kutularını buradan üretmesi için. */
  scopeCatalog() {
    return {
      items: POA_SCOPE_CATALOG.map((d) => ({
        code: d.code,
        label: d.label,
        description: d.description,
        requiresSpecialAuthority: d.requiresSpecialAuthority,
        legalBasis: d.legalBasis,
      })),
      note:
        "Bu liste, vekaletnamelerde geçen özel yetkilerin standart kataloğudur. " +
        "Hangi işlem için hangi yetkinin gerektiği somut olayda avukatın kararıdır.",
    };
  }

  // ================================================================== //
  // OLUŞTUR / GÜNCELLE / SİL
  // ================================================================== //

  /** POST /power-of-attorney */
  async create(user: AuthUser, input: CreatePoaInput) {
    assertRole(user, POA_WRITE_ROLES, "vekaletname kaydetme");

    const client = await this.prisma.client.client.findFirst({
      where: { id: input.clientId, tenantId: user.tenantId },
      select: { id: true, name: true },
    });
    if (!client) throw new NotFoundException("Müvekkil bulunamadı.");

    if (input.caseId) await this.assertCaseBelongsToClient(user, input.caseId, input.clientId);
    this.assertDateOrder(input.issuedAt, input.expiresAt ?? null);

    const created = await this.prisma.client.powerOfAttorney.create({
      data: {
        tenantId: user.tenantId,
        clientId: input.clientId,
        caseId: input.caseId ?? null,
        type: input.type ?? null,
        notary: input.notary ?? null,
        number: input.number ?? null,
        issuedAt: startOfDay(input.issuedAt),
        expiresAt: input.expiresAt ? startOfDay(input.expiresAt) : null,
        scope: input.scope ?? null,
        scopeItemsJson: serializeScopeItems(input.scopeItems),
        documentId: input.documentId ?? null,
        isActive: true,
      },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "POA_CREATE",
      entity: "PowerOfAttorney",
      entityId: created.id,
      detail:
        `müvekkil=${client.name} noter=${created.notary ?? "-"} yevmiye=${created.number ?? "-"} ` +
        `düzenleme=${formatTrDate(created.issuedAt)} ` +
        `bitiş=${created.expiresAt ? formatTrDate(created.expiresAt) : "süresiz"}`,
    });

    return this.detail(user, created.id);
  }

  /** PATCH /power-of-attorney/:id */
  async update(user: AuthUser, id: string, input: UpdatePoaInput) {
    assertRole(user, POA_WRITE_ROLES, "vekaletname güncelleme");
    const existing = await this.findOrThrow(user, id);

    // SONLANDIRILMIŞ KAYIT DEĞİŞTİRİLEMEZ: azil sonrası kapsam düzeltmek,
    // geçmişi yeniden yazmaktır (iş kuralı 8).
    if (existing.revokedAt) {
      throw new ConflictException(
        `Bu vekaletname ${formatTrDate(existing.revokedAt)} tarihinde sonlandırılmıştır ve ` +
          "değiştirilemez. Düzeltme için yeni bir vekaletname kaydı oluşturun.",
      );
    }

    // Kapsam maddeleri AVUKAT ve üstü tarafından değiştirilir (iş kuralı 6):
    // hangi yetkinin var sayılacağı hukuki bir tespittir.
    if (input.scopeItems !== undefined || input.scope !== undefined) {
      assertRole(user, ROLE_SETS.HUKUKI, "vekaletname kapsamını değiştirme");
    }

    const issuedAt = input.issuedAt ? startOfDay(input.issuedAt) : existing.issuedAt;
    const expiresAt =
      input.expiresAt === undefined
        ? existing.expiresAt
        : input.expiresAt === null
          ? null
          : startOfDay(input.expiresAt);
    this.assertDateOrder(issuedAt, expiresAt);

    if (input.caseId) await this.assertCaseBelongsToClient(user, input.caseId, existing.clientId);

    await this.prisma.client.powerOfAttorney.update({
      where: { id },
      data: {
        ...(input.caseId !== undefined ? { caseId: input.caseId } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.notary !== undefined ? { notary: input.notary } : {}),
        ...(input.number !== undefined ? { number: input.number } : {}),
        ...(input.issuedAt !== undefined ? { issuedAt } : {}),
        ...(input.expiresAt !== undefined ? { expiresAt } : {}),
        ...(input.scope !== undefined ? { scope: input.scope } : {}),
        ...(input.scopeItems !== undefined
          ? { scopeItemsJson: serializeScopeItems(input.scopeItems) }
          : {}),
        ...(input.documentId !== undefined ? { documentId: input.documentId } : {}),
        // Bitiş tarihi ileri alındıysa uyarı damgası SIFIRLANIR ki yeni süre
        // için uyarı yeniden üretilebilsin.
        ...(input.expiresAt !== undefined ? { warningSentAt: null } : {}),
      },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "POA_UPDATE",
      entity: "PowerOfAttorney",
      entityId: id,
      detail: `alanlar=${Object.keys(input).join(",")}`,
    });

    return this.detail(user, id);
  }

  /**
   * DELETE /power-of-attorney/:id
   *
   * SİLME YALNIZCA YANLIŞ KAYIT İÇİNDİR: kapsam analizi yapılmış ya da
   * sonlandırılmış kayıt silinemez; onlar hukuki iz taşır.
   */
  async remove(user: AuthUser, id: string) {
    assertRole(user, ROLE_SETS.HUKUKI, "vekaletname silme");
    const existing = await this.findOrThrow(user, id);

    if (existing.revokedAt) {
      throw new ConflictException(
        "Sonlandırılmış vekaletname silinemez; azil kaydı hukuki iz taşır.",
      );
    }
    const checks = await this.prisma.client.poaScopeCheck.count({
      where: { tenantId: user.tenantId, powerOfAttorneyId: id },
    });
    if (checks > 0) {
      throw new ConflictException(
        `Bu vekaletname üzerinde ${checks} kapsam analizi yapılmış; kayıt silinemez. ` +
          "Kullanımdan kaldırmak için azil/istifa kaydı girin.",
      );
    }

    await this.prisma.client.powerOfAttorney.delete({ where: { id } });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "POA_DELETE",
      entity: "PowerOfAttorney",
      entityId: id,
      detail: `noter=${existing.notary ?? "-"} yevmiye=${existing.number ?? "-"}`,
    });
    return { deleted: true, id };
  }

  // ================================================================== //
  // AZİL / İSTİFA
  // ================================================================== //

  /**
   * POST /power-of-attorney/:id/revoke
   *
   * TEK İŞLEMDE: kayıt pasifleşir, bağlı/ilgili AÇIK dosyalara TimelineEvent
   * düşer. İşlemler tek transaction'dadır — yarım kalmış bir azil, "azledildi
   * ama dosyada iz yok" durumundan iyi değildir.
   *
   * PORTAL ERİŞİMİ BU MODÜLDE ASKIYA ALINMAZ: `PortalUser` tablosu Portal-API
   * ajanının alanıdır. Burada denetim kaydına `POA_REVOKE` yazılır; portal
   * tarafı bu olayı kendi politikasına göre işler (ortak karar 2: portal en dar
   * yetkili yüzeydir, varsayılan hiçbir şey görünmez).
   */
  async revoke(user: AuthUser, id: string, input: RevokePoaInput) {
    // Sonlandırma AVUKAT ve üstüne aittir (iş kuralı 6) — SEKRETER 403 alır.
    assertRole(user, ROLE_SETS.HUKUKI, "vekaletname azil/istifa kaydı girme");
    const existing = await this.findOrThrow(user, id);

    if (existing.revokedAt) {
      throw new ConflictException(
        `Bu vekaletname ${formatTrDate(existing.revokedAt)} tarihinde zaten sonlandırılmış. ` +
          "Sonlandırma kayıtları geri alınamaz.",
      );
    }

    const revokedAt = startOfDay(input.revokedAt ?? new Date());
    if (toUtcDate(revokedAt) < toUtcDate(existing.issuedAt)) {
      throw new BadRequestException(
        `Azil/istifa tarihi (${formatTrDate(revokedAt)}) vekaletnamenin düzenleme tarihinden ` +
          `(${formatTrDate(existing.issuedAt)}) önce olamaz.`,
      );
    }

    const affected = await this.prisma.client.case.findMany({
      where: {
        tenantId: user.tenantId,
        clientId: existing.clientId,
        status: { notIn: ["KAPANDI", "ARSIV"] },
      },
      select: { id: true, fileNumber: true, title: true, status: true },
      take: 200,
    });

    const typeLabel =
      input.terminationType === "ISTIFA"
        ? "İstifa"
        : input.terminationType === "SURE_DOLUMU"
          ? "Süre dolumu"
          : "Azil";

    const suspended = await this.prisma.client.$transaction(async (tx) => {
      await tx.powerOfAttorney.update({
        where: { id },
        data: {
          revokedAt,
          revokeReason: `${typeLabel}: ${input.reason}`,
          isActive: false,
        },
      });

      // AZİL/İSTİFA PORTAL ERİŞİMİNİ AYNI İŞLEMDE KESER (denetim bulgusu K-12).
      //
      // Eskiden bu transaction yalnız vekaletname satırını ve safahat kaydını
      // yazıyordu. Vekalet ilişkisi biten müvekkil, `PortalPublication`
      // allow-list'indeki tüm dosya, belge, duruşma ve faturayı SÜRESİZ görmeye
      // devam ediyordu; mevcut token'ı da 8 saat daha geçerliydi. Meslek sırrı
      // açısından savunulamaz.
      //
      // `sessionsValidFrom` tazelenmesi, `isActive:false` bayrağının ~anında
      // etkili olmasını da garantiler: `portal-jwt.guard.ts` damgadan eski
      // token'ı reddeder, önbelleğe bakmaz.
      //
      // Diğer CANLI bir vekaletname VARSA erişim kesilmez: müvekkille ilişki
      // sürüyordur; kesilen yalnız bu vekaletnamedir.
      //
      // F2-Ö-05: "canlı" tanımı büro tarafının AKTİF süzgeciyle birebirdir —
      // isActive VE revokedAt NULL VE (expiresAt yok ya da bugünden sonraysa).
      // Eskiden yalnız isActive'e bakılıyordu: süresi YILMIŞ ama isActive=true
      // kalmış tek vekaletname, azil anında portal erişimini KORUYOR ve
      // "vekalet ilişkiniz sürüyor" yanıtı üretiliyordu.
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      const otherActive = await tx.powerOfAttorney.count({
        where: {
          tenantId: user.tenantId,
          clientId: existing.clientId,
          isActive: true,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gte: todayStart } }],
          NOT: { id },
        },
      });
      const portalResult =
        otherActive > 0
          ? { count: 0 }
          : await tx.portalUser.updateMany({
              where: { tenantId: user.tenantId, clientId: existing.clientId, isActive: true },
              data: { isActive: false, sessionsValidFrom: new Date() },
            });

      if (affected.length > 0) {
        await tx.timelineEvent.createMany({
          data: affected.map((c) => ({
            tenantId: user.tenantId,
            caseId: c.id,
            userId: user.userId,
            title: `Vekalet sonlandı — ${typeLabel} (${formatTrDate(revokedAt)})`,
            detail:
              `${existing.notary ?? "Noter"} · yevmiye ${existing.number ?? "-"} vekaletnamesi ` +
              `${typeLabel.toLocaleLowerCase("tr-TR")} nedeniyle sonlandırıldı. Gerekçe: ${input.reason}. ` +
              "Bu dosyada geçerli bir vekaletname bulunmadan işlem yapılmamalıdır.",
            source: "SISTEM",
          })),
        });
      }

      return portalResult.count;
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "POA_REVOKE",
      entity: "PowerOfAttorney",
      entityId: id,
      detail:
        `tip=${input.terminationType} tarih=${formatTrDate(revokedAt)} ` +
        `etkilenen_dosya=${affected.length} portal_askiya_alinan=${suspended} ` +
        `gerekçe=${input.reason}`,
    });

    if (suspended > 0) {
      await this.audit.log({
        tenantId: user.tenantId,
        userId: user.userId,
        action: "PORTAL_ACCESS_SUSPENDED_BY_POA_REVOKE",
        entity: "Client",
        entityId: existing.clientId,
        detail: `${suspended} portal hesabı pasifleştirildi ve oturumları düşürüldü (vekalet sonlandı).`,
      });
    }

    return {
      ...(await this.detail(user, id)),
      termination: {
        type: input.terminationType,
        revokedAt,
        affectedCases: affected,
        suspendedPortalUsers: suspended,
        note:
          "Vekaletname pasifleştirildi ve etkilenen açık dosyalara safahat kaydı düşüldü. " +
          (suspended > 0
            ? `Müvekkilin ${suspended} portal hesabının erişimi kesildi ve açık oturumları düşürüldü. `
            : "Müvekkilin başka geçerli bir vekaletnamesi bulunduğu için portal erişimi korundu. ") +
          "Sonlandırma kayıtları GERİ ALINAMAZ; hatalı giriş yeni kayıtla düzeltilir.",
      },
    };
  }

  // ================================================================== //
  // Yardımcılar
  // ================================================================== //

  /** Tenant süzgeçli tekil okuma — başka kiracının kaydı 404 döner. */
  async findOrThrow(user: AuthUser, id: string) {
    const poa = await this.prisma.client.powerOfAttorney.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!poa) throw new NotFoundException("Vekaletname kaydı bulunamadı.");
    return poa;
  }

  private assertDateOrder(issuedAt: Date, expiresAt: Date | null): void {
    if (expiresAt && toUtcDate(expiresAt) < toUtcDate(issuedAt)) {
      throw new BadRequestException(
        `Bitiş tarihi (${formatTrDate(expiresAt)}) düzenleme tarihinden ` +
          `(${formatTrDate(issuedAt)}) önce olamaz.`,
      );
    }
  }

  private async assertCaseBelongsToClient(
    user: AuthUser,
    caseId: string,
    clientId: string,
  ): Promise<void> {
    const found = await this.prisma.client.case.findFirst({
      where: { id: caseId, tenantId: user.tenantId },
      select: { id: true, clientId: true, fileNumber: true },
    });
    if (!found) throw new NotFoundException("Dosya bulunamadı.");
    if (found.clientId !== clientId) {
      // Vekaletnameyi BAŞKA müvekkilin dosyasına bağlamak, yetki zincirini
      // kıran sessiz bir hatadır; açıkça reddedilir.
      throw new ForbiddenException(
        `${found.fileNumber ?? "Seçilen dosya"} bu müvekkile ait değil; vekaletname bu dosyaya bağlanamaz.`,
      );
    }
  }

  /** Ortak görüntüleme alanları: kapsam maddeleri + kalan gün + kullanılabilirlik. */
  private decorate<
    T extends {
      scopeItemsJson: string | null;
      expiresAt: Date | null;
      revokedAt: Date | null;
      isActive: boolean;
    },
  >(row: T, today: Date) {
    const { items, parsed } = parseScopeItems(row.scopeItemsJson);
    const daysRemaining =
      row.expiresAt === null ? null : diffDays(toUtcDate(today), toUtcDate(row.expiresAt));
    const expired = daysRemaining !== null && daysRemaining < 0;
    return {
      ...row,
      scopeItems: items,
      scopeItemsParsed: parsed,
      scopeParseWarning: parsed
        ? null
        : "Kapsam maddeleri okunamadı (bozuk kayıt). Yetkileri yeniden işaretleyin; " +
          "bu kayıt üzerinde kapsam analizi güvenilir sonuç vermez.",
      daysRemaining,
      expired,
      /** TEK YERDE hesaplanan kullanılabilirlik — arayüz bunu kopyalamamalıdır. */
      usable: row.isActive && row.revokedAt === null && !expired,
      statusLabel: row.revokedAt
        ? "AZLEDILDI"
        : expired
          ? "SURESI_DOLDU"
          : row.isActive
            ? "AKTIF"
            : "PASIF",
    };
  }
}

/** Kapsam maddelerini JSON'a çevirir. Boş liste `null` yazar (alan temizlenir). */
function serializeScopeItems(items: ScopeItemInputLike[] | undefined): string | null | undefined {
  if (items === undefined) return undefined;
  if (items.length === 0) return null;
  // Aynı kod iki kez gönderilirse SON değer geçerlidir (formda tekrar olabilir).
  const byCode = new Map<string, { code: string; label: string; present: boolean; note?: string }>();
  for (const i of items) {
    byCode.set(i.code, {
      code: i.code,
      label: scopeLabel(i.code),
      present: i.present !== false,
      ...(i.note ? { note: i.note } : {}),
    });
  }
  return JSON.stringify([...byCode.values()]);
}

function safeJson<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}
