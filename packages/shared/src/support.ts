/**
 * FAZ 8C — destek talepleri (kiracı → platform) ve SLA ilk yanıt süreleri.
 *
 * Tek kaynak: API, web (Ayarlar → Destek) ve admin (/destek) aynı sabitleri kullanır.
 * SLA yalnız İLK PLATFORM YANITINI ölçer (çözüm süresi ayrı taahhüt değildir); süre, talebin
 * açılışından itibaren takvim saatidir (mesai saati hesabı yoktur — SLA metniyle uyumludur).
 */

export const SUPPORT_PRIORITIES = ["DUSUK", "NORMAL", "YUKSEK", "KRITIK"] as const;
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];

export const SUPPORT_CATEGORIES = ["GENEL", "HATA", "FATURA", "UYAP", "AI", "VERI"] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const SUPPORT_STATUSES = ["ACIK", "YANITLANDI", "MUSTERI_BEKLENIYOR", "COZULDU", "KAPALI"] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

/** İlk yanıt SLA'sı (saat). */
export const SUPPORT_SLA_HOURS: Record<SupportPriority, number> = {
  KRITIK: 2,
  YUKSEK: 8,
  NORMAL: 24,
  DUSUK: 72,
};

export const SUPPORT_PRIORITY_LABELS: Record<SupportPriority, string> = {
  DUSUK: "Düşük",
  NORMAL: "Normal",
  YUKSEK: "Yüksek",
  KRITIK: "Kritik",
};

export const SUPPORT_CATEGORY_LABELS: Record<SupportCategory, string> = {
  GENEL: "Genel",
  HATA: "Hata / arıza",
  FATURA: "Fatura ve abonelik",
  UYAP: "UYAP köprüsü",
  AI: "Yapay zekâ",
  VERI: "Veri ve göç",
};

export const SUPPORT_STATUS_LABELS: Record<SupportStatus, string> = {
  ACIK: "Açık",
  YANITLANDI: "Yanıtlandı",
  MUSTERI_BEKLENIYOR: "Büro yanıtı bekleniyor",
  COZULDU: "Çözüldü",
  KAPALI: "Kapalı",
};

/** SLA durumu — ilk yanıt açısından. */
export type SupportSlaState = "BEKLIYOR" | "IHLAL" | "ZAMANINDA" | "GEC";

export interface SupportSla {
  dueAt: string;
  respondedAt: string | null;
  state: SupportSlaState;
  /** Yanıt bekleniyorsa kalan dakika (negatif = aşıldı); yanıtlandıysa null. */
  remainingMinutes: number | null;
}

export function supportSla(input: { firstResponseDueAt: Date | string; firstResponseAt: Date | string | null }, now: Date = new Date()): SupportSla {
  const due = new Date(input.firstResponseDueAt);
  const responded = input.firstResponseAt ? new Date(input.firstResponseAt) : null;
  if (responded) {
    return { dueAt: due.toISOString(), respondedAt: responded.toISOString(), state: responded.getTime() <= due.getTime() ? "ZAMANINDA" : "GEC", remainingMinutes: null };
  }
  const remaining = Math.round((due.getTime() - now.getTime()) / 60000);
  return { dueAt: due.toISOString(), respondedAt: null, state: remaining < 0 ? "IHLAL" : "BEKLIYOR", remainingMinutes: remaining };
}

export function supportDueAt(priority: SupportPriority, createdAt: Date): Date {
  return new Date(createdAt.getTime() + SUPPORT_SLA_HOURS[priority] * 3600_000);
}

export const SUPPORT_TICKET_ROUTES = {
  list: "/support/tickets",
  create: "/support/tickets",
  detail: (id: string) => `/support/tickets/${id}`,
  message: (id: string) => `/support/tickets/${id}/messages`,
  close: (id: string) => `/support/tickets/${id}/close`,
} as const;
