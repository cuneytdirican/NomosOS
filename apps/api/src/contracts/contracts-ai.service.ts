/**
 * CONTRACT_REVIEW — sözleşme incelemesi. ÇIKTI ÖNERİDİR.
 *
 * ÜRÜN İLKELERİ:
 *
 *  1. HİÇBİR ALAN OTOMATİK YAZILMAZ. Bu servis `Contract`, `ContractVersion`
 *     veya `Deadline` tablolarına DOKUNMAZ. Yürürlük tarihi, ihbar süresi gibi
 *     alan önerileri yanıtta döner; avukat `PATCH /contracts/:id` ile işler.
 *
 *  2. HER RİSKLİ MADDE BULGUSUNDA ALINTI ZORUNLUDUR ve alıntı SUNUCUDA
 *     DOĞRULANIR (docs/moduller/20, kabul kriteri 3). İki kapı üst üste çalışır:
 *       (a) output-guard → `sourceQuote` alanı boş olan bulgular elenir,
 *       (b) quote-guard  → alıntı sözleşme metninde birebir aranır.
 *     Elenen bulgular yanıtta `droppedQuotes` olarak GÖRÜNÜR — sessiz eleme yok.
 *
 *  3. EKSİK HÜKÜM İDDİALARI DETERMİNİSTİK OLARAK DENETLENİR: konunun anahtar
 *     kelimeleri metinde geçiyorsa "eksik" bulgusu elenir (missing-clause-topics).
 *
 *  4. KVKK. Sözleşme metni taraf kimlikleri, adres ve IBAN taşır; dışa giden
 *     metin `AiRunnerService`in maskeleme kapısından geçer (409 akışı).
 */

import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { scanPii } from "@nomosos/ai";
import { PrismaService } from "../prisma/prisma.service";
import { AiRunnerService } from "../caselaw/ai-runner.service";
import { AuditService } from "../audit/audit.service";
import { assertRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";
import {
  CONTRACT_REVIEW_TASK,
  ContractReviewOutputSchema,
  buildContractReviewMessages,
} from "./contract-prompts";
import { checkMissingClaim } from "./missing-clause-topics";
import {
  DROP_REASON_LABELS,
  filterByVerbatimQuote,
  type DroppedQuoteFinding,
} from "./quote-guard";
import type { ReviewContractInput } from "./contracts.dto";

/** Modele gönderilecek sözleşme metninin azami uzunluğu. */
const CONTRACT_TEXT_CHARS = 40_000;

const ADVISORY_BANNER =
  "Bu inceleme YAPAY ZEKÂ ÖNERİSİDİR, hukuki mütalaa değildir. Bulguların sözleşme " +
  "metnine işlenip işlenmeyeceği AVUKATIN KARARIDIR; sistem sözleşmede hiçbir " +
  "değişiklik yapmamıştır.";

@Injectable()
export class ContractsAiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiRunnerService,
    private readonly audit: AuditService,
  ) {}

  /** POST /contracts/:id/review */
  async review(user: AuthUser, contractId: string, input: ReviewContractInput) {
    assertRole(user, ROLE_SETS.HUKUKI, "sözleşme incelemesi çalıştırma");

    const contract = await this.prisma.client.contract.findFirst({
      where: { id: contractId, tenantId: user.tenantId },
      select: {
        id: true,
        title: true,
        type: true,
        status: true,
        currentVersionId: true,
        effectiveFrom: true,
        effectiveTo: true,
        renewalNoticeDays: true,
        autoRenew: true,
        client: { select: { id: true, name: true } },
      },
    });
    if (!contract) throw new NotFoundException("Sözleşme bulunamadı.");

    const versionId = input.versionId ?? contract.currentVersionId;
    if (!versionId) {
      throw new BadRequestException(
        "Sözleşmenin incelenecek bir sürümü yok. Önce sözleşme metnini bir sürüm olarak ekleyin.",
      );
    }

    const version = await this.prisma.client.contractVersion.findFirst({
      // `ContractVersion` üzerinde tenantId YOKTUR; süzgeç ÜST KAYITTAN gelir.
      where: { id: versionId, contract: { id: contractId, tenantId: user.tenantId } },
      select: { id: true, versionNo: true, contentText: true, changeNote: true, createdAt: true },
    });
    if (!version) throw new NotFoundException("Sözleşme sürümü bulunamadı.");

    const text = version.contentText.trim();
    if (text.length < 50) {
      throw new BadRequestException(
        "Sürüm metni inceleme için çok kısa. Sözleşmenin tam metnini yükleyin.",
      );
    }

    const ourParty = input.ourParty?.trim() || contract.client?.name || null;

    const context = [
      `SÖZLEŞME TİPİ: ${contract.type}`,
      `BAŞLIK: ${contract.title}`,
      `SÜRÜM: v${version.versionNo}` + (version.changeNote ? ` — ${version.changeNote}` : ""),
      ourParty
        ? `MÜVEKKİLİMİZ: ${ourParty}`
        : "MÜVEKKİLİMİZ: (taraf sıfatı bildirilmedi — inceleme genel dengeye göre yapılmalı)",
      "",
      "METİN:",
      truncate(text, CONTRACT_TEXT_CHARS),
    ].join("\n");

    const instruction = [
      "Yukarıdaki sözleşmeyi müvekkilimiz lehine incele: riskli maddeler, eksik hükümler ve",
      "tek taraflı şartlar. Her riskli madde bulgusunda METİNDEN BİREBİR ALINTI (sourceQuote)",
      "ver; sunucu alıntıyı metinde arar ve bulamazsa bulguyu SİLER. Metinde bulunmayan bir",
      "maddeye atıf yapma. Eksik hüküm listesine, metinde GERÇEKTEN olmayan konuları yaz.",
      input.focus?.trim() ? `\nAVUKATIN YÖNLENDİRMESİ: ${input.focus.trim()}` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const run = await this.ai.run({
      user,
      taskType: CONTRACT_REVIEW_TASK,
      // Sıra önemlidir: buildMessages maskeli metinleri aynı sırayla alır.
      outboundTexts: [context, instruction],
      piiApproved: input.piiApproved,
      schema: ContractReviewOutputSchema,
      // Kaynak alanı BOŞ olan riskli madde bulguları burada elenir.
      // `missingClauses` bilinçli olarak DIŞARIDA: yokluk alıntılanamaz,
      // onların kapısı aşağıdaki deterministik denetimdir.
      findingPaths: ["riskyClauses"],
      entity: "Contract",
      entityId: contract.id,
      maxTokens: 4096,
      buildMessages: ([ctx, instr]) =>
        buildContractReviewMessages({ contextText: ctx, instruction: instr }),
    });

    // ── KAPI (b): ALINTI SÖZLEŞME METNİNDE BİREBİR VAR MI ──────────────────
    //
    // ARAMA, MODELİN GÖRDÜĞÜ METİNDE YAPILIR (denetim bulgusu 3). Doğrulama
    // ham `text`'e karşı yapılıyordu; oysa KVKK kapısı dışa giden metni
    // MASKELEYEBİLİR ve sözleşme metni taraf kimlikleri, adres ve IBAN taşır.
    // Maskelenen bir değeri kapsayan DOĞRU bir alıntı ham metinde bulunamaz;
    // sonuç, gerçek bir riskli madde bulgusunun sessizce kaybolmasıydı.
    const haystack = run.piiMasked ? scanPii(text).maskedText : text;
    const risky = filterByVerbatimQuote(
      run.data.riskyClauses,
      haystack,
      (r) => r.sourceQuote,
      (r) => r.title,
    );

    // Madde referansı da denetlenir: model "m.14" diyorsa metinde 14. madde
    // görünmeli. Bulunamazsa bulgu SİLİNMEZ (alıntısı doğrulanmıştır) ama
    // referans TEMİZLENİR ve kullanıcı uyarılır — yanlış madde numarası,
    // doğru bir bulguyu okunamaz hâle getirir.
    const unverifiedRefs: string[] = [];
    const riskyClauses = risky.kept.map((r) => {
      if (r.clauseRef && !clauseRefAppears(r.clauseRef, text)) {
        unverifiedRefs.push(r.clauseRef);
        return { ...r, clauseRef: undefined, clauseRefWarning: `Bildirilen madde referansı ("${r.clauseRef}") metinde bulunamadı; kaldırıldı.` };
      }
      return { ...r, clauseRefWarning: null };
    });

    // ── EKSİK HÜKÜM DENETİMİ (deterministik) ───────────────────────────────
    const missingKept: typeof run.data.missingClauses = [];
    const missingDropped: {
      topic: string;
      reason: string;
      matchedKeyword: string | null;
    }[] = [];
    for (const m of run.data.missingClauses) {
      const check = checkMissingClaim(m.topic, text);
      if (check.presentInText) {
        missingDropped.push({
          topic: m.topic,
          reason:
            `Sözleşme metninde "${check.matchedKeyword}" ifadesi geçiyor; "eksik hüküm" ` +
            "iddiası doğrulanamadığı için elendi. (Bu, hükmün YETERLİ olduğu anlamına " +
            "gelmez — yalnızca hiç bulunmadığı iddiasını çürütür.)",
          matchedKeyword: check.matchedKeyword,
        });
        continue;
      }
      missingKept.push(m);
    }

    const dropped: DroppedQuoteFinding[] = risky.dropped;

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "AI_CONTRACT_REVIEW_GUARD",
      entity: "Contract",
      entityId: contract.id,
      detail:
        `sürüm=v${version.versionNo} riskli=${riskyClauses.length} ` +
        `elenen_alıntı=${dropped.length} elenen_eksik=${missingDropped.length} ` +
        `doğrulanmayan_madde_ref=${unverifiedRefs.length}`,
    });

    return {
      contractId: contract.id,
      versionId: version.id,
      versionNo: version.versionNo,
      /** AVUKAT KARARI ŞERİDİ — her yanıtta durur. */
      advisory: { ...run.advisory, banner: ADVISORY_BANNER },
      approval: {
        required: true,
        /** HİÇBİR KAYIT AÇILMAZ/DEĞİŞTİRİLMEZ. */
        writesRecords: [],
        note:
          "Bu çıktı bir ÖNERİ RAPORUDUR. Sözleşme metni, sürümler, yürürlük tarihleri ve " +
          "süre kayıtları DEĞİŞMEMİŞTİR. Bulguları müzakere notuna dönüştürmek ve metni " +
          "revize etmek avukatın kararıdır.",
      },
      riskyClauses,
      missingClauses: missingKept,
      overallNote: run.data.overallNote ?? null,
      favorsParty: run.data.favorsParty ?? null,
      /**
       * DÜZ BULGU LİSTESİ — arayüzün tek listede gösterebilmesi için riskli ve
       * eksik maddelerin ortak alan adlarıyla izdüşümü. Üstteki iki dizi ASIL
       * kaynaktır; bu alan yalnızca sunum kolaylığıdır ve aynı bulguları
       * tekrarlar (yeni bilgi eklemez).
       */
      findings: [
        ...riskyClauses.map((r) => ({
          kind: "RISK" as const,
          severity: r.severity,
          clause: r.clauseRef ?? null,
          title: r.title,
          detail: r.explanation,
          quote: r.sourceQuote ?? null,
          suggestion: r.suggestion ?? null,
          legalBasis: r.legalBasis ?? null,
          riskType: r.riskType,
        })),
        ...missingKept.map((m) => ({
          kind: "EKSIK" as const,
          // Eksik hüküm bulgularının şiddeti model tarafından verilmez;
          // ORTA sabittir ve "eksik" olmanın kendisi bilgidir.
          severity: "ORTA" as const,
          clause: null,
          title: m.topic,
          detail: m.whyNeeded,
          // YOKLUK ALINTILANAMAZ — bu bulgularda alıntı olmaması normaldir.
          quote: null,
          suggestion: m.suggestedText ?? null,
          legalBasis: null,
          riskType: null,
        })),
      ],
      /** Arayüzün `summary` beklentisi — `overallNote` ile aynı içerik. */
      summary: run.data.overallNote ?? null,
      model: run.model,
      createdAt: new Date(),
      guard: {
        /** Alıntısı metinde doğrulanamadığı için elenen riskli maddeler. */
        droppedQuotes: dropped.map((d) => ({ ...d, reasonLabel: DROP_REASON_LABELS[d.reason] })),
        /** Konusu metinde geçtiği için elenen "eksik hüküm" iddiaları. */
        droppedMissingClaims: missingDropped,
        /** Metinde bulunamadığı için temizlenen madde referansları. */
        unverifiedClauseRefs: unverifiedRefs,
        note:
          "Her riskli madde alıntısı sözleşme metninde birebir aranmıştır; bulunamayan " +
          "bulgular yukarıda gerekçesiyle listelenmiş ve yanıttan çıkarılmıştır.",
      },
      ai: {
        model: run.model,
        providerType: run.providerType,
        piiMasked: run.piiMasked,
        /** Kaynak alanı boş olduğu için output-guard'da elenenler. */
        droppedFindings: run.droppedFindings,
        citations: run.citations,
        usage: run.usage,
      },
    };
  }
}

/**
 * "m.7" / "madde 7" / "7." biçimlerinden birinin metinde geçip geçmediği.
 * Kaba ama YANLIŞ POZİTİFE değil, yanlış negatife eğilimlidir: emin
 * olamadığımızda referansı korumak yerine temizlemeyi seçeriz.
 */
function clauseRefAppears(ref: string, text: string): boolean {
  const num = /(\d+)/.exec(ref)?.[1];
  if (!num) return true; // Sayı içermeyen referans (ör. "Ek-1") denetlenmez.
  const lower = text.toLocaleLowerCase("tr-TR");
  return (
    lower.includes(`madde ${num}`) ||
    lower.includes(`m.${num}`) ||
    lower.includes(`m. ${num}`) ||
    new RegExp(`(^|\\n)\\s*${num}[.)]`, "m").test(lower)
  );
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  // Sözleşmede SATIR YAPISI anlamlıdır (madde başlıkları); boşluk sıkıştırma
  // yapılmaz, yalnızca sondan kırpılır.
  return `${text.slice(0, max)}\n…[METİN KISALTILDI — inceleme yalnızca yukarıdaki kısmı kapsar]`;
}
