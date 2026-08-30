/**
 * İCRA BAKİYE VE FAİZ HESABI — TAMAMEN DETERMİNİSTİK, AI YOKTUR.
 *
 * Modül 05 / §"Bakiye ve Faiz Hesabı": para hesabı Süre Motoru ile aynı ilkeye
 * tabidir — hesabı makine yapar, AI yalnızca sonucu YORUMLAYABİLİR. Bu servis
 * hiçbir LLM çağrısı yapmaz ve hiçbir LLM çıktısını girdi olarak kabul etmez.
 *
 * ARİTMETİK: her adım `Prisma.Decimal` ile yürütülür. JS `number` KULLANILMAZ —
 * 0.1 + 0.2 !== 0.3 sorunu 347.500,00 TL'lik bir takipte kuruş kaymasına, kuruş
 * kayması da icra dairesine yanlış bakiye bildirilmesine yol açar. Yuvarlama
 * YALNIZCA gösterim katmanında (`toFixed(2)`) yapılır.
 *
 * MAHSUP SIRASI (Modül 05 kural 11) DEĞİŞTİRİLEMEZ: masraf → faiz → asıl alacak.
 *
 * ─────────────────────────── FAİZ: DİLİMLİ HESAP ───────────────────────────
 *
 * Basit faiz, gün bazlı, yıl 365 gün:
 *     dilim_faizi = kalan_asıl × (oran / 100) × dilim_günü / 365
 *
 * FAİZ TEK DİLİMDE HESAPLANMAZ. Önceki sürüm faizi DAİMA künyedeki TAM asıl
 * alacak üzerinden, takip tarihinden `asOf`'a kadar tek dilimde işletiyor ve
 * mahsubu faiz hesaplandıktan SONRA uyguluyordu; yani ödeme, faizin matrahını
 * hiç etkilemiyordu (denetim bulgusu 3). Somut sonuç: 100.000 TL asıl, %30
 * faiz, takip 01.01.2026, borçlu 02.01.2026'da 90.000 TL ödedi → sistem yıl
 * sonunda ~29.918 TL faiz gösteriyordu; gerçek faiz ~3.074 TL'dir. ~26.800 TL
 * fark ve BORÇLU ALEYHİNEDİR — üstelik icra dairesine bildirilen bakiye,
 * dosya kapatma kararı ve "bakiye sıfır değil" kapısı bu rakama dayanıyordu.
 *
 * Doğrusu: her TAHSİLAT TARİHİNDE dilim kırılır, o ana kadarki faiz kapatılır,
 * mahsup sırası uygulanır ve KALAN ASIL bir sonraki dilimin matrahı olur.
 *
 * YUVARLAMA: her dilim faizi kuruşa (HALF_UP) indirilir ve toplam borç
 * YUVARLANMIŞ bileşenlerden kurulur. Aksi hâlde ekrandaki bileşenlerin toplamı
 * gösterilen toplam borca eşit çıkmıyordu (denetim bulgusu 14); avukat hesap
 * dökümünü elle topladığında tutmuyordu. `invoice-math.ts`'in faturalarda
 * uyguladığı sözleşmenin aynısı.
 *
 * FAİZ BAŞLANGICI: `interestStartDate` (temerrüt/vade/ihtar) doluysa oradan,
 * değilse takip talebi tarihinden işletilir ve `warnings`'e AÇIK uyarı konur.
 * Varsayılan bir tarih seçmek de bir varsayım üretmektir (denetim bulgusu 8).
 *
 * Faiz oranı tanımlı DEĞİLSE HESAP YAPILMAZ: faiz 0 kabul edilir ve dönen
 * `warnings` dizisine "faiz oranı tanımlı değil" uyarısı konur. Varsayılan bir
 * oran (ör. yasal faiz) UYDURULMAZ; oranın ne olduğu avukatın kararıdır.
 */

import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { formatTrDate, startOfDay } from "../common/dates";

const ZERO = new Prisma.Decimal(0);
const DAYS_IN_YEAR = new Prisma.Decimal(365);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Faiz hesabına giren masraf/harç işlem türleri. */
const EXPENSE_ACTION_TYPES = ["MASRAF", "HARC_ODEME"] as const;

/** Bakiyeye eklenen vekâlet ücreti, finans modülünün cari kaydından okunur. */
const FEE_ENTRY_TYPES = ["VEKALET_UCRETI"] as const;

export interface BalanceStep {
  /** Makine tarafından okunabilir adım kodu. */
  code:
    | "ASIL_ALACAK"
    | "FAIZ"
    /** Tek bir faiz dilimi (iki tahsilat arası dönem). */
    | "FAIZ_DILIMI"
    /** Bir tahsilatın mahsup dökümü. */
    | "TAHSILAT_MAHSUBU"
    | "MASRAF"
    | "VEKALET_UCRETI"
    | "TOPLAM_BORC"
    | "TAHSILAT"
    | "MAHSUP_MASRAF"
    | "MAHSUP_FAIZ"
    | "MAHSUP_ASIL"
    | "KALAN";
  label: string;
  /** İki ondalıklı metin — JSON'da float'a düşmesin. */
  amount: string;
  explanation: string;
}

export interface EnforcementBalance {
  asOf: string;
  currency: string;
  /** Asıl alacak (takip çıkışındaki ana para). */
  principal: string;
  /** İşlemiş basit faiz. Oran yoksa "0.00" ve `warnings` dolu. */
  interest: string;
  /** Takip masrafları + harçlar (EnforcementAction MASRAF/HARC_ODEME toplamı). */
  expenses: string;
  /** Vekâlet ücreti (FinancialEntry VEKALET_UCRETI toplamı). */
  fees: string;
  /** Toplam borç = principal + interest + expenses + fees. */
  totalDebt: string;
  /** Tahsil edilen toplam (CollectionRecord). */
  collected: string;
  /** Kalan toplam borç (negatife düşmez; fazla tahsilat `overpaid` alanındadır). */
  remaining: string;
  /** Mahsup sonrası kalemler. */
  remainingBreakdown: {
    expenses: string;
    interest: string;
    principal: string;
    fees: string;
  };
  /** Toplam borcu aşan tahsilat (iade/mahsup konusu). */
  overpaid: string;
  /** Hesap dökümü — avukat adım adım görebilsin diye. */
  steps: BalanceStep[];
  /** Faiz oranı yok, tatil/dönem tablosu eksik gibi durumların uyarıları. */
  warnings: string[];
  /** Faiz hesabının parametreleri — denetlenebilirlik için. */
  interestBasis: {
    ratePercent: string | null;
    startDate: string;
    /**
     * Başlangıç tarihinin KAYNAĞI.
     *   ALAN                    → dosyadaki `interestStartDate` (avukat beyanı)
     *   TAKIP_TALEBI_VARSAYILANI → alan boş, takip talebi tarihi kullanıldı
     */
    startDateSource: "ALAN" | "TAKIP_TALEBI_VARSAYILANI";
    days: number;
    formula: string;
    /** Faiz dilimleri — her tahsilat tarihinde kırılır. */
    segments: {
      from: string;
      to: string;
      days: number;
      /** O dilimde faiz işleyen asıl alacak. */
      principalBase: string;
      interest: string;
      formula: string;
    }[];
  };
}

@Injectable()
export class EnforcementBalanceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Bakiyeyi hesaplar. `asOf` verilmezse bugün (UTC gün başı) alınır.
   *
   * Hesap tamamen kayıtlı verilerden türetilir; hiçbir ara sonuç veritabanına
   * yazılmaz — bakiye türetilmiş bir değerdir, saklanan bir değer değil.
   */
  async compute(
    tenantId: string,
    enforcementFileId: string,
    asOfParam?: Date,
  ): Promise<EnforcementBalance> {
    const file = await this.prisma.client.enforcementFile.findFirst({
      where: { id: enforcementFileId, tenantId },
      select: {
        id: true,
        caseId: true,
        currency: true,
        principalAmount: true,
        interestRate: true,
        requestDate: true,
        interestStartDate: true,
      },
    });
    // Prisma'nın `findFirstOrThrow`'u ham P2025 fırlatır ve filtrede 500'e düşer;
    // kiracı dışı bir kimlik sorulduğunda kullanıcı Türkçe 404 görmelidir.
    if (!file) throw new NotFoundException("İcra dosyası bulunamadı.");

    const [expenseActions, collections, feeEntries] = await Promise.all([
      this.prisma.client.enforcementAction.findMany({
        where: { enforcementFileId, tenantId, type: { in: [...EXPENSE_ACTION_TYPES] } },
        select: { amount: true },
      }),
      this.prisma.client.collectionRecord.findMany({
        where: { enforcementFileId, tenantId },
        orderBy: { date: "asc" },
        select: { amount: true, date: true, method: true },
      }),
      /**
       * VEKÂLET ÜCRETİ — YALNIZCA MÜVEKKİLE FATURALANMAMIŞ OLANLAR.
       *
       * `invoiceId: null` süzgeci olmadan aynı kayıt üç yerde alacak
       * görünüyordu (denetim bulgusu 15): (a) burada, borçludan tahsil
       * edilecek toplam borçta, (b) `claimFinancialEntries` yoluyla müvekkile
       * kesilen faturada, (c) `FinanceSummaryService` tahakkukunda. Müvekkile
       * faturalanmış bir vekâlet ücreti artık borçludan istenen kalem
       * DEĞİLDİR; alacağın muhatabı değişmiştir.
       */
      this.prisma.client.financialEntry.findMany({
        where: {
          tenantId,
          caseId: file.caseId,
          type: { in: [...FEE_ENTRY_TYPES] },
          invoiceId: null,
        },
        select: { id: true, amount: true },
      }),
    ]);

    const asOf = startOfDay(asOfParam ?? new Date());
    const startDateSource: "ALAN" | "TAKIP_TALEBI_VARSAYILANI" = file.interestStartDate
      ? "ALAN"
      : "TAKIP_TALEBI_VARSAYILANI";
    const interestStart = startOfDay(file.interestStartDate ?? file.requestDate);
    const warnings: string[] = [];

    const principal = round(file.principalAmount);
    const expenses = round(sum(expenseActions.map((a) => a.amount)));
    const fees = round(sum(feeEntries.map((e) => e.amount)));
    const collected = round(sum(collections.map((c) => c.amount)));

    if (startDateSource === "TAKIP_TALEBI_VARSAYILANI") {
      warnings.push(
        "Faiz başlangıç tarihi girilmemiştir; hesap TAKİP TALEBİ tarihinden " +
          `(${formatTrDate(interestStart)}) işletilmiştir. Takip talebinizde daha erken bir ` +
          "temerrüt/vade/ihtar tarihi belirtildiyse (ilamlı takipte ilam tarihi) dosyadaki " +
          "«faiz başlangıç tarihi» alanını doldurup hesabı tekrarlayınız; aksi hâlde faiz " +
          "MÜVEKKİL ALEYHİNE eksik hesaplanmış olabilir.",
      );
    }

    // ---- Faiz: DİLİMLİ hesap + eşzamanlı mahsup ------------------------
    const rate = file.interestRate === null ? null : new Prisma.Decimal(file.interestRate);
    const totalDays = Math.max(
      0,
      Math.round((asOf.getTime() - interestStart.getTime()) / MS_PER_DAY),
    );

    if (rate === null) {
      warnings.push(
        "Faiz oranı tanımlı değil: bu dosyada faiz HESAPLANMAMIŞTIR. Bakiye yalnızca asıl " +
          "alacak, masraf ve vekâlet ücretinden oluşmaktadır. Faiz oranını (ve varsa faiz " +
          "türünü) dosyaya işleyip hesabı tekrarlayınız.",
      );
    } else if (asOf.getTime() < interestStart.getTime()) {
      warnings.push(
        `Hesap tarihi (${formatTrDate(asOf)}) faiz başlangıç tarihinden (${formatTrDate(interestStart)}) ` +
          "önce olduğu için faiz işletilmemiştir.",
      );
    } else {
      warnings.push(
        "Faiz, BASİT FAİZ olarak, yıl 365 gün kabulüyle ve dosyaya kayıtlı SABİT orandan " +
          "hesaplanmıştır. Değişken oranlı (avans/yasal faiz dönem tablolu) bir alacak söz " +
          "konusuysa sonucu dönem tablosuyla karşılaştırınız.",
      );
    }

    /**
     * DİLİM SINIRLARI: [faiz başlangıcı, tahsilat tarihleri…, asOf].
     *
     * Faiz başlangıcından ÖNCEKİ tahsilatlar başlangıca, `asOf`'tan SONRAKİLER
     * `asOf`'a kıstırılır: geleceğe tarihli bir ödeme geçmişteki faizi geriye
     * dönük eritemez.
     */
    const clampDate = (d: Date): Date => {
      const t = startOfDay(d).getTime();
      if (t < interestStart.getTime()) return interestStart;
      if (t > asOf.getTime()) return asOf;
      return startOfDay(d);
    };

    let runningPrincipal = principal;
    let openExpenses = expenses;
    let openFees = fees;
    /** Kapatılmamış (birikmiş) faiz. */
    let openInterest = ZERO;
    /** Ömür boyu tahakkuk eden brüt faiz. */
    let grossInterest = ZERO;
    let overpaid = ZERO;
    /** Kalemlere fiilen mahsup edilen toplamlar (dökümde gösterilir). */
    let paidExpenses = ZERO;
    let paidFees = ZERO;
    let paidInterest = ZERO;
    let paidPrincipal = ZERO;

    const segments: EnforcementBalance["interestBasis"]["segments"] = [];
    const steps: BalanceStep[] = [];

    /** Bir dilimde faiz tahakkuk ettirir ve dökümüne yazar. */
    const accrue = (from: Date, to: Date): void => {
      if (rate === null) return;
      const days = Math.max(0, Math.round((to.getTime() - from.getTime()) / MS_PER_DAY));
      if (days === 0) return;
      // Her dilim KURUŞA yuvarlanır: bileşenlerin toplamı toplam borca eşit kalsın.
      const segInterest = round(
        runningPrincipal.mul(rate).div(100).mul(new Prisma.Decimal(days)).div(DAYS_IN_YEAR),
      );
      const formula =
        `${runningPrincipal.toFixed(2)} × (${rate.toFixed(2)} / 100) × ${days} / 365 = ` +
        segInterest.toFixed(2);
      grossInterest = grossInterest.plus(segInterest);
      openInterest = openInterest.plus(segInterest);
      segments.push({
        from: from.toISOString(),
        to: to.toISOString(),
        days,
        principalBase: runningPrincipal.toFixed(2),
        interest: segInterest.toFixed(2),
        formula,
      });
      steps.push({
        code: "FAIZ_DILIMI",
        label: `Faiz dilimi ${formatTrDate(from)} – ${formatTrDate(to)}`,
        amount: segInterest.toFixed(2),
        explanation: `${days} gün, matrah ${runningPrincipal.toFixed(2)}. ${formula}`,
      });
    };

    /**
     * MAHSUP SIRASI (kural 11) — masraf/harç → vekâlet ücreti → faiz → asıl.
     * Sıra değiştirilemez; her tahsilatta aynı sırayla uygulanır.
     */
    const settle = (amount: Prisma.Decimal): string[] => {
      let left = amount;
      const parts: string[] = [];
      const take = (open: Prisma.Decimal, label: string): Prisma.Decimal => {
        const paid = left.greaterThan(open) ? open : left;
        left = left.minus(paid);
        if (paid.greaterThan(ZERO)) parts.push(`${label} ${paid.toFixed(2)}`);
        return paid;
      };
      const e = take(openExpenses, "masraf/harç");
      openExpenses = openExpenses.minus(e);
      paidExpenses = paidExpenses.plus(e);

      const f = take(openFees, "vekâlet ücreti");
      openFees = openFees.minus(f);
      paidFees = paidFees.plus(f);

      const i = take(openInterest, "faiz");
      openInterest = openInterest.minus(i);
      paidInterest = paidInterest.plus(i);

      const p = take(runningPrincipal, "asıl alacak");
      runningPrincipal = runningPrincipal.minus(p);
      paidPrincipal = paidPrincipal.plus(p);

      if (left.greaterThan(ZERO)) {
        overpaid = overpaid.plus(left);
        parts.push(`fazla tahsilat ${left.toFixed(2)}`);
      }
      return parts;
    };

    let cursor = interestStart;
    for (const c of collections) {
      const at = clampDate(c.date);
      accrue(cursor, at);
      cursor = at;
      const amount = round(c.amount);
      const parts = settle(amount);
      steps.push({
        code: "TAHSILAT_MAHSUBU",
        label: `Tahsilat mahsubu — ${formatTrDate(at)} (${c.method})`,
        amount: amount.toFixed(2),
        explanation:
          `${parts.join(" · ") || "mahsup edilecek açık kalem yok"}. ` +
          `Mahsup sonrası kalan asıl: ${runningPrincipal.toFixed(2)} — bir sonraki faiz ` +
          "diliminin matrahı budur.",
      });
    }
    accrue(cursor, asOf);

    // ---- Toplamlar: YUVARLANMIŞ bileşenlerden kurulur -------------------
    const interest = grossInterest;
    const totalDebt = principal.plus(interest).plus(expenses).plus(fees);
    const remaining = openExpenses.plus(openFees).plus(openInterest).plus(runningPrincipal);

    const expenseLeg = { paid: paidExpenses, left: openExpenses };
    const feeLeg = { paid: paidFees, left: openFees };
    const interestLeg = { paid: paidInterest, left: openInterest };
    const principalLeg = { paid: paidPrincipal, left: runningPrincipal };

    const formula =
      rate === null
        ? "Faiz hesaplanmadı."
        : segments.length === 0
          ? "Faiz işleyen gün bulunmadığı için faiz hesaplanmadı."
          : `${segments.length} dilim toplamı = ${interest.toFixed(2)}`;

    // Özet adımlar dilim/mahsup dökümünün ÖNÜNE alınır: okuyan önce sonucu,
    // sonra nasıl varıldığını görsün.
    steps.unshift(
      {
        code: "ASIL_ALACAK",
        label: "Asıl alacak",
        amount: principal.toFixed(2),
        explanation:
          `Takip talebindeki ana para. Faiz başlangıcı ${formatTrDate(interestStart)} ` +
          `(${startDateSource === "ALAN" ? "dosyadaki faiz başlangıç tarihi" : "takip talebi tarihi — alan boş"}).`,
      },
      {
        code: "FAIZ",
        label: "İşlemiş faiz (dilimlerin toplamı)",
        amount: interest.toFixed(2),
        explanation:
          rate === null
            ? "Dosyada faiz oranı tanımlı olmadığı için faiz hesaplanmamıştır."
            : `${formatTrDate(interestStart)} – ${formatTrDate(asOf)} arası ${totalDays} gün, ` +
              `${segments.length} dilim. Her tahsilat tarihinde dilim kırılır ve kalan asıl ` +
              `alacak yeni matrah olur. ${formula}`,
      },
      {
        code: "MASRAF",
        label: "Takip masrafları ve harçlar",
        amount: expenses.toFixed(2),
        explanation: `${expenseActions.length} adet MASRAF/HARC_ODEME işleminin toplamı.`,
      },
      {
        code: "VEKALET_UCRETI",
        label: "Vekâlet ücreti",
        amount: fees.toFixed(2),
        explanation:
          `Dosyaya bağlı, MÜVEKKİLE FATURALANMAMIŞ ${feeEntries.length} adet vekâlet ücreti ` +
          "kaydının toplamı (finans modülü). Faturalanmış kayıtlar borçludan istenen kalem " +
          "olmaktan çıktığı için bu toplama girmez." +
          (feeEntries.length > 0
            ? ` Sayılan kayıtlar: ${feeEntries.map((e) => e.id).join(", ")}`
            : ""),
      },
      {
        code: "TOPLAM_BORC",
        label: "Toplam borç",
        amount: totalDebt.toFixed(2),
        explanation:
          `${principal.toFixed(2)} + ${interest.toFixed(2)} + ${expenses.toFixed(2)} + ` +
          `${fees.toFixed(2)} = ${totalDebt.toFixed(2)} (bileşenlerin hepsi kuruşa yuvarlanmıştır; ` +
          "elle toplandığında birebir tutar).",
      },
      {
        code: "TAHSILAT",
        label: "Tahsil edilen",
        amount: collected.toFixed(2),
        explanation: `${collections.length} adet tahsilat kaydının toplamı.`,
      },
    );

    steps.push(
      {
        code: "MAHSUP_MASRAF",
        label: "Mahsup — masraf/harç ve vekâlet ücreti",
        amount: expenseLeg.paid.plus(feeLeg.paid).toFixed(2),
        explanation:
          "Mahsup sırası kanunen masraf ve ferîlerden başlar (Modül 05 kural 11); " +
          `kalan masraf+vekâlet: ${expenseLeg.left.plus(feeLeg.left).toFixed(2)}`,
      },
      {
        code: "MAHSUP_FAIZ",
        label: "Mahsup — faiz",
        amount: interestLeg.paid.toFixed(2),
        explanation: `Ferîlerden sonra faize mahsup edildi; kalan faiz: ${interestLeg.left.toFixed(2)}`,
      },
      {
        code: "MAHSUP_ASIL",
        label: "Mahsup — asıl alacak",
        amount: principalLeg.paid.toFixed(2),
        explanation: `En son asıl alacağa mahsup edildi; kalan asıl: ${principalLeg.left.toFixed(2)}`,
      },
      {
        code: "KALAN",
        label: "Kalan borç",
        amount: remaining.toFixed(2),
        explanation: `${totalDebt.toFixed(2)} − ${collected.minus(overpaid).toFixed(2)} = ${remaining.toFixed(2)}`,
      },
    );

    if (overpaid.greaterThan(ZERO)) {
      warnings.push(
        `Tahsilat toplamı, ${formatTrDate(asOf)} itibarıyla hesaplanan borcu ${overpaid.toFixed(2)} ` +
          `${file.currency} aşmaktadır. Fazla tahsilatın iadesi/mahsubu gerekebilir; kayıtları kontrol ediniz.`,
      );
    }
    if (collections.some((c) => c.method === "ANLASMA")) {
      warnings.push(
        "Dosyada haricen/anlaşma yoluyla tahsilat kaydı bulunmaktadır. Tahsil harcı " +
          "yükümlülüğü doğmuş olabilir; harç hesabını icra dairesiyle teyit ediniz.",
      );
    }

    return {
      asOf: asOf.toISOString(),
      currency: file.currency,
      principal: principal.toFixed(2),
      interest: interest.toFixed(2),
      expenses: expenses.toFixed(2),
      fees: fees.toFixed(2),
      totalDebt: totalDebt.toFixed(2),
      collected: collected.toFixed(2),
      remaining: remaining.toFixed(2),
      remainingBreakdown: {
        expenses: expenseLeg.left.toFixed(2),
        fees: feeLeg.left.toFixed(2),
        interest: interestLeg.left.toFixed(2),
        principal: principalLeg.left.toFixed(2),
      },
      overpaid: overpaid.toFixed(2),
      steps,
      warnings,
      interestBasis: {
        ratePercent: rate === null ? null : rate.toFixed(2),
        startDate: interestStart.toISOString(),
        startDateSource,
        days: totalDays,
        formula:
          rate === null
            ? "faiz oranı tanımlı değil — hesap yapılmadı"
            : "kalan_asıl × (oran / 100) × dilim_günü / 365 — basit faiz, yıl 365 gün; " +
              "dilim her tahsilat tarihinde kırılır ve mahsup sonrası kalan asıl yeni matrahtır",
        segments,
      },
    };
  }
}

/** Kuruşa HALF_UP yuvarlama — finans modülüyle AYNI sözleşme (money.ts). */
function round(value: Prisma.Decimal | string | number): Prisma.Decimal {
  return new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** Decimal toplamı — `reduce` içinde JS `+` KULLANILMAZ. */
function sum(values: readonly (Prisma.Decimal | null)[]): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>(
    (acc, v) => (v === null ? acc : acc.plus(new Prisma.Decimal(v))),
    ZERO,
  );
}
