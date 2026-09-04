/**
 * İçtihat & Mevzuat servisi (Modül 23).
 *
 * İki güvenlik ilkesi bu dosyanın tamamına hâkimdir:
 *
 *  (1) LLM KARAR BULMAZ. AI destekli aramada model yalnızca SORGUYU GENİŞLETİR
 *      (anahtar kelime + kavram). Dönen her sonuç, veritabanında gerçekten duran
 *      bir CaseLawDocument satırıdır; künyesi modelden değil kayıttan gelir.
 *
 *  (2) ÖZET KARAR ÜRETMEZ. CASELAW_SUMMARIZE yalnızca kendisine verilen karar
 *      metnini özetler; künye yazması yasaktır ve metinde olmayan bilgi için
 *      "kararda açık değil" der.
 *
 * Kiracı izolasyonu: CaseLawDocument havuzu ortaktır (içtihat kamusal veridir),
 * kiracıya ait olan tek şey CaseLawReference'tır ve her sorgusunda tenantId süzgeci vardır.
 */

import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { CaseLawDocument } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { assertRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";
import { CaseLawAdapterRegistry } from "./adapters/registry.service";
import { ManualEntryCaseLawAdapter } from "./adapters/manual-entry.adapter";
import { isDemoRecord, tenantVisibility, type CaseLawHit } from "./adapters/types";
import { AiRunnerService } from "./ai-runner.service";
import {
  buildCaseLawSearchMessages,
  CaseLawSearchPlanSchema,
  type CaseLawSearchPlan,
} from "./prompts/caselaw-search";
import { LiveCaseLawHit, YargitayLiveAdapter } from "./adapters/yargitay-live.adapter";
import {
  buildCaseLawSummarizeMessages,
  CaseLawSummarySchema,
  type CaseLawSummary,
} from "./prompts/caselaw-summarize";
import type {
  AiSearchInput,
  CreateCaseLawInput,
  LinkCaseLawInput,
  SummarizeCaseLawInput,
  UpdateCaseLawReferenceInput,
} from "./caselaw.dto";

const DEMO_WARNING =
  "Sonuçlar arasında [DEMO VERİ] işaretli kayıt var. Bu kayıtlar gerçek mahkeme kararı " +
  "DEĞİLDİR, yalnızca arayüz denemesi içindir ve dilekçede kaynak olarak kullanılamaz.";

export interface AiSearchHit extends CaseLawHit {
  summary5?: CaseLawSummary;
  summaryError?: string;
}

@Injectable()
export class CaselawService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly adapters: CaseLawAdapterRegistry,
    private readonly manualAdapter: ManualEntryCaseLawAdapter,
    private readonly aiRunner: AiRunnerService,
    private readonly liveAdapter: YargitayLiveAdapter,
  ) {}

  // ------------------------------------------------------------------ //
  // Klasik arama ve karar detayı
  // ------------------------------------------------------------------ //

  async search(
    tenantId: string,
    params: {
      q?: string;
      court?: string;
      from?: string;
      to?: string;
      limit?: string;
    },
  ): Promise<{
    results: CaseLawHit[];
    /** CANLI kaynak: resmî karararama.yargitay.gov.tr sonuçları (havuza yazılmaz). */
    live: LiveCaseLawHit[];
    liveError?: string;
    warning?: string;
  }> {
    const localPromise = this.adapters.searchAll(params.q ?? "", {
      // KİRACI GÖRÜNÜRLÜĞÜ: başka büronun elle girdiği kayıt aramada çıkmaz.
      tenantId,
      court: params.court,
      from: parseDate(params.from, "from"),
      to: parseDate(params.to, "to"),
      limit: params.limit ? Number.parseInt(params.limit, 10) || undefined : undefined,
    });

    // CANLI KATMAN — resmî kaynaktan, veritabanı aramasıyla PARALEL. Kaynak
    // erişilemezse arama düşmez: canlı bölüm hata notuyla listelenir.
    let live: LiveCaseLawHit[] = [];
    let liveError: string | undefined;
    const localResults = await localPromise;
    try {
      const res = await this.liveAdapter.search(params.q ?? "", 5);
      live = res.hits;
    } catch (err) {
      liveError =
        err instanceof Error
          ? `Canlı Yargıtay araması yapılamadı: ${err.message}`
          : "Canlı Yargıtay araması yapılamadı.";
    }

    return {
      results: localResults,
      live,
      liveError,
      warning: localResults.some((r) => r.isDemo) ? DEMO_WARNING : undefined,
    };
  }

  async detail(tenantId: string, id: string) {
    const record = await this.prisma.client.caseLawDocument.findFirst({
      // Başka bir büronun elle girdiği kayıt kimliği bilinse bile açılamaz.
      where: { id, ...tenantVisibility(tenantId) },
    });
    if (!record) {
      throw new NotFoundException("Karar kaydı bulunamadı.");
    }
    // Yalnızca ÇAĞIRAN KİRACININ bağları görünür (havuz ortak, bağlar kiracıya ait).
    const references = await this.prisma.client.caseLawReference.findMany({
      where: { tenantId, caseLawId: id },
      include: { case: { select: { id: true, title: true, fileNumber: true, courtName: true } } },
      orderBy: { createdAt: "desc" },
    });

    return {
      ...record,
      isDemo: isDemoRecord(record),
      linkedCases: references.map((ref) => ({
        referenceId: ref.id,
        status: ref.status,
        relevanceNote: ref.relevanceNote,
        case: ref.case,
      })),
    };
  }

  /**
   * Elle karar girişi (ManualEntryAdapter).
   *
   * Havuza yazma yetkisi hukuki rollerdedir; ortak havuza kiracıya özgü veri
   * yazılmaz (not/dosya bağı CaseLawReference'ta tutulur).
   */
  async createManual(user: AuthUser, input: CreateCaseLawInput) {
    assertRole(user, ROLE_SETS.HUKUKI, "içtihat havuzuna karar ekleme");

    const { record, created } = await this.manualAdapter.upsertManualRecord(user.tenantId, {
      court: input.court,
      chamber: input.chamber,
      caseNumber: input.caseNumber,
      decisionNumber: input.decisionNumber,
      decisionDate: input.decisionDate ? new Date(`${input.decisionDate}T00:00:00.000Z`) : undefined,
      summary: input.summary,
      fullText: input.fullText,
      sourceUrl: input.sourceUrl,
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: created ? "CASELAW_CREATE" : "CASELAW_UPDATE",
      entity: "CaseLawDocument",
      entityId: record.id,
      detail: `${record.court} ${record.caseNumber} E. ${record.decisionNumber} K.`,
    });

    return { ...record, isDemo: isDemoRecord(record), created };
  }

  async adapterHealth() {
    return { adapters: await this.adapters.healthCheckAll() };
  }

  // ------------------------------------------------------------------ //
  // AI destekli arama ve özet
  // ------------------------------------------------------------------ //

  /**
   * AI destekli arama.
   *
   * Adım 1 — CASELAW_SEARCH: soruyu anahtar kelimelere çevirir (LLM).
   * Adım 2 — Yerel havuzda DETERMİNİSTİK arama (LLM YOK).
   * Adım 3 — CASELAW_SUMMARIZE: bulunan GERÇEK kayıtların metnini özetler (LLM).
   *
   * Model hiçbir adımda karar/künye üretmez.
   */
  async aiSearch(user: AuthUser, input: AiSearchInput) {
    // Tek istekte 6'ya kadar LLM çağrısı üretir ve maliyet büroya yazılır;
    // araştırma yapabilen roller: hukuki roller + stajyer (araştırma stajyerin işidir).
    assertRole(user, [...ROLE_SETS.HUKUKI, "STAJYER"], "AI destekli içtihat araması");
    const contextText = input.caseId
      ? await this.buildSearchContext(user.tenantId, input.caseId)
      : "";
    const today = new Date().toISOString().slice(0, 10);

    const planRun = await this.aiRunner.run({
      user,
      taskType: "CASELAW_SEARCH",
      outboundTexts: [input.question, contextText],
      piiApproved: input.piiApproved,
      schema: CaseLawSearchPlanSchema,
      entity: input.caseId ? "Case" : undefined,
      entityId: input.caseId,
      maxTokens: 800,
      buildMessages: ([question, context]) =>
        buildCaseLawSearchMessages({
          question,
          caseContextText: context || undefined,
          today,
        }),
    });

    const plan: CaseLawSearchPlan = planRun.data;
    const expandedQuery = [input.question, ...plan.keywords, ...plan.concepts].join(" ");

    const hits: AiSearchHit[] = await this.adapters.searchAll(expandedQuery, {
      tenantId: user.tenantId,
      court: plan.courtHints[0],
      from: plan.dateFrom ? new Date(`${plan.dateFrom}T00:00:00.000Z`) : undefined,
      to: plan.dateTo ? new Date(`${plan.dateTo}T23:59:59.999Z`) : undefined,
      limit: 20,
    });

    const summarizeTop = input.summarizeTop ?? 3;
    for (const hit of hits.slice(0, summarizeTop)) {
      try {
        const record = await this.prisma.client.caseLawDocument.findFirst({
          where: { id: hit.caseLawId, ...tenantVisibility(user.tenantId) },
        });
        const text = decisionTextOf(record);
        if (!text) {
          hit.summaryError = "Kararın tam metni sistemde yok; özet üretilemedi.";
          continue;
        }
        const run = await this.aiRunner.run({
          user,
          taskType: "CASELAW_SUMMARIZE",
          outboundTexts: [text, contextText],
          piiApproved: input.piiApproved,
          schema: CaseLawSummarySchema,
          entity: "CaseLawDocument",
          entityId: hit.caseLawId,
          maxTokens: 1200,
          buildMessages: ([decisionText, context]) =>
            buildCaseLawSummarizeMessages({
              decisionText,
              caseContextText: context || undefined,
            }),
        });
        hit.summary5 = run.data;
      } catch (err) {
        // Tek bir özetin başarısız olması aramanın tamamını düşürmez; neden görünür kalır.
        hit.summaryError = messageOf(err);
      }
    }

    return {
      plan,
      expandedQuery,
      results: hits,
      warning: hits.some((h) => h.isDemo) ? DEMO_WARNING : undefined,
      advisory: planRun.advisory,
      model: planRun.model,
      notice:
        "Sonuçlar sistemdeki kayıtlı kararlardır; yapay zekâ yalnızca arama terimlerini " +
        "genişletmiş ve bulunan kararları özetlemiştir. Karar metnini kullanmadan önce okuyun.",
    };
  }

  /** Tek bir kararın AI özeti (5 bölümlü şema). */
  async summarize(user: AuthUser, id: string, input: SummarizeCaseLawInput) {
    assertRole(user, [...ROLE_SETS.HUKUKI, "STAJYER"], "AI ile karar özeti üretme");
    const record = await this.prisma.client.caseLawDocument.findFirst({
      where: { id, ...tenantVisibility(user.tenantId) },
    });
    if (!record) {
      throw new NotFoundException("Karar kaydı bulunamadı.");
    }
    const text = decisionTextOf(record);
    if (!text) {
      throw new BadRequestException(
        "Bu kararın metni sistemde yok. Özet üretebilmek için karar metnini (fullText) girin.",
      );
    }
    const contextText = input.caseId ? await this.buildSearchContext(user.tenantId, input.caseId) : "";

    const run = await this.aiRunner.run({
      user,
      taskType: "CASELAW_SUMMARIZE",
      outboundTexts: [text, contextText],
      piiApproved: input.piiApproved,
      schema: CaseLawSummarySchema,
      entity: "CaseLawDocument",
      entityId: id,
      maxTokens: 1200,
      buildMessages: ([decisionText, context]) =>
        buildCaseLawSummarizeMessages({ decisionText, caseContextText: context || undefined }),
    });

    return {
      caseLawId: id,
      isDemo: isDemoRecord(record),
      summary: run.data,
      advisory: run.advisory,
      model: run.model,
    };
  }

  // ------------------------------------------------------------------ //
  // Dosya–emsal bağları (kiracıya ait)
  // ------------------------------------------------------------------ //

  async listCaseReferences(tenantId: string, caseId: string) {
    await this.assertCase(tenantId, caseId);
    const refs = await this.prisma.client.caseLawReference.findMany({
      where: { tenantId, caseId },
      include: { caseLaw: true },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    });
    return refs.map((ref) => ({
      id: ref.id,
      status: ref.status,
      relevanceNote: ref.relevanceNote,
      addedBy: ref.addedBy,
      createdAt: ref.createdAt,
      caseLaw: { ...ref.caseLaw, isDemo: isDemoRecord(ref.caseLaw) },
    }));
  }

  /**
   * Dosyaya emsal bağlar. Kayıt daima ADAY açılır (Modül 23, iş kuralı 9):
   * stajyerin taraması da AI önerisi de avukat KABUL etmeden "onaylı emsal"
   * sayılmaz ve dilekçe bağlam paketine akmaz.
   *
   * Mevcut bağın statüsü EZİLMEZ: avukat bir kararı RED ettiyse yeniden
   * bağlanması onu tekrar ADAY yapmaz.
   */
  async linkToCase(user: AuthUser, caseId: string, input: LinkCaseLawInput) {
    await this.assertCase(user.tenantId, caseId);
    const caseLaw = await this.prisma.client.caseLawDocument.findFirst({
      where: { id: input.caseLawId, ...tenantVisibility(user.tenantId) },
    });
    if (!caseLaw) {
      throw new NotFoundException("Bağlanmak istenen karar kaydı bulunamadı.");
    }

    const existing = await this.prisma.client.caseLawReference.findUnique({
      where: { caseId_caseLawId: { caseId, caseLawId: input.caseLawId } },
    });

    const reference = existing
      ? await this.prisma.client.caseLawReference.update({
          where: { id: existing.id },
          data: { relevanceNote: input.relevanceNote ?? existing.relevanceNote },
        })
      : await this.prisma.client.caseLawReference.create({
          data: {
            tenantId: user.tenantId,
            caseId,
            caseLawId: input.caseLawId,
            status: "ADAY",
            relevanceNote: input.relevanceNote,
            addedBy: user.userId,
          },
        });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: existing ? "CASELAW_REF_UPDATE" : "CASELAW_REF_LINK",
      entity: "CaseLawReference",
      entityId: reference.id,
      detail: `${caseLaw.court} ${caseLaw.caseNumber} E. → dosya ${caseId}`,
    });

    return {
      ...reference,
      alreadyLinked: Boolean(existing),
      caseLaw: { ...caseLaw, isDemo: isDemoRecord(caseLaw) },
    };
  }

  /**
   * ADAY → KABUL / RED.
   *
   * Emsal KABULÜ hukuki bir değerlendirmedir: yalnız ADMIN/PARTNER/AVUKAT yapabilir
   * (Modül 23, iş kuralı 1). Stajyer aday bağlayabilir ama kabul edemez.
   */
  async updateReference(user: AuthUser, id: string, input: UpdateCaseLawReferenceInput) {
    const existing = await this.prisma.client.caseLawReference.findFirst({
      where: { id, tenantId: user.tenantId },
      include: { caseLaw: true },
    });
    if (!existing) {
      throw new NotFoundException("Emsal bağı bulunamadı.");
    }
    if (input.status && input.status !== existing.status) {
      assertRole(user, ROLE_SETS.HUKUKI, "emsal kararı kabul/red etme");
    }

    const updated = await this.prisma.client.caseLawReference.update({
      where: { id: existing.id },
      data: {
        status: input.status ?? existing.status,
        relevanceNote: input.relevanceNote ?? existing.relevanceNote,
      },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CASELAW_REF_STATUS",
      entity: "CaseLawReference",
      entityId: updated.id,
      detail: `${existing.status} → ${updated.status}`,
    });

    return { ...updated, caseLaw: { ...existing.caseLaw, isDemo: isDemoRecord(existing.caseLaw) } };
  }

  /**
   * Dilekçe bağlam paketine akacak ONAYLI emsaller (status = KABUL).
   *
   * DEMO kayıtlar bilinçli olarak DIŞARIDA bırakılır: modele "[DEMO VERİ]" bir
   * künye verilirse dilekçeye gerçek sanılan bir atıf girer. Dışarıda kalanlar
   * çağırana ayrıca bildirilir ki avukat neyin eksik olduğunu görsün.
   */
  async approvedPrecedentsForCase(
    tenantId: string,
    caseId: string,
  ): Promise<{ lines: string[]; excludedDemo: string[] }> {
    const refs = await this.prisma.client.caseLawReference.findMany({
      where: { tenantId, caseId, status: "KABUL" },
      include: { caseLaw: true },
      orderBy: { createdAt: "asc" },
    });

    const lines: string[] = [];
    const excludedDemo: string[] = [];
    for (const ref of refs) {
      const label = formatCitation(ref.caseLaw, ref.relevanceNote);
      if (isDemoRecord(ref.caseLaw)) {
        excludedDemo.push(label);
        continue;
      }
      lines.push(label);
    }
    return { lines, excludedDemo };
  }

  // ------------------------------------------------------------------ //
  // Yardımcılar
  // ------------------------------------------------------------------ //

  private async assertCase(tenantId: string, caseId: string) {
    const found = await this.prisma.client.case.findFirst({
      where: { id: caseId, tenantId },
      select: { id: true },
    });
    if (!found) {
      throw new NotFoundException("Dosya bulunamadı.");
    }
    return found;
  }

  /**
   * Arama için ASGARİ dosya bağlamı (veri minimizasyonu).
   *
   * Terim çıkarmaya yarayan alanlar alınır; taraf ADLARI ve kimlik bilgisi
   * BİLİNÇLİ OLARAK dışarıda bırakılır — arama terimi üretmeye katkısı yoktur,
   * dış sağlayıcıya gönderilmesi gereksiz risktir (docs/04, amaç sınırlılığı).
   */
  private async buildSearchContext(tenantId: string, caseId: string): Promise<string> {
    const found = await this.prisma.client.case.findFirst({
      where: { id: caseId, tenantId },
      select: { type: true, subject: true, courtName: true, title: true },
    });
    if (!found) {
      throw new NotFoundException("Dosya bulunamadı.");
    }
    return [
      `Dava türü: ${found.type}`,
      found.courtName ? `Mahkeme: ${found.courtName}` : undefined,
      found.subject ? `Konu: ${found.subject}` : `Başlık: ${found.title}`,
    ]
      .filter(Boolean)
      .join(" · ");
  }
}

function decisionTextOf(record: CaseLawDocument | null): string | undefined {
  if (!record) return undefined;
  const text = record.fullText?.trim() || record.summary?.trim();
  return text || undefined;
}

export function formatCitation(record: CaseLawDocument, note?: string | null): string {
  const date = record.decisionDate ? `, ${record.decisionDate.toISOString().slice(0, 10)}` : "";
  const base = `${record.court} ${record.caseNumber} E. ${record.decisionNumber} K.${date}`;
  const tail = note?.trim() ? ` — İlgi: ${note.trim()}` : record.summary ? ` — ${record.summary.slice(0, 200)}` : "";
  return `${base}${tail}`;
}

function parseDate(value: string | undefined, label: string): Date | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`Geçersiz tarih (${label}): YYYY-AA-GG biçiminde gönderin.`);
  }
  const suffix = label === "to" ? "T23:59:59.999Z" : "T00:00:00.000Z";
  return new Date(`${value}${suffix}`);
}

function messageOf(err: unknown): string {
  const response = (err as { response?: unknown }).response;
  if (response && typeof response === "object" && "message" in response) {
    return String((response as { message: unknown }).message);
  }
  return (err as Error).message ?? "Bilinmeyen hata";
}
