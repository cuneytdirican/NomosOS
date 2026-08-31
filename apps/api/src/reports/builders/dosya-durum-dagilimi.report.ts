/**
 * DOSYA DURUM DAĞILIMI — tür × durum matrisi, yaş dağılımı, hareketsiz dosyalar.
 *
 * DÖNEM SEMANTİĞİ: bu rapor bir FOTOĞRAFTIR, akış değildir. Dönem REFERANS
 * GÜNÜNÜ belirler: yaş ve hareketsizlik, dönemin son gününe göre ölçülür ve
 * SAYILAN EVREN de o güne kadar açılmış dosyalardır.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ PAY VE PAYDA AYNI EVRENİ SAYAR (denetim bulgusu 12).                     ║
 * ║ Eskiden tür×durum matrisi ile `toplamDosya`/`acikDosya` sayaçlarında     ║
 * ║ HİÇBİR tarih süzgeci yoktu — daima BUGÜNÜN fotoğrafıydı — ama yaş        ║
 * ║ kovaları `openedAt < ref` ile süzülüyordu. 100 açık dosyanın 50'si       ║
 * ║ referans günden sonra açılmışsa yaş kovaları toplamı %50 çıkıyor,        ║
 * ║ okuyucu "dosyaların yarısı sınıflandırılamamış" sanıyordu. Artık üç      ║
 * ║ sorgu da `openedAt < ref` taşır.                                         ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * YAŞ KOVALARI: 0-6 ay, 6-12 ay, 1-2 yıl, 2+ yıl. Sınır tarihleri SQL'de
 * `INTERVAL` ile değil TypeScript'te UTC ay aritmetiğiyle üretilip parametre
 * olarak geçirilir — böylece kova sınırı sunucunun saat dilimine ya da
 * Postgres'in ay ekleme kuralına bağlı kalmaz.
 */

import { Prisma } from "@nomosos/db";
import type { CaseType as DbCaseType } from "@nomosos/db";
import {
  ACTIVE_CASE_STATUSES,
  countMetric,
  finishTable,
  intOf,
  isoDay,
  takeWithProbe,
  truncationWarning,
  wholeDaysBetween,
} from "../report-helpers";
import type { ReportBody, ReportBuilder, ReportCell } from "../report-types";

/** UTC ay çıkarma — gün taşması olan tarihlerde ayın son gününe sabitlenir. */
function minusMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() - months;
  const day = date.getUTCDate();
  const candidate = new Date(Date.UTC(year, month, day));
  // 31 Mart − 1 ay = 3 Mart olmasın: taşma varsa hedef ayın son gününe in.
  if (candidate.getUTCDate() !== day) {
    return new Date(Date.UTC(year, month + 1, 0));
  }
  return candidate;
}

const AGE_BUCKETS = ["0-6 ay", "6-12 ay", "1-2 yıl", "2+ yıl"] as const;

interface IdleCase {
  id: string;
  fileNumber: string | null;
  title: string;
  type: string;
  status: string;
  openedAt: Date;
  lastActivityAt: Date | null;
  courtName: string | null;
  clientName: string;
  responsibleName: string | null;
}

export const dosyaDurumDagilimiReport: ReportBuilder = async (ctx): Promise<ReportBody> => {
  const { user, prisma, params } = ctx;
  const tenantId = user.tenantId;
  const db = prisma.client;

  /** Referans gün: dönemin son gününün sonu (üst sınır, hariç). */
  const ref = params.period.endExclusive;
  const cut6 = minusMonths(ref, 6);
  const cut12 = minusMonths(ref, 12);
  const cut24 = minusMonths(ref, 24);

  const caseTypeFilter = params.caseType ? { type: params.caseType as DbCaseType } : {};
  const activeFilter = Prisma.sql`c.status::text IN (${Prisma.join(ACTIVE_CASE_STATUSES)})`;
  const typeFilter = params.caseType
    ? Prisma.sql`AND c.type::text = ${params.caseType}`
    : Prisma.empty;

  /** Referans güne kadar AÇILMIŞ dosyalar — üç sorgunun ortak evreni. */
  const openedBeforeRef = { openedAt: { lt: ref } };

  const [matrixRows, ageRows, idleCases, totalCases, activeCases] = await Promise.all([
    db.case.groupBy({
      by: ["type", "status"],
      where: { tenantId, ...caseTypeFilter, ...openedBeforeRef },
      _count: { _all: true },
      orderBy: [{ type: "asc" }, { status: "asc" }],
    }),
    db.$queryRaw<{ bucket: string; n: number }[]>`
      SELECT bucket, COUNT(*)::int AS n FROM (
        SELECT CASE
                 WHEN c."openedAt" >= ${cut6}  THEN '0-6 ay'
                 WHEN c."openedAt" >= ${cut12} THEN '6-12 ay'
                 WHEN c."openedAt" >= ${cut24} THEN '1-2 yıl'
                 ELSE '2+ yıl'
               END AS bucket
          FROM "Case" c
         WHERE c."tenantId" = ${tenantId}
           AND c."openedAt" < ${ref}
           AND ${activeFilter}
           ${typeFilter}
      ) s
       GROUP BY bucket
    `,
    /**
     * EN UZUN SÜREDİR HAREKETSİZ DOSYALAR — SIRALAMA SQL'DE (denetim bulgusu 5).
     *
     * Eski hâl `orderBy: [{ lastActivityAt: { sort: "asc", nulls: "first" } }]`
     * + `take: 200` idi. `nulls: "first"` yüzünden hareket kaydı HİÇ OLMAYAN
     * bütün dosyalar başa geçiyor, ilk 200 oradan doluyordu; içlerinde DÜN
     * açılmış (hareketsiz 1 gün) dosyalar bulunurken `lastActivityAt` 3 yıl
     * önce olan gerçek "unutulmuş dosya" listeye HİÇ GİREMİYORDU. Bellekteki
     * yeniden sıralama (`idleRows.sort`) bunu düzeltemez: ELEME zaten yapılmış
     * olur. Sıralama ölçütü hesaplandığı yerde — `COALESCE`'da — olmalıdır.
     *
     * `take` yerine `LIMIT limit + 1`: fazladan gelen satır "sınıra dayanıldı"
     * kanıtıdır ve tabloyu kırpılmış işaretler. Eski `Math.min(limit, 200)`
     * sabiti varsayılan sınırın (500) ALTINDAYDI; 200'den fazla açık dosyası
     * olan her büroda tablo daima eksik ve daima "tam" görünüyordu (bulgu 4).
     */
    db.$queryRaw<IdleCase[]>`
      SELECT c.id,
             c."fileNumber",
             c.title,
             c.type::text   AS type,
             c.status::text AS status,
             c."openedAt",
             c."lastActivityAt",
             c."courtName",
             cl.name        AS "clientName",
             u."fullName"   AS "responsibleName"
        FROM "Case" c
        JOIN "Client" cl ON cl.id = c."clientId"
        LEFT JOIN "User" u ON u.id = c."responsibleUserId"
       WHERE c."tenantId" = ${tenantId}
         AND c."openedAt" < ${ref}
         AND ${activeFilter}
         ${typeFilter}
       ORDER BY COALESCE(c."lastActivityAt", c."openedAt") ASC, c."openedAt" ASC
       LIMIT ${takeWithProbe(params.limit)}
    `,
    db.case.count({ where: { tenantId, ...caseTypeFilter, ...openedBeforeRef } }),
    db.case.count({
      where: {
        tenantId,
        status: { in: ACTIVE_CASE_STATUSES },
        ...caseTypeFilter,
        ...openedBeforeRef,
      },
    }),
  ]);

  /* ── Tür × durum matrisi ── */
  const matrix = finishTable(
    {
      key: "tur-durum",
      title: "Tür × durum dağılımı",
      definition:
        `Referans güne (${isoDay(params.period.to)}) kadar açılmış TÜM dosyalar (kapanmış ve ` +
        "arşiv dâhil). Durum sütunu dosyanın BUGÜNKÜ durumudur — şemada durum geçmişi yoktur, " +
        "'o tarihteki durum' üretilemez. Pay, aynı evrenin toplamına göredir.",
      columns: [
        { key: "tur", label: "Dosya türü", type: "text" },
        { key: "durum", label: "Durum", type: "text" },
        { key: "adet", label: "Adet", type: "number" },
        { key: "oran", label: "Toplam içindeki pay (%)", type: "percent" },
      ],
    },
    matrixRows.map((r) => ({
      tur: r.type,
      durum: r.status,
      adet: r._count._all,
      oran: totalCases > 0 ? Math.round((r._count._all / totalCases) * 10000) / 100 : 0,
    })),
    params.limit,
  );

  /* ── Yaş dağılımı ── */
  const ageMap = new Map(ageRows.map((r) => [r.bucket, intOf(r.n)]));
  const ageTable = finishTable(
    {
      key: "yas-dagilimi",
      title: "Açık dosyaların yaş dağılımı",
      definition:
        `Yaş = dosya açılış tarihinden ${params.period.to.toISOString().slice(0, 10)} tarihine kadar geçen süre. ` +
        "Yalnız AÇIK (kapanmamış) dosyalar sayılır.",
      columns: [
        { key: "kova", label: "Yaş aralığı", type: "text" },
        { key: "adet", label: "Adet", type: "number" },
        { key: "oran", label: "Açık dosya içindeki pay (%)", type: "percent" },
      ],
    },
    AGE_BUCKETS.map((bucket) => {
      const n = ageMap.get(bucket) ?? 0;
      return {
        kova: bucket,
        adet: n,
        oran: activeCases > 0 ? Math.round((n / activeCases) * 10000) / 100 : 0,
      };
    }),
    params.limit,
  );

  /* ── En uzun süredir hareketsiz dosyalar ── */
  const idleTruncated = idleCases.length > params.limit;
  const idleRows: Record<string, ReportCell>[] = idleCases.map((c) => {
    const since = c.lastActivityAt ?? c.openedAt;
    // Gün başına indirilmiş tam gün farkı; saat bileşeni gün sayısını kaydırmaz.
    const days = Math.max(0, wholeDaysBetween(since, params.period.to));
    return {
      dosyaNo: c.fileNumber ?? "",
      baslik: c.title,
      muvekkil: c.clientName,
      tur: c.type,
      durum: c.status,
      mahkeme: c.courtName ?? "",
      sorumlu: c.responsibleName ?? "(atanmamış)",
      sonHareket: isoDay(c.lastActivityAt),
      hareketsizGun: days,
      hareketKaydiVar: c.lastActivityAt ? "Evet" : "Hayır",
    };
  });
  // SQL zaten COALESCE(lastActivityAt, openedAt) ASC ile sıralı geldi; en uzun
  // hareketsiz başta olsun diye diziyi ters çevirmek YETMEZDİ (eleme sırasını
  // değiştirmezdi), bu yüzden sıralama sorguya taşındı ve burada korunur.

  const idleTable = finishTable(
    {
      key: "hareketsiz",
      title: "En uzun süredir hareket görmeyen açık dosyalar",
      definition:
        "Hareketsizlik, dosyanın son hareket tarihinden (yoksa açılış tarihinden) referans güne " +
        "kadar geçen tam gün sayısıdır. Sıralama ve eleme veritabanında bu ölçüte göre yapılır; " +
        "`Hayır` satırlarında hiç hareket kaydı yoktur — bu, dosyanın işlem görmediği anlamına " +
        "gelmez, safahat/not girilmemiş olabilir.",
      columns: [
        { key: "dosyaNo", label: "Esas no", type: "text" },
        { key: "baslik", label: "Dosya", type: "text" },
        { key: "muvekkil", label: "Müvekkil", type: "text" },
        { key: "tur", label: "Tür", type: "text" },
        { key: "durum", label: "Durum", type: "text" },
        { key: "mahkeme", label: "Mahkeme / daire", type: "text" },
        { key: "sorumlu", label: "Sorumlu", type: "text" },
        { key: "sonHareket", label: "Son hareket", type: "date" },
        { key: "hareketsizGun", label: "Hareketsiz gün", type: "number" },
        { key: "hareketKaydiVar", label: "Hareket kaydı var mı", type: "text" },
      ],
    },
    idleRows,
    params.limit,
    { queryLimitReached: idleTruncated },
  );

  const metrics = [
    countMetric("toplamDosya", "Toplam dosya", totalCases, undefined, {
      definition: `Referans güne (${isoDay(params.period.to)}) kadar açılmış tüm dosyalar.`,
    }),
    countMetric("acikDosya", "Açık dosya", activeCases, undefined, {
      definition: "Aynı evrende, bugün açık durumda olan dosyalar. Yaş kovalarının paydası budur.",
    }),
    countMetric("kapaliDosya", "Kapanmış/arşiv dosya", totalCases - activeCases, undefined),
    countMetric("ikiYilUstu", "2 yıldan eski açık dosya", ageMap.get("2+ yıl") ?? 0, undefined, {
      higherIsBetter: false,
      definition: "Uzun süredir kapanmayan dosyalar; gözden geçirme adayı.",
    }),
  ];

  const warnings: string[] = [];
  for (const t of [matrix, ageTable, idleTable]) {
    const w = truncationWarning(t);
    if (w) warnings.push(w);
  }

  return { metrics, tables: [matrix, ageTable, idleTable], warnings };
};
