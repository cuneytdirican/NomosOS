import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { scanPii } from "@nomosos/ai";
import {
  buildCaseChatMessages,
  CaseChatOutputSchema,
  NO_SOURCE_NOTICE,
  type CaseChatOutput,
  type CaseChatRetrievedChunk,
  type ExtractedCitation,
  type LlmMessage,
} from "@nomosos/legal-ai";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../common/types";
import { assertRole, ROLE_SETS } from "../common/roles";
import { AssistantLlmService } from "./assistant-llm.service";
import { CaseContextBuilder } from "./case-context.builder";
import { RetrievalService, type RetrievedChunk } from "./retrieval.service";
import {
  buildLocalMessages,
  caseFullAnalysisPrompt,
  CaseFullAnalysisOutputSchema,
  CASE_FULL_ANALYSIS_FINDING_PATHS,
  smartNotePrompt,
  SmartNoteOutputSchema,
  SMART_NOTE_FINDING_PATHS,
} from "./assistant.prompts";
import type { AnalyzeCaseInput, AssistantChatInput, CreateNoteInput } from "./assistant.dto";

/** Sohbet geçmişinden bağlama alınacak en fazla tur (kullanıcı+asistan). */
const HISTORY_MESSAGE_LIMIT = 8;

/** Dosya künyesi bağlamına ayrılan token bütçesi. */
const CASE_CONTEXT_BUDGET_CHAT = 1200;
const CASE_CONTEXT_BUDGET_ANALYSIS = 3000;
const CASE_CONTEXT_BUDGET_NOTE = 1200;

/** Erişilen belge parçalarına ayrılan token bütçesi. */
const CHUNK_BUDGET_CHAT = 3000;
const CHUNK_BUDGET_ANALYSIS = 7000;
const CHUNK_BUDGET_NOTE = 2000;

type ChatCitation = CaseChatOutput["citations"][number];

export interface AssistantChatResult {
  sessionId: string;
  messageId: string;
  answer: string;
  /** UI'da kaynak çipi olarak gösterilecek, DOĞRULANMIŞ referanslar. */
  sources: Array<ChatCitation & { chunkId?: string; verified: boolean }>;
  /** Cevap metninden çıkarılan içtihat/mevzuat künyeleri — caselaw teyit ucuna gider. */
  citations: ExtractedCitation[];
  noSource: boolean;
  followUpSuggestions: string[];
  retrieval: { mode: string; usedChunks: number; totalChunks: number; notice?: string };
  warnings: string[];
  advisory: { isAdvisory: true; notice: string };
  model: string;
  piiMasked: boolean;
}

/**
 * AI Dosya Asistanı — modülün ana servisi.
 *
 * TAVİZSİZ İLKELER (Modül 24):
 *  - Her ASSISTANT cevabı KAYNAK gösterir. Retrieval boşsa veya modelin verdiği
 *    referanslar erişilen parçalarla eşleşmiyorsa cevap `noSource=true` ile
 *    işaretlenir; uydurma referans sessizce kabul edilmez.
 *  - AI çıktısı ÖNERİDİR: hiçbir uç kendiliğinden görev/süre/not KESİNLEŞTİRMEZ.
 *    Akıllı notlar `isApproved=false` doğar; analiz raporları IMMUTABLE'dır.
 *  - Süre hesabı yapılmaz; yalnızca deterministik Deadline kayıtları aktarılır.
 *  - Her sorgu `tenantId` süzgeçlidir.
 */
@Injectable()
export class AssistantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly llm: AssistantLlmService,
    private readonly contextBuilder: CaseContextBuilder,
    private readonly retrieval: RetrievalService,
  ) {}

  /* ================================================================ *
   * Sohbet
   * ================================================================ */

  async chat(user: AuthUser, input: AssistantChatInput): Promise<AssistantChatResult> {
    // BİLİNÇLİ TERCİH: sohbet BÜTÜN rollere açıktır (ROLE_SETS.HERKES) —
    // sekreter de "duruşma ne zaman?" diye sorabilmelidir. Erişim, kullanıcının
    // göreceği dosyayla sınırlıdır ve maliyet hız sınırıyla korunur
    // (AiRateLimitGuard, assistant.controller.ts).
    assertRole(user, ROLE_SETS.HERKES, "AI dosya asistanına soru sorma");
    const session = await this.resolveSession(user, input);
    const caseId = session.caseId;
    if (!caseId) {
      throw new BadRequestException(
        "Dosya asistanı bir dosya bağlamı ister. Dosya seçin (caseId) veya büro geneli " +
          "sorular için POST /assistant/office-query ucunu kullanın.",
      );
    }

    // 1) Dosya künyesi bağlamı (maskeli, token bütçeli, veri minimizasyonlu).
    const context = await this.contextBuilder.buildFor(
      user.tenantId,
      caseId,
      "CASE_CHAT",
      CASE_CONTEXT_BUDGET_CHAT,
    );

    // 2) Erişim (RAG): gömme varsa kosinüs, yoksa anahtar kelime.
    const retrieved = await this.retrieval.retrieveContext(user.tenantId, caseId, input.message, {
      topK: input.topK ?? 8,
      tokenBudget: CHUNK_BUDGET_CHAT,
    });

    // 3) Sohbet geçmişi.
    const history = await this.loadHistory(session.id);

    const chunks: CaseChatRetrievedChunk[] = retrieved.chunks.map((c) => ({
      citationLabel: c.sourceLabel,
      content: c.content,
      refId: c.documentId,
    }));

    const messages = buildCaseChatMessages({
      question: input.message,
      chunks,
      caseContextText: context.built.text,
      history,
    });

    const run = await this.llm.runTask({
      user,
      routeKeys: ["CASE_CHAT"],
      logTaskType: "CASE_CHAT",
      messages,
      schema: CaseChatOutputSchema,
      findingPaths: [],
      piiApproved: input.piiApproved,
      maxTokens: 2048,
      auditDetail: `caseId=${caseId} retrieval=${retrieved.mode} parca=${retrieved.chunks.length}`,
      policyOverrides: context.built.policyOverrides,
    });

    // 4) KAYNAK KAPISI — modelin uydurduğu referanslar elenir.
    const { sources, droppedCount } = this.verifyCitations(
      run.data.citations,
      retrieved.chunks,
      context.built.text,
    );

    // [DÜZELTME] KAYNAKLILIK ÖLÇÜSÜ YALNIZCA `verified === true` REFERANSLARDIR.
    //
    // `verifyCitations`, DOCUMENT dışındaki her künyeyi (CASELAW/STATUTE dâhil)
    // koşulsuz `sources`'a ekler ama `verified: false` ile işaretler. Eskiden
    // `noSource` ham `sources.length`e bakıyordu; model erişilen belge
    // parçalarıyla hiç eşleşmeyen, YALNIZCA UYDURMA bir içtihat künyesi
    // döndürdüğünde `sources.length === 1` oluyor, `noSource=false` çıkıyor ve
    // "teyitsizdir" uyarısı EKLENMİYORDU. Cevap kaynaklıymış gibi sunuluyordu.
    const verifiedSources = sources.filter((s) => s.verified);
    const unverifiedSources = sources.filter((s) => !s.verified);
    const noSource = run.data.noSource || verifiedSources.length === 0;
    const answer =
      verifiedSources.length === 0 && !run.data.noSource
        ? `${run.data.answer}\n\n(${NO_SOURCE_NOTICE} Bu cevabın dosyadaki bir kayda bağlanamayan kısımları teyitsizdir.)`
        : run.data.answer;

    const warnings: string[] = [];
    if (unverifiedSources.length > 0) {
      warnings.push(
        `${unverifiedSources.length} içtihat/mevzuat atfı TEYİT EDİLMEDİ. Bunlar modelin ` +
          "metninden çıkarılmış ham künyelerdir; kullanmadan önce POST /caselaw/verify ile " +
          "doğrulayın (uydurma künye olabilir).",
      );
    }
    if (retrieved.notice) warnings.push(retrieved.notice);
    if (context.unindexedDocumentNames.length > 0) {
      warnings.push(
        `Şu belge(ler) henüz indekslenmedi ve cevaba dahil edilemedi: ${context.unindexedDocumentNames.join(", ")}.`,
      );
    }
    if (droppedCount > 0) {
      warnings.push(
        `${droppedCount} referans, erişilen belge parçalarıyla eşleşmediği için elendi (uydurma kaynak koruması).`,
      );
    }
    if (context.built.truncated) {
      warnings.push(
        `Token bütçesi nedeniyle dosya künyesinden ${context.built.droppedItemCount} kayıt bağlama alınamadı.`,
      );
    }

    // 5) Kalıcılık — büro hafızası.
    await this.prisma.client.chatMessage.create({
      data: { sessionId: session.id, role: "USER", content: input.message },
    });
    const saved = await this.prisma.client.chatMessage.create({
      data: {
        sessionId: session.id,
        role: "ASSISTANT",
        content: answer,
        citationsJson: JSON.stringify({
          sources,
          extractedCitations: run.citations,
          noSource,
          retrievalMode: retrieved.mode,
        }),
        model: run.model,
        aiUsageLogId: run.usageLogId,
      },
    });
    await this.prisma.client.chatSession.update({
      where: { id: session.id },
      data: { updatedAt: new Date() },
    });

    return {
      sessionId: session.id,
      messageId: saved.id,
      answer,
      sources,
      citations: run.citations,
      noSource,
      followUpSuggestions: run.data.followUpSuggestions,
      retrieval: {
        mode: retrieved.mode,
        usedChunks: retrieved.chunks.length,
        totalChunks: retrieved.totalChunks,
        notice: retrieved.notice,
      },
      warnings,
      advisory: run.advisory,
      model: run.model,
      piiMasked: run.piiMasked,
    };
  }

  async listSessions(user: AuthUser, caseId?: string) {
    const sessions = await this.prisma.client.chatSession.findMany({
      where: {
        tenantId: user.tenantId,
        ...(caseId ? { caseId } : {}),
        // Dosya oturumlarını dosyayı görebilen herkes okur; genel oturumlar sahibine özeldir.
        ...(caseId ? {} : { OR: [{ caseId: { not: null } }, { userId: user.userId }] }),
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: {
        case: { select: { id: true, title: true, fileNumber: true } },
        _count: { select: { messages: true } },
      },
    });
    return sessions.map((s) => ({
      id: s.id,
      title: s.title,
      caseId: s.caseId,
      case: s.case,
      userId: s.userId,
      messageCount: s._count.messages,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
  }

  async getSession(user: AuthUser, id: string) {
    const session = await this.prisma.client.chatSession.findFirst({
      where: { id, tenantId: user.tenantId },
      include: {
        case: { select: { id: true, title: true, fileNumber: true } },
        messages: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!session) throw new NotFoundException("Sohbet oturumu bulunamadı.");
    // Genel asistan oturumları yalnızca sahibine görünür (Modül 24, iş kuralı 6).
    if (!session.caseId && session.userId !== user.userId) {
      throw new NotFoundException("Sohbet oturumu bulunamadı.");
    }

    return {
      id: session.id,
      title: session.title,
      caseId: session.caseId,
      case: session.case,
      userId: session.userId,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messages: session.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        citations: m.citationsJson ? (JSON.parse(m.citationsJson) as unknown) : null,
        model: m.model,
        aiUsageLogId: m.aiUsageLogId,
        createdAt: m.createdAt,
      })),
    };
  }

  /**
   * Oturum silme.
   *
   * NOT: Modül 24 iş kuralı 6 "silinmez, arşivlenir" der; Faz 2 şemasında
   * ChatSession'da `status` alanı olmadığı için silme yalnızca OTURUM SAHİBİNE
   * (veya ADMIN/PARTNER'a) açıktır. `status` alanı geldiğinde bu uç arşivlemeye
   * çevrilmelidir.
   */
  async deleteSession(user: AuthUser, id: string) {
    const session = await this.prisma.client.chatSession.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true, userId: true, caseId: true },
    });
    if (!session) throw new NotFoundException("Sohbet oturumu bulunamadı.");
    if (session.userId !== user.userId) {
      assertRole(user, ROLE_SETS.ONAY, "başkasına ait sohbet oturumunu silme");
    }

    await this.prisma.client.chatSession.delete({ where: { id } });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "AI_CHAT_SESSION_DELETE",
      entity: "ChatSession",
      entityId: id,
      detail: session.caseId ? `caseId=${session.caseId}` : "genel oturum",
    });
    return { deleted: true };
  }

  /* ================================================================ *
   * Tam dosya analizi
   * ================================================================ */

  async analyzeCase(user: AuthUser, caseId: string, input: AnalyzeCaseInput) {
    assertRole(user, ROLE_SETS.HUKUKI, "dosya analizi raporu üretme");

    const context = await this.contextBuilder.buildFor(
      user.tenantId,
      caseId,
      "CASE_FULL_ANALYSIS",
      CASE_CONTEXT_BUDGET_ANALYSIS,
    );

    // Analizde tek bir soru yoktur; erişim sorgusu dosyanın kendi künyesinden kurulur.
    const query = [context.caseTitle, context.caseFileNumber, "talep iddia savunma delil itiraz"]
      .filter(Boolean)
      .join(" ");
    const retrieved = await this.retrieval.retrieveContext(user.tenantId, caseId, query, {
      topK: input?.topK ?? 20,
      tokenBudget: CHUNK_BUDGET_ANALYSIS,
    });

    const chunkBlock = retrieved.chunks.length
      ? retrieved.chunks
          .map((c, i) => `[${i + 1}] ${c.sourceLabel} (id: ${c.documentId})\n${c.content}`)
          .join("\n\n")
      : "(Retrieval boş döndü — dosyada indekslenmiş belge parçası bulunamadı.)";

    const messages = buildLocalMessages(
      caseFullAnalysisPrompt,
      `DOSYA BAĞLAMI:\n${context.built.text}\n\nBAĞLAM PARÇALARI:\n${chunkBlock}`,
    );

    const run = await this.llm.runTask({
      user,
      routeKeys: ["CASE_FULL_ANALYSIS", "CASE_CHAT"],
      logTaskType: "CASE_FULL_ANALYSIS",
      messages,
      schema: CaseFullAnalysisOutputSchema,
      findingPaths: CASE_FULL_ANALYSIS_FINDING_PATHS,
      piiApproved: input?.piiApproved,
      maxTokens: 6144,
      auditDetail: `caseId=${caseId} retrieval=${retrieved.mode} parca=${retrieved.chunks.length}`,
      policyOverrides: context.built.policyOverrides,
    });

    const { sources } = this.verifyCitations(
      run.data.citations,
      retrieved.chunks,
      context.built.text,
    );

    const warnings: string[] = [];
    if (retrieved.notice) warnings.push(retrieved.notice);
    if (context.unindexedDocumentNames.length > 0) {
      warnings.push(
        `Şu belge(ler) indekslenmediği için analize giremedi: ${context.unindexedDocumentNames.join(", ")}.`,
      );
    }
    if (run.droppedFindings.length > 0) {
      warnings.push(
        `${run.droppedFindings.length} bulgu kaynak göstermediği için rapordan ELENDİ (kaynaksız iddia koruması).`,
      );
    }

    const content = {
      ...run.data,
      sources,
      extractedCitations: run.citations,
      retrievalMode: retrieved.mode,
      droppedFindings: run.droppedFindings,
      warnings,
      advisory: run.advisory,
    };

    // IMMUTABLE: mevcut rapor güncellenmez, her analiz yeni kayıttır.
    const report = await this.prisma.client.caseAnalysisReport.create({
      data: {
        tenantId: user.tenantId,
        caseId,
        contentJson: JSON.stringify(content),
        model: run.model,
        createdBy: user.userId,
      },
    });

    return {
      id: report.id,
      caseId,
      createdAt: report.createdAt,
      createdBy: report.createdBy,
      model: run.model,
      content,
      citations: run.citations,
      advisory: run.advisory,
      warnings,
    };
  }

  async listAnalyses(tenantId: string, caseId: string) {
    const reports = await this.prisma.client.caseAnalysisReport.findMany({
      where: { tenantId, caseId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return reports.map((r) => ({
      id: r.id,
      caseId: r.caseId,
      model: r.model,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
      content: JSON.parse(r.contentJson) as unknown,
    }));
  }

  /* ================================================================ *
   * Akıllı notlar
   * ================================================================ */

  async createNote(user: AuthUser, input: CreateNoteInput) {
    // Manuel not herkese açıktır; AI NOT ÖNERİSİ üretmek (LLM maliyeti + dosya
    // bağlamının dışa gitmesi) hukuki rollerin ve stajyerin işidir.
    if (!input.content) {
      assertRole(user, [...ROLE_SETS.HUKUKI, "STAJYER"], "AI ile akıllı not önerisi üretme");
    }

    const found = await this.prisma.client.case.findFirst({
      where: { id: input.caseId, tenantId: user.tenantId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException("Dosya bulunamadı.");

    // ---- MANUEL not: AI çalışmaz, not doğrudan kesinleşir. ----
    if (input.content) {
      const note = await this.prisma.client.smartNote.create({
        data: {
          tenantId: user.tenantId,
          caseId: input.caseId,
          userId: user.userId,
          content: input.content,
          kind: input.kind,
          source: "MANUEL",
          isApproved: true,
        },
      });
      await this.audit.log({
        tenantId: user.tenantId,
        userId: user.userId,
        action: "SMART_NOTE_CREATE",
        entity: "SmartNote",
        entityId: note.id,
        detail: "source=MANUEL",
      });
      return { note, source: "MANUEL" as const, advisory: null, citations: [] };
    }

    // ---- AI not ÖNERİSİ: isApproved=false doğar. ----
    const context = await this.contextBuilder.buildFor(
      user.tenantId,
      input.caseId,
      "SMART_NOTE",
      CASE_CONTEXT_BUDGET_NOTE,
    );
    const query = [input.instruction, input.kind, context.caseTitle].filter(Boolean).join(" ");
    const retrieved = await this.retrieval.retrieveContext(
      user.tenantId,
      input.caseId,
      query,
      { topK: 6, tokenBudget: CHUNK_BUDGET_NOTE },
    );

    const chunkBlock = retrieved.chunks.length
      ? retrieved.chunks
          .map((c, i) => `[${i + 1}] ${c.sourceLabel} (id: ${c.documentId})\n${c.content}`)
          .join("\n\n")
      : "(Retrieval boş döndü.)";

    const messages = buildLocalMessages(
      smartNotePrompt,
      [
        `NOT TÜRÜ: ${input.kind}`,
        input.instruction ? `YÖNERGE: ${scanPii(input.instruction).maskedText}` : undefined,
        `DOSYA BAĞLAMI:\n${context.built.text}`,
        `BAĞLAM PARÇALARI:\n${chunkBlock}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    );

    const run = await this.llm.runTask({
      user,
      routeKeys: ["SMART_NOTE", "CASE_CHAT"],
      logTaskType: "SMART_NOTE",
      messages,
      schema: SmartNoteOutputSchema,
      findingPaths: SMART_NOTE_FINDING_PATHS,
      piiApproved: input.piiApproved,
      maxTokens: 1536,
      auditDetail: `caseId=${input.caseId} kind=${input.kind}`,
      policyOverrides: context.built.policyOverrides,
    });

    const suggestion = run.data.notes[0];
    if (!suggestion) {
      throw new UnprocessableEntityException({
        message:
          "Kaynak gösteren bir not önerisi üretilemedi. Dosyanın belgeleri indekslenmemiş olabilir " +
          "(POST /assistant/index/:caseId) veya bağlamda dayanak bulunamadı.",
        droppedFindings: run.droppedFindings,
        retrievalNotice: retrieved.notice,
      });
    }

    const note = await this.prisma.client.smartNote.create({
      data: {
        tenantId: user.tenantId,
        caseId: input.caseId,
        userId: null, // AI üretimi; onaylayan kullanıcı approve anında yazılır.
        content: `${suggestion.content}\n\nKaynaklar: ${suggestion.sourceRefs.join(" · ")}`,
        kind: suggestion.kind,
        source: "AI",
        isApproved: false,
      },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "SMART_NOTE_SUGGEST",
      entity: "SmartNote",
      entityId: note.id,
      detail: `source=AI model=${run.model} kaynaksizElenen=${run.droppedFindings.length}`,
    });

    return {
      note,
      source: "AI" as const,
      rationale: suggestion.rationale,
      sourceRefs: suggestion.sourceRefs,
      citations: run.citations,
      advisory: run.advisory,
      droppedFindings: run.droppedFindings,
      retrievalNotice: retrieved.notice,
    };
  }

  async listNotes(tenantId: string, caseId: string, onlyApproved?: boolean) {
    return this.prisma.client.smartNote.findMany({
      where: {
        tenantId,
        caseId,
        ...(onlyApproved === undefined ? {} : { isApproved: onlyApproved }),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  /** AI not önerisini avukat onayına bağlar — onaylanmadan "kesin" not sayılmaz. */
  async approveNote(user: AuthUser, id: string) {
    assertRole(user, ROLE_SETS.HUKUKI, "AI not önerisini onaylama");

    const note = await this.prisma.client.smartNote.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!note) throw new NotFoundException("Not bulunamadı.");
    if (note.isApproved) {
      throw new BadRequestException("Bu not zaten onaylanmış.");
    }

    const updated = await this.prisma.client.smartNote.update({
      where: { id },
      data: { isApproved: true, userId: user.userId },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "SMART_NOTE_APPROVE",
      entity: "SmartNote",
      entityId: id,
    });
    return updated;
  }

  async rejectNote(user: AuthUser, id: string) {
    assertRole(user, ROLE_SETS.HUKUKI, "AI not önerisini reddetme");

    const note = await this.prisma.client.smartNote.findFirst({
      where: { id, tenantId: user.tenantId, source: "AI", isApproved: false },
      select: { id: true },
    });
    if (!note) throw new NotFoundException("Reddedilecek AI not önerisi bulunamadı.");

    await this.prisma.client.smartNote.delete({ where: { id } });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "SMART_NOTE_REJECT",
      entity: "SmartNote",
      entityId: id,
    });
    return { deleted: true };
  }

  /* ================================================================ *
   * Yardımcılar
   * ================================================================ */

  private async resolveSession(user: AuthUser, input: AssistantChatInput) {
    if (input.sessionId) {
      const session = await this.prisma.client.chatSession.findFirst({
        where: { id: input.sessionId, tenantId: user.tenantId },
      });
      if (!session) throw new NotFoundException("Sohbet oturumu bulunamadı.");
      if (!session.caseId && session.userId !== user.userId) {
        throw new ForbiddenException("Bu genel asistan oturumu size ait değil.");
      }
      if (input.caseId && session.caseId && session.caseId !== input.caseId) {
        throw new BadRequestException("Oturum başka bir dosyaya ait.");
      }
      return session;
    }

    if (!input.caseId) {
      throw new BadRequestException(
        "Yeni sohbet için dosya seçilmelidir (caseId). Büro geneli sorular için " +
          "POST /assistant/office-query ucunu kullanın.",
      );
    }
    const found = await this.prisma.client.case.findFirst({
      where: { id: input.caseId, tenantId: user.tenantId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException("Dosya bulunamadı.");

    const title = input.message.trim().slice(0, 60) || "Yeni oturum";
    return this.prisma.client.chatSession.create({
      data: {
        tenantId: user.tenantId,
        userId: user.userId,
        caseId: input.caseId,
        title,
      },
    });
  }

  private async loadHistory(sessionId: string): Promise<LlmMessage[]> {
    const rows = await this.prisma.client.chatMessage.findMany({
      where: { sessionId, role: { in: ["USER", "ASSISTANT"] } },
      orderBy: { createdAt: "desc" },
      take: HISTORY_MESSAGE_LIMIT,
      select: { role: true, content: true },
    });
    return rows
      .reverse()
      .map((m) => ({
        role: m.role === "USER" ? ("user" as const) : ("assistant" as const),
        content: m.content,
      }));
  }

  /**
   * KAYNAK DOĞRULAMA — halüsinasyon savunmasının uygulama katmanındaki ayağı.
   *
   * Model DOCUMENT referansı verdiyse bu referans GERÇEKTEN erişilen parçalarla
   * eşleşmelidir (belge kimliği veya künye). Eşleşmeyen referans ELENİR; model
   * "doc-99" diye var olmayan bir belgeye atıf yaparsa avukata çip olarak
   * gösterilmez. İçtihat/mevzuat künyeleri (CASELAW/STATUTE) korunur ama
   * `verified: false` ile döner — teyidi Modül 23'ün CITATION_VERIFY ucu yapar.
   */
  private verifyCitations(
    citations: readonly ChatCitation[],
    chunks: readonly RetrievedChunk[],
    /**
     * Modele GERÇEKTEN verilmiş dosya künyesi metni (denetim bulgusu Ö-21).
     *
     * TIMELINE/DEADLINE künyeleri eskiden KOŞULSUZ `verified: true` alıyordu;
     * yorumdaki "bağlam künyesinden gelir" bir VARSAYIMDI, hiçbir yerde
     * doğrulanmıyordu. Retrieval boş döndüğünde model bağlamda olmayan bir
     * cevap üretip `citations:[{"kind":"TIMELINE","refId":"2026-05-14"}]`
     * eklerse: `verifiedSources.length === 1` → `noSource=false` → "teyitsizdir"
     * uyarısı EKLENMEZ; `unverifiedSources` boş olduğu için "TEYİT EDİLMEDİ"
     * şeridi de çıkmaz. Cevap avukata KAYNAKLI VE DOĞRULANMIŞ gibi sunulurdu.
     *
     * Aynı dosyadaki `[DÜZELTME]` yorumu bu sınıf hatanın CASELAW için bir kez
     * yaşandığını anlatıyor; TIMELINE/DEADLINE aynı düzeltmenin dışında kalmıştı.
     */
    contextText: string,
  ): { sources: Array<ChatCitation & { chunkId?: string; verified: boolean }>; droppedCount: number } {
    const normalizedContext = contextText.toLocaleLowerCase("tr-TR");
    const byDocument = new Map<string, RetrievedChunk>();
    const byLabel = new Map<string, RetrievedChunk>();
    for (const chunk of chunks) {
      if (!byDocument.has(chunk.documentId)) byDocument.set(chunk.documentId, chunk);
      byLabel.set(chunk.sourceLabel.toLocaleLowerCase("tr-TR"), chunk);
    }

    const sources: Array<ChatCitation & { chunkId?: string; verified: boolean }> = [];
    let droppedCount = 0;

    for (const citation of citations) {
      if (citation.kind === "DOCUMENT") {
        const byId = citation.refId ? byDocument.get(citation.refId) : undefined;
        const byChunk = citation.chunkId
          ? chunks.find((c) => c.chunkId === citation.chunkId)
          : undefined;
        const label = citation.label.toLocaleLowerCase("tr-TR").trim();
        // Ön ek eşleşmesi yalnızca AYIRT EDİCİ uzunlukta künyelerde denenir;
        // aksi hâlde tek harflik bir etiket her parçayla eşleşirdi.
        const byLabelMatch =
          byLabel.get(label) ??
          (label.length >= 8
            ? chunks.find((c) =>
                c.sourceLabel.toLocaleLowerCase("tr-TR").startsWith(label.slice(0, 20)),
              )
            : undefined);
        const match = byChunk ?? byId ?? byLabelMatch;
        if (!match) {
          droppedCount += 1;
          continue;
        }
        sources.push({
          ...citation,
          refId: citation.refId ?? match.documentId,
          chunkId: match.chunkId,
          label: citation.label || match.sourceLabel,
          verified: true,
        });
        continue;
      }

      // TIMELINE / DEADLINE: "bağlam künyesinden gelir" iddiası ARTIK DOĞRULANIR.
      // Künyenin `refId`'si ya da etiketi, modele verilen bağlam metninde
      // geçmiyorsa uydurulmuş demektir → `verified: false` (Ö-21).
      if (citation.kind === "TIMELINE" || citation.kind === "DEADLINE") {
        const refId = citation.refId?.toLocaleLowerCase("tr-TR").trim();
        const label = citation.label?.toLocaleLowerCase("tr-TR").trim();
        const inContext =
          (refId !== undefined && refId.length >= 4 && normalizedContext.includes(refId)) ||
          (label !== undefined && label.length >= 6 && normalizedContext.includes(label));
        sources.push({ ...citation, verified: inContext });
        continue;
      }

      // CASELAW / STATUTE deterministik teyide tabidir; burada doğrulanmış sayılmaz.
      sources.push({ ...citation, verified: false });
    }

    return { sources, droppedCount };
  }
}
