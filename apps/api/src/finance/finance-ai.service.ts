import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../common/types";
import { ROLE_LABELS } from "../common/roles";
import { formatTrDate } from "../common/dates";
import { buildLocalMessages } from "../assistant/assistant.prompts";
import { AssistantLlmService } from "../assistant/assistant-llm.service";
import { assertFinanceAccess, FINANCE_ACCESS } from "./finance-access";
import { FinanceSummaryService } from "./finance-summary.service";
import { formatMoneyTr } from "./money";
import {
  FinanceNarrativeSchema,
  financeSummaryPrompt,
  findFabricatedNumbers,
  findUnknownPlaceholders,
  renderFinanceTemplate,
} from "./finance.prompts";
import type { FinanceAskInput } from "./finance.dto";

/**
 * VERİ MİNİMİZASYONU BEYANI — ÖLÇÜLEN, İDDİA EDİLEN DEĞİL.
 *
 * Eski metin "HİÇBİR tutar, müvekkil adı, dosya numarası … iletilmedi" diyordu
 * ve yanıttaki `clientIdentitySentToLlm: false` SABİT YAZILMIŞTI (denetim
 * bulgusu 11). Oysa `SORU: ${input.question}` modele BİREBİR gidiyor:
 * kullanıcı "ABC Holding'in 350.000 TL'lik bakiyesi ne oldu?" yazdığında
 * modele hem müvekkil adı hem tutar gider — üstelik prompt'un few-shot örneği
 * tam da bu biçimde bir soru gösteriyor, yani beklenen kullanım budur.
 *
 * Bu alan KVKK denetiminde gösterilecek çıktıdır; yanlış olması, eksik
 * olmasından kötüdür. Beyan artık DETERMİNİSTİK ÖZET ile KULLANICI SORUSUNU
 * ayırıyor ve sorunun maskeleme kapısından geçip geçmediğini ÖLÇEREK bildiriyor.
 */
const DATA_MINIMIZATION_EXPLANATION =
  "KVKK veri minimizasyonu: NomosOS'un hesapladığı deterministik özetin HİÇBİR satırı, " +
  "tutarı, müvekkil adı ya da dosya numarası dil modeline gönderilmedi; modele yalnızca " +
  "rakamsız nitel sinyaller (risk bandı, vadesi geçmiş fatura var mı, avans bakiyesi " +
  "pozitif mi) iletildi. Metindeki bütün sayılar veritabanından, Decimal aritmetiğiyle " +
  "hesaplanıp şablona API tarafından yerleştirildi. ANCAK KULLANICININ KENDİ SORU METNİ " +
  "modele iletilir; soruda müvekkil adı veya tutar yazdıysanız bu bilgi — KVKK maskeleme " +
  "kapısından geçirilerek — sağlayıcıya ulaşır.";

/**
 * POST /finance/ask — CLIENT_FINANCIAL_SUMMARY.
 *
 * AKIŞ (bkz. finance.prompts.ts başlığı):
 *   1. Rol kapısı (STAJYER ve SEKRETER finans verisini AI'a taşıyamaz).
 *   2. DETERMİNİSTİK ÖZET — `FinanceSummaryService` hesaplar.
 *   3. LLM'e YALNIZCA soru + rakamsız sinyaller gider (`buildSignals`).
 *   4. LLM yer tutuculu şablon üretir.
 *   5. UYDURMA RAKAM KAPISI — şablonda rakam varsa 422, kullanıcıya ulaşmaz.
 *   6. Şablon gerçek tutarlarla doldurulur ve döndürülür.
 *
 * Yanıttaki `summary` alanı özetin kendisidir: avukat, anlatımdaki her sayıyı
 * kaynağıyla karşılaştırabilir.
 */
@Injectable()
export class FinanceAiService {
  constructor(
    private readonly summaries: FinanceSummaryService,
    private readonly llm: AssistantLlmService,
    private readonly audit: AuditService,
  ) {}

  async ask(user: AuthUser, input: FinanceAskInput) {
    assertFinanceAccess(user, FINANCE_ACCESS.AI, "finans verisini AI ile yorumlatma");

    const scope = input.clientId ? "MUVEKKIL" : "BURO";

    // (2) Deterministik özet — tüm sayılar buradan gelir.
    const summary = input.clientId
      ? await this.summaries.clientSummary(user, input.clientId)
      : await this.summaries.officeSummary(user, {});

    const { values, signals } = this.buildContext(scope, summary);

    // (3) LLM'e giden içerik: soru + nitel sinyaller. Tutar/isim YOK.
    const messages = buildLocalMessages(
      financeSummaryPrompt,
      [
        `SORU: ${input.question}`,
        `KAPSAM: ${scope}`,
        "SİNYALLER (rakam içermez):",
        ...signals.map((s) => `- ${s}`),
      ].join("\n"),
    );

    const run = await this.llm.runTask({
      user,
      routeKeys: ["CLIENT_FINANCIAL_SUMMARY", "OFFICE_QUERY", "CASE_CHAT"],
      logTaskType: "CLIENT_FINANCIAL_SUMMARY",
      messages,
      schema: FinanceNarrativeSchema,
      // Anlatım bir "bulgu" değildir; kaynaksız eleme uygulanmaz.
      findingPaths: [],
      piiApproved: input.piiApproved,
      maxTokens: 1200,
      auditDetail: `kapsam=${scope} veriMinimizasyonu=tutarGonderilmedi`,
    });

    // (5) UYDURMA RAKAM KAPISI.
    const candidateTexts = [
      run.data.narrativeTemplate,
      ...run.data.highlights,
      ...run.data.recommendedActions,
      run.data.scopeNote,
    ];
    const fabricated = [...new Set(candidateTexts.flatMap((t) => findFabricatedNumbers(t)))];
    if (fabricated.length > 0) {
      await this.audit.log({
        tenantId: user.tenantId,
        userId: user.userId,
        action: "AI_FINANCE_NARRATIVE_REJECTED",
        entity: "AiUsageLog",
        entityId: run.usageLogId,
        detail: `Model tutar/oran uydurdu, çıktı reddedildi: ${fabricated.slice(0, 10).join(", ")}`,
      });
      throw new UnprocessableEntityException({
        message:
          "AI yanıtı reddedildi: model metne kendi ürettiği sayı(lar) yazdı. Finans " +
          "rakamları yalnızca NomosOS'un deterministik hesabından gelebilir. " +
          "Lütfen tekrar deneyin; sorun sürerse Ayarlar'dan daha güçlü bir model seçin.",
        fabricatedTokens: fabricated,
        deterministicSummary: summary,
      });
    }

    const unknownPlaceholders = [
      ...new Set(candidateTexts.flatMap((t) => findUnknownPlaceholders(t))),
    ];

    // (6) Gerçek tutarları API yerleştirir.
    const answer = renderFinanceTemplate(run.data.narrativeTemplate, values);

    return {
      question: input.question,
      scope,
      answer,
      highlights: run.data.highlights.map((h) => renderFinanceTemplate(h, values)),
      recommendedActions: run.data.recommendedActions.map((a) => renderFinanceTemplate(a, values)),
      scopeNote: run.data.scopeNote
        ? renderFinanceTemplate(run.data.scopeNote, values)
        : `Sonuçlar yalnızca kendi büronuzun kayıtları üzerinde, ${ROLE_LABELS[user.role]} rolünüzün yetkisiyle sınırlıdır.`,
      /** Anlatımın dayandığı DETERMİNİSTİK özet — her sayı buradan gelir. */
      summary,
      /** Şablonda doldurulan gerçek değerler (denetlenebilirlik). */
      renderedValues: values,
      unknownPlaceholders,
      /**
       * Alanların hepsi ÖLÇÜMDÜR, sabit değil:
       *   - `rowsSentToLlm` / `amountsSentToLlm`: deterministik özetten modele
       *     hiçbir satır/tutar geçmez (sinyaller `buildContext`'te üretilir).
       *   - `questionSentVerbatim`: soru metni modele birebir gider (true).
       *   - `piiMaskedInQuestion`: maskeleme kapısının o çağrıda çalışıp
       *     çalışmadığı — `AssistantLlmService`'in gerçek sonucu.
       */
      dataMinimization: {
        rowsSentToLlm: 0,
        amountsSentToLlm: 0,
        questionSentVerbatim: true,
        piiMaskedInQuestion: run.piiMasked,
        explanation: DATA_MINIMIZATION_EXPLANATION,
      },
      advisory: run.advisory,
      model: run.model,
      usageLogId: run.usageLogId,
      piiMasked: run.piiMasked,
    };
  }

  /**
   * Deterministik özetten iki şey üretir:
   *   `values`  → şablona yerleştirilecek GERÇEK değerler (LLM görmez).
   *   `signals` → LLM'e gidecek RAKAMSIZ nitel sinyaller.
   */
  private buildContext(
    scope: "MUVEKKIL" | "BURO",
    summary: Awaited<ReturnType<FinanceSummaryService["clientSummary"]>> | Awaited<ReturnType<FinanceSummaryService["officeSummary"]>>,
  ): { values: Record<string, string>; signals: string[] } {
    const values: Record<string, string> = {};
    const signals: string[] = [];

    if (scope === "MUVEKKIL") {
      const s = summary as Awaited<ReturnType<FinanceSummaryService["clientSummary"]>>;
      const primary = s.primary;
      const currency = primary?.currency ?? "TRY";

      values.muvekkil = s.client.name;
      values.paraBirimi = currency;
      values.acikDosya = String(s.openCaseCount);
      values.tahakkuk = formatMoneyTr(primary?.accrued ?? "0", currency);
      values.tahsilat = formatMoneyTr(primary?.netCollected ?? "0", currency);
      values.bekleyen = formatMoneyTr(primary?.outstanding ?? "0", currency);
      values.bekleyenOran = `%${s.risk.outstandingRatioPercent}`;
      values.masraf = formatMoneyTr(primary?.expenses ?? "0", currency);
      values.harc = formatMoneyTr(primary?.courtFees ?? "0", currency);
      values.avansBakiyesi = formatMoneyTr(primary?.advanceBalance ?? "0", currency);
      values.risk = this.riskLabel(s.risk.band);
      values.vadesiGecenFatura = String(s.receivables.overdueInvoiceCount);
      values.ortalamaGecikmeGun = String(s.risk.averageOverdueDays);
      values.acikFatura = String(s.receivables.openInvoiceCount);
      values.donem = "tüm zamanlar";

      signals.push(
        `riskBandi: ${s.risk.band}`,
        `bekleyenBakiyeVarMi: ${this.yesNo(this.isPositiveAmountString(primary?.outstanding))}`,
        `vadesiGecenFaturaVarMi: ${this.yesNo(s.receivables.overdueInvoiceCount > 0)}`,
        `avansBakiyesiDurumu: ${this.balanceState(primary?.advanceBalance ?? "0")}`,
        `paraBirimiCesitliligi: ${s.currencies.length > 1 ? "COKLU" : "TEK"}`,
        `acikDosyaVarMi: ${this.yesNo(s.openCaseCount > 0)}`,
        `masrafKaydiVarMi: ${this.yesNo(this.isPositiveAmountString(primary?.expenses))}`,
      );
    } else {
      const s = summary as Awaited<ReturnType<FinanceSummaryService["officeSummary"]>>;
      const period = s.periodTotals.find((t) => t.currency === "TRY") ?? s.periodTotals[0];
      const allTime = s.allTimeTotals.find((t) => t.currency === "TRY") ?? s.allTimeTotals[0];
      const currency = allTime?.currency ?? "TRY";

      values.muvekkil = "Büro geneli";
      values.paraBirimi = currency;
      values.acikDosya = "-";
      values.tahakkuk = formatMoneyTr(period?.accrued ?? "0", currency);
      values.tahsilat = formatMoneyTr(period?.netCollected ?? "0", currency);
      values.bekleyen = formatMoneyTr(allTime?.outstanding ?? "0", currency);
      values.bekleyenOran = "-";
      values.masraf = formatMoneyTr(period?.expenses ?? "0", currency);
      values.harc = formatMoneyTr(period?.courtFees ?? "0", currency);
      values.avansBakiyesi = formatMoneyTr(allTime?.advanceBalance ?? "0", currency);
      values.risk = "-";
      values.vadesiGecenFatura = String(s.receivables.overdueInvoiceCount);
      values.ortalamaGecikmeGun = String(s.receivables.averageOverdueDays);
      values.acikFatura = String(s.receivables.openInvoiceCount);
      values.donem = `${formatTrDate(s.period.from)} – ${formatTrDate(s.period.to)}`;

      signals.push(
        "kapsam: BURO",
        `vadesiGecenFaturaVarMi: ${this.yesNo(s.receivables.overdueInvoiceCount > 0)}`,
        `acikFaturaVarMi: ${this.yesNo(s.receivables.openInvoiceCount > 0)}`,
        `borcluMuvekkilVarMi: ${this.yesNo(s.topDebtors.length > 0)}`,
        `paraBirimiCesitliligi: ${s.allTimeTotals.length > 1 ? "COKLU" : "TEK"}`,
      );
    }

    return { values, signals };
  }

  private yesNo(value: boolean): string {
    return value ? "EVET" : "HAYIR";
  }

  /**
   * "40000.00" biçimindeki tutar STRING'i pozitif mi? `Number()` KULLANILMAZ —
   * kayan noktaya çevirmemek için saf metin kontrolü yapılır.
   */
  private isPositiveAmountString(amount: string | undefined): boolean {
    if (!amount) return false;
    if (amount.startsWith("-")) return false;
    return !/^0+(?:\.0+)?$/.test(amount);
  }

  /** Rakam değil, DURUM bildirir — LLM'e tutar gitmesin diye. */
  private balanceState(amount: string): string {
    if (amount.startsWith("-")) return "EKSI";
    return /^0+(?:\.0+)?$/.test(amount) ? "SIFIR" : "POZITIF";
  }

  private riskLabel(band: string): string {
    return band === "YUKSEK" ? "yüksek" : band === "ORTA" ? "orta" : "düşük";
  }
}
