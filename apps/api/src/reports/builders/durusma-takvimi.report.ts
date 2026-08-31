/**
 * DURUŞMA TAKVİMİ — dönem içi duruşmalar, avukat ve mahkeme kırılımı.
 *
 * KIRILIM UYARISI: `Hearing` kaydında "duruşmaya kim girdi" alanı YOKTUR.
 * Avukat kırılımı DOSYANIN SORUMLU AVUKATINA göre yapılır; bu bir KATILIM
 * kaydı değildir. Tabloların tanım satırı bunu yazar — aksi hâlde rapor,
 * olmayan bir veriyi varmış gibi sunardı.
 *
 * TARİH SÖZLEŞMESİ: `Hearing.date` saat bileşeni taşır. Dönem süzgeci
 * `{ gte: from, lt: endExclusive }` kalıbındadır; böylece dönemin son günü
 * saat 14:30'daki duruşma rapora GİRER (`lte: gün başı` kullanılsaydı düşerdi).
 */

import { countMetric, finishTable, intOf, ratioPercent, truncationWarning } from "../report-helpers";
import type { ReportBody, ReportBuilder, ReportCell } from "../report-types";
import { Prisma } from "@nomosos/db";

export const durusmaTakvimiReport: ReportBuilder = async (ctx): Promise<ReportBody> => {
  const { user, prisma, params } = ctx;
  const tenantId = user.tenantId;
  const db = prisma.client;
  const from = params.period.from;
  const end = params.period.endExclusive;

  // Ham sorgulardaki dosya süzgeci, Prisma sorgularındakiyle AYNI olmalıdır;
  // aksi hâlde liste ile kırılım tabloları farklı evrenleri sayardı.
  const lawyerFilter = params.userId
    ? Prisma.sql`AND c."responsibleUserId" = ${params.userId}`
    : Prisma.empty;
  const caseTypeSql = params.caseType
    ? Prisma.sql`AND c.type::text = ${params.caseType}`
    : Prisma.empty;

  /**
   * Dosya süzgeci TEK nesnede kurulur. İki ayrı `{ case: … }` yayılımı, ikincisinin
   * birincisini SESSİZCE ezmesine yol açardı: avukat + dosya türü birlikte
   * seçildiğinde avukat süzgeci düşerdi.
   */
  const caseFilter: Prisma.CaseWhereInput = {
    ...(params.userId ? { responsibleUserId: params.userId } : {}),
    ...(params.caseType ? { type: params.caseType as Prisma.CaseWhereInput["type"] } : {}),
  };
  const hasCaseFilter = Object.keys(caseFilter).length > 0;

  const [hearings, byLawyer, byCourt, byStatus, byType] = await Promise.all([
    db.hearing.findMany({
      where: {
        tenantId,
        date: { gte: from, lt: end },
        ...(hasCaseFilter ? { case: caseFilter } : {}),
      },
      select: {
        id: true,
        date: true,
        type: true,
        status: true,
        courtroom: true,
        note: true,
        preparedAt: true,
        case: {
          select: {
            fileNumber: true,
            title: true,
            type: true,
            courtName: true,
            client: { select: { name: true } },
            responsibleUser: { select: { fullName: true } },
          },
        },
      },
      orderBy: { date: "asc" },
      take: Math.min(params.limit, 2000),
    }),
    /**
     * KİŞİ KIRILIMI KULLANICI KİMLİĞİYLE GRUPLANIR (denetim bulgusu 17).
     * `GROUP BY u."fullName"` iki adaşın duruşmalarını tek satırda topluyordu.
     */
    db.$queryRaw<{ avukatid: string | null; avukat: string | null; adet: number; hazir: number }[]>`
      SELECT c."responsibleUserId"                           AS avukatid,
             u."fullName"                                    AS avukat,
             COUNT(*)::int                                   AS adet,
             COUNT(*) FILTER (WHERE h."preparedAt" IS NOT NULL)::int AS hazir
        FROM "Hearing" h
        JOIN "Case" c ON c.id = h."caseId"
        LEFT JOIN "User" u ON u.id = c."responsibleUserId"
       WHERE h."tenantId" = ${tenantId}
         AND h."date" >= ${from} AND h."date" < ${end}
         ${lawyerFilter}
         ${caseTypeSql}
       GROUP BY c."responsibleUserId", u."fullName"
       ORDER BY 3 DESC
    `,
    db.$queryRaw<{ mahkeme: string | null; adet: number }[]>`
      SELECT c."courtName" AS mahkeme, COUNT(*)::int AS adet
        FROM "Hearing" h
        JOIN "Case" c ON c.id = h."caseId"
       WHERE h."tenantId" = ${tenantId}
         AND h."date" >= ${from} AND h."date" < ${end}
         ${lawyerFilter}
         ${caseTypeSql}
       GROUP BY c."courtName"
       ORDER BY 2 DESC
    `,
    db.hearing.groupBy({
      by: ["status"],
      where: {
        tenantId,
        date: { gte: from, lt: end },
        ...(hasCaseFilter ? { case: caseFilter } : {}),
      },
      _count: { _all: true },
      orderBy: { status: "asc" },
    }),
    db.hearing.groupBy({
      by: ["type"],
      where: {
        tenantId,
        date: { gte: from, lt: end },
        ...(hasCaseFilter ? { case: caseFilter } : {}),
      },
      _count: { _all: true },
      orderBy: { type: "asc" },
    }),
  ]);

  /**
   * TOPLAM, listeden DEĞİL kırılım sorgusundan alınır: liste `take` ile
   * kırpılabilir ve pay yüzdeleri kırpılmış bir paydaya bölünürdü.
   */
  const total = byStatus.reduce((sum, r) => sum + r._count._all, 0);
  const prepared = byLawyer.reduce((sum, r) => sum + intOf(r.hazir), 0);

  const listRows: Record<string, ReportCell>[] = hearings.map((h) => ({
    tarih: h.date.toISOString().slice(0, 10),
    saat: h.date.toISOString().slice(11, 16),
    tur: h.type,
    durum: h.status,
    mahkeme: h.case.courtName ?? "",
    salon: h.courtroom ?? "",
    dosyaNo: h.case.fileNumber ?? "",
    dosya: h.case.title,
    dosyaTuru: h.case.type,
    muvekkil: h.case.client.name,
    sorumlu: h.case.responsibleUser?.fullName ?? "(atanmamış)",
    hazirlik: h.preparedAt ? "Tamamlandı" : "Yapılmadı",
    not: h.note ?? "",
  }));

  const listTable = finishTable(
    {
      key: "durusmalar",
      title: "Dönem içi duruşmalar",
      definition:
        "Duruşma tarihi dönem içinde olan tüm kayıtlar (ertelenen ve iptal edilenler dâhil). " +
        "Saat UTC'dir. `Sorumlu`, dosyanın sorumlu avukatıdır — duruşmaya fiilen kimin " +
        "girdiği kaydı tutulmaz.",
      columns: [
        { key: "tarih", label: "Tarih", type: "date" },
        { key: "saat", label: "Saat (UTC)", type: "text" },
        { key: "tur", label: "Tür", type: "text" },
        { key: "durum", label: "Durum", type: "text" },
        { key: "mahkeme", label: "Mahkeme / daire", type: "text" },
        { key: "salon", label: "Salon", type: "text" },
        { key: "dosyaNo", label: "Esas no", type: "text" },
        { key: "dosya", label: "Dosya", type: "text" },
        { key: "dosyaTuru", label: "Dosya türü", type: "text" },
        { key: "muvekkil", label: "Müvekkil", type: "text" },
        { key: "sorumlu", label: "Sorumlu avukat", type: "text" },
        { key: "hazirlik", label: "Hazırlık", type: "text" },
        { key: "not", label: "Not", type: "text" },
      ],
    },
    listRows,
    params.limit,
  );

  const lawyerTable = finishTable(
    {
      key: "avukat",
      title: "Avukat kırılımı",
      definition: "Dosyanın sorumlu avukatına göre; katılım kaydı DEĞİLDİR.",
      columns: [
        { key: "avukat", label: "Sorumlu avukat", type: "text" },
        { key: "adet", label: "Duruşma", type: "number" },
        { key: "hazirlikTamam", label: "Hazırlığı tamamlanan", type: "number" },
        { key: "hazirlikOrani", label: "Hazırlık oranı (%)", type: "percent" },
        { key: "pay", label: "Pay (%)", type: "percent" },
      ],
    },
    byLawyer.map((r) => ({
      // Adaşlar kimliğin ilk parçasıyla ayrılır; aynı ada sahip iki avukatın
      // duruşmaları tek satırda toplanamaz.
      avukat:
        r.avukat === null
          ? "(atanmamış)"
          : byLawyer.filter((x) => x.avukat === r.avukat).length > 1
            ? `${r.avukat} [${(r.avukatid ?? "").slice(0, 8)}]`
            : r.avukat,
      adet: intOf(r.adet),
      hazirlikTamam: intOf(r.hazir),
      hazirlikOrani: ratioPercent(intOf(r.hazir), intOf(r.adet)),
      pay: ratioPercent(intOf(r.adet), total),
    })),
    params.limit,
  );

  const courtTable = finishTable(
    {
      key: "mahkeme",
      title: "Mahkeme kırılımı",
      definition: "Dosyanın mahkeme/daire adına göre. Mahkeme adı girilmemiş dosyalar boş satırda toplanır.",
      columns: [
        { key: "mahkeme", label: "Mahkeme / daire", type: "text" },
        { key: "adet", label: "Duruşma", type: "number" },
        { key: "pay", label: "Pay (%)", type: "percent" },
      ],
    },
    byCourt.map((r) => ({
      mahkeme: r.mahkeme ?? "(belirtilmemiş)",
      adet: intOf(r.adet),
      pay: ratioPercent(intOf(r.adet), total),
    })),
    params.limit,
  );

  const statusTable = finishTable(
    {
      key: "durum-tur",
      title: "Durum ve tür dağılımı",
      definition: "Duruşma durumu (planlandı/yapıldı/ertelendi...) ve türü.",
      columns: [
        { key: "kirilim", label: "Kırılım", type: "text" },
        { key: "deger", label: "Değer", type: "text" },
        { key: "adet", label: "Duruşma", type: "number" },
      ],
    },
    [
      ...byStatus.map((r) => ({ kirilim: "Durum", deger: r.status, adet: r._count._all })),
      ...byType.map((r) => ({ kirilim: "Tür", deger: r.type, adet: r._count._all })),
    ],
    params.limit,
  );

  const metrics = [
    countMetric("durusma", "Dönem içi duruşma", total, undefined),
    countMetric("hazirlikTamam", "Hazırlığı tamamlanan", prepared, undefined, {
      higherIsBetter: true,
    }),
    countMetric("mahkemeSayisi", "Farklı mahkeme/daire", byCourt.length, undefined),
    countMetric("avukatSayisi", "Duruşması olan avukat", byLawyer.filter((r) => r.avukat).length, undefined),
  ];

  const warnings: string[] = [];
  for (const t of [listTable, lawyerTable, courtTable, statusTable]) {
    const w = truncationWarning(t);
    if (w) warnings.push(w);
  }
  if (hearings.length >= Math.min(params.limit, 2000)) {
    warnings.push(
      "Duruşma listesi sorgu sınırına ulaştı; kırılım tabloları TÜM duruşmaları sayar ancak " +
        "liste kırpılmış olabilir. Dönemi daraltın.",
    );
  }

  return { metrics, tables: [listTable, lawyerTable, courtTable, statusTable], warnings };
};
