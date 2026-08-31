/**
 * TAHSİLAT YAŞLANDIRMA — müvekkil × yaş dilimi.
 *
 * HESAP SÖZLEŞMESİ:
 *   bakiye        = fatura toplamı − o faturaya REFERANS GÜNE KADAR işlenmiş
 *                   ödemelerin toplamı
 *   gecikme günü  = referans gün − (vade tarihi ?? düzenleme tarihi), TAM GÜN
 *   referans gün  = DÖNEMİN SON GÜNÜ (bugün değil) — geçmiş bir dönem seçildiğinde
 *                   "o tarihteki yaşlandırma" alınabilsin diye.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ ÜÇ SINIR DA AYNI REFERANS GÜNE OTURUR (denetim bulgusu 7).               ║
 * ║ Eskiden yaş `period.to`ya göre ölçülüyor, bakiye ise BUGÜNE göre         ║
 * ║ hesaplanıyordu: fatura seçiminde `issueDate` sınırı, ödeme toplamında    ║
 * ║ `date` sınırı yoktu. Sonuç, geçmiş dönem raporunu iki yönden bozuyordu:  ║
 * ║   · Haziran'da 250.000 TL açık olup Ağustos'ta ödenen fatura, bakiyesi   ║
 * ║     bugün 0 olduğu için Haziran raporunda HİÇ GÖRÜNMÜYORDU → "Haziran    ║
 * ║     sonu açık alacak" gerçeğin çok altında çıkıyordu.                    ║
 * ║   · 20 Ağustos'ta kesilen fatura, Haziran raporuna "Vadesi gelmemiş"     ║
 * ║     kovasında GİRİYORDU.                                                 ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * DURUM SÜZGECİ: fatura durumu BUGÜNKÜ durumdur (şemada durum geçmişi yoktur).
 * Geçmiş bir dönem için `IPTAL` ve `TASLAK` dışındaki tüm faturalar taranır ve
 * bakiyesi referans güne göre hesaplanır; bugün `ODENDI` görünen bir fatura o
 * tarihte açıksa listeye GİRER. Bu, tanım satırında açıkça yazılır.
 *
 * KOVA SINIRLARI İKİ UCU DA DAHİLDİR: eşikler [30, 60, 90] verildiğinde kovalar
 * `0-30`, `31-60`, `61-90`, `91+` olur. Vadesi HENÜZ GELMEMİŞ bakiyeler ayrı bir
 * kovada ("Vadesi gelmemiş") durur; gecikmemiş parayı "0-30 gün" kovasına atmak
 * gecikmiş alacağı olduğundan büyük gösterirdi.
 *
 * PARA BİRİMLERİ TOPLANMAZ. Her satır kendi para birimindedir; kur çevrimi
 * yapılmaz (şemada kur alanı yok — uydurma kur, parasal karar üretmek olurdu).
 * ANA ÖLÇÜLER DE TOPLAMAZ: kart yalnız ana para birimini gösterir ve diğerleri
 * ayrı bir tabloda durur. Eskiden 40.000 EUR + 10.000 TRY alacak "50.000,00 TL"
 * olarak tek kartta toplanıyordu (denetim bulgusu 9).
 *
 * PERFORMANS: fatura başına ödeme sorgusu YOKTUR (N+1 yok). Tek `$queryRaw`
 * faturaları ödeme toplamıyla birlikte getirir; kovalama bellekte Decimal
 * aritmetiğiyle yapılır. Açık fatura sayısı eşiği aşarsa uyarı döner.
 */

import { Prisma } from "@nomosos/db";
import { moneyOut } from "../../finance/money";
import {
  compareDescending,
  countMetric,
  decOf,
  finishTable,
  isoDay,
  moneyMetric,
  percentMetric,
  truncationWarning,
  wholeDaysBetween,
} from "../report-helpers";
import type { ReportBody, ReportBuilder, ReportCell, ReportColumn } from "../report-types";

/** Bellekte kovalanan açık fatura sayısı bu eşiği aşarsa uyarı üretilir. */
const OPEN_INVOICE_WARN_THRESHOLD = 5000;

/** Vadesi henüz gelmemiş bakiyeler ayrı kovada durur — gecikmiş alacakla karışmasın. */
export const NOT_DUE_LABEL = "Vadesi gelmemiş";

/**
 * Kova etiketleri: [30,60,90] → ["0-30 gün", "31-60 gün", "61-90 gün", "91+ gün"].
 *
 * SON KOVA `son eşik + 1`DEN BAŞLAR. Etiket eskiden "90+ gün" yazıyordu ama
 * `bucketOf` 90 günü "61-90" kovasına koyuyordu; yani "90+ gün" sütunu 90
 * günlük alacağı İÇERMİYORDU (denetim bulgusu 19). Etiketin sayısı, kovanın
 * gerçek alt sınırını söylemek zorundadır.
 */
export function bucketLabels(thresholds: number[]): string[] {
  const labels: string[] = [];
  let lower = 0;
  for (const upper of thresholds) {
    labels.push(`${lower}-${upper} gün`);
    lower = upper + 1;
  }
  labels.push(`${thresholds[thresholds.length - 1] + 1}+ gün`);
  return labels;
}

/** Gecikme gününü kova etiketine çevirir. Negatif gün → "Vadesi gelmemiş". */
export function bucketOf(overdueDays: number, thresholds: number[], labels: string[]): string {
  if (overdueDays < 0) return NOT_DUE_LABEL;
  for (let i = 0; i < thresholds.length; i += 1) {
    if (overdueDays <= thresholds[i]) return labels[i];
  }
  return labels[labels.length - 1];
}

interface RawInvoice {
  id: string;
  clientId: string;
  clientName: string;
  invoiceNo: string | null;
  currency: string;
  total: Prisma.Decimal;
  issueDate: Date;
  dueDate: Date | null;
  paid: Prisma.Decimal;
}

export const tahsilatYaslandirmaReport: ReportBuilder = async (ctx): Promise<ReportBody> => {
  const { user, prisma, params } = ctx;
  const tenantId = user.tenantId;
  const db = prisma.client;

  /** Referans gün: dönemin son günü (yaşlandırma bu güne göre ölçülür). */
  const ref = params.period.to;
  /** Referans günün ERTESİ gün başı — üç sınır da bunu kullanır. */
  const refEnd = params.period.endExclusive;
  const clientFilter = params.clientId
    ? Prisma.sql`AND i."clientId" = ${params.clientId}`
    : Prisma.empty;

  const [invoices, issuedInPeriod, paidInPeriod] = await Promise.all([
    db.$queryRaw<RawInvoice[]>`
      SELECT i.id,
             i."clientId",
             cl.name        AS "clientName",
             i."invoiceNo",
             i.currency,
             i.total,
             i."issueDate",
             i."dueDate",
             COALESCE(SUM(p.amount) FILTER (WHERE p."date" < ${refEnd}), 0) AS paid
        FROM "Invoice" i
        JOIN "Client" cl ON cl.id = i."clientId"
        LEFT JOIN "Payment" p ON p."invoiceId" = i.id
       WHERE i."tenantId" = ${tenantId}
         -- TASLAK henüz alacak doğurmaz; IPTAL hiç doğurmadı. Diğer durumlar
         -- (ODENDI dâhil) referans güne göre bakiyeleriyle değerlendirilir:
         -- bugün ödenmiş bir fatura geçmiş bir referans günde AÇIK olabilir.
         AND i.status::text NOT IN ('IPTAL', 'TASLAK')
         AND i."issueDate" < ${refEnd}
         ${clientFilter}
       GROUP BY i.id, cl.name
    `,
    db.invoice.groupBy({
      by: ["currency"],
      where: {
        tenantId,
        status: { notIn: ["IPTAL"] },
        issueDate: { gte: params.period.from, lt: params.period.endExclusive },
        ...(params.clientId ? { clientId: params.clientId } : {}),
      },
      _sum: { total: true },
      _count: { _all: true },
    }),
    /**
     * TAHSİLAT PARA BİRİMİNE BAĞLANIR. `Payment` şemasında `currency` alanı
     * YOKTUR (schema.prisma:1582); ödeme birimini yalnız bağlı olduğu fatura
     * bilir. Eskiden bütün ödemeler toplanıp TRY faturaya bölünüyordu: 800.000
     * TRY + 10.000 USD tahsilat, 1.000.000 TRY faturaya karşı %81 çıkıyordu —
     * gerçek TRY tahsil oranı %80'di (denetim bulgusu 6).
     *
     * Faturasız (serbest) ödemenin para birimi BİLİNEMEZ; ayrı sayılır ve
     * uyarıyla bildirilir, orana KATILMAZ.
     */
    db.$queryRaw<{ currency: string | null; total: Prisma.Decimal }[]>`
      SELECT i.currency AS currency, SUM(p.amount) AS total
        FROM "Payment" p
        LEFT JOIN "Invoice" i ON i.id = p."invoiceId"
       WHERE p."tenantId" = ${tenantId}
         AND p."date" >= ${params.period.from} AND p."date" < ${params.period.endExclusive}
         ${params.clientId ? Prisma.sql`AND p."clientId" = ${params.clientId}` : Prisma.empty}
       GROUP BY i.currency
    `,
  ]);

  const thresholds = params.agingBuckets;
  const labels = bucketLabels(thresholds);
  const allBuckets = [NOT_DUE_LABEL, ...labels];

  /** clientId|currency → { name, currency, kovalar, toplam, faturaSayisi, enEskiGun } */
  interface ClientRow {
    clientName: string;
    currency: string;
    buckets: Map<string, Prisma.Decimal>;
    total: Prisma.Decimal;
    invoiceCount: number;
    /**
     * `null` = bu müvekkilin hiç GECİKMİŞ faturası yok.
     * Eskiden 0 ile başlatılıyordu ve tüm faturaları vadesinden önce olan
     * müvekkil "En eski gecikme: 0 gün" görünüyordu — "bugün vadesi doldu" ile
     * aynı okunuyordu (denetim bulgusu 20). Boş hücreyi arayüz "—" basar.
     */
    oldestOverdueDays: number | null;
  }
  const byClient = new Map<string, ClientRow>();
  /** Kova toplamları PARA BİRİMİ BAŞINA tutulur — birimler toplanmaz. */
  const bucketTotals = new Map<string, Map<string, Prisma.Decimal>>();
  /** Para birimi → { toplam, vadesiGeçen }. */
  const currencyTotals = new Map<string, { total: Prisma.Decimal; overdue: Prisma.Decimal }>();

  let openInvoiceCount = 0;
  const currencies = new Set<string>();
  const detailRows: Record<string, ReportCell>[] = [];

  const bucketBox = (currency: string): Map<string, Prisma.Decimal> => {
    let box = bucketTotals.get(currency);
    if (!box) {
      box = new Map(allBuckets.map((l) => [l, new Prisma.Decimal(0)]));
      bucketTotals.set(currency, box);
    }
    return box;
  };
  const currencyBox = (currency: string) => {
    let box = currencyTotals.get(currency);
    if (!box) {
      box = { total: new Prisma.Decimal(0), overdue: new Prisma.Decimal(0) };
      currencyTotals.set(currency, box);
    }
    return box;
  };

  for (const inv of invoices) {
    const remaining = decOf(inv.total).minus(decOf(inv.paid));
    // Fazla ödeme / tam kapanmış fatura yaşlandırmaya girmez.
    if (remaining.lte(0)) continue;

    const reference = inv.dueDate ?? inv.issueDate;
    // İKİ TARAF DA GÜN BAŞINA İNDİRİLİR. Ham milisaniye farkı, aynı gün 00:00
    // ve 14:30 vadeli iki faturayı farklı yaş dilimine düşürüyordu (bulgu 8).
    const overdueDays = wholeDaysBetween(reference, ref);
    const bucket = bucketOf(overdueDays, thresholds, labels);

    const mapKey = `${inv.clientId}|${inv.currency}`;
    let row = byClient.get(mapKey);
    if (!row) {
      row = {
        clientName: inv.clientName,
        currency: inv.currency,
        buckets: new Map(allBuckets.map((l) => [l, new Prisma.Decimal(0)])),
        total: new Prisma.Decimal(0),
        invoiceCount: 0,
        oldestOverdueDays: null,
      };
      byClient.set(mapKey, row);
    }
    row.buckets.set(bucket, (row.buckets.get(bucket) ?? new Prisma.Decimal(0)).plus(remaining));
    row.total = row.total.plus(remaining);
    row.invoiceCount += 1;
    if (overdueDays >= 0) {
      row.oldestOverdueDays = Math.max(row.oldestOverdueDays ?? 0, overdueDays);
    }

    const box = bucketBox(inv.currency);
    box.set(bucket, (box.get(bucket) ?? new Prisma.Decimal(0)).plus(remaining));
    const cur = currencyBox(inv.currency);
    cur.total = cur.total.plus(remaining);
    if (overdueDays >= 0) cur.overdue = cur.overdue.plus(remaining);
    openInvoiceCount += 1;
    currencies.add(inv.currency);

    detailRows.push({
      muvekkil: inv.clientName,
      faturaNo: inv.invoiceNo ?? "(numarasız taslak)",
      duzenleme: isoDay(inv.issueDate),
      vade: isoDay(inv.dueDate),
      paraBirimi: inv.currency,
      tutar: moneyOut(inv.total),
      odenen: moneyOut(inv.paid),
      bakiye: moneyOut(remaining),
      gecikmeGun: overdueDays,
      kova: bucket,
    });
  }

  /* ── Müvekkil × kova matrisi ── */
  const matrixColumns: ReportColumn[] = [
    { key: "muvekkil", label: "Müvekkil", type: "text" },
    { key: "paraBirimi", label: "Para birimi", type: "text" },
    ...allBuckets.map((label, i) => ({
      key: `k${i}`,
      label,
      type: "money" as const,
      currencyKey: "paraBirimi",
    })),
    { key: "toplam", label: "Toplam alacak", type: "money", currencyKey: "paraBirimi" },
    { key: "faturaSayisi", label: "Açık fatura", type: "number" },
    { key: "enEskiGecikme", label: "En eski gecikme (gün)", type: "number" },
  ];

  const matrixRows: Record<string, ReportCell>[] = [...byClient.values()]
    // Önce para birimi, sonra tutar: farklı birimlerdeki alacakları tek listede
    // büyüklüğe göre sıralamak yanıltıcıdır. Karşılaştırıcı eşitlikte 0 döner.
    .sort((a, b) => {
      if (a.currency !== b.currency) return a.currency.localeCompare(b.currency, "tr");
      return compareDescending(a.total, b.total);
    })
    .map((row) => {
      const cells: Record<string, ReportCell> = {
        muvekkil: row.clientName,
        paraBirimi: row.currency,
        toplam: moneyOut(row.total),
        faturaSayisi: row.invoiceCount,
        enEskiGecikme: row.oldestOverdueDays,
      };
      allBuckets.forEach((label, i) => {
        cells[`k${i}`] = moneyOut(row.buckets.get(label) ?? new Prisma.Decimal(0));
      });
      return cells;
    });

  const matrix = finishTable(
    {
      key: "yaslandirma",
      title: "Müvekkil × yaş dilimi",
      definition:
        `Referans gün: ${isoDay(ref)}. Bakiye, o güne KADAR işlenmiş ödemelere göre ` +
        "hesaplanır; sonraki ödemeler düşülmez. Gecikme, vade tarihinden (vade yoksa " +
        "düzenleme tarihinden) referans güne kadar geçen tam gün sayısıdır — iki taraf da " +
        "gün başına indirilir, saat bileşeni kovaları kaydırmaz. Kova sınırları iki ucu da " +
        "dâhildir. Para birimleri toplanmaz; satırlar birim içinde sıralanır.",
      columns: matrixColumns,
    },
    matrixRows,
    params.limit,
  );

  /* ── Fatura ayrıntısı ── */
  detailRows.sort((a, b) => Number(b.gecikmeGun) - Number(a.gecikmeGun));
  const detail = finishTable(
    {
      key: "faturalar",
      title: "Açık fatura ayrıntısı",
      definition:
        `Referans gün (${isoDay(ref)}) itibarıyla bakiyesi kalan faturalar, en eski ` +
        "gecikmeden başlayarak. IPTAL ve TASLAK faturalar hariçtir; bugün ödenmiş görünen " +
        "bir fatura o tarihte açıksa listeye girer.",
      columns: [
        { key: "muvekkil", label: "Müvekkil", type: "text" },
        { key: "faturaNo", label: "Fatura no", type: "text" },
        { key: "duzenleme", label: "Düzenleme", type: "date" },
        { key: "vade", label: "Vade", type: "date" },
        { key: "paraBirimi", label: "Para birimi", type: "text" },
        { key: "tutar", label: "Fatura tutarı", type: "money", currencyKey: "paraBirimi" },
        { key: "odenen", label: "Ödenen", type: "money", currencyKey: "paraBirimi" },
        { key: "bakiye", label: "Bakiye", type: "money", currencyKey: "paraBirimi" },
        { key: "gecikmeGun", label: "Gecikme (gün)", type: "number" },
        { key: "kova", label: "Yaş dilimi", type: "text" },
      ],
    },
    detailRows,
    params.limit,
  );

  /* ── Kova toplamları — PARA BİRİMİ × KOVA ── */
  const bucketRows: Record<string, ReportCell>[] = [];
  for (const code of [...bucketTotals.keys()].sort()) {
    const box = bucketTotals.get(code)!;
    const currencyTotal = currencyTotals.get(code)?.total ?? new Prisma.Decimal(0);
    for (const label of allBuckets) {
      const value = box.get(label) ?? new Prisma.Decimal(0);
      bucketRows.push({
        paraBirimi: code,
        kova: label,
        tutar: moneyOut(value),
        pay: currencyTotal.isZero()
          ? 0
          : Math.round(value.div(currencyTotal).mul(10000).toNumber()) / 100,
      });
    }
  }
  const bucketTable = finishTable(
    {
      key: "kova-toplam",
      title: "Yaş dilimi toplamları (para birimi bazında)",
      definition:
        "Bakiyeler kova bazında toplanır. TOPLAMA PARA BİRİMLERİ KARIŞTIRILMAZ: her satır " +
        "tek bir para biriminindir ve pay o birimin kendi toplamına göredir. Kur çevrimi yapılmaz.",
      columns: [
        { key: "paraBirimi", label: "Para birimi", type: "text" },
        { key: "kova", label: "Yaş dilimi", type: "text" },
        { key: "tutar", label: "Tutar", type: "money", currencyKey: "paraBirimi" },
        { key: "pay", label: "Para birimi içindeki pay (%)", type: "percent" },
      ],
    },
    bucketRows,
    params.limit,
  );

  /* ── Dönem tahsil oranı — PAY VE PAYDA AYNI PARA BİRİMİNDE ── */
  const issuedPrimary = issuedInPeriod.find((r) => r.currency === "TRY") ?? issuedInPeriod[0];
  const primaryCurrency =
    issuedPrimary?.currency ?? (currencies.has("TRY") ? "TRY" : ([...currencies].sort()[0] ?? "TRY"));

  const issuedTotal = decOf(issuedInPeriod.find((r) => r.currency === primaryCurrency)?._sum.total);
  const collectedTotal = decOf(paidInPeriod.find((r) => r.currency === primaryCurrency)?.total);
  const unlinkedCollected = decOf(paidInPeriod.find((r) => r.currency === null)?.total);
  /**
   * PAYDA YOKSA ORAN YOKTUR. Eskiden 0 yazılıyordu: dönem içinde hiç fatura
   * kesmemiş ama 500.000 TL tahsil etmiş büro "Tahsil oranı %0" görüyordu
   * (denetim bulgusu 6). Boş değer arayüzde "—" olarak çıkar.
   */
  const collectionRate = issuedTotal.isZero()
    ? null
    : Math.round(collectedTotal.div(issuedTotal).mul(10000).toNumber()) / 100;

  const primaryBox = currencyTotals.get(primaryCurrency) ?? {
    total: new Prisma.Decimal(0),
    overdue: new Prisma.Decimal(0),
  };

  /* ── Para birimi özeti — kartların hangi birimi gösterdiği görünsün ── */
  const currencyTable = finishTable(
    {
      key: "para-birimi",
      title: "Para birimi bazında açık alacak",
      definition:
        "Ana ölçü kartları YALNIZ " +
        `${primaryCurrency} tutarlarını gösterir. Diğer para birimlerindeki alacak bu tablodadır ` +
        "ve kartlara EKLENMEZ; kur çevrimi yapılmaz.",
      columns: [
        { key: "paraBirimi", label: "Para birimi", type: "text" },
        { key: "toplam", label: "Toplam açık alacak", type: "money", currencyKey: "paraBirimi" },
        { key: "vadesiGecen", label: "Vadesi geçmiş", type: "money", currencyKey: "paraBirimi" },
      ],
    },
    [...currencyTotals.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, v]) => ({
        paraBirimi: code,
        toplam: moneyOut(v.total),
        vadesiGecen: moneyOut(v.overdue),
      })),
    params.limit,
  );

  const metrics = [
    moneyMetric("toplamAlacak", "Toplam açık alacak", primaryBox.total, undefined, primaryCurrency, {
      higherIsBetter: false,
      definition:
        `Bakiyesi kalan faturaların toplamı (referans gün itibarıyla), YALNIZ ${primaryCurrency}. ` +
        "Diğer para birimleri için 'Para birimi bazında açık alacak' tablosuna bakın.",
    }),
    moneyMetric("vadesiGecen", "Vadesi geçmiş alacak", primaryBox.overdue, undefined, primaryCurrency, {
      higherIsBetter: false,
      critical: true,
      definition: `Yalnız ${primaryCurrency}. Kur çevrimi yapılmaz.`,
    }),
    countMetric("acikFatura", "Açık fatura sayısı", openInvoiceCount, undefined, {
      definition: "Tüm para birimlerindeki bakiyeli fatura adedi (adet toplanabilir, tutar toplanamaz).",
    }),
    countMetric("borcluMuvekkil", "Bakiyesi olan müvekkil", new Set([...byClient.values()].map((r) => r.clientName)).size, undefined),
    moneyMetric("donemFatura", "Dönem içi kesilen fatura", issuedTotal, undefined, primaryCurrency, {
      definition: `Düzenleme tarihi dönem içinde olan, iptal edilmemiş ${primaryCurrency} faturaların toplamı.`,
    }),
    moneyMetric("donemTahsilat", "Dönem içi tahsilat", collectedTotal, undefined, primaryCurrency, {
      higherIsBetter: true,
      definition:
        `Dönem içinde alınan ve ${primaryCurrency} bir faturaya işlenmiş ödemeler. Faturaya ` +
        "bağlanmamış ödemelerin para birimi bilinemez ve bu ölçüye GİRMEZ.",
    }),
    percentMetric("tahsilOrani", "Tahsil oranı (%)", collectionRate, undefined, {
      higherIsBetter: true,
      definition:
        `Dönem içi ${primaryCurrency} tahsilat / dönem içi ${primaryCurrency} kesilen fatura. ` +
        "Pay ve payda AYNI para birimindedir. Dönem içinde hiç fatura kesilmemişse oran " +
        "hesaplanmaz ve boş döner (0 YAZILMAZ). Tahsilat önceki dönemlerin faturalarını da " +
        "kapatabileceği için %100'ü aşabilir — bu bir hata değildir.",
    }),
  ];

  const warnings: string[] = [];
  for (const t of [matrix, detail, bucketTable, currencyTable]) {
    const w = truncationWarning(t);
    if (w) warnings.push(w);
  }
  if (currencies.size > 1) {
    warnings.push(
      `Açık faturalar ${currencies.size} farklı para biriminde (${[...currencies].sort().join(", ")}). ` +
        `Ana ölçü kartları YALNIZ ${primaryCurrency} gösterir; diğer birimler "Para birimi bazında ` +
        'açık alacak" tablosundadır. Kur çevrimi yapılmaz.',
    );
  }
  if (!unlinkedCollected.isZero()) {
    warnings.push(
      `Dönem içinde faturaya bağlanmamış ${moneyOut(unlinkedCollected)} tutarında ödeme var. ` +
        "Bu ödemelerin para birimi belirlenemediği için tahsilat ölçüsüne ve tahsil oranına GİRMEDİ.",
    );
  }
  if (issuedInPeriod.length > 1) {
    warnings.push(
      `Tahsil oranı yalnız ${primaryCurrency} üzerinden hesaplandı; diğer para birimlerindeki ` +
        "faturalar ve o faturalara yapılan ödemeler orana girmedi.",
    );
  }
  if (invoices.length > OPEN_INVOICE_WARN_THRESHOLD) {
    warnings.push(
      `${invoices.length} fatura belleğe alınıp kovalandı (eşik ${OPEN_INVOICE_WARN_THRESHOLD}). ` +
        "Rapor doğrudur ama yavaşlar; müvekkil süzgeci kullanmanız önerilir.",
    );
  }

  return { metrics, tables: [matrix, currencyTable, bucketTable, detail], warnings };
};
