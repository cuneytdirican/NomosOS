/**
 * HERKESAÇIK DEMO TALEBİ SERVİSİ.
 *
 * TASARIM (kullanıcı kararı): talep E-POSTA/WEBHOOK GÖNDERİLMEZ; DemoRequest
 * kaydı olarak düşer ve platform panelinden (Demo Talepleri) izlenir.
 *
 * KORUMA:
 *  - Gövde doğrulama (Zod) — ad-soyad + e-posta zorunlu.
 *  - IP bazlı hız sınırı: dakikada 3 istek, saat başına 10 (işlem içi sayaç —
 *    tek örnek; çok örnekli dağıtımda Redis sayaçlarına taşınır).
 *  - Tekrar bastırma: aynı e-postadan 10 dakika içinde ikinci kayıt alınmaz.
 *
 * Kimlik İSTEMEZ (@Public) — pazarlama formu anonimdir. PlatformAuditService
 * kimliksiz uçta kullanılamaz; kayıt izi DemoRequest satırının kendisidir
 * (statusChangedBy platform tarafında dolu gelir).
 */

import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service";

export const demoTalepSchema = z.object({
  fullName: z.string().trim().min(2, "Ad soyad zorunludur.").max(200),
  barAssociation: z.string().trim().max(200).optional(),
  email: z.string().trim().email("Geçerli bir e-posta adresi girin.").max(200),
  phone: z.string().trim().max(50).optional(),
  lawyerCount: z.string().trim().max(20).optional(),
  message: z.string().trim().max(2000).optional(),
});

const RATE_LIMIT_PER_MINUTE = 3;
const RATE_LIMIT_PER_HOUR = 10;
const DEDUPE_WINDOW_MS = 10 * 60_000;

@Injectable()
export class DemoTalepService {
  private readonly minuteHits = new Map<string, number[]>();
  private readonly hourHits = new Map<string, number[]>();
  private readonly recentEmails = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  private rateLimited(ip: string): boolean {
    const now = Date.now();
    const minute = (this.minuteHits.get(ip) ?? []).filter((t) => now - t < 60_000);
    const hour = (this.hourHits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
    if (minute.length >= RATE_LIMIT_PER_MINUTE || hour.length >= RATE_LIMIT_PER_HOUR) {
      this.minuteHits.set(ip, minute);
      this.hourHits.set(ip, hour);
      return true;
    }
    minute.push(now);
    hour.push(now);
    this.minuteHits.set(ip, minute);
    this.hourHits.set(ip, hour);
    return false;
  }

  async create(ip: string, input: z.infer<typeof demoTalepSchema>) {
    if (this.rateLimited(ip)) {
      throw new HttpException(
        "Kısa sürede çok fazla talep gönderildi. Lütfen daha sonra tekrar deneyin.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Tekrar bastırma: aynı e-posta 10 dakikada bir kez.
    const last = this.recentEmails.get(input.email.toLowerCase());
    if (last !== undefined && Date.now() - last < DEDUPE_WINDOW_MS) {
      throw new HttpException(
        "Talebiniz az önce alındı; ekibimiz en kısa sürede size dönecek.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.recentEmails.set(input.email.toLowerCase(), Date.now());

    const row = await this.prisma.client.demoRequest.create({
      data: {
        fullName: input.fullName,
        barAssociation: input.barAssociation ?? null,
        email: input.email.toLowerCase(),
        phone: input.phone ?? null,
        lawyerCount: input.lawyerCount ?? null,
        message: input.message ?? null,
        // Şema default'u da YENI'dir; açık yazım kayıt anını belirsiz bırakmaz.
        status: "YENI",
      },
    });

    // Yanıt minimidir: kayıt kimliği ve eylem talimatı değil, sadece alınmış
    // olduğu bilgisi (spam botuna yüzey azaltmak için).
    return { ok: true as const, id: row.id };
  }
}
