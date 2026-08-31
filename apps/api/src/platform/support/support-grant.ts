import type { SupportScope } from "@nomosos/db";

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ DESTEK ERİŞİM PENCERESİ — ARTIK GERÇEK BİR KAPI (denetim bulgusu Ö-06)   ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * `SupportAccessGrant` kaydı yazılıyordu ama HİÇBİR YERDE OKUNMUYORDU: dört-göz
 * onayı, 24 saatlik tavan ve kapsam beyaz listesi hiçbir şeyi kapılamıyordu.
 * Grant, denetim izinde "erişim açıldı" diyen ama erişimin kendisiyle bağı
 * olmayan bir kâğıt parçasıydı — süresi dolduğunda da hiçbir şey değişmiyordu.
 *
 * Artık SUPPORT_AGENT'ın kiracı verisine bakması AKTİF ve SÜRESİ DOLMAMIŞ bir
 * grant gerektirir. Kapsam hiyerarşisi:
 *
 *   SADECE_USTVERI  ⊂  YAPILANDIRMA  ⊂  ICERIK_MASKELI
 *
 * Yani `ICERIK_MASKELI` kapsamlı bir pencere, üstveri okumalarını da kapsar;
 * tersi geçmez. Hiyerarşi "geniş olan darı içerir" ilkesindedir ve genişletme
 * kararı dört-göz onayında verilir.
 *
 * BU DOSYA SAFTIR: veritabanı okumaz, saat okumaz. Karar birim testlenebilir;
 * okuma ve 403 üretimi `SupportGrantGuard`'ın işidir.
 */

/** Dardan geniş kapsama sıralı liste. */
export const SUPPORT_SCOPE_ORDER: readonly SupportScope[] = [
  "SADECE_USTVERI",
  "YAPILANDIRMA",
  "ICERIK_MASKELI",
];

export const SUPPORT_SCOPE_LABELS: Record<SupportScope, string> = {
  SADECE_USTVERI: "yalnız üstveri",
  YAPILANDIRMA: "yapılandırma",
  ICERIK_MASKELI: "maskeli içerik",
};

export interface SupportGrantSnapshot {
  scope: SupportScope;
  expiresAt: Date;
  revokedAt: Date | null;
}

/** Grant bu an için yaşıyor mu? (iptal edilmemiş ve süresi dolmamış) */
export function isGrantLive(grant: SupportGrantSnapshot, now: Date): boolean {
  if (grant.revokedAt !== null && grant.revokedAt.getTime() <= now.getTime()) return false;
  return grant.expiresAt.getTime() > now.getTime();
}

/** Grant kapsamı, istenen kapsamı karşılıyor mu? */
export function scopeCovers(granted: SupportScope, required: SupportScope): boolean {
  return SUPPORT_SCOPE_ORDER.indexOf(granted) >= SUPPORT_SCOPE_ORDER.indexOf(required);
}

/**
 * Erişim kararı. `null` → geçilir; string → 403 gövdesi (Türkçe, eyleme
 * dönüştürülebilir: kullanıcı ne yapması gerektiğini okur).
 *
 * SÜRESİ DOLMUŞ ile HİÇ AÇILMAMIŞ pencere AYRI mesaj alır: destek personeli
 * "yeniden talep aç" ile "önce talep aç" arasındaki farkı görmelidir.
 */
export function supportGrantDenial(
  grants: readonly SupportGrantSnapshot[],
  required: SupportScope,
  now: Date
): string | null {
  const live = grants.filter((g) => isGrantLive(g, now));
  if (live.some((g) => scopeCovers(g.scope, required))) return null;

  const requiredLabel = SUPPORT_SCOPE_LABELS[required];

  if (live.length > 0) {
    const best = live
      .map((g) => SUPPORT_SCOPE_LABELS[g.scope])
      .join(", ");
    return (
      `Bu büro için açık destek erişiminiz var ama kapsamı yetersiz (${best}); bu ekran ` +
      `"${requiredLabel}" kapsamı ister. Daha geniş kapsamlı yeni bir destek erişim ` +
      "penceresi talep edin (dört-göz onayına tabidir)."
    );
  }

  if (grants.length > 0) {
    return (
      "Bu büro için destek erişim pencereniz sona ermiş veya iptal edilmiş. Destek " +
      "erişimi SÜRELİDİR ve kendiliğinden kapanır; incelemeye devam etmek için yeni " +
      "bir pencere talep edin (dört-göz onayına tabidir)."
    );
  }

  return (
    "Bu büronun verisine bakabilmek için önce bir destek erişim penceresi açılmalıdır " +
    `("${requiredLabel}" kapsamı). Pencere dört-göz onayına tabidir, süreli ve ` +
    "salt-okurdur; açılışı ve kapanışı hem platform hem büro denetim izine yazılır."
  );
}
