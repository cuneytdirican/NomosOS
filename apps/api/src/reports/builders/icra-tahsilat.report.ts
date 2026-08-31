/**
 * İCRA TAHSİLAT — aşama dağılımı, tahsil edilen / kalan, ortalama tahsilat süresi.
 *
 * HESAP SÖZLEŞMESİ:
 *   kalan = asıl alacak (principalAmount) − tahsilat toplamı
 *
 * FAİZ, HARÇ VE MASRAF DÂHİL DEĞİLDİR. İcra modülünün faiz hesabı
 * deterministiktir ama dosyaya özgü tarih/oran girdilerine dayanır; bu raporda
 * tüm dosyalar için faiz işletmek, bir raporlama ucunun parasal hüküm kurması
 * olurdu. Güncel borç bakiyesi için icra dosyasının kendi bakiye ucuna bakılır —
 * bu ayrım tablonun tanım satırında yazılıdır.
 *
 * ORTALAMA TAHSİLAT SÜRESİ: takip talebi tarihinden İLK TAHSİLATA kadar geçen
 * gün sayısının ortalamasıdır (hiç tahsilat görmemiş dosyalar ortalamaya
 * GİRMEZ — girseydi ortalama "henüz tahsil edilmemiş" dosyalarla suni olarak
 * uzardı ve ölçü anlamını yitirirdi). Kaç dosya üzerinden hesaplandığı ayrıca döner.
 *
 * DÖNEM SEMANTİĞİ: aşama dağılımı ve kalan bakiye dönem sonu FOTOĞRAFIDIR;
 * "dönem içi tahsilat" ölçüsü ise akıştır. İkisi tablo tanımlarında ayrılır.
 */

import { Prisma } from "@nomosos/db";
import { moneyOut } from "../../finance/money";
import {
  countMetric,
  decOf,
  finishTable,
  intOf,
  isoDay,
  moneyMetric,
  ratioPercent,
  takeWithProbe,
  truncationWarning,
} from "../report-helpers";
import type { ReportBody, ReportBuilder, ReportCell } from "../report-types";

interface StageRow {
  stage: string;
  dosya: number;
  anapara: Prisma.Decimal | null;
  tahsil: Prisma.Decimal | null;
}

interface FileRow {
  id: string;
  fileNumber: string;
  officeName: string;
  trackingType: string;
  stage: string;
  currency: string;
  principalAmount: Prisma.Decimal;
  requestDate: Date;
  closedAt: Date | null;
  caseTitle: string;
  clientName: string;
  tahsil: Prisma.Decimal | null;
  ilkTahsilat: Date | null;
}

export const icraTahsilatReport: ReportBuilder = async (ctx): Promise<ReportBody> => {
  const { user, prisma, params } = ctx;
  const tenantId = user.tenantId;
  const db = prisma.client;
  const from = params.period.from;
  const end = params.period.endExclusive;

  const [stageRows, periodCollections, durationRows, fileRows, currencyRows] = await Promise.all([
    db.$queryRaw<StageRow[]>`
      SELECT ef.stage::text        AS stage,
             COUNT(*)::int         AS dosya,
             SUM(ef."principalAmount") AS anapara,
             COALESCE(SUM(col.total), 0) AS tahsil
        FROM "EnforcementFile" ef
        LEFT JOIN LATERAL (
          SELECT SUM(c.amount) AS total
            FROM "CollectionRecord" c
           WHERE c."enforcementFileId" = ef.id
        ) col ON TRUE
       WHERE ef."tenantId" = ${tenantId}
       GROUP BY ef.stage
       ORDER BY 2 DESC
    `,
    db.collectionRecord.groupBy({
      by: ["method"],
      where: { tenantId, date: { gte: from, lt: end } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.$queryRaw<{ gun: number | null; dosya: number }[]>`
      SELECT AVG(
               EXTRACT(EPOCH FROM (fc.first_col - ef."requestDate")) / 86400.0
             )::float8 AS gun,
             COUNT(*)::int AS dosya
        FROM "EnforcementFile" ef
        JOIN LATERAL (
          SELECT MIN(c."date") AS first_col
            FROM "CollectionRecord" c
           WHERE c."enforcementFileId" = ef.id
        ) fc ON TRUE
       WHERE ef."tenantId" = ${tenantId}
         AND fc.first_col IS NOT NULL
    `,
    db.$queryRaw<FileRow[]>`
      SELECT ef.id,
             ef."fileNumber",
             ef."officeName",
             ef."trackingType"::text AS "trackingType",
             ef.stage::text          AS stage,
             ef.currency,
             ef."principalAmount",
             ef."requestDate",
             ef."closedAt",
             c.title  AS "caseTitle",
             cl.name  AS "clientName",
             COALESCE(col.total, 0) AS tahsil,
             col.first_col          AS "ilkTahsilat"
        FROM "EnforcementFile" ef
        JOIN "Case"   c  ON c.id  = ef."caseId"
        JOIN "Client" cl ON cl.id = c."clientId"
        LEFT JOIN LATERAL (
          SELECT SUM(cr.amount) AS total, MIN(cr."date") AS first_col
            FROM "CollectionRecord" cr
           WHERE cr."enforcementFileId" = ef.id
        ) col ON TRUE
       WHERE ef."tenantId" = ${tenantId}
       ORDER BY (ef."principalAmount" - COALESCE(col.total, 0)) DESC
       -- limit + 1: fazladan gelen satir "sinira dayanildi" kanitidir. Eski
       -- min(limit, 1000) sessizce kirpiyor, finishTable elindeki kisa
       -- diziye bakip "kirpilmadi" diyordu (denetim bulgusu 4).
       LIMIT ${takeWithProbe(params.limit)}
    `,
    db.enforcementFile.groupBy({
      by: ["currency"],
      where: { tenantId },
      _count: { _all: true },
    }),
  ]);

  const totalFiles = stageRows.reduce((sum, r) => sum + intOf(r.dosya), 0);
  const totalPrincipal = stageRows.reduce((sum, r) => sum.plus(decOf(r.anapara)), new Prisma.Decimal(0));
  const totalCollected = stageRows.reduce((sum, r) => sum.plus(decOf(r.tahsil)), new Prisma.Decimal(0));
  const totalRemaining = totalPrincipal.minus(totalCollected);

  const periodCollected = periodCollections.reduce(
    (sum, r) => sum.plus(decOf(r._sum.amount)),
    new Prisma.Decimal(0),
  );
  const periodCollectionCount = periodCollections.reduce((sum, r) => sum + r._count._all, 0);

  const avgDays = durationRows[0]?.gun;
  const avgDaysFileCount = intOf(durationRows[0]?.dosya);

  const primaryCurrency =
    currencyRows.find((r) => r.currency === "TRY")?.currency ?? currencyRows[0]?.currency ?? "TRY";

  /* ── Aşama dağılımı ── */
  const stageTable = finishTable(
    {
      key: "asama",
      title: "Aşama dağılımı",
      definition:
        "Dönem sonu fotoğrafı. Tahsilat sütunu dosyanın TÜM ZAMANLARDAKİ tahsilatıdır " +
        "(dönem içi değil); kalan = asıl alacak − tahsilat, FAİZ VE MASRAF HARİÇ.",
      columns: [
        { key: "asama", label: "Aşama", type: "text" },
        { key: "dosya", label: "Dosya", type: "number" },
        { key: "pay", label: "Pay (%)", type: "percent" },
        { key: "anapara", label: "Asıl alacak", type: "money" },
        { key: "tahsil", label: "Tahsil edilen", type: "money" },
        { key: "kalan", label: "Kalan", type: "money" },
        { key: "tahsilOrani", label: "Tahsil oranı (%)", type: "percent" },
      ],
    },
    stageRows.map((r) => {
      const principal = decOf(r.anapara);
      const collected = decOf(r.tahsil);
      return {
        asama: r.stage,
        dosya: intOf(r.dosya),
        pay: ratioPercent(intOf(r.dosya), totalFiles),
        anapara: moneyOut(principal),
        tahsil: moneyOut(collected),
        kalan: moneyOut(principal.minus(collected)),
        tahsilOrani: principal.isZero()
          ? 0
          : Math.round(collected.div(principal).mul(10000).toNumber()) / 100,
      };
    }),
    params.limit,
  );

  /* ── Dönem içi tahsilat yöntemi ── */
  const methodTable = finishTable(
    {
      key: "yontem",
      title: "Dönem içi tahsilat (yöntem kırılımı)",
      definition: "Tahsilat tarihi dönem içinde olan kayıtlar.",
      columns: [
        { key: "yontem", label: "Yöntem", type: "text" },
        { key: "adet", label: "Kayıt", type: "number" },
        { key: "tutar", label: "Tutar", type: "money" },
        { key: "pay", label: "Pay (%)", type: "percent" },
      ],
    },
    periodCollections
      .map((r) => {
        const amount = decOf(r._sum.amount);
        return {
          yontem: r.method,
          adet: r._count._all,
          tutar: moneyOut(amount),
          pay: periodCollected.isZero()
            ? 0
            : Math.round(amount.div(periodCollected).mul(10000).toNumber()) / 100,
        };
      })
      .sort((a, b) => Number(b.pay) - Number(a.pay)),
    params.limit,
  );

  /* ── Dosya ayrıntısı ── */
  const detailTruncated = fileRows.length > params.limit;
  const detailRows: Record<string, ReportCell>[] = fileRows.map((f) => {
    const principal = decOf(f.principalAmount);
    const collected = decOf(f.tahsil);
    return {
      icraDairesi: f.officeName,
      dosyaNo: f.fileNumber,
      takipTuru: f.trackingType,
      asama: f.stage,
      muvekkil: f.clientName,
      dosya: f.caseTitle,
      paraBirimi: f.currency,
      anapara: moneyOut(principal),
      tahsil: moneyOut(collected),
      kalan: moneyOut(principal.minus(collected)),
      takipTarihi: isoDay(f.requestDate),
      ilkTahsilat: isoDay(f.ilkTahsilat),
      kapanis: isoDay(f.closedAt),
    };
  });

  const detailTable = finishTable(
    {
      key: "dosyalar",
      title: "İcra dosyaları (kalan bakiyeye göre)",
      definition: "Kalan = asıl alacak − tahsilat. Faiz, harç ve masraf dâhil DEĞİLDİR.",
      columns: [
        { key: "icraDairesi", label: "İcra dairesi", type: "text" },
        { key: "dosyaNo", label: "Dosya no", type: "text" },
        { key: "takipTuru", label: "Takip türü", type: "text" },
        { key: "asama", label: "Aşama", type: "text" },
        { key: "muvekkil", label: "Müvekkil", type: "text" },
        { key: "dosya", label: "Dosya", type: "text" },
        { key: "paraBirimi", label: "Para birimi", type: "text" },
        { key: "anapara", label: "Asıl alacak", type: "money", currencyKey: "paraBirimi" },
        { key: "tahsil", label: "Tahsil edilen", type: "money", currencyKey: "paraBirimi" },
        { key: "kalan", label: "Kalan", type: "money", currencyKey: "paraBirimi" },
        { key: "takipTarihi", label: "Takip talebi", type: "date" },
        { key: "ilkTahsilat", label: "İlk tahsilat", type: "date" },
        { key: "kapanis", label: "Kapanış", type: "date" },
      ],
    },
    detailRows,
    params.limit,
    { queryLimitReached: detailTruncated },
  );

  const metrics = [
    countMetric("dosyaSayisi", "İcra dosyası", totalFiles, undefined),
    moneyMetric("anapara", "Toplam asıl alacak", totalPrincipal, undefined, primaryCurrency),
    moneyMetric("tahsil", "Toplam tahsil edilen", totalCollected, undefined, primaryCurrency, {
      higherIsBetter: true,
    }),
    moneyMetric("kalan", "Toplam kalan", totalRemaining, undefined, primaryCurrency, {
      higherIsBetter: false,
      definition: "Asıl alacak − tahsilat. Faiz ve masraf dâhil değildir.",
    }),
    moneyMetric("donemTahsilat", "Dönem içi tahsilat", periodCollected, undefined, primaryCurrency, {
      higherIsBetter: true,
    }),
    countMetric("donemTahsilatAdet", "Dönem içi tahsilat kaydı", periodCollectionCount, undefined),
  ];

  metrics.push({
    key: "ortalamaTahsilatGun",
    label: "Ortalama ilk tahsilat süresi (gün)",
    type: "number",
    value: avgDays === null || avgDays === undefined ? null : Math.round(Number(avgDays) * 10) / 10,
    higherIsBetter: false,
    definition:
      `Takip talebinden ilk tahsilata kadar geçen ortalama gün. ${avgDaysFileCount} dosya ` +
      "üzerinden hesaplandı; hiç tahsilat görmemiş dosyalar ortalamaya girmez.",
  });

  const warnings: string[] = [];
  for (const t of [stageTable, methodTable, detailTable]) {
    const w = truncationWarning(t);
    if (w) warnings.push(w);
  }
  if (currencyRows.length > 1) {
    warnings.push(
      `İcra dosyaları ${currencyRows.length} farklı para biriminde; toplam ölçüler farklı ` +
        "para birimlerini yan yana toplar. Kur çevrimi yapılmaz.",
    );
  }
  if (avgDaysFileCount === 0) {
    warnings.push(
      "Hiçbir icra dosyasında tahsilat kaydı bulunmadığı için ortalama tahsilat süresi hesaplanamadı.",
    );
  }

  return { metrics, tables: [stageTable, methodTable, detailTable], warnings };
};
