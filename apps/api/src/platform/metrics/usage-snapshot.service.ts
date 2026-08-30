import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { utcDay } from "../platform-serialize";

export interface SnapshotResult {
  date: string;
  tenantCount: number;
  written: number;
  durationMs: number;
}

/**
 * GÜNLÜK KULLANIM FOTOĞRAFI (UsageSnapshot).
 *
 * NEDEN SNAPSHOT: panelin tarihsel grafikleri her açılışta bürolarin
 * operasyonel tablolarını taramamalıdır. Gece bir kez toplanır, panel
 * snapshot'tan okur; analitik yük veri düzlemine binmez (spec §UsageSnapshot
 * stratejisi).
 *
 * İDEMPOTENT: anahtar `@@unique([tenantId, date])`. Aynı gün için ikinci
 * çalıştırma yeni satır ÜRETMEZ, mevcut satırı günceller (kabul kriteri 10).
 *
 * TARİH UTC GÜN BAŞIDIR: `date` alanı `@db.Date`'tir; yerel saatle gün üretmek
 * negatif ofsetli saat dilimlerinde günü kaydırır ve unique anahtarı bozar.
 *
 * GERÇEK CRON FAZ 6'DA: burada yalnızca çağrılabilir bir servis vardır;
 * `POST /metrics/snapshot/run` ile elle tetiklenir. BullMQ repeatable job
 * bağlandığında çağıracağı metot budur — imzası değişmeyecek.
 */
@Injectable()
export class UsageSnapshotService {
  private readonly logger = new Logger(UsageSnapshotService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Verilen gün (varsayılan: DÜN) için tenant başına sayıları hesaplar.
   *
   * "Dün" seçilir çünkü bugünün günü henüz kapanmamıştır; yarım günün fotoğrafı
   * grafiklerde yanıltıcı bir düşüş gibi görünür. Bugünün sayıları panelde
   * canlı sayaçlardan okunur.
   */
  async collectDaily(target?: Date): Promise<SnapshotResult> {
    const started = Date.now();
    const day = utcDay(target ?? new Date(Date.now() - 24 * 60 * 60 * 1000));
    const dayStart = day;
    const dayEnd = new Date(day.getTime() + 24 * 60 * 60 * 1000);

    const tenants = await this.prisma.client.tenant.findMany({ select: { id: true } });

    // Tüm kırılımlar TEK turda toplanır; tenant başına ayrı sorgu atmak
    // (N+1) yüzlerce büroda geceyi kilitlerdi.
    const [activeUsers, aiUsage, cases, documents, storage] = await Promise.all([
      // Aktif kullanıcı: o gün denetim izinde işlemi görünen ayrık kullanıcılar.
      this.prisma.client.auditLog.findMany({
        where: { createdAt: { gte: dayStart, lt: dayEnd }, userId: { not: null } },
        select: { tenantId: true, userId: true },
        distinct: ["tenantId", "userId"],
      }),
      this.prisma.client.aiUsageLog.groupBy({
        by: ["tenantId"],
        where: { createdAt: { gte: dayStart, lt: dayEnd } },
        _count: { _all: true },
        _sum: { inputTokens: true, outputTokens: true },
      }),
      // Kümülatif sayaçlar: gün SONU itibarıyla toplam.
      this.prisma.client.case.groupBy({
        by: ["tenantId"],
        where: { createdAt: { lt: dayEnd } },
        _count: { _all: true },
      }),
      this.prisma.client.document.groupBy({
        by: ["tenantId"],
        where: { createdAt: { lt: dayEnd } },
        _count: { _all: true },
      }),
      this.prisma.client.document.groupBy({
        by: ["tenantId"],
        where: { createdAt: { lt: dayEnd } },
        _sum: { sizeBytes: true },
      }),
    ]);

    const activeByTenant = new Map<string, number>();
    for (const row of activeUsers) {
      activeByTenant.set(row.tenantId, (activeByTenant.get(row.tenantId) ?? 0) + 1);
    }
    const aiByTenant = new Map(aiUsage.map((r) => [r.tenantId, r]));
    const caseByTenant = new Map(cases.map((r) => [r.tenantId, r._count._all]));
    const docByTenant = new Map(documents.map((r) => [r.tenantId, r._count._all]));
    const storageByTenant = new Map(storage.map((r) => [r.tenantId, r._sum.sizeBytes ?? 0]));

    let written = 0;
    for (const tenant of tenants) {
      const ai = aiByTenant.get(tenant.id);
      const data = {
        activeUsers: activeByTenant.get(tenant.id) ?? 0,
        caseCount: caseByTenant.get(tenant.id) ?? 0,
        documentCount: docByTenant.get(tenant.id) ?? 0,
        aiCallCount: ai?._count._all ?? 0,
        // OLLAMA/CUSTOM çağrılarında token bilgisi dönmeyebilir; `null` gelen
        // değerler 0 olarak toplanır — bu kayıtların "token bilgisi yok" olarak
        // ayrıca sayılması Faz 4 anomali motorunun işidir.
        aiInputTokens: ai?._sum.inputTokens ?? 0,
        aiOutputTokens: ai?._sum.outputTokens ?? 0,
        // Document.sizeBytes Int'tir; UsageSnapshot.storageBytes BigInt.
        storageBytes: BigInt(storageByTenant.get(tenant.id) ?? 0),
      };

      await this.prisma.client.usageSnapshot.upsert({
        where: { tenantId_date: { tenantId: tenant.id, date: day } },
        create: { tenantId: tenant.id, date: day, ...data },
        update: data,
      });
      written += 1;
    }

    const result: SnapshotResult = {
      date: day.toISOString().slice(0, 10),
      tenantCount: tenants.length,
      written,
      durationMs: Date.now() - started,
    };
    this.logger.log(
      `Kullanım fotoğrafı alındı: ${result.date}, ${written} büro, ${result.durationMs} ms.`
    );
    return result;
  }
}
