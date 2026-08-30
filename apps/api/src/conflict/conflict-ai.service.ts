/**
 * CONFLICT_INFERENCE — ÇATIŞMA ÇIKARIMININ İKİNCİ, OPSİYONEL KATMANI.
 *
 * Bu katman "ABC Holding" ↔ "ABC İnşaat A.Ş." gibi karakter benzerliğiyle
 * yakalanamayan grup/bağlı şirket ilişkilerini ÖNERİR. Sınırları katıdır:
 *
 *  1. AI YALNIZ GRİ BÖLGEYİ GÖRÜR. Deterministik eşiği (0,75) geçen kayıtlar
 *     zaten kesinleşmiştir ve modele sorulmaz — "bu gerçekten aynı şirket mi"
 *     diye LLM'e danışmak, kayıt üzerinden doğrulanmış bir bulguyu tahmine
 *     çevirmek olurdu.
 *
 *  2. ÇIKTI DAİMA "OLASI"DIR. Üretilen her bulgu `BAGLI_SIRKET` tipiyle ve
 *     "AI ÇIKARIMI (OLASI)" ön ekiyle kaydedilir; `ConflictService` bu
 *     bulguların sonucu CAKISMA'ya çıkarmasına izin vermez.
 *
 *  3. MODELE YALNIZ AD/SIFAT/DOSYA ETİKETİ GİDER. Dosya içeriği, TCKN/VKN,
 *     iletişim bilgisi gönderilmez.
 *
 *     ANCAK: giden metnin TAMAMI ad ve unvandır — taranan yeni taraf ile
 *     büronun gri bölgedeki müvekkil/dosya tarafı adları. Ad-soyad hiçbir
 *     regex kalıbına girmediği için `scanPii` bu payload'ı "temiz" bulur ve
 *     kalıp tabanlı KVKK kapısı hiç tetiklenmez. Bu, denetimde KRİTİK bulgu
 *     olarak tespit edildi: müvekkil adları dış sağlayıcıya onaysız çıkıyordu.
 *
 *     BU YÜZDEN `requireExternalConsent` kullanılır: hedef dış sağlayıcıysa
 *     kalıp aranmadan, KOŞULSUZ 409 döner ve avukatın açık onayı istenir
 *     (`piiApproved: true`). Yerel/büro-içi modelde kapı çalışmaz.
 *
 *  4. HAM PROMPT YOKTUR. Mesajlar @nomosos/legal-ai'nin
 *     `buildConflictCheckMessages` fonksiyonuyla kurulur; sistem çekirdeği
 *     (uydurma yasağı, kaynak zorunluluğu) çağrının başında durur.
 *
 *  5. SAĞLAYICI ARIZASI TARAMAYI DÜŞÜRMEZ. Deterministik sonuç zaten
 *     üretilmiştir; AI katmanı hata verirse tarama uyarı ile tamamlanır.
 *     TEK İSTİSNA: KVKK onay talebi (409) — o, kullanıcıya sorulması gereken
 *     bilinçli bir karardır ve yutulamaz.
 */

import { ConflictException, Injectable, Logger } from "@nestjs/common";
import type { ConflictMatchType } from "@nomosos/db";
import { buildConflictCheckMessages, ConflictCheckOutputSchema } from "@nomosos/legal-ai";
import { AiRunnerService } from "../caselaw/ai-runner.service";
import { creditRunContext } from "../credits/credit-context";
import type { AuthUser } from "../common/types";
import type { GreyZoneRow } from "./conflict.service";

/** AI bulgusuna verilen temsilî benzerlik değeri (ölçüm değil, sıralama içindir). */
const AI_SEVERITY_SCORE: Record<"KIRMIZI" | "SARI" | "YESIL", number> = {
  KIRMIZI: 0.7,
  SARI: 0.6,
  YESIL: 0.5,
};

export interface InferenceInput {
  query: string;
  context: string | null;
  greyZone: readonly GreyZoneRow[];
  piiApproved?: boolean;
}

export interface InferenceHit {
  matchType: ConflictMatchType;
  entityType: string;
  entityId: string | null;
  matchedName: string;
  similarity: number;
  caseId: string | null;
  note: string;
}

export interface InferenceOutcome {
  hits: InferenceHit[];
  envelope: Record<string, unknown>;
}

@Injectable()
export class ConflictInferenceService {
  private readonly logger = new Logger(ConflictInferenceService.name);

  constructor(private readonly ai: AiRunnerService) {}

  async infer(user: AuthUser, input: InferenceInput): Promise<InferenceOutcome> {
    if (input.greyZone.length === 0) {
      return {
        hits: [],
        envelope: {
          ran: false,
          reason:
            "Gri bölgede aday kayıt yok; AI çıkarımı çalıştırılmadı (gereksiz kredi harcanmadı).",
        },
      };
    }

    const partyLabel =
      `"${input.query}"` + (input.context ? ` · bağlam: ${input.context}` : "");
    const indexLines = input.greyZone.map(
      (row) => `[${row.ref}] ${row.label} · deterministik benzerlik ${row.similarity.toFixed(2)}`,
    );
    /** Gri bölge satırlarını kaynak referansına çeviren indeks — uydurma ref elenir. */
    const knownRefs = new Set(input.greyZone.map((r) => r.ref));

    let run;
    try {
      run = await this.ai.run({
        user,
        taskType: "CONFLICT_INFERENCE",
        // KVKK kapısı bu iki metnin ÜZERİNDE çalışır; sıra buildMessages ile aynıdır.
        outboundTexts: [partyLabel, indexLines.join("\n")],
        piiApproved: input.piiApproved,
        // Payload'ın TAMAMI ad/unvan: kalıp taraması yeterli değildir, dış
        // sağlayıcıya çıkış için avukatın açık onayı ZORUNLUDUR (bkz. dosya başı 3).
        requireExternalConsent: {
          reason:
            `Bu tarama, "${input.query}" adıyla birlikte büronuzun ${input.greyZone.length} ` +
            "müvekkil/dosya tarafı adını (ve ilgili dosya numaralarını) DIŞ yapay zekâ " +
            "sağlayıcısına gönderecektir. Ad ve unvan da KVKK anlamında kişisel veridir. " +
            "Göndermeyi onaylıyorsanız isteği piiApproved: true ile tekrarlayın; " +
            "onaylamıyorsanız tarama deterministik sonuçla tamamlanmıştır ve zaten " +
            "kullanılabilir durumdadır.",
          preview: [partyLabel, ...indexLines].join("\n"),
        },
        schema: ConflictCheckOutputSchema,
        // Gerekçesiz eşleşme elenir (similarityReason zorunlu, sourceQuote kaynaktır).
        findingPaths: ["matches"],
        entity: "ConflictCheck",
        maxTokens: 2048,
        buildMessages: ([label, index]) =>
          buildConflictCheckMessages({
            newPartyLabel: label,
            partyIndexLines: index.split("\n").filter(Boolean),
          }),
      });
    } catch (err) {
      // KVKK onay talebi kullanıcıya sorulmalıdır — yutulamaz.
      if (err instanceof ConflictException) throw err;
      // HATA YUTULUYOR → UÇ 200 DÖNECEK → interceptor BAŞARI görecek.
      // Kredi kaydı düşürülmezse, kullanıcıya "AI çalıştırılamadı" diyen bir
      // yanıt için tam ücret tahsil edilirdi (iş kuralı 4 ihlali). Bu uç TEK
      // sağlayıcı çağrısı yapar; koşunun tamamını düşürmek güvenlidir.
      creditRunContext.discard();
      this.logger.warn(
        `Çatışma AI çıkarımı çalıştırılamadı, tarama deterministik sonuçla tamamlandı: ${
          (err as Error).message
        }`,
      );
      return {
        hits: [],
        envelope: {
          ran: false,
          degraded: true,
          reason:
            "AI çıkarım katmanı çalıştırılamadı. Tarama sonucu YALNIZCA deterministik kayıt " +
            "eşleşmelerine dayanmaktadır; bağlı şirket/grup ilişkisi ayrıca değerlendirilmelidir.",
        },
      };
    }

    const hits: InferenceHit[] = [];
    const droppedRefs: string[] = [];

    for (const match of run.data.matches) {
      const ref = match.recordRef.trim();
      // Modelin indekste OLMAYAN bir referans uydurmasına izin verilmez.
      if (!knownRefs.has(ref)) {
        droppedRefs.push(ref);
        continue;
      }
      const source = input.greyZone.find((r) => r.ref === ref);
      const [entityType, entityId] = splitRef(ref);
      hits.push({
        // AI bulgusunun tipi DAİMA BAGLI_SIRKET'tir: sunumda "AI çıkarımı"
        // rozetinin tek ve kaçırılamaz işareti budur.
        matchType: "BAGLI_SIRKET",
        entityType,
        entityId,
        matchedName: source?.label ?? ref,
        similarity: AI_SEVERITY_SCORE[match.severity],
        caseId: null,
        note:
          `AI ÇIKARIMI (OLASI, kesin sonuç değildir) · ${match.matchType} · ` +
          `${match.similarityReason}` +
          (match.sourceQuote ? ` · kaynak: ${match.sourceQuote}` : ""),
      });
    }

    return {
      hits,
      envelope: {
        ran: true,
        model: run.model,
        providerType: run.providerType,
        piiMasked: run.piiMasked,
        advisory: run.advisory,
        overallSeverity: run.data.overallSeverity,
        /** Kaynak göstermediği için guard tarafından elenen bulgular. */
        droppedFindings: run.droppedFindings,
        /** İndekste karşılığı olmadığı için REDDEDİLEN uydurma referanslar. */
        droppedUnknownRefs: droppedRefs,
        usage: run.usage,
        notice:
          "AI çıkarımları OLASI bağlantılardır; kayıt üzerinden doğrulanmadıkça çatışma " +
          "sayılmazlar ve tarama sonucunu ÇAKIŞMA'ya yükseltemezler.",
      },
    };
  }
}

/** "client-<uuid>" / "party-<uuid>" biçimini varlık tipi + kimliğe ayırır. */
function splitRef(ref: string): [string, string | null] {
  const idx = ref.indexOf("-");
  if (idx <= 0) return ["Bilinmiyor", null];
  const prefix = ref.slice(0, idx);
  const id = ref.slice(idx + 1);
  const entityType = prefix === "client" ? "Client" : prefix === "party" ? "CaseParty" : prefix;
  return [entityType, id || null];
}
