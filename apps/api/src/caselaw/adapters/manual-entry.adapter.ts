/**
 * ManualEntryAdapter — avukatın elle girdiği kararlar.
 *
 * NEDEN VAR: Türkiye'de içtihat için açık ve kararlı bir resmî API bulunmadığı
 * için Faz 2'de havuzun tek GERÇEK doldurma yolu avukatın kendi bulduğu kararı
 * künyesiyle sisteme girmesidir. Bu adaptör o kaydı üretir ve arar; kaynağı
 * `MANUEL` olarak işaretlenir, böylece Teyit Ajanı'nın DOGRULANDI kararının
 * arkasında "bu künyeyi bir avukat elle doğrulayıp girdi" bilgisi durur.
 *
 * SAHTE ENTEGRASYON YOKTUR: burada Yargıtay/UYAP'a giden hiçbir HTTP çağrısı
 * yapılmaz. Adaptör yalnızca kendi yazdığı kayıtlarla çalışır.
 */

import { ConflictException, Injectable, UnprocessableEntityException } from "@nestjs/common";
import type { CaseLawDocument, Prisma } from "@nomosos/db";
import { scanPii, summarizeFindings } from "@nomosos/ai";
import { PrismaService } from "../../prisma/prisma.service";
import {
  courtMatchesSource,
  normalizeDocketNumber,
  scoreRecord,
  tokenizeQuery,
} from "./local-db.adapter";
import {
  isDemoRecord,
  tenantVisibility,
  type CaseLawAdapterHealth,
  type CaseLawCitationLookup,
  type CaseLawCitationQuery,
  type CaseLawFilters,
  type CaseLawHit,
  type CaseLawSourceAdapter,
} from "./types";

export const MANUAL_ADAPTER_KEY = "MANUEL";

/** Skorlamaya giren alanlar — `fullText` bilerek dışarıda (bellek). */
const SCORING_SELECT = {
  id: true,
  court: true,
  chamber: true,
  caseNumber: true,
  decisionNumber: true,
  decisionDate: true,
  summary: true,
  sourceUrl: true,
  sourceAdapter: true,
} as const;

const MANUAL_CANDIDATE_CAP = 50;

@Injectable()
export class ManualEntryCaseLawAdapter implements CaseLawSourceAdapter {
  readonly key = MANUAL_ADAPTER_KEY;
  readonly name = "Elle Girilen Kararlar";
  readonly canSearch = true;
  readonly canFetchByCitation = true;

  constructor(private readonly prisma: PrismaService) {}

  async search(query: string, filters: CaseLawFilters): Promise<CaseLawHit[]> {
    const terms = tokenizeQuery(query);
    if (terms.length === 0) return [];

    // [DÜZELTME] Eskiden yalnızca `sourceAdapter` süzgeciyle 200 kayıt TAM
    // METNİYLE çekilip skorlama JS'te yapılıyordu. Artık terim süzgeci DB'de
    // (pg_trgm GIN indeksli), `fullText` seçilmiyor ve kiracı görünürlüğü var.
    const and: Prisma.CaseLawDocumentWhereInput[] = [
      { sourceAdapter: this.key },
      tenantVisibility(filters.tenantId),
      {
        OR: terms.flatMap((term) => [
          { court: { contains: term, mode: "insensitive" as const } },
          { chamber: { contains: term, mode: "insensitive" as const } },
          { caseNumber: { contains: term, mode: "insensitive" as const } },
          { decisionNumber: { contains: term, mode: "insensitive" as const } },
          { summary: { contains: term, mode: "insensitive" as const } },
          { fullText: { contains: term, mode: "insensitive" as const } },
        ]),
      },
    ];
    if (filters.court) {
      and.push({ court: { contains: filters.court, mode: "insensitive" } });
    }
    if (filters.from || filters.to) {
      and.push({
        decisionDate: {
          ...(filters.from ? { gte: filters.from } : {}),
          ...(filters.to ? { lte: filters.to } : {}),
        },
      });
    }

    const records = await this.prisma.client.caseLawDocument.findMany({
      where: { AND: and },
      select: SCORING_SELECT,
      orderBy: [{ fetchedAt: "desc" }, { id: "asc" }],
      take: MANUAL_CANDIDATE_CAP,
    });

    return records
      .map((record) => {
        const { score, matchedTerms } = scoreRecord(record, terms, true);
        return {
          caseLawId: record.id,
          court: record.court,
          chamber: record.chamber ?? undefined,
          caseNumber: record.caseNumber,
          decisionNumber: record.decisionNumber,
          decisionDate: record.decisionDate ?? undefined,
          summary: record.summary ?? undefined,
          sourceUrl: record.sourceUrl ?? undefined,
          sourceAdapter: record.sourceAdapter,
          score,
          matchedTerms,
          isDemo: isDemoRecord(record),
        } satisfies CaseLawHit;
      })
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(filters.limit ?? 20, 50));
  }

  async fetchByCitation(query: CaseLawCitationQuery): Promise<CaseLawCitationLookup> {
    const caseNumber = normalizeDocketNumber(query.caseNumber);
    const decisionNumber = normalizeDocketNumber(query.decisionNumber);
    try {
      const matches = await this.prisma.client.caseLawDocument.findMany({
        // Teyit görünürlük süzgecine tabidir: başka büronun elle girdiği kayıt
        // bu büronun atfını doğrulamaz.
        where: {
          sourceAdapter: this.key,
          caseNumber,
          decisionNumber,
          ...tenantVisibility(query.tenantId),
        },
        orderBy: [{ createdByTenantId: "asc" }, { id: "asc" }],
        take: 5,
      });
      if (matches.length === 0) {
        return {
          outcome: "NOT_FOUND",
          note: "Elle girilmiş kayıtlar arasında bu künye yok.",
          adapterKey: this.key,
        };
      }
      const narrowed = query.source
        ? matches.filter((m) => courtMatchesSource(m.court, query.source!))
        : matches;
      const pool = narrowed.length > 0 ? narrowed : matches;
      return {
        outcome: "FOUND",
        record: pool[0],
        ambiguous: pool.length > 1,
        note:
          pool.length > 1
            ? `Elle girilmiş ${pool.length} kayıt aynı künyeyi taşıyor.`
            : `${pool[0].court} ${pool[0].caseNumber} E. ${pool[0].decisionNumber} K. (elle girildi)`,
        adapterKey: this.key,
      };
    } catch (err) {
      return {
        outcome: "SEARCH_FAILED",
        note: `Elle giriş havuzuna erişilemedi: ${(err as Error).message}`,
        adapterKey: this.key,
      };
    }
  }

  async healthCheck(): Promise<CaseLawAdapterHealth> {
    const base = {
      key: this.key,
      name: this.name,
      checkedAt: new Date(),
      canSearch: this.canSearch,
      canFetchByCitation: this.canFetchByCitation,
    };
    try {
      const count = await this.prisma.client.caseLawDocument.count({
        where: { sourceAdapter: this.key },
      });
      return { ...base, healthy: true, message: `${count} karar elle girilmiş.` };
    } catch (err) {
      return { ...base, healthy: false, message: `Veritabanına erişilemedi: ${(err as Error).message}` };
    }
  }

  /**
   * Elle karar kaydı oluşturur/günceller.
   *
   * (court, caseNumber, decisionNumber) benzersizdir (Modül 23, iş kuralı 7).
   *
   * [KRİTİK DÜZELTME — KİRACILAR ARASI YAZMA İZOLASYONU]
   * Eski davranışta upsert anahtarı yalnızca künyeydi: B kiracısı A kiracısının
   * girdiği kararla aynı künyeyi gönderdiğinde A'nın `fullText`/`summary`
   * alanını EZİYORDU. A'nın dosyasına KABUL ile bağlanmış o emsal
   * `approvedPrecedentsForCase` üzerinden dilekçe bağlamına aktığı için B,
   * A'nın dilekçesine giren emsal metnini kontrol edebiliyordu (içerik
   * zehirlenmesi). Ters yönde de avukatın elle girdiği serbest metin
   * `GET /caselaw/search` ile TÜM kiracılara açılıyordu.
   *
   * Artık kayıt SAHİPLİDİR: yalnızca `createdByTenantId` eşleşen kiracı (veya
   * sahipsiz bir sistem/seed kaydını ilk devralan) güncelleyebilir.
   */
  async upsertManualRecord(
    tenantId: string,
    input: {
      court: string;
      chamber?: string;
      caseNumber: string;
      decisionNumber: string;
      decisionDate?: Date;
      summary?: string;
      fullText?: string;
      sourceUrl?: string;
    },
  ): Promise<{ record: CaseLawDocument; created: boolean }> {
    const court = input.court.trim();
    const caseNumber = normalizeDocketNumber(input.caseNumber);
    const decisionNumber = normalizeDocketNumber(input.decisionNumber);

    // KVKK: havuz kayıtları paylaşılabilir metinlerdir. Avukat özet/tam metin
    // alanına kendi dosyasından kişisel veri yapıştırırsa giriş REDDEDİLİR.
    const scan = scanPii([input.summary ?? "", input.fullText ?? ""].join("\n"));
    if (scan.hasPii) {
      throw new UnprocessableEntityException({
        piiInSharedPool: true,
        findings: summarizeFindings(scan.findings),
        message:
          "Karar özeti/tam metni kişisel veri (TCKN/IBAN/telefon/e-posta) içeriyor. İçtihat " +
          "havuzu kayıtları paylaşılabilir metinlerdir; kişisel veriyi çıkarıp tekrar deneyin. " +
          "Dosyaya özel notunuzu emsal bağının `relevanceNote` alanına yazın.",
      });
    }

    const existing = await this.prisma.client.caseLawDocument.findUnique({
      where: { court_caseNumber_decisionNumber: { court, caseNumber, decisionNumber } },
    });

    if (existing) {
      if (existing.createdByTenantId && existing.createdByTenantId !== tenantId) {
        throw new ConflictException(
          `Bu künye (${court} ${caseNumber} E. ${decisionNumber} K.) havuzda başka bir büro ` +
            "tarafından kayıtlıdır ve üzerine yazılamaz. Kararı kendi dosyanıza bağlamak için " +
            "arama sonucundan seçin; içerik farklıysa künyeyi kontrol edin.",
        );
      }
      const record = await this.prisma.client.caseLawDocument.update({
        where: { id: existing.id },
        data: {
          chamber: input.chamber ?? existing.chamber,
          decisionDate: input.decisionDate ?? existing.decisionDate,
          summary: input.summary ?? existing.summary,
          fullText: input.fullText ?? existing.fullText,
          sourceUrl: input.sourceUrl ?? existing.sourceUrl,
          // Demo kaydın üzerine gerçek bir elle giriş yapıldıysa kaynak MANUEL'e döner
          // ve kayıt onu girene ait olur.
          sourceAdapter: this.key,
          createdByTenantId: tenantId,
          fetchedAt: new Date(),
        },
      });
      return { record, created: false };
    }

    const record = await this.prisma.client.caseLawDocument.create({
      data: {
        court,
        chamber: input.chamber,
        caseNumber,
        decisionNumber,
        decisionDate: input.decisionDate,
        summary: input.summary,
        fullText: input.fullText,
        sourceUrl: input.sourceUrl,
        sourceAdapter: this.key,
        createdByTenantId: tenantId,
      },
    });
    return { record, created: true };
  }
}
