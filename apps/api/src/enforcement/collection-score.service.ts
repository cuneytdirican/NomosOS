/**
 * TAHSİLAT İHTİMALİ — KURAL TABANLI TABAN SKOR (deterministik).
 *
 * Ortak teknik karar 7: "Tahsilat ihtimali gibi skorlar kural tabanlı sinyaller
 * + AI yorumu KARIŞIMIDIR; AI tek başına parasal karar vermez."
 *
 * Bu servis KARIŞIMIN KURAL YARISIDIR ve hiçbir LLM çağrısı yapmaz. Taban skor
 * yalnızca dosyadaki kayıtlı verilerden (malvarlığı, haciz sonucu, itiraz,
 * tahsilat geçmişi, dosya yaşı, son hareket) üretilir; her sinyalin ağırlığı,
 * ham değeri ve katkısı `ruleSignalsJson` içinde saklanır ki skor sonradan
 * denetlenebilsin.
 *
 * BANT (DUSUK/ORTA/YUKSEK) DAİMA TABAN SKORDAN TÜRETİLİR. AI'nin ±15 puanlık
 * düzeltmesi gösterilen `finalScore`'u oynatabilir ama BANDI DEĞİŞTİREMEZ —
 * yoksa bir dil modeli, portföy önceliklendirmesini tek başına yeniden yazardı.
 */

import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type ScoreBand } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { EnforcementBalanceService } from "./balance.service";
import { trCalendarDay } from "../common/dates";

/** AI'nin taban skora uygulayabileceği azami düzeltme (puan). */
export const MAX_AI_ADJUSTMENT = 15;

export interface RuleSignal {
  key: string;
  label: string;
  /** Sinyalin skordaki azami ağırlığı (puan). */
  weight: number;
  /** İnsan okunur ham değer ("0,42 karşılama oranı", "itiraz var"). */
  value: string;
  /** Bu sinyalin taban skora katkısı (puan, tam sayı). */
  contribution: number;
  /** Katkının nasıl bulunduğu — denetlenebilirlik. */
  explanation: string;
}

export interface BaseScoreResult {
  /** 0-100, tam sayı, yalnız kurallardan. */
  baseScore: number;
  band: ScoreBand;
  signals: RuleSignal[];
  /** Skoru okuyanın bilmesi gereken eksik veri uyarıları. */
  warnings: string[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function band(score: number): ScoreBand {
  if (score >= 70) return "YUKSEK";
  if (score >= 40) return "ORTA";
  return "DUSUK";
}

export const SCORE_BAND_LABELS: Record<ScoreBand, string> = {
  DUSUK: "Düşük",
  ORTA: "Orta",
  YUKSEK: "Yüksek",
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

@Injectable()
export class CollectionScoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly balance: EnforcementBalanceService,
  ) {}

  /**
   * Taban skoru hesaplar. KAYIT YAZMAZ — yazma kararı çağırana aittir
   * (skor kaydı yalnızca copilot komutu sonunda, AI yorumuyla birlikte açılır).
   */
  async computeBase(tenantId: string, enforcementFileId: string): Promise<BaseScoreResult> {
    const file = await this.prisma.client.enforcementFile.findFirst({
      where: { id: enforcementFileId, tenantId },
      select: {
        id: true,
        stage: true,
        requestDate: true,
        objectionDate: true,
        currency: true,
      },
    });
    if (!file) throw new NotFoundException("İcra dosyası bulunamadı.");

    const [assets, actions, collections, balance] = await Promise.all([
      this.prisma.client.assetRecord.findMany({
        where: { enforcementFileId, tenantId },
        select: { assetType: true, estimatedValue: true, status: true },
      }),
      this.prisma.client.enforcementAction.findMany({
        where: { enforcementFileId, tenantId },
        orderBy: { date: "desc" },
        select: { type: true, date: true },
      }),
      this.prisma.client.collectionRecord.findMany({
        where: { enforcementFileId, tenantId },
        select: { amount: true, date: true },
      }),
      this.balance.compute(tenantId, enforcementFileId),
    ]);

    const warnings: string[] = [];
    const signals: RuleSignal[] = [];
    // Ö-17: gün sayımları TÜRKİYE takvim gününe göre yapılır. `new Date()` ile
    // ölçülen "dosya yaşı" ve "hareketsizlik", TR 00:00–02:59 arasında UTC günü
    // bir geride olduğu için sorgunun saatine göre bir gün oynuyordu.
    const now = trCalendarDay(new Date());
    const totalDebt = new Prisma.Decimal(balance.totalDebt);

    // ---- 1) Tespit edilen malvarlığı / borç oranı (0-30 puan) -----------
    const liveAssets = assets.filter((a) => a.status !== "SERBEST_BIRAKILDI");
    const valued = liveAssets.filter((a) => a.estimatedValue !== null);
    const assetValue = valued.reduce<Prisma.Decimal>(
      (acc, a) => acc.plus(new Prisma.Decimal(a.estimatedValue as Prisma.Decimal)),
      new Prisma.Decimal(0),
    );
    let coverageContribution = 0;
    let coverageValue: string;
    if (liveAssets.length === 0) {
      coverageValue = "malvarlığı kaydı yok";
      warnings.push(
        "Dosyada hiç malvarlığı kaydı yok. Skor, malvarlığı sorgusu yapılmamış bir dosyayı " +
          "'malvarlığı bulunamamış' dosyadan ayırt edemez; sorguları yapıp sonuçları kaydediniz.",
      );
    } else if (valued.length === 0) {
      coverageValue = `${liveAssets.length} kayıt, değeri girilmemiş`;
      // Değeri bilinmeyen ama var olan malvarlığı yine de olumlu bir sinyaldir.
      coverageContribution = 8;
      warnings.push(
        "Malvarlığı kayıtlarında tahmini değer girilmemiş. Karşılama oranı hesaplanamadığı için " +
          "bu sinyal kısmi puanla geçilmiştir.",
      );
    } else if (totalDebt.lessThanOrEqualTo(0)) {
      coverageValue = "borç sıfır";
      coverageContribution = 30;
    } else {
      const ratio = assetValue.div(totalDebt).toNumber();
      coverageContribution = Math.round(clamp(ratio, 0, 1) * 30);
      coverageValue = `${assetValue.toFixed(2)} / ${totalDebt.toFixed(2)} = ${(ratio * 100).toFixed(0)}%`;
    }
    signals.push({
      key: "MALVARLIGI_KARSILAMA",
      label: "Tespit edilen malvarlığının borcu karşılama oranı",
      weight: 30,
      value: coverageValue,
      contribution: coverageContribution,
      explanation:
        "Serbest bırakılmamış malvarlığı kayıtlarının tahmini değeri, güncel toplam borca " +
        "oranlanır; oran 1'i aşarsa 30 puanda sabitlenir.",
    });

    // ---- 2) Haciz sonucu (0-20 puan) ------------------------------------
    const seized = liveAssets.filter(
      (a) => a.status === "HACZEDILDI" || a.status === "SATISA_CIKARILDI" || a.status === "SATILDI",
    );
    const seizureActions = actions.filter(
      (a) => a.type === "HACIZ_UYGULAMA" || a.type === "IHALE" || a.type === "KIYMET_TAKDIRI",
    );
    let seizureContribution = 0;
    if (seized.some((a) => a.status === "SATILDI")) seizureContribution = 20;
    else if (seized.some((a) => a.status === "SATISA_CIKARILDI")) seizureContribution = 16;
    else if (seized.length > 0) seizureContribution = 12;
    else if (seizureActions.length > 0) seizureContribution = 6;
    signals.push({
      key: "HACIZ_SONUCU",
      label: "Haciz ve satış sürecinin ilerleme derecesi",
      weight: 20,
      value:
        seized.length > 0
          ? `${seized.length} kalem üzerinde haciz/satış işlemi var`
          : seizureActions.length > 0
            ? `${seizureActions.length} haciz/kıymet takdiri işlemi var, haczedilmiş kalem yok`
            : "haciz uygulaması yok",
      contribution: seizureContribution,
      explanation:
        "Fiilen haczedilmiş, satışa çıkarılmış veya satılmış kalem, tahsilat ihtimalini " +
        "yalnızca 'tespit edilmiş' malvarlığından daha güçlü destekler.",
    });

    // ---- 3) İtiraz durumu (0-20 puan) -----------------------------------
    const hasObjectionAction = actions.some((a) => a.type === "ITIRAZ");
    const objectionResolved =
      actions.some((a) => a.type === "ITIRAZIN_IPTALI") ||
      file.stage === "KESINLESME" ||
      file.stage === "HACIZ" ||
      file.stage === "SATIS" ||
      file.stage === "TAHSILAT";
    const objectionOpen = (file.objectionDate !== null || hasObjectionAction) && !objectionResolved;
    let objectionContribution: number;
    let objectionValue: string;
    if (objectionOpen) {
      objectionContribution = 0;
      objectionValue = "açık itiraz var, takip durmuş görünüyor";
    } else if (file.objectionDate !== null || hasObjectionAction) {
      objectionContribution = 12;
      objectionValue = "itiraz edilmiş ancak süreç ilerlemiş";
    } else if (file.stage === "TAKIP_TALEBI" || file.stage === "ODEME_EMRI_TEBLIG") {
      objectionContribution = 14;
      objectionValue = "itiraz süresi henüz işliyor olabilir";
    } else {
      objectionContribution = 20;
      objectionValue = "itiraz yok, takip kesinleşme yolunda";
    }
    signals.push({
      key: "ITIRAZ_DURUMU",
      label: "İtiraz durumu",
      weight: 20,
      value: objectionValue,
      contribution: objectionContribution,
      explanation:
        "Açık bir itiraz takibi durdurur ve tahsilatı itirazın kaldırılması/iptali sonucuna " +
        "bağlar; bu, ihtimali en çok düşüren tek sinyaldir.",
    });

    // ---- 4) Kısmi tahsilat geçmişi (0-20 puan) --------------------------
    const collected = new Prisma.Decimal(balance.collected);
    let paymentContribution = 0;
    let paymentValue = "tahsilat yok";
    if (collections.length > 0 && totalDebt.greaterThan(0)) {
      const ratio = collected.div(totalDebt).toNumber();
      // Ödeme davranışının varlığı tek başına değerlidir: 8 puan taban + orana bağlı 12 puan.
      paymentContribution = Math.round(8 + clamp(ratio, 0, 1) * 12);
      paymentValue = `${collections.length} tahsilat, ${collected.toFixed(2)} (${(ratio * 100).toFixed(0)}%)`;
    } else if (collections.length > 0) {
      paymentContribution = 8;
      paymentValue = `${collections.length} tahsilat, ${collected.toFixed(2)}`;
    }
    signals.push({
      key: "TAHSILAT_GECMISI",
      label: "Kısmi tahsilat geçmişi",
      weight: 20,
      value: paymentValue,
      contribution: paymentContribution,
      explanation:
        "Bir kez ödeme yapmış borçlunun tekrar ödemesi daha olasıdır; ayrıca tahsil edilen " +
        "oran arttıkça kalan borcun tahsili kolaylaşır.",
    });

    // ---- 5) Dosya yaşı (0-10 puan) --------------------------------------
    const ageDays = Math.max(
      0,
      Math.round((now.getTime() - file.requestDate.getTime()) / MS_PER_DAY),
    );
    // 0-1 yıl: 10 puan; 1-3 yıl arasında doğrusal azalır; 3 yıl üstü 0.
    let ageContribution: number;
    if (ageDays <= 365) ageContribution = 10;
    else if (ageDays >= 1095) ageContribution = 0;
    else ageContribution = Math.round(10 * (1 - (ageDays - 365) / 730));
    signals.push({
      key: "DOSYA_YASI",
      label: "Dosya yaşı",
      weight: 10,
      value: `${ageDays} gün`,
      contribution: ageContribution,
      explanation:
        "Takip talebinden bu yana geçen süre uzadıkça tahsilat ihtimali düşer; 1 yıla kadar " +
        "tam puan, 3 yıl ve üzeri sıfır puan.",
    });

    // ---- 6) Dosya hareketliliği (0-10 puan; sıfır aksiyon dosyası ayırt eder) ----
    const lastAction = actions[0];
    const idleDays = lastAction
      ? Math.max(0, Math.round((now.getTime() - lastAction.date.getTime()) / MS_PER_DAY))
      : null;
    let activityContribution: number;
    let activityValue: string;
    if (idleDays === null) {
      activityContribution = 0;
      activityValue = "hiç işlem kaydı yok";
      warnings.push(
        "Dosyada hiç safahat (işlem) kaydı yok. Skor yalnızca dosya başlığındaki verilere " +
          "dayanıyor; güvenilirliği düşüktür.",
      );
    } else if (idleDays <= 90) {
      activityContribution = 10;
      activityValue = `son işlem ${idleDays} gün önce`;
    } else if (idleDays <= 180) {
      activityContribution = 6;
      activityValue = `son işlem ${idleDays} gün önce`;
    } else if (idleDays <= 365) {
      activityContribution = 3;
      activityValue = `son işlem ${idleDays} gün önce`;
    } else {
      activityContribution = 0;
      activityValue = `son işlem ${idleDays} gün önce — dosya durmuş görünüyor`;
    }
    signals.push({
      key: "DOSYA_HAREKETLILIGI",
      label: "Son işlemden bu yana geçen süre",
      weight: 10,
      value: activityValue,
      contribution: activityContribution,
      explanation:
        "Uzun süre işlem görmemiş dosyada tahsilat ihtimali, dosyanın kendisinden bağımsız " +
        "olarak düşer (durmuş süreç tespiti).",
    });

    const baseScore = clamp(
      signals.reduce((acc, s) => acc + s.contribution, 0),
      0,
      100,
    );

    if (file.stage === "KAPANDI") {
      warnings.push(
        "Dosya KAPANDI aşamasındadır; skor geçmiş bir değerlendirme olarak okunmalıdır.",
      );
    }

    return { baseScore, band: band(baseScore), signals, warnings };
  }

  /**
   * AI düzeltmesini kurala tabi kılar.
   *
   * - Düzeltme ±MAX_AI_ADJUSTMENT ile SINIRLANIR.
   * - Nihai skor 0-100 aralığına kırpılır.
   * - BANT TABAN SKORDAN gelir; AI bandı değiştiremez.
   */
  applyAiAdjustment(
    base: BaseScoreResult,
    rawAdjustment: number | undefined,
  ): { finalScore: number; appliedAdjustment: number; clamped: boolean; band: ScoreBand } {
    const requested = Number.isFinite(rawAdjustment) ? Math.round(rawAdjustment as number) : 0;
    const applied = clamp(requested, -MAX_AI_ADJUSTMENT, MAX_AI_ADJUSTMENT);
    return {
      finalScore: clamp(base.baseScore + applied, 0, 100),
      appliedAdjustment: applied,
      clamped: applied !== requested,
      // BANT DAİMA TABAN SKORDAN — kasıtlı.
      band: base.band,
    };
  }

  /** GET /enforcement/:id/score — en son hesaplanan skor kaydı. */
  async latest(tenantId: string, enforcementFileId: string) {
    const record = await this.prisma.client.collectionScore.findFirst({
      where: { tenantId, enforcementFileId },
      orderBy: { computedAt: "desc" },
    });
    if (!record) return null;
    return {
      ...record,
      signals: parseSignals(record.ruleSignalsJson),
      bandLabel: SCORE_BAND_LABELS[record.band],
      /**
       * BANDIN DAYANAĞI AÇIKÇA DÖNER (denetim bulgusu 16).
       *
       * Kayıtta `score` AI etkisini taşır, `band` ise TABAN skordan türer;
       * ikisi görünürde çelişebilir (taban 39/DUSUK + AI +15 → skor 54, bant
       * DUSUK). Çelişki değil, KORUMANIN KENDİSİDİR: AI bandı değiştiremez.
       * Bunu okunur kılmak için üç değer birlikte döndürülür — aksi hâlde
       * bandı skordan yeniden türeten bir tüketici korumayı sessizce kaybeder.
       */
      bandExplanation:
        record.baseScore === null
          ? "Bant, kural tabanlı skordan türetilmiştir (bu kayıt taban skor ayrımından önce üretildi)."
          : `Kural skoru: ${record.baseScore} · AI düzeltmesi: ` +
            `${(record.aiAdjustment ?? 0) >= 0 ? "+" : ""}${record.aiAdjustment ?? 0} · ` +
            `nihai skor: ${record.score} · bant: ${SCORE_BAND_LABELS[record.band]} ` +
            "(bant DAİMA kural skorundan türer; AI düzeltmesi bandı değiştiremez).",
      advisory:
        "Bu skor bir ÖNERİDİR, hukuki veya mali garanti değildir. Taban skor dosyadaki " +
        "kayıtlı verilerden deterministik olarak hesaplanmıştır; AI yalnızca yorum yazar.",
    };
  }
}

/** ruleSignalsJson'ı güvenle çözer — bozuk kayıt listeyi düşürmez. */
export function parseSignals(json: string): RuleSignal[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as RuleSignal[]) : [];
  } catch {
    return [];
  }
}
