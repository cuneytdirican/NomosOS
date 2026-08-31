/**
 * Faz 6 tipleri — Kurumsal Raporlama (Modül 18 raporlama kesiti) ve Bildirimler.
 *
 * TASARIM: sunucu SavedReport/ReportRun kayıtlarında rapor RAKAMI SAKLAMAZ,
 * yalnız tanım/filtre/ölçüm tutar. Bu yüzden burada da "sonuç" (`ReportResult`)
 * ile "tanım" (`SavedReportItem`) kesin biçimde ayrılmıştır: kaydedilmiş bir
 * rapor açıldığında sonuç HER SEFERİNDE yeniden hesaplanır.
 */

import type { MetricDirection, ReportColumnType } from "@/lib/labels";

export type ReportScope = "KISISEL" | "BURO";
export type ReportFormat = "EKRAN" | "CSV" | "PDF";

// ---------------------------------------------------------------- katalog

/** Rapora özel filtre tanımı — alan listesi SUNUCUDAN gelir, koda gömülmez. */
export interface ReportFilterDef {
  key: string;
  label: string;
  type: "SECIM" | "METIN" | "TARIH" | "SAYI" | "BOOL";
  options: Array<{ value: string; label: string }>;
  defaultValue: string | null;
  hint: string | null;
}

/** Sonuç tablosunun bir sütunu. `direction` karşılaştırma renginin kaynağıdır. */
export interface ReportColumn {
  key: string;
  label: string;
  type: ReportColumnType;
  direction: MetricDirection;
  currency: string | null;
  /**
   * Satırın para birimini taşıyan HÜCRENİN anahtarı (sunucu bildirir).
   *
   * Çok para birimli tablolarda birim satırdan satıra değişir ve ayrı bir
   * sütunda durur; sabit `currency` alanı boştur. Bu alan olmadan istemcinin
   * tek seçeneği varsayılan birimi basmaktı ve USD satırları ₺ görünüyordu.
   */
  currencyKey: string | null;
  /** Toplam satırında bu sütun gösterilir mi? */
  total: boolean;
  hint: string | null;
}

export interface ReportCatalogItem {
  key: string;
  name: string;
  description: string | null;
  /** Gruplama başlığı: "Büro", "Finans", "Verimlilik", "Risk"… */
  category: string | null;
  columns: ReportColumn[];
  filters: ReportFilterDef[];
  /** Dönem seçici gösterilsin mi (anlık fotoğraf raporlarında false olabilir). */
  periodRequired: boolean;
  /** Önceki dönem karşılaştırması destekleniyor mu? */
  supportsComparison: boolean;
  supportsCsv: boolean;
  /**
   * AI yorumu için görev tipi (örn. `KPI_NARRATIVE`). null ise "AI ile yorumla"
   * düğmesi HİÇ gösterilmez — kredili bir düğmeyi çalışmayacağı yerde
   * göstermek, kullanıcıya boşa kredi harcatma daveti olurdu.
   */
  aiTaskType: string | null;
  /** Sunucunun bu kullanıcı için verdiği not (örn. "kendi dosyalarınız"). */
  scopeNote: string | null;
}

// ---------------------------------------------------------------- sonuç

export interface ReportPeriod {
  from: string;
  to: string;
  /** `to` günü dâhil mi? Ortak karar 2 gereği ekranda AÇIKÇA yazılır. */
  toInclusive: boolean;
  label: string | null;
}

/** Üst şeritteki özet ölçü (KPI) — önceki dönem farkıyla birlikte. */
export interface ReportMetric {
  key: string;
  label: string;
  type: ReportColumnType;
  direction: MetricDirection;
  currency: string | null;
  /** PARA tipinde sunucu Decimal string gönderir; sayıya ÇEVRİLMEZ. */
  value: string | number | null;
  previous: string | number | null;
  /** Mutlak fark (sayısal ölçülerde). Sunucu vermezse istemci türetir. */
  delta: number | null;
  /** Yüzde fark; payda 0 ise null (oran uydurulmaz). */
  deltaPercent: number | null;
  hint: string | null;
}

export interface ReportSeriesPoint {
  label: string;
  value: number;
  previous: number | null;
}

/** Basit görselleştirme verisi — CSS/SVG ile çizilir, grafik kütüphanesi yok. */
export interface ReportSeries {
  key: string;
  label: string;
  chart: "CUBUK" | "CIZGI";
  type: ReportColumnType;
  direction: MetricDirection;
  currency: string | null;
  points: ReportSeriesPoint[];
}

export type ReportRow = Record<string, unknown>;

export interface ReportResult {
  reportKey: string;
  title: string | null;
  period: ReportPeriod | null;
  previousPeriod: ReportPeriod | null;
  /**
   * Sunucunun döndürdüğü TÜM tabloların künyesi. Ekran bir seferde tek tablo
   * çizer; bu liste tablo seçicisini besler ve raporun geri kalanının
   * varlığını görünür kılar.
   */
  tables: ReportTableInfo[];
  /** Şu an gösterilen tablonun anahtarı (CSV de bu anahtarla iner). */
  tableKey: string | null;
  columns: ReportColumn[];
  rows: ReportRow[];
  totals: ReportRow | null;
  metrics: ReportMetric[];
  series: ReportSeries[];
  rowCount: number;
  durationMs: number | null;
  generatedAt: string | null;
  /** Sunucunun hesaba dair notu (ör. "STAJYER rolünde finans sütunları gizlendi"). */
  note: string | null;
}

/** Rapor çalıştırma parametreleri — `SavedReport.paramsJson` ile aynı şekil. */
export interface ReportParams {
  from?: string;
  to?: string;
  /** Kullanıcının seçtiği ön tanımlı dönem (özel aralıkta "OZEL"). */
  preset?: string;
  compare?: boolean;
  filters?: Record<string, string>;
  /**
   * Çok tablolu raporda ekranda gösterilen tablonun anahtarı.
   * Boşsa sunucunun `defaultTable`ı geçerlidir.
   */
  table?: string;
}

/**
 * Sonuçtaki bir tablo — künye VE veri.
 *
 * Sunucu raporun bütün tablolarını TEK yanıtta döndürür. Bu yüzden tablo
 * değiştirmek yeni bir istek DEĞİLDİR: aynı yanıttan başka bir tablo seçilir.
 * Her sekme için yeniden sorgu atmak hem gereksiz yük hem de her tıklamada bir
 * `ReportRun` denetim kaydı demekti — denetim izi "kim raporu çalıştırdı"yı
 * değil "kim kaç sekmeye tıkladı"yı anlatırdı.
 */
export interface ReportTableInfo {
  key: string;
  title: string;
  definition: string | null;
  /** Sunucu satır sınırını uyguladı mı — `totalRowCount` gerçek toplamdır. */
  truncated: boolean;
  totalRowCount: number | null;
  columns: ReportColumn[];
  rows: ReportRow[];
  totals: ReportRow | null;
}

// ---------------------------------------------------------------- kayıtlı rapor

export interface SavedReportItem {
  id: string;
  name: string;
  reportKey: string;
  params: ReportParams;
  scope: ReportScope;
  createdBy: string | null;
  createdByName: string | null;
  isPinned: boolean;
  /** Bu kaydı düzenleme/silme hakkı var mı (sunucu bildirir). */
  canEdit: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

// ---------------------------------------------------------------- AI yorumu

export interface ReportNarrative {
  /** Türkçe yönetici yorumu — RAKAM ÜRETMEZ, hazır rakamları yorumlar. */
  text: string;
  /** Yorumun dayandığı ölçü anahtarları (kaynak gösterme zorunluluğu). */
  basedOn: string[];
  model: string | null;
  createdAt: string | null;
}

// ---------------------------------------------------------------- bildirim

export type NotificationStatus = "BEKLIYOR" | "GONDERILDI" | "OKUNDU" | "IPTAL";

export interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  resourceType: string | null;
  resourceId: string | null;
  status: NotificationStatus;
  scheduledFor: string | null;
  sentAt: string | null;
  readAt: string | null;
  createdAt: string | null;
  /** `resourceType`/`resourceId` çözülebiliyorsa hedef ekran, değilse null. */
  href: string | null;
}

export interface NotificationFeed {
  items: NotificationItem[];
  unreadCount: number;
}
