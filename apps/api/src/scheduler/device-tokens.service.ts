import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../common/types";
import { PUSH_PROVIDER, type PushProvider } from "./push/push-provider";
import type { DeviceTokenRegisterInput } from "./device-tokens.schemas";

/** Kullanıcı başına saklanacak azami aktif cihaz. */
const MAX_ACTIVE_DEVICES_PER_USER = 10;

/**
 * CİHAZ JETONU KAYDI — MOBİL HAZIRLIĞI.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ JETON KULLANICIYA DEĞİL CİHAZA AİTTİR.                                   ║
 * ║ Şemada `@@unique([token])` vardır ve tenant'tan BAĞIMSIZDIR. Nedeni      ║
 * ║ somut: bir avukat telefonundan çıkıp aynı cihaza başka bir hesapla       ║
 * ║ girdiğinde, sağlayıcı AYNI jetonu verir. Jeton eski sahibinde kalsaydı   ║
 * ║ o cihaz, artık kullanmadığı hesabın — hatta başka bir büronun —          ║
 * ║ bildirimlerini almaya devam ederdi. Bu yüzden kayıt DEVREDİLİR:          ║
 * ║ `upsert` ile tenantId/userId üzerine yazılır.                            ║
 * ║                                                                          ║
 * ║ DEVİR YALNIZ TAHMİN EDİLEMEZ JETONLA GÜVENLİDİR (denetim bulgusu 1).     ║
 * ║ Jeton kimlikten türetilebiliyorsa devir bir saldırı aracına dönüşür:     ║
 * ║ saldırgan kurbanın jetonunu kurar, POST eder ve satır ona geçer. Kapı    ║
 * ║ `device-tokens.schemas.ts` içindedir (`isPredictableDeviceToken`) ve     ║
 * ║ girdi doğrulamasında UYGULANIR. Burada ikinci savunma vardır: her        ║
 * ║ SAHİPLİK DEĞİŞİKLİĞİ denetim izine yazılır — sessiz devir yoktur.        ║
 * ║ Kiracı değişikliğinde ayrıca ESKİ kiracının denetim izine de kayıt       ║
 * ║ düşer; cihazın o bürodan ayrıldığı orada da görünür.                     ║
 * ║                                                                          ║
 * ║ GERÇEK PUSH GÖNDERİMİ YOKTUR (bkz. push/push-provider.ts). Jetonlar      ║
 * ║ sağlayıcı bağlandığında hazır olsun diye toplanır; bugün hiçbir yere     ║
 * ║ gönderilmezler.                                                          ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
@Injectable()
export class DeviceTokensService {
  private readonly logger = new Logger(DeviceTokensService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider
  ) {}

  async register(user: AuthUser, input: DeviceTokenRegisterInput) {
    const now = new Date();

    /**
     * SAHİPLİK DEĞİŞİKLİĞİ DENETİM İZİNE YAZILIR.
     * Devrin kendisi meşrudur (cihaz el değiştirdi), ama SESSİZ olmamalıdır:
     * bir bildirim yanlış telefona düştüğünde "bu cihaz ne zaman kime geçti"
     * sorusunun yanıtı bir yerde durmalıdır.
     */
    const existing = await this.prisma.client.deviceToken.findUnique({
      where: { token: input.token },
      select: { tenantId: true, userId: true },
    });
    if (existing && (existing.tenantId !== user.tenantId || existing.userId !== user.userId)) {
      const crossTenant = existing.tenantId !== user.tenantId;
      await this.audit.log({
        tenantId: user.tenantId,
        userId: user.userId,
        action: "DEVICE_TOKEN_TRANSFER",
        entity: "DeviceToken",
        detail:
          `Cihaz kaydı devralındı (son 6 hane: ...${input.token.slice(-6)}). ` +
          (crossTenant
            ? "Cihaz BAŞKA BİR KİRACIDAN devralındı; eski kiracının bildirimleri bu cihaza artık gitmez."
            : "Cihaz aynı kiracıdaki başka bir kullanıcıdan devralındı."),
      });
      if (crossTenant) {
        // Eski kiracının izine de düşsün: cihazın oradan ayrıldığı o defterde görünmeli.
        await this.audit.log({
          tenantId: existing.tenantId,
          userId: existing.userId,
          action: "DEVICE_TOKEN_TRANSFER",
          entity: "DeviceToken",
          detail:
            `Cihaz kaydı bu kiracıdan çıktı (son 6 hane: ...${input.token.slice(-6)}). ` +
            "Cihaz başka bir kiracıdaki kullanıcı tarafından kaydedildi; bu bürodan bildirim almayacak.",
        });
      }
    }

    const saved = await this.prisma.client.deviceToken.upsert({
      where: { token: input.token },
      create: {
        tenantId: user.tenantId,
        userId: user.userId,
        platform: input.platform,
        token: input.token,
        isActive: true,
        lastSeenAt: now,
      },
      // DEVİR: cihaz el değiştirdiyse sahiplik güncellenir.
      update: {
        tenantId: user.tenantId,
        userId: user.userId,
        platform: input.platform,
        isActive: true,
        lastSeenAt: now,
      },
    });

    await this.pruneOldDevices(user);

    return {
      id: saved.id,
      platform: saved.platform,
      isActive: saved.isActive,
      lastSeenAt: saved.lastSeenAt,
      createdAt: saved.createdAt,
      /**
       * İSTEMCİYE DÜRÜST YANIT: jeton kaydedildi ama gönderim kanalı yok.
       * Mobil uygulama bu bayrağa bakıp kullanıcıya "push kapalı, uygulama içi
       * bildirimler açık" diyebilir.
       */
      pushProvider: this.push.name,
      pushEnabled: this.push.configured,
      note: this.push.configured
        ? null
        : "Push sağlayıcısı yapılandırılmamış; bildirimler yalnız uygulama içinde görünür.",
    };
  }

  /**
   * Jetonu pasifleştirir (çıkış / bildirim kapatma).
   *
   * SATIR SİLİNMEZ, `isActive=false` yapılır: aynı cihaz yeniden giriş
   * yaptığında `upsert` mevcut satırı canlandırır ve cihaz geçmişi korunur.
   *
   * Süzgeç `tenantId` + `userId` içerir: başkasının jetonunu kapatmak (basit
   * bir hizmet engelleme yöntemi olurdu) mümkün değildir.
   */
  async revoke(user: AuthUser, token: string) {
    const result = await this.prisma.client.deviceToken.updateMany({
      where: { token, tenantId: user.tenantId, userId: user.userId },
      data: { isActive: false },
    });
    if (result.count === 0) {
      // "Yok" ile "senin değil" ayrımı yapılmaz — jeton varlığı sızdırılmaz.
      throw new NotFoundException("Cihaz jetonu bulunamadı.");
    }
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "DEVICE_TOKEN_REVOKE",
      entity: "DeviceToken",
      // Jetonun KENDİSİ denetim izine YAZILMAZ; bir kimlik bilgisidir.
      detail: `Cihaz jetonu pasifleştirildi (son 6 hane: ...${token.slice(-6)}).`,
    });
    return { revoked: result.count };
  }

  /** Kullanıcının kayıtlı cihazları (jeton gövdesi DÖNMEZ). */
  async list(user: AuthUser) {
    const rows = await this.prisma.client.deviceToken.findMany({
      where: { tenantId: user.tenantId, userId: user.userId, isActive: true },
      orderBy: { lastSeenAt: "desc" },
      select: { id: true, platform: true, lastSeenAt: true, createdAt: true },
    });
    return { items: rows, pushEnabled: this.push.configured, pushProvider: this.push.name };
  }

  /**
   * Kullanıcı başına aktif cihaz sayısını sınırlar.
   *
   * Sınır olmasaydı, her yeniden kurulumda yeni jeton üreten bir cihaz
   * kullanıcı başına yüzlerce ölü kayıt bırakırdı; gerçek push bağlandığında
   * her bildirim bu ölü jetonlara da denenirdi.
   */
  private async pruneOldDevices(user: AuthUser): Promise<void> {
    try {
      const active = await this.prisma.client.deviceToken.findMany({
        where: { tenantId: user.tenantId, userId: user.userId, isActive: true },
        orderBy: { lastSeenAt: "desc" },
        select: { id: true },
      });
      const stale = active.slice(MAX_ACTIVE_DEVICES_PER_USER).map((d) => d.id);
      if (stale.length === 0) return;
      await this.prisma.client.deviceToken.updateMany({
        where: { id: { in: stale } },
        data: { isActive: false },
      });
    } catch (err) {
      // Temizlik bir yan işlemdir; kayıt işlemini düşürmez.
      this.logger.warn(`Eski cihaz kayıtları temizlenemedi: ${(err as Error).message}`);
    }
  }
}
