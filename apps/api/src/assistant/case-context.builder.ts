import { Injectable, NotFoundException } from "@nestjs/common";
import { scanPii } from "@nomosos/ai";
import type { AiTaskType } from "@nomosos/shared";
import { buildCaseContext, type BuiltCaseContext, type CaseContextInput } from "@nomosos/legal-ai";
import { PrismaService } from "../prisma/prisma.service";

/** KVKK: bağlam metnine giren her serbest alan maskeleme hattından geçer. */
function mask(text: string | null | undefined): string {
  if (!text) return "";
  return scanPii(text).maskedText;
}

function iso(date: Date | null | undefined): string | undefined {
  return date ? date.toISOString().slice(0, 10) : undefined;
}

export interface CaseContextResult {
  built: BuiltCaseContext;
  /** Chunk/embedding hattı henüz koşmamış belgeler (cevaba uyarı olarak eklenir). */
  unindexedDocumentNames: string[];
  caseTitle: string;
  caseFileNumber: string | null;
}

/**
 * Dosya bağlamı kurucu (apps/api tarafı).
 *
 * `@nomosos/legal-ai`'nin `buildCaseContext`'i saf bir fonksiyondur; veri okumaz.
 * Bu sınıf Prisma'dan tenant süzgeçli okuma yapar, metinleri `scanPii` ile
 * maskeler ve `piiScanned: true` sözleşmesini yerine getirir. Veri minimizasyonu
 * (hangi bölümün bağlama gireceği) `TASK_CONTEXT_POLICY`'ye bırakılır — finans
 * verisi hiçbir asistan görevinin politikasında yoktur, dolayısıyla retrieval'a
 * bile girmez (Modül 24, iş kuralı 4).
 */
@Injectable()
export class CaseContextBuilder {
  constructor(private readonly prisma: PrismaService) {}

  async buildFor(
    tenantId: string,
    caseId: string,
    taskType: AiTaskType,
    tokenBudget: number,
  ): Promise<CaseContextResult> {
    const found = await this.prisma.client.case.findFirst({
      where: { id: caseId, tenantId },
      include: {
        client: { select: { name: true } },
        parties: { select: { role: true, name: true, isClient: true, lawyerName: true } },
        timelineEvents: { orderBy: { date: "desc" }, take: 25 },
        deadlines: {
          where: { status: { in: ["BEKLIYOR", "ONAYLANDI"] } },
          orderBy: { dueDate: "asc" },
          take: 15,
        },
        documents: {
          orderBy: { createdAt: "desc" },
          take: 40,
          select: {
            id: true,
            name: true,
            class: true,
            aiSummary: true,
            createdAt: true,
            chunkStatus: true,
            ocrText: true,
          },
        },
        hearings: {
          where: { status: { in: ["PLANLANDI", "ERTELENDI"] } },
          orderBy: { date: "asc" },
          take: 1,
        },
      },
    });
    if (!found) {
      throw new NotFoundException("Dosya bulunamadı.");
    }

    const unindexed = found.documents.filter(
      (d) => d.chunkStatus !== "TAMAM" && (d.ocrText ?? "").trim().length > 0,
    );

    const input: CaseContextInput = {
      piiScanned: true,
      case: {
        caseNumber: found.fileNumber ?? found.title,
        courtName: mask(found.courtName) || undefined,
        caseType: found.type,
        status: found.status,
        subject: mask(found.subject) || undefined,
        openedAt: iso(found.openedAt),
        clientLabel: mask(found.client.name) || undefined,
      },
      parties: found.parties.map((p) => ({
        role: p.role,
        name: mask(p.name),
        isClient: p.isClient,
        counselName: mask(p.lawyerName) || undefined,
      })),
      timeline: found.timelineEvents.map((e) => ({
        date: iso(e.date) ?? "",
        type: e.source ?? undefined,
        description: mask([e.title, e.detail].filter(Boolean).join(" — ")),
      })),
      deadlines: found.deadlines.map((d) => ({
        title: mask(d.title),
        dueDate: iso(d.dueDate) ?? "",
        status: d.status,
        ruleKey: d.ruleKey ?? undefined,
      })),
      documents: found.documents.map((d) => ({
        documentId: d.id,
        title: mask(d.name),
        documentClass: d.class,
        date: iso(d.createdAt),
        summary: mask(d.aiSummary) || "(özet yok)",
      })),
      evidenceGaps: unindexed.map(
        (d) => `${mask(d.name)} belgesi henüz indekslenmedi — içeriği bu cevapta kullanılamadı.`,
      ),
      hearing: found.hearings[0]
        ? {
            scheduledAt: found.hearings[0].date.toISOString(),
            courtName: mask(found.courtName) || undefined,
            type: found.hearings[0].type,
            purpose: mask(found.hearings[0].prepSummary) || undefined,
          }
        : undefined,
    };

    return {
      built: buildCaseContext(input, { taskType, tokenBudget }),
      unindexedDocumentNames: unindexed.map((d) => d.name),
      caseTitle: found.title,
      caseFileNumber: found.fileNumber,
    };
  }
}
