/**
 * SÜRE PERFORMANSI.
 *
 * ╔════════════════════════════════════════════════════════════════════════╗
 * ║  KAÇIRILAN SÜRE BÜRONUN EN KRİTİK METRİĞİDİR.                          ║
 * ║  Telafisi çoğu zaman imkânsızdır (hak düşürücü süre), meslekî          ║
 * ║  sorumluluk ve tazminat riski doğurur. Bu yüzden rapor onu tek bir     ║
 * ║  sayıya gömmez: ayrı `critical` ölçü + kaçırılan her sürenin dosya/    ║
 * ║  sorumlu/gecikme listesi + sorumlu kırılımı olarak üç yerde gösterir.  ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 *
 * İKİ FARKLI "KAÇIRILDI" VARDIR ve ayrı sayılır:
 *   1. İŞARETLİ  → `Deadline.status = KACIRILDI` (kullanıcı kabul etmiş).
 *   2. FİİLİ     → vadesi geçmiş ama hâlâ AÇIK (BEKLIYOR/ONAYLANDI) süre.
 * İkisini tek sayıda toplamak, "kaçırdığımızı henüz fark etmediklerimizi"
 * gizlerdi. Toplam risk ölçüsü ikisinin toplamıdır ve ayrıca döner.
 *
 * TAMAMLANMA ANI: şemada ayrı bir `completedAt` alanı YOKTUR; `updatedAt`
 * kullanılır. Bu bir yaklaşımdır ve rapor notunda AÇIKÇA yazılır — süre
 * tamamlandıktan sonra kayıt üzerinde düzenleme yapılırsa pay kayar.
 */

import { startOfDay } from "../../common/dates";
import {
  OPEN_DEADLINE_STATUSES,
  countMetric,
  finishTable,
  intOf,
  isoDay,
  percentMetric,
  ratioPercent,
  takeWithProbe,
  truncationWarning,
  wholeDaysBetween,
} from "../report-helpers";
import type { ReportBody, ReportBuilder, ReportCell, ReportPeriod } from "../report-types";
import type { PrismaService } from "../../prisma/prisma.service";

/**
 * SQL'e GÜN, `Date` OLARAK DEĞİL METİN OLARAK GEÇER (denetim bulgusu 15).
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ `Deadline.dueDate` şemada `@db.Date`tir — Postgres'te SAATSİZ `date`.    ║
 * ║ Onu bir `Date` parametresiyle (yani `timestamptz` ile) karşılaştırmak,   ║
 * ║ Postgres'i `date`i OTURUM SAAT DİLİMİNE göre `timestamptz`'ye yükseltmek ║
 * ║ zorunda bırakır. Bugün doğru çalışıyor çünkü Postgres kabı `TZ: UTC`     ║
 * ║ ile koşuyor — ama bu HİÇBİR YERDE iddia edilmiyor, test edilmiyor ve     ║
 * ║ API kabı `TZ: Europe/Istanbul` taşıyor. Oturum +03 olsaydı 31.08 vadeli  ║
 * ║ bir süre `2026-08-30T21:00Z < 2026-08-31T00:00Z` ile "vadesi geçmiş,     ║
 * ║ hâlâ AÇIK" sayılır, büronun EN KRİTİK metriği (KAÇIRILAN SÜRE) sahte     ║
 * ║ olarak artardı.                                                          ║
 * ║                                                                          ║
 * ║ `'YYYY-MM-DD'::date` bir takvim günüdür; hiçbir saat dilimi çevrimi      ║
 * ║ içermez. `dueDate + 1` de `date` aritmetiğidir. Zaman damgasıyla         ║
 * ║ karşılaştırılması gereken tek yerde (`updatedAt`) sınır AÇIKÇA           ║
 * ║ `AT TIME ZONE 'UTC'` ile sabitlenir — sistemin baştan sona UTC olan      ║
 * ║ sözleşmesi SQL tarafında da yazılı hâle gelir.                           ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
function sqlDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

interface DeadlineTotals {
  total: number;
  completed: number;
  onTime: number;
  late: number;
  missedFlagged: number;
  openOverdue: number;
  cancelled: number;
  /** Ortalama tamamlama payı (gün): pozitif = vadeden önce tamamlandı. */
  averageMarginDays: number | null;
}

async function collect(
  prisma: PrismaService,
  tenantId: string,
  period: ReportPeriod,
  today: Date,
): Promise<DeadlineTotals> {
  const rows = await prisma.client.$queryRaw<
    {
      toplam: number;
      tamamlanan: number;
      zamaninda: number;
      gec: number;
      kacirilan: number;
      acikgecmis: number;
      iptal: number;
      ortalamapay: number | null;
    }[]
  >`
    SELECT
      COUNT(*)::int AS toplam,
      COUNT(*) FILTER (WHERE d.status::text = 'TAMAMLANDI')::int AS tamamlanan,
      COUNT(*) FILTER (
        WHERE d.status::text = 'TAMAMLANDI'
          AND d."updatedAt" < ((d."dueDate" + 1)::timestamp AT TIME ZONE 'UTC')
      )::int AS zamaninda,
      COUNT(*) FILTER (
        WHERE d.status::text = 'TAMAMLANDI'
          AND d."updatedAt" >= ((d."dueDate" + 1)::timestamp AT TIME ZONE 'UTC')
      )::int AS gec,
      COUNT(*) FILTER (WHERE d.status::text = 'KACIRILDI')::int AS kacirilan,
      COUNT(*) FILTER (
        WHERE d.status::text IN ('BEKLIYOR', 'ONAYLANDI') AND d."dueDate" < ${sqlDay(today)}::date
      )::int AS acikgecmis,
      COUNT(*) FILTER (WHERE d.status::text = 'IPTAL')::int AS iptal,
      (AVG(
        EXTRACT(EPOCH FROM (((d."dueDate" + 1)::timestamp AT TIME ZONE 'UTC') - d."updatedAt")) / 86400.0
      ) FILTER (WHERE d.status::text = 'TAMAMLANDI'))::float8 AS ortalamapay
    FROM "Deadline" d
    WHERE d."tenantId" = ${tenantId}
      AND d."dueDate" >= ${sqlDay(period.from)}::date
      AND d."dueDate" < ${sqlDay(period.endExclusive)}::date
  `;

  const r = rows[0];
  return {
    total: intOf(r?.toplam),
    completed: intOf(r?.tamamlanan),
    onTime: intOf(r?.zamaninda),
    late: intOf(r?.gec),
    missedFlagged: intOf(r?.kacirilan),
    openOverdue: intOf(r?.acikgecmis),
    cancelled: intOf(r?.iptal),
    averageMarginDays:
      r?.ortalamapay === null || r?.ortalamapay === undefined
        ? null
        : Math.round(Number(r.ortalamapay) * 100) / 100,
  };
}

export const surePerformansiReport: ReportBuilder = async (ctx): Promise<ReportBody> => {
  const { user, prisma, params, now } = ctx;
  const tenantId = user.tenantId;
  const db = prisma.client;
  const today = startOfDay(now);

  const [current, previous, missedList, byOwner, bySource] = await Promise.all([
    collect(prisma, tenantId, params.period, today),
    params.comparison
      ? collect(prisma, tenantId, params.comparison, today)
      : Promise.resolve(undefined),
    db.deadline.findMany({
      where: {
        tenantId,
        dueDate: { gte: params.period.from, lt: params.period.endExclusive },
        OR: [
          { status: "KACIRILDI" },
          { status: { in: OPEN_DEADLINE_STATUSES }, dueDate: { lt: today } },
        ],
      },
      select: {
        id: true,
        title: true,
        dueDate: true,
        status: true,
        source: true,
        legalBasis: true,
        ruleKey: true,
        owner: { select: { fullName: true } },
        case: {
          select: {
            fileNumber: true,
            title: true,
            courtName: true,
            client: { select: { name: true } },
          },
        },
      },
      orderBy: { dueDate: "asc" },
      // limit + 1: fazladan satır "sınıra dayanıldı" kanıtıdır (bulgu 4).
      take: takeWithProbe(params.limit),
    }),
    /**
     * KİŞİ KIRILIMI KULLANICI KİMLİĞİYLE GRUPLANIR (denetim bulgusu 17).
     *
     * `GROUP BY u."fullName"` bir isim gruplamasıdır, kişi gruplaması değil.
     * Büroda iki "Mehmet Yılmaz" varsa süreleri tek satırda toplanıyor ve
     * kaçırma oranı ikisinin ortalaması gibi görünüyordu: 8 süreden 4'ünü
     * kaçıran avukat, hiç kaçırmayan adaşıyla birlikte %25'te duruyordu.
     * Kimlik zaten elde (`d."ownerId"`); kullanılmaması bir gözden kaçmaydı.
     */
    db.$queryRaw<{ ownerid: string | null; owner: string | null; kacirilan: number; toplam: number }[]>`
      SELECT d."ownerId"  AS ownerid,
             u."fullName" AS owner,
             COUNT(*) FILTER (
               WHERE d.status::text = 'KACIRILDI'
                  OR (d.status::text IN ('BEKLIYOR','ONAYLANDI')
                      AND d."dueDate" < ${sqlDay(today)}::date)
             )::int AS kacirilan,
             COUNT(*)::int AS toplam
        FROM "Deadline" d
        LEFT JOIN "User" u ON u.id = d."ownerId"
       WHERE d."tenantId" = ${tenantId}
         AND d."dueDate" >= ${sqlDay(params.period.from)}::date
         AND d."dueDate" < ${sqlDay(params.period.endExclusive)}::date
       GROUP BY d."ownerId", u."fullName"
       ORDER BY 3 DESC, 4 DESC
    `,
    db.deadline.groupBy({
      by: ["source"],
      where: { tenantId, dueDate: { gte: params.period.from, lt: params.period.endExclusive } },
      _count: { _all: true },
      orderBy: { source: "asc" },
    }),
  ]);

  const missedTotal = current.missedFlagged + current.openOverdue;
  const previousMissedTotal =
    previous === undefined ? undefined : previous.missedFlagged + previous.openOverdue;

  const metrics = [
    countMetric("toplamSure", "Dönem içi vadesi gelen süre", current.total, previous?.total, {
      definition: "Vade tarihi dönem içinde olan tüm süreler (iptal edilenler dâhil).",
    }),
    countMetric("zamanindaTamamlanan", "Zamanında tamamlanan", current.onTime, previous?.onTime, {
      higherIsBetter: true,
      definition: "Tamamlanma anı vade gününün sonundan önce olan süreler.",
    }),
    countMetric("gecTamamlanan", "Vadeden sonra tamamlanan", current.late, previous?.late, {
      higherIsBetter: false,
    }),
    countMetric("kacirilanToplam", "KAÇIRILAN SÜRE (toplam)", missedTotal, previousMissedTotal, {
      higherIsBetter: false,
      critical: true,
      definition:
        "KACIRILDI işaretli süreler + vadesi geçtiği hâlde hâlâ açık olan süreler. " +
        "Büronun en kritik ölçüsüdür; hedef sıfırdır.",
    }),
    countMetric("kacirilanIsaretli", "— işaretli (KACIRILDI)", current.missedFlagged, previous?.missedFlagged, {
      higherIsBetter: false,
      critical: true,
    }),
    countMetric("acikVadesiGecmis", "— vadesi geçmiş, hâlâ AÇIK", current.openOverdue, previous?.openOverdue, {
      higherIsBetter: false,
      critical: true,
      definition:
        "Henüz kaçırıldığı kabul edilmemiş ama vadesi dolmuş süreler. Bugün müdahale gerektirir.",
    }),
    percentMetric(
      "zamanindaOrani",
      "Zamanında tamamlama oranı (%)",
      ratioPercent(current.onTime, current.total),
      previous ? ratioPercent(previous.onTime, previous.total) : undefined,
      { higherIsBetter: true, definition: "Zamanında tamamlanan / dönem içi vadesi gelen toplam süre." },
    ),
    countMetric("iptalEdilen", "İptal edilen", current.cancelled, previous?.cancelled),
  ];

  metrics.push({
    key: "ortalamaTamamlamaPayi",
    label: "Ortalama tamamlama payı (gün)",
    type: "number",
    value: current.averageMarginDays,
    previous: previous?.averageMarginDays ?? undefined,
    higherIsBetter: true,
    definition:
      "Vade gününün sonu ile tamamlanma anı arasındaki ortalama gün farkı. POZİTİF = vadeden " +
      "önce bitirilmiş; NEGATİF = vadeden sonra. Tamamlanmış süre yoksa boştur (0 YAZILMAZ).",
  });

  /* ── Kaçırılan süreler listesi ── */
  const missedTruncated = missedList.length > params.limit;
  const missedRows: Record<string, ReportCell>[] = missedList.map((d) => {
    const lateDays = Math.max(0, wholeDaysBetween(d.dueDate, today));
    return {
      vadeTarihi: isoDay(d.dueDate),
      gecikmeGun: lateDays,
      durum: d.status === "KACIRILDI" ? "KACIRILDI (işaretli)" : `${d.status} (vadesi geçmiş, açık)`,
      baslik: d.title,
      dosyaNo: d.case.fileNumber ?? "",
      dosya: d.case.title,
      muvekkil: d.case.client.name,
      mahkeme: d.case.courtName ?? "",
      sorumlu: d.owner?.fullName ?? "(atanmamış)",
      dayanak: d.legalBasis ?? d.ruleKey ?? "",
      kaynak: d.source,
    };
  });

  const missedTable = finishTable(
    {
      key: "kacirilan",
      title: "Kaçırılan ve vadesi geçmiş süreler",
      definition:
        "Vade tarihi dönem içinde olup KACIRILDI işaretlenen ya da vadesi geçtiği hâlde hâlâ " +
        "açık olan süreler. Gecikme gün sayısı BUGÜNE göredir.",
      columns: [
        { key: "vadeTarihi", label: "Vade", type: "date" },
        { key: "gecikmeGun", label: "Gecikme (gün)", type: "number" },
        { key: "durum", label: "Durum", type: "text" },
        { key: "baslik", label: "Süre", type: "text" },
        { key: "dosyaNo", label: "Esas no", type: "text" },
        { key: "dosya", label: "Dosya", type: "text" },
        { key: "muvekkil", label: "Müvekkil", type: "text" },
        { key: "mahkeme", label: "Mahkeme", type: "text" },
        { key: "sorumlu", label: "Sorumlu", type: "text" },
        { key: "dayanak", label: "Dayanak", type: "text" },
        { key: "kaynak", label: "Kaynak", type: "text" },
      ],
    },
    missedRows,
    params.limit,
    { queryLimitReached: missedTruncated },
  );

  /* ── Sorumlu kırılımı ── */
  const ownerTable = finishTable(
    {
      key: "sorumlu",
      title: "Sorumlu bazında süre kırılımı",
      definition:
        "İş yükü dengelemesi içindir; kişi performansı ölçütü DEĞİLDİR. Sorumlusu atanmamış " +
        "süreler `(atanmamış)` satırında toplanır.",
      columns: [
        { key: "sorumlu", label: "Sorumlu", type: "text" },
        { key: "toplam", label: "Dönem içi süre", type: "number" },
        { key: "kacirilan", label: "Kaçırılan / vadesi geçmiş", type: "number" },
        { key: "oran", label: "Kaçırma oranı (%)", type: "percent" },
      ],
    },
    byOwner.map((r) => ({
      // Adaşları ayırt etmek için kimliğin son parçası eklenir; ad tek başına
      // benzersiz değildir ve iki kişiyi tek satırda birleştirmek, birinin
      // kaçırma oranını diğerinin arkasına gizlerdi.
      sorumlu:
        r.owner === null
          ? "(atanmamış)"
          : byOwner.filter((x) => x.owner === r.owner).length > 1
            ? `${r.owner} [${(r.ownerid ?? "").slice(0, 8)}]`
            : r.owner,
      toplam: intOf(r.toplam),
      kacirilan: intOf(r.kacirilan),
      oran: ratioPercent(intOf(r.kacirilan), intOf(r.toplam)),
    })),
    params.limit,
  );

  /* ── Kaynak kırılımı (kural motoru / manuel / AI önerisi) ── */
  const sourceTable = finishTable(
    {
      key: "kaynak",
      title: "Sürelerin kaynağı",
      definition:
        "Sürenin nasıl oluştuğu: KURAL (deterministik süre motoru), MANUEL, AI_ONERISI " +
        "(avukat onayı olmadan kesinleşmez).",
      columns: [
        { key: "kaynak", label: "Kaynak", type: "text" },
        { key: "adet", label: "Adet", type: "number" },
        { key: "oran", label: "Pay (%)", type: "percent" },
      ],
    },
    bySource.map((r) => ({
      kaynak: r.source,
      adet: r._count._all,
      oran: ratioPercent(r._count._all, current.total),
    })),
    params.limit,
  );

  const warnings: string[] = [];
  for (const t of [missedTable, ownerTable, sourceTable]) {
    const w = truncationWarning(t);
    if (w) warnings.push(w);
  }
  if (current.openOverdue > 0) {
    warnings.push(
      `DİKKAT: ${current.openOverdue} sürenin vadesi geçtiği hâlde durumu hâlâ açık ` +
        "(BEKLIYOR/ONAYLANDI). Bunlar henüz kaçırılmış olarak işaretlenmemiştir; bugün " +
        "gözden geçirilmelidir.",
    );
  }
  if (current.completed > 0 && current.averageMarginDays === null) {
    warnings.push("Ortalama tamamlama payı hesaplanamadı (tamamlanma anı verisi eksik).");
  }

  return {
    metrics,
    tables: [missedTable, ownerTable, sourceTable],
    warnings,
  };
};
