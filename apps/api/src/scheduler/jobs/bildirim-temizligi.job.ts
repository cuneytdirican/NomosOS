import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { JOB_KEYS } from "../scheduler.constants";
import type { JobExecutionContext, JobResult, ScheduledJobHandler } from "../scheduler.types";

/** Okunmuş/iptal bildirimler 90 gün, diğerleri 180 gün sonra silinir. */
export const OKUNMUS_SAKLAMA_GUN = 90;
export const GENEL_SAKLAMA_GUN = 180;

/**
 * BİLDİRİM KUTUSU TEMİZLİĞİ (`bildirim-temizligi-gunluk`) — her gün 04:30.
 *
 * Bildirim kutusu bir olay günlüğü DEĞİLDİR (denetim izi AuditLog'dadır);
 * süre/duruşma hatırlatmaları her gece üretildiği için tablo sınırsız büyür.
 * Okunan/iptal satırlar 90, geri kalanı 180 gün sonra budanır.
 */
@Injectable()
export class BildirimTemizligiJob implements ScheduledJobHandler {
  readonly key = JOB_KEYS.BILDIRIM_TEMIZLIGI;
  readonly name = "Bildirim kutusu temizliği";
  readonly defaultCron = "30 4 * * *";
  readonly description =
    `Okunmuş/iptal bildirimleri ${OKUNMUS_SAKLAMA_GUN}, diğerlerini ${GENEL_SAKLAMA_GUN} gün sonra siler. ` +
    "Denetim izi ayrı tabloda kalır.";

  constructor(private readonly prisma: PrismaService) {}

  async run(ctx: JobExecutionContext): Promise<JobResult> {
    const okunmusSinir = new Date(ctx.now.getTime() - OKUNMUS_SAKLAMA_GUN * 86_400_000);
    const genelSinir = new Date(ctx.now.getTime() - GENEL_SAKLAMA_GUN * 86_400_000);
    const okunmus = await this.prisma.client.notificationOutbox.deleteMany({
      where: { status: { in: ["OKUNDU", "IPTAL"] }, createdAt: { lt: okunmusSinir } },
    });
    const genel = await this.prisma.client.notificationOutbox.deleteMany({ where: { createdAt: { lt: genelSinir } } });
    return { created: 0, skipped: 0, failed: 0, detail: { okunmusSilinen: okunmus.count, eskiSilinen: genel.count }, errors: [] };
  }
}
