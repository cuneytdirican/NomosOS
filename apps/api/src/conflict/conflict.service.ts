/**
 * ÇIKAR ÇATIŞMASI TARAMASI (Modül 11) — DETERMİNİSTİK KATMAN.
 *
 * ÜRÜN İLKELERİ BU DOSYADA SOMUTLAŞIR:
 *
 *  1. ENGELLEME DEĞİL UYARI. Tarama sonucu CAKISMA olsa bile hiçbir müvekkil
 *     veya dosya kaydı teknik olarak engellenmez. Bu servis Client/Case
 *     tablolarına YAZMAZ, hiçbir kaydı kilitlemez. Kararı avukat verir ve
 *     kararın kendisi (gerekçesiyle) `ConflictCheck.decision` alanına düşer.
 *
 *  2. SONUÇ KURALDAN GELİR, AI'DAN DEĞİL. `result` (TEMIZ/DIKKAT/CAKISMA)
 *     yalnızca deterministik eşleşmelerin benzerlik skorlarından ve dosya
 *     durumundan hesaplanır. AI katmanı (conflict-ai.service.ts) sonucu
 *     TEMIZ'den DIKKAT'e çıkarabilir ama CAKISMA ilan EDEMEZ.
 *
 *  3. TENANT SÜZGECİ HER SORGUDA. `CaseParty` üzerinde `tenantId` YOKTUR;
 *     süzgeç `case: { tenantId }` üzerinden kurulur. Bu unutulursa tarama
 *     başka büroların taraf listesini okur — modülün en kritik hatası budur.
 *
 *  4. TARAMA O ANIN FOTOĞRAFIDIR. Kayıt yazıldıktan sonra değiştirilmez;
 *     aynı ad için yeni tarama YENİ kayıt açar (iş kuralı 9).
 */

import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { ConflictMatchType, ConflictResult } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { resolvePage, paged, normalizeQuery } from "../common/pagination";
import { assertRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";
import { ConflictInferenceService, type InferenceOutcome } from "./conflict-ai.service";
import type { DecideConflictInput, RunConflictCheckInput } from "./conflict.dto";
import { nameSimilarity, normalizeName, roundSimilarity } from "./name-normalize";

/* ------------------------------------------------------------------ *
 * EŞİKLER — tek kaynak. Panelde ve testlerde bu sabitler kullanılır.
 * ------------------------------------------------------------------ */

/** Bu skorun altındaki adaylar hiç listelenmez (gürültü). */
export const SIMILARITY_LISTED = 0.75;
/** Bu skor ve üstü doğrudan ÇAKIŞMA sayılır. */
export const SIMILARITY_CONFLICT = 0.9;

/**
 * Karşı taraf eşleşmesinin AÇIK dosyada yükseltilme eşiği.
 *
 * docs/moduller/11 iş kuralı 4: "OPPOSING_PARTY eşleşmesi derdest dosyada her
 * zaman RED; kapanmış dosyada YELLOW." Bu yükseltme DETERMİNİSTİKTİR: dosya
 * durumu tablodan okunur, tahmin edilmez.
 */
export const OPPOSING_ESCALATION_MIN = SIMILARITY_LISTED;

/** Kapanmış sayılan dosya durumları — karşı taraf yükseltmesi bunlarda YAPILMAZ. */
const CLOSED_CASE_STATUSES = new Set(["KAPANDI", "ARSIV", "KESINLESTI"]);

/** Karşı taraf sayılan taraf sıfatları (müvekkil bayrağı ayrıca kontrol edilir). */
const OPPOSING_ROLES = new Set([
  "DAVACI",
  "DAVALI",
  "ALACAKLI",
  "BORCLU",
  "SANIK",
  "MUSTEKI",
  "KATILAN",
  "MUDAHIL",
]);

/**
 * Tek taramada okunacak azami kayıt sayısı.
 *
 * Tarama tam tablo taramasıdır (benzerlik SQL'de değil bellekte hesaplanır);
 * sınır konmazsa çok dosyalı bir büroda tek istek belleği doldurur. Sınıra
 * takılan tarama SESSİZ KALMAZ: yanıtta `truncated` uyarısı döner, çünkü
 * eksik taranmış bir çatışma raporu, yapılmamış taramadan daha tehlikelidir.
 */
const SCAN_LIMIT = 5000;

interface Candidate {
  matchType: ConflictMatchType;
  entityType: string;
  entityId: string | null;
  matchedName: string;
  similarity: number;
  caseId: string | null;
  note: string | null;
  /**
   * AÇIK dosyadaki karşı taraf eşleşmesi — benzerlik CAKISMA eşiğinin altında
   * kalsa bile sonucu ÇAKIŞMA'ya yükseltir (docs/moduller/11, iş kuralı 4).
   *
   * AYRI BİR ALAN OLARAK TUTULUR, `note` metninden ÇIKARILMAZ: karar mantığını
   * insan-okur bir cümlenin içinde aramak, o cümle düzenlendiği anda kuralı
   * SESSİZCE devre dışı bırakırdı.
   */
  escalate?: boolean;
}

@Injectable()
export class ConflictService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly inference: ConflictInferenceService,
  ) {}

  // ================================================================== //
  // POST /conflict-check
  // ================================================================== //

  async run(user: AuthUser, input: RunConflictCheckInput) {
    // Tarama büronun TÜM müvekkil ve taraf adlarını gösterir; operasyon
    // rolleri (sekreter dâhil) ön tarama yapabilmelidir, stajyer yapamaz.
    assertRole(user, ROLE_SETS.OPERASYON, "çıkar çatışması taraması");

    const scan = await this.scanDeterministic(user.tenantId, input.query);

    // AI KATMANI — OPSİYONEL VE İKİNCİ SIRADA. Deterministik eşleşmeler
    // AI'ya sorulmadan kesinleşir; AI yalnız "gri bölge" adaylar üzerinde
    // nitel bir çıkarım ekler ve kesin sonuç üretmez.
    let inference: InferenceOutcome | null = null;
    if (input.useAi) {
      inference = await this.inference.infer(user, {
        query: input.query,
        context: input.context ?? null,
        greyZone: scan.greyZone,
        piiApproved: input.piiApproved,
      });
    }

    const hits: Candidate[] = [...scan.hits, ...(inference?.hits ?? [])];
    const result = resolveOverallResult(scan.hits, inference !== null && inference.hits.length > 0);

    const record = await this.prisma.client.conflictCheck.create({
      data: {
        tenantId: user.tenantId,
        query: input.query,
        context: input.context ?? null,
        result,
        hitCount: hits.length,
        createdBy: user.userId,
        hits: {
          create: hits.map((h) => ({
            matchType: h.matchType,
            entityType: h.entityType,
            entityId: h.entityId,
            matchedName: h.matchedName,
            similarity: h.similarity,
            // YÜKSELTME KARARI KAYDA GEÇER. Önce yalnız `note` cümlesine
            // gömülüyordu; kayıt geri okunduğunda benzerlik 0,78 olan bir açık
            // dosya karşı taraf eşleşmesi satır bazında DIKKAT görünüyor,
            // genel sonuç ise CAKISMA oluyordu — çakışmanın hangi satırdan
            // geldiği yapısal olarak kayboluyordu.
            escalated: h.escalate ?? false,
            caseId: h.caseId,
            note: h.note,
          })),
        },
      },
      include: { hits: true },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CONFLICT_CHECK_RUN",
      entity: "ConflictCheck",
      entityId: record.id,
      detail:
        `sorgu="${input.query}" sonuç=${result} bulgu=${hits.length} ` +
        `(deterministik=${scan.hits.length}, ai=${inference?.hits.length ?? 0})`,
    });

    return this.presentCheck(record, {
      deterministic: {
        normalizedQuery: normalizeName(input.query),
        thresholds: {
          listed: SIMILARITY_LISTED,
          conflict: SIMILARITY_CONFLICT,
          opposingEscalationMin: OPPOSING_ESCALATION_MIN,
        },
        scanned: scan.scanned,
        truncated: scan.truncated,
        escalations: scan.escalations,
        greyZoneCount: scan.greyZone.length,
      },
      ai: inference?.envelope ?? null,
      warnings: scan.truncated
        ? [
            `Tarama ${SCAN_LIMIT} kayıt sınırına takıldı; sonuç EKSİK olabilir. ` +
              "Müvekkil/taraf sayısı bu sınırın üzerindeyse tarama sistem yöneticisiyle " +
              "birlikte daraltılmalıdır.",
          ]
        : [],
    });
  }

  // ================================================================== //
  // Deterministik tarama
  // ================================================================== //

  /**
   * Kayıt taraması. HİÇBİR AŞAMADA LLM ÇAĞRILMAZ.
   *
   * Dört kaynak: aktif müvekkiller, pasif (eski) müvekkiller, dosya tarafları
   * (karşı taraf sıfatlı olanlar) ve dosyada geçen diğer adlar (tanık, ilgili).
   */
  private async scanDeterministic(tenantId: string, query: string) {
    const [clients, parties] = await Promise.all([
      this.prisma.client.client.findMany({
        where: { tenantId },
        select: { id: true, name: true, isActive: true, type: true },
        take: SCAN_LIMIT + 1,
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.client.caseParty.findMany({
        // TENANT SÜZGECİ: CaseParty'de tenantId yok; dosya üzerinden süzülür.
        where: { case: { tenantId } },
        select: {
          id: true,
          name: true,
          role: true,
          isClient: true,
          caseId: true,
          case: { select: { fileNumber: true, status: true, title: true } },
        },
        take: SCAN_LIMIT + 1,
        orderBy: { id: "asc" },
      }),
    ]);

    const truncated = clients.length > SCAN_LIMIT || parties.length > SCAN_LIMIT;
    const clientRows = clients.slice(0, SCAN_LIMIT);
    const partyRows = parties.slice(0, SCAN_LIMIT);

    const hits: Candidate[] = [];
    const greyZone: GreyZoneRow[] = [];
    const escalations: string[] = [];

    for (const client of clientRows) {
      const similarity = roundSimilarity(nameSimilarity(query, client.name));
      if (similarity < SIMILARITY_LISTED) {
        pushGrey(greyZone, similarity, {
          ref: `client-${client.id}`,
          label: `${client.name} · ${client.isActive ? "mevcut müvekkil" : "eski müvekkil"}`,
        });
        continue;
      }
      hits.push({
        matchType: client.isActive ? "MEVCUT_MUVEKKIL" : "ESKI_MUVEKKIL",
        entityType: "Client",
        entityId: client.id,
        matchedName: client.name,
        similarity,
        caseId: null,
        note: client.isActive
          ? "Büronun MEVCUT müvekkili."
          : "Büronun ESKİ müvekkili — sır saklama yükümlülüğü ayrıca değerlendirilmelidir.",
      });
    }

    for (const party of partyRows) {
      const similarity = roundSimilarity(nameSimilarity(query, party.name));
      const caseLabel = party.case.fileNumber ?? party.case.title;
      const isOpposing = !party.isClient && OPPOSING_ROLES.has(party.role);

      if (similarity < SIMILARITY_LISTED) {
        pushGrey(greyZone, similarity, {
          ref: `party-${party.id}`,
          label:
            `${party.name} · ${party.role}${party.isClient ? " (müvekkilimiz)" : ""} · ` +
            `dosya ${caseLabel} (${party.case.status})`,
        });
        continue;
      }

      const closed = CLOSED_CASE_STATUSES.has(party.case.status);
      const escalate = isOpposing && !closed && similarity >= OPPOSING_ESCALATION_MIN;
      if (escalate) {
        escalations.push(
          `party-${party.id}: AÇIK dosyada (${caseLabel}, durum ${party.case.status}) karşı taraf ` +
            `eşleşmesi, benzerlik ${similarity.toFixed(2)}. Sonuç ÇAKIŞMA'dır` +
            (similarity < SIMILARITY_CONFLICT
              ? ` — benzerlik ${SIMILARITY_CONFLICT} eşiğinin altında olsa da derdest dosyadaki ` +
                "karşı taraf eşleşmesi kural gereği yükseltilir."
              : "."),
        );
      }

      hits.push({
        matchType: isOpposing ? "KARSI_TARAF" : "DOSYADA_GECEN",
        entityType: "CaseParty",
        entityId: party.id,
        matchedName: party.name,
        similarity,
        caseId: party.caseId,
        escalate,
        note:
          `${party.role} · dosya ${caseLabel} · durum ${party.case.status}` +
          (party.isClient ? " · bu taraf BİZİM müvekkilimiz" : "") +
          (escalate ? " · AÇIK dosyada karşı taraf" : ""),
      });
    }

    hits.sort((a, b) => b.similarity - a.similarity);
    greyZone.sort((a, b) => b.similarity - a.similarity);

    return {
      hits,
      /** AI çıkarımına verilecek "gri bölge" — eşiğin altında ama tamamen alakasız değil. */
      greyZone: greyZone.slice(0, GREY_ZONE_LIMIT),
      escalations,
      truncated,
      scanned: { clients: clientRows.length, caseParties: partyRows.length },
    };
  }

  // ================================================================== //
  // Karar
  // ================================================================== //

  /** POST /conflict-check/:id/decide — kararı İNSAN verir, sistem kaydeder. */
  async decide(user: AuthUser, id: string, input: DecideConflictInput) {
    // Kabul kararı büro politikası kararıdır; yetki ONAY rollerindedir.
    assertRole(user, ROLE_SETS.ONAY, "çıkar çatışması kararı verme");

    const check = await this.prisma.client.conflictCheck.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true, decision: true, result: true, query: true },
    });
    if (!check) throw new NotFoundException("Çatışma taraması bulunamadı.");

    // Gerekçe zorunluluğu şemada da var; burada ikinci kapı olarak durur
    // (şema atlanabilecek bir yoldan çağrı gelirse kayıt yine gerekçesiz olmaz).
    const note = input.note.trim();
    if (note.length === 0) {
      throw new UnprocessableEntityException(
        "Karar gerekçesi zorunludur; gerekçesiz çatışma kararı kaydedilemez.",
      );
    }

    const updated = await this.prisma.client.conflictCheck.update({
      where: { id: check.id },
      data: { decision: input.decision, decisionNote: note, decidedBy: user.userId },
      include: { hits: true },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CONFLICT_CHECK_DECIDE",
      entity: "ConflictCheck",
      entityId: check.id,
      detail:
        `sonuç=${check.result} karar=${input.decision}` +
        (check.decision ? ` (önceki karar: ${check.decision})` : "") +
        ` gerekçe="${note.slice(0, 200)}"`,
    });

    return this.presentCheck(updated);
  }

  // ================================================================== //
  // Geçmiş
  // ================================================================== //

  /** GET /conflict-checks */
  async list(
    user: AuthUser,
    params: { result?: string; decision?: string; q?: string; page?: string; limit?: string },
  ) {
    assertRole(user, ROLE_SETS.OPERASYON, "çatışma tarama geçmişini görüntüleme");
    const page = resolvePage(params);
    const q = normalizeQuery(params.q);

    const where = {
      tenantId: user.tenantId,
      ...(params.result ? { result: params.result as ConflictResult } : {}),
      ...(params.decision
        ? params.decision === "KARARSIZ"
          ? { decision: null }
          : { decision: params.decision as "DEVAM" | "REDDEDILDI" | "BEKLEMEDE" }
        : {}),
      ...(q ? { query: { contains: q, mode: "insensitive" as const } } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.client.conflictCheck.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.take,
        select: {
          id: true,
          query: true,
          context: true,
          result: true,
          hitCount: true,
          decision: true,
          decisionNote: true,
          decidedBy: true,
          createdBy: true,
          createdAt: true,
        },
      }),
      this.prisma.client.conflictCheck.count({ where }),
    ]);

    return paged(
      items.map((c) => ({
        ...c,
        /** Karar verilmemiş CAKISMA/DIKKAT taraması, yeni dosya açılışında uyarı üretir. */
        awaitingDecision: c.decision === null && c.result !== "TEMIZ",
      })),
      total,
      page,
    );
  }

  /** GET /conflict-checks/:id */
  async detail(user: AuthUser, id: string) {
    assertRole(user, ROLE_SETS.OPERASYON, "çatışma taraması görüntüleme");
    const check = await this.prisma.client.conflictCheck.findFirst({
      where: { id, tenantId: user.tenantId },
      include: { hits: true },
    });
    if (!check) throw new NotFoundException("Çatışma taraması bulunamadı.");
    return this.presentCheck(check);
  }

  /**
   * Karar bekleyen çatışmalı taramalar — dosya/müvekkil açılışında gösterilecek
   * uyarı bandının kaynağı. ENGELLEME DEĞİLDİR: yalnızca listedir.
   */
  async pendingWarnings(user: AuthUser) {
    const items = await this.prisma.client.conflictCheck.findMany({
      where: { tenantId: user.tenantId, decision: null, result: { in: ["DIKKAT", "CAKISMA"] } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, query: true, result: true, hitCount: true, createdAt: true },
    });
    return {
      items,
      notice:
        "Bu taramalar karar bekliyor. Karar verilmemiş olması yeni müvekkil veya dosya " +
        "kaydını ENGELLEMEZ; uyarı niteliğindedir, karar avukatındır.",
    };
  }

  // ================================================================== //
  // Yanıt zarfı
  // ================================================================== //

  private presentCheck(
    check: {
      id: string;
      query: string;
      context: string | null;
      result: ConflictResult;
      hitCount: number;
      decision: string | null;
      decisionNote: string | null;
      decidedBy: string | null;
      createdBy: string;
      createdAt: Date;
      hits: {
        id: string;
        matchType: ConflictMatchType;
        entityType: string;
        entityId: string | null;
        matchedName: string;
        similarity: number;
        /** Açık dosyada karşı taraf → benzerlikten bağımsız ÇAKIŞMA. */
        escalated: boolean;
        caseId: string | null;
        note: string | null;
      }[];
    },
    extra: Record<string, unknown> = {},
  ) {
    return {
      id: check.id,
      query: check.query,
      context: check.context,
      result: check.result,
      resultLabel: RESULT_LABELS[check.result],
      hitCount: check.hitCount,
      decision: check.decision,
      decisionNote: check.decisionNote,
      decidedBy: check.decidedBy,
      createdBy: check.createdBy,
      createdAt: check.createdAt,
      awaitingDecision: check.decision === null && check.result !== "TEMIZ",
      hits: check.hits.map((h) => ({
        ...h,
        /** AI çıkarımı olan bulgular AÇIKÇA işaretlenir; kesin sonuç sayılmaz. */
        isAiInference: h.matchType === "BAGLI_SIRKET",
        /**
         * Satır bandı, GENEL SONUÇLA aynı mantıktan türer.
         *
         * Yükseltilmiş satır (açık dosyada karşı taraf) benzerlik eşiğinin
         * altında kalsa bile ÇAKIŞMA'dır — `resolveOverallResult` tam olarak
         * bunu yapar. Bandı yalnız benzerlikten türetmek, genel sonucu
         * CAKISMA'ya çıkaran satırın kendisini DIKKAT göstermek demekti.
         */
        band: h.escalated
          ? "CAKISMA"
          : h.similarity >= SIMILARITY_CONFLICT
            ? "CAKISMA"
            : h.similarity >= SIMILARITY_LISTED
              ? "DIKKAT"
              : "OLASI",
        bandSource: h.escalated
          ? "ACIK_DOSYADA_KARSI_TARAF"
          : ("BENZERLIK_ESIGI" as const),
      })),
      /** ENGELLEME YOKTUR — bu alan her yanıtta durur. */
      policy: {
        blocking: false,
        notice:
          "Çatışma taraması UYARI niteliğindedir; müvekkil kaydını veya dosya açılışını " +
          "teknik olarak engellemez. Avukatlık Kanunu ve TBB Meslek Kuralları çerçevesindeki " +
          "değerlendirme avukatın mesleki takdirindedir. Kararınızı gerekçesiyle kaydedin.",
        decisionRequiredRoles: ROLE_SETS.ONAY,
      },
      ...extra,
    };
  }
}

/* ------------------------------------------------------------------ *
 * Yardımcılar
 * ------------------------------------------------------------------ */

const RESULT_LABELS: Record<ConflictResult, string> = {
  TEMIZ: "Temiz — eşleşme yok",
  DIKKAT: "Dikkat — incelenmesi gereken benzerlik var",
  CAKISMA: "Çakışma — çıkar çatışması ihtimali yüksek",
};

/** AI'ya verilecek gri bölge alt sınırı; bunun altı gerçekten alakasızdır. */
const GREY_ZONE_MIN = 0.45;
const GREY_ZONE_LIMIT = 25;

export interface GreyZoneRow {
  ref: string;
  label: string;
  similarity: number;
}

function pushGrey(
  target: GreyZoneRow[],
  similarity: number,
  row: { ref: string; label: string },
): void {
  if (similarity < GREY_ZONE_MIN) return;
  target.push({ ...row, similarity: roundSimilarity(similarity) });
}

/**
 * NİHAİ SONUÇ — YALNIZ KURALDAN.
 *
 * `aiFoundSomething` en fazla TEMIZ → DIKKAT geçişi yaptırabilir. AI'ın
 * CAKISMA ilan etme yetkisi YOKTUR: çakışma iddiası, kayıt üzerinden
 * doğrulanabilir bir eşleşmeye dayanmak zorundadır.
 */
export function resolveOverallResult(
  deterministicHits: readonly Candidate[],
  aiFoundSomething: boolean,
): ConflictResult {
  let result: ConflictResult = "TEMIZ";

  for (const hit of deterministicHits) {
    if (hit.similarity >= SIMILARITY_CONFLICT) return "CAKISMA";
    // Açık dosyadaki karşı taraf eşleşmesi — tarama sırasında işaretlenir.
    if (hit.escalate) return "CAKISMA";
    if (hit.similarity >= SIMILARITY_LISTED) result = "DIKKAT";
  }

  if (result === "TEMIZ" && aiFoundSomething) return "DIKKAT";
  return result;
}
