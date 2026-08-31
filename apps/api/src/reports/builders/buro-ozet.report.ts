/**
 * BÜRO ÖZETİ — dönem içi faaliyet ve önceki dönemle karşılaştırma.
 *
 * TÜM RAKAMLAR VERİTABANINDAN. Karşılaştırma dönemi bitişik ve eşit uzunluktadır
 * (bkz. report-params.ts → previousPeriod), böylece yüzde değişim ay uzunluğundan
 * etkilenmez.
 *
 * TANIM SEÇİMLERİ (belirsiz olan her ölçü için AÇIKÇA yazılır — rapor okuyan
 * ortağın "bu sayı neyi sayıyor" diye sormasına gerek kalmasın):
 *
 *   yeniDosya       → `Case.openedAt` dönem içinde.
 *   kapananDosya    → `Case.closedAt` dönem içinde (durum değişimi değil, kapanış tarihi).
 *   durusma         → `Hearing.date` dönem içinde, durumdan bağımsız (ertelenen de sayılır).
 *   dilekce         → `Petition.createdAt` dönem içinde (sürüm sayısı DEĞİL, dilekçe sayısı).
 *   tamamlananGorev → `TaskStatusLog` içinde dönem içinde TAMAMLANDI'ya geçen FARKLI görev
 *                     sayısı. `Task.updatedAt` KULLANILMAZ: görev tamamlandıktan sonraki
 *                     herhangi bir düzenleme o alanı ileri taşır ve sayıyı yanlış döneme yazardı.
 *   aktifMuvekkil   → dönem içinde dosyası açılan, duruşması olan, finans hareketi ya da
 *                     zaman kaydı bulunan FARKLI müvekkil sayısı (tek sorguda UNION).
 *
 * PERFORMANS: 6 sayaç + 1 groupBy + 2 küme sorgusu, hepsi `Promise.all` ile ve
 * dönem başına bir kez. N+1 yoktur; müvekkil/dosya döngüsü kurulmaz.
 */

import { Prisma } from "@nomosos/db";
import type { PrismaService } from "../../prisma/prisma.service";
import { formatMoneyTr, moneyOut } from "../../finance/money";
import { canSeeMoney } from "../report-access";
import {
  ACCRUAL_TYPES,
  countMetric,
  decOf,
  finishTable,
  intOf,
  moneyMetric,
} from "../report-helpers";
import type {
  ReportBody,
  ReportBuilder,
  ReportCell,
  ReportMetric,
  ReportPeriod,
} from "../report-types";

interface PeriodTotals {
  newCases: number;
  closedCases: number;
  hearings: number;
  petitions: number;
  completedTasks: number;
  activeClients: number;
  /** Para birimi → { tahakkuk, tahsilat } */
  money: Map<string, { accrued: Prisma.Decimal; collected: Prisma.Decimal }>;
}

async function collect(
  prisma: PrismaService,
  tenantId: string,
  period: ReportPeriod,
): Promise<PeriodTotals> {
  const range = { gte: period.from, lt: period.endExclusive };
  const db = prisma.client;

  const [
    newCases,
    closedCases,
    hearings,
    petitions,
    completedTaskRows,
    activeClientRows,
    financialRows,
  ] = await Promise.all([
    db.case.count({ where: { tenantId, openedAt: range } }),
    db.case.count({ where: { tenantId, closedAt: range } }),
    db.hearing.count({ where: { tenantId, date: range } }),
    db.petition.count({ where: { tenantId, createdAt: range } }),
    // Tamamlanan görev: durum GÜNLÜĞÜNDEN, FARKLI görev sayısı.
    db.$queryRaw<{ n: number }[]>`
      SELECT COUNT(DISTINCT l."taskId")::int AS n
      FROM "TaskStatusLog" l
      JOIN "Task" t ON t.id = l."taskId"
      WHERE t."tenantId" = ${tenantId}
        AND l."toStatus"::text = 'TAMAMLANDI'
        AND l."createdAt" >= ${period.from}
        AND l."createdAt" < ${period.endExclusive}
    `,
    // Dönem içinde hareket gören farklı müvekkil — tek sorguda UNION.
    db.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM (
        SELECT c."clientId" AS id
          FROM "Case" c
         WHERE c."tenantId" = ${tenantId}
           AND c."openedAt" >= ${period.from} AND c."openedAt" < ${period.endExclusive}
        UNION
        SELECT f."clientId"
          FROM "FinancialEntry" f
         WHERE f."tenantId" = ${tenantId} AND f."clientId" IS NOT NULL
           AND f."date" >= ${period.from} AND f."date" < ${period.endExclusive}
        UNION
        SELECT te."clientId"
          FROM "TimeEntry" te
         WHERE te."tenantId" = ${tenantId} AND te."clientId" IS NOT NULL
           AND te."date" >= ${period.from} AND te."date" < ${period.endExclusive}
        UNION
        SELECT hc."clientId"
          FROM "Hearing" h
          JOIN "Case" hc ON hc.id = h."caseId"
         WHERE h."tenantId" = ${tenantId}
           AND h."date" >= ${period.from} AND h."date" < ${period.endExclusive}
      ) s
    `,
    db.financialEntry.groupBy({
      by: ["type", "currency"],
      where: { tenantId, date: range },
      _sum: { amount: true },
      orderBy: [{ type: "asc" }, { currency: "asc" }],
    }),
  ]);

  const money = new Map<string, { accrued: Prisma.Decimal; collected: Prisma.Decimal }>();
  const bucket = (currency: string) => {
    let found = money.get(currency);
    if (!found) {
      found = { accrued: new Prisma.Decimal(0), collected: new Prisma.Decimal(0) };
      money.set(currency, found);
    }
    return found;
  };
  for (const row of financialRows) {
    const amount = decOf(row._sum.amount);
    const target = bucket(row.currency);
    if (ACCRUAL_TYPES.includes(row.type)) target.accrued = target.accrued.plus(amount);
    // Net tahsilat = TAHSILAT − IADE (finance-summary.service.ts ile aynı sözleşme).
    if (row.type === "TAHSILAT") target.collected = target.collected.plus(amount);
    if (row.type === "IADE") target.collected = target.collected.minus(amount);
  }

  return {
    newCases,
    closedCases,
    hearings,
    petitions,
    completedTasks: intOf(completedTaskRows[0]?.n),
    activeClients: intOf(activeClientRows[0]?.n),
    money,
  };
}

/** Raporun ana para birimi: TRY varsa TRY, yoksa alfabetik ilk; hiç yoksa TRY. */
function primaryCurrency(current: PeriodTotals, previous?: PeriodTotals): string {
  const keys = new Set([...current.money.keys(), ...(previous?.money.keys() ?? [])]);
  if (keys.has("TRY") || keys.size === 0) return "TRY";
  return [...keys].sort()[0];
}

export const buroOzetReport: ReportBuilder = async (ctx): Promise<ReportBody> => {
  const { user, prisma, params } = ctx;
  const tenantId = user.tenantId;

  const [current, previous] = await Promise.all([
    collect(prisma, tenantId, params.period),
    params.comparison ? collect(prisma, tenantId, params.comparison) : Promise.resolve(undefined),
  ]);

  const showMoney = canSeeMoney(user);
  const currency = primaryCurrency(current, previous);
  const zero = new Prisma.Decimal(0);
  const cur = current.money.get(currency) ?? { accrued: zero, collected: zero };
  const prev = previous?.money.get(currency) ?? (previous ? { accrued: zero, collected: zero } : undefined);

  const metrics: ReportMetric[] = [
    countMetric("yeniDosya", "Yeni dosya", current.newCases, previous?.newCases, {
      higherIsBetter: true,
      definition: "Dosya açılış tarihi dönem içinde olan kayıtlar.",
    }),
    countMetric("kapananDosya", "Kapanan dosya", current.closedCases, previous?.closedCases, {
      definition: "Kapanış tarihi dönem içinde olan dosyalar.",
    }),
    countMetric("durusma", "Duruşma", current.hearings, previous?.hearings, {
      definition: "Duruşma tarihi dönem içinde olan tüm kayıtlar (ertelenenler dâhil).",
    }),
    countMetric("dilekce", "Üretilen dilekçe", current.petitions, previous?.petitions, {
      higherIsBetter: true,
      definition: "Dönem içinde oluşturulan dilekçe kaydı sayısı (sürüm değil).",
    }),
    countMetric("tamamlananGorev", "Tamamlanan görev", current.completedTasks, previous?.completedTasks, {
      higherIsBetter: true,
      definition: "Durum günlüğünde dönem içinde TAMAMLANDI'ya geçen farklı görev sayısı.",
    }),
    countMetric("aktifMuvekkil", "Hareket gören müvekkil", current.activeClients, previous?.activeClients, {
      higherIsBetter: true,
      definition:
        "Dönem içinde dosyası açılan, duruşması olan, finans hareketi veya zaman kaydı bulunan farklı müvekkil.",
    }),
  ];

  const hiddenSections: string[] = [];
  const warnings: string[] = [];
  const otherCurrencies = [...current.money.keys()].filter((c) => c !== currency).sort();

  if (showMoney) {
    const currencyNote =
      otherCurrencies.length > 0
        ? ` Bu kart YALNIZ ${currency} tutarını gösterir; ${otherCurrencies.join(", ")} ` +
          "hareketleri karta GİRMEZ — 'Para birimi kırılımı' tablosuna bakın."
        : "";
    metrics.push(
      moneyMetric("tahakkuk", "Tahakkuk", cur.accrued, prev?.accrued, currency, {
        higherIsBetter: true,
        definition:
          "Σ(TAHAKKUK, VEKALET_UCRETI, DANISMANLIK) — finans modülüyle aynı tanım." + currencyNote,
      }),
      moneyMetric("tahsilat", "Net tahsilat", cur.collected, prev?.collected, currency, {
        higherIsBetter: true,
        definition: "Σ(TAHSILAT) − Σ(IADE)." + currencyNote,
      }),
    );
    /**
     * KART İLE TABLO ARASINDAKİ FARK AÇIKÇA SÖYLENİR (denetim bulgusu 9).
     * Kârlılık ve yaşlandırma raporlarında bu uyarı vardı, Büro Özeti'nde
     * yoktu: 100.000 TRY + 50.000 USD tahakkukta kart yalnız "100.000,00 TL"
     * gösteriyor, ortak dönem cirosunu üçte bir eksik okuyordu.
     */
    if (otherCurrencies.length > 0) {
      warnings.push(
        `Dönemde ${otherCurrencies.length + 1} para birimi var. Tahakkuk ve tahsilat kartları ` +
          `YALNIZ ${currency} gösterir; ${otherCurrencies.join(", ")} tutarları "Para birimi ` +
          'kırılımı" tablosundadır. Kur çevrimi yapılmaz (şemada kur alanı yoktur).',
      );
    }
  } else {
    hiddenSections.push(
      "Tahakkuk ve tahsilat ölçüleri rolünüz nedeniyle rapordan çıkarıldı (finans verisi erişimi yok).",
    );
  }

  /* Ana tablo: ölçüler yan yana — CSV'de doğrudan basılabilir biçim.
   *
   * PARA HÜCRELERİ BU TABLODA TÜRKÇE BİÇİMDE VE PARA BİRİMİ EKİYLE YAZILIR.
   * Sütun `text`tir çünkü aynı sütunda hem adet (11) hem tutar (1234.56)
   * bulunur; tek bir sütun tipiyle ikisi birden ifade edilemez. Ham
   * `moneyOut` çıktısı ("1234.56") burada TEHLİKELİDİR: Türkçe Excel'de nokta
   * BİNLİK ayracıdır, dolayısıyla `1234.56` hücresi 123456 olarak okunur —
   * finansal bir raporda 100 katlık sessiz hata. Türkçe biçim + para birimi
   * eki hücreyi açıkça METİN yapar; toplanabilir/makine okunur para
   * `para-birimi` tablosunda `money` tipli sütunlarda durur.
   */
  const moneyCell = (value: ReportCell): ReportCell =>
    value === null || value === undefined ? null : formatMoneyTr(String(value), currency);

  const rows: Record<string, ReportCell>[] = metrics.map((m) => {
    const cell = m.type === "money" ? moneyCell : (v: ReportCell) => v;
    return {
      olcu: m.label,
      donem: cell(m.value),
      oncekiDonem: cell(m.previous ?? null),
      fark: cell(m.delta ?? null),
      degisimYuzde: m.deltaPercent ?? null,
      tanim: m.definition ?? "",
    };
  });

  const summaryTable = finishTable(
    {
      key: "kirilim",
      title: "Dönem ölçüleri",
      definition: `Dönem: ${params.period.label}${params.comparison ? ` · Karşılaştırma: ${params.comparison.label}` : ""}`,
      columns: [
        { key: "olcu", label: "Ölçü", type: "text" },
        { key: "donem", label: "Dönem", type: "text" },
        { key: "oncekiDonem", label: "Önceki dönem", type: "text" },
        { key: "fark", label: "Fark", type: "text" },
        { key: "degisimYuzde", label: "Değişim (%)", type: "percent" },
        { key: "tanim", label: "Tanım", type: "text" },
      ],
      // Sayı ve para karışık olduğu için hücreler METİN olarak taşınır; para
      // ölçüleri zaten `moneyOut` ile string'tir ve kuruş kaybı olmaz.
    },
    rows,
    params.limit,
  );

  const tables = [summaryTable];

  if (showMoney && current.money.size > 0) {
    const currencyRows: Record<string, ReportCell>[] = [...current.money.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, totals]) => ({
        paraBirimi: code,
        tahakkuk: moneyOut(totals.accrued),
        tahsilat: moneyOut(totals.collected),
        fark: moneyOut(totals.accrued.minus(totals.collected)),
      }));
    tables.push(
      finishTable(
        {
          key: "para-birimi",
          title: "Para birimi kırılımı",
          definition:
            "Para birimleri TOPLANMAZ; kur çevrimi yapılmaz (şemada kur alanı yoktur, uydurma kur kullanılmaz).",
          columns: [
            { key: "paraBirimi", label: "Para birimi", type: "text" },
            { key: "tahakkuk", label: "Tahakkuk", type: "money", currencyKey: "paraBirimi" },
            { key: "tahsilat", label: "Net tahsilat", type: "money", currencyKey: "paraBirimi" },
            { key: "fark", label: "Tahakkuk − Tahsilat", type: "money", currencyKey: "paraBirimi" },
          ],
        },
        currencyRows,
        params.limit,
      ),
    );
  }

  return { metrics, tables, hiddenSections, warnings };
};
