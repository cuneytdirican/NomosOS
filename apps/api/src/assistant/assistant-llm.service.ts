import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { AiProviderConfig } from "@nomosos/db";
import {
  createProvider,
  decryptSecret,
  embedTexts,
  isExternalDestination,
  scanPii,
  summarizeFindings,
  supportsEmbeddings,
  DEFAULT_EMBEDDING_MODELS,
  EMBEDDING_UNSUPPORTED_MESSAGE,
  type CustomMapping,
  type EmbeddingProviderType,
  type LlmMessage,
  type ResolvedProviderConfig,
} from "@nomosos/ai";
import type { AiProviderType } from "@nomosos/shared";
import { guardOutput, type DroppedFinding, type ExtractedCitation } from "@nomosos/legal-ai";
import type { TypeOf, ZodTypeAny } from "zod";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AgentRunService } from "../agents/agent-run.service";
import { assertAiPolicyAllows } from "../common/ai-policy";
import { creditRunContext } from "../credits/credit-context";
import { providerUnreachable } from "../common/errors";
import type { AuthUser } from "../common/types";
import { readProviderHeaders } from "../common/provider-headers";

function safeJsonParse<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

export interface RunTaskOptions<TSchema extends ZodTypeAny> {
  user: AuthUser;
  /**
   * AiTaskRoute araması için aday anahtarlar (ilk eşleşen kazanır).
   * Örn. büro sorgusu için ["OFFICE_QUERY", "DAILY_PRIORITIZE"].
   */
  routeKeys: readonly string[];
  /** AiUsageLog.taskType değeri (maliyet raporlaması bu anahtarla gruplanır). */
  logTaskType: string;
  messages: LlmMessage[];
  schema: TSchema;
  /** output-guard'ın kaynaksız bulguyu eleyeceği dizi yolları. */
  findingPaths?: readonly string[];
  piiApproved?: boolean;
  maxTokens?: number;
  auditDetail?: string;
  /** case-context veri minimizasyonu politikasının dışına çıkılan bölümler (KVKK izi). */
  policyOverrides?: readonly string[];
}

export interface RunTaskResult<T> {
  data: T;
  model: string;
  providerType: string;
  usageLogId: string;
  piiMasked: boolean;
  /** Metinden çıkarılan atıflar — caselaw modülünün teyit ucuna gönderilebilir. */
  citations: ExtractedCitation[];
  /** "AI çıktısıdır, öneridir" bayrağı. */
  advisory: { isAdvisory: true; notice: string };
  droppedFindings: DroppedFinding[];
  usage: { inputTokens?: number; outputTokens?: number; durationMs: number };
}

export interface ResolvedEmbedding {
  config: ResolvedProviderConfig;
  providerConfigId: string;
  model: string;
  providerType: EmbeddingProviderType;
}

/**
 * Asistan modülünün LLM koşu yöneticisi.
 *
 * Tek yerde toplanan sorumluluklar:
 *   1. Görev tipi → sağlayıcı + model çözümü (BYO-LLM, AiTaskRoute).
 *   2. KVKK KAPISI — LLM'e giden HER metin `scanPii`'den geçer; dış sağlayıcı +
 *      PII + onay yoksa HTTP 409 `{ requiresPiiApproval, findings, maskedText }`.
 *      Maskeleme hattı hata verirse HİÇBİR çağrı yapılmaz (fail-closed, 503).
 *   3. ÇIKTI KAPISI — `guardOutput` ile şema doğrulaması, kaynaksız bulgu elemesi,
 *      atıf çıkarımı ve "öneridir" bayrağı.
 *   4. AiUsageLog + AuditLog yazımı.
 */
@Injectable()
export class AssistantLlmService {
  private readonly logger = new Logger(AssistantLlmService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly agentRuns: AgentRunService,
  ) {}

  /** DB kaydını @nomosos/ai için çözülmüş yapılandırmaya çevirir. */
  resolveConfig(config: AiProviderConfig): ResolvedProviderConfig {
    return {
      type: config.type as AiProviderType,
      apiKey: config.encryptedApiKey ? decryptSecret(config.encryptedApiKey) : undefined,
      baseUrl: config.baseUrl ?? undefined,
      defaultModel: config.defaultModel,
      headers: readProviderHeaders(config.headersJson),
      mapping: safeJsonParse<CustomMapping>(config.mappingJson),
    };
  }

  /** Aday görev anahtarlarından ilk eşleşen rota; yoksa tenant'ın ilk aktif sağlayıcısı. */
  async resolveRoute(
    tenantId: string,
    routeKeys: readonly string[],
  ): Promise<{ config: AiProviderConfig; model: string }> {
    for (const key of routeKeys) {
      const route = await this.prisma.client.aiTaskRoute.findUnique({
        where: { tenantId_taskType: { tenantId, taskType: key } },
        include: { providerConfig: true },
      });
      if (route && route.providerConfig.isActive) {
        // Tenant politikası SADECE_YEREL ise dış adresli rota reddedilir (422).
        await assertAiPolicyAllows(this.prisma, tenantId, route.providerConfig);
        return { config: route.providerConfig, model: route.model };
      }
    }

    const fallback = await this.prisma.client.aiProviderConfig.findFirst({
      where: { tenantId, isActive: true },
      orderBy: { createdAt: "asc" },
    });
    if (!fallback) {
      throw new BadRequestException(
        "AI sağlayıcı tanımlı değil. Önce Ayarlar → AI Sağlayıcı ekranından bir sağlayıcı ekleyin.",
      );
    }
    await assertAiPolicyAllows(this.prisma, tenantId, fallback);
    return { config: fallback, model: fallback.defaultModel };
  }

  /**
   * Gömme sağlayıcısı çözümü.
   *
   * Yerel çalışan OLLAMA tercih edilir (veri büro dışına çıkmaz). Hiçbir uygun
   * sağlayıcı yoksa `null` döner ve çağıran ANAHTAR KELİME yedeğine düşer —
   * bu durum kullanıcıya bildirilir, sessizce yutulmaz.
   */
  async resolveEmbedding(tenantId: string): Promise<ResolvedEmbedding | null> {
    const configs = await this.prisma.client.aiProviderConfig.findMany({
      where: { tenantId, isActive: true, type: { in: ["OLLAMA", "OPENAI_COMPAT"] } },
      orderBy: { createdAt: "asc" },
    });
    // Yerel sağlayıcı önce.
    const picked =
      configs.find((c) => c.type === "OLLAMA") ??
      configs.find((c) => c.type === "OPENAI_COMPAT") ??
      null;
    if (!picked || !supportsEmbeddings(picked.type)) return null;
    // SADECE_YEREL politikasında dış gömme sağlayıcısı kullanılamaz; gömme
    // yerine anahtar kelime yedeğine düşülür (çağıran bunu kullanıcıya bildirir).
    await assertAiPolicyAllows(this.prisma, tenantId, picked);

    const providerType = picked.type as EmbeddingProviderType;
    const model =
      process.env[`AI_EMBEDDING_MODEL_${providerType}`]?.trim() ||
      process.env.AI_EMBEDDING_MODEL?.trim() ||
      DEFAULT_EMBEDDING_MODELS[providerType];

    return {
      config: this.resolveConfig(picked),
      providerConfigId: picked.id,
      model,
      providerType,
    };
  }

  /**
   * Gömme üretimi. Çağıran metinleri MASKELİ göndermelidir (DocumentChunk.content
   * zaten maskelidir; soru metni de maskelenerek gönderilir).
   *
   * KULLANIM KAYDI (AI-AUDIT A1): gömme çağrıları burada AiUsageLog'a yazılır —
   * tek boğum noktası; indeksleme (indexing.service) ve soru gömmesi (retrieval)
   * aynı kayıttan geçer. Sağlayıcı token bildirmezse (OLLAMA) satır YİNE yazılır;
   * token alanları boş kalır, çağrının OLDUĞU görünür olur.
   */
  async embed(
    resolved: ResolvedEmbedding,
    texts: string[],
    ctx?: { tenantId: string; userId?: string },
  ): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (!supportsEmbeddings(resolved.config.type)) {
      throw new UnprocessableEntityException(EMBEDDING_UNSUPPORTED_MESSAGE);
    }
    const result = await embedTexts(resolved.config, texts, resolved.model);
    if (ctx) {
      await this.prisma.client.aiUsageLog
        .create({
          data: {
            tenantId: ctx.tenantId,
            userId: ctx.userId ?? null,
            providerConfigId: resolved.providerConfigId,
            taskType: "EMBEDDING",
            model: resolved.model,
            inputTokens: result.inputTokens,
            outputTokens: 0,
            durationMs: 0,
            // Gömmeye giden metin ÇAĞIRAN SÖZLEŞMESİ gereği maskelidir.
            piiMasked: true,
          },
        })
        .catch((err: unknown) => {
          // Kullanım kaydı ana akışı bozmaz (agent-run deseni).
          this.logger.warn(`Gömme kullanım kaydı yazılamadı: ${(err as Error).message}`);
        });
    }
    return result.vectors;
  }

  /**
   * KVKK maskeleme hattı. Fail-closed: tarama hata verirse çağrı YAPILMAZ.
   * Dönen `messages` gönderime hazır (gerekiyorsa maskelenmiş) hâldedir.
   */
  private applyPiiGate(
    messages: LlmMessage[],
    providerType: string,
    piiApproved: boolean,
    baseUrl?: string | null,
  ): { messages: LlmMessage[]; piiMasked: boolean } {
    let scans;
    try {
      scans = messages.map((m) => scanPii(m.content));
    } catch (err) {
      this.logger.error(`KVKK maskeleme hattı çalışmadı: ${(err as Error).message}`);
      throw new ServiceUnavailableException(
        "KVKK maskeleme hattı çalışmadığı için AI çağrısı yapılmadı. " +
          "Sistem yöneticinizle görüşün (fail-closed güvenlik kuralı).",
      );
    }

    const findings = scans.flatMap((s) => s.findings);
    // Dışsallık TİPE değil ADRESE bakar (CUSTOM/OLLAMA bulut adresine bakabilir).
    const external = isExternalDestination(providerType, baseUrl);

    if (external && findings.length > 0 && !piiApproved) {
      // ONAY GÖVDESİNE YALNIZCA KİŞİSEL VERİ TAŞIYAN PARÇALAR KONUR.
      //
      // Eskiden tüm mesajlar birleştirilip döndürülüyordu: sistem promptu
      // (NOMOSOS_SYSTEM_CORE_PROMPT) ve few-shot örnekleri dışarı açılıyor,
      // gövde onlarca KB şişiyordu. Avukatın onaylayacağı şey zaten yalnızca
      // KENDİ verisinin maskeli hâlidir.
      const relevant = scans.filter((s) => s.hasPii).map((s) => s.maskedText);
      throw new ConflictException({
        requiresPiiApproval: true,
        findings: summarizeFindings(findings),
        maskedText: relevant.join("\n---\n"),
        message:
          "Gönderilecek metinde kişisel veri tespit edildi. Dış sağlayıcıya göndermeden önce " +
          "maskeli metni onaylayın (piiApproved: true).",
      });
    }

    const piiMasked = external && findings.length > 0;
    return {
      messages: piiMasked
        ? messages.map((m, i) => ({ role: m.role, content: scans[i].maskedText }))
        : messages,
      piiMasked,
    };
  }

  /** Tam koşu: KVKK kapısı → sağlayıcı çağrısı → output-guard → kullanım/denetim kaydı. */
  async runTask<TSchema extends ZodTypeAny>(
    options: RunTaskOptions<TSchema>,
  ): Promise<RunTaskResult<TypeOf<TSchema>>> {
    const { user, routeKeys, logTaskType, schema, findingPaths = [] } = options;
    const { config, model } = await this.resolveRoute(user.tenantId, routeKeys);

    const gated = this.applyPiiGate(
      options.messages,
      config.type,
      options.piiApproved ?? false,
      config.baseUrl,
    );

    const startedAt = Date.now();
    let result;
    try {
      const provider = createProvider(this.resolveConfig(config));
      result = await provider.chat({
        model,
        messages: gated.messages,
        maxTokens: options.maxTokens ?? 4096,
        temperature: 0.2,
      });
    } catch (err) {
      // F2 · E1: sağlayıcı arızası iz bırakır.
      await this.agentRuns.record({
        tenantId: user.tenantId,
        userId: user.userId,
        taskType: logTaskType,
        status: "BASARISIZ",
        model,
        providerType: config.type,
        durationMs: Date.now() - startedAt,
        piiMasked: gated.piiMasked,
        outboundTexts: options.messages.map((m) => m.content),
        errorMessage: (err as Error).message,
      });
      // Ham sağlayıcı gövdesi sızdırılmaz; korelasyon kimliği ile günlüğe yazılır.
      throw providerUnreachable(this.logger, err);
    }
    const durationMs = Date.now() - startedAt;

    const guarded = guardOutput(schema, result.content, { findingPaths });

    // F2 · E1: guard reddi ve başarılı koşu — iz durumu ayrım kuralı için
    // AiRunnerService ile aynı üç durum kümesini kullanır.
    await this.agentRuns.record({
      tenantId: user.tenantId,
      userId: user.userId,
      taskType: logTaskType,
      status: guarded.ok ? "BASARILI" : "REDDEDILDI",
      model,
      providerType: config.type,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      durationMs,
      piiMasked: gated.piiMasked,
      outboundTexts: options.messages.map((m) => m.content),
      rejectionDetail: guarded.ok
        ? undefined
        : guarded.issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join(" · "),
    });

    const usageLog = await this.prisma.client.aiUsageLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.userId,
        providerConfigId: config.id,
        taskType: logTaskType,
        model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        durationMs,
        piiMasked: gated.piiMasked,
      },
    });

    // MODÜL 26 KANCASI — gerçek token'ı kredi kapısına bildirir. Bağlam yoksa
    // (ücretsiz görev / BYO-LLM tenant'ı) hiçbir şey yapmaz.
    creditRunContext.record({
      aiUsageLogId: usageLog.id,
      taskType: logTaskType,
      model,
      providerType: config.type,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: `AI_${logTaskType}`,
      entity: "AiUsageLog",
      entityId: usageLog.id,
      detail: [
        `model=${model}`,
        `piiMasked=${gated.piiMasked}`,
        `kaynaksizElenen=${guarded.droppedFindings.length}`,
        options.policyOverrides?.length
          ? `politikaDisiBolumler=${options.policyOverrides.join(",")}`
          : undefined,
        options.auditDetail,
      ]
        .filter(Boolean)
        .join(" "),
    });

    if (!guarded.ok || guarded.data === undefined) {
      // İ-13: GUARD REDDİNDE KREDİ İADESİ. `record()` yukarıda çağrıldı; HTTP
      // istisnası interceptor'ün `settle()` yolundan geçmeyebilir ve kayıt
      // takılı kalırdı — avukat kullanılamayan çıktı için kredi öderdi. İş
      // kuralı 4: kullanılmayan sonuçtan kredi ALINMAZ. (AiUsageLog satırı
      // kasıtlı olarak kalır — çağrı gerçekten yapılmıştır, iç maliyet
      // muhasebesi görür.)
      creditRunContext.discard(usageLog.id);
      throw new UnprocessableEntityException({
        message:
          "AI yanıtı doğrulanamadı; çıktı beklenen biçimde değil. Lütfen tekrar deneyin " +
          "veya Ayarlar'dan daha güçlü bir model seçin.",
        issues: guarded.issues,
        droppedFindings: guarded.droppedFindings,
      });
    }

    return {
      data: guarded.data,
      model,
      providerType: config.type,
      usageLogId: usageLog.id,
      piiMasked: gated.piiMasked,
      citations: guarded.citations,
      advisory: guarded.advisory,
      droppedFindings: guarded.droppedFindings,
      usage: {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        durationMs,
      },
    };
  }
}
