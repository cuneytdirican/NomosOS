/**
 * KÂRLILIK — dosya / müvekkil bazında brüt katkı ve süre değeriyle karşılaştırma.
 *
 * ╔════════════════════════════════════════════════════════════════════════╗
 * ║  YALNIZ PARTNER / ADMIN. Bu bir MALİYET MUHASEBESİ çıktısı DEĞİLDİR.   ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 *
 * HESAP SÖZLEŞMESİ (hepsi Prisma.Decimal, float YOK):
 *   tahakkuk    = Σ(TAHAKKUK, VEKALET_UCRETI, DANISMANLIK)   ← finans modülüyle aynı
 *   masraf      = Σ(MASRAF, HARC)
 *   brütKatkı   = tahakkuk − masraf
 *   süreDeğeri  = Σ(dakika × saatlikÜcret) / 60
 *   fark        = brütKatkı − süreDeğeri
 *   efektifSaat = tahakkuk / (dakika / 60)                    ← saat başına tahakkuk
 *
 * SAATLİK ÜCRET NEREDEN GELİR: önce zaman kaydının kendi `hourlyRate` alanı
 * (kayıt anındaki ücret — sözleşme sonradan değişse de geçmiş bozulmaz), yoksa
 * DOSYANIN aktif ücret sözleşmesi, o da yoksa MÜVEKKİLİN aktif sözleşmesi.
 * HİÇBİRİ YOKSA o dakikalar süre değerine GİRMEZ ve satırda "ücretsiz dakika"
 * olarak raporlanır + uyarı döner. Varsayılan bir saat ücreti UYDURULMAZ:
 * uydurulan her ücret, kârlılık tablosunda gerçekmiş gibi görünen bir
 * zarar/kâr üretirdi.
 *
 * SÖZLEŞME TARİH ARALIĞI DA ARANIR (`startDate <= kayıt tarihi <= endDate`):
 * işten sonra imzalanmış bir sözleşmenin ücretini geçmiş kayıtlara uygulamak,
 * o dosyanın geçmiş kârlılığını sonradan değiştirmek olurdu.
 *
 * GENEL GİDER, PERSONEL MALİYETİ, VERGİ HESABA KATILMAZ. "Brüt katkı" adı
 * bilinçlidir; bu sayı "kâr" değildir.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SATIR EVRENİ = FİNANS ∪ SÜRE (denetim bulguları 1 ve 2)
 *
 * Eskiden satır listesini YALNIZ `FinancialEntry` sürüyordu ve bunun iki ayrı
 * sonucu vardı:
 *
 *  1. ÇİFT SAYIM. Finans satırları `GROUP BY … , currency` ile üretilir; TRY ve
 *     USD hareketi olan bir dosya İKİ satır döner. Süre haritası yalnız grup
 *     kimliğiyle anahtarlı olduğu için aynı `TimeEntry` toplamı iki satıra da
 *     uygulanıyor, toplamlara İKİ KEZ giriyordu: 600 dakika 1.200 dakika,
 *     10.000 TL süre değeri 20.000 TL görünüyordu.
 *
 *  2. ZARAR EDEN DOSYALAR HİÇ GÖRÜNMÜYORDU. Dönem içinde 200 saat çalışılmış
 *     ama henüz fatura kesilmemiş bir dosyanın finans satırı yoktur; dolayısıyla
 *     tabloda da, toplamlarda da yer almıyordu. Kârlılık raporunun ASIL ARADIĞI
 *     ŞEY tam olarak budur — "Brüt katkı − süre değeri" ölçüsü o dosyanın
 *     süre değeri kadar OLUMLU yönde yanılıyordu.
 *
 * Bugünkü kural: süre toplamları `timeRows` üzerinden BİR KEZ hesaplanır (para
 * birimine bölünemez — `TimeEntry`de para birimi alanı yoktur), süre sütunları
 * her grubun YALNIZ İLK satırında yazılır, tekrar eden para birimi satırlarında
 * `null` bırakılır. Süresi olup finans hareketi olmayan gruplar için tahakkuk/
 * masrafı sıfır olan satır üretilir; adları ikinci bir sorguyla çözülür.
 */

import { Prisma } from "@nomosos/db";
import { moneyOut } from "../../finance/money";
import { assertReportAccess, REPORT_ACCESS } from "../report-access";
import {
  compareDescending,
  countMetric,
  decOf,
  finishTable,
  intOf,
  minutesToHoursNumber,
  moneyMetric,
  truncationWarning,
} from "../report-helpers";
import type { ReportBody, ReportBuilder, ReportCell } from "../report-types";

type Breakdown = "DOSYA" | "MUVEKKIL";

/**
 * SÜRE DEĞERİNİN PARA BİRİMİ (denetim bulgusu K-06).
 *
 * `TimeEntry` modelinde `currency` alanı YOKTUR — yalnız `hourlyRate` vardır ve
 * bu oran büronun taban para biriminde tutulur. Süre değeri bu yüzden satırın
 * para birimine bağlanamaz; kendi sabit para birimiyle etiketlenir.
 *
 * Şemaya `TimeEntry.currency` eklendiğinde bu sabit kaldırılıp değer kayıttan
 * okunmalıdır; o güne kadar en dürüst davranış, süre değerini AYRI bir para
 * birimi sütunuyla göstermek ve karşılaştırılamayan satırlarda `fark`ı boş
 * bırakmaktır.
 */
const TIME_VALUE_CURRENCY = "TRY";

interface FinanceRow {
  groupId: string;
  groupName: string;
  subName: string;
  currency: string;
  accrued: Prisma.Decimal | null;
  expenses: Prisma.Decimal | null;
}

interface TimeRow {
  groupId: string;
  minutes: number;
  value: Prisma.Decimal | null;
  minuteswithoutrate: number;
}

export const karlilikReport: ReportBuilder = async (ctx): Promise<ReportBody> => {
  const { user, prisma, params } = ctx;
  // İKİNCİ KAPI: çerçeve zaten katalogdan rol kontrolü yapar, ama bu rapor
  // doğrudan da (kayıtlı rapor koşusu, AI yorumu) çağrılabildiği için kapı
  // burada TEKRAR edilir. Güvenlik kontrolü tek çağrı yoluna güvenmez.
  assertReportAccess(user, REPORT_ACCESS.YONETIM, "kârlılık raporunu görüntüleme");

  const tenantId = user.tenantId;
  const db = prisma.client;
  const breakdown: Breakdown = String(params.raw.kirilim ?? "DOSYA").toUpperCase() === "MUVEKKIL" ? "MUVEKKIL" : "DOSYA";
  const from = params.period.from;
  const end = params.period.endExclusive;

  const financeRows =
    breakdown === "DOSYA"
      ? await db.$queryRaw<FinanceRow[]>`
          SELECT c.id                                   AS "groupId",
                 c.title                                AS "groupName",
                 COALESCE(NULLIF(c."fileNumber", ''), cl.name) AS "subName",
                 f.currency                             AS currency,
                 SUM(f.amount) FILTER (
                   WHERE f.type::text IN ('TAHAKKUK','VEKALET_UCRETI','DANISMANLIK')
                 ) AS accrued,
                 SUM(f.amount) FILTER (WHERE f.type::text IN ('MASRAF','HARC')) AS expenses
            FROM "FinancialEntry" f
            JOIN "Case"   c  ON c.id  = f."caseId"
            JOIN "Client" cl ON cl.id = c."clientId"
           WHERE f."tenantId" = ${tenantId}
             AND f."date" >= ${from} AND f."date" < ${end}
           GROUP BY c.id, cl.name, f.currency
        `
      : await db.$queryRaw<FinanceRow[]>`
          SELECT cl.id     AS "groupId",
                 cl.name   AS "groupName",
                 COALESCE(cl."referenceCode", '') AS "subName",
                 f.currency AS currency,
                 SUM(f.amount) FILTER (
                   WHERE f.type::text IN ('TAHAKKUK','VEKALET_UCRETI','DANISMANLIK')
                 ) AS accrued,
                 SUM(f.amount) FILTER (WHERE f.type::text IN ('MASRAF','HARC')) AS expenses
            FROM "FinancialEntry" f
            JOIN "Client" cl ON cl.id = f."clientId"
           WHERE f."tenantId" = ${tenantId}
             AND f."date" >= ${from} AND f."date" < ${end}
           GROUP BY cl.id, f.currency
        `;

  /**
   * Süre değeri. `LEFT JOIN LATERAL` ile ücret sözleşmesindeki saatlik ücret
   * yedek olarak alınır — zaman kaydı başına ayrı sorgu YOKTUR.
   *
   * YEDEK ZİNCİRİ: dosya sözleşmesi → müvekkil sözleşmesi. Eskiden yalnız
   * `fa2."caseId" = t."caseId"` aranıyordu; oysa `FeeAgreement.caseId`
   * İSTEĞE BAĞLI, `clientId` ZORUNLUDUR. Müvekkil düzeyinde yapılmış saatlik
   * sözleşmelerin hiçbiri bulunamıyor, o dakikalar "ücretsiz dakika"ya
   * düşüyordu; uyarı veriliyordu ama sebebi yanlış anlaşılıyordu
   * (denetim bulgusu 21).
   *
   * Sıralama dosya sözleşmesini müvekkil sözleşmesinin ÜSTÜNE koyar: dosyaya
   * özel bir ücret varsa genel müvekkil ücretini ezmelidir.
   */
  const timeRows =
    breakdown === "DOSYA"
      ? await db.$queryRaw<TimeRow[]>`
          SELECT t."caseId" AS "groupId",
                 SUM(t.minutes)::int AS minutes,
                 (SUM(t.minutes * COALESCE(t."hourlyRate", fa."hourlyRate"))
                    FILTER (WHERE COALESCE(t."hourlyRate", fa."hourlyRate") IS NOT NULL)
                  / 60.0) AS value,
                 COALESCE(SUM(t.minutes) FILTER (
                   WHERE COALESCE(t."hourlyRate", fa."hourlyRate") IS NULL
                 ), 0)::int AS minuteswithoutrate
            FROM "TimeEntry" t
            JOIN "Case" tc ON tc.id = t."caseId"
            LEFT JOIN LATERAL (
              SELECT fa2."hourlyRate"
                FROM "FeeAgreement" fa2
               WHERE fa2."tenantId" = ${tenantId}
                 AND fa2."hourlyRate" IS NOT NULL
                 AND fa2.status::text = 'AKTIF'
                 AND fa2."startDate" <= t."date"
                 AND (fa2."endDate" IS NULL OR fa2."endDate" >= t."date")
                 AND (
                   fa2."caseId" = t."caseId"
                   OR (fa2."caseId" IS NULL AND fa2."clientId" = tc."clientId")
                 )
               ORDER BY (fa2."caseId" IS NOT NULL) DESC, fa2."startDate" DESC
               LIMIT 1
            ) fa ON TRUE
           WHERE t."tenantId" = ${tenantId}
             AND t."caseId" IS NOT NULL
             AND t."date" >= ${from} AND t."date" < ${end}
           GROUP BY t."caseId"
        `
      : await db.$queryRaw<TimeRow[]>`
          SELECT t."clientId" AS "groupId",
                 SUM(t.minutes)::int AS minutes,
                 (SUM(t.minutes * COALESCE(t."hourlyRate", fa."hourlyRate"))
                    FILTER (WHERE COALESCE(t."hourlyRate", fa."hourlyRate") IS NOT NULL)
                  / 60.0) AS value,
                 COALESCE(SUM(t.minutes) FILTER (
                   WHERE COALESCE(t."hourlyRate", fa."hourlyRate") IS NULL
                 ), 0)::int AS minuteswithoutrate
            FROM "TimeEntry" t
            LEFT JOIN LATERAL (
              SELECT fa2."hourlyRate"
                FROM "FeeAgreement" fa2
               WHERE fa2."tenantId" = ${tenantId}
                 AND fa2."clientId" = t."clientId"
                 AND fa2."hourlyRate" IS NOT NULL
                 AND fa2.status::text = 'AKTIF'
                 AND fa2."startDate" <= t."date"
                 AND (fa2."endDate" IS NULL OR fa2."endDate" >= t."date")
                 AND (fa2."caseId" IS NULL OR fa2."caseId" = t."caseId")
               ORDER BY (fa2."caseId" = t."caseId") DESC NULLS LAST, fa2."startDate" DESC
               LIMIT 1
            ) fa ON TRUE
           WHERE t."tenantId" = ${tenantId}
             AND t."clientId" IS NOT NULL
             AND t."date" >= ${from} AND t."date" < ${end}
           GROUP BY t."clientId"
        `;

  const timeByGroup = new Map(timeRows.map((r) => [r.groupId, r]));

  /**
   * SÜRESİ OLUP FİNANS HAREKETİ OLMAYAN GRUPLAR — raporun asıl konusu.
   * Adları burada çözülür; finans sorgusu bu grupları hiç görmedi.
   */
  const financeGroupIds = new Set(financeRows.map((r) => r.groupId));
  const timeOnlyIds = timeRows.map((r) => r.groupId).filter((id) => !financeGroupIds.has(id));

  const timeOnlyNames = new Map<string, { groupName: string; subName: string }>();
  if (timeOnlyIds.length > 0) {
    if (breakdown === "DOSYA") {
      const cases = await db.case.findMany({
        where: { tenantId, id: { in: timeOnlyIds } },
        select: { id: true, title: true, fileNumber: true, client: { select: { name: true } } },
      });
      for (const c of cases) {
        timeOnlyNames.set(c.id, {
          groupName: c.title,
          subName: c.fileNumber && c.fileNumber !== "" ? c.fileNumber : c.client.name,
        });
      }
    } else {
      const clients = await db.client.findMany({
        where: { tenantId, id: { in: timeOnlyIds } },
        select: { id: true, name: true, referenceCode: true },
      });
      for (const c of clients) {
        timeOnlyNames.set(c.id, { groupName: c.name, subName: c.referenceCode ?? "" });
      }
    }
  }

  /**
   * PARA BİRİMİ BAŞINA KOVA (denetim bulgusu K-06).
   *
   * Eskiden `totalAccrued`/`totalExpenses` tek bir Decimal'di ve `r.currency`'ye
   * BAKMADAN birikiyordu; sonuç `primaryCurrency` etiketiyle basılıyordu. 40.000
   * EUR + 4.230 TRY toplanıp "35.770,00 TRY" diye gösteriliyordu. Kur çevrimi
   * yapılamaz (şemada kur alanı yok) — o hâlde toplanamaz da.
   */
  const byCurrency = new Map<string, { accrued: Prisma.Decimal; expenses: Prisma.Decimal }>();
  const addTo = (currency: string, accrued: Prisma.Decimal, expenses: Prisma.Decimal) => {
    const bucket = byCurrency.get(currency) ?? {
      accrued: new Prisma.Decimal(0),
      expenses: new Prisma.Decimal(0),
    };
    bucket.accrued = bucket.accrued.plus(accrued);
    bucket.expenses = bucket.expenses.plus(expenses);
    byCurrency.set(currency, bucket);
  };
  let totalMinutes = 0;
  let minutesWithoutRate = 0;
  const currencies = new Set<string>();

  /**
   * SÜRE TOPLAMLARI SATIR DÖNGÜSÜNDEN AYRI — grup başına BİR KEZ.
   * Döngü içinde toplansaydı çok para birimli her dosya süresini iki kez
   * saydırırdı (denetim bulgusu 1).
   */
  let totalTimeValue = new Prisma.Decimal(0);
  for (const t of timeRows) {
    totalTimeValue = totalTimeValue.plus(decOf(t.value));
    totalMinutes += intOf(t.minutes);
    minutesWithoutRate += intOf(t.minuteswithoutrate);
  }

  /** Süre sütunları yalnız grubun İLK satırında dolar; tekrarları `null`dır. */
  const timeWritten = new Set<string>();
  let repeatedCurrencyRows = 0;

  const buildRow = (
    groupId: string,
    groupName: string,
    subName: string,
    currency: string | null,
    accrued: Prisma.Decimal,
    expenses: Prisma.Decimal,
  ): Record<string, ReportCell> => {
    const gross = accrued.minus(expenses);
    const first = !timeWritten.has(groupId);
    timeWritten.add(groupId);
    const time = first ? timeByGroup.get(groupId) : undefined;
    if (!first) repeatedCurrencyRows += 1;

    const minutes = intOf(time?.minutes);
    const timeValue = time ? decOf(time.value) : null;
    const noRate = intOf(time?.minuteswithoutrate);

    // SÜRE DEĞERİ SATIRIN PARA BİRİMİNDE DEĞİLDİR (denetim bulgusu K-06).
    //
    // `TimeEntry`de `currency` alanı yoktur; `hourlyRate` büronun taban para
    // biriminde tutulur (TIME_VALUE_CURRENCY). Eskiden `sureDegeri` ve `fark`
    // sütunları `currencyKey: "paraBirimi"` taşıyordu, yani satırın para birimi
    // EUR ise arayüz TRY cinsinden bir tutarı "46.125,00 EUR" diye basıyordu.
    // Toplam kartları için dürüst bir uyarı vardı; SATIR ETİKETİNİ hiçbir uyarı
    // kapsamıyordu — bulgunun keskin kısmı orasıydı.
    //
    // Artık süre sütunları KENDİ para birimi sütununa (`sureParaBirimi`) bağlıdır
    // ve `fark` yalnız satır para birimi süre para birimiyle AYNI olduğunda
    // hesaplanır; farklıysa `null` döner (iki para birimini çıkarmak anlamsızdır).
    const comparable = currency === null || currency === TIME_VALUE_CURRENCY;

    return {
      ad: groupName,
      alt: subName,
      paraBirimi: currency ?? "—",
      tahakkuk: moneyOut(accrued),
      masraf: moneyOut(expenses),
      brutKatki: moneyOut(gross),
      // Süre para birimine bölünemez (TimeEntry'de currency alanı yok); bu
      // yüzden tekrar eden para birimi satırında BOŞ bırakılır — aynı 600
      // dakikayı iki satırda göstermek okuyucuya 1.200 dakika saydırırdı.
      calismaDakika: time ? minutes : null,
      calismaSaat: time ? minutesToHoursNumber(minutes) : null,
      sureParaBirimi: timeValue === null ? null : TIME_VALUE_CURRENCY,
      sureDegeri: timeValue === null ? null : moneyOut(timeValue),
      fark: timeValue === null || !comparable ? null : moneyOut(gross.minus(timeValue)),
      // TEK DECIMAL İŞLEMİ: `tahakkuk × 60 / dakika`. Eskiden `dakika / 60`
      // JS float'ı Decimal'e sarılıyordu (denetim bulgusu 16); 100 dakika için
      // 1.6666666666666667 üretip "hepsi Decimal, float YOK" sözleşmesini
      // kırıyordu.
      efektifSaatlik:
        time && minutes > 0
          ? moneyOut(accrued.mul(60).div(new Prisma.Decimal(minutes)))
          : null,
      ucretsizDakika: time ? noRate : null,
    };
  };

  // 1) Finans hareketi olan gruplar — para birimi başına bir satır.
  const rows: Record<string, ReportCell>[] = financeRows.map((r) => {
    const accrued = decOf(r.accrued);
    const expenses = decOf(r.expenses);
    addTo(r.currency, accrued, expenses);
    currencies.add(r.currency);
    return buildRow(r.groupId, r.groupName, r.subName, r.currency, accrued, expenses);
  });

  // 2) Yalnız süresi olan gruplar — tahakkuk/masraf sıfır. Raporun ASIL konusu:
  //    çalışılmış ama henüz fatura kesilmemiş dosyalar (denetim bulgusu 2).
  const zero = new Prisma.Decimal(0);
  for (const id of timeOnlyIds) {
    const name = timeOnlyNames.get(id);
    rows.push(
      buildRow(
        id,
        name?.groupName ?? "(kayıt bulunamadı)",
        name?.subName ?? "",
        null,
        zero,
        zero,
      ),
    );
  }

  /**
   * Sıralama: brüt katkıya göre azalan. Karşılaştırıcı `comparedTo` kullanır —
   * eşitlikte 0 döner ve `Array.prototype.sort` sözleşmesi korunur.
   * Para birimleri KARIŞTIRILMAZ: farklı birimlerdeki tutarları tek listede
   * sıralamak 5.000 USD'yi 100.000 TRY'nin altında gösterirdi, bu yüzden önce
   * para birimine göre kümelenir (denetim bulgusu 24).
   */
  rows.sort((a, b) => {
    const ca = String(a.paraBirimi ?? "");
    const cb = String(b.paraBirimi ?? "");
    if (ca !== cb) return ca.localeCompare(cb, "tr");
    return compareDescending(
      new Prisma.Decimal(String(a.brutKatki ?? "0")),
      new Prisma.Decimal(String(b.brutKatki ?? "0")),
    );
  });

  const table = finishTable(
    {
      key: "karlilik",
      title: breakdown === "DOSYA" ? "Dosya bazında kârlılık" : "Müvekkil bazında kârlılık",
      definition:
        "Brüt katkı = tahakkuk − (masraf + harç). Süre değeri = Σ(dakika × saatlik ücret) / 60. " +
        "Genel gider, personel maliyeti ve vergi DÂHİL DEĞİLDİR — bu sayı 'kâr' değil brüt katkıdır. " +
        "Süre sütunları grubun İLK satırında yazılır; aynı grubun diğer para birimi satırlarında " +
        "boştur (süre para birimine bölünemez). Para birimi '—' olan satırlarda dönem içinde hiç " +
        "finans hareketi yoktur, yalnız çalışma kaydı vardır.",
      columns: [
        { key: "ad", label: breakdown === "DOSYA" ? "Dosya" : "Müvekkil", type: "text" },
        { key: "alt", label: breakdown === "DOSYA" ? "Esas no / müvekkil" : "Referans kodu", type: "text" },
        { key: "paraBirimi", label: "Para birimi", type: "text" },
        { key: "tahakkuk", label: "Tahakkuk", type: "money", currencyKey: "paraBirimi" },
        { key: "masraf", label: "Masraf + harç", type: "money", currencyKey: "paraBirimi" },
        { key: "brutKatki", label: "Brüt katkı", type: "money", currencyKey: "paraBirimi" },
        { key: "calismaDakika", label: "Kayıtlı süre (dk)", type: "minutes" },
        { key: "calismaSaat", label: "Kayıtlı süre (saat)", type: "number" },
        // K-06: süre sütunları SATIRIN para birimine değil, süre değerinin
        // kendi para birimine bağlıdır.
        { key: "sureParaBirimi", label: "Süre para birimi", type: "text" },
        { key: "sureDegeri", label: "Süre değeri", type: "money", currencyKey: "sureParaBirimi" },
        {
          key: "fark",
          label: "Brüt katkı − süre değeri",
          type: "money",
          currencyKey: "sureParaBirimi",
        },
        { key: "efektifSaatlik", label: "Efektif saatlik tahakkuk", type: "money", currencyKey: "paraBirimi" },
        { key: "ucretsizDakika", label: "Ücretsiz dakika (oran yok)", type: "minutes" },
      ],
    },
    rows,
    params.limit,
  );

  // TOPLAM KARTLARI YALNIZ TEK BİR PARA BİRİMİNİ RAPORLAR (denetim bulgusu K-06).
  //
  // Diğer para birimleri ayrı bir tabloda listelenir; toplanmaz, çevrilmez.
  const primaryCurrency =
    currencies.has(TIME_VALUE_CURRENCY) || currencies.size === 0
      ? TIME_VALUE_CURRENCY
      : [...currencies].sort()[0];
  const primaryBucket = byCurrency.get(primaryCurrency) ?? {
    accrued: new Prisma.Decimal(0),
    expenses: new Prisma.Decimal(0),
  };
  const totalAccrued = primaryBucket.accrued;
  const totalExpenses = primaryBucket.expenses;
  const totalGross = totalAccrued.minus(totalExpenses);

  // Süre değeri TIME_VALUE_CURRENCY cinsindedir; `fark` ölçüsü yalnız
  // `primaryCurrency` onunla aynı olduğunda anlamlıdır.
  const timeComparable = primaryCurrency === TIME_VALUE_CURRENCY;

  const metrics = [
    moneyMetric("tahakkuk", `Toplam tahakkuk (${primaryCurrency})`, totalAccrued, undefined, primaryCurrency, {
      higherIsBetter: true,
      definition: `Yalnızca ${primaryCurrency} hareketleri. Diğer para birimleri ayrı tabloda listelenir; toplanmaz.`,
    }),
    moneyMetric("masraf", `Toplam masraf + harç (${primaryCurrency})`, totalExpenses, undefined, primaryCurrency, {
      higherIsBetter: false,
      definition: `Yalnızca ${primaryCurrency} hareketleri.`,
    }),
    moneyMetric("brutKatki", `Toplam brüt katkı (${primaryCurrency})`, totalGross, undefined, primaryCurrency, {
      higherIsBetter: true,
      definition:
        `Tahakkuk − (masraf + harç), yalnız ${primaryCurrency}. ` +
        "Genel gider ve personel maliyeti içermez.",
    }),
    moneyMetric(
      "sureDegeri",
      `Kayıtlı sürenin değeri (${TIME_VALUE_CURRENCY})`,
      totalTimeValue,
      undefined,
      TIME_VALUE_CURRENCY,
      {
        definition:
          "Σ(dakika × saatlik ücret) / 60. Saatlik ücreti bilinmeyen dakikalar HARİÇTİR. " +
          `Zaman kaydında para birimi alanı olmadığı için değer daima ${TIME_VALUE_CURRENCY} kabul edilir.`,
      },
    ),
    // `fark` yalnız iki taraf AYNI para biriminde olduğunda hesaplanır.
    moneyMetric(
      "fark",
      "Brüt katkı − süre değeri",
      timeComparable ? totalGross.minus(totalTimeValue) : new Prisma.Decimal(0),
      undefined,
      TIME_VALUE_CURRENCY,
      {
        higherIsBetter: true,
        definition: timeComparable
          ? "Pozitif: tahakkuk, harcanan sürenin ücret karşılığından fazla. Negatif: dosyaya " +
            "kayıtlı süre, tahakkuk edilen ücretin üzerinde."
          : `HESAPLANMADI: raporun baskın para birimi ${primaryCurrency}, süre değeri ise ` +
            `${TIME_VALUE_CURRENCY} cinsindendir. Kur çevrimi yapılmadığı için bu iki tutar çıkarılamaz.`,
      },
    ),
    countMetric("calismaDakika", "Toplam kayıtlı süre (dk)", totalMinutes, undefined),
    countMetric(
      "satirSayisi",
      breakdown === "DOSYA" ? "Rapora giren dosya" : "Rapora giren müvekkil",
      // SATIR SAYISI DEĞİL, FARKLI GRUP SAYISI. `financeRows.length` çok para
      // birimli bir dosyayı iki kez sayıyordu (denetim bulgusu 1).
      timeWritten.size,
      undefined,
      {
        definition:
          "Dönem içinde finans hareketi VEYA çalışma kaydı bulunan farklı " +
          (breakdown === "DOSYA" ? "dosya" : "müvekkil") +
          " sayısı. Aynı grubun birden çok para birimi satırı bir kez sayılır.",
      },
    ),
    countMetric(
      "yalnizSure",
      breakdown === "DOSYA" ? "Finans hareketi olmayan dosya" : "Finans hareketi olmayan müvekkil",
      timeOnlyIds.length,
      undefined,
      {
        higherIsBetter: false,
        definition:
          "Dönem içinde çalışma kaydı var ama hiç tahakkuk/masraf yok. Faturalanmamış " +
          "emek adayı; brüt katkısı sıfır göründüğü için 'fark' ölçüsünde tam süre değeri " +
          "kadar NEGATİF katkı verir.",
      },
    ),
  ];

  const warnings: string[] = [];
  const trunc = truncationWarning(table);
  if (trunc) warnings.push(trunc);
  if (minutesWithoutRate > 0) {
    warnings.push(
      `${minutesWithoutRate} dakikalık çalışma kaydında saatlik ücret bulunamadı (ne zaman ` +
        "kaydında ne de aktif ücret sözleşmesinde). Bu dakikalar SÜRE DEĞERİNE GİRMEDİ; " +
        "varsayılan bir ücret uydurulmadı. Süre değeri bu ölçüde EKSİKTİR.",
    );
  }
  if (currencies.size > 1) {
    // K-06 SONRASI METİN: toplamlar artık "yan yana toplamıyor"; tek para
    // biriminde raporlanıyor. Uyarı bu yüzden yeniden yazıldı — eski metin
    // düzeltilmiş davranışı yanlış anlatırdı.
    const others = [...currencies].filter((c) => c !== primaryCurrency).sort();
    warnings.push(
      `Rapor ${currencies.size} para birimi içeriyor (${[...currencies].sort().join(", ")}). ` +
        `TOPLAM KARTLARI YALNIZ ${primaryCurrency} hareketlerini gösterir; ` +
        `${others.join(", ")} tutarları toplama GİRMEZ ve "Diğer para birimleri" tablosunda ` +
        "ayrı listelenir. Kur çevrimi yapılmaz.",
    );
  }
  if (!timeComparable) {
    warnings.push(
      `Süre değeri ${TIME_VALUE_CURRENCY} cinsindendir; raporun baskın para birimi ` +
        `${primaryCurrency} olduğu için "Brüt katkı − süre değeri" ölçüsü HESAPLANMADI.`,
    );
  }
  if (repeatedCurrencyRows > 0) {
    warnings.push(
      `${repeatedCurrencyRows} satır, aynı ${breakdown === "DOSYA" ? "dosyanın" : "müvekkilin"} ` +
        "ikinci (ve sonraki) para birimidir; süre sütunları o satırlarda BOŞTUR. Çalışma süresi " +
        "para birimine bölünemez (zaman kaydında para birimi alanı yoktur) ve toplamlara bir kez girer.",
    );
  }
  if (timeOnlyIds.length > 0) {
    warnings.push(
      `${timeOnlyIds.length} ${breakdown === "DOSYA" ? "dosyada" : "müvekkilde"} dönem içinde ` +
        "çalışma kaydı var ama hiç tahakkuk/masraf yok; para birimi sütunu '—' olarak listelendi. " +
        "Bu satırlar faturalanmamış emeği gösterir ve toplam 'Brüt katkı − süre değeri' ölçüsünü " +
        "AŞAĞI çeker — daha önce hiç görünmüyorlardı.",
    );
  }
  if (breakdown === "DOSYA") {
    warnings.push(
      "Dosyaya bağlanmamış finans hareketleri ve zaman kayıtları bu tabloya GİRMEZ; " +
        "büro geneli toplam için müvekkil kırılımını veya finans modülünü kullanın.",
    );
  } else {
    // Simetri (denetim bulgusu 22): DOSYA kırılımında olan uyarının MUVEKKIL
    // karşılığı yoktu. `TimeEntry.clientId` ve `FinancialEntry.clientId`
    // isteğe bağlıdır; müvekkile bağlanmamış (ama dosyaya bağlı) kayıtlar bu
    // kırılımdan SESSİZCE düşerdi.
    warnings.push(
      "Müvekkile bağlanmamış finans hareketleri ve zaman kayıtları (yalnız dosyaya bağlı " +
        "olanlar) bu tabloya GİRMEZ; tam liste için dosya kırılımını kullanın.",
    );
  }

  // K-06: TOPLANMAYAN para birimleri ayrı bir tabloda görünür. Sayı kaybolmaz,
  // ama yanlış etiketle de toplanmaz. `buro-ozet.report.ts:199-230` ile aynı desen.
  const currencyRows = [...byCurrency.entries()]
    .sort(([a], [b]) => (a === primaryCurrency ? -1 : b === primaryCurrency ? 1 : a.localeCompare(b)))
    .map(([currency, bucket]) => ({
      paraBirimi: currency,
      tahakkuk: moneyOut(bucket.accrued),
      masraf: moneyOut(bucket.expenses),
      brutKatki: moneyOut(bucket.accrued.minus(bucket.expenses)),
      toplamaGirdi: currency === primaryCurrency ? "Evet" : "Hayır",
    }));

  const currencyTable = finishTable(
    {
      key: "paraBirimleri",
      title: "Para birimi bazında toplam",
      definition:
        "Her para birimi AYRI toplanır; kur çevrimi yapılmaz ve farklı para birimleri " +
        "birbirine EKLENMEZ. Yukarıdaki toplam kartları yalnızca " +
        `${primaryCurrency} satırını gösterir.`,
      columns: [
        { key: "paraBirimi", label: "Para birimi", type: "text" },
        { key: "tahakkuk", label: "Tahakkuk", type: "money", currencyKey: "paraBirimi" },
        { key: "masraf", label: "Masraf + harç", type: "money", currencyKey: "paraBirimi" },
        { key: "brutKatki", label: "Brüt katkı", type: "money", currencyKey: "paraBirimi" },
        { key: "toplamaGirdi", label: "Toplam kartlarına girdi mi", type: "text" },
      ],
    },
    currencyRows,
    // Para birimi sayısı doğal olarak küçüktür; kırpma uygulanmaz.
    Math.max(currencyRows.length, 1),
  );

  return { metrics, tables: [table, currencyTable], warnings };
};
