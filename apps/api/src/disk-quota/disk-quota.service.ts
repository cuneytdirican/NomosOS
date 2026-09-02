/**
 * DİSK KOTASI — lisans planına dahil kota + satın alınan ek kota.
 *
 * Kredi cüzdanı desenini izler: purchase → InvoiceRecord (platform faturası) +
 * purchasedBytes artışı. Planın dahil kotası aboneliğin featuresJson
 * `storageGb` alanından okunur ve her erişimde eşitlenir.
 *
 * KULLANIM SAYACI: Document eklendiğinde artar (recordUsage). Yumuşak silinen
 * belge depoda yer tutmaya devam ettiği için sayaç DÜŞMEZ; doğru toplam,
 * recompute koşusunun Document.sizeBytes SUM'ıdır.
 */

import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from "@nestjs/common";
import { Prisma } from "@nomosos/db";
import { assertRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";

/** Bayt → GB. */
export const GB_BYTES = 1024 ** 3;
/** Dahil kota plan tanımında yoksa varsayılan 5 GB. */
export const DEFAULT_INCLUDED_GB = 5;

@Injectable()
export class DiskQuotaService {
  private readonly logger = new Logger(DiskQuotaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Kullanılabilir bayt: dahil + satın alınan − kullanılan. */
  static availableBytes(q: { includedBytes: bigint; purchasedBytes: bigint; usedBytes: bigint }): bigint {
    return q.includedBytes + q.purchasedBytes - q.usedBytes;
  }

  /**
   * Kotayı getir; yoksa oluştur. Dahil kota, abonelik planının `storageGb`
   * özelliğiyle eşitlenir (plan değişince dahil kota da değişir).
   */
  async ensureQuota(tenantId: string) {
    const quota = await this.prisma.client.diskQuota.upsert({
      where: { tenantId },
      create: { tenantId },
      update: {},
    });

    // Dahil kotayı planla eşitle — abonelik/plan değişikliği kotayı izler.
    const includedBytes = await this.planIncludedBytes(tenantId);
    if (includedBytes !== null && includedBytes !== quota.includedBytes) {
      return this.prisma.client.diskQuota.update({
        where: { tenantId },
        data: { includedBytes },
      });
    }
    return quota;
  }

  /** Aboneliğin planındaki dahil disk kotası (bayt); plan yoksa null. */
  private async planIncludedBytes(tenantId: string): Promise<bigint | null> {
    const sub = await this.prisma.client.subscription.findUnique({
      where: { tenantId },
      select: { planKey: true },
    });
    if (!sub) return null;
    const plan = await this.prisma.client.planTier.findFirst({
      where: { key: sub.planKey },
      select: { featuresJson: true },
    });
    if (!plan) return null;
    try {
      const features = JSON.parse(plan.featuresJson) as { storageGb?: number };
      if (typeof features.storageGb !== "number" || features.storageGb < 0) return null;
      return BigInt(Math.round(features.storageGb * GB_BYTES));
    } catch {
      return null;
    }
  }

  /**
   * GERÇEK KULLANIM — VERİTABANINDAN HESAPLANIR (kullanıcı talebi).
   *
   * `usedBytes` sayacı bir önbellektir; doğruluk kaynağı Document tablosunun
   * sizeBytes TOPLAMIDIR. Sayaç kayabilir (yarıda kalan yükleme, elle veri
   * taşınması, düzeltilmiş kayıt); her kota kontrolü bu yüzden agregasyonla
   * HESAPLAR, önbelleği okumaz.
   *
   * Yumuşak silinen belgeler (İ-16) depoda yer tutmaya devam ettiği için
   * toplam TÜM belgeleri kapsar (deletedAt süzgesi YOK).
   */
  async computeUsedBytes(tenantId: string): Promise<bigint> {
    const agg = await this.prisma.client.document.aggregate({
      where: { tenantId },
      _sum: { sizeBytes: true },
    });
    return BigInt(agg._sum.sizeBytes ?? 0);
  }

  /**
   * YÜKLEME KAPISI — byte yazmadan önce çağrılır.
   * Kota yetersizse 507 (Insufficient Storage) döner; mesaj net söyler:
   * satın alma ayarında ne kadar kaldığı da yazar.
   */
  async assertCanStore(tenantId: string, incomingBytes: number): Promise<void> {
    if (incomingBytes <= 0) return;
    const [quota, usedBytes] = await Promise.all([
      this.ensureQuota(tenantId),
      this.computeUsedBytes(tenantId),
    ]);
    const available = quota.includedBytes + quota.purchasedBytes - usedBytes;
    if (available < BigInt(incomingBytes)) {
      throw new HttpException(
        {
          message:
            `Disk kotası yetersiz: ${((quota.includedBytes + quota.purchasedBytes) / BigInt(GB_BYTES)).toString()} GB ` +
            `kullanılabilir alandan ${(available < 0n ? 0n : available) / BigInt(GB_BYTES)} GB boş; ` +
            `bu yükleme ${(incomingBytes / GB_BYTES).toFixed(2)} GB gerektiriyor. ` +
            "Ayarlar → Disk Kotası'ndan ek paket satın alabilir veya büronuzdaki eski belgeleri arşivleyebilirsiniz.",
          code: "DISK_QUOTA_EXCEEDED",
          availableBytes: (available < 0n ? 0n : available).toString(),
          requiredBytes: String(incomingBytes),
        },
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
  }

  /**
   * Önbellek bakımı — Document kaydıyla AYNI işlemde çağrılır.
   * Doğruluk kaynağı DEĞİLDİR: kota kontrolü (assertCanStore) ve durum
   * (status) kullanımı veritabanı agregasyonundan HESAPLAR. Bu çağrı yalnızca
   * önbellek sütununu sıcak tutar (panel listeleri agregasyon yapmadan okur).
   */
  async recordUsage(tenantId: string, bytes: number): Promise<void> {
    if (bytes <= 0) return;
    await this.prisma.client.diskQuota.update({
      where: { tenantId },
      data: { usedBytes: { increment: BigInt(bytes) } },
    });
  }

  /** Önbelleği gerçek toplamla eşitler — computeUsedBytes'in yazan hâli. */
  async recompute(tenantId: string) {
    const usedBytes = await this.computeUsedBytes(tenantId);
    await this.prisma.client.diskQuota.update({
      where: { tenantId },
      data: { usedBytes, recomputedAt: new Date() },
    });
    return usedBytes;
  }

  /**
   * GET /disk-quota — büronun kota durumu.
   *
   * Kullanım HER ZAMAN veritabanından hesaplanır (Document.sizeBytes toplamı);
   * `usedBytes` sütunu yalnızca önbellek olarak eşitlenir.
   */
  async status(user: AuthUser) {
    const quota = await this.ensureQuota(user.tenantId);
    const usedBytes = await this.computeUsedBytes(user.tenantId);
    // Önbelleği arka planda eşitle (yanıt yolunu bekletmez).
    void this.prisma.client.diskQuota
      .update({
        where: { tenantId: user.tenantId },
        data: { usedBytes, recomputedAt: new Date() },
      })
      .catch(() => undefined);

    const totalBytes = quota.includedBytes + quota.purchasedBytes;
    // BigInt JSON'a serileşmez — bayt alanları STRING olarak döner (istemci
    // Number'a çevirir; 2^53 bayt = 9 PB üst sınırın çok üstünde).
    return {
      includedBytes: quota.includedBytes.toString(),
      purchasedBytes: quota.purchasedBytes.toString(),
      usedBytes: usedBytes.toString(),
      totalBytes: totalBytes.toString(),
      availableBytes: (totalBytes - usedBytes).toString(),
      usedPercent: totalBytes === 0n ? 100 : Number((usedBytes * 100n) / totalBytes),
      includedGbLabel: `${Number(quota.includedBytes) / GB_BYTES} GB (plan dahili)`,
    };
  }

  /** Satılabilir disk paketleri. */
  async listPackages() {
    const packages = await this.prisma.client.diskPackage.findMany({
      where: { isActive: true },
      orderBy: { gb: "asc" },
    });
    return packages.map((p) => ({
      key: p.key,
      gb: p.gb,
      bytes: (BigInt(p.gb) * BigInt(GB_BYTES)).toString(),
      price: p.price,
      currency: p.currency,
    }));
  }

  /**
   * POST /disk-quota/purchase — ek disk paketi satın alma (kredi deseni):
   * InvoiceRecord (KDV dahil platform faturası) + purchasedBytes artışı.
   * Ödeme sağlayıcısı Noop olduğundan fatura BORÇ olarak düşer; platform
   * tahsilatı bağlanınca PaymentRecord ile kapanır.
   */
  async purchase(user: AuthUser, packageKey: string) {
    assertRole(user, ROLE_SETS.ONAY, "disk paketi satın alma");

    const pkg = await this.prisma.client.diskPackage.findUnique({ where: { key: packageKey } });
    if (!pkg || !pkg.isActive) {
      throw new BadRequestException(`"${packageKey}" anahtarlı satılabilir bir disk paketi bulunamadı.`);
    }
    await this.ensureQuota(user.tenantId);

    const vatRate = new Prisma.Decimal("0.20");
    const amount = pkg.price.toDecimalPlaces(2);
    const vatAmount = amount.times(vatRate).toDecimalPlaces(2);
    const total = amount.plus(vatAmount);

    const result = await this.prisma.client.$transaction(async (tx) => {
      const fatura = await tx.invoiceRecord.create({
        data: {
          tenantId: user.tenantId,
          number: null, // Numara e-Fatura akışında verilir; taslak numarasız durur.
          amount,
          vatAmount,
          total,
          issueDate: new Date(),
          status: "TASLAK",
        },
      });
      const quota = await tx.diskQuota.update({
        where: { tenantId: user.tenantId },
        data: { purchasedBytes: { increment: BigInt(pkg.gb) * BigInt(GB_BYTES) } },
      });
      await tx.diskQuotaAdjustment.create({
        data: {
          tenantId: user.tenantId,
          deltaBytes: BigInt(pkg.gb) * BigInt(GB_BYTES),
          reason: `Satın alma: ${pkg.key} (${pkg.gb} GB) — fatura ${fatura.id}`,
          createdBy: user.userId,
          approvalStatus: "ONAYLANDI",
        },
      });
      return { fatura, quota };
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "DISK_PAKETI_SATIN_ALMA",
      entity: "InvoiceRecord",
      entityId: result.fatura.id,
      detail: `${pkg.key} · ${pkg.gb} GB · ${result.fatura.amount} ${pkg.currency}`,
    });

    return {
      fatura: result.fatura,
      purchasedBytes: result.quota.purchasedBytes,
      totalBytes: result.quota.includedBytes + result.quota.purchasedBytes,
    };
  }

  /**
   * PLATFORM DÖRT-GÖZ İCRASI — onaylanmış DiskQuotaAdjustment'ı uygular.
   * Platform kontrolörü onay talebini açar; executor buraya gelir.
   */
  async applyPlatformAdjustment(input: {
    tenantId: string;
    deltaBytes: number;
    reason: string;
    performedBy: string;
  }) {
    const quota = await this.ensureQuota(input.tenantId);
    const delta = BigInt(Math.trunc(input.deltaBytes));
    if (quota.purchasedBytes + delta < 0n) {
      throw new BadRequestException(
        "Düzeltme satın alınan kotayı negatife düşürüyor; önce kotayı yükseltin.",
      );
    }
    await this.prisma.client.diskQuota.update({
      where: { tenantId: input.tenantId },
      data: { purchasedBytes: { increment: delta } },
    });
    await this.prisma.client.diskQuotaAdjustment.create({
      data: {
        tenantId: input.tenantId,
        deltaBytes: delta,
        reason: input.reason,
        createdBy: input.performedBy,
        approvalStatus: "ONAYLANDI",
      },
    });
    return `Disk kotası güncellendi: ${delta > 0n ? "+" : ""}${delta} bayt.`;
  }
}
