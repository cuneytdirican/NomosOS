/**
 * AI KULLANIMI VE KREDİ TÜKETİMİ (Modül 26).
 *
 * ROL DARALTMASI SUNUCUDADIR: Yönetici/Ortak büro genelini görür; Avukat ve
 * Sekreter YALNIZ KENDİ kullanımını görür. Daraltma sorgunun WHERE'ine girer —
 * yanıt süzülerek değil, veri hiç çekilmeyerek kısıtlanır.
 *
 * SAĞLAYICI MALİYETİ (`AiUsageLog.estimatedCost`) BU RAPORA GİRMEZ. Şema onu
 * açıkça "İÇ MUHASEBE — kullanıcıya GÖSTERİLMEZ" diye işaretler; kiracı
 * panelinde marj bilgisinin sızması ürün kararına aykırıdır.
 *
 * İKİ KAYNAK, TEK MUTABAKAT: kredi rakamı hem `AiUsageLog.creditsCharged`
 * toplamından hem de `CreditTransaction` (TUKETIM) hareket defterinden okunur.
 * İkisi tutmuyorsa rapor UYARI döndürür — sessizce birini seçmek, kredi
 * muhasebesindeki bir kaymayı görünmez kılardı. BYO-LLM kiracısında iki değer
 * de sıfırdır (kredi hattı devrede değildir), bu bir hata değildir.
 */

import { Prisma } from "@nomosos/db";
import { canSeeOtherUsers } from "../report-access";
import {
  countMetric,
  decOf,
  finishTable,
  intOf,
  percentMetric,
  ratioPercent,
  truncationWarning,
} from "../report-helpers";
import type { PrismaService } from "../../prisma/prisma.service";
import type { ReportBody, ReportBuilder, ReportCell, ReportPeriod } from "../report-types";

interface MatrixRow {
  tasktype: string;
  userid: string | null;
  username: string;
  calls: number;
  credits: number;
  maskedcalls: number;
}

async function loadMatrix(
  prisma: PrismaService,
  tenantId: string,
  period: ReportPeriod,
  restrictUserId: string | undefined,
): Promise<MatrixRow[]> {
  const userFilter = restrictUserId
    ? Prisma.sql`AND l."userId" = ${restrictUserId}`
    : Prisma.empty;
  return prisma.client.$queryRaw<MatrixRow[]>`
    SELECT l."taskType"                                   AS tasktype,
           l."userId"                                     AS userid,
           COALESCE(u."fullName", '(kullanıcı kaydı yok)') AS username,
           COUNT(*)::int                                  AS calls,
           COALESCE(SUM(l."creditsCharged"), 0)::int      AS credits,
           COUNT(*) FILTER (WHERE l."piiMasked")::int     AS maskedcalls
      FROM "AiUsageLog" l
      LEFT JOIN "User" u ON u.id = l."userId"
     WHERE l."tenantId" = ${tenantId}
       AND l."createdAt" >= ${period.from}
       AND l."createdAt" < ${period.endExclusive}
       ${userFilter}
     GROUP BY l."taskType", l."userId", u."fullName"
     ORDER BY 5 DESC, 4 DESC
  `;
}

export const aiKullanimReport: ReportBuilder = async (ctx): Promise<ReportBody> => {
  const { user, prisma, params } = ctx;
  const tenantId = user.tenantId;
  const db = prisma.client;

  /**
   * Daraltma kararı: yönetim değilse KENDİ kullanıcı kimliği zorunlu süzgeçtir.
   * `params.userId` yalnız yönetimin başkasına bakabilmesi içindir.
   */
  const officeWide = canSeeOtherUsers(user);
  const restrictUserId = officeWide ? params.userId : user.userId;

  const creditWhere = {
    tenantId,
    type: "TUKETIM" as const,
    createdAt: { gte: params.period.from, lt: params.period.endExclusive },
    ...(restrictUserId ? { userId: restrictUserId } : {}),
  };

  const [matrix, previousMatrix, creditRows, previousCredits] = await Promise.all([
    loadMatrix(prisma, tenantId, params.period, restrictUserId),
    params.comparison
      ? loadMatrix(prisma, tenantId, params.comparison, restrictUserId)
      : Promise.resolve([] as MatrixRow[]),
    db.creditTransaction.groupBy({
      by: ["taskType"],
      where: creditWhere,
      _sum: { amount: true },
      _count: { _all: true },
    }),
    params.comparison
      ? db.creditTransaction.aggregate({
          where: {
            ...creditWhere,
            createdAt: { gte: params.comparison.from, lt: params.comparison.endExclusive },
          },
          _sum: { amount: true },
        })
      : Promise.resolve(undefined),
  ]);

  /**
   * KİŞİ ETİKETİ KİMLİKTEN TÜRETİLİR (denetim bulgusu 17).
   * Aynı adı taşıyan iki kullanıcı aynı etiketi paylaşırsa, okuyucu iki kişinin
   * kullanımını tek kişiye yazar. Sorgu zaten `userId` bazında gruplar; ad
   * çakışıyorsa kimliğin ilk parçası eklenir.
   */
  const nameOwners = new Map<string, Set<string>>();
  for (const r of matrix) {
    const owners = nameOwners.get(r.username) ?? new Set<string>();
    owners.add(r.userid ?? "(kayit-yok)");
    nameOwners.set(r.username, owners);
  }
  const userLabel = (key: string, name: string): string =>
    (nameOwners.get(name)?.size ?? 0) > 1 && key !== "(kayit-yok)"
      ? `${name} [${key.slice(0, 8)}]`
      : name;

  const totalCalls = matrix.reduce((sum, r) => sum + intOf(r.calls), 0);
  const totalCreditsFromLog = matrix.reduce((sum, r) => sum + intOf(r.credits), 0);
  const totalMasked = matrix.reduce((sum, r) => sum + intOf(r.maskedcalls), 0);
  const previousCalls = previousMatrix.reduce((sum, r) => sum + intOf(r.calls), 0);
  const previousCreditsFromLog = previousMatrix.reduce((sum, r) => sum + intOf(r.credits), 0);

  // TUKETIM hareketleri NEGATİF yazılır; mutlak değeri tüketilen kredidir.
  const totalCreditsFromLedger = creditRows
    .reduce((sum, r) => sum.plus(decOf(r._sum.amount)), new Prisma.Decimal(0))
    .abs()
    .toNumber();
  const previousLedger =
    previousCredits === undefined
      ? undefined
      : decOf(previousCredits._sum.amount).abs().toNumber();

  /* ── Görev tipi × kullanıcı matrisi ── */
  const matrixTable = finishTable(
    {
      key: "gorev-kullanici",
      title: "Görev tipi × kullanıcı",
      definition:
        "Dönem içi AI çağrıları. Kredi sütunu `AiUsageLog.creditsCharged` toplamıdır; " +
        "ücretsiz görevlerde ve BYO-LLM kiracısında 0'dır. Sağlayıcı maliyeti gösterilmez.",
      columns: [
        { key: "gorevTipi", label: "Görev tipi", type: "text" },
        { key: "kullanici", label: "Kullanıcı", type: "text" },
        { key: "cagri", label: "Çağrı", type: "number" },
        { key: "kredi", label: "Kredi", type: "number" },
        { key: "cagriBasinaKredi", label: "Çağrı başına kredi", type: "number" },
        { key: "maskelenen", label: "KVKK maskelenen çağrı", type: "number" },
      ],
    },
    matrix.map((r) => ({
      gorevTipi: r.tasktype,
      kullanici: userLabel(r.userid ?? "(kayit-yok)", r.username),
      cagri: intOf(r.calls),
      kredi: intOf(r.credits),
      cagriBasinaKredi:
        intOf(r.calls) > 0 ? Math.round((intOf(r.credits) / intOf(r.calls)) * 100) / 100 : 0,
      maskelenen: intOf(r.maskedcalls),
    })),
    params.limit,
  );

  /* ── Görev tipi toplamı (matristen türetilir, ek sorgu yok) ── */
  const byTask = new Map<string, { calls: number; credits: number; masked: number }>();
  for (const r of matrix) {
    const entry = byTask.get(r.tasktype) ?? { calls: 0, credits: 0, masked: 0 };
    entry.calls += intOf(r.calls);
    entry.credits += intOf(r.credits);
    entry.masked += intOf(r.maskedcalls);
    byTask.set(r.tasktype, entry);
  }
  const ledgerByTask = new Map(
    creditRows.map((r) => [r.taskType ?? "(görev tipi yok)", decOf(r._sum.amount).abs().toNumber()]),
  );

  const taskTable = finishTable(
    {
      key: "gorev-tipi",
      title: "Görev tipi toplamları",
      definition:
        "`Kredi (kullanım günlüğü)` ile `Kredi (hareket defteri)` normalde eşittir; fark, " +
        "kredi muhasebesinde incelenmesi gereken bir kayma anlamına gelir.",
      columns: [
        { key: "gorevTipi", label: "Görev tipi", type: "text" },
        { key: "cagri", label: "Çağrı", type: "number" },
        { key: "krediGunluk", label: "Kredi (kullanım günlüğü)", type: "number" },
        { key: "krediDefter", label: "Kredi (hareket defteri)", type: "number" },
        { key: "pay", label: "Çağrı payı (%)", type: "percent" },
      ],
    },
    [...byTask.entries()]
      .sort((a, b) => b[1].credits - a[1].credits || b[1].calls - a[1].calls)
      .map(([taskType, v]) => ({
        gorevTipi: taskType,
        cagri: v.calls,
        krediGunluk: v.credits,
        krediDefter: ledgerByTask.get(taskType) ?? 0,
        pay: ratioPercent(v.calls, totalCalls),
      })),
    params.limit,
  );

  /**
   * Kullanıcı toplamı — ANAHTAR KULLANICI KİMLİĞİDİR, ADI DEĞİL.
   *
   * `r.username` ile anahtarlamak, aynı adı taşıyan iki kişiyi tek satırda
   * birleştiriyordu; silinmiş kullanıcıların hepsi de tek `(kullanıcı kaydı
   * yok)` satırında toplanıyordu (denetim bulgusu 17). Kimlik zaten sorgudan
   * geliyor; kullanılmaması bir gözden kaçmaydı.
   */
  const byUser = new Map<string, { name: string; calls: number; credits: number }>();
  for (const r of matrix) {
    const key = r.userid ?? "(kayit-yok)";
    const entry = byUser.get(key) ?? { name: r.username, calls: 0, credits: 0 };
    entry.calls += intOf(r.calls);
    entry.credits += intOf(r.credits);
    byUser.set(key, entry);
  }

  const userTable = finishTable(
    {
      key: "kullanici",
      title: officeWide ? "Kullanıcı toplamları" : "Kendi kullanımınız",
      definition: officeWide
        ? "Büro genelindeki tüm kullanıcılar."
        : "Rolünüz gereği rapor yalnız kendi kullanımınızı içerir.",
      columns: [
        { key: "kullanici", label: "Kullanıcı", type: "text" },
        { key: "cagri", label: "Çağrı", type: "number" },
        { key: "kredi", label: "Kredi", type: "number" },
        { key: "pay", label: "Kredi payı (%)", type: "percent" },
      ],
    },
    [...byUser.entries()]
      .sort((a, b) => b[1].credits - a[1].credits || b[1].calls - a[1].calls)
      .map(([key, v]) => ({
        kullanici: userLabel(key, v.name),
        cagri: v.calls,
        kredi: v.credits,
        pay: ratioPercent(v.credits, totalCreditsFromLog),
      })),
    params.limit,
  );

  const metrics = [
    countMetric("cagri", "AI çağrısı", totalCalls, params.comparison ? previousCalls : undefined, {
      definition: "Dönem içinde kayda geçen tüm AI çağrıları (ücretsiz görevler dâhil).",
    }),
    countMetric(
      "kredi",
      "Tüketilen kredi",
      totalCreditsFromLog,
      params.comparison ? previousCreditsFromLog : undefined,
      { higherIsBetter: false, definition: "`AiUsageLog.creditsCharged` toplamı." },
    ),
    countMetric(
      "krediDefter",
      "Tüketilen kredi (hareket defteri)",
      totalCreditsFromLedger,
      previousLedger,
      { higherIsBetter: false, definition: "`CreditTransaction` TUKETIM hareketlerinin mutlak toplamı." },
    ),
    countMetric("gorevTipiSayisi", "Kullanılan görev tipi", byTask.size, undefined),
    countMetric("kullaniciSayisi", "AI kullanan kişi", byUser.size, undefined),
    percentMetric(
      "maskelemeOrani",
      "KVKK maskelemesi uygulanan çağrı (%)",
      ratioPercent(totalMasked, totalCalls),
      undefined,
      {
        definition:
          "Dış sağlayıcıya gönderilmeden önce kişisel verisi maskelenen çağrıların oranı.",
      },
    ),
  ];

  const warnings: string[] = [];
  for (const t of [matrixTable, taskTable, userTable]) {
    const w = truncationWarning(t);
    if (w) warnings.push(w);
  }
  if (totalCreditsFromLog !== totalCreditsFromLedger) {
    warnings.push(
      `MUTABAKAT UYARISI: kullanım günlüğü ${totalCreditsFromLog} kredi, hareket defteri ` +
        `${totalCreditsFromLedger} kredi gösteriyor. Fark ${Math.abs(totalCreditsFromLog - totalCreditsFromLedger)} ` +
        "kredidir. Dönem sınırında başlayıp biten bir çağrı iki kaydı farklı dönemlere " +
        "düşürebilir; fark sürekliyse kredi muhasebesi incelenmelidir.",
    );
  }
  if (!officeWide) {
    warnings.push(
      "Rolünüz gereği bu rapor yalnız KENDİ AI kullanımınızı içerir; büro geneli rakamlar " +
        "Yönetici ve Ortak rollerine gösterilir.",
    );
  }

  const hiddenSections = officeWide
    ? []
    : ["Diğer kullanıcıların AI kullanımı rolünüz nedeniyle rapora dâhil edilmedi."];

  return { metrics, tables: [matrixTable, taskTable, userTable], warnings, hiddenSections };
};
