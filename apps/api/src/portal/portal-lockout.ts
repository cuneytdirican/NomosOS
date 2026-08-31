import { PORTAL_LOCKOUT_MINUTES, PORTAL_MAX_FAILED_ATTEMPTS } from "./portal.constants";

interface LockoutEntry {
  failures: number;
  /** Kilidin bittiği an (ms). 0 = kilit yok. */
  lockedUntil: number;
  /** Sayaç penceresinin sonu — bu andan sonra sayaç sıfırlanır. */
  windowEndsAt: number;
}

/** Sayaç penceresi: bu süre içinde birikmeyen hatalar unutulur. */
const FAILURE_WINDOW_MS = 30 * 60_000;

/** Tablonun sınırsız büyümesini önleyen üst sınır. */
const MAX_TRACKED = 20_000;

/**
 * HESAP DÜZEYİNDE GİRİŞ KİLİDİ — spec §İş Kuralları 9
 * ("5 hatalı denemede 15 dakika kilit").
 *
 * IP başına hız sınırından (PortalRateLimitGuard) BAĞIMSIZDIR ve onun
 * yerine geçmez: IP sayacı dağıtık bir denemede (her istek başka çıkıştan)
 * ayrı kovalara düşer ve hesabı korumaz. Bu sayaç E-POSTA BAŞINADIR, yani
 * denemenin nereden geldiği önemsizdir.
 *
 * BELLEK İÇİDİR. `PortalUser` tablosunda `failedAttempts` / `lockedUntil`
 * alanları yoktur ve şema bu fazda kapalıdır (`packages/db` başka bir ajanın
 * alanı). Sonucu: süreç yeniden başlarsa kilit düşer ve çok örnekli
 * dağıtımda sayaç örnek başına tutulur. Kalıcı kilit, şemaya bu iki alan
 * eklendiğinde `PlatformUser`'daki desenle veritabanına taşınmalıdır —
 * teslim raporunda not düşülmüştür.
 */
export class PortalLockoutStore {
  private readonly entries = new Map<string, LockoutEntry>();

  /** Kilitliyse kalan saniye, değilse 0. */
  remainingLockSeconds(key: string, now = Date.now()): number {
    const entry = this.entries.get(this.normalize(key));
    if (!entry || entry.lockedUntil <= now) return 0;
    return Math.max(1, Math.ceil((entry.lockedUntil - now) / 1000));
  }

  /** Başarısız denemeyi sayar; eşiğe gelinirse kilidi kurar. */
  recordFailure(key: string, now = Date.now()): void {
    const id = this.normalize(key);
    const entry = this.entries.get(id);

    if (!entry || entry.windowEndsAt <= now) {
      this.entries.set(id, {
        failures: 1,
        lockedUntil: 0,
        windowEndsAt: now + FAILURE_WINDOW_MS,
      });
      this.prune(now);
      return;
    }

    entry.failures += 1;
    if (entry.failures >= PORTAL_MAX_FAILED_ATTEMPTS) {
      entry.lockedUntil = now + PORTAL_LOCKOUT_MINUTES * 60_000;
      // Sayaç sıfırlanır: kilit bittikten sonra kullanıcı temiz sayfayla
      // başlar, ama yeni 5 hata yine kilitler.
      entry.failures = 0;
      entry.windowEndsAt = entry.lockedUntil + FAILURE_WINDOW_MS;
    }
  }

  /** Başarılı girişte sayacı ve kilidi temizler. */
  clear(key: string): void {
    this.entries.delete(this.normalize(key));
  }

  private normalize(key: string): string {
    return key.trim().toLowerCase().slice(0, 200);
  }

  private prune(now: number): void {
    if (this.entries.size < MAX_TRACKED) return;
    for (const [key, entry] of this.entries) {
      if (entry.windowEndsAt <= now && entry.lockedUntil <= now) this.entries.delete(key);
    }
  }
}
