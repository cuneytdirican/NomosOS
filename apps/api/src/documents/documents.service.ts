import { createHash, randomUUID } from "node:crypto";
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import type { DocumentClass, Prisma } from "@nomosos/db";
import { DOCUMENT_CLASSES } from "@nomosos/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { StorageService } from "../storage/storage.service";
import { PipelineService } from "../pipeline/pipeline.service";
import { DiskQuotaService } from "../disk-quota/disk-quota.service";
import { PipelineQueueService } from "../pipeline/pipeline-queue.service";
import { CLASS_SOURCE } from "../pipeline/pipeline.types";
import type { AuthUser } from "../common/types";
import { assertRole, ROLE_SETS } from "../common/roles";
import { normalizeQuery, paged, resolvePage } from "../common/pagination";
import { touchCase } from "../common/case-denormals";
import {
  MAX_UPLOAD_BYTES,
  validateUpload,
  type UpdateDocumentInput,
  type UploadDocumentInput,
} from "./documents.dto";

/** Arama sonucunda kaç belge için vurgulu bağlam üretilir (bellek sınırı). */
const SNIPPET_LIMIT = 10;

/** Liste uçlarında ASLA taşınmayan ağır alan: ocrText (yüz binlerce karakter). */
const DOCUMENT_LIST_SELECT = {
  id: true,
  name: true,
  class: true,
  classSource: true,
  mimeType: true,
  sizeBytes: true,
  pageCount: true,
  source: true,
  ocrStatus: true,
  chunkStatus: true,
  aiSummary: true,
  hash: true,
  caseId: true,
  uploadedBy: true,
  createdAt: true,
  updatedAt: true,
  case: { select: { id: true, title: true, fileNumber: true, courtName: true } },
} satisfies Prisma.DocumentSelect;

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly pipeline: PipelineService,
    // F2 · B1: asenkron kuyruk (Redis yoksa yumuşak düşüş yukarıda).
    private readonly pipelineQueue: PipelineQueueService,
    // DİSK KAPISI — yükleme öncesi kota kontrolü ve kullanım sayacı.
    private readonly diskQuota: DiskQuotaService
  ) {}

  /* ------------------------------------------------------------------ *
   * POST /documents — yükleme + hat tetikleme
   * ------------------------------------------------------------------ */

  async upload(user: AuthUser, file: Express.Multer.File | undefined, input: UploadDocumentInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "belge yükleme");

    if (!file || !file.buffer || file.size === 0) {
      throw new BadRequestException("Yüklenecek dosya bulunamadı (alan adı: file).");
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new PayloadTooLargeException(
        `Dosya boyutu ${(file.size / 1024 / 1024).toFixed(1)} MB; üst sınır 50 MB.`
      );
    }
    // DİSK KAPISI — kota dolmadan önce reddet; kayıtla birlikte sayaca işle.
    await this.diskQuota.assertCanStore(user.tenantId, file.size);

    const originalName = decodeUploadName(file.originalname);
    const validation = validateUpload(originalName, file.mimetype);
    if (validation) {
      throw new UnsupportedMediaTypeException(validation.message);
    }

    if (input.caseId) {
      await this.requireCase(user.tenantId, input.caseId);
    }

    const hash = createHash("sha256").update(file.buffer).digest("hex");

    // YİNELENEN YÜKLEME (Modül 06, iş kuralı 6): kopya uyarısı verilir, YENİ
    // KOŞUM AÇILMAZ.
    //
    // Kapsam bilinçli olarak asimetriktir:
    //  - Dosya SEÇİLEREK yükleniyorsa yalnızca O DOSYADAKİ kopya engellenir;
    //    aynı belge (ör. aynı vekaletname) başka bir dosyaya meşru olarak eklenebilir.
    //  - Dosya seçilmeden yükleniyorsa kiracıdaki HERHANGİ bir kopya yeter.
    //    (Belge hattı yüklemeden sonra caseId atadığı için, ilk nüshanın caseId'si
    //     null kalmaz; yalnızca `caseId: null` aranırsa kopya asla yakalanmazdı.)
    if (!input.allowDuplicate) {
      // İ-16: yumuşak silinmiş belge kopya sayılmaz — yeniden yükleme serbest.
      const existing = await this.prisma.client.document.findFirst({
        where: input.caseId
          ? { tenantId: user.tenantId, hash, caseId: input.caseId, deletedAt: null }
          : { tenantId: user.tenantId, hash, deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: DOCUMENT_LIST_SELECT,
      });
      if (existing) {
        return {
          duplicate: true,
          document: existing,
          pipeline: null,
          message:
            `Bu belge zaten yüklü: «${existing.name}» (${existing.createdAt.toISOString().slice(0, 10)}` +
            `${existing.case ? `, ${existing.case.fileNumber ?? existing.case.title} dosyası` : ""}). ` +
            "Yeni bir işleme koşumu başlatılmadı. Yine de yüklemek için allowDuplicate=true gönderin.",
        };
      }
    }

    const documentId = randomUUID();
    const storageKey = this.storage.buildObjectKey({
      tenantId: user.tenantId,
      caseId: input.caseId ?? null,
      documentId,
      fileName: originalName,
    });

    await this.storage.putObject(storageKey, file.buffer, file.mimetype);
    await this.diskQuota.recordUsage(user.tenantId, file.size);

    let document;
    try {
      document = await this.prisma.client.document.create({
        data: {
          id: documentId,
          tenantId: user.tenantId,
          caseId: input.caseId ?? null,
          name: input.name?.trim() || originalName,
          class: (input.class as DocumentClass | undefined) ?? "DIGER",
          classSource: input.class ? CLASS_SOURCE.MANUEL : null,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          storageKey,
          uploadedBy: user.userId,
          hash,
          source: input.source ?? "MANUEL",
          ocrStatus: "BEKLIYOR",
        },
        select: DOCUMENT_LIST_SELECT,
      });
    } catch (err) {
      // DB yazımı düşerse depoda yetim nesne bırakma.
      await this.storage.deleteObject(storageKey);
      throw err;
    }

    if (input.caseId) {
      await touchCase(this.prisma.client, input.caseId);
    }

    // ---- BELGE KOTASI SAYACI (Modül 26) --------------------------------
    //
    // `CreditWallet.documentUsed` hiçbir yerde artırılmıyordu: alan okunuyor,
    // dönem yenilemesinde sıfırlanıyor ama hiç işlenmiyordu. Belge hattı
    // (sınıflandırma / çıkarma / süre tespiti) bilinçli olarak ÜCRETSİZDİR ve
    // öyle kalmalıdır — belgeyi krediye bağlamak büroyu belge yüklemekten
    // caydırır ve ürünün değer döngüsünü öldürür. Ama o hattın TEK sınırı
    // belge kotasıydı ve o sınır bağlı değildi.
    //
    // SAYAÇ ENGELLEMEZ (iş kuralı 6, kabul kriteri 5): kota aşılsa bile
    // yükleme her koşulda çalışır. Aşım platform panelinde görünür ve bir
    // satış konuşması üretir; avukatın işini durdurmaz.
    //
    // Sayaç hatası yüklemeyi BOZMAZ: belge güvenle saklanmıştır.
    try {
      await this.prisma.client.creditWallet.updateMany({
        where: { tenantId: user.tenantId },
        data: { documentUsed: { increment: 1 } },
      });
    } catch (err) {
      this.logger.warn(
        `Belge kotası sayacı artırılamadı (${document.id}): ${(err as Error).message}`,
      );
    }

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "DOCUMENT_UPLOAD",
      entity: "Document",
      entityId: document.id,
      detail: `${document.name} (${file.mimetype}, ${file.size} bayt)`,
    });

    // OTOMATİK AKSİYON HATTI — F2 · B1'den itibaren ASYNKRON KUYRUKTA.
    // Kuyruk (Redis + BullMQ) ayakta değilse veya yazım düşerse SENKRON
    // düşülür: belge yükleme Redise SERT bağımlı hale gelmez. Hattın hatası
    // yüklemeyi BOZMAZ: belge güvenle saklanmıştır, koşum kaydından izlenir.
    let pipeline: { runId: string | null; status: string; proposalCount: number } | null = {
      runId: null,
      status: "BASARISIZ",
      proposalCount: 0,
    };
    try {
      const enqueued = await this.pipelineQueue.enqueue({
        tenantId: user.tenantId,
        userId: user.userId,
        documentId: document.id,
      });
      if (enqueued.queued) {
        pipeline = { runId: null, status: "KUYRUKTA", proposalCount: 0 };
      } else {
        pipeline = await this.pipeline.run({
          tenantId: user.tenantId,
          userId: user.userId,
          documentId: document.id,
        });
      }
    } catch (err) {
      this.logger.warn(`Belge hattı koşulamadı (${document.id}): ${(err as Error).message}`);
    }

    const refreshed = await this.prisma.client.document.findUnique({
      where: { id: document.id },
      select: DOCUMENT_LIST_SELECT,
    });

    // Yanıt şekli her iki dalda AYNIDIR (duplicate/document/pipeline/message);
    // istemci tek bir tipe göre yazılabilsin diye `message` burada da vardır.
    return { duplicate: false, document: refreshed ?? document, pipeline, message: null };
  }

  /* ------------------------------------------------------------------ *
   * GET /documents
   * ------------------------------------------------------------------ */

  async list(
    tenantId: string,
    params: {
      caseId?: string;
      class?: string;
      q?: string;
      source?: string;
      /** "true" → triyaj kuyruğu: dosyası bağlanmamış veya sınıfı düşük güvenli. */
      triage?: string;
      page?: string;
      limit?: string;
    }
  ) {
    // İ-16: yumuşak silinmiş belgeler listede görünmez.
    const where: Prisma.DocumentWhereInput = { tenantId, deletedAt: null };
    const pageParams = resolvePage(params);

    if (params.caseId) where.caseId = params.caseId;
    if (params.class) {
      if (!(DOCUMENT_CLASSES as readonly string[]).includes(params.class)) {
        throw new BadRequestException("Geçersiz belge sınıfı.");
      }
      where.class = params.class as DocumentClass;
    }
    if (params.source) where.source = params.source;
    if (params.triage === "true") {
      where.OR = [
        { caseId: null },
        { classSource: { startsWith: CLASS_SOURCE.AI_LOW } },
      ];
    }

    const q = normalizeQuery(params.q);
    if (q) {
      // Tam metin arama: belge adı + AI özeti + çıkarılmış metin.
      const search: Prisma.DocumentWhereInput[] = [
        { name: { contains: q, mode: "insensitive" } },
        { aiSummary: { contains: q, mode: "insensitive" } },
        { ocrText: { contains: q, mode: "insensitive" } },
      ];
      where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { OR: search }];
    }

    const [items, total] = await Promise.all([
      this.prisma.client.document.findMany({
        where,
        orderBy: { createdAt: "desc" },
        select: DOCUMENT_LIST_SELECT,
        skip: pageParams.skip,
        take: pageParams.take,
      }),
      this.prisma.client.document.count({ where }),
    ]);

    const result = paged(items, total, pageParams);
    if (q) {
      // Vurgulu snippet: eşleşmenin geçtiği bağlam (metin listede taşınmaz).
      const snippets = await this.buildSnippets(
        tenantId,
        items.map((i) => i.id),
        q
      );
      return { ...result, items: items.map((item) => ({ ...item, snippet: snippets.get(item.id) ?? null })) };
    }
    return result;
  }

  /**
   * Arama sonucunda gösterilecek kısa bağlam parçaları.
   *
   * SINIR: `ocrText` belge başına 200.000 karaktere kadar çıkar. Bir sayfadaki
   * 50 belgenin tam metnini ikinci kez Node'a taşımak istek başına ~10 MB
   * demekti; artık yalnızca ilk `SNIPPET_LIMIT` belge için üretilir.
   * (Kalıcı çözüm: `ts_headline` ile snippet'i DB'de üretmek — Faz 3.)
   */
  private async buildSnippets(
    tenantId: string,
    ids: string[],
    query: string
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (ids.length === 0) return map;
    const rows = await this.prisma.client.document.findMany({
      where: { tenantId, id: { in: ids.slice(0, SNIPPET_LIMIT) }, deletedAt: null },
      select: { id: true, ocrText: true },
    });
    const needle = query.toLocaleLowerCase("tr-TR");
    for (const row of rows) {
      if (!row.ocrText) continue;
      const index = row.ocrText.toLocaleLowerCase("tr-TR").indexOf(needle);
      if (index < 0) continue;
      const start = Math.max(0, index - 80);
      const end = Math.min(row.ocrText.length, index + needle.length + 80);
      map.set(row.id, `${start > 0 ? "…" : ""}${row.ocrText.slice(start, end).trim()}${end < row.ocrText.length ? "…" : ""}`);
    }
    return map;
  }

  /* ------------------------------------------------------------------ *
   * GET /documents/:id
   * ------------------------------------------------------------------ */

  async detail(tenantId: string, id: string) {
    // İ-16: yumuşak silinmiş belge 404 döner.
    const document = await this.prisma.client.document.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: {
        ...DOCUMENT_LIST_SELECT,
        pipelines: {
          orderBy: { startedAt: "desc" },
          take: 5,
          select: {
            id: true,
            status: true,
            startedAt: true,
            finishedAt: true,
            errorMessage: true,
            stepsJson: true,
          },
        },
        proposals: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            type: true,
            status: true,
            title: true,
            payloadJson: true,
            confidence: true,
            reasoning: true,
            sourceQuote: true,
            caseId: true,
            decidedBy: true,
            decidedAt: true,
            createdAt: true,
          },
        },
      },
    });
    if (!document) {
      throw new NotFoundException("Belge bulunamadı.");
    }

    const { pipelines, proposals, ...rest } = document;
    return {
      ...rest,
      /** Hattın son koşumu ve adım adım izi. */
      pipeline: pipelines.map((run) => ({
        ...run,
        steps: safeParse<unknown[]>(run.stepsJson) ?? [],
        stepsJson: undefined,
      })),
      proposals: proposals.map((p) => ({ ...p, payload: safeParse(p.payloadJson), payloadJson: undefined })),
      /** Onaylanıp gerçek kayda dönüşen öneri sayısı (izlenebilirlik). */
      appliedProposalCount: proposals.filter((p) => p.status === "UYGULANDI").length,
      pendingProposalCount: proposals.filter((p) => p.status === "BEKLIYOR").length,
    };
  }

  /* ------------------------------------------------------------------ *
   * GET /documents/:id/text
   * ------------------------------------------------------------------ */

  async text(tenantId: string, id: string) {
    const document = await this.prisma.client.document.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, name: true, ocrText: true, ocrStatus: true, pageCount: true },
    });
    if (!document) {
      throw new NotFoundException("Belge bulunamadı.");
    }
    return {
      id: document.id,
      name: document.name,
      ocrStatus: document.ocrStatus,
      pageCount: document.pageCount,
      text: document.ocrText,
      note:
        document.ocrText
          ? null
          : document.ocrStatus === "GEREKSIZ"
            ? "Bu biçim için metin çıkarma Faz 3 kapsamındadır; belge saklandı ancak metni okunmadı."
            : "Belgeden metin çıkarılamadı (taranmış görüntü olabilir). Metin UYDURULMAZ.",
    };
  }

  /* ------------------------------------------------------------------ *
   * GET /documents/:id/download — ön-imzalı URL + denetim kaydı
   * ------------------------------------------------------------------ */

  async download(user: AuthUser, id: string) {
    // TENANT SÜZGECİ: başka bir büronun storageKey'i bilinse bile bu sorgu
    // kaydı bulamaz → 404. İmzalı URL yalnızca kendi belgeniz için üretilir.
    // İ-16: yumuşak silinmiş belge indirilemez.
    const document = await this.prisma.client.document.findFirst({
      where: { id, tenantId: user.tenantId, deletedAt: null },
      select: { id: true, name: true, storageKey: true, mimeType: true, caseId: true },
    });
    if (!document) {
      throw new NotFoundException("Belge bulunamadı.");
    }

    const ttlSeconds = 300;
    const url = await this.storage.getPresignedDownloadUrl(document.storageKey, ttlSeconds, document.name);

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "DOCUMENT_DOWNLOAD",
      entity: "Document",
      entityId: document.id,
      detail: `${document.name} — imzalı bağlantı üretildi (${ttlSeconds} sn geçerli)`,
    });

    return { url, expiresIn: ttlSeconds, name: document.name, mimeType: document.mimeType };
  }

  /* ------------------------------------------------------------------ *
   * PATCH /documents/:id — insan düzeltmesi (AI'ı EZER)
   * ------------------------------------------------------------------ */

  async update(user: AuthUser, id: string, input: UpdateDocumentInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "belge düzenleme");
    const existing = await this.requireDocument(user.tenantId, id);

    if (input.caseId) {
      await this.requireCase(user.tenantId, input.caseId);
    }

    const data: Prisma.DocumentUncheckedUpdateInput = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.class !== undefined) {
      data.class = input.class as DocumentClass;
      // İNSAN DÜZELTMESİ AI'I EZER (Modül 06, kural 3): kaynak MANUEL olur,
      // böylece yeniden koşumda AI bu sınıfı geri alamaz.
      data.classSource = CLASS_SOURCE.MANUEL;
    }
    if (input.caseId !== undefined) data.caseId = input.caseId;

    const updated = await this.prisma.client.document.update({
      where: { id },
      data,
      select: DOCUMENT_LIST_SELECT,
    });

    if (input.caseId !== undefined) {
      // Belge parçaları ve bekleyen öneriler yeni dosyayı takip eder.
      // SAVUNMA DERİNLİĞİ: üst kayıt (Document) tenant süzgeciyle doğrulandı,
      // yine de her toplu yazma kendi tenantId koşulunu taşır — ileride bir
      // refactor üst doğrulamayı kaldırırsa yazma kiracı sınırını aşmasın.
      await this.prisma.client.documentChunk.updateMany({
        where: { documentId: id, tenantId: user.tenantId },
        data: { caseId: input.caseId },
      });
      await this.prisma.client.documentActionProposal.updateMany({
        where: { documentId: id, tenantId: user.tenantId, status: "BEKLIYOR" },
        data: { caseId: input.caseId },
      });
      if (input.caseId) await touchCase(this.prisma.client, input.caseId);
    }

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "DOCUMENT_UPDATE",
      entity: "Document",
      entityId: id,
      detail: `${existing.name} — güncellenen alanlar: ${Object.keys(input).join(", ")}`,
    });

    return updated;
  }

  /* ------------------------------------------------------------------ *
   * POST /documents/:id/reprocess — hattı yeniden oynat
   * ------------------------------------------------------------------ */

  async reprocess(user: AuthUser, id: string) {
    assertRole(user, ROLE_SETS.HUKUKI, "belge hattını yeniden çalıştırma");
    const existing = await this.requireDocument(user.tenantId, id);

    // F2 · B1: yeniden oynatma da kuyruğa girer; kuyruk kapalıysa senkron.
    const enqueued = await this.pipelineQueue.enqueue({
      tenantId: user.tenantId,
      userId: user.userId,
      documentId: id,
    });
    const pipeline = enqueued.queued
      ? { runId: null as string | null, status: "KUYRUKTA", proposalCount: 0 }
      : await this.pipeline.run({
          tenantId: user.tenantId,
          userId: user.userId,
          documentId: id,
        });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "DOCUMENT_PIPELINE_REPLAY",
      entity: "Document",
      entityId: id,
      detail: `${existing.name} — ${
        enqueued.queued ? `kuyruğa alındı (${enqueued.jobId ?? "-"})` : `koşum ${pipeline.runId ?? "-"} (${pipeline.status})`
      }`,
    });
    return pipeline;
  }

  /* ------------------------------------------------------------------ *
   * DELETE /documents/:id
   * ------------------------------------------------------------------ */

  async remove(user: AuthUser, id: string) {
    assertRole(user, ROLE_SETS.HUKUKI, "belge silme");
    // İ-16: zaten yumuşak silinmiş belge ikinci kez silinemez — 404.
    const existing = await this.prisma.client.document.findFirst({
      where: { id, tenantId: user.tenantId, deletedAt: null },
      select: {
        id: true,
        name: true,
        storageKey: true,
        caseId: true,
        _count: { select: { proposals: { where: { status: "UYGULANDI" } } } },
      },
    });
    if (!existing) {
      throw new NotFoundException("Belge bulunamadı.");
    }

    // KAYIT DOĞURMUŞ BELGE SİLİNEMEZ: onaylanıp Task/Deadline/safahat kaydına
    // dönüşmüş bir belgenin silinmesi, o kayıtların dayanağını yok eder.
    if (existing._count.proposals > 0) {
      throw new BadRequestException(
        `«${existing.name}» belgesi onaylanmış aksiyonlara (görev/süre/safahat) dayanak oluşturduğu için ` +
          "silinemez; denetim izi korunur."
      );
    }

    // İ-16: YUMUŞAK SİLME — fiziksel delete yok. S3 nesnesi korunur; satır
    // `deletedAt` ile gizlenir (hukuki geri dönüşüm + denetim izi).
    await this.prisma.client.document.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    if (existing.caseId) await touchCase(this.prisma.client, existing.caseId);
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "DOCUMENT_DELETE",
      entity: "Document",
      entityId: id,
      detail: `${existing.name} — yumuşak silme (S3 nesnesi korundu)`,
    });
    return { ok: true, id, softDeleted: true };
  }

  /* ------------------------------------------------------------------ *
   * Yardımcılar
   * ------------------------------------------------------------------ */

  private async requireDocument(tenantId: string, id: string) {
    const found = await this.prisma.client.document.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, name: true, caseId: true, storageKey: true },
    });
    if (!found) {
      throw new NotFoundException("Belge bulunamadı.");
    }
    return found;
  }

  private async requireCase(tenantId: string, caseId: string) {
    const found = await this.prisma.client.case.findFirst({
      where: { id: caseId, tenantId },
      select: { id: true, title: true, fileNumber: true },
    });
    if (!found) {
      throw new BadRequestException("Dosya bulunamadı.");
    }
    return found;
  }
}

function safeParse<T = unknown>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

/**
 * Multer, dosya adını latin1 olarak çözer; Türkçe karakterli adlar bozulur.
 * UTF-8'e geri çevirmek görünen adı düzeltir (depo anahtarı zaten ASCII'ye indirgenir).
 */
function decodeUploadName(name: string): string {
  try {
    return Buffer.from(name, "latin1").toString("utf8");
  } catch {
    return name;
  }
}
