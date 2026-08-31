/**
 * AVUKAT İŞ YÜKÜ.
 *
 * ╔════════════════════════════════════════════════════════════════════════╗
 * ║  BU RAPOR BİR PERFORMANS DEĞERLENDİRME ARACI DEĞİLDİR.                 ║
 * ║  Amacı iş yükü DENGELEMESİDİR. Sayılar dosyaların ağırlığını,          ║
 * ║  karmaşıklığını, devir geçmişini ve kişinin izin/duruşma takvimini     ║
 * ║  içermez; kişi hakkında ölçüt olarak kullanılamaz.                     ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 *
 * Uyarı yalnız yorum satırında kalmaz: `notes` ile HER YANITTA döner
 * (report-catalog.ts) ve CSV künyesine yazılır.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ SATIR DÜZEYİ ROL DARALTMASI (denetim bulgusu 14).                        ║
 * ║                                                                          ║
 * ║ `report-access.ts` sözleşmesi açıktır: "AVUKAT ve SEKRETER kendi satırını ║
 * ║ görür; büro genelini yönetim görür." AI Kullanımı raporu bunu            ║
 * ║ uyguluyordu, bu rapor UYGULAMIYORDU — ve rapor STAJYER'e de açıktı       ║
 * ║ (`REPORT_ACCESS.IS_YUKU`). Yani stajyer `/reports/avukat-is-yuku`        ║
 * ║ çağırıp bütün ortakların sorumlu dosya, gecikmiş görev ve kritik süre    ║
 * ║ sayısını KİŞİ BAZINDA alabiliyordu. Katalog süzmesi bunu kapatmaz:       ║
 * ║ kısıt rapor düzeyindeydi, satır düzeyinde değildi.                       ║
 * ║                                                                          ║
 * ║ Daraltma SORGUNUN WHERE'İNE girer — yanıt süzülerek değil, veri hiç      ║
 * ║ çekilmeyerek kısıtlanır — ve `hiddenSections` ile kullanıcıya BİLDİRİLİR.║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * PERFORMANS: kullanıcı başına sorgu YOKTUR. Yedi toplu sorgu (`groupBy` +
 * tek `$queryRaw`) çalışır, birleştirme bellekte kullanıcı kimliği üzerinden
 * yapılır. 40 avukatlı bir büroda sorgu sayısı yine 7'dir.
 */

import type { UserRole } from "@nomosos/shared";
import { Prisma } from "@nomosos/db";
import type { PrismaService } from "../../prisma/prisma.service";
import { addDays, startOfDay } from "../../common/dates";
import { canSeeMoney, canSeeOtherUsers } from "../report-access";
import {
  ACTIVE_CASE_STATUSES,
  OPEN_DEADLINE_STATUSES,
  OPEN_TASK_STATUSES,
  countMetric,
  finishTable,
  intOf,
  minutesToHoursNumber,
  ratioPercent,
  truncationWarning,
} from "../report-helpers";
import type { ReportBody, ReportBuilder, ReportCell, ReportColumn } from "../report-types";

/** Kritik süre eşiği — Modül 18 kural 3 ile aynı: 3 gün veya daha az kalan. */
const CRITICAL_DAYS = 3;

interface Row {
  userId: string;
  fullName: string;
  role: UserRole;
  cases: number;
  openTasks: number;
  overdueTasks: number;
  criticalDeadlines: number;
  hearings: number;
  minutes: number;
  billableMinutes: number;
}

export const avukatIsYukuReport: ReportBuilder = async (ctx): Promise<ReportBody> => {
  const { user, prisma, params, now } = ctx;
  const tenantId = user.tenantId;
  const db: PrismaService["client"] = prisma.client;
  const today = startOfDay(now);
  const criticalUntil = addDays(today, CRITICAL_DAYS + 1);
  const range = { gte: params.period.from, lt: params.period.endExclusive };

  /**
   * Daraltma kararı — AI Kullanımı raporundaki desenin AYNISI.
   * Yönetim değilse KENDİ kullanıcı kimliği zorunlu süzgeçtir; `params.userId`
   * yalnız yönetimin başkasına bakabilmesi içindir.
   */
  const officeWide = canSeeOtherUsers(user);
  const restrictUserId = officeWide ? params.userId : user.userId;
  const restrictSql = restrictUserId
    ? Prisma.sql`AND c."responsibleUserId" = ${restrictUserId}`
    : Prisma.empty;

  const [users, caseRows, openTaskRows, overdueTaskRows, deadlineRows, hearingRows, timeRows] =
    await Promise.all([
      db.user.findMany({
        where: {
          tenantId,
          isActive: true,
          ...(restrictUserId ? { id: restrictUserId } : {}),
        },
        select: { id: true, fullName: true, role: true },
        orderBy: { fullName: "asc" },
      }),
      db.case.groupBy({
        by: ["responsibleUserId"],
        where: {
          tenantId,
          status: { in: ACTIVE_CASE_STATUSES },
          ...(restrictUserId ? { responsibleUserId: restrictUserId } : {}),
        },
        _count: { _all: true },
      }),
      db.task.groupBy({
        by: ["assigneeId"],
        where: {
          tenantId,
          status: { in: OPEN_TASK_STATUSES },
          ...(restrictUserId ? { assigneeId: restrictUserId } : {}),
        },
        _count: { _all: true },
      }),
      db.task.groupBy({
        by: ["assigneeId"],
        where: {
          tenantId,
          status: { in: OPEN_TASK_STATUSES },
          dueDate: { lt: today },
          ...(restrictUserId ? { assigneeId: restrictUserId } : {}),
        },
        _count: { _all: true },
      }),
      db.deadline.groupBy({
        by: ["ownerId"],
        where: {
          tenantId,
          status: { in: OPEN_DEADLINE_STATUSES },
          dueDate: { gte: today, lt: criticalUntil },
          ...(restrictUserId ? { ownerId: restrictUserId } : {}),
        },
        _count: { _all: true },
      }),
      // Duruşmalar dosyanın SORUMLU AVUKATINA bağlanır (Hearing'de kullanıcı alanı yok).
      db.$queryRaw<{ uid: string | null; n: number }[]>`
        SELECT c."responsibleUserId" AS uid, COUNT(*)::int AS n
          FROM "Hearing" h
          JOIN "Case" c ON c.id = h."caseId"
         WHERE h."tenantId" = ${tenantId}
           AND h."date" >= ${params.period.from}
           AND h."date" < ${params.period.endExclusive}
           ${restrictSql}
         GROUP BY c."responsibleUserId"
      `,
      db.timeEntry.groupBy({
        by: ["userId", "billable"],
        where: { tenantId, date: range, ...(restrictUserId ? { userId: restrictUserId } : {}) },
        _sum: { minutes: true },
      }),
    ]);

  const rows = new Map<string, Row>();
  for (const u of users) {
    rows.set(u.id, {
      userId: u.id,
      fullName: u.fullName,
      role: u.role,
      cases: 0,
      openTasks: 0,
      overdueTasks: 0,
      criticalDeadlines: 0,
      hearings: 0,
      minutes: 0,
      billableMinutes: 0,
    });
  }

  /**
   * LİSTEDE OLMAYAN KİMLİKLER SESSİZCE DÜŞMEZ (denetim bulgusu 18).
   *
   * `rows` haritası yalnız AKTİF kullanıcılarla kuruluyordu ve `touch` haritada
   * bulamadığı kimliği atıyordu. Dönem ortasında bürodan ayrılan bir avukatın
   * 4.800 dakikalık zaman kaydı ne satırda ne de "Toplam kayıtlı süre"
   * ölçüsünde görünüyordu — büro toplamı sessizce eksikti. Artık düşen her
   * kayıt sayılır ve ayrı bir ölçü + uyarı olarak bildirilir.
   */
  const dropped = {
    cases: 0,
    openTasks: 0,
    overdueTasks: 0,
    criticalDeadlines: 0,
    hearings: 0,
    minutes: 0,
  };

  const touch = (
    id: string | null,
    apply: (row: Row) => void,
    onDropped: () => void,
  ) => {
    if (!id) return; // Sorumlusu atanmamış kayıtlar ayrı ölçüde raporlanır.
    const row = rows.get(id);
    if (row) apply(row);
    else onDropped();
  };

  let unassignedCases = 0;
  for (const r of caseRows) {
    if (!r.responsibleUserId) unassignedCases += r._count._all;
    touch(
      r.responsibleUserId,
      (row) => (row.cases = r._count._all),
      () => (dropped.cases += r._count._all),
    );
  }
  for (const r of openTaskRows) {
    touch(
      r.assigneeId,
      (row) => (row.openTasks = r._count._all),
      () => (dropped.openTasks += r._count._all),
    );
  }
  for (const r of overdueTaskRows) {
    touch(
      r.assigneeId,
      (row) => (row.overdueTasks = r._count._all),
      () => (dropped.overdueTasks += r._count._all),
    );
  }
  for (const r of deadlineRows) {
    touch(
      r.ownerId,
      (row) => (row.criticalDeadlines = r._count._all),
      () => (dropped.criticalDeadlines += r._count._all),
    );
  }
  let unassignedHearings = 0;
  for (const r of hearingRows) {
    if (!r.uid) unassignedHearings += intOf(r.n);
    touch(
      r.uid,
      (row) => (row.hearings = intOf(r.n)),
      () => (dropped.hearings += intOf(r.n)),
    );
  }
  for (const r of timeRows) {
    const minutes = r._sum.minutes ?? 0;
    touch(
      r.userId,
      (row) => {
        row.minutes += minutes;
        if (r.billable) row.billableMinutes += minutes;
      },
      () => (dropped.minutes += minutes),
    );
  }

  // İşi olmayan kullanıcılar tabloyu şişirmesin; hiçbir ölçüsü olmayan satır düşer.
  const active = [...rows.values()].filter(
    (r) =>
      r.cases > 0 ||
      r.openTasks > 0 ||
      r.overdueTasks > 0 ||
      r.criticalDeadlines > 0 ||
      r.hearings > 0 ||
      r.minutes > 0,
  );
  active.sort((a, b) => b.cases - a.cases || b.openTasks - a.openTasks || a.fullName.localeCompare(b.fullName, "tr"));

  const showBillable = canSeeMoney(user);
  const hiddenSections: string[] = [];
  if (!showBillable) {
    hiddenSections.push(
      "Faturalanabilir oran sütunu rolünüz nedeniyle çıkarıldı (finans verisi erişimi yok).",
    );
  }
  if (!officeWide) {
    hiddenSections.push(
      "Bu rapor rolünüz nedeniyle YALNIZ KENDİ iş yükünüzü gösterir; büro genelindeki diğer " +
        "kullanıcıların dosya, görev ve süre dökümü sorguya hiç girmedi. Büro geneli görünüm " +
        "Yönetici ve Ortak rollerine açıktır.",
    );
  } else if (restrictUserId) {
    hiddenSections.push(
      "Rapor tek kullanıcıya daraltıldı (`kullaniciId` süzgeci); toplam ölçüler yalnız o " +
        "kullanıcıyı kapsar, büro geneli DEĞİLDİR.",
    );
  }

  const columns: ReportColumn[] = [
    { key: "avukat", label: "Avukat", type: "text" },
    { key: "rol", label: "Rol", type: "text" },
    { key: "sorumluDosya", label: "Sorumlu dosya (açık)", type: "number" },
    { key: "acikGorev", label: "Açık görev", type: "number" },
    { key: "gecikmisGorev", label: "Gecikmiş görev", type: "number" },
    { key: "kritikSure", label: "Kritik süre (≤3 gün)", type: "number" },
    { key: "durusma", label: "Dönem içi duruşma", type: "number" },
    { key: "calismaDakika", label: "Kayıtlı süre (dk)", type: "minutes" },
    { key: "calismaSaat", label: "Kayıtlı süre (saat)", type: "number" },
  ];
  if (showBillable) {
    columns.push(
      { key: "faturalanabilirDakika", label: "Faturalanabilir (dk)", type: "minutes" },
      { key: "faturalanabilirOran", label: "Faturalanabilir oran (%)", type: "percent" },
    );
  }

  const tableRows: Record<string, ReportCell>[] = active.map((r) => {
    const base: Record<string, ReportCell> = {
      avukat: r.fullName,
      rol: r.role,
      sorumluDosya: r.cases,
      acikGorev: r.openTasks,
      gecikmisGorev: r.overdueTasks,
      kritikSure: r.criticalDeadlines,
      durusma: r.hearings,
      calismaDakika: r.minutes,
      calismaSaat: minutesToHoursNumber(r.minutes),
    };
    if (showBillable) {
      base.faturalanabilirDakika = r.billableMinutes;
      base.faturalanabilirOran = ratioPercent(r.billableMinutes, r.minutes);
    }
    return base;
  });

  const table = finishTable(
    {
      key: "is-yuku",
      title: "Avukat iş yükü",
      definition:
        "Dosya/görev/süre sayıları ANLIK fotoğraftır (açık kayıtlar); duruşma ve çalışma " +
        "süresi DÖNEM İÇİDİR. Bu tablo performans ölçütü değildir." +
        (officeWide
          ? ""
          : " Rolünüz nedeniyle yalnız KENDİ satırınız gösterilir."),
      columns,
    },
    tableRows,
    params.limit,
  );

  const totalMinutes = active.reduce((sum, r) => sum + r.minutes, 0);
  const totalBillable = active.reduce((sum, r) => sum + r.billableMinutes, 0);

  const metrics = [
    countMetric("avukatSayisi", "Rapora giren kullanıcı", active.length, undefined, {
      definition: "En az bir açık dosya/görev/süre kaydı bulunan aktif kullanıcılar.",
    }),
    countMetric(
      "toplamAcikGorev",
      "Toplam açık görev",
      active.reduce((sum, r) => sum + r.openTasks, 0),
      undefined,
    ),
    countMetric(
      "toplamGecikmisGorev",
      "Toplam gecikmiş görev",
      active.reduce((sum, r) => sum + r.overdueTasks, 0),
      undefined,
      { higherIsBetter: false, critical: true },
    ),
    countMetric("sorumlusuzDosya", "Sorumlusu atanmamış açık dosya", unassignedCases, undefined, {
      higherIsBetter: false,
      definition: "Hiçbir avukata atanmadığı için iş yükü tablosunda görünmeyen dosyalar.",
    }),
    countMetric("toplamCalismaDakika", "Toplam kayıtlı süre (dk)", totalMinutes, undefined, {
      definition: officeWide
        ? restrictUserId
          ? "Yalnız süzgeçle seçilen kullanıcının süresi — büro toplamı DEĞİLDİR."
          : "Tablodaki aktif kullanıcıların toplamı; pasif kullanıcıların süresi ayrı ölçüdedir."
        : "Yalnız KENDİ kayıtlı süreniz — büro toplamı DEĞİLDİR.",
    }),
    countMetric(
      "listeDisiCalismaDakika",
      "Listede olmayan kullanıcının kayıtlı süresi (dk)",
      dropped.minutes,
      undefined,
      {
        higherIsBetter: false,
        definition:
          "Dönem içinde kaydedilmiş ama sahibi tabloda bulunmayan (pasifleşmiş, silinmiş ya da " +
          "süzgeç dışı kalmış kullanıcıya ait) çalışma süresi. Bu dakikalar kişi satırlarında " +
          "GÖRÜNMEZ; sessizce kaybolmasın diye ayrıca sayılır.",
      },
    ),
  ];
  if (showBillable) {
    metrics.push(
      countMetric("faturalanabilirDakika", "Faturalanabilir süre (dk)", totalBillable, undefined, {
        higherIsBetter: true,
      }),
    );
  }

  const warnings: string[] = [];
  const trunc = truncationWarning(table);
  if (trunc) warnings.push(trunc);
  if (unassignedCases > 0) {
    warnings.push(
      `${unassignedCases} açık dosyanın sorumlu avukatı atanmamış; bu dosyalar kişi ` +
        "satırlarında SAYILMAZ ve iş yükü dengesi eksik görünür.",
    );
  }
  if (unassignedHearings > 0) {
    warnings.push(
      `${unassignedHearings} duruşma, dosyasının sorumlusu atanmadığı için kişi satırlarına dağıtılamadı.`,
    );
  }
  if (totalMinutes === 0 && dropped.minutes === 0) {
    warnings.push(
      "Dönem içinde hiç zaman kaydı bulunmuyor; kayıtlı süre ve faturalanabilir oran " +
        "sütunları boş kalır. Bu, çalışılmadığı anlamına GELMEZ — zaman girişi yapılmamıştır.",
    );
  }
  const droppedTotal =
    dropped.cases + dropped.openTasks + dropped.overdueTasks + dropped.criticalDeadlines + dropped.hearings;
  if (droppedTotal > 0 || dropped.minutes > 0) {
    warnings.push(
      "Sahibi bu tabloda bulunmayan kayıtlar tablo dışında kaldı: " +
        `${dropped.cases} dosya, ${dropped.openTasks} açık görev, ${dropped.overdueTasks} gecikmiş görev, ` +
        `${dropped.criticalDeadlines} kritik süre, ${dropped.hearings} duruşma, ${dropped.minutes} dakika. ` +
        (officeWide
          ? "Bunlar pasifleşmiş veya silinmiş kullanıcılara aittir; iş yükü dengesi bu ölçüde eksik görünür."
          : "Bunlar başka kullanıcılara aittir ve rolünüz nedeniyle gösterilmez."),
    );
  }

  return { metrics, tables: [table], warnings, hiddenSections };
};
