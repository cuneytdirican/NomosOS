import type { DeadlineStatus, UserRole } from "@nomosos/shared";

/**
 * SÜRE DURUM GEÇİŞ POLİTİKASI — saf karar mantığı.
 *
 * Neden ayrı dosya: bu kurallar meslek sorumluluğu doğuran kararlardır
 * (kaçırılmış bir sürenin kapatılması, kapanmış bir sürenin yeniden açılması)
 * ve DB/DI'ya hiç ihtiyaç duymazlar. `portal-account-lockout.ts` ile aynı
 * desen: saf fonksiyon + birim testi. Denetim bulgusu K-13, kuralın servisin
 * içine gömülü olması yüzünden testsiz kalmıştı.
 */

/** Kapanmış sayılan durumlar — bunlardan çıkış yoktur. */
export const TERMINAL_DEADLINE_STATUSES: readonly DeadlineStatus[] = ["TAMAMLANDI", "IPTAL"];

/** Dosya/müvekkil üzerinde tam hukuki tasarruf. */
const HUKUKI: readonly UserRole[] = ["ADMIN", "PARTNER", "AVUKAT"];
/** Onay yetkisi. */
const ONAY: readonly UserRole[] = ["ADMIN", "PARTNER"];
/** Büro operasyonu. */
const OPERASYON: readonly UserRole[] = ["ADMIN", "PARTNER", "AVUKAT", "SEKRETER"];

export type TransitionRejection =
  | { kind: "AYNI_DURUM"; message: string }
  | { kind: "TERMINAL"; message: string }
  | { kind: "YETKI"; message: string; requiredRoles: readonly UserRole[] }
  | { kind: "GEREKCE"; message: string };

export interface TransitionInput {
  from: DeadlineStatus;
  to: DeadlineStatus;
  role: UserRole;
  /** Kullanıcının yazdığı gerekçe (varsa). */
  note?: string | null;
  /** Hata mesajlarında kullanılan süre başlığı. */
  title: string;
}

/**
 * Geçiş değerlendirmesi. `null` = geçişe izin verilir.
 *
 * Kural sırası (ilk eşleşen kazanır):
 *  1. Aynı duruma geçiş anlamsızdır.
 *  2. TAMAMLANDI/IPTAL terminaldir; kapanmış süre yeniden açılamaz.
 *  3. KACIRILDI'DAN ÇIKIŞ: ADMIN/PARTNER + zorunlu gerekçe. (K-13)
 *  4. KACIRILDI'YA GİRİŞ: HUKUKI + zorunlu gerekçe.
 *  5. ONAYLANDI / IPTAL: HUKUKI.
 *  6. TAMAMLANDI: OPERASYON.
 */
export function evaluateDeadlineStatusTransition(input: TransitionInput): TransitionRejection | null {
  const { from, to, role, title } = input;
  const note = input.note?.trim() ?? "";

  if (from === to) {
    return { kind: "AYNI_DURUM", message: `«${title}» süresi zaten ${to} durumunda.` };
  }

  if (TERMINAL_DEADLINE_STATUSES.includes(from)) {
    return {
      kind: "TERMINAL",
      message:
        `«${title}» süresi ${from} durumundan ${to} durumuna geçirilemez; ` +
        "kapanmış süre yeniden açılamaz.",
    };
  }

  // K-13: kaçırılmış sürenin ÇIKIŞI, girişinden de dar bir kapıdadır.
  //
  // `KACIRILDI` bilerek terminal değildir (yanlış işaretleme düzeltilebilmeli),
  // ama korumasız çıkış, sekreterin tek istekle risk sinyalini ve rapor sayacını
  // silmesine izin veriyordu: `risk.rules.ts` "kaçırılmış" tanımı TAMAMLANDI'yı
  // saymaz, `sure-performansi.report.ts` sayacı da `status='KACIRILDI'` süzer.
  if (from === "KACIRILDI") {
    if (!ONAY.includes(role)) {
      return {
        kind: "YETKI",
        requiredRoles: ONAY,
        message:
          "Kaçırılmış bir sürenin durumunu değiştirmek için ortak veya yönetici yetkisi gerekir. " +
          "Bu kayıt dosya risk göstergesini ve süre performansı raporunu doğrudan etkiler.",
      };
    }
    if (!note) {
      return {
        kind: "GEREKCE",
        message:
          "Kaçırılmış bir sürenin durumunu değiştirirken gerekçe yazılmalıdır; " +
          "bu kayıt denetim izinde ve dosya safahatında kalır.",
      };
    }
    return null;
  }

  if (to === "KACIRILDI") {
    if (!HUKUKI.includes(role)) {
      return {
        kind: "YETKI",
        requiredRoles: HUKUKI,
        message: "Süreyi kaçırıldı olarak işaretlemek için avukat, ortak veya yönetici yetkisi gerekir.",
      };
    }
    if (!note) {
      return {
        kind: "GEREKCE",
        message:
          "Süreyi kaçırıldı olarak işaretlerken gerekçe yazılmalıdır; bu kayıt denetim izinde kalır.",
      };
    }
    return null;
  }

  if ((to === "ONAYLANDI" || to === "IPTAL") && !HUKUKI.includes(role)) {
    return {
      kind: "YETKI",
      requiredRoles: HUKUKI,
      message: `Süre ${to === "ONAYLANDI" ? "onayı" : "iptali"} için avukat, ortak veya yönetici yetkisi gerekir.`,
    };
  }

  if (to === "TAMAMLANDI" && !OPERASYON.includes(role)) {
    return {
      kind: "YETKI",
      requiredRoles: OPERASYON,
      message: "Stajyer rolü süre kapatma yetkisine sahip değil.",
    };
  }

  return null;
}
