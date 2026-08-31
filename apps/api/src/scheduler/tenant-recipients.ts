import { Injectable } from "@nestjs/common";
import type { UserRole } from "@nomosos/shared";
import { PrismaService } from "../prisma/prisma.service";

/**
 * KİRACI ALICI KÜMESİ — TENANT İZOLASYONUNUN ZAMANLANMIŞ İŞ TARAFI.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ Zamanlanmış işler HTTP isteği bağlamında çalışmaz; `request.user` yoktur,║
 * ║ dolayısıyla guard'lar da yoktur. Kiracı izolasyonunu burada KOD sağlar.  ║
 * ║ Kural: bir bildirimin alıcısı, olayın ait olduğu kiracının AKTİF         ║
 * ║ kullanıcısı OLMAK ZORUNDADIR. Kaydın taşıdığı `ownerId`/                ║
 * ║ `responsibleUserId` değeri bu kümeye karşı DOĞRULANIR; kümede yoksa      ║
 * ║ alıcı kabul edilmez. Böylece bozuk/eski bir kimlik, başka bir büronun    ║
 * ║ kullanıcısına bildirim taşıyamaz.                                        ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Küme kiracı BAŞINA BİR KEZ okunur; kayıt başına sorgu atmak birkaç yüz
 * bürolu bir kurulumda geceyi kilitlerdi.
 */

/** Sahipsiz kayıtlarda uyarılacak roller — büro operasyonunun sorumluları. */
const FALLBACK_ROLES: readonly UserRole[] = ["ADMIN", "PARTNER"];

export interface TenantAudience {
  tenantId: string;
  /** tenantId'ye ait AKTİF kullanıcı kimlikleri. */
  activeUserIds: Set<string>;
  /** Sahipsiz kayıtların düşeceği yöneticiler (ADMIN/PARTNER). */
  fallbackUserIds: string[];
}

@Injectable()
export class TenantRecipientsService {
  constructor(private readonly prisma: PrismaService) {}

  async load(tenantId: string): Promise<TenantAudience> {
    const users = await this.prisma.client.user.findMany({
      // tenantId SÜZGECİ ZORUNLUDUR — bu satır izolasyonun kendisidir.
      where: { tenantId, isActive: true },
      select: { id: true, role: true },
    });

    return {
      tenantId,
      activeUserIds: new Set(users.map((u) => u.id)),
      fallbackUserIds: users
        .filter((u) => FALLBACK_ROLES.includes(u.role))
        .map((u) => u.id),
    };
  }

  /**
   * Alıcıları çözer.
   *
   * 1. Tercih edilen kimlik (süre sahibi / dosya sorumlusu) kiracının aktif
   *    kullanıcısıysa YALNIZ o kişi uyarılır.
   * 2. Değilse (boş, pasif, silinmiş ya da BAŞKA KİRACIYA ait) büro
   *    yöneticilerine düşer — kayıt sahipsiz kalıp sessizce kaybolmasın.
   * 3. Yönetici de yoksa boş dizi döner; iş bunu `alicisiz` olarak raporlar.
   */
  static resolve(audience: TenantAudience, preferredUserId: string | null | undefined): string[] {
    return TenantRecipientsService.resolveDetailed(audience, preferredUserId).targets;
  }

  /**
   * `resolve` ile aynı karar, ama YEDEĞE DÜŞÜLDÜĞÜNÜ de bildirir.
   *
   * ╔══════════════════════════════════════════════════════════════════════╗
   * ║ YEDEĞE DÜŞMEK BÜRO İÇİ GİZLİLİĞİ GENİŞLETİR (denetim bulgusu 17).    ║
   * ║ Bir avukat işten ayrıldığında onun bütün dosyalarının başlığı, esas   ║
   * ║ numarası ve hukuki dayanağı bir gecede TÜM ortakların bildirim        ║
   * ║ kutusuna düşer. `notifications.service.ts`in kendi kuralı ("bir       ║
   * ║ avukat başka bir avukatın süre hatırlatmasını GÖREMEZ") bu yolla      ║
   * ║ dolaylı olarak gevşer.                                                ║
   * ║                                                                       ║
   * ║ Kaydın sessizce kaybolmaması daha önemlidir — bu yüzden davranış      ║
   * ║ KORUNUR — ama artık SAYILIR ve `JobRun.detailJson` içinde ayrıca      ║
   * ║ raporlanır. Operatör "bu gece kaç sahipsiz kayıt yönetime düştü"      ║
   * ║ sorusunu panelden yanıtlayabilir; sayı beklenmedik biçimde            ║
   * ║ büyüdüğünde bu, atama tarafında bir sorunun ilk işaretidir.           ║
   * ╚══════════════════════════════════════════════════════════════════════╝
   */
  static resolveDetailed(
    audience: TenantAudience,
    preferredUserId: string | null | undefined,
  ): { targets: string[]; fallback: boolean } {
    if (preferredUserId && audience.activeUserIds.has(preferredUserId)) {
      return { targets: [preferredUserId], fallback: false };
    }
    return { targets: audience.fallbackUserIds, fallback: true };
  }
}
