/** Türkçe etiketler ve rozet tonları — web panelindeki lib/labels.ts ile aynı sözlük. */

import type { ToneName } from "@/ui/theme";

export const CASE_TYPE_LABELS: Record<string, string> = {
  DAVA: "Dava",
  ICRA: "İcra",
  ARABULUCULUK: "Arabuluculuk",
  CEZA: "Ceza",
  DANISMANLIK: "Danışmanlık",
};

export const CASE_STATUS_LABELS: Record<string, string> = {
  ACIK: "Açık",
  DERDEST: "Derdest",
  KARAR: "Karar",
  ISTINAF: "İstinaf",
  TEMYIZ: "Temyiz",
  KESINLESTI: "Kesinleşti",
  ICRADA: "İcrada",
  KAPANDI: "Kapandı",
  ARSIV: "Arşiv",
};

export const CASE_STATUS_TONES: Record<string, ToneName> = {
  ACIK: "blue",
  DERDEST: "navy",
  KARAR: "gold",
  ISTINAF: "yellow",
  TEMYIZ: "yellow",
  KESINLESTI: "green",
  ICRADA: "red",
  KAPANDI: "gray",
  ARSIV: "gray",
};

export const HEARING_TYPE_LABELS: Record<string, string> = {
  DURUSMA: "Duruşma",
  ON_INCELEME: "Ön İnceleme",
  KESIF: "Keşif",
  E_DURUSMA: "E-Duruşma",
  MUZAKERE: "Müzakere",
  DIGER: "Diğer",
};

export const HEARING_STATUS_LABELS: Record<string, string> = {
  PLANLANDI: "Planlandı",
  YAPILDI: "Yapıldı",
  ERTELENDI: "Ertelendi",
  IPTAL: "İptal",
};

export const HEARING_STATUS_TONES: Record<string, ToneName> = {
  PLANLANDI: "blue",
  YAPILDI: "green",
  ERTELENDI: "yellow",
  IPTAL: "gray",
};

export const DEADLINE_STATUS_LABELS: Record<string, string> = {
  BEKLIYOR: "Onay bekliyor",
  ONAYLANDI: "Onaylandı",
  TAMAMLANDI: "Tamamlandı",
  KACIRILDI: "Kaçırıldı",
  IPTAL: "İptal",
};

export const DEADLINE_STATUS_TONES: Record<string, ToneName> = {
  BEKLIYOR: "yellow",
  ONAYLANDI: "blue",
  TAMAMLANDI: "green",
  KACIRILDI: "danger",
  IPTAL: "gray",
};

export const DEADLINE_SOURCE_LABELS: Record<string, string> = {
  MANUEL: "Elle girildi",
  KURAL: "Kural motoru",
  AI_ONERISI: "AI önerisi",
};

export const TASK_STATUS_LABELS: Record<string, string> = {
  ACIK: "Açık",
  DEVAM_EDIYOR: "Devam ediyor",
  KONTROLDE: "Kontrolde",
  ONAY_BEKLIYOR: "Onay bekliyor",
  TAMAMLANDI: "Tamamlandı",
  IPTAL: "İptal",
};

export const TASK_STATUS_TONES: Record<string, ToneName> = {
  ACIK: "gray",
  DEVAM_EDIYOR: "blue",
  KONTROLDE: "yellow",
  ONAY_BEKLIYOR: "gold",
  TAMAMLANDI: "green",
  IPTAL: "gray",
};

export const TASK_PRIORITY_LABELS: Record<string, string> = {
  DUSUK: "Düşük",
  NORMAL: "Normal",
  YUKSEK: "Yüksek",
  KRITIK: "Kritik",
};

export const TASK_PRIORITY_TONES: Record<string, ToneName> = {
  DUSUK: "gray",
  NORMAL: "blue",
  YUKSEK: "yellow",
  KRITIK: "danger",
};

export const PARTY_ROLE_LABELS: Record<string, string> = {
  DAVACI: "Davacı",
  DAVALI: "Davalı",
  MUDAHIL: "Müdahil",
  ALACAKLI: "Alacaklı",
  BORCLU: "Borçlu",
  SANIK: "Sanık",
  MUSTEKI: "Müşteki",
  KATILAN: "Katılan",
  TANIK: "Tanık",
  DIGER: "Diğer",
};

export const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Yönetici",
  PARTNER: "Ortak",
  AVUKAT: "Avukat",
  STAJYER: "Stajyer",
  SEKRETER: "Sekreter",
};

export const NOTIFICATION_KIND_LABELS: Record<string, string> = {
  SURE_YAKLASIYOR: "Süre yaklaşıyor",
  SURE_KACIRILDI: "Süre kaçırıldı",
  DURUSMA_YARIN: "Yarın duruşma",
  GOREV_ATANDI: "Görev atandı",
  GOREV_GECIKTI: "Görev gecikti",
  ONAY_BEKLIYOR: "Onay bekliyor",
  BELGE_YUKLENDI: "Belge yüklendi",
  SISTEM: "Sistem",
};

export function label(dictionary: Record<string, string>, key: string | null | undefined): string {
  if (!key) return "—";
  return dictionary[key] ?? key;
}

export function tone(dictionary: Record<string, ToneName>, key: string | null | undefined): ToneName {
  if (!key) return "gray";
  return dictionary[key] ?? "gray";
}

/**
 * Süre onaylama/iptal etme ve süreyi kaçırıldı işaretleme yetkisi olan roller.
 * SUNUCU DA AYNI KONTROLÜ YAPAR (ROLE_SETS.HUKUKI) — buradaki kontrol yalnızca
 * kullanıcıya çalışmayacak bir düğme göstermemek içindir, güvenlik sınırı DEĞİL.
 */
export const HUKUKI_ROLES = ["ADMIN", "PARTNER", "AVUKAT"] as const;

/** Duruşma sonucu / not girme yetkisi (ROLE_SETS.OPERASYON). */
export const OPERASYON_ROLES = ["ADMIN", "PARTNER", "AVUKAT", "SEKRETER"] as const;

export function inRoles(role: string | null | undefined, roles: readonly string[]): boolean {
  return role !== null && role !== undefined && roles.includes(role);
}
