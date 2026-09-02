/**
 * İCRA DERİNLİĞİ (D4 / A6) — kıymet takdiri (İİK m.120) + satış kaydı (m.106+).
 *
 * DETERMİNİSTİK: bu servis para ve tarih KAYDI tutar; hesap uydurmaz.
 * Otomatik yasal süre üretimi bilinçli olarak YOKTUR — süre hükümleri
 * (m.106/3 altı ay; konkordato m.286-293) koşulludur; süreleri avukat
 * mevcut süre motorundan elle kurar.
 *
 * Malvarlığı durum şeridi korunur: SATILDI sonucu asset'i SATILDI'ya
 * taşır (izin verilen geçişle), ERTELENDI/KATILAN_YOK satışa çıkarır.
 */

import { Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { Prisma, type AssetStatus } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { assertRole, ROLE_SETS } from "../common/roles";
import { touchCase } from "../common/case-denormals";
import type { AuthUser } from "../common/types";

export const APPRAISER_TYPES = ["BILIRKISI", "ICRA_MEMURU", "ENCUMEN"] as const;
export type AppraiserType = (typeof APPRAISER_TYPES)[number];

export const SALE_TYPES = ["ACIK_ARTIRMA", "POSTA_ILE_TEKLIF"] as const;
export type SaleType = (typeof SALE_TYPES)[number];

export const SALE_RESULTS = ["SATILDI", "KATILAN_YOK", "ERTELENDI", "IPTAL"] as const;
export type SaleResult = (typeof SALE_RESULTS)[number];

export const APPRAISER_LABELS: Record<AppraiserType, string> = {
  BILIRKISI: "Bilirkişi",
  ICRA_MEMURU: "İcra memuru",
  ENCUMEN: "Encümen",
};

export const SALE_TYPE_LABELS: Record<SaleType, string> = {
  ACIK_ARTIRMA: "Açık artırma (m.111)",
  POSTA_ILE_TEKLIF: "Posta ile teklif (m.114)",
};

export const SALE_RESULT_LABELS: Record<SaleResult, string> = {
  SATILDI: "Satıldı",
  KATILAN_YOK: "Katılan olmadı",
  ERTELENDI: "Ertelendi",
  IPTAL: "İptal",
};

/** Malvarlığı durum şeridi — enforcement.service.ts ile AYNI kural. */
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

@Injectable()
export class EnforcementAssetMarketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Mal + bağlı icra dosyası — kiracı süzgeçli. */
  private async requireAsset(tenantId: string, assetId: string) {
    const asset = await this.prisma.client.assetRecord.findFirst({
      where: { id: assetId, tenantId },
      include: { enforcementFile: { select: { id: true, caseId: true, fileNumber: true } } },
    });
    if (!asset) throw new NotFoundException("Malvarlığı kaydı bulunamadı.");
    return asset;
  }

  // ---------------- Kıymet takdiri (İİK m.120) ----------------

  async listValuations(user: AuthUser, assetId: string) {
    await this.requireAsset(user.tenantId, assetId);
    return this.prisma.client.assetValuation.findMany({
      where: { assetId, tenantId: user.tenantId },
      orderBy: { appraisedAt: "desc" },
    });
  }

  async addValuation(
    user: AuthUser,
    assetId: string,
    input: {
      appraiserType: string;
      appraiserName?: string;
      appraisedValue: number;
      appraisedAt: string;
      note?: string;
    },
  ) {
    assertRole(user, ROLE_SETS.OPERASYON, "kıymet takdiri kaydı");
    const asset = await this.requireAsset(user.tenantId, assetId);
    const appraiserType = input.appraiserType as AppraiserType;
    if (!(APPRAISER_TYPES as readonly string[]).includes(appraiserType)) {
      throw new UnprocessableEntityException("Geçersiz takdiri yapan türü.");
    }

    const created = await this.prisma.client.assetValuation.create({
      data: {
        tenantId: user.tenantId,
        assetId,
        appraiserType,
        appraiserName: input.appraiserName?.trim() || null,
        appraisedValue: new Prisma.Decimal(
          input.appraisedValue.toFixed(2),
        ),
        appraisedAt: new Date(input.appraisedAt),
        note: input.note?.trim() || null,
        createdBy: user.userId,
      },
    });
    await touchCase(this.prisma.client, asset.enforcementFile.caseId);
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "ENFORCEMENT_VALUATION_CREATE",
      entity: "AssetValuation",
      entityId: created.id,
      detail: `m.120 takdir — ${asset.description.slice(0, 80)}: ${input.appraisedValue.toFixed(2)} TL`,
    });
    return created;
  }

  // ---------------- Satış / artırma kaydı (m.106+) ----------------

  async listSales(user: AuthUser, assetId: string) {
    await this.requireAsset(user.tenantId, assetId);
    return this.prisma.client.assetSale.findMany({
      where: { assetId, tenantId: user.tenantId },
      orderBy: { saleDate: "desc" },
    });
  }

  /**
   * Satış kaydı — mal durumunu SONUCA göre taşır:
   *   SATILDI       → asset SATILDI (şerit izinliyse)
   *   ERTELENDI / KATILAN_YOK → HACZEDILDI ise SATISA_CIKARILDI
   * (durum şeridi dışına çıkılmaz; uygunsuz geçiş 422)
   */
  async addSale(
    user: AuthUser,
    assetId: string,
    input: {
      saleType: string;
      saleDate: string;
      minimumBid?: number | null;
      depositRatio?: number | null;
      result: string;
      soldAmount?: number | null;
      buyerName?: string;
      note?: string;
    },
  ) {
    assertRole(user, ROLE_SETS.OPERASYON, "satış kaydı");
    const asset = await this.requireAsset(user.tenantId, assetId);
    const saleType = input.saleType as SaleType;
    if (!(SALE_TYPES as readonly string[]).includes(saleType)) {
      throw new UnprocessableEntityException("Geçersiz satış türü.");
    }
    const result = input.result as SaleResult;
    if (!(SALE_RESULTS as readonly string[]).includes(result)) {
      throw new UnprocessableEntityException("Geçersiz satış sonucu.");
    }
    if (result === "SATILDI" && (input.soldAmount === undefined || input.soldAmount === null)) {
      throw new UnprocessableEntityException("Satış sonucu SATILDI ise satış bedeli zorunludur.");
    }

    // Mal durum hedefi — şerit denetimiyle.
    let nextStatus: AssetStatus | null = null;
    if (result === "SATILDI") nextStatus = "SATILDI";
    else if (result === "ERTELENDI" || result === "KATILAN_YOK") {
      if (asset.status === "HACZEDILDI" || asset.status === "SATISA_CIKARILDI") {
        nextStatus = "SATISA_CIKARILDI";
      }
    }
    if (nextStatus && nextStatus !== asset.status) {
      const allowed = ASSET_TRANSITIONS[asset.status];
      if (!allowed.includes(nextStatus)) {
        throw new UnprocessableEntityException({
          message:
            `«${asset.description.slice(0, 60)}» kaydı «${ASSET_STATUS_LABELS[asset.status]}» ` +
            `durumundan «${ASSET_STATUS_LABELS[nextStatus]}» durumuna geçirilemez (İİK satış şeridi). ` +
            `İzin verilen durumlar: ${allowed.map((s) => ASSET_STATUS_LABELS[s]).join(", ") || "yok"}.`,
          currentStatus: asset.status,
          allowedStatuses: allowed,
        });
      }
    }

    const created = await this.prisma.client.assetSale.create({
      data: {
        tenantId: user.tenantId,
        assetId,
        saleType,
        saleDate: new Date(input.saleDate),
        ...(input.minimumBid != null ? { minimumBid: new Prisma.Decimal(input.minimumBid.toFixed(2)) } : {}),
        ...(input.depositRatio != null ? { depositRatio: new Prisma.Decimal(input.depositRatio.toFixed(2)) } : {}),
        result,
        ...(input.soldAmount != null ? { soldAmount: new Prisma.Decimal(input.soldAmount.toFixed(2)) } : {}),
        buyerName: input.buyerName?.trim() || null,
        note: input.note?.trim() || null,
        createdBy: user.userId,
      },
    });
    if (nextStatus && nextStatus !== asset.status) {
      await this.prisma.client.assetRecord.update({
        where: { id: assetId },
        data: { status: nextStatus },
      });
    }
    await touchCase(this.prisma.client, asset.enforcementFile.caseId);
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "ENFORCEMENT_SALE_CREATE",
      entity: "AssetSale",
      entityId: created.id,
      detail: `${SALE_TYPE_LABELS[saleType]} — ${SALE_RESULT_LABELS[result]}${input.soldAmount ? ` (${input.soldAmount.toFixed(2)} TL)` : ""}`,
    });
    return created;
  }
}
