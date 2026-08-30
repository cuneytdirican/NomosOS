/** Türkçe etiketler, rozet tonları ve tarih yardımcıları. */

export const CLIENT_TYPE_LABELS: Record<string, string> = {
  GERCEK_KISI: "Gerçek Kişi",
  TUZEL_KISI: "Tüzel Kişi",
};

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

export type BadgeTone =
  | "gray"
  | "blue"
  | "green"
  | "yellow"
  | "red"
  | "danger"
  | "navy"
  | "gold";

export const CASE_STATUS_TONES: Record<string, BadgeTone> = {
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

export const HEARING_STATUSES = ["PLANLANDI", "YAPILDI", "ERTELENDI", "IPTAL"] as const;

export const HEARING_STATUS_TONES: Record<string, BadgeTone> = {
  PLANLANDI: "blue",
  YAPILDI: "green",
  ERTELENDI: "yellow",
  IPTAL: "gray",
};

export const TASK_STATUS_LABELS: Record<string, string> = {
  ACIK: "Açık",
  DEVAM_EDIYOR: "Devam Ediyor",
  KONTROLDE: "Kontrolde",
  ONAY_BEKLIYOR: "Onay Bekliyor",
  TAMAMLANDI: "Tamamlandı",
  IPTAL: "İptal",
};

export const TASK_STATUS_TONES: Record<string, BadgeTone> = {
  ACIK: "blue",
  DEVAM_EDIYOR: "yellow",
  KONTROLDE: "navy",
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

export const TASK_PRIORITY_TONES: Record<string, BadgeTone> = {
  DUSUK: "gray",
  NORMAL: "blue",
  YUKSEK: "yellow",
  KRITIK: "red",
};

export const DEADLINE_STATUS_LABELS: Record<string, string> = {
  BEKLIYOR: "Onay Bekliyor",
  ONAYLANDI: "Onaylandı",
  TAMAMLANDI: "Tamamlandı",
  KACIRILDI: "Kaçırıldı",
  IPTAL: "İptal",
};

export const DEADLINE_STATUS_TONES: Record<string, BadgeTone> = {
  BEKLIYOR: "yellow",
  ONAYLANDI: "blue",
  TAMAMLANDI: "green",
  KACIRILDI: "danger",
  IPTAL: "gray",
};

export const DEADLINE_SOURCE_LABELS: Record<string, string> = {
  MANUEL: "Manuel",
  KURAL: "Kural Motoru",
  AI_ONERISI: "AI Önerisi",
};

export const DEADLINE_SOURCE_TONES: Record<string, BadgeTone> = {
  MANUEL: "gray",
  KURAL: "navy",
  AI_ONERISI: "gold",
};

// ---------- Faz 1: süre motoru, kararlar, tebligat ----------

export const SERVICE_METHODS = ["ELDEN", "POSTA", "ETEBLIGAT", "DURUSMADA", "DIGER"] as const;

export const SERVICE_METHOD_LABELS: Record<string, string> = {
  ELDEN: "Elden tebliğ",
  POSTA: "Posta / PTT tebligatı",
  ETEBLIGAT: "E-Tebligat (UETS)",
  DURUSMADA: "Duruşmada tefhim",
  DIGER: "Diğer",
};

export const DURATION_UNIT_LABELS: Record<string, string> = {
  GUN: "gün",
  HAFTA: "hafta",
  AY: "ay",
  YIL: "yıl",
};

export const DECISION_TYPES = [
  "ARA_KARAR",
  "GEREKCELI_KARAR",
  "ISTINAF_KARARI",
  "TEMYIZ_KARARI",
  "KESIN_KARAR",
] as const;

export const DECISION_TYPE_LABELS: Record<string, string> = {
  ARA_KARAR: "Ara Karar",
  GEREKCELI_KARAR: "Gerekçeli Karar",
  ISTINAF_KARARI: "İstinaf Kararı",
  TEMYIZ_KARARI: "Temyiz Kararı",
  KESIN_KARAR: "Kesin Karar",
};

export const DECISION_TYPE_TONES: Record<string, BadgeTone> = {
  ARA_KARAR: "blue",
  GEREKCELI_KARAR: "navy",
  ISTINAF_KARARI: "yellow",
  TEMYIZ_KARARI: "yellow",
  KESIN_KARAR: "green",
};

export const CLIENT_CATEGORIES = ["Kurumsal", "Bireysel", "Kamu", "STK"] as const;

export const AI_PROVIDER_TYPE_LABELS: Record<string, string> = {
  ANTHROPIC: "Anthropic (Claude)",
  OPENAI_COMPAT: "OpenAI / OpenAI-uyumlu",
  OLLAMA: "Ollama (yerel)",
  GEMINI: "Google Gemini",
  CUSTOM: "Özel Endpoint",
};

export const DOCUMENT_CLASS_LABELS: Record<string, string> = {
  DILEKCE: "Dilekçe",
  TENSIP_ZAPTI: "Tensip Zaptı",
  ARA_KARAR: "Ara Karar",
  GEREKCELI_KARAR: "Gerekçeli Karar",
  BILIRKISI_RAPORU: "Bilirkişi Raporu",
  DURUSMA_TUTANAGI: "Duruşma Tutanağı",
  TEBLIGAT: "Tebligat",
  MUZEKKERE: "Müzekkere",
  VEKALETNAME: "Vekaletname",
  SOZLESME: "Sözleşme",
  DELIL: "Delil",
  FATURA: "Fatura",
  ICRA_EVRAKI: "İcra Evrakı",
  DIGER: "Diğer",
};

// ---------- Faz 2: belge hattı, öneriler, dilekçe, içtihat ----------

export const PROCESSING_STATUS_LABELS: Record<string, string> = {
  BEKLIYOR: "Bekliyor",
  TAMAM: "Tamam",
  BASARISIZ: "Başarısız",
  GEREKSIZ: "Uygulanamaz",
};

export const PROCESSING_STATUS_TONES: Record<string, BadgeTone> = {
  BEKLIYOR: "yellow",
  TAMAM: "green",
  BASARISIZ: "red",
  GEREKSIZ: "gray",
};

export const PIPELINE_STATUS_LABELS: Record<string, string> = {
  BEKLIYOR: "Sırada",
  CALISIYOR: "Analiz ediliyor…",
  TAMAM: "Analiz tamamlandı",
  BASARISIZ: "Analiz başarısız",
  KISMI: "Kısmen tamamlandı",
};

export const PIPELINE_STATUS_TONES: Record<string, BadgeTone> = {
  BEKLIYOR: "gray",
  CALISIYOR: "blue",
  TAMAM: "green",
  BASARISIZ: "red",
  KISMI: "yellow",
};

export const PROPOSAL_TYPES = [
  "GOREV",
  "SURE",
  "SAFAHAT",
  "MUVEKKIL_BILGILENDIRME",
  "DOSYA_ESLESTIRME",
  "DURUSMA_GUNCELLEME",
] as const;

export const PROPOSAL_TYPE_LABELS: Record<string, string> = {
  GOREV: "Görev",
  SURE: "Süre",
  SAFAHAT: "Safahat",
  MUVEKKIL_BILGILENDIRME: "Müvekkil Bilgilendirme",
  DOSYA_ESLESTIRME: "Dosya Eşleştirme",
  DURUSMA_GUNCELLEME: "Duruşma Güncelleme",
};

export const PROPOSAL_TYPE_TONES: Record<string, BadgeTone> = {
  GOREV: "blue",
  SURE: "red",
  SAFAHAT: "navy",
  MUVEKKIL_BILGILENDIRME: "gold",
  DOSYA_ESLESTIRME: "yellow",
  DURUSMA_GUNCELLEME: "green",
};

/** Onaylanan önerinin ne ürettiğini anlatan bildirim metni. */
export const PROPOSAL_APPLIED_MESSAGES: Record<string, string> = {
  GOREV: "Görev oluşturuldu.",
  SURE: "Süre kaydı oluşturuldu — Süreler sekmesinden hesap izini görebilirsiniz.",
  SAFAHAT: "Safahat kaydı eklendi.",
  MUVEKKIL_BILGILENDIRME: "Müvekkil bilgilendirme görevi oluşturuldu.",
  DOSYA_ESLESTIRME: "Belge ilgili dosyaya bağlandı.",
  DURUSMA_GUNCELLEME: "Duruşma kaydı güncellendi.",
};

export const PROPOSAL_STATUS_LABELS: Record<string, string> = {
  BEKLIYOR: "Onay Bekliyor",
  ONAYLANDI: "Onaylandı",
  REDDEDILDI: "Reddedildi",
  UYGULANDI: "Uygulandı",
};

export const PROPOSAL_STATUS_TONES: Record<string, BadgeTone> = {
  BEKLIYOR: "yellow",
  ONAYLANDI: "blue",
  REDDEDILDI: "gray",
  UYGULANDI: "green",
};

export const PETITION_TYPES = [
  "DAVA_DILEKCESI",
  "CEVAP",
  "CEVABA_CEVAP",
  "IKINCI_CEVAP",
  "ISTINAF",
  "TEMYIZ",
  "ITIRAZ",
  "DELIL_LISTESI",
  "ISLAH",
  "BILIRKISI_ITIRAZ",
  "ICRA_TAKIP_TALEBI",
  "SIKAYET",
  "BEYAN",
  "DIGER",
] as const;

export const PETITION_TYPE_LABELS: Record<string, string> = {
  DAVA_DILEKCESI: "Dava Dilekçesi",
  CEVAP: "Cevap Dilekçesi",
  CEVABA_CEVAP: "Cevaba Cevap",
  IKINCI_CEVAP: "İkinci Cevap",
  ISTINAF: "İstinaf Dilekçesi",
  TEMYIZ: "Temyiz Dilekçesi",
  ITIRAZ: "İtiraz Dilekçesi",
  DELIL_LISTESI: "Delil Listesi",
  ISLAH: "Islah Dilekçesi",
  BILIRKISI_ITIRAZ: "Bilirkişi Raporuna İtiraz",
  ICRA_TAKIP_TALEBI: "İcra Takip Talebi",
  SIKAYET: "Şikâyet Dilekçesi",
  BEYAN: "Beyan Dilekçesi",
  DIGER: "Diğer",
};

export const PETITION_STATUS_LABELS: Record<string, string> = {
  TASLAK: "Taslak",
  TEYIT_EDILIYOR: "Teyit Ediliyor",
  TEYIT_EDILDI: "Teyit Edildi",
  INCELEMEDE: "İncelemede",
  HAZIR: "Hazır",
  DISA_AKTARILDI: "Dışa Aktarıldı",
  GONDERILDI: "Gönderildi",
};

export const PETITION_STATUS_TONES: Record<string, BadgeTone> = {
  TASLAK: "gray",
  TEYIT_EDILIYOR: "yellow",
  TEYIT_EDILDI: "blue",
  INCELEMEDE: "yellow",
  HAZIR: "green",
  DISA_AKTARILDI: "navy",
  GONDERILDI: "green",
};

export const CITATION_STATUS_LABELS: Record<string, string> = {
  DOGRULANDI: "Doğrulandı",
  BULUNAMADI: "Bulunamadı",
  BELIRSIZ: "Belirsiz",
};

export const CITATION_STATUS_TONES: Record<string, BadgeTone> = {
  DOGRULANDI: "green",
  BULUNAMADI: "danger",
  BELIRSIZ: "yellow",
};

export const REF_STATUS_LABELS: Record<string, string> = {
  ADAY: "Aday (AI önerisi)",
  KABUL: "Kabul edildi",
  RED: "Reddedildi",
};

export const REF_STATUS_TONES: Record<string, BadgeTone> = {
  ADAY: "yellow",
  KABUL: "green",
  RED: "gray",
};

export const NOTE_KIND_LABELS: Record<string, string> = {
  GENEL: "Genel",
  DURUSMA_HAZIRLIK: "Duruşma Hazırlık",
  STRATEJI: "Strateji",
  HATIRLATMA: "Hatırlatma",
};

/** Dilekçe bölümlerinin varsayılan iskeleti (şablon gelmezse). */
export const DEFAULT_PETITION_SECTIONS = [
  "KONU",
  "AÇIKLAMALAR",
  "HUKUKİ SEBEPLER",
  "DELİLLER",
  "SONUÇ VE İSTEM",
  "EKLER",
] as const;

export function labelOf(map: Record<string, string>, key: string | undefined | null): string {
  if (!key) return "—";
  return map[key] ?? key;
}

/** Güven skoru 0–1 ya da 0–100 gelebilir; her ikisini de yüzdeye çevirir. */
export function confidencePercent(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const pct = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

/** Güven skoru rozet tonu: %85+ yeşil, %60+ sarı, altı kırmızı. */
export function confidenceTone(value: number | null | undefined): BadgeTone {
  const pct = confidencePercent(value);
  if (pct === null) return "gray";
  if (pct >= 85) return "green";
  if (pct >= 60) return "yellow";
  return "red";
}

export function fmtBytes(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

/** Demo tohum verisi işareti — kullanıcıya "gerçek karar değil" uyarısı için. */
export function isDemoCaseLaw(value: { summary?: string | null; fullText?: string | null; sourceAdapter?: string }): boolean {
  if (value.sourceAdapter === "SEED_DEMO") return true;
  return Boolean(
    value.summary?.includes("[DEMO VERİ]") || value.fullText?.includes("[DEMO VERİ]"),
  );
}

// =====================================================================
// Faz 3 — İcra, Finans, Faturalama
// =====================================================================

export const ENFORCEMENT_TYPES = [
  "ILAMSIZ",
  "ILAMLI",
  "KAMBIYO",
  "REHNIN_PARAYA_CEVRILMESI",
  "IPOTEGIN_PARAYA_CEVRILMESI",
  "NAFAKA",
  "TAHLIYE",
] as const;

export const ENFORCEMENT_TYPE_LABELS: Record<string, string> = {
  ILAMSIZ: "İlamsız Takip",
  ILAMLI: "İlamlı Takip",
  KAMBIYO: "Kambiyo Senedi",
  REHNIN_PARAYA_CEVRILMESI: "Rehnin Paraya Çevrilmesi",
  IPOTEGIN_PARAYA_CEVRILMESI: "İpoteğin Paraya Çevrilmesi",
  NAFAKA: "Nafaka Takibi",
  TAHLIYE: "Tahliye Takibi",
};

/** Aşama şeridi SIRASI — tek yönlüdür (Modül 05, iş kuralı 1). */
export const ENFORCEMENT_STAGES = [
  "TAKIP_TALEBI",
  "ODEME_EMRI_TEBLIG",
  "ITIRAZ",
  "ITIRAZIN_KALDIRILMASI",
  "KESINLESME",
  "HACIZ",
  "SATIS",
  "TAHSILAT",
  "ACIZ_VESIKASI",
  "KAPANDI",
] as const;

export const ENFORCEMENT_STAGE_LABELS: Record<string, string> = {
  TAKIP_TALEBI: "Takip Talebi",
  ODEME_EMRI_TEBLIG: "Ödeme Emri Tebliğ",
  ITIRAZ: "İtiraz",
  ITIRAZIN_KALDIRILMASI: "İtirazın Kaldırılması",
  KESINLESME: "Kesinleşme",
  HACIZ: "Haciz",
  SATIS: "Satış",
  TAHSILAT: "Tahsilat",
  ACIZ_VESIKASI: "Aciz Vesikası",
  KAPANDI: "Kapandı",
};

/** Şeritte kısa gösterim (dar ekranlarda). */
export const ENFORCEMENT_STAGE_SHORT: Record<string, string> = {
  TAKIP_TALEBI: "Takip",
  ODEME_EMRI_TEBLIG: "Ödeme Emri",
  ITIRAZ: "İtiraz",
  ITIRAZIN_KALDIRILMASI: "İtiraz İptali",
  KESINLESME: "Kesinleşme",
  HACIZ: "Haciz",
  SATIS: "Satış",
  TAHSILAT: "Tahsilat",
  ACIZ_VESIKASI: "Aciz",
  KAPANDI: "Kapanış",
};

export const ENFORCEMENT_STAGE_TONES: Record<string, BadgeTone> = {
  TAKIP_TALEBI: "blue",
  ODEME_EMRI_TEBLIG: "blue",
  ITIRAZ: "red",
  ITIRAZIN_KALDIRILMASI: "yellow",
  KESINLESME: "navy",
  HACIZ: "gold",
  SATIS: "gold",
  TAHSILAT: "green",
  ACIZ_VESIKASI: "danger",
  KAPANDI: "gray",
};

export const ENFORCEMENT_ACTION_TYPES = [
  "TAKIP_TALEBI",
  "ODEME_EMRI",
  "ITIRAZ",
  "ITIRAZIN_IPTALI",
  "HACIZ_TALEBI",
  "HACIZ_UYGULAMA",
  "KIYMET_TAKDIRI",
  "SATIS_TALEBI",
  "IHALE",
  "TAHSILAT",
  "HARC_ODEME",
  "MASRAF",
  "DIGER",
] as const;

export const ENFORCEMENT_ACTION_LABELS: Record<string, string> = {
  TAKIP_TALEBI: "Takip Talebi",
  ODEME_EMRI: "Ödeme Emri",
  ITIRAZ: "İtiraz",
  ITIRAZIN_IPTALI: "İtirazın İptali",
  HACIZ_TALEBI: "Haciz Talebi",
  HACIZ_UYGULAMA: "Haciz Uygulaması",
  KIYMET_TAKDIRI: "Kıymet Takdiri",
  SATIS_TALEBI: "Satış Talebi",
  IHALE: "İhale",
  TAHSILAT: "Tahsilat",
  HARC_ODEME: "Harç Ödemesi",
  MASRAF: "Masraf",
  DIGER: "Diğer",
};

export const ENFORCEMENT_ACTION_TONES: Record<string, BadgeTone> = {
  TAKIP_TALEBI: "blue",
  ODEME_EMRI: "blue",
  ITIRAZ: "red",
  ITIRAZIN_IPTALI: "yellow",
  HACIZ_TALEBI: "gold",
  HACIZ_UYGULAMA: "gold",
  KIYMET_TAKDIRI: "navy",
  SATIS_TALEBI: "gold",
  IHALE: "navy",
  TAHSILAT: "green",
  HARC_ODEME: "gray",
  MASRAF: "gray",
  DIGER: "gray",
};

export const ASSET_TYPES = [
  "TASINMAZ",
  "ARAC",
  "BANKA_HESABI",
  "MAAS",
  "ALACAK",
  "HISSE",
  "DIGER",
] as const;

export const ASSET_TYPE_LABELS: Record<string, string> = {
  TASINMAZ: "Taşınmaz",
  ARAC: "Araç",
  BANKA_HESABI: "Banka Hesabı",
  MAAS: "Maaş",
  ALACAK: "Alacak",
  HISSE: "Hisse / Ortaklık Payı",
  DIGER: "Diğer",
};

export const ASSET_STATUSES = [
  "TESPIT_EDILDI",
  "HACZEDILDI",
  "SATISA_CIKARILDI",
  "SATILDI",
  "SERBEST_BIRAKILDI",
] as const;

export const ASSET_STATUS_LABELS: Record<string, string> = {
  TESPIT_EDILDI: "Tespit Edildi",
  HACZEDILDI: "Haczedildi",
  SATISA_CIKARILDI: "Satışa Çıkarıldı",
  SATILDI: "Satıldı",
  SERBEST_BIRAKILDI: "Serbest Bırakıldı",
};

export const ASSET_STATUS_TONES: Record<string, BadgeTone> = {
  TESPIT_EDILDI: "blue",
  HACZEDILDI: "gold",
  SATISA_CIKARILDI: "yellow",
  SATILDI: "green",
  SERBEST_BIRAKILDI: "gray",
};

export const COLLECTION_METHODS = [
  "BANKA",
  "KASA",
  "HACIZ_SATIS",
  "MAAS_KESINTISI",
  "ANLASMA",
  "DIGER",
] as const;

export const COLLECTION_METHOD_LABELS: Record<string, string> = {
  BANKA: "Banka",
  KASA: "Kasa / Vezne",
  HACIZ_SATIS: "Haciz Satışı",
  MAAS_KESINTISI: "Maaş Kesintisi",
  ANLASMA: "Anlaşma (haricen)",
  DIGER: "Diğer",
};

export const SCORE_BAND_LABELS: Record<string, string> = {
  DUSUK: "Düşük",
  ORTA: "Orta",
  YUKSEK: "Yüksek",
};

export const SCORE_BAND_TONES: Record<string, BadgeTone> = {
  DUSUK: "red",
  ORTA: "yellow",
  YUKSEK: "green",
};

/** İcra Copilot komutları — 6 hazır komut (Modül 05). */
export const COPILOT_COMMANDS = [
  {
    key: "ENF_NEXT_ACTIONS",
    label: "Sıradaki İşlemler",
    hint: "Mevcut aşamada yapılabilecek işlemleri öncelik sırasıyla listeler.",
  },
  {
    key: "ENF_COLLECTION_SCORE",
    label: "Tahsilat İhtimali",
    hint: "Kural sinyalleri + AI yorumu ile 0–100 skor. Skor kuraldan gelir.",
  },
  {
    key: "ENF_ASSET_ANALYSIS",
    label: "Malvarlığı Analizi",
    hint: "Sorgu ve haciz sonuçlarını değerlendirir.",
  },
  {
    key: "ENF_MISSED_DEADLINES",
    label: "Süre Denetimi",
    hint: "Kaçırılmış veya riskli süreleri çıkarır (İİK profili).",
  },
  {
    key: "ENF_ACTION_LOG_ANALYSIS",
    label: "İşlem Günlüğü Analizi",
    hint: "Son işlemleri özetler, durmuş süreçleri tespit eder.",
  },
  {
    key: "ENF_OBJECTION_COMPARE",
    label: "İtiraz ↔ Cevap",
    hint: "İtirazları cevaplarla eşleştirir, cevapsız kalanı gösterir.",
  },
] as const;

// ---------- Finans ----------

export const FINANCIAL_ENTRY_TYPE_LABELS: Record<string, string> = {
  TAHAKKUK: "Tahakkuk",
  TAHSILAT: "Tahsilat",
  AVANS: "Avans",
  MASRAF: "Masraf",
  HARC: "Harç",
  VEKALET_UCRETI: "Vekâlet Ücreti",
  DANISMANLIK: "Danışmanlık",
  IADE: "İade",
};

export const FINANCIAL_ENTRY_TYPE_TONES: Record<string, BadgeTone> = {
  TAHAKKUK: "navy",
  TAHSILAT: "green",
  AVANS: "blue",
  MASRAF: "yellow",
  HARC: "yellow",
  VEKALET_UCRETI: "gold",
  DANISMANLIK: "gold",
  IADE: "gray",
};

/** Alacağı artıran (tahakkuk niteliğindeki) hareket tipleri — yalnız gruplama. */
export const ACCRUAL_ENTRY_TYPES = [
  "TAHAKKUK",
  "VEKALET_UCRETI",
  "DANISMANLIK",
] as const;

export const AGING_BUCKET_LABELS: Record<string, string> = {
  "0-30": "0–30 gün",
  "31-60": "31–60 gün",
  "61-90": "61–90 gün",
  "90+": "90+ gün",
};

export const AGING_BUCKET_TONES: Record<string, BadgeTone> = {
  "0-30": "green",
  "31-60": "yellow",
  "61-90": "red",
  "90+": "danger",
};

export const COLLECTION_RISK_LABELS: Record<string, string> = {
  DUSUK: "Düşük risk",
  ORTA: "Orta risk",
  YUKSEK: "Yüksek risk",
  LOW: "Düşük risk",
  MEDIUM: "Orta risk",
  HIGH: "Yüksek risk",
};

export const COLLECTION_RISK_TONES: Record<string, BadgeTone> = {
  DUSUK: "green",
  ORTA: "yellow",
  YUKSEK: "danger",
  LOW: "green",
  MEDIUM: "yellow",
  HIGH: "danger",
};

// ---------- Faturalama ----------

export const FEE_TYPES = [
  "SABIT",
  "SAATLIK",
  "BASARI_PRIMI",
  "DOSYA_BAZLI",
  "AYLIK_DANISMANLIK",
  "KARMA",
] as const;

export const FEE_TYPE_LABELS: Record<string, string> = {
  SABIT: "Sabit Ücret",
  SAATLIK: "Saatlik",
  BASARI_PRIMI: "Başarı Primi",
  DOSYA_BAZLI: "Dosya Bazlı",
  AYLIK_DANISMANLIK: "Aylık Danışmanlık",
  KARMA: "Karma",
};

export const AGREEMENT_STATUSES = ["TASLAK", "AKTIF", "SONA_ERDI", "FESIH"] as const;

export const AGREEMENT_STATUS_LABELS: Record<string, string> = {
  TASLAK: "Taslak",
  AKTIF: "Aktif",
  SONA_ERDI: "Sona Erdi",
  FESIH: "Fesih",
};

export const AGREEMENT_STATUS_TONES: Record<string, BadgeTone> = {
  TASLAK: "gray",
  AKTIF: "green",
  SONA_ERDI: "yellow",
  FESIH: "red",
};

export const INVOICE_STATUSES = [
  "TASLAK",
  "GONDERILDI",
  "KISMI_ODENDI",
  "ODENDI",
  "IPTAL",
  "IADE",
] as const;

export const INVOICE_STATUS_LABELS: Record<string, string> = {
  TASLAK: "Taslak",
  GONDERILDI: "Gönderildi",
  KISMI_ODENDI: "Kısmi Ödendi",
  ODENDI: "Ödendi",
  IPTAL: "İptal",
  IADE: "İade",
};

export const INVOICE_STATUS_TONES: Record<string, BadgeTone> = {
  TASLAK: "gray",
  GONDERILDI: "blue",
  KISMI_ODENDI: "yellow",
  ODENDI: "green",
  IPTAL: "gray",
  IADE: "red",
};

export const E_INVOICE_STATUS_LABELS: Record<string, string> = {
  YOK: "e-Fatura yok",
  BEKLIYOR: "Entegratörde bekliyor",
  GONDERILDI: "GİB'e gönderildi",
  KABUL: "GİB kabul",
  RED: "GİB red",
  IPTAL: "İptal",
};

export const E_INVOICE_STATUS_TONES: Record<string, BadgeTone> = {
  YOK: "gray",
  BEKLIYOR: "yellow",
  GONDERILDI: "blue",
  KABUL: "green",
  RED: "danger",
  IPTAL: "gray",
};

export const PAYMENT_METHODS = [
  "HAVALE",
  "KREDI_KARTI",
  "NAKIT",
  "CEK",
  "SENET",
  "MAHSUP",
  "DIGER",
] as const;

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  HAVALE: "Havale / EFT",
  KREDI_KARTI: "Kredi Kartı",
  NAKIT: "Nakit",
  CEK: "Çek",
  SENET: "Senet",
  MAHSUP: "Mahsup",
  DIGER: "Diğer",
};

export const INVOICE_LINE_SOURCE_LABELS: Record<string, string> = {
  TIME_ENTRY: "Zaman kaydı",
  FEE_AGREEMENT: "Ücret sözleşmesi",
  EXPENSE: "Masraf yansıtma",
  MANUEL: "Elle girildi",
};

/**
 * Dakika → "7,50 sa" gösterimi.
 *
 * `minutes` TAMSAYIDIR; saate çevrim YALNIZCA GÖSTERİMDEDİR. Fatura satırındaki
 * miktar sunucuda hesaplanır — bu yardımcı ekranda okunabilirlik içindir.
 */
export function fmtMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return "—";
  const total = Math.round(minutes);
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest} dk`;
  if (rest === 0) return `${hours} sa`;
  return `${hours} sa ${rest} dk`;
}

/** Dakika toplamının ondalık saat karşılığı ("7,50") — yalnız gösterim. */
export function minutesToHoursLabel(minutes: number): string {
  const whole = Math.floor(minutes / 60);
  const frac = Math.round(((minutes % 60) / 60) * 100);
  return `${whole},${String(frac).padStart(2, "0")}`;
}

// ---------- Tarih yardımcıları ----------

export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function fmtDate(value: string | Date | undefined | null): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "long", year: "numeric" });
}

export function fmtDateTime(value: string | Date | undefined | null): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Bugünden hedef tarihe kalan tam gün sayısı (geçmişse negatif). */
export function daysUntil(value: string | Date): number {
  const d = typeof value === "string" ? new Date(value) : value;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/** Kalan güne göre aciliyet tonu: bugün/3 gün kırmızı, 7 gün sarı, sonrası yeşil. */
export function urgencyTone(days: number): BadgeTone {
  if (days <= 0) return "danger";
  if (days <= 3) return "red";
  if (days <= 7) return "yellow";
  return "green";
}

export function remainingLabel(days: number): string {
  if (days < 0) return `GECİKTİ · ${Math.abs(days)} gün`;
  if (days === 0) return "BUGÜN SON GÜN";
  if (days === 1) return "Yarın";
  return `${days} gün kaldı`;
}

/** Süre kartlarının kenarlık/arka plan tonu — listelerde satır boyama için. */
export function urgencyRowClass(days: number): string {
  if (days <= 0) return "border-l-4 border-l-red-600 bg-red-50/60";
  if (days <= 3) return "border-l-4 border-l-red-400 bg-red-50/40";
  if (days <= 7) return "border-l-4 border-l-amber-400 bg-amber-50/40";
  return "border-l-4 border-l-emerald-400";
}

export function fmtTime(value: string | Date | undefined | null): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

/** "Pazartesi, 02 Eylül 2026" — gün gruplaması başlıkları için. */
export function fmtDayHeading(value: string | Date | undefined | null): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("tr-TR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

/** datetime-local input değeri (yerel saat). */
export function toLocalInput(value: string | Date | undefined | null): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

/** Verilen tarihin içinde bulunduğu haftanın pazartesisi. */
export function startOfWeek(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  const day = copy.getDay(); // 0 = Pazar
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  return copy;
}

export function fmtMoney(
  value: string | number | null | undefined,
  currency = "TRY",
): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString("tr-TR", { style: "currency", currency, maximumFractionDigits: 2 });
}

/** KVKK: TCKN maskeli gösterim — 12345678901 → 123******01 */
export function maskTckn(value: string | null | undefined): string {
  if (!value) return "—";
  const v = value.trim();
  if (v.length < 6) return "•".repeat(v.length);
  return `${v.slice(0, 3)}${"*".repeat(Math.max(0, v.length - 5))}${v.slice(-2)}`;
}

/** Görev iş akışı sırası — ilerleme göstergesi için. */
export const TASK_WORKFLOW = [
  "ACIK",
  "DEVAM_EDIYOR",
  "KONTROLDE",
  "ONAY_BEKLIYOR",
  "TAMAMLANDI",
] as const;

export function taskProgress(status: string): number {
  const idx = TASK_WORKFLOW.indexOf(status as (typeof TASK_WORKFLOW)[number]);
  if (idx < 0) return 0;
  return Math.round((idx / (TASK_WORKFLOW.length - 1)) * 100);
}
