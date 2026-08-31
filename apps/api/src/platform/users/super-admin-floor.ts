import { MIN_ACTIVE_SUPER_ADMINS } from "../platform.constants";

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ SUPER_ADMIN TABANI — denetim bulgusu Ö-02                                ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * `MIN_ACTIVE_SUPER_ADMINS` sabiti tanımlıydı ama HİÇBİR YERDE EŞİK DEĞİLDİ:
 * yalnız yanıt metninde ve hata mesajında geçiyordu. Gerçek kapı
 * `remaining === 0` idi, yani sistem tek SUPER_ADMIN'e DÜŞÜRÜLEBİLİYORDU.
 *
 * Tek SUPER_ADMIN kalınca kilitlenme zinciri şudur:
 *   A, B'yi pasifleştirir → geriye yalnız A kalır → dört-göz kuralı gereği
 *   "talep eden ≠ onaylayan" (platform-approvals.service.ts) A'nın kendi
 *   talebini onaylamasını reddeder → tenant silme, iade, bakım kilidi, kredi
 *   tahsisi dâhil TÜM dört-göz işlemleri KALICI olarak donar. Kurtarma yalnız
 *   veritabanına elle müdahaleyle mümkündür.
 *
 * Bu yüzden eşik `remaining < MIN_ACTIVE_SUPER_ADMINS`tir: sistem hiçbir zaman
 * iki aktif SUPER_ADMIN'in altına inemez.
 *
 * SAF FONKSİYON: sayıyı çağıran okur (talep anında bir kez, UYGULAMA anında
 * transaction içinde bir kez daha). Karar burada verilir, testlenebilir.
 */
export function superAdminFloorViolation(
  remainingActive: number,
  minimum: number = MIN_ACTIVE_SUPER_ADMINS
): string | null {
  if (remainingActive >= minimum) return null;
  return (
    `Bu işlem sonrasında sistemde ${remainingActive} aktif SUPER_ADMIN kalırdı. ` +
    `Sistemde her an en az ${minimum} aktif SUPER_ADMIN bulunmalıdır: taban aşılırsa ` +
    "dört-göz onayları (talep eden ≠ onaylayan) kalıcı olarak kilitlenir ve " +
    "kurtarma yalnız veritabanına elle müdahaleyle mümkün olur. Önce yeni bir " +
    "SUPER_ADMIN atayın."
  );
}
