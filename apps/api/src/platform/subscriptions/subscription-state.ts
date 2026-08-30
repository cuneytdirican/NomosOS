import { BadRequestException } from "@nestjs/common";
import type { SubscriptionStatus } from "@nomosos/db";

/**
 * ABONELİK DURUM MAKİNESİ — docs/moduller/25 §Veri Modeli.
 *
 *   TRIAL ──ödeme──▶ ACTIVE            TRIAL ──süre doldu──▶ SUSPENDED
 *   ACTIVE ──ödeme başarısız──▶ PAST_DUE ──grace──▶ SUSPENDED
 *   PAST_DUE ──ödeme──▶ ACTIVE         SUSPENDED ──ödeme/manuel──▶ ACTIVE
 *   ACTIVE|PAST_DUE|SUSPENDED ──iptal──▶ CANCELED (TERMİNAL)
 *
 * CANCELED terminaldir: iptal edilmiş bir abonelik yeniden canlandırılmaz,
 * yeni abonelik açılır. Bu kural, iptal sonrası saklama/anonimleştirme
 * takviminin geriye alınamamasını sağlar.
 */
const TRANSITIONS: Record<SubscriptionStatus, readonly SubscriptionStatus[]> = {
  TRIAL: ["ACTIVE", "SUSPENDED", "CANCELED"],
  ACTIVE: ["PAST_DUE", "SUSPENDED", "CANCELED"],
  PAST_DUE: ["ACTIVE", "SUSPENDED", "CANCELED"],
  SUSPENDED: ["ACTIVE", "CANCELED"],
  CANCELED: [],
};

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  TRIAL: "Deneme",
  ACTIVE: "Aktif",
  PAST_DUE: "Ödeme gecikmiş",
  SUSPENDED: "Askıda",
  CANCELED: "İptal",
};

export function canTransition(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Geçersiz geçişte 400 fırlatır.
 *
 * NOT: spec metni bu hata için 422 önerir; faz kararı gereği tüm doğrulama
 * hataları 400 ile döner (mevcut API sözleşmesiyle tutarlılık). Teslim
 * raporunda not düşüldü.
 */
export function assertTransition(from: SubscriptionStatus, to: SubscriptionStatus): void {
  if (from === to) {
    throw new BadRequestException(
      `Abonelik zaten "${SUBSCRIPTION_STATUS_LABELS[from]}" durumunda.`
    );
  }
  if (!canTransition(from, to)) {
    const allowed = TRANSITIONS[from];
    throw new BadRequestException(
      `Geçersiz abonelik durum geçişi: ${SUBSCRIPTION_STATUS_LABELS[from]} → ` +
        `${SUBSCRIPTION_STATUS_LABELS[to]}. ` +
        (allowed.length === 0
          ? "İptal edilmiş abonelik yeniden başlatılamaz; yeni abonelik açılmalıdır."
          : `Bu durumdan yalnızca şunlara geçilebilir: ${allowed
              .map((s) => SUBSCRIPTION_STATUS_LABELS[s])
              .join(", ")}.`)
    );
  }
}

/**
 * Dört-göz gerektiren geçişler.
 *
 * Askıya alma ve iptal yıkıcıdır (kullanıcı erişimi kesilir); tek kişiyle
 * yapılamaz. Diğer geçişler (ödeme alındı, temerrüde düştü) operasyonun
 * olağan akışıdır.
 *
 * KARAR HEDEF DURUMA DEĞİL, GEÇİŞİN ANLAMINA BAĞLIDIR. `SUSPENDED → ACTIVE`
 * hedefine bakıldığında sıradan bir "aktifleştirme"dir; anlamına bakıldığında
 * İKİ KİŞİNİN KAPATTIĞI BİR BÜROYU YENİDEN AÇMAKTIR ve adanmış ucu
 * (`POST /tenants/:id/activate`) zaten `tenant.reactivate` → four_eyes ister.
 * Yalnız hedefe bakan eski sürüm, bu kapıyı `POST /subscriptions/:id/transition`
 * üzerinden tek imzayla atlatılabilir bırakıyordu (denetim bulgusu 3):
 * yıkıcı bir işlemin GERİ ALINMASI da en az onun kadar korunmalıdır.
 */
export function transitionNeedsApproval(
  from: SubscriptionStatus,
  to: SubscriptionStatus
): boolean {
  if (to === "SUSPENDED" || to === "CANCELED") return true;
  if (from === "SUSPENDED" && to === "ACTIVE") return true;
  return false;
}
