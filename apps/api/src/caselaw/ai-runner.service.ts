/**
 * BYO-LLM koşu yürütücüsü — Faz 2 AI uçlarının ortak omurgası.
 *
 * NEDEN BURADA: İçtihat (caselaw) katmanı, dilekçe (petitions) katmanının ALTINDA
 * durur (dilekçe teyidi içtihata bağımlıdır, tersi değil). İki modülün de ihtiyaç
 * duyduğu bu yürütücü, döngüsel bağımlılık üretmemek için alt katmanda tutulur ve
 * CaselawModule tarafından dışa aktarılır. Entegrasyon aşamasında ortak bir
 * `ai-runtime` modülüne taşınabilir; sözleşmesi değişmez.
 *
 * Yaptığı iş sırayla:
 *   1) Görev tipine göre tenant'ın sağlayıcı+model rotasını çözer (AiTaskRoute).
 *   2) KVKK KAPISI — dışa gidecek HER metni scanPii'den geçirir. Dış sağlayıcı +
 *      PII + onay yoksa HTTP 409 { requiresPiiApproval, findings, maskedText }.
 *   3) Maskeli metinlerle mesajları kurdurur (çağıranın buildMessages'ı).
 *   4) Sağlayıcıyı çağırır.
 *   5) packages/legal-ai output-guard: JSON ayrıştırma + kaynaksız bulgu elemesi +
 *      şema doğrulaması + atıf çıkarma + "öneridir" bayrağı.
 *   6) AiUsageLog + AuditLog yazar.
 *
 * Ham prompt yazılmaz: çağıranlar packages/legal-ai'deki PromptSpec/buildMessages
 * ile mesaj kurar, böylece NOMOSOS_SYSTEM_CORE_PROMPT (uydurma yasağı, kaynak
 * zorunluluğu, atıf disiplini) her çağrının başında durur.
 */

import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { AiProviderConfig } from "@nomosos/db";
import {
  createProvider,
  decryptSecret,
  isExternalDestination,
  scanPii,
  summarizeFindings,
  type CustomMapping,
  type LlmMessage,
  type PiiFinding,
  type ResolvedProviderConfig,
} from "@nomosos/ai";
import { guardOutput, type DroppedFinding, type ExtractedCitation } from "@nomosos/legal-ai";
import type { AiProviderType, AiTaskType } from "@nomosos/shared";
import type { TypeOf, ZodTypeAny } from "zod";
import { PrismaService } from "../prisma/prisma.service";
import { usageProviderRef } from "../common/ai-usage-provider";
import { AuditService } from "../audit/audit.service";
import { AgentRunService } from "../agents/agent-run.service";
import { PlatformAiService } from "../ai/platform-ai.service";
import { assertAiPolicyAllows } from "../common/ai-policy";
import { creditRunContext } from "../credits/credit-context";
import { providerUnreachable } from "../common/errors";
import type { AuthUser } from "../common/types";
import { readProviderHeaders } from "../common/provider-headers";

export interface AiRunInput<TSchema extends ZodTypeAny> {
  user: AuthUser;
  taskType: AiTaskType;
  /**
   * Dış sağlayıcıya gidecek TÜM serbest metinler. KVKK kapısı bunların ÜZERİNDE
   * çalışır; mesajlar bu dizinin maskeli hâliyle kurulur.
   */
  outboundTexts: string[];
  /** Maskeli metinlerden LLM mesaj zincirini kurar (legal-ai PromptSpec ile). */
  buildMessages: (texts: string[]) => LlmMessage[];
  /** Avukat maskeli metni onayladı mı? (409 akışının ikinci turu) */
  piiApproved?: boolean;
  /**
   * Metinler ÇAĞIRAN tarafından zaten KVKK kapısından geçirildiyse (ör. dosya
   * bağlamı kurulurken alan alan maskelendiyse) kapı tekrar çalıştırılmaz;
   * maskeleme bilgisi olduğu gibi AiUsageLog'a yazılır. `applyPiiGate` çağrılmadan
   * bu alan verilmemelidir — verildiğinde metinlerin taranmış olduğu VARSAYILIR.
   */
  preScanned?: { piiMasked: boolean };
  /**
   * DIŞ HEDEFE GİDİŞTE KOŞULSUZ ONAY İSTE — kalıp aramadan.
   *
   * `scanPii` yalnız TCKN/IBAN/telefon/e-posta gibi BİÇİMİ TANINABİLİR verileri
   * yakalar. Ad, unvan ve şirket adı hiçbir kalıba girmez; bu yüzden gövdesi
   * baştan sona addan ibaret olan bir çağrı (ör. çatışma taraması) kapıdan
   * "kişisel veri bulunamadı" diye geçerdi. Bu bayrak, böyle bir çağrıda dış
   * sağlayıcıya çıkış için avukatın AÇIK onayını (`piiApproved`) zorunlu kılar.
   *
   * Büro-içi/yerel hedefte hiçbir şey yapmaz: veri zaten dışarı çıkmıyordur.
   */
  requireExternalConsent?: {
    /** Onay ekranında gösterilecek, NE gönderileceğini anlatan Türkçe cümle. */
    reason: string;
    /** Onay penceresinde gösterilecek metin (ham metin yerine özet verilebilir). */
    preview?: string;
  };
  schema: TSchema;
  /** output-guard'ın kaynaksız bulgu eleyeceği dizi yolları. */
  findingPaths?: readonly string[];
  /**
   * Bir bulgunun "kaynaklı" sayılması için dolu olması gereken alanlar.
   * Verilmezse guard'ın sabit listesi (`DEFAULT_SOURCE_FIELDS`) kullanılır.
   * Şemasında farklı adlı bir kaynak alanı olan çağıranlar (ör. strateji
   * düğümlerindeki `sourceRef`) bunu genişletmek ZORUNDADIR; aksi hâlde
   * kaynağını gösteren bulgular "kaynaksız" sayılıp elenir.
   */
  sourceFields?: readonly string[];
  maxTokens?: number;
  /** Denetim kaydı için etkilenen varlık. */
  entity?: string;
  entityId?: string;
}

export interface AiRunResult<T> {
  data: T;
  model: string;
  providerType: string;
  piiMasked: boolean;
  usage: { inputTokens?: number; outputTokens?: number; durationMs: number };
  /** Çıktı metninden çıkarılan atıflar — teyit hattının girdisi. */
  citations: ExtractedCitation[];
  /** Kaynak göstermediği için elenen bulgular. */
  droppedFindings: DroppedFinding[];
  advisory: { isAdvisory: true; notice: string };
}

function safeJsonParse<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

@Injectable()
export class AiRunnerService {
  private readonly logger = new Logger(AiRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly agentRuns: AgentRunService,
    // D1.3: platform AI sağlayıcı yedeği + BYO plan yetkisi.
    private readonly platformAi: PlatformAiService,
  ) {}

  /**
   * KVKK kapısı — dış sağlayıcıya maskesiz kişisel veri çıkmasını engeller.
   *
   * Dönen `texts` her zaman gönderilebilir hâldedir: dış hedefte PII varsa
   * maskelenmiş, büro-içi hedefte olduğu gibi.
   *
   * DIŞSALLIK ADRESE BAKARAK belirlenir: `CUSTOM`/`OLLAMA` tipleri de kiracının
   * serbestçe girdiği bir `baseUrl` taşır ve bulut adresine bakıyor olabilir.
   */
  applyPiiGate(
    providerType: string,
    texts: readonly string[],
    piiApproved: boolean | undefined,
    baseUrl?: string | null,
  ): { texts: string[]; piiMasked: boolean; findings: PiiFinding[] } {
    const external = isExternalDestination(providerType, baseUrl);
    const scans = texts.map((t) => scanPii(t));
    const findings = scans.flatMap((s) => s.findings);

    if (!external) {
      // Veri büro dışına çıkmıyor; maskeleme zorunlu değil (docs/04).
      return { texts: [...texts], piiMasked: false, findings: [] };
    }
    if (findings.length === 0) {
      return { texts: [...texts], piiMasked: false, findings: [] };
    }
    if (!piiApproved) {
      throw new ConflictException({
        requiresPiiApproval: true,
        // Ham TCKN/IBAN DEĞERİ gövdede dönmez; tür + kısmi maske + adet.
        findings: summarizeFindings(findings),
        // Yalnızca kişisel veri TAŞIYAN parçalar gösterilir; şablon/bağlam
        // metinlerinin tamamı onaya konmaz.
        maskedText: scans
          .filter((s) => s.hasPii)
          .map((s) => s.maskedText)
          .join("\n---\n"),
        message:
          "Gönderilecek metinde kişisel veri tespit edildi. Dış AI sağlayıcısına göndermeden " +
          "önce maskeli metni inceleyip onaylayın (piiApproved: true).",
      });
    }
    return { texts: scans.map((s) => s.maskedText), piiMasked: true, findings };
  }

  /**
   * KALIPSIZ KVKK KAPISI — "bu metinde kişisel veri VAR, kalıbı olmasa da".
   *
   * `applyPiiGate` biçim tanır: TCKN, IBAN, telefon, e-posta. Ad-soyad ve şirket
   * unvanı hiçbir biçime uymaz (docs/04 §Faz 2'de söz verilen ad-soyad NER'i
   * henüz yok). Payload'ı baştan sona addan ibaret olan bir modül için "kalıp
   * bulunamadı → serbestçe gönder" yanlış cevaptır: KVKK m.3 anlamında ad da
   * kişisel veridir ve avukatın onayı alınmadan dışarı çıkamaz.
   *
   * Yerel/büro-içi hedefte veri dışarı çıkmadığı için kapı çalışmaz.
   */
  assertExternalConsent(
    providerType: string,
    baseUrl: string | null | undefined,
    piiApproved: boolean | undefined,
    consent: { reason: string; preview?: string },
  ): void {
    if (!isExternalDestination(providerType, baseUrl)) return;
    if (piiApproved) return;
    throw new ConflictException({
      requiresPiiApproval: true,
      /** Kalıp taraması değil, İÇERİK TÜRÜ kararı — arayüz ayrımı görebilsin. */
      reasonCode: "DIS_SAGLAYICI_KISISEL_VERI",
      findings: [],
      maskedText: consent.preview ?? null,
      message: consent.reason,
    });
  }

  /**
   * Görev tipi için rota; yoksa tenant'ın ilk aktif sağlayıcısı + defaultModel.
   *
   * TENANT POLİTİKASI: `aiPolicy = SADECE_YEREL` ise dış adresli hiçbir rota
   * seçilemez — yanlışlıkla eklenmiş bir bulut sağlayıcısı sessiz yedek olamaz.
   *
   * D1.3 — PLATFORM AI: BYO izni yoksa kiracı sağlayıcıları yok sayılır; kiracı
   * sağlayıcısı yoksa platform yedeği devreye girer.
   */
  async resolveRoute(
    tenantId: string,
    taskType: AiTaskType,
  ): Promise<{ config: AiProviderConfig; model: string }> {
    if (await this.platformAi.byoRestricted(tenantId)) {
      const platform = await this.platformAi.resolveForTenant(tenantId);
      if (platform) {
        await assertAiPolicyAllows(this.prisma, tenantId, platform);
        return { config: platform, model: platform.defaultModel };
      }
      throw new BadRequestException(
        "Planınız kendi AI sağlayıcınızı tanımlamayı kapsamıyor ve NomosOS platform " +
          "sağlayıcısı henüz atanmamış. Destek ile görüşün.",
      );
    }

    const route = await this.prisma.client.aiTaskRoute.findUnique({
      where: { tenantId_taskType: { tenantId, taskType } },
      include: { providerConfig: true },
    });
    if (route && route.providerConfig.isActive) {
      await assertAiPolicyAllows(this.prisma, tenantId, route.providerConfig);
      return { config: route.providerConfig, model: route.model };
    }
    const fallback = await this.prisma.client.aiProviderConfig.findFirst({
      where: { tenantId, isActive: true },
      orderBy: { createdAt: "asc" },
    });
    if (fallback) {
      await assertAiPolicyAllows(this.prisma, tenantId, fallback);
      return { config: fallback, model: fallback.defaultModel };
    }
    // Kiracı sağlayıcısı yok — platform yedeği (D1.3).
    const platform = await this.platformAi.resolveForTenant(tenantId);
    if (platform) {
      await assertAiPolicyAllows(this.prisma, tenantId, platform);
      return { config: platform, model: platform.defaultModel };
    }
    throw new BadRequestException(
      "Bu işlem için bir AI sağlayıcısı gerekiyor. Önce Ayarlar → AI Sağlayıcı ekranından " +
        "bir sağlayıcı tanımlayın.",
    );
  }

  async run<TSchema extends ZodTypeAny>(
    input: AiRunInput<TSchema>,
  ): Promise<AiRunResult<TypeOf<TSchema>>> {
    const { config, model } = await this.resolveRoute(input.user.tenantId, input.taskType);

    // KOŞULSUZ ONAY KAPISI — kalıp tabanlı taramadan ÖNCE çalışır.
    // Gövdesi tamamen ad/unvan olan çağrılar `scanPii` süzgecinden temiz geçer;
    // bu kapı olmasa müvekkil adları dış sağlayıcıya onaysız çıkardı.
    if (input.requireExternalConsent && !input.preScanned) {
      this.assertExternalConsent(
        config.type,
        config.baseUrl,
        input.piiApproved,
        input.requireExternalConsent,
      );
    }

    const gate = input.preScanned
      ? { texts: [...input.outboundTexts], piiMasked: input.preScanned.piiMasked, findings: [] }
      : this.applyPiiGate(config.type, input.outboundTexts, input.piiApproved, config.baseUrl);
    const messages = input.buildMessages(gate.texts);

    /**
     * NİHAİ MESAJ DOĞRULAMA TARAMASI (denetim bulgusu Ö-23).
     *
     * `preScanned` "ben zaten taradım" der — ama TARANAN ŞEY `outboundTexts`tir,
     * PROMPTA GİDEN ŞEY DEĞİL. `buildMessages` bir KAPANIŞTIR (closure) ve
     * `outboundTexts` dışından istediği metni ekleyebilir. Okunan tek `preScanned`
     * yolunda bile delik vardı:
     *
     *   outboundTexts: [ctx.contextText, noteGate.texts[0]],
     *   preScanned:    { piiMasked: … },              // ← runner kapısı ATLANIR
     *   buildMessages: ([contextText, styleNote]) => buildPetitionDraftMessages({
     *     sectionSkeleton:    skeleton.map((s) => s.key),   // ← outboundTexts DIŞINDA
     *     approvedPrecedents: ctx.precedents,               // ← outboundTexts DIŞINDA
     *     caseContextText:    contextText,
     *   })
     *
     * Bugün o iki alanda PII bulunma ihtimali düşüktür; tehlike SÖZLEŞMENİN
     * ŞEKLİNDEDİR. Yarın `skeleton`a taraf adı eklenirse hiçbir kapı devreye
     * girmez ve `AiUsageLog.piiMasked` yine doğru sanılırdı.
     *
     * Bu tarama MASKELEMEZ — maskeleme çağıranın sözleşmesidir. Yalnız DOĞRULAR:
     * dış sağlayıcıya gidecek nihai metinde kalıp tabanlı bir kişisel veri
     * kalmışsa çağrı YAPILMAZ ve hata fırlatılır. Sözleşme ihlali sessiz kalmaz.
     */
    if (input.preScanned && isExternalDestination(config.type, config.baseUrl)) {
      const residual = messages.flatMap((m) => scanPii(m.content).findings);
      if (residual.length > 0) {
        this.logger.error(
          `preScanned sözleşmesi ihlal edildi (${input.taskType}): nihai mesajlarda ` +
            `${residual.length} maskelenmemiş kişisel veri bulundu.`,
        );
        throw new ServiceUnavailableException({
          message:
            "Dış sağlayıcıya gönderilecek metinde maskelenmemiş kişisel veri tespit edildiği için " +
            "çağrı YAPILMADI (fail-closed KVKK kuralı). Bu bir yazılım hatasıdır; " +
            "sistem yöneticinizle görüşün.",
          findings: summarizeFindings(residual),
        });
      }
    }

    const startedAt = Date.now();
    let result;
    try {
      const provider = createProvider(this.resolveConfig(config));
      result = await provider.chat({ model, messages, maxTokens: input.maxTokens ?? 3072 });
    } catch (err) {
      // F2 · E1: sağlayıcı arızası da iz bırakır — "neden koşmadı" sorusunun
      // cevabı bu satırdadır. İz yazımı asla ana akışı bozmaz.
      await this.agentRuns.record({
        tenantId: input.user.tenantId,
        userId: input.user.userId,
        taskType: input.taskType,
        status: "BASARISIZ",
        model,
        providerType: config.type,
        durationMs: Date.now() - startedAt,
        piiMasked: gate.piiMasked,
        entity: input.entity,
        entityId: input.entityId,
        outboundTexts: gate.texts,
        errorMessage: (err as Error).message,
      });
      // Ham sağlayıcı gövdesi vekil adresi / iç hata izi / kısmi anahtar ipucu
      // taşıyabilir; istemciye korelasyon kimlikli sabit mesaj döner.
      throw providerUnreachable(this.logger, err);
    }
    const durationMs = Date.now() - startedAt;

    const usageLog = await this.prisma.client.aiUsageLog.create({
      data: {
        tenantId: input.user.tenantId,
        userId: input.user.userId,
        ...usageProviderRef(config),
        taskType: input.taskType,
        model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        durationMs,
        piiMasked: gate.piiMasked,
      },
    });

    await this.audit.log({
      tenantId: input.user.tenantId,
      userId: input.user.userId,
      action: `AI_${input.taskType}`,
      entity: input.entity,
      entityId: input.entityId,
      detail: `model=${model} piiMasked=${gate.piiMasked}`,
    });

    const guarded = guardOutput(input.schema, result.content, {
      findingPaths: input.findingPaths ?? [],
      // Kaynak sayılan alanlar çağıranın şemasına göre genişletilebilir; guard'ın
      // sabit listesi bilinmeyen bir kaynak alanını "kaynaksız" sayıp bulguyu
      // eler (bkz. AiRunInput.sourceFields).
      ...(input.sourceFields ? { sourceFields: input.sourceFields } : {}),
    });

    if (!guarded.ok || guarded.data === undefined) {
      const detail = guarded.issues
        .map((i) => (i.path ? `${i.path}: ${i.message}` : i.message))
        .join(" · ");
      // F2 · E1: guard'ın ELEDİĞİ çıktı ayrı durumdur — sağlayıcı arızası
      // değil, modelin şemaya uymayan yanıt vermesidir. "Neden yarım kaldı"
      // sorusunun cevabı bu ayrımdadır.
      await this.agentRuns.record({
        tenantId: input.user.tenantId,
        userId: input.user.userId,
        taskType: input.taskType,
        status: "REDDEDILDI",
        model,
        providerType: config.type,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        durationMs,
        piiMasked: gate.piiMasked,
        entity: input.entity,
        entityId: input.entityId,
        outboundTexts: gate.texts,
        rejectionDetail: detail,
      });
      // KREDİ YAZILMADAN fırlar: `record()` aşağıdadır. Çıktısı kullanılmayan
      // çağrıdan kredi alınmaz (iş kuralı 4); `AiUsageLog` satırı ise yukarıda
      // yazılmıştır — çağrı gerçekten yapıldı, iç maliyet muhasebesi görmeli.
      throw new BadGatewayException(
        `AI çıktısı beklenen biçimde değil, sonuç kullanılmadı. Ayrıntı: ${detail || "bilinmiyor"}`,
      );
    }

    // F2 · E1: başarılı koşunun izi — ajan kim, hangi girdiyle, ne kadar sürdü.
    await this.agentRuns.record({
      tenantId: input.user.tenantId,
      userId: input.user.userId,
      taskType: input.taskType,
      status: "BASARILI",
      model,
      providerType: config.type,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      durationMs,
      piiMasked: gate.piiMasked,
      entity: input.entity,
      entityId: input.entityId,
      outboundTexts: gate.texts,
    });

    // MODÜL 26 KANCASI — gerçek token'ı kredi kapısına bildirir.
    // Bağlam yoksa (ücretsiz görev, BYO-LLM tenant'ı, pipeline) hiçbir şey
    // yapmaz. ÇIKTI DOĞRULAMASINDAN SONRA çağrılır: sağlayıcıya gidilmiş
    // olması ücretlendirme için yetmez, sonucun KULLANILABİLİR olması gerekir.
    creditRunContext.record({
      aiUsageLogId: usageLog.id,
      taskType: input.taskType,
      model,
      providerType: config.type,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    });

    return {
      data: guarded.data,
      model,
      providerType: config.type,
      piiMasked: gate.piiMasked,
      usage: {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        durationMs,
      },
      citations: guarded.citations,
      droppedFindings: guarded.droppedFindings,
      advisory: guarded.advisory,
    };
  }

  /** DB kaydını @nomosos/ai için çözülmüş yapılandırmaya çevirir (anahtar şifresi açılır). */
  private resolveConfig(config: AiProviderConfig): ResolvedProviderConfig {
    return {
      type: config.type as AiProviderType,
      apiKey: config.encryptedApiKey ? decryptSecret(config.encryptedApiKey) : undefined,
      baseUrl: config.baseUrl ?? undefined,
      defaultModel: config.defaultModel,
      headers: readProviderHeaders(config.headersJson),
      mapping: safeJsonParse<CustomMapping>(config.mappingJson),
    };
  }
}
