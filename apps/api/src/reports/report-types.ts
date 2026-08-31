/**
 * KURUMSAL RAPORLAMA — ORTAK TİPLER.
 *
 * ╔════════════════════════════════════════════════════════════════════════╗
 * ║  BU MODÜLDEKİ HER RAKAM VERİTABANINDAN GELİR VE DETERMİNİSTİKTİR.      ║
 * ║  Dil modeli rapor rakamı ÜRETMEZ; yalnızca hazır rakamları yorumlar    ║
 * ║  (bkz. reports-ai.service.ts — yer tutuculu şablon + uydurma kapısı).  ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 *
 * TASARIM: her rapor bir "builder" fonksiyonudur (`ReportBuilder`). Builder
 * yalnız ÖLÇÜM üretir; rol kapısı, dönem çözümü, satır sınırı, denetim kaydı
 * (`ReportRun`) ve CSV dönüşümü çerçevede (reports.service.ts) tek yerde durur.
 * Böylece yeni bir rapor eklemek için güvenlik/denetim kodu KOPYALANMAZ.
 */

import type { PrismaService } from "../prisma/prisma.service";
import type { AuthUser } from "../common/types";

/* ══════════════════════════════════════════════════════════════════════ *
 * Dönem
 * ══════════════════════════════════════════════════════════════════════ */

export const PERIOD_PRESETS = [
  "BUGUN",
  "BU_HAFTA",
  "BU_AY",
  "GECEN_AY",
  "SON_7_GUN",
  "SON_30_GUN",
  "SON_90_GUN",
  "BU_CEYREK",
  "BU_YIL",
  "GECEN_YIL",
  "OZEL",
] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

/**
 * Rapor dönemi — SINIRLARI AÇIKÇA BELİRTİLİR (ortak karar 2).
 *
 * `from` ve `to` DAHİLDİR; `endExclusive` sorgu üst sınırıdır ve HARİÇTİR.
 * Sorgular daima `{ gte: from, lt: endExclusive }` kalıbını kullanır — böylece
 * gün sonu saat bileşeni taşıyan kayıtlar (14:30 duruşması) sonuçtan düşmez ve
 * `lte: endOfDay` ile milisaniye sınırı kovalamak gerekmez.
 */
export interface ReportPeriod {
  /** Dönem ilk günü, UTC gün başı — DAHİL. */
  from: Date;
  /** Dönem SON GÜNÜ, UTC gün başı — DAHİL. */
  to: Date;
  /** Sorgu üst sınırı (`to` + 1 gün), UTC gün başı — HARİÇ. */
  endExclusive: Date;
  /** Dönemin gün sayısı (from..to arası, iki uç dâhil). */
  days: number;
  preset: PeriodPreset;
  /** "01.08.2026 – 31.08.2026 (bitiş dâhil)" */
  label: string;
  /**
   * Kullanıcı `donemBitisDahil=false` gönderdi mi. Alan YANITA ÇIKAR: raporun
   * kapanış gününü sayıp saymadığı okuyucunun tahminine bırakılmaz.
   */
  endInclusive: boolean;
}

/* ══════════════════════════════════════════════════════════════════════ *
 * Sonuç yapıları
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Hücre tipi — sunum ve CSV biçimlendirmesi buna bakar.
 *
 *   money   → değer STRING'dir ("1234.56"); Decimal aritmetiğinden `moneyOut`
 *             ile çıkar. Sayıya ÇEVRİLMEZ (kuruş kaybı riski).
 *   percent → number, 0-100 aralığında oran.
 *   minutes → number, tamsayı dakika (saate çevrim yalnız sunumda).
 *   date    → ISO tarih STRING'i ("2026-08-31") veya null.
 */
export type ReportCellType = "text" | "number" | "money" | "percent" | "date" | "minutes";

export type ReportCell = string | number | null;

export interface ReportColumn {
  key: string;
  label: string;
  type: ReportCellType;
  /** Para sütunlarında birim (satır bazında değişiyorsa `currencyKey` kullanılır). */
  currency?: string;
  /**
   * SATIR BAZINDA PARA BİRİMİ TAŞIYAN HÜCRENİN ANAHTARI.
   *
   * Çok para birimli tablolarda (yaşlandırma matrisi, kârlılık, icra ayrıntısı)
   * birim satırdan satıra değişir ve ayrı bir sütunda taşınır. İstemci bunu
   * bilmediği sürece her para hücresini varsayılan birimle basar: "Para birimi:
   * USD" yazan satırın tutarı ekranda "120.000,00 ₺" görünürdü — okuyan ortak
   * 120 bin TL alacak sanır, gerçek karşılık ~4,2 milyon TL'dir (denetim
   * bulgusu 10). Sunucu birimi NEREDE bulacağını söyler; istemci tahmin etmez.
   */
  currencyKey?: string;
  /** Sütun yalnız bu rolleri taşıyan kullanıcıya gösterilir (sunucuda süzülür). */
  restricted?: boolean;
}

export interface ReportTable {
  key: string;
  title: string;
  /** Tablonun ne saydığını tarif eden tek cümle — CSV başlığına da yazılır. */
  definition?: string;
  columns: ReportColumn[];
  rows: Record<string, ReportCell>[];
  /** Satır sınırına takıldıysa true; `totalRowCount` gerçek toplamı verir. */
  truncated?: boolean;
  totalRowCount?: number;
  /**
   * `totalRowCount` GERÇEK TOPLAM MI, yoksa yalnız getirilen satır sayısı mı.
   *
   * `false` olduğunda sorgu kendi `LIMIT`'ine dayanmıştır: geride daha fazlası
   * vardır ama kaç olduğu SAYILMAMIŞTIR. Uydurulmuş bir "toplam", kırpmayı
   * gizlemekten daha kötüdür — okuyucu yanlış bir sayıya güvenir.
   */
  totalRowCountExact?: boolean;
}

/** KPI kartı — dönem ve önceki dönem karşılaştırmasıyla. */
export interface ReportMetric {
  key: string;
  label: string;
  type: ReportCellType;
  value: ReportCell;
  currency?: string;
  /** Önceki dönemin aynı ölçüsü (karşılaştırma kapalıysa yok). */
  previous?: ReportCell;
  /** value − previous (money'de string, sayısalda number). */
  delta?: ReportCell;
  /** Yüzde değişim; önceki dönem 0 ise null (sıfıra bölme UYDURULMAZ). */
  deltaPercent?: number | null;
  /** Bu ölçünün büyümesi iyi mi kötü mü — arayüz oku bunu kullanır. */
  higherIsBetter?: boolean;
  /** Büronun en kritik metrikleri (kaçırılan süre) ayrı vurgulanır. */
  critical?: boolean;
  /** Ölçünün tanımı — "tamamlanan görev" gibi belirsiz ifadeler açıklanır. */
  definition?: string;
}

/** Builder'ın döndürdüğü ham gövde (çerçeve üst bilgiyi ekler). */
export interface ReportBody {
  metrics?: ReportMetric[];
  tables: ReportTable[];
  /** Raporun okunma biçimine dair kalıcı notlar (ör. "performans aracı değildir"). */
  notes?: string[];
  /** Bu çalıştırmaya özgü uyarılar (satır sınırı, eksik saatlik ücret vb.). */
  warnings?: string[];
  /** Rol nedeniyle gizlenen bölümler — sunucu kararı, kullanıcıya bildirilir. */
  hiddenSections?: string[];
}

export interface ReportResult extends ReportBody {
  key: string;
  name: string;
  description: string;
  generatedAt: Date;
  period: ReportPeriod;
  /** Karşılaştırma dönemi (istenmişse ve rapor destekliyorsa). */
  comparisonPeriod?: ReportPeriod;
  /**
   * Ekranda ve CSV'de VARSAYILAN olarak gösterilecek tablonun anahtarı.
   *
   * Katalogda da vardır ama SONUÇTA DA döner: istemci raporu kataloğu
   * beklemeden çizebilmeli ve `?tablo=` verilmeden indirilen CSV ile ekrandaki
   * tablo AYNI olmalıdır. Alan olmasaydı istemcinin tek seçeneği "ilk tabloyu
   * göster" olurdu; tablo sırası bir gün değişirse ekran ile dosya sessizce
   * ayrışırdı.
   */
  defaultTable?: string;
  /** Tüm tablolardaki satır sayısı toplamı — `ReportRun.rowCount`. */
  rowCount: number;
  durationMs: number;
  /** Sözleşme beyanı: bu raporun tüm rakamları veritabanından hesaplandı. */
  deterministic: true;
  /** Raporu çalıştıran kullanıcının rolü (denetlenebilirlik). */
  runByRole: string;
}

/* ══════════════════════════════════════════════════════════════════════ *
 * Builder sözleşmesi
 * ══════════════════════════════════════════════════════════════════════ */

/** Çözülmüş, doğrulanmış rapor parametreleri. */
export interface ResolvedReportParams {
  period: ReportPeriod;
  comparison?: ReportPeriod;
  /** Satır üst sınırı (çerçeve uygular, builder da kendi sorgusunda kullanır). */
  limit: number;
  /** Tek kullanıcıya daraltma (iş yükü / AI kullanımı raporlarında). */
  userId?: string;
  clientId?: string;
  caseType?: string;
  /** Yaşlandırma kovaları (gün). Varsayılan [30, 60, 90]. */
  agingBuckets: number[];
  /** Ham parametreler — `ReportRun.paramsJson` ve `SavedReport` bu değeri saklar. */
  raw: Record<string, unknown>;
}

export interface ReportContext {
  user: AuthUser;
  prisma: PrismaService;
  params: ResolvedReportParams;
  /** Çalıştırma anı — tüm "bugün" hesapları BU değerden türer (test edilebilirlik). */
  now: Date;
}

export type ReportBuilder = (ctx: ReportContext) => Promise<ReportBody>;
