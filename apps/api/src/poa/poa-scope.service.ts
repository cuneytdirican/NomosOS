/**
 * POA_SCOPE_ANALYSIS — "Bu vekaletname bu dosya için yeterli mi?"
 *
 * ÜRÜN İLKELERİ BU DOSYADA SOMUTLAŞIR:
 *
 *  1. ÇIKTI ÖNERİDİR. Verdict hiçbir kaydı değiştirmez: vekaletname pasife
 *     çekilmez, dosyaya uyarı bandı basılmaz, görev açılmaz. Yalnızca
 *     `PoaScopeCheck` satırı (rapor) yazılır ve yanıt "avukat teyidi gerekir"
 *     şeridiyle döner.
 *
 *  2. VEKALETNAME METNİNDEN ALINTI ZORUNLU. İki kapı üst üste çalışır:
 *     (a) output-guard kaynak alanı BOŞ olan bulguları eler,
 *     (b) `quote-guard` alıntının metinde GERÇEKTEN geçtiğini doğrular.
 *     Her iki kapıdan da geçen bulgu kalmazsa verdict zorla BELIRSIZ olur —
 *     "metne bakmadan verilmiş yeterlilik kararı" kaydedilmez.
 *
 *  3. DETERMİNİSTİK ÖN TARAMA MODELE HAZIR VERİLİR. Hangi yetkinin katalogda
 *     eksik olduğu koddan hesaplanır (`computeMissingScopes`); model bu listeyi
 *     yeniden hesaplayamaz, yalnızca yorumlar. Böylece "hangi yetki var/yok"
 *     sorusunun cevabı LLM'in hafızasına bırakılmaz.
 *
 *  4. SÜRE VE AZİL AI'YA SORULMAZ. Süresi dolmuş veya azledilmiş vekaletname
 *     için model HİÇ ÇAĞRILMAZ: cevap deterministiktir ve YETERSIZ'dir.
 *     (Sağlayıcıya gidilmediği için kredi de düşmez — rezervasyon iade edilir.)
 *
 *  5. KVKK. Vekaletname metni TCKN, adres ve kimlik bilgisi taşır; dışa giden
 *     her metin `AiRunnerService`in maskeleme kapısından geçer (409 akışı).
 */

import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { scanPii } from "@nomosos/ai";
import type { PoaVerdict } from "@nomosos/db";
import { formatTrDate, toUtcDate } from "@nomosos/legal-core";
import { PrismaService } from "../prisma/prisma.service";
import { AiRunnerService } from "../caselaw/ai-runner.service";
import { AuditService } from "../audit/audit.service";
import { startOfDay } from "../common/dates";
import { assertRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";
import {
  DROP_REASON_LABELS,
  filterByVerbatimQuote,
  type DroppedQuoteFinding,
} from "../contracts/quote-guard";
import {
  CASE_TYPE_SCOPE_EXPECTATIONS,
  computeMissingScopes,
  parseScopeItems,
  scopeLabel,
} from "./poa-scope-catalog";
import {
  POA_SCOPE_TASK,
  PoaScopeOutputSchema,
  buildPoaScopeMessages,
} from "./poa-prompts";
import type { PoaScopeCheckInput } from "./poa.dto";

/** Modele gönderilecek kapsam metninin azami uzunluğu. */
const SCOPE_TEXT_CHARS = 12000;

/** "Avukat teyidi gerekir" şeridi — HER yanıtta durur. */
const ADVISORY_BANNER =
  "Bu değerlendirme YAPAY ZEKÂ ÖNERİSİDİR, hukuki mütalaa değildir. Vekaletnamenin " +
  "kapsamı hakkındaki nihai karar AVUKATIN TEYİDİNE bağlıdır; sistem hiçbir kaydı " +
  "bu sonuca göre değiştirmemiştir.";

@Injectable()
export class PoaScopeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiRunnerService,
    private readonly audit: AuditService,
  ) {}

  /** POST /power-of-attorney/:id/scope-check */
  async check(user: AuthUser, poaId: string, input: PoaScopeCheckInput) {
    assertRole(user, ROLE_SETS.HUKUKI, "vekaletname kapsam analizi çalıştırma");

    const poa = await this.prisma.client.powerOfAttorney.findFirst({
      where: { id: poaId, tenantId: user.tenantId },
      select: {
        id: true,
        clientId: true,
        caseId: true,
        type: true,
        notary: true,
        number: true,
        issuedAt: true,
        expiresAt: true,
        revokedAt: true,
        revokeReason: true,
        isActive: true,
        scope: true,
        scopeItemsJson: true,
        client: { select: { id: true, name: true } },
      },
    });
    if (!poa) throw new NotFoundException("Vekaletname kaydı bulunamadı.");

    const kase = await this.prisma.client.case.findFirst({
      where: { id: input.caseId, tenantId: user.tenantId },
      select: {
        id: true,
        clientId: true,
        type: true,
        status: true,
        title: true,
        subject: true,
        fileNumber: true,
        courtName: true,
      },
    });
    if (!kase) throw new NotFoundException("Dosya bulunamadı.");

    // Başka müvekkilin dosyası için bu vekaletname zaten hiç sorulmamalıydı.
    if (kase.clientId !== poa.clientId) {
      throw new BadRequestException(
        `${kase.fileNumber ?? "Seçilen dosya"} bu vekaletnamenin müvekkiline ait değil; ` +
          "kapsam analizi yapılamaz.",
      );
    }

    // ── DETERMİNİSTİK KAPI 1: kaydın geçerliliği ───────────────────────────
    // Süresi dolmuş / azledilmiş vekaletname için modele gitmeye gerek yok.
    const today = startOfDay(new Date());
    const expired =
      poa.expiresAt !== null && toUtcDate(poa.expiresAt) < toUtcDate(today);
    if (poa.revokedAt || expired || !poa.isActive) {
      return this.deterministicVerdict(user, poa, kase, input, {
        verdict: "YETERSIZ",
        reason: poa.revokedAt
          ? `Vekaletname ${formatTrDate(poa.revokedAt)} tarihinde sonlandırılmıştır ` +
            `(${poa.revokeReason ?? "gerekçe girilmemiş"}). Sonlandırılmış vekaletnameye ` +
            "dayanarak işlem yapılamaz."
          : expired && poa.expiresAt
            ? `Vekaletnamenin süresi ${formatTrDate(poa.expiresAt)} tarihinde dolmuştur. ` +
              "Süresi dolmuş vekaletname bu dosyada kullanılamaz."
            : "Vekaletname kaydı pasif durumdadır ve kullanılamaz.",
      });
    }

    // ── DETERMİNİSTİK KAPI 2: incelenecek metin var mı ─────────────────────
    const scopeText = (poa.scope ?? "").trim();
    const { items } = parseScopeItems(poa.scopeItemsJson);
    if (!scopeText && items.length === 0) {
      return this.deterministicVerdict(user, poa, kase, input, {
        verdict: "BELIRSIZ",
        reason:
          "Vekaletnamenin kapsam metni girilmemiş ve özel yetki maddeleri işaretlenmemiş. " +
          "İnceleyecek bir metin olmadan yeterlilik değerlendirmesi yapılamaz. Taranmış " +
          "vekaletnameyi metne dönüştürüp kapsam alanına ekleyin veya yetki maddelerini " +
          "işaretleyin.",
      });
    }

    // ── DETERMİNİSTİK ÖN TARAMA — model bunu DEĞİŞTİREMEZ ──────────────────
    const prescreen = computeMissingScopes(kase.type, poa.scopeItemsJson);
    const expectation = CASE_TYPE_SCOPE_EXPECTATIONS[kase.type];

    const context = [
      "VEKALETNAME:",
      `- Müvekkil: ${poa.client.name}`,
      `- Noter/yevmiye: ${poa.notary ?? "-"} / ${poa.number ?? "-"}`,
      `- Tip: ${poa.type ?? "sınıflandırılmamış"} · Düzenleme: ${formatTrDate(poa.issuedAt)}` +
        ` · Bitiş: ${poa.expiresAt ? formatTrDate(poa.expiresAt) : "süresiz"}`,
      "",
      "VEKALETNAME KAPSAM METNİ:",
      scopeText ? truncate(scopeText, SCOPE_TEXT_CHARS) : "(kapsam metni girilmemiş)",
      "",
      "YAPILANDIRILMIŞ YETKİLER:",
      items.length
        ? items
            .map((i) => `- ${i.label} (${i.code}): ${i.present ? "VAR" : "YOK"}` +
              (i.note ? ` — ${i.note}` : ""))
            .join("\n")
        : "- (yetki maddesi işaretlenmemiş)",
      "",
      "DOSYA:",
      `- ${kase.fileNumber ?? "-"} · ${kase.title}`,
      `- Tür: ${kase.type} · Aşama: ${kase.status}` +
        (kase.courtName ? ` · Merci: ${kase.courtName}` : ""),
      `- Konu: ${kase.subject ?? "-"}`,
      "",
      "DETERMİNİSTİK ÖN TARAMA (sistem hesabı — DEĞİŞTİRME):",
      prescreen.present.length
        ? `[VAR] ${prescreen.present.map((c) => scopeLabel(c)).join(" · ")}`
        : "[VAR] (işaretli yetki yok)",
      // İKİ TÜR "YOK" AYRI ETİKETLENİR: "açıkça yok" avukatın kaydıdır,
      // "kayıt yok" yalnızca listede bulunmadığını söyler.
      prescreen.missingExpected.length
        ? prescreen.missingExpected
            .map(
              (e) =>
                `[${e.explicitlyAbsent ? "YETKİ YOK — AÇIKÇA İŞARETLİ" : "KAYIT YOK"}]` +
                `[${e.tier}] ${e.definition.code} (${e.definition.label})` +
                (e.definition.legalBasis ? ` — ${e.definition.legalBasis}` : ""),
            )
            .join("\n")
        : "[EKSİK] (bu dosya türünde beklenen yetkilerde eksik görünmüyor)",
      "",
      'NOT: "[KAYIT YOK]" bir yetkinin BULUNMADIĞI anlamına GELMEZ; kapsam listeleri çoğu',
      'zaman yalnız özel yetkileri sayar. Bu satırlarda kararını METNE bakarak ver.',
      '"[YETKİ YOK — AÇIKÇA İŞARETLİ]" ise avukatın o yetkinin bulunmadığını kaydettiğini gösterir.',
      "",
      `Bu dosya türünde tipik olarak aranan yetkiler: ${
        [...expectation.baseline, ...expectation.commonlyNeeded].map((c) => scopeLabel(c)).join(", ") ||
        "(bu türde standart bir liste tanımlı değil)"
      }.`,
    ].join("\n");

    const instruction = [
      "Yukarıdaki vekaletnamenin bu dosya için YETERLİ olup olmadığını değerlendir.",
      "[VAR] / [EKSİK-KRİTİK] / [EKSİK-OLASI] satırları sistemin DETERMİNİSTİK hesabıdır;",
      "yeniden hesaplama, yalnızca yorumla. Her bulguda vekaletname metninden BİREBİR alıntı",
      "(sourceQuote) ver; sunucu alıntıyı metinde arar ve bulamazsa bulguyu ELER.",
      "Eksik yetki bulgularında alıntı, incelediğin ve o yetkiyi İÇERMEYEN kapsam cümlesidir.",
      input.question?.trim() ? `\nAVUKATIN SORUSU: ${input.question.trim()}` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const run = await this.ai.run({
      user,
      taskType: POA_SCOPE_TASK,
      // Sıra önemlidir: buildMessages maskeli metinleri aynı sırayla alır.
      outboundTexts: [context, instruction],
      piiApproved: input.piiApproved,
      schema: PoaScopeOutputSchema,
      // Kaynak alanı BOŞ olan bulgular burada elenir; alıntının DOĞRU olup
      // olmadığı aşağıdaki quote-guard'da denetlenir.
      findingPaths: ["presentPowers", "missingPowers"],
      entity: "PowerOfAttorney",
      entityId: poa.id,
      maxTokens: 3072,
      buildMessages: ([ctx, instr]) =>
        buildPoaScopeMessages({ contextText: ctx, instruction: instr }),
    });

    // ── ALINTI DOĞRULAMA — uydurma alıntı yanıta SIZAMAZ ───────────────────
    // Aranacak kaynak metin: kapsam metni + işaretli yetki etiketleri. Yetki
    // maddeleri de "metin"dir: kapsam metni girilmemiş ama maddeleri işaretli
    // bir kayıtta model o etiketlere dayanabilmelidir.
    const sourceText = [
      scopeText,
      ...items.map((i) => `${i.label}${i.note ? ` ${i.note}` : ""}`),
    ]
      .filter(Boolean)
      .join("\n");

    /**
     * ALINTI, MODELİN GÖRDÜĞÜ METİNDE ARANIR (denetim bulgusu 3).
     *
     * Doğrulama ham `sourceText`'e karşı yapılıyordu; oysa KVKK kapısı
     * (`AiRunnerService.applyPiiGate`) dış sağlayıcıya çıkarken metni
     * MASKELEYEBİLİR. Vekaletname metni TCKN, adres ve IBAN taşır: maskelenen
     * bir değeri kapsayan DOĞRU bir alıntı ham metinde bulunamaz ve bulgu
     * `ALINTI_METINDE_BULUNAMADI` ile elenirdi. POA'da bunun sonucu daha da
     * ağırdı — `grounded === 0` olunca verdict zorla BELIRSIZ'e düşüyordu,
     * yani maskeleme açıkken kapsam analizi sistematik olarak kararsız kalıyordu.
     *
     * Aynı ders `inbound.service.ts`de zaten alınmıştı; buraya taşındı.
     */
    const haystack = run.piiMasked ? scanPii(sourceText).maskedText : sourceText;

    const present = filterByVerbatimQuote(
      run.data.presentPowers,
      haystack,
      (p) => p.sourceQuote,
      (p) => p.label,
    );
    const missing = filterByVerbatimQuote(
      run.data.missingPowers,
      haystack,
      (m) => m.sourceQuote,
      (m) => m.label,
    );
    const dropped: DroppedQuoteFinding[] = [...present.dropped, ...missing.dropped];

    // ── VERDICT KAPISI ─────────────────────────────────────────────────────
    // Alıntısı doğrulanmış TEK BİR bulgu bile kalmadıysa, model metne
    // bakmadan konuşmuş demektir: verdict zorla BELIRSIZ'e düşürülür.
    const grounded = present.kept.length + missing.kept.length;
    /** Avukatın "bu yetki YOK" diye KAYDETTİĞİ ve dosya türünde beklenen yetkiler. */
    const affirmativelyAbsent = prescreen.missingExpected.filter((e) => e.explicitlyAbsent);
    let verdict: PoaVerdict = run.data.verdict;
    let downgradeNote: string | null = null;

    if (grounded === 0) {
      if (verdict !== "BELIRSIZ") {
        downgradeNote =
          "Modelin verdiği bulguların hiçbiri vekaletname metninde doğrulanamadı; " +
          `değerlendirme "${verdict}" yerine BELIRSIZ olarak kaydedildi.`;
      }
      verdict = "BELIRSIZ";
    } else if (verdict === "YETERLI" && missing.kept.length > 0) {
      // İç tutarsızlık: "yeterli" derken doğrulanmış eksik yetki saymak.
      downgradeNote =
        "Model YETERLI dediği hâlde doğrulanmış eksik yetki bulguları var; " +
        "değerlendirme BELIRSIZ'e düşürüldü.";
      verdict = "BELIRSIZ";
    } else if (verdict === "YETERLI" && affirmativelyAbsent.length > 0) {
      // FAIL-CLOSED: avukat bir yetkinin BULUNMADIĞINI (present:false) açıkça
      // kaydetmiş ve o yetki bu dosya türünde bekleniyorsa, "yeterli" kararı
      // sessizce onaylanmaz.
      //
      // DİKKAT: yalnız "kayıt yok" durumunda düşürme YAPILMAZ. Kapsam listeleri
      // çoğu zaman yalnız özel yetkileri sayar; listede olmayan her yetkiyi
      // "eksik" saymak yanlış alarm üretir ve uyarıyı değersizleştirir.
      downgradeNote =
        "Vekaletnamede " +
        `${affirmativelyAbsent.map((e) => e.definition.label).join(", ")} yetkisi ` +
        "AÇIKÇA YOK olarak kayıtlı ve bu dosya türünde beklenen yetkiler arasında; " +
        "model YETERLI dese de değerlendirme BELIRSIZ'e düşürüldü.";
      verdict = "BELIRSIZ";
    }

    const missingPayload = missing.kept.map((m) => ({
      code: m.code ?? null,
      label: m.label,
      why: m.why,
      sourceQuote: m.sourceQuote ?? null,
    }));

    /**
     * KAYDA YAZILAN METNİN AYNISI YANITTA DA DÖNER (denetim bulgusu 8).
     *
     * Sistem `YETERLI` kararını `BELIRSIZ`'e düşürdüğünde gerekçe KAYDA
     * yazılıyor ama yanıtın `aiCommentary` alanına YAZILMIYORDU: orada modelin
     * "yeterlidir" diyen ham metni duruyordu. Avukat ekranda `BELIRSIZ` rozetiyle
     * birlikte "yeterli görünmektedir" cümlesini okuyor, sistemin NEDEN
     * düşürdüğünü göremiyordu. "Sessiz eleme yok" vaadi sunucuda tutulup
     * arayüzde tutulmuyordu.
     */
    const commentary = [run.data.reasoning, downgradeNote ? `\n\n[SİSTEM] ${downgradeNote}` : ""]
      .filter(Boolean)
      .join("");

    const record = await this.prisma.client.poaScopeCheck.create({
      data: {
        tenantId: user.tenantId,
        powerOfAttorneyId: poa.id,
        caseId: kase.id,
        question: input.question ?? null,
        verdict,
        missingPowersJson: JSON.stringify(missingPayload),
        aiCommentary: commentary,
        model: run.model,
        checkedBy: user.userId,
      },
      select: { id: true, checkedAt: true },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "POA_SCOPE_CHECK",
      entity: "PowerOfAttorney",
      entityId: poa.id,
      detail:
        `dosya=${kase.fileNumber ?? kase.id} verdict=${verdict} ` +
        `doğrulanan_bulgu=${grounded} elenen=${dropped.length} model=${run.model}`,
    });

    return {
      id: record.id,
      powerOfAttorneyId: poa.id,
      caseId: kase.id,
      checkedAt: record.checkedAt,
      verdict,
      /** AVUKAT TEYİDİ ŞERİDİ — her yanıtta durur. */
      advisory: { ...run.advisory, banner: ADVISORY_BANNER },
      approval: {
        required: true,
        writesRecords: ["PoaScopeCheck"],
        note:
          "Yalnızca bir DEĞERLENDİRME RAPORU kaydedilmiştir. Vekaletnamenin durumu, dosya " +
          "bağı ve kapsam maddeleri DEĞİŞMEMİŞTİR; gerekiyorsa yeni vekaletname almak " +
          "avukatın kararıdır.",
      },
      presentPowers: present.kept,
      missingPowers: withQuoteAlias(missingPayload),
      reasoning: run.data.reasoning,
      /** Arayüzün `aiCommentary` beklentisi — kayda yazılan metnin AYNISI. */
      aiCommentary: commentary,
      /**
       * DÜŞÜRME GEREKÇESİ ÜST DÜZEYDE de döner (yalnız `ai.*` altında değil):
       * arayüzün kararın YANINDA bir uyarı bandı çizebilmesi için.
       */
      verdictDowngradeNote: downgradeNote,
      /**
       * DOĞRULANMIŞ ALINTILAR — hepsi vekaletname metninde birebir bulunmuştur.
       * "Kaynak gösterme zorunluluğu"nun arayüzdeki görünür yüzü budur.
       */
      quotes: [
        ...present.kept.map((p) => p.sourceQuote),
        ...missing.kept.map((m) => m.sourceQuote),
      ].filter((q): q is string => typeof q === "string" && q.length > 0),
      recommendedAction: run.data.recommendedAction ?? null,
      confidence: run.data.confidence ?? null,
      /** DETERMİNİSTİK YARI — tek doğru kaynak budur. */
      deterministic: {
        computedBy: "katalog eşleşmesi (AI kullanılmaz)",
        caseType: kase.type,
        presentCodes: prescreen.present,
        /** `present: false` olarak KAYDEDİLMİŞ yetkiler — güvenilir "yok". */
        explicitlyAbsentCodes: prescreen.explicitlyAbsent,
        /**
         * Beklenen ama bulunmayan yetkiler. `explicitlyAbsent: false` olanlar
         * için "kayıt yok" denir; "yetki yok" DENMEZ (kapsam listeleri çoğu
         * zaman yalnız özel yetkileri sayar).
         */
        missingExpected: prescreen.missingExpected.map((e) => ({
          code: e.definition.code,
          label: e.definition.label,
          legalBasis: e.definition.legalBasis,
          requiresSpecialAuthority: e.definition.requiresSpecialAuthority,
          explicitlyAbsent: e.explicitlyAbsent,
          tier: e.tier,
          note: e.explicitlyAbsent
            ? "Vekaletnamede bu yetkinin BULUNMADIĞI açıkça kaydedilmiş."
            : "Bu yetki kapsam maddelerinde KAYITLI DEĞİL; bulunmadığı anlamına gelmez, " +
              "metinden teyit edin.",
        })),
        scopeParsed: prescreen.scopeParsed,
      },
      ai: {
        model: run.model,
        providerType: run.providerType,
        piiMasked: run.piiMasked,
        modelVerdict: run.data.verdict,
        verdictDowngradeNote: downgradeNote,
        /** Kaynak alanı boş olduğu için output-guard'da elenenler. */
        droppedFindings: run.droppedFindings,
        /** Alıntısı metinde doğrulanamadığı için elenenler — şeffaflık. */
        droppedQuotes: dropped.map((d) => ({ ...d, reasonLabel: DROP_REASON_LABELS[d.reason] })),
        citations: run.citations,
        usage: run.usage,
      },
    };
  }

  /** GET /power-of-attorney/:id/scope-checks */
  async history(user: AuthUser, poaId: string) {
    const poa = await this.prisma.client.powerOfAttorney.findFirst({
      where: { id: poaId, tenantId: user.tenantId },
      select: { id: true },
    });
    if (!poa) throw new NotFoundException("Vekaletname kaydı bulunamadı.");

    const rows = await this.prisma.client.poaScopeCheck.findMany({
      where: { tenantId: user.tenantId, powerOfAttorneyId: poaId },
      orderBy: { checkedAt: "desc" },
      take: 50,
      include: { case: { select: { id: true, fileNumber: true, title: true, type: true } } },
    });

    return {
      advisory: { banner: ADVISORY_BANNER },
      items: rows.map((r) => ({
        ...r,
        missingPowers: withQuoteAlias(safeJson<unknown[]>(r.missingPowersJson) ?? []),
      })),
    };
  }

  /**
   * AI ÇAĞRISI YAPILMADAN verilen karar (azil/süre/metin yokluğu).
   *
   * Rapor yine `PoaScopeCheck`e yazılır — avukat "bu dosyada kapsam sorgusu
   * yapıldı ve şu cevap alındı" izini görmelidir. `model` alanı `null` kalır:
   * bu satır bir MODEL ÇIKTISI DEĞİLDİR.
   */
  private async deterministicVerdict(
    user: AuthUser,
    poa: { id: string },
    kase: { id: string; fileNumber: string | null },
    input: PoaScopeCheckInput,
    outcome: { verdict: PoaVerdict; reason: string },
  ) {
    const record = await this.prisma.client.poaScopeCheck.create({
      data: {
        tenantId: user.tenantId,
        powerOfAttorneyId: poa.id,
        caseId: kase.id,
        question: input.question ?? null,
        verdict: outcome.verdict,
        missingPowersJson: JSON.stringify([]),
        aiCommentary: `[DETERMİNİSTİK TESPİT — yapay zekâ kullanılmadı] ${outcome.reason}`,
        model: null,
        checkedBy: user.userId,
      },
      select: { id: true, checkedAt: true },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "POA_SCOPE_CHECK",
      entity: "PowerOfAttorney",
      entityId: poa.id,
      detail:
        `dosya=${kase.fileNumber ?? kase.id} verdict=${outcome.verdict} ` +
        "kaynak=deterministik (model çağrılmadı)",
    });

    return {
      id: record.id,
      powerOfAttorneyId: poa.id,
      caseId: kase.id,
      checkedAt: record.checkedAt,
      verdict: outcome.verdict,
      advisory: {
        isAdvisory: true as const,
        notice: "Bu sonuç deterministik bir tespittir; yapay zekâ kullanılmamıştır.",
        banner: ADVISORY_BANNER,
      },
      approval: {
        required: true,
        writesRecords: ["PoaScopeCheck"],
        note: "Yalnızca bir değerlendirme raporu kaydedilmiştir; vekaletname DEĞİŞMEMİŞTİR.",
      },
      presentPowers: [],
      missingPowers: [],
      reasoning: outcome.reason,
      aiCommentary: `[DETERMİNİSTİK TESPİT — yapay zekâ kullanılmadı] ${outcome.reason}`,
      quotes: [],
      recommendedAction: null,
      confidence: null,
      deterministic: {
        computedBy: "kayıt geçerliliği kontrolü (AI kullanılmaz)",
        modelSkipped: true,
        modelSkippedReason: outcome.reason,
      },
      ai: null,
    };
  }
}

/**
 * Eksik yetki kayıtlarına `quote` takma adını ekler.
 *
 * KAYITTA TEK AD TUTULUR (`sourceQuote`); `quote` yalnızca yanıt biçiminde
 * üretilir. Aynı metni veritabanına iki kez yazmak, ileride birinin
 * güncellenip diğerinin unutulacağı bir tutarsızlık kaynağı olurdu.
 */
function withQuoteAlias(entries: readonly unknown[]): unknown[] {
  return entries.map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const rec = entry as Record<string, unknown>;
    const quote = rec.sourceQuote;
    if (typeof quote !== "string" || quote.length === 0) return entry;
    return { ...rec, quote };
  });
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)} …[KISALTILDI]`;
}

function safeJson<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}
