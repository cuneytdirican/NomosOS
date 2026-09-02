/**
 * Faz 6 API istemcisi — Kurumsal Raporlama + Bildirim Merkezi.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ UÇ SÖZLEŞMESİ                                                            ║
 * ║                                                                          ║
 * ║ Faz 6 sunucu tarafı (apps/api/src/reports/**, apps/api/src/scheduler/**) ║
 * ║ bu dosyayla EŞ ZAMANLI yazılıyor. Aşağıdaki yol tablosu, arayüzün        ║
 * ║ beklediği sözleşmenin TEK ve açık beyanıdır; uçlar yayına girdiğinde     ║
 * ║ değişmesi gereken tek yer burasıdır.                                     ║
 * ║                                                                          ║
 * ║   GET    /reports/catalog             → rol süzgecinden geçmiş katalog   ║
 * ║   GET    /reports/:key?from=&to=…     → deterministik sonuç              ║
 * ║   GET    /reports/:key/export         → ?format=csv&tablo=&… → text/csv  ║
 * ║   GET    /reports/saved               → kayıtlı rapor TANIMLARI          ║
 * ║   POST   /reports/saved               → tanım oluştur ({ params } NESNE) ║
 * ║   PATCH  /reports/saved/:id           → ad / sabitleme / kapsam          ║
 * ║   DELETE /reports/saved/:id                                              ║
 * ║   POST   /reports/:key/interpret      → KREDİLİ Türkçe yorum             ║
 * ║   GET    /notifications               → ?status=&limit=                  ║
 * ║   GET    /notifications/unread-count  → { unreadCount }                  ║
 * ║   PATCH  /notifications/:id/read                                         ║
 * ║   POST   /notifications/read-all                                         ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ENTEGRASYON NOTU (Faz 6 birleştirme): bu tablo, arayüz ile sunucu ayrı ayrı
 * yazıldığı için ilk hâlinde SUNUCUYLA UYUŞMUYORDU (`POST /:key/run`,
 * `compare`, `f_<filtre>`, `paramsJson`, `POST /:id/read`). Sözleşmenin tek
 * doğrusu SUNUCUDUR — uçlar denetim kaydı (`ReportRun`), rol kapısı ve 61
 * testle oradadır. Bu dosya sunucuya uyarlandı; sunucuya "uyumluluk takma
 * adı" EKLENMEDİ, çünkü iki adresli bir uç ikinci bir sözleşme demektir.
 *
 * SORGU DİZESİ SÖZLEŞMESİ (hem çalıştırma hem CSV aynı):
 *   /reports/:key?from=2026-08-01&to=2026-08-31&karsilastir=true&<filtre>=<değer>
 * Filtre adları DÜZ geçer (önek yok): sunucu `format`/`tablo`/`meta` dışındaki
 * her sorgu alanını rapor parametresi sayar (bkz. `extractParams`).
 *
 * ÇOK TABLOLU RAPOR: sunucu `tables[]` döndürür (örn. duruşma takviminde
 * duruşmalar + avukat + mahkeme + durum kırılımı). Ekran bir seferde TEK
 * tablo gösterir; hangisi olduğu `tableKey` ile açıkça yazılır ve CSV aynı
 * tabloyu `?tablo=` ile indirir — ekranda görünen ile inen dosya AYNI olur.
 *
 * YEDEK YOL YOKTUR (Faz 2 dersi). Tek uç denenir. Gövdesiz 404/405/501 "uç
 * henüz yayında değil" olarak ayrılır (`isFeatureMissing`) ve ekran bilgilendirme
 * kartına düşer; Türkçe mesajlı 404 GERÇEK hatadır ve olduğu gibi gösterilir.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ RAPORLAR DETERMİNİSTİKTİR (ortak karar 1)                                ║
 * ║                                                                          ║
 * ║ Bu dosyada RAKAM ÜRETEN TEK BİR SATIR YOKTUR. Toplamlar, farklar ve      ║
 * ║ yüzdeler sunucudan gelir. `deriveDelta` yalnızca sunucu farkı HİÇ        ║
 * ║ göndermediğinde ve iki DEĞER de elde varken çıkarma yapar — bu bir       ║
 * ║ gösterim yardımıdır, hesap değil; para alanlarında ise kuruş aritmetiği  ║
 * ║ (`toKurus`) kullanılır, float'a asla düşülmez.                           ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import { API_BASE, ApiError, api, asList } from "@/lib/api";
import { isMissingEndpoint } from "@/lib/faz2";
import { toKurus } from "@/lib/money";
import { metricDirection, notificationHref, type ReportColumnType } from "@/lib/labels";
import type {
  NotificationFeed,
  NotificationItem,
  NotificationStatus,
  ReportCatalogItem,
  ReportColumn,
  ReportFilterDef,
  ReportMetric,
  ReportNarrative,
  ReportParams,
  ReportPeriod,
  ReportResult,
  ReportRow,
  ReportScope,
  ReportSeries,
  ReportTableInfo,
  SavedReportItem,
} from "./faz6-types";

// ------------------------------------------------------------ yol tablosu

export const FAZ6_ROUTES = {
  reportCatalog: "/reports/catalog",
  reportRun: (key: string) => `/reports/${encodeURIComponent(key)}`,
  reportExport: (key: string) => `/reports/${encodeURIComponent(key)}/export`,
  reportInterpret: (key: string) => `/reports/${encodeURIComponent(key)}/interpret`,
  savedReports: "/reports/saved",
  savedReport: (id: string) => `/reports/saved/${id}`,

  notifications: "/notifications",
  notificationsUnread: "/notifications/unread-count",
  notificationRead: (id: string) => `/notifications/${id}/read`,
  notificationsReadAll: "/notifications/read-all",
} as const;

/** Uç henüz yayında değil mi? (gövdesiz 404 / 405 / 501 ya da ağ kopukluğu) */
export function isFeatureMissing(err: unknown): boolean {
  return isMissingEndpoint(err);
}

/**
 * ROL KISITI HATASI MI? (403)
 *
 * NEDEN AYRI: STAJYER finans raporlarını, SEKRETER kârlılık/verimlilik
 * raporlarını göremez ve bu kısıt SUNUCUDA uygulanır. Bunu "özellik hazır
 * değil" diye göstermek yanlış olurdu — kullanıcının bilmesi gereken şey,
 * raporun VAR olduğu ama kendisine KAPALI olduğudur.
 */
export function isForbidden(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403;
}

export const FORBIDDEN_REPORT_TEXT =
  "Bu rapor rolünüze kapalıdır. Rapor yetkisi sunucuda uygulanır; " +
  "erişim gerekiyorsa büro yöneticinizden rol değişikliği isteyin.";

// ------------------------------------------------------------ yardımcılar

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** `paramsJson`/`detailJson` proje konvansiyonu gereği JSON METNİDİR. */
function parseJson(value: unknown): unknown {
  if (typeof value === "string") {
    const t = value.trim();
    if (!t) return null;
    try {
      return JSON.parse(t) as unknown;
    } catch {
      return null;
    }
  }
  return value ?? null;
}

const COLUMN_TYPES: readonly string[] = ["METIN", "SAYI", "PARA", "YUZDE", "TARIH", "SURE_DK"];

function columnType(value: unknown): ReportColumnType {
  const v = str(value)?.toUpperCase() ?? "";
  if (COLUMN_TYPES.includes(v)) return v as ReportColumnType;
  // Sunucu İngilizce/kısa yazabilir.
  switch (v) {
    case "NUMBER":
    case "INT":
    case "COUNT":
      return "SAYI";
    case "MONEY":
    case "DECIMAL":
    case "CURRENCY":
      return "PARA";
    case "PERCENT":
    case "RATIO":
      return "YUZDE";
    case "DATE":
    case "DATETIME":
      return "TARIH";
    case "MINUTES":
    case "DURATION":
      return "SURE_DK";
    default:
      return "METIN";
  }
}

function toColumn(raw: unknown): ReportColumn {
  const o = obj(raw);
  const key = str(o.key) ?? str(o.field) ?? str(o.name) ?? "";
  const label = str(o.label) ?? str(o.title) ?? key;
  return {
    key,
    label,
    type: columnType(o.type ?? o.dataType ?? o.kind),
    direction: metricDirection(key, label, str(o.direction) ?? str(o.goodDirection)),
    currency: str(o.currency),
    // Sunucu satır bazlı para biriminin HANGİ hücrede olduğunu söyler; istemci
    // tahmin etmez ve bilinmiyorsa sembol basmaz (bkz. faz6-format.ts).
    currencyKey: str(o.currencyKey),
    total: bool(o.total ?? o.summable ?? o.aggregate),
    hint: str(o.hint) ?? str(o.description),
  };
}

function toFilterDef(raw: unknown): ReportFilterDef {
  const o = obj(raw);
  const rawType = (str(o.type) ?? "METIN").toUpperCase();
  const type: ReportFilterDef["type"] =
    rawType === "SECIM" || rawType === "SELECT" || rawType === "ENUM"
      ? "SECIM"
      : rawType === "TARIH" || rawType === "DATE"
        ? "TARIH"
        : rawType === "SAYI" || rawType === "NUMBER"
          ? "SAYI"
          : rawType === "BOOL" || rawType === "BOOLEAN"
            ? "BOOL"
            : "METIN";

  return {
    key: str(o.key) ?? str(o.name) ?? "",
    label: str(o.label) ?? str(o.title) ?? str(o.key) ?? "Filtre",
    type,
    options: asList<unknown>(o.options ?? o.choices).map((opt) => {
      if (typeof opt === "string") return { value: opt, label: opt };
      const oo = obj(opt);
      const value = str(oo.value) ?? str(oo.key) ?? "";
      return { value, label: str(oo.label) ?? str(oo.name) ?? value };
    }),
    defaultValue: str(o.defaultValue) ?? str(o.default),
    hint: str(o.hint) ?? str(o.description),
  };
}

// ------------------------------------------------------------ A) katalog

/**
 * Dönem alanları FİLTRE DEĞİLDİR.
 *
 * Sunucu kataloğu tek bir `params[]` listesi döndürür ve dönem alanları da
 * onun içindedir. Araç çubuğunun zaten bir dönem seçicisi var; bu alanlar
 * ayıklanmasa kullanıcı aynı ekranda İKİ dönem kontrolü görür ve hangisinin
 * geçerli olduğunu bilemezdi.
 */
const PERIOD_PARAM_KEYS = new Set(["donem", "from", "to", "donemBitisDahil", "karsilastir"]);

function toCatalogItem(raw: unknown): ReportCatalogItem {
  const o = obj(raw);
  const columns = asList<unknown>(o.columns ?? o.fields).map(toColumn);
  return {
    key: str(o.key) ?? str(o.reportKey) ?? "",
    name: str(o.name) ?? str(o.title) ?? str(o.key) ?? "Rapor",
    description: str(o.description) ?? str(o.summary),
    category: str(o.category) ?? str(o.group),
    columns,
    filters: asList<unknown>(o.filters ?? o.params)
      .map(toFilterDef)
      .filter((f) => f.key !== "" && !PERIOD_PARAM_KEYS.has(f.key)),
    // Dönemsiz rapor istisnadır: sunucu açıkça `false` demedikçe dönem sorulur.
    periodRequired: o.periodRequired === false ? false : true,
    supportsComparison: o.supportsComparison === false ? false : true,
    supportsCsv: o.supportsCsv === false ? false : true,
    // Yorum görev tipi katalogda taşınmıyorsa sabittir: uç
    // `@AiCredits("REPORT_INTERPRET")` ile sarmalıdır ve kredi rozeti bu
    // anahtarın fiyatını gösterir. Boş bırakmak rozeti düşürür, kullanıcı
    // düğmeye basmadan kaç kredi harcayacağını göremezdi.
    aiTaskType: str(o.aiTaskType) ?? str(o.narrativeTaskType) ?? "REPORT_INTERPRET",
    // Sunucunun `notes[]` dizisi tanım uyarılarıdır (referans günü, para
    // birimi toplanmaması gibi) — ekranda raporun altına yazılır.
    scopeNote:
      str(o.scopeNote) ??
      str(
        asList<unknown>(o.notes)
          .map((n) => str(n))
          .filter((n): n is string => Boolean(n))
          .join(" · "),
      ) ??
      str(o.note),
  };
}

/**
 * Rapor kataloğu.
 *
 * SÜZGEÇ SUNUCUDADIR: kullanıcının rolüne kapalı raporlar bu listeye HİÇ
 * girmez (STAJYER finans, SEKRETER kârlılık/verimlilik). Arayüz ayrıca
 * gizleme yapmaz — istemcide gizlemek yetki değil, dekordur.
 */
export function fetchReportCatalog(): Promise<ReportCatalogItem[]> {
  return api<unknown>(FAZ6_ROUTES.reportCatalog).then((p) =>
    asList<unknown>(p)
      .map(toCatalogItem)
      .filter((c) => c.key !== ""),
  );
}

// ------------------------------------------------------------ B) çalıştırma

function toPeriod(raw: unknown): ReportPeriod | null {
  const o = obj(raw);
  const from = str(o.from) ?? str(o.start) ?? str(o.baslangic);
  const to = str(o.to) ?? str(o.end) ?? str(o.bitis);
  if (!from || !to) return null;
  return {
    from: from.slice(0, 10),
    to: to.slice(0, 10),
    // Sözleşme kapalı aralıktır; sunucu açıkça `false` derse ekranda da öyle yazar.
    toInclusive: o.toInclusive === false ? false : true,
    label: str(o.label),
  };
}

/**
 * Mutlak farkı türetir — YALNIZCA sunucu fark göndermediğinde.
 *
 * PARA alanlarında `Number()` KULLANILMAZ: Decimal(18,2) string'i ikili kayan
 * noktaya çevrilince 0,1 + 0,2 hatası kuruş kaymasına dönüşür. Kuruş tamsayısı
 * üzerinden çıkarılır, sonra tek seferde ölçeklenir.
 */
function deriveDelta(
  value: string | number | null,
  previous: string | number | null,
  type: ReportColumnType,
): number | null {
  if (value === null || previous === null) return null;
  if (type === "PARA") {
    const a = toKurus(value);
    const b = toKurus(previous);
    if (a === null || b === null) return null;
    return Number(a - b) / 100;
  }
  const a = num(value);
  const b = num(previous);
  if (a === null || b === null) return null;
  return a - b;
}

/** Yüzde farkı — payda 0 ise `null`. "Sonsuz artış" diye bir gösterim yoktur. */
function derivePercent(
  delta: number | null,
  previous: string | number | null,
  type: ReportColumnType,
): number | null {
  if (delta === null) return null;
  const base = type === "PARA" ? (() => {
    const k = toKurus(previous);
    return k === null ? null : Number(k) / 100;
  })() : num(previous);
  if (base === null || base === 0) return null;
  return (delta / Math.abs(base)) * 100;
}

/**
 * Sunucunun "yön" beyanı — METRİĞİN İYİ YÖNÜ İÇİN TEK GERÇEK KAYNAK.
 *
 * Sunucu bunu `higherIsBetter: boolean` olarak bildirir; alan YOKSA yön
 * bilinmiyordur ve `null` döner (etiket sezgisine düşülür, o da tutmazsa
 * NOTR — bilinmeyeni yeşile boyamak yanlış bilgilendirmedir).
 *
 * `higherIsBetter === false` "azalış iyi" DEĞİLDİR; sunucu bu ayrımı
 * alanı hiç yazmayarak yapar (bkz. report-helpers.ts `countMetric`), bu
 * yüzden yalnız `true` bağlayıcı kabul edilir ve gerisi sezgiye bırakılır.
 */
function serverDirection(o: Record<string, unknown>): string | null {
  const explicit = str(o.direction) ?? str(o.goodDirection);
  if (explicit) return explicit;
  if (o.higherIsBetter === true) return "ARTIS_IYI";
  return null;
}

function toMetric(raw: unknown): ReportMetric {
  const o = obj(raw);
  const key = str(o.key) ?? str(o.name) ?? "";
  const label = str(o.label) ?? str(o.title) ?? key;
  const type = columnType(o.type ?? o.dataType);
  const value = (o.value ?? o.current ?? null) as string | number | null;
  const previous = (o.previous ?? o.prev ?? o.previousValue ?? null) as string | number | null;
  const delta = num(o.delta) ?? deriveDelta(value, previous, type);
  return {
    key,
    label,
    type,
    direction: metricDirection(key, label, serverDirection(o)),
    currency: str(o.currency),
    value,
    previous,
    delta,
    deltaPercent: num(o.deltaPercent ?? o.changePercent) ?? derivePercent(delta, previous, type),
    hint: str(o.hint) ?? str(o.description),
  };
}

function toSeries(raw: unknown): ReportSeries {
  const o = obj(raw);
  const key = str(o.key) ?? str(o.name) ?? "";
  const label = str(o.label) ?? str(o.title) ?? key;
  const chartRaw = (str(o.chart) ?? str(o.type) ?? "").toUpperCase();
  const chart: ReportSeries["chart"] =
    chartRaw === "CIZGI" || chartRaw === "LINE" || chartRaw === "TREND" ? "CIZGI" : "CUBUK";
  return {
    key,
    label,
    chart,
    type: columnType(o.valueType ?? o.dataType),
    direction: metricDirection(key, label, str(o.direction) ?? str(o.goodDirection)),
    currency: str(o.currency),
    points: asList<unknown>(o.points ?? o.data ?? o.values).map((p) => {
      const po = obj(p);
      return {
        label: str(po.label) ?? str(po.x) ?? str(po.date) ?? "",
        value: num(po.value ?? po.y) ?? 0,
        previous: num(po.previous ?? po.prev),
      };
    }),
  };
}

/**
 * Raporu çalıştırır.
 *
 * SONUÇ SAKLANMAZ: `ReportRun` yalnızca denetim kaydıdır (kim, ne zaman, kaç
 * satır). Ekran her açılışta yeniden hesaplatır; "dün gördüğüm sayı" ile
 * "bugün gördüğüm sayı" arasındaki fark, verinin kendisinin değişmesindendir,
 * önbelleğe alınmış bayat bir sonuçtan değil.
 */
export async function runReport(
  reportKey: string,
  params: ReportParams,
): Promise<ReportResult> {
  const res = await api<unknown>(FAZ6_ROUTES.reportRun(reportKey), {
    query: reportQuery(params),
  });
  return toReportResult(res, reportKey, params.table ?? null);
}

/**
 * Sunucu sorgu dizesi — çalıştırma ve CSV AYNI alanları kullanır.
 *
 * Boş dize GÖNDERİLMEZ: sunucu `format`/`tablo`/`meta` dışındaki her alanı
 * rapor parametresi sayar; boş bir `muvekkilId=` UUID doğrulamasına takılıp
 * 400 döndürürdü.
 */
function reportQuery(params: ReportParams): Record<string, string> {
  const q: Record<string, string> = {};
  if (params.from) q.from = params.from;
  if (params.to) q.to = params.to;
  /**
   * `karsilastir` HER İKİ DURUMDA DA GÖNDERİLİR.
   *
   * Sunucu varsayılanı `true`dur (`report-params.ts` → `readBool(raw.karsilastir,
   * true)`). Kutu kapalıyken hiçbir şey göndermemek "karşılaştırma açık" demekti:
   * araç çubuğundaki önceki-dönem etiketi kayboluyor ama KPI kartları hâlâ delta
   * oku, yüzde ve önceki dönem değerini gösteriyordu; üstelik Büro Özeti ile
   * Süre Performansı her sorguyu İKİ KEZ çalıştırıyordu (denetim bulgusu 13).
   * Bir onay kutusunun kapalı hâli de bir karardır ve iletilmelidir.
   */
  q.karsilastir = params.compare ? "true" : "false";
  for (const [k, v] of Object.entries(params.filters ?? {})) {
    if (v !== undefined && v !== null && `${v}` !== "") q[k] = `${v}`;
  }
  return q;
}

/**
 * Sunucu sonucunu ekran modeline çevirir.
 *
 * SUNUCU `tables[]` DÖNER, EKRAN TEK TABLO ÇİZER. Gösterilecek tablo sırasıyla
 * (1) kullanıcının seçtiği, (2) sunucunun bildirdiği `defaultTable`, (3) ilk
 * tablodur. Seçim `tableKey` olarak sonuca yazılır; ekran hangi tabloyu
 * gösterdiğini söyler ve CSV aynı anahtarla indirilir. "İlk tabloyu sessizce
 * göster" davranışı, dört tablolu duruşma takviminde kullanıcının raporun
 * dörtte üçünü hiç görmemesi demekti.
 *
 * `rowCount` GÖSTERİLEN tablonun satır sayısıdır; sunucunun kırptığı tabloda
 * `totalRowCount` gerçek toplamı taşır ve uyarı olarak ayrıca döner.
 */
function toReportResult(
  res: unknown,
  reportKey: string,
  wantedTable: string | null,
): ReportResult {
  const o = obj(res);
  const inner = obj(o.result ?? o.report);
  const src = Object.keys(inner).length > 0 ? inner : o;

  const rawTables = asList<unknown>(src.tables);
  // Tablosuz sonuç: sütun/satır doğrudan kökte olabilir (ileride tek tablolu
  // bir uç eklenirse çalışsın diye korunur).
  const source = rawTables.length > 0 ? rawTables : [src];

  const tables: ReportTableInfo[] = source.map((t) => {
    const to_ = obj(t);
    const totals = obj(to_.totals);
    return {
      key: str(to_.key) ?? "",
      title: str(to_.title) ?? str(to_.key) ?? "Tablo",
      definition: str(to_.definition),
      truncated: bool(to_.truncated),
      totalRowCount: num(to_.totalRowCount),
      columns: asList<unknown>(to_.columns ?? to_.fields).map(toColumn),
      rows: asList<unknown>(to_.rows ?? to_.items ?? to_.data) as ReportRow[],
      // Boş bir `totals` nesnesi "toplam yok" demektir; alt satır hiç çizilmez.
      totals: Object.keys(totals).length > 0 ? (totals as ReportRow) : null,
    };
  });

  const picked =
    tables.find((t) => t.key === wantedTable) ??
    tables.find((t) => t.key === str(src.defaultTable)) ??
    tables[0] ??
    null;

  // Sunucunun uyarıları (dönem uzunluğu, satır kırpma, eksik saatlik ücret) ile
  // rol nedeniyle çıkarılan bölümler tek nota toplanır — kullanıcı raporun
  // NEDEN eksik olduğunu ekranda görmeli.
  const notes = [
    ...asList<unknown>(src.warnings).map((w) => str(w)),
    ...asList<unknown>(src.hiddenSections).map((w) => str(w)),
    ...asList<unknown>(src.notes).map((w) => str(w)),
    str(src.note),
    str(src.scopeNote),
  ].filter((n): n is string => Boolean(n));

  return {
    reportKey: str(src.key) ?? str(src.reportKey) ?? reportKey,
    title: str(src.name) ?? str(src.title),
    period: toPeriod(src.period ?? src),
    previousPeriod: toPeriod(src.comparisonPeriod ?? src.previousPeriod ?? src.comparePeriod),
    tables,
    tableKey: picked?.key ?? null,
    columns: picked?.columns ?? [],
    rows: picked?.rows ?? [],
    totals: picked?.totals ?? null,
    metrics: asList<unknown>(src.metrics ?? src.kpis ?? src.summary).map(toMetric),
    series: asList<unknown>(src.series ?? src.charts).map(toSeries),
    // GÖSTERİLEN tablonun satır sayısı: kırpılmışsa sunucunun bildirdiği
    // GERÇEK toplam yazılır, ekrandaki kesit değil.
    rowCount: picked ? (picked.totalRowCount ?? picked.rows.length) : (num(src.rowCount) ?? 0),
    durationMs: num(src.durationMs),
    generatedAt: str(src.generatedAt) ?? str(src.createdAt),
    note: notes.length > 0 ? [...new Set(notes)].join(" · ") : null,
  };
}

/**
 * Görünen tabloyu DEĞİŞTİRİR — sunucuya GİTMEDEN.
 *
 * Bütün tablolar zaten elde olduğu için seçim saf bir yeniden gösterimdir;
 * rakamlar aynı çalıştırmadan gelir, dolayısıyla sekmeler arasında tutarsız
 * bir "yarısı eski yarısı yeni" tablo çifti oluşamaz.
 */
export function selectReportTable(result: ReportResult, tableKey: string): ReportResult {
  const t = result.tables.find((x) => x.key === tableKey);
  if (!t) return result;
  return {
    ...result,
    tableKey: t.key,
    columns: t.columns,
    rows: t.rows,
    totals: t.totals,
    rowCount: t.totalRowCount ?? t.rows.length,
  };
}

/**
 * CSV'yi SUNUCUDAN indirir.
 *
 * NEDEN İSTEMCİDE ÜRETİLMİYOR: ekrandaki tablo sunucudan gelen SÜZÜLMÜŞ
 * kesittir (rol kısıtı sütun düşürebilir, sayfalama satır kırpabilir).
 * Ekranı CSV'ye çevirmek, kullanıcının "tam veri" sandığı eksik bir dosya
 * üretirdi. Ayrıca dışa aktarım `ReportRun.format = CSV` olarak DENETİME
 * yazılır — bu kayıt yalnız sunucu çağrılırsa oluşur.
 */
export async function downloadReportCsv(
  reportKey: string,
  params: ReportParams,
  fileName: string,
): Promise<void> {
  const qs = new URLSearchParams({ format: "csv", ...reportQuery(params) });
  // EKRANDAKİ TABLO İNER: çok tablolu raporda sunucu `tablo` verilmezse
  // varsayılan tabloyu yazar; kullanıcı başka bir tabloya baktıysa indirilen
  // dosya baktığı tablo olmalıdır.
  if (params.table) qs.set("tablo", params.table);

  const url = `${API_BASE}/api/v1${FAZ6_ROUTES.reportExport(reportKey)}?${qs.toString()}`;

  let res: Response;
  try {
    // İ-46: kimlik httpOnly çerezle taşınır (credentials: "include").
    res = await fetch(url, { credentials: "include" });
  } catch {
    throw new ApiError("API sunucusuna ulaşılamadı.", 0, null);
  }

  if (!res.ok) {
    // Hata gövdesi JSON olabilir; ApiError'a aynı biçimde taşınır ki çağıran
    // 403 (rol kısıtı) ile 404'ü (uç yok) ayırabilsin.
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text || null;
    }
    const message =
      (obj(data).message as string | undefined) ?? `CSV indirilemedi (HTTP ${res.status}).`;
    throw new ApiError(message, res.status, data);
  }

  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Bellek sızıntısını önlemek için nesne URL'i serbest bırakılır.
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}

// ------------------------------------------------------------ C) kayıtlı raporlar

function toSavedReport(raw: unknown): SavedReportItem {
  const o = obj(raw);
  const params = fromSavedParams(parseJson(o.params ?? o.paramsJson));
  const scope = (str(o.scope) ?? "KISISEL") as ReportScope;
  return {
    id: str(o.id) ?? "",
    name: str(o.name) ?? "Kayıtlı rapor",
    reportKey: str(o.reportKey) ?? "",
    params,
    scope: scope === "BURO" ? "BURO" : "KISISEL",
    createdBy: str(o.createdBy),
    createdByName: str(o.createdByName) ?? str(obj(o.creator).fullName),
    isPinned: bool(o.isPinned),
    // Sunucu söylemiyorsa düzenlenebilir varsayılır; gerçek kısıt sunucudadır.
    canEdit: o.canEdit === false ? false : true,
    createdAt: str(o.createdAt),
    updatedAt: str(o.updatedAt),
  };
}

export function listSavedReports(reportKey?: string): Promise<SavedReportItem[]> {
  return api<unknown>(FAZ6_ROUTES.savedReports, { query: { reportKey } }).then((p) =>
    asList<unknown>(p).map(toSavedReport),
  );
}

/**
 * Kayıtlı rapor TANIMI oluşturur — SONUÇ SAKLANMAZ.
 *
 * `params` NESNE olarak gönderilir. Veritabanında alan `paramsJson` (String)
 * olsa da uç şeması (`createSavedReportSchema`) nesne bekler ve JSON'a
 * çevirmeyi sunucu yapar: metni istemcide üretmek, alan başına 200 karakter /
 * en çok 30 alan sınırının doğrulanamadan geçmesi demekti.
 */
export function createSavedReport(body: {
  name: string;
  reportKey: string;
  params: ReportParams;
  scope: ReportScope;
}): Promise<SavedReportItem> {
  return api<unknown>(FAZ6_ROUTES.savedReports, {
    method: "POST",
    body: {
      name: body.name.trim(),
      reportKey: body.reportKey,
      params: savedParams(body.params),
      scope: body.scope,
    },
  }).then(toSavedReport);
}

/**
 * Ekran parametrelerini uç şemasının kabul ettiği DÜZ nesneye indirger.
 *
 * `filters` iç içe bir nesnedir; şema yalnız bir seviye ilkel değer kabul
 * eder (derinlik bir saldırı yüzeyidir). Filtreler bu yüzden üst seviyeye
 * açılır — çalıştırma sorgusunda da aynı biçimde düz geçtikleri için kayıtlı
 * tanım ile canlı çalıştırma birebir aynı alanları taşır.
 */
function savedParams(params: ReportParams): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  if (params.from) out.from = params.from;
  if (params.to) out.to = params.to;
  if (params.preset) out.donem = params.preset;
  if (params.compare) out.karsilastir = true;
  if (params.table) out.tablo = params.table;
  for (const [k, v] of Object.entries(params.filters ?? {})) {
    if (v !== undefined && v !== null && `${v}` !== "") out[k] = `${v}`;
  }
  return out;
}

/** `savedParams`ın TERSİ — sunucunun düz nesnesini ekran modeline çevirir. */
const RESERVED_PARAM_KEYS = new Set(["from", "to", "donem", "karsilastir", "tablo"]);

function fromSavedParams(raw: unknown): ReportParams {
  const o = obj(raw);
  const filters: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    if (RESERVED_PARAM_KEYS.has(k)) continue;
    const s = Array.isArray(v) ? v.join(",") : str(v) ?? (typeof v === "boolean" ? String(v) : null);
    if (s !== null) filters[k] = s;
  }
  return {
    from: str(o.from) ?? undefined,
    to: str(o.to) ?? undefined,
    preset: str(o.donem) ?? undefined,
    compare: o.karsilastir === true || o.karsilastir === "true",
    filters,
    table: str(o.tablo) ?? undefined,
  };
}

export function updateSavedReport(
  id: string,
  patch: { name?: string; isPinned?: boolean; scope?: ReportScope; params?: ReportParams },
): Promise<SavedReportItem> {
  const body: Record<string, unknown> = {};
  if (patch.name !== undefined) body.name = patch.name.trim();
  if (patch.isPinned !== undefined) body.isPinned = patch.isPinned;
  if (patch.scope !== undefined) body.scope = patch.scope;
  if (patch.params !== undefined) body.params = savedParams(patch.params);
  return api<unknown>(FAZ6_ROUTES.savedReport(id), { method: "PATCH", body }).then(toSavedReport);
}

export function deleteSavedReport(id: string): Promise<void> {
  return api<unknown>(FAZ6_ROUTES.savedReport(id), { method: "DELETE" }).then(() => undefined);
}

// ------------------------------------------------------------ D) AI yorumu

/**
 * AI YORUMU — KREDİLİ ve OPSİYONEL.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ LLM RAKAM ÜRETMEZ (ortak karar 1).                                       ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * İstemci sunucuya YALNIZCA rapor anahtarını ve dönemi gönderir; rakamları
 * sunucu kendi hesabından okuyup prompt'a koyar. Ekrandaki sayıları gövdede
 * geri göndermek, kullanıcı tarafında değiştirilmiş bir rakamın AI yorumuna
 * kaynak olması demekti — yorumun dayanağı DAİMA sunucunun hesabıdır.
 */
export async function interpretReport(
  reportKey: string,
  params: ReportParams,
): Promise<ReportNarrative> {
  const res = await api<unknown>(FAZ6_ROUTES.reportInterpret(reportKey), {
    method: "POST",
    // Uç gövdesi `{ params, soru?, piiApproved? }`. Rapor sunucuda YENİDEN
    // çalıştırılır; ekrandaki rakamlar gövdeye KONMAZ.
    body: { params: savedParams(params) },
  });
  const o = obj(res);
  const inner = obj(o.narrative ?? o.result);
  const src = Object.keys(inner).length > 0 ? inner : o;
  return {
    text: str(src.text) ?? str(src.yorum) ?? str(src.commentary) ?? str(src.summary) ?? "",
    basedOn: asList<unknown>(src.basedOn ?? src.dayanak ?? src.metrics ?? src.sources)
      .map((m) => (typeof m === "string" ? m : str(obj(m).label) ?? str(obj(m).key)))
      .filter((m): m is string => Boolean(m)),
    model: str(src.model),
    createdAt: str(src.createdAt) ?? str(src.generatedAt),
  };
}

// ------------------------------------------------------------ E) bildirimler

function toNotification(raw: unknown): NotificationItem {
  const o = obj(raw);
  const resourceType = str(o.resourceType);
  const resourceId = str(o.resourceId);
  const status = (str(o.status) ?? "GONDERILDI") as NotificationStatus;
  return {
    id: str(o.id) ?? "",
    kind: str(o.kind) ?? "SISTEM",
    title: str(o.title) ?? "Bildirim",
    body: str(o.body),
    resourceType,
    resourceId,
    status,
    scheduledFor: str(o.scheduledFor),
    sentAt: str(o.sentAt),
    readAt: str(o.readAt),
    createdAt: str(o.createdAt),
    href: notificationHref(resourceType, resourceId),
  };
}

/**
 * Bildirim akışı.
 *
 * `NotificationOutbox` üretim ile gönderimi ayırır. `IPTAL` satırı kaynak kayıt
 * değiştiği için düşürülmüştür ve GÖSTERİLMEZ.
 *
 * `BEKLIYOR` GÖSTERİLİR — bu, entegrasyonda düzeltilen bir varsayımdır.
 * `BEKLIYOR`, "PUSH bildirimi henüz gönderilmedi" demektir; uygulama içi zil
 * için satırın listelenmesi gönderimin TA KENDİSİDİR. Bu fazda push sağlayıcısı
 * NOOP olduğu için hiçbir satır `GONDERILDI`ya geçmiyor: `BEKLIYOR` süzülseydi
 * gece işleri düzgün çalışırken zil DAİMA boş görünürdü — kaçırılmak üzere olan
 * süreler kullanıcıya hiç ulaşmazdı. Süzgeç durum üzerinden değil, kullanıcının
 * seçtiği `status` sorgusuyla sunucuda yapılır.
 */
export async function fetchNotifications(
  options: { limit?: number; status?: NotificationStatus | "OKUNMAMIS" } = {},
): Promise<NotificationFeed> {
  // "OKUNMAMIS" bir DURUM DEĞİL, bir süzgeçtir: sunucuda okunmamışlık
  // BEKLIYOR + GONDERILDI kümesidir ve `unreadOnly` ile sorulur. Durum alanına
  // yazılsaydı uç 400 döndürürdü (kabul edilenler: BEKLIYOR/GONDERILDI/OKUNDU).
  const unreadOnly = options.status === "OKUNMAMIS";
  const res = await api<unknown>(FAZ6_ROUTES.notifications, {
    query: {
      limit: options.limit ?? 30,
      status: unreadOnly ? undefined : options.status,
      unreadOnly: unreadOnly ? "true" : undefined,
    },
  });
  const o = obj(res);
  const items = asList<unknown>(Array.isArray(res) ? res : (o.items ?? o.data ?? res))
    .map(toNotification)
    .filter((n) => n.id !== "" && n.status !== "IPTAL");

  const serverUnread = num(o.unreadCount ?? o.unread);
  return {
    items,
    unreadCount: serverUnread ?? items.filter((n) => !n.readAt && n.status !== "OKUNDU").length,
  };
}

/** Okunmamış sayısı — rozetin tek kaynağı. Uç yoksa 0 döner, rozet gizlenir. */
export async function fetchUnreadCount(): Promise<number> {
  try {
    const res = await api<unknown>(FAZ6_ROUTES.notificationsUnread);
    if (typeof res === "number") return res;
    const o = obj(res);
    return num(o.count ?? o.unreadCount ?? o.unread) ?? 0;
  } catch {
    return 0;
  }
}

export function markNotificationRead(id: string): Promise<void> {
  return api<unknown>(FAZ6_ROUTES.notificationRead(id), { method: "PATCH", body: {} }).then(
    () => undefined,
  );
}

export function markAllNotificationsRead(): Promise<number> {
  return api<unknown>(FAZ6_ROUTES.notificationsReadAll, { method: "POST", body: {} }).then(
    (res) => num(obj(res).updated ?? obj(res).count) ?? 0,
  );
}

/**
 * Bildirim durumu değiştiğinde yayılan olay (öneri rozeti ve kredi göstergesiyle
 * aynı desen): panel kartı ile zil rozeti tek tıklamayla senkron kalır.
 */
export const NOTIFICATIONS_CHANGED_EVENT = "nomosos:notifications-changed";

export function notifyNotificationsChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
  }
}

/** Kritik bildirimler önce, sonra yeni olan — liste sırası. */
export function sortNotifications(
  items: NotificationItem[],
  isCritical: (kind: string) => boolean,
): NotificationItem[] {
  return [...items].sort((a, b) => {
    const ca = isCritical(a.kind) ? 0 : 1;
    const cb = isCritical(b.kind) ? 0 : 1;
    if (ca !== cb) return ca - cb;
    const ua = a.readAt ? 1 : 0;
    const ub = b.readAt ? 1 : 0;
    if (ua !== ub) return ua - ub;
    return (b.sentAt ?? b.createdAt ?? "").localeCompare(a.sentAt ?? a.createdAt ?? "");
  });
}
