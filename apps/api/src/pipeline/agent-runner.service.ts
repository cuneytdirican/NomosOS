import { Injectable, Logger } from "@nestjs/common";
import type { AiProviderConfig } from "@nomosos/db";
import {
  createProvider,
  decryptSecret,
  isExternalDestination,
  scanPii,
  type CustomMapping,
  type LlmMessage,
  type ResolvedProviderConfig,
} from "@nomosos/ai";
import type { AiProviderType } from "@nomosos/shared";
import {
  getAgent,
  guardOutput,
  type AgentContext,
  type AgentKey,
  type DroppedFinding,
  type GuardIssue,
} from "@nomosos/legal-ai";
import { PrismaService } from "../prisma/prisma.service";
import { assertAiPolicyAllows, tenantAiPolicy } from "../common/ai-policy";
import { sanitizeExternalError } from "../common/errors";
import { readProviderHeaders } from "../common/provider-headers";

/**
 * Belge hattının AI koşucusu.
 *
 * SORUMLULUKLARI (sırayla):
 *   1. Görev tipine göre BYO-LLM rotasını çöz (tenant'ın kendi sağlayıcısı).
 *   2. KVKK: dış hedefe (adres tabanlı tespit) gidecek TÜM kullanıcı mesajlarını
 *      scanPii'den geçir ve MASKELE. Belge hattı otomatik koştuğu için burada
 *      409 (requiresPiiApproval) DÖNEMEZ — onay bekleyecek bir insan yoktur;
 *      bu yüzden rıza TENANT DÜZEYİNDE ve BİR KEZ alınır
 *      (`Tenant.autoMaskConsent`). Rıza yoksa adım hiç çalıştırılmaz, belge
 *      triyaja düşer ve avukat `POST /documents/:id/reprocess` ile elle işler
 *      (docs/04-kvkk-veri-guvenligi.md, kabul kriteri 1).
 *   2b. TENANT POLİTİKASI: `aiPolicy = SADECE_YEREL` ise dış adresli rota
 *      seçilemez; adım ATLANDI olarak işaretlenir.
 *   3. Ajanın kendi promptu ve şemasıyla koş (ham prompt YAZILMAZ; kaynak
 *      packages/legal-ai/agents/registry.ts).
 *   4. output-guard: kaynaksız bulguları ele, şemayı doğrula, atıfları çıkar.
 *
 * HİÇBİR KOŞULDA FIRLATMAZ: hat bir adımın düşmesiyle durmamalıdır. Hata,
 * Türkçe mesajla `ok:false` olarak döner.
 */

export interface AgentRunResult<T> {
  ok: boolean;
  data?: T;
  /** Türkçe hata mesajı (ok=false ise dolu). */
  error?: string;
  model?: string;
  piiMasked: boolean;
  /** Dış sağlayıcı kullanıldı mı (KVKK izi). */
  externalProvider: boolean;
  /**
   * Adım hiç çalıştırılmadı mı? (Örn. dış sağlayıcı + otomatik maskeleme rızası
   * yok.) Çağıran bunu `BASARISIZ` değil `ATLANDI` olarak işaretler.
   */
  skipped?: boolean;
  droppedFindings: DroppedFinding[];
  issues: GuardIssue[];
  durationMs: number;
}

/**
 * KVKK maskelemesi — DIŞA GİDEN MESAJIN TAMAMINA uygulanır.
 *
 * ESKİ DESEN (kaldırıldı): `AgentContext`in yalnızca üç alanı (`documentText`,
 * `documentTitle`, `caseContext.text`) maskeleniyordu. Oysa sözleşme
 * `instruction`, `partyIndexLines` (taraf adları), `clientLabel`,
 * `approvedPrecedents`, `simulationFindings`, `hearing.courtName` gibi alanlar
 * da taşır ve hepsi ilgili ajanın promptuna girer. Alan alan beyaz liste, yeni
 * alan eklendikçe sessizce bozulan bir desendir: ENFORCEMENT_COPILOT veya
 * CONFLICT_CHECK bu servise bağlandığı an sessiz bir KVKK sızıntısı doğardı.
 *
 * Yeni desen (AssistantLlmService.applyPiiGate ile aynı): mesajlar kurulduktan
 * SONRA `role === "user"` içerikleri taranır. Sistem promptu ve few-shot
 * örnekleri bilinçli olarak dışarıda bırakılır (kişisel veri içermezler ve
 * taranmaları örnekleri bozardı).
 */
function maskOutboundMessages(
  messages: readonly LlmMessage[],
  external: boolean,
): { messages: LlmMessage[]; piiMasked: boolean } {
  if (!external) return { messages: [...messages], piiMasked: false };

  let masked = false;
  const next = messages.map((m) => {
    if (m.role !== "user") return m;
    const scan = scanPii(m.content);
    if (!scan.hasPii) return m;
    masked = true;
    return { role: m.role, content: scan.maskedText };
  });
  return { messages: next, piiMasked: masked };
}

@Injectable()
export class AgentRunnerService {
  private readonly logger = new Logger(AgentRunnerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async run<T>(params: {
    agentKey: AgentKey;
    tenantId: string;
    userId?: string;
    context: AgentContext;
  }): Promise<AgentRunResult<T>> {
    const agent = getAgent(params.agentKey);

    let route: { config: AiProviderConfig; model: string };
    try {
      route = await this.resolveRoute(params.tenantId, agent.taskType);
    } catch (err) {
      // AYRIM ÖNEMLİ:
      //  - POLİTİKA İHLALİ (SADECE_YEREL) bilinçli bir ATLAMA'dır → skipped.
      //  - "Sağlayıcı tanımlı değil" GERÇEK BİR BAŞARISIZLIKTIR; ATLANDI
      //    işaretlemek koşumu yanlışlıkla "TAMAM" gösterir ve sınıflandırmanın
      //    hiç koşmadığını gizlerdi.
      // Politika istisnası gövdesinde `aiPolicyViolation: true` taşır.
      return { ...fail(messageOf(err)), skipped: isPolicyViolation(err) };
    }

    // Dışsallık TİPE değil ADRESE bakar (CUSTOM/OLLAMA bulut adresine bakabilir).
    const external = isExternalDestination(route.config.type, route.config.baseUrl);

    // KAYITLI RIZA KAPISI (docs/04, kabul kriteri 1): otomatik hatta onay
    // bekleyecek bir insan olmadığı için 409 dönülemez; bu yüzden dış
    // sağlayıcıya gönderim tenant düzeyinde BİR KEZ açıkça onaylanmış olmalıdır.
    // Rıza yoksa adım hiç çalıştırılmaz ve belge triyaja düşer.
    if (external) {
      const { autoMaskConsent } = await tenantAiPolicy(this.prisma, params.tenantId);
      if (!autoMaskConsent) {
        return {
          ...fail(
            "Otomatik belge hattı DIŞ bir AI sağlayıcısına veri gönderecekti; büronuzun " +
              "kayıtlı 'otomatik maskeleme rızası' yok. Belge triyaj kuyruğuna alındı. " +
              "Ayarlar → AI Sağlayıcı ekranından rızayı verin ya da bu belgeyi " +
              "POST /documents/:id/reprocess ile elle işleyin.",
            { externalProvider: true },
          ),
          skipped: true,
        };
      }
    }

    let messages: LlmMessage[];
    try {
      messages = agent.buildMessages(params.context);
    } catch (err) {
      return fail(`${agent.name} girdisi eksik: ${(err as Error).message}`, {
        externalProvider: external,
      });
    }

    const outbound = maskOutboundMessages(messages, external);
    const piiMasked = outbound.piiMasked;

    const startedAt = Date.now();
    let raw: string;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    try {
      const provider = createProvider(resolveConfig(route.config));
      const result = await provider.chat({
        model: route.model,
        messages: outbound.messages,
        maxTokens: 2048,
      });
      raw = result.content;
      inputTokens = result.inputTokens;
      outputTokens = result.outputTokens;
    } catch (err) {
      // Ham sağlayıcı gövdesi PipelineRun.errorMessage'a yazılıp her role
      // gösteriliyordu; artık yalnızca korelasyon kimliği görünür.
      const safe = sanitizeExternalError(
        this.logger,
        "AI sağlayıcısına ulaşılamadı",
        err,
        "Ayarlar → AI Sağlayıcı ekranından bağlantıyı test edin.",
      );
      return fail(safe.message, {
        piiMasked,
        externalProvider: external,
        model: route.model,
        durationMs: Date.now() - startedAt,
      });
    }
    const durationMs = Date.now() - startedAt;

    await this.logUsage({
      tenantId: params.tenantId,
      userId: params.userId,
      providerConfigId: route.config.id,
      taskType: agent.taskType,
      model: route.model,
      inputTokens,
      outputTokens,
      durationMs,
      piiMasked,
    });

    const guarded = guardOutput(agent.outputSchema, raw, {
      findingPaths: agent.findingPaths,
    });

    if (!guarded.ok) {
      const detail = guarded.issues.map((i) => `${i.path ? `${i.path}: ` : ""}${i.message}`).join(" | ");
      return {
        ok: false,
        error: `${agent.name} çıktısı doğrulanamadı — ${detail || "bilinmeyen şema hatası"}`,
        model: route.model,
        piiMasked,
        externalProvider: external,
        droppedFindings: guarded.droppedFindings,
        issues: guarded.issues,
        durationMs,
      };
    }

    return {
      ok: true,
      data: guarded.data as T,
      model: route.model,
      piiMasked,
      externalProvider: external,
      droppedFindings: guarded.droppedFindings,
      issues: guarded.issues,
      durationMs,
    };
  }

  /**
   * Görev tipi → sağlayıcı rotası. Rota yoksa tenant'ın ilk aktif sağlayıcısı.
   * (AiService'teki çözümle aynı sözleşme; belge hattı ai modülüne bağımlı olmasın
   * diye burada tekrarlanır.)
   */
  private async resolveRoute(
    tenantId: string,
    taskType: string
  ): Promise<{ config: AiProviderConfig; model: string }> {
    const route = await this.prisma.client.aiTaskRoute.findUnique({
      where: { tenantId_taskType: { tenantId, taskType } },
      include: { providerConfig: true },
    });
    if (route && route.providerConfig.isActive) {
      // SADECE_YEREL politikasında dış adresli rota kabul edilmez (fırlatır;
      // çağıran fail() ile Türkçe mesaja çevirir).
      await assertAiPolicyAllows(this.prisma, tenantId, route.providerConfig);
      return { config: route.providerConfig, model: route.model };
    }

    const fallback = await this.prisma.client.aiProviderConfig.findFirst({
      where: { tenantId, isActive: true },
      orderBy: { createdAt: "asc" },
    });
    if (!fallback) {
      throw new Error(
        "Büronuz için tanımlı bir AI sağlayıcısı yok. Ayarlar → AI Sağlayıcı ekranından " +
          "sağlayıcı ekledikten sonra bu belgeyi yeniden işleyebilirsiniz."
      );
    }
    await assertAiPolicyAllows(this.prisma, tenantId, fallback);
    return { config: fallback, model: fallback.defaultModel };
  }

  private async logUsage(entry: {
    tenantId: string;
    userId?: string;
    providerConfigId: string;
    taskType: string;
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    durationMs: number;
    piiMasked: boolean;
  }): Promise<void> {
    try {
      await this.prisma.client.aiUsageLog.create({ data: entry });
    } catch (err) {
      this.logger.warn(`AI kullanım kaydı yazılamadı: ${(err as Error).message}`);
    }
  }
}

function fail(
  error: string,
  extra: Partial<AgentRunResult<never>> = {}
): AgentRunResult<never> {
  return {
    ok: false,
    error,
    piiMasked: false,
    externalProvider: false,
    droppedFindings: [],
    issues: [],
    durationMs: 0,
    ...extra,
  };
}

/** Hata, tenant AI politikası ihlali mi? (bilinçli atlama ↔ gerçek başarısızlık) */
function isPolicyViolation(err: unknown): boolean {
  const response = (err as { response?: unknown })?.response;
  return Boolean(
    response &&
      typeof response === "object" &&
      (response as { aiPolicyViolation?: unknown }).aiPolicyViolation === true,
  );
}

/** HttpException gövdesindeki Türkçe mesajı çıkarır; yoksa `.message`. */
function messageOf(err: unknown): string {
  const response = (err as { response?: unknown })?.response;
  if (response && typeof response === "object" && "message" in response) {
    const value = (response as { message: unknown }).message;
    if (typeof value === "string") return value;
  }
  return (err as Error)?.message ?? "Bilinmeyen hata";
}

function safeJsonParse<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function resolveConfig(config: AiProviderConfig): ResolvedProviderConfig {
  return {
    type: config.type as AiProviderType,
    apiKey: config.encryptedApiKey ? decryptSecret(config.encryptedApiKey) : undefined,
    baseUrl: config.baseUrl ?? undefined,
    defaultModel: config.defaultModel,
    headers: readProviderHeaders(config.headersJson),
    mapping: safeJsonParse<CustomMapping>(config.mappingJson),
  };
}
