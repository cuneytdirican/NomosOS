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

// =====================================================================
// Faz 4 — Strateji, Simülasyon, Risk, Delil, Bilirkişi, Çakışma
//
// EKLEME ONLY: bu bölümün üstündeki hiçbir sabit değiştirilmedi.
// =====================================================================

// ---------- Strateji Motoru (Modül 15) ----------

export const STRATEGY_STATUS_LABELS: Record<string, string> = {
  TASLAK: "Taslak",
  GUNCEL: "Güncel",
  BAYAT: "Güncellenmeli",
};

export const STRATEGY_STATUS_TONES: Record<string, BadgeTone> = {
  TASLAK: "gray",
  GUNCEL: "green",
  BAYAT: "yellow",
};

export const STRATEGY_NODE_TYPE_LABELS: Record<string, string> = {
  KARSI_ARGUMAN: "Karşı Taraf Argümanı",
  BIZIM_ARGUMAN: "Bizim Argümanımız",
  DELIL: "Delil",
  HUKUKI_DAYANAK: "Hukuki Dayanak",
  ZAYIF_NOKTA: "Zayıf Nokta",
  KARSI_CEVAP: "Karşı Cevap",
  SENARYO: "Alternatif Senaryo",
  RISK: "Risk Notu",
};

/**
 * Stratejinin 9 HALKALI ZİNCİRİ (Modül 15, "Amaç" bölümü).
 *
 * Zincirin ilk sekiz halkası `StrategyNodeType` enum'unun sekiz değeriyle
 * BİREBİR eşleşir. Dokuzuncu halka (`__RISK_SKORU`) bir düğüm tipi DEĞİLDİR:
 * risk skoru Risk Motoru'nun (Modül 17) deterministik çıktısıdır ve iş kuralı
 * gereği strateji üzerinden elle değiştirilemez. Bu yüzden ekranda ayrı bir
 * "özet halka" olarak, risk kartından okunarak gösterilir.
 */
export const STRATEGY_CHAIN = [
  { key: "KARSI_ARGUMAN", label: "Karşı Tarafın Argümanları" },
  { key: "BIZIM_ARGUMAN", label: "Bizim Argümanlarımız" },
  { key: "DELIL", label: "Deliller" },
  { key: "HUKUKI_DAYANAK", label: "Hukuki Dayanak" },
  { key: "ZAYIF_NOKTA", label: "Zayıf Noktalarımız" },
  { key: "KARSI_CEVAP", label: "Karşı Cevaplar" },
  { key: "SENARYO", label: "Alternatif Senaryolar" },
  { key: "RISK", label: "Risk Notları" },
  { key: "__RISK_SKORU", label: "Genel Risk Skoru" },
] as const;

export const STRATEGY_NODE_TYPES = STRATEGY_CHAIN.filter(
  (r) => !r.key.startsWith("__"),
).map((r) => r.key) as readonly string[];

/** Düğüm gücü — hem enum (DUSUK/ORTA/YUKSEK) hem 1–10 sayısı gelebilir. */
export const NODE_STRENGTH_LABELS: Record<string, string> = {
  DUSUK: "Zayıf",
  ORTA: "Orta",
  YUKSEK: "Güçlü",
  LOW: "Zayıf",
  MEDIUM: "Orta",
  HIGH: "Güçlü",
};

export const NODE_STRENGTH_TONES: Record<string, BadgeTone> = {
  DUSUK: "gray",
  ORTA: "yellow",
  YUKSEK: "green",
  LOW: "gray",
  MEDIUM: "yellow",
  HIGH: "green",
};

/** `strength` alanı serbest biçimlidir; ekranda tek biçime indirger. */
export function strengthLabel(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return `Güç ${value}/10`;
  const key = value.toUpperCase();
  return NODE_STRENGTH_LABELS[key] ?? value;
}

export function strengthTone(value: string | number | null | undefined): BadgeTone {
  if (value === null || value === undefined || value === "") return "gray";
  if (typeof value === "number") {
    if (value >= 8) return "green";
    if (value >= 5) return "yellow";
    return "gray";
  }
  return NODE_STRENGTH_TONES[value.toUpperCase()] ?? "gray";
}

// ---------- Simülasyon Modları (Modül 16) ----------

export const SIMULATION_MODES = [
  "KARSI_TARAF_AVUKATI",
  "HAKIM_GOZU",
  "KAYBETTIREN_HUSUSLAR",
  "KARSI_DILEKCE_ZAYIFLIK",
  "BILIRKISI_ODAGI",
] as const;

export type SimulationModeKey = (typeof SIMULATION_MODES)[number];

export const SIMULATION_MODE_LABELS: Record<string, string> = {
  KARSI_TARAF_AVUKATI: "Karşı Taraf Avukatı",
  HAKIM_GOZU: "Hakim Gözü",
  KAYBETTIREN_HUSUSLAR: "Kaybettiren Hususlar",
  KARSI_DILEKCE_ZAYIFLIK: "Karşı Dilekçe Zayıflıkları",
  BILIRKISI_ODAGI: "Bilirkişi Odağı",
};

export const SIMULATION_MODE_HINTS: Record<string, string> = {
  KARSI_TARAF_AVUKATI:
    "Karşı vekilin yerine geçer: bize karşı kurulabilecek en güçlü argümanları güç sırasıyla çıkarır.",
  HAKIM_GOZU:
    "Dosyayı önce usul (görev, husumet, süre), sonra esas yönünden değerlendirir. Kesin hüküm kurmaz.",
  KAYBETTIREN_HUSUSLAR:
    "Davayı kaybettirebilecek hususları olasılık ve önlem önerisiyle listeler.",
  KARSI_DILEKCE_ZAYIFLIK:
    "Karşı tarafın seçilen dilekçesindeki çelişki, dayanaksızlık ve usul açıklarını çıkarır.",
  BILIRKISI_ODAGI:
    "Bilirkişinin teknik olarak takılacağı noktaları ve delil durumumuzu raporlar.",
};

export const SIMULATION_MODE_TONES: Record<string, BadgeTone> = {
  KARSI_TARAF_AVUKATI: "red",
  HAKIM_GOZU: "navy",
  KAYBETTIREN_HUSUSLAR: "danger",
  KARSI_DILEKCE_ZAYIFLIK: "yellow",
  BILIRKISI_ODAGI: "blue",
};

export const SEVERITY_LABELS: Record<string, string> = {
  LOW: "Düşük",
  MED: "Orta",
  MEDIUM: "Orta",
  HIGH: "Yüksek",
  CRITICAL: "Kritik",
  DUSUK: "Düşük",
  ORTA: "Orta",
  YUKSEK: "Yüksek",
  KRITIK: "Kritik",
};

export const SEVERITY_TONES: Record<string, BadgeTone> = {
  LOW: "gray",
  MED: "yellow",
  MEDIUM: "yellow",
  HIGH: "red",
  CRITICAL: "danger",
  DUSUK: "gray",
  ORTA: "yellow",
  YUKSEK: "red",
  KRITIK: "danger",
};

export const LEANING_LABELS: Record<string, string> = {
  LEHIMIZE: "Lehimize eğilim",
  ALEYHIMIZE: "Aleyhimize eğilim",
  BELIRSIZ: "Belirsiz",
};

export const LEANING_TONES: Record<string, BadgeTone> = {
  LEHIMIZE: "green",
  ALEYHIMIZE: "red",
  BELIRSIZ: "gray",
};

export const WEAKNESS_TYPE_LABELS: Record<string, string> = {
  CELISKI: "Çelişki",
  DAYANAKSIZ: "Dayanaksız iddia",
  USUL: "Usul açığı",
  EKSIK_DELIL: "Eksik delil",
};

export const EVIDENCE_STATE_LABELS: Record<string, string> = {
  GUCLU: "Delilimiz güçlü",
  EKSIK: "Delilimiz eksik",
  YOK: "Delilimiz yok",
};

export const EVIDENCE_STATE_TONES: Record<string, BadgeTone> = {
  GUCLU: "green",
  EKSIK: "yellow",
  YOK: "red",
};

// ---------- Risk Motoru (Modül 17) ----------

/** GENEL en başta; ardından yedi boyut (kart düzeni buna göre kurulur). */
export const RISK_DIMENSIONS = [
  "GENEL",
  "HUKUKI",
  "SURE",
  "DELIL",
  "TAHSILAT",
  "USUL",
  "ICTIHAT",
  "KARSI_TARAF",
] as const;

export type RiskDimensionKey = (typeof RISK_DIMENSIONS)[number];

export const RISK_DIMENSION_LABELS: Record<string, string> = {
  GENEL: "Genel Risk",
  HUKUKI: "Hukuki Risk",
  SURE: "Süre Riski",
  DELIL: "Delil Riski",
  TAHSILAT: "Tahsilat Riski",
  USUL: "Usul Riski",
  ICTIHAT: "İçtihat Riski",
  KARSI_TARAF: "Karşı Taraf Riski",
};

export const RISK_DIMENSION_HINTS: Record<string, string> = {
  GENEL: "Boyutların ağırlıklı bileşkesi. Doğrudan yazılamaz, boyutlardan türer.",
  HUKUKI: "Esasa ilişkin zayıflıklar, aleyhe hukuki durum.",
  SURE: "Kaçırılmış veya yaklaşan süreler. Kaçırılmış süre bandı koşulsuz yükseltir.",
  DELIL: "Desteksiz veya tek delille duran iddiaların oranı.",
  TAHSILAT: "Alacağın tahsil edilebilirliği, malvarlığı ve gecikme.",
  USUL: "Görev, yetki, husumet, dava şartları.",
  ICTIHAT: "Yerleşik içtihadın dosya aleyhine olma ihtimali.",
  KARSI_TARAF: "Karşı vekilin usul stratejisi ve dosyadaki davranış örüntüsü.",
};

/**
 * RİSK BANDI TONLARI — `SCORE_BAND_TONES` İLE KARIŞTIRMAYIN.
 *
 * `SCORE_BAND_TONES` tahsilat İHTİMALİ içindir: orada YUKSEK = iyi (yeşil).
 * Riskte yön terstir: YUKSEK = kötü (kırmızı). Aynı enum adlarını taşıdıkları
 * için tek harita kullanılması, 🔴 bir dosyayı yeşil göstermeye yeterdi.
 */
export const RISK_BAND_LABELS: Record<string, string> = {
  DUSUK: "Düşük",
  ORTA: "Orta",
  YUKSEK: "Yüksek",
};

export const RISK_BAND_TONES: Record<string, BadgeTone> = {
  DUSUK: "green",
  ORTA: "yellow",
  YUKSEK: "danger",
};

export const RISK_BAND_DOTS: Record<string, string> = {
  DUSUK: "🟢",
  ORTA: "🟡",
  YUKSEK: "🔴",
};

export const RISK_BANDS = ["DUSUK", "ORTA", "YUKSEK"] as const;

/** Skor çubuğunun dolgu rengi (bant ile aynı yön). */
export const RISK_BAND_BARS: Record<string, string> = {
  DUSUK: "bg-emerald-500",
  ORTA: "bg-amber-500",
  YUKSEK: "bg-red-600",
};

/**
 * Bant EŞİKLERİ — 0–39 düşük, 40–69 orta, 70–100 yüksek (Modül 17).
 *
 * Bandı SUNUCU üretir; bu yardımcı yalnızca bandı gelmemiş bir satırı ekranda
 * boş bırakmamak içindir. Sunucudan gelen `band` her zaman önceliklidir.
 */
export function riskBandOf(score: number | null | undefined): string {
  if (score === null || score === undefined || Number.isNaN(score)) return "DUSUK";
  if (score >= 70) return "YUKSEK";
  if (score >= 40) return "ORTA";
  return "DUSUK";
}

export const RISK_SIGNAL_SOURCE_LABELS: Record<string, string> = {
  KURAL: "Kural",
  RULE: "Kural",
  AI: "AI",
};

// ---------- Delil Yönetimi (Modül 14) ----------

export const CLAIM_SIDES = ["BIZ", "KARSI_TARAF"] as const;

export const CLAIM_SIDE_LABELS: Record<string, string> = {
  BIZ: "Bizim iddiamız",
  KARSI_TARAF: "Karşı tarafın iddiası",
};

export const CLAIM_SIDE_TONES: Record<string, BadgeTone> = {
  BIZ: "navy",
  KARSI_TARAF: "red",
};

export const CLAIM_STATUSES = ["ACIK", "DESTEKLENIYOR", "ZAYIF", "CURUTULDU"] as const;

export const CLAIM_STATUS_LABELS: Record<string, string> = {
  ACIK: "Açık",
  DESTEKLENIYOR: "Destekleniyor",
  ZAYIF: "Zayıf",
  CURUTULDU: "Çürütüldü",
};

export const CLAIM_STATUS_TONES: Record<string, BadgeTone> = {
  ACIK: "blue",
  DESTEKLENIYOR: "green",
  ZAYIF: "yellow",
  CURUTULDU: "gray",
};

export const EVIDENCE_TYPES = [
  "BELGE",
  "FOTOGRAF",
  "VIDEO",
  "SES",
  "TANIK",
  "BILIRKISI",
  "KESIF",
  "DIGER",
] as const;

export const EVIDENCE_TYPE_LABELS: Record<string, string> = {
  BELGE: "Belge",
  FOTOGRAF: "Fotoğraf",
  VIDEO: "Video",
  SES: "Ses Kaydı",
  TANIK: "Tanık",
  BILIRKISI: "Bilirkişi",
  KESIF: "Keşif",
  DIGER: "Diğer",
};

export const EVIDENCE_TYPE_ICONS: Record<string, string> = {
  BELGE: "📄",
  FOTOGRAF: "🖼️",
  VIDEO: "🎬",
  SES: "🎧",
  TANIK: "🗣️",
  BILIRKISI: "🔬",
  KESIF: "📍",
  DIGER: "📎",
};

export const EVIDENCE_STATUSES = [
  "PLANLANAN",
  "TOPLANDI",
  "SUNULDU",
  "KABUL",
  "RED",
] as const;

export const EVIDENCE_STATUS_LABELS: Record<string, string> = {
  PLANLANAN: "Planlanan",
  TOPLANDI: "Toplandı",
  SUNULDU: "Sunuldu",
  KABUL: "Kabul edildi",
  RED: "Reddedildi",
};

export const EVIDENCE_STATUS_TONES: Record<string, BadgeTone> = {
  PLANLANAN: "gray",
  TOPLANDI: "blue",
  SUNULDU: "navy",
  KABUL: "green",
  RED: "red",
};

// ---------- Bilirkişi (Modül 13) ----------

export const EXPERT_REPORT_TYPES = ["ASIL", "EK", "UZMAN_MUTALAASI"] as const;

export const EXPERT_REPORT_TYPE_LABELS: Record<string, string> = {
  ASIL: "Kök Rapor",
  EK: "Ek Rapor",
  UZMAN_MUTALAASI: "Uzman Mütalaası",
};

export const EXPERT_REPORT_TYPE_TONES: Record<string, BadgeTone> = {
  ASIL: "navy",
  EK: "blue",
  UZMAN_MUTALAASI: "gold",
};

export const OBJECTION_STATUS_LABELS: Record<string, string> = {
  TASLAK: "Taslak",
  SUNULDU: "Sunuldu",
  KABUL: "Kabul",
  RED: "Red",
};

export const OBJECTION_STATUS_TONES: Record<string, BadgeTone> = {
  TASLAK: "gray",
  SUNULDU: "blue",
  KABUL: "green",
  RED: "red",
};

/** İki rapor arasındaki değişimin yönü (AI fark tablosu). */
export const DIFF_DIRECTION_LABELS: Record<string, string> = {
  LEHIMIZE: "Lehimize değişti",
  ALEYHIMIZE: "Aleyhimize değişti",
  DEGISMEDI: "Değişmedi",
  YENI: "Yeni tespit",
  KALDIRILDI: "Kaldırıldı",
};

export const DIFF_DIRECTION_TONES: Record<string, BadgeTone> = {
  LEHIMIZE: "green",
  ALEYHIMIZE: "red",
  DEGISMEDI: "gray",
  YENI: "yellow",
  KALDIRILDI: "gray",
};

// ---------- Çakışma / Conflict Check (Modül 11) ----------

export const CONFLICT_RESULTS = ["TEMIZ", "DIKKAT", "CAKISMA"] as const;

export const CONFLICT_RESULT_LABELS: Record<string, string> = {
  TEMIZ: "Temiz",
  DIKKAT: "Dikkat",
  CAKISMA: "Çakışma ihtimali",
};

export const CONFLICT_RESULT_TONES: Record<string, BadgeTone> = {
  TEMIZ: "green",
  DIKKAT: "yellow",
  CAKISMA: "danger",
};

export const CONFLICT_RESULT_DOTS: Record<string, string> = {
  TEMIZ: "🟢",
  DIKKAT: "🟡",
  CAKISMA: "🔴",
};

export const CONFLICT_DECISIONS = ["DEVAM", "REDDEDILDI", "BEKLEMEDE"] as const;

export const CONFLICT_DECISION_LABELS: Record<string, string> = {
  DEVAM: "Devam edildi",
  REDDEDILDI: "İş reddedildi",
  BEKLEMEDE: "Beklemede",
};

export const CONFLICT_DECISION_TONES: Record<string, BadgeTone> = {
  DEVAM: "green",
  REDDEDILDI: "red",
  BEKLEMEDE: "yellow",
};

export const CONFLICT_MATCH_TYPE_LABELS: Record<string, string> = {
  MEVCUT_MUVEKKIL: "Mevcut müvekkil",
  KARSI_TARAF: "Karşı taraf",
  ESKI_MUVEKKIL: "Eski müvekkil",
  BAGLI_SIRKET: "Bağlı şirket",
  DOSYADA_GECEN: "Dosyada geçen taraf",
  BENZER_AD: "Benzer ad",
};

export const CONFLICT_MATCH_TYPE_TONES: Record<string, BadgeTone> = {
  MEVCUT_MUVEKKIL: "blue",
  KARSI_TARAF: "danger",
  ESKI_MUVEKKIL: "yellow",
  BAGLI_SIRKET: "gold",
  DOSYADA_GECEN: "navy",
  BENZER_AD: "gray",
};

/** Benzerlik 0–1 ya da 0–100 gelebilir; ikisini de yüzdeye çevirir. */
export function similarityPercent(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return null;
  const pct = n <= 1 ? n * 100 : n;
  return Math.max(0, Math.min(100, Math.round(pct)));
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
