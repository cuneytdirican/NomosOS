import { attemptCounter, type AttemptCounterBackend } from "../auth/attempt-counter";
import { PORTAL_LOCKOUT_MINUTES, PORTAL_MAX_FAILED_ATTEMPTS } from "./portal.constants";

/** Sayaç penceresi: bu süre içinde birikmeyen hatalar unutulur. */
const FAILURE_WINDOW_MS = 30 * 60_000;

/**
 * DAR GİRİŞ KİLİDİ — `IP ∧ e-posta` (spec §İş Kuralları 9).
 *
 * IP başına hız sınırından (PortalRateLimitGuard) BAĞIMSIZDIR ve onun yerine
 * geçmez. Hesap düzeyindeki GENİŞ sayaç `portal-account-lockout.ts`tedir ve
 * veritabanına yazar; bu dar sayaç onun önündeki ilk settir.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ denetim bulgusu Ö-09: SAYAÇ ARTIK SÜREÇ BELLEĞİNDE DEĞİL                 ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Eskiden `Map` süreç belleğindeydi: süreç yeniden başlarsa kilit düşüyor, çok
 * örnekli dağıtımda sınır örnek sayısıyla ÇARPILIYORDU (3 replika → 5 değil 15
 * deneme). Ortak kova artık Redis'tedir; Redis yoksa süreç-içi kovaya düşülür
 * ve açılışta belirgin uyarı basılır — API yine açılır.
 *
 * KİLİT NASIL İFADE EDİLİR: ayrı bir "kilit" anahtarı tutulmaz. Sayaç eşiğe
 * ulaştığında AYNI anahtarın penceresi kilit süresine UZATILIR. Böylece tek
 * bir Redis anahtarı hem "kaç hata" hem "ne zamana kadar kilitli" sorusunu
 * yanıtlar ve iki anahtarın birbirinden ayrı düşmesi (biri süresi dolar,
 * diğeri kalır) imkânsız hâle gelir.
 */
export class PortalLockoutStore {
  constructor(private readonly counter: AttemptCounterBackend = attemptCounter()) {}

  /** Kilitliyse kalan saniye, değilse 0. */
  async remainingLockSeconds(key: string, now = Date.now()): Promise<number> {
    const hit = await this.counter.peek(this.normalize(key), now);
    if (!hit || hit.count < PORTAL_MAX_FAILED_ATTEMPTS) return 0;
    return Math.max(1, Math.ceil((hit.resetAt - now) / 1000));
  }

  /** Başarısız denemeyi sayar; eşiğe gelinirse kilidi kurar. */
  async recordFailure(key: string, now = Date.now()): Promise<void> {
    const id = this.normalize(key);
    const hit = await this.counter.hit(id, FAILURE_WINDOW_MS, now);
    if (hit.count === PORTAL_MAX_FAILED_ATTEMPTS) {
      // Eşiğe TAM olarak gelindiğinde pencereyi kilit süresine uzat. Sonraki
      // hatalar sayacı büyütür ama kilidi UZATMAZ: kilit sabit süredir,
      // saldırganın ısrarı meşru kullanıcının bekleme süresini artırmasın.
      await this.counter.extend(id, PORTAL_LOCKOUT_MINUTES * 60_000, now);
    }
  }

  /** Başarılı girişte sayacı ve kilidi temizler. */
  async clear(key: string): Promise<void> {
    await this.counter.reset(this.normalize(key));
  }

  private normalize(key: string): string {
    return `portal-narrow|${key.trim().toLowerCase().slice(0, 200)}`;
  }
}
