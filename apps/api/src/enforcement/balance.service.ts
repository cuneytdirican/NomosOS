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
 * FAİZ: basit faiz, gün bazlı, yıl 365 gün.
 *     faiz = asıl_alacak × (oran / 100) × gün / 365
 * Faiz oranı tanımlı DEĞİLSE HESAP YAPILMAZ: faiz 0 kabul edilir ve dönen
 * `warnings` dizisine "faiz oranı tanımlı değil" uyarısı konur. Varsayılan bir
 * oran (ör. yasal faiz) UYDURULMAZ; oranın ne olduğu avukatın kararıdır.
 */

import { Injectable } from "@nestjs/common";
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
    days: number;
    formula: string;
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
    const file = await this.prisma.client.enforcementFile.findFirstOrThrow({
      where: { id: enforcementFileId, tenantId },
      select: {
        id: true,
        caseId: true,
        currency: true,
        principalAmount: true,
        interestRate: true,
        requestDate: true,
      },
    });

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
      this.prisma.client.financialEntry.findMany({
        where: { tenantId, caseId: file.caseId, type: { in: [...FEE_ENTRY_TYPES] } },
        select: { amount: true },
      }),
    ]);

    const asOf = startOfDay(asOfParam ?? new Date());
    const interestStart = startOfDay(file.requestDate);
    const warnings: string[] = [];

    const principal = new Prisma.Decimal(file.principalAmount);
    const expenses = sum(expenseActions.map((a) => a.amount));
    const fees = sum(feeEntries.map((e) => e.amount));
    const collected = sum(collections.map((c) => c.amount));

    // ---- Faiz ----------------------------------------------------------
    const days = Math.max(0, Math.round((asOf.getTime() - interestStart.getTime()) / MS_PER_DAY));
    let interest = ZERO;
    let formula = "Faiz hesaplanmadı.";

    if (file.interestRate === null) {
      warnings.push(
        "Faiz oranı tanımlı değil: bu dosyada faiz HESAPLANMAMIŞTIR. Bakiye yalnızca asıl " +
          "alacak, masraf ve vekâlet ücretinden oluşmaktadır. Faiz oranını (ve varsa faiz " +
          "türünü) dosyaya işleyip hesabı tekrarlayınız.",
      );
    } else if (asOf.getTime() < interestStart.getTime()) {
      warnings.push(
        `Hesap tarihi (${formatTrDate(asOf)}) takip talebi tarihinden (${formatTrDate(interestStart)}) ` +
          "önce olduğu için faiz işletilmemiştir.",
      );
    } else {
      const rate = new Prisma.Decimal(file.interestRate);
      // asıl × (oran/100) × gün/365 — ara yuvarlama YOK.
      interest = principal.mul(rate).div(100).mul(new Prisma.Decimal(days)).div(DAYS_IN_YEAR);
      formula =
        `${principal.toFixed(2)} × (${rate.toFixed(2)} / 100) × ${days} / 365 = ${interest.toFixed(2)}`;
      warnings.push(
        "Faiz, BASİT FAİZ olarak, yıl 365 gün kabulüyle ve dosyaya kayıtlı SABİT orandan " +
          "hesaplanmıştır. Değişken oranlı (avans/yasal faiz dönem tablolu) bir alacak söz " +
          "konusuysa sonucu dönem tablosuyla karşılaştırınız.",
      );
    }

    const totalDebt = principal.plus(interest).plus(expenses).plus(fees);

    // ---- Mahsup: masraf → faiz → asıl (kural 11; sıra değiştirilemez) ----
    let remainder = collected;
    const applyTo = (target: Prisma.Decimal): { paid: Prisma.Decimal; left: Prisma.Decimal } => {
      const paid = remainder.greaterThan(target) ? target : remainder;
      remainder = remainder.minus(paid);
      return { paid, left: target.minus(paid) };
    };

    // Masraf ve vekâlet ücreti "ferî alacak" olarak birlikte, önce kapatılır.
    const expenseLeg = applyTo(expenses);
    const feeLeg = applyTo(fees);
    const interestLeg = applyTo(interest);
    const principalLeg = applyTo(principal);

    const remaining = expenseLeg.left.plus(feeLeg.left).plus(interestLeg.left).plus(principalLeg.left);
    const overpaid = remainder; // mahsup sonrası artan = fazla tahsilat

    const steps: BalanceStep[] = [
      {
        code: "ASIL_ALACAK",
        label: "Asıl alacak",
        amount: principal.toFixed(2),
        explanation: `Takip talebindeki ana para (${formatTrDate(interestStart)} tarihli takip talebi).`,
      },
      {
        code: "FAIZ",
        label: "İşlemiş faiz",
        amount: interest.toFixed(2),
        explanation:
          file.interestRate === null
            ? "Dosyada faiz oranı tanımlı olmadığı için faiz hesaplanmamıştır."
            : `${formatTrDate(interestStart)} – ${formatTrDate(asOf)} arası ${days} gün. Basit faiz: ${formula}`,
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
        explanation: `Dosyaya bağlı ${feeEntries.length} adet vekâlet ücreti kaydının toplamı (finans modülü).`,
      },
      {
        code: "TOPLAM_BORC",
        label: "Toplam borç",
        amount: totalDebt.toFixed(2),
        explanation: `${principal.toFixed(2)} + ${interest.toFixed(2)} + ${expenses.toFixed(2)} + ${fees.toFixed(2)}`,
      },
      {
        code: "TAHSILAT",
        label: "Tahsil edilen",
        amount: collected.toFixed(2),
        explanation: `${collections.length} adet tahsilat kaydının toplamı.`,
      },
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
    ];

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
        ratePercent: file.interestRate === null ? null : new Prisma.Decimal(file.interestRate).toFixed(2),
        startDate: interestStart.toISOString(),
        days,
        formula:
          file.interestRate === null
            ? "faiz oranı tanımlı değil — hesap yapılmadı"
            : "asıl × (oran / 100) × gün / 365 (basit faiz, yıl 365 gün)",
      },
    };
  }
}

/** Decimal toplamı — `reduce` içinde JS `+` KULLANILMAZ. */
function sum(values: readonly (Prisma.Decimal | null)[]): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>(
    (acc, v) => (v === null ? acc : acc.plus(new Prisma.Decimal(v))),
    ZERO,
  );
}
