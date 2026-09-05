/**
 * FAZ 8E — veri göçü sihirbazı (dosya / duruşma / belge). Tek kaynak: kolon sözleşmesi,
 * şablonlar ve rotalar; API ayrıştırır ve önizler, web sihirbazı gösterir.
 *
 * İLKELER
 *  - Önizleme (dry-run) hiçbir şey yazmaz; her satır EKLE / ATLA / HATA olarak işaretlenir.
 *  - Çalıştırma yalnız ONAY rolü (ADMIN/PARTNER); önizlemedeki planı uygular.
 *  - Ayırıcı otomatik (; , sekme); başlıklar Türkçe/İngilizce, büyük-küçük ve aksan bağımsız.
 */

export const IMPORT_KINDS = ["dosyalar", "durusmalar", "belgeler"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export interface ImportColumnSpec {
  key: string;
  /** Başlık takma adları (normalize edilmiş: küçük harf, aksansız, boşluk → _). */
  aliases: readonly string[];
  required?: boolean;
  description: string;
  example: string;
}

export const IMPORT_COLUMNS: Record<ImportKind, readonly ImportColumnSpec[]> = {
  dosyalar: [
    { key: "muvekkil", aliases: ["muvekkil", "muvekkil_adi", "client", "client_name"], required: true, description: "Müvekkil adı; bulunamazsa gerçek kişi olarak oluşturulur.", example: "Ayşe Yılmaz" },
    { key: "baslik", aliases: ["baslik", "dosya_basligi", "title"], required: true, description: "Dosya başlığı (en az 3 karakter).", example: "Yılmaz – işe iade davası" },
    { key: "tur", aliases: ["tur", "dosya_turu", "type"], description: "DAVA | ICRA | ARABULUCULUK | CEZA | DANISMANLIK (boşsa DAVA).", example: "DAVA" },
    { key: "durum", aliases: ["durum", "status"], description: "ACIK | DERDEST | KARAR | ISTINAF | TEMYIZ | KESINLESTI | ICRADA | KAPANDI (boşsa ACIK).", example: "DERDEST" },
    { key: "mahkeme", aliases: ["mahkeme", "mahkeme_adi", "court", "court_name"], description: "Mahkeme / icra dairesi adı.", example: "İstanbul 12. İş Mahkemesi" },
    { key: "esas_no", aliases: ["esas_no", "esas", "dosya_no", "file_number", "case_number"], description: "Esas numarası; duruşma/belge eşlemede anahtar.", example: "2025/1234" },
    { key: "konu", aliases: ["konu", "dava_konusu", "subject"], description: "Dava / takip konusu.", example: "İşe iade ve boşta geçen süre ücreti" },
    { key: "sorumlu_eposta", aliases: ["sorumlu_eposta", "sorumlu", "responsible_email", "lawyer_email"], description: "Sorumlu avukatın büro e-postası (bulunamazsa boş kalır).", example: "avukat@buro.av.tr" },
  ],
  durusmalar: [
    { key: "esas_no", aliases: ["esas_no", "esas", "dosya_no", "file_number", "case_number"], description: "Dosya eşleme anahtarı (esas no) — yoksa dosya_baslik kullanılır.", example: "2025/1234" },
    { key: "dosya_baslik", aliases: ["dosya_baslik", "dosya", "baslik", "case_title"], description: "Esas no yoksa dosya başlığıyla eşleme.", example: "Yılmaz – işe iade davası" },
    { key: "tarih", aliases: ["tarih", "durusma_tarihi", "date"], required: true, description: "GG.AA.YYYY [SS:DD] ya da ISO (2026-03-12T09:30).", example: "12.03.2026 09:30" },
    { key: "tur", aliases: ["tur", "durusma_turu", "type"], description: "DURUSMA | ON_INCELEME | KESIF | E_DURUSMA | MUZAKERE | DIGER (boşsa DURUSMA).", example: "DURUSMA" },
    { key: "durum", aliases: ["durum", "status"], description: "PLANLANDI | YAPILDI | ERTELENDI | IPTAL (boşsa: geçmiş tarih → YAPILDI, gelecek → PLANLANDI).", example: "PLANLANDI" },
    { key: "salon", aliases: ["salon", "durusma_salonu", "courtroom"], description: "Duruşma salonu.", example: "3. Salon" },
    { key: "not", aliases: ["not", "notlar", "note", "aciklama"], description: "Ara karar / sonuç özeti.", example: "Tanık dinlenecek" },
  ],
  belgeler: [
    { key: "dosya_yolu", aliases: ["dosya_yolu", "yol", "path", "file", "dosya_adi"], required: true, description: "ZIP içindeki yol (ör. 2025-1234/vekaletname.pdf).", example: "2025-1234/vekaletname.pdf" },
    { key: "esas_no", aliases: ["esas_no", "esas", "dosya_no", "file_number", "case_number"], description: "Bağlanacak dosyanın esas numarası (yoksa ZIP klasör adı denenir).", example: "2025/1234" },
    { key: "dosya_baslik", aliases: ["dosya_baslik", "dosya", "case_title"], description: "Esas no yoksa dosya başlığı.", example: "Yılmaz – işe iade davası" },
    { key: "ad", aliases: ["ad", "belge_adi", "name"], description: "Görünen belge adı (boşsa dosya adı).", example: "Vekaletname" },
    { key: "sinif", aliases: ["sinif", "belge_sinifi", "class"], description: "Belge sınıfı (DILEKCE, KARAR, VEKALETNAME, ...); boşsa hat sınıflandırır.", example: "VEKALETNAME" },
  ],
};

export const IMPORT_KIND_LABELS: Record<ImportKind, string> = {
  dosyalar: "Dosyalar (davalar / takipler)",
  durusmalar: "Duruşmalar",
  belgeler: "Belgeler (ZIP + belgeler.csv)",
};

/** Şablon CSV — başlık satırı + örnek satır (noktalı virgül). */
export function importTemplateCsv(kind: ImportKind): string {
  const cols = IMPORT_COLUMNS[kind];
  return `${cols.map((c) => c.key).join(";")}\n${cols.map((c) => c.example).join(";")}\n`;
}

export type ImportRowAction = "EKLE" | "ATLA" | "HATA";

export interface ImportRowPreview {
  row: number;
  action: ImportRowAction;
  /** Kısa özet (örn. dosya başlığı). */
  label: string;
  /** Uyarı/hata mesajları (ATLA/HATA gerekçesi, EKLE için ek işlem notu). */
  notes: string[];
}

export interface ImportPreviewResult {
  kind: ImportKind;
  delimiter: string;
  headers: string[];
  /** Tanınmayan başlıklar (yok sayılır). */
  unknownHeaders: string[];
  missingRequired: string[];
  total: number;
  ekle: number;
  atla: number;
  hata: number;
  rows: ImportRowPreview[];
}

export interface ImportRunResult extends ImportPreviewResult {
  created: number;
  failed: number;
}

export const IMPORT_ROUTES = {
  preview: "/import/preview",
  run: "/import/run",
  zip: "/import/zip",
  template: (kind: ImportKind) => `/import/template/${kind}`,
} as const;

/** Tek istekte satır tavanı (CSV) ve ZIP içi belge tavanı. */
export const IMPORT_MAX_ROWS = 2000;
export const IMPORT_MAX_ZIP_FILES = 300;
