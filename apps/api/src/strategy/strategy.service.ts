/**
 * STRATEJİ MOTORU — kayıt yönetimi (Modül 15).
 *
 * BU SERVİS HİÇBİR LLM ÇAĞRISI YAPMAZ. AI koşusu `StrategyBuildService`
 * içindedir; buradaki her şey deterministiktir.
 *
 * ÜÇ TASARIM KARARI:
 *
 * 1. DOSYA BAŞINA TEK STRATEJİ. Şemada `@@unique([caseId])` yoktur (hazırlık
 *    raporu, madde 7), bu yüzden kural SERVİS KATMANINDA zorlanır: aynı dosyada
 *    ikinci strateji açma denemesi 409 döner.
 *
 * 2. VERSİYON DEĞİŞTİRİLEMEZ, DÜĞÜM TABLOSU ÇALIŞMA KOPYASIDIR.
 *    `StrategyVersion.treeJson` bir anlık görüntüdür ve asla güncellenmez;
 *    `StrategyNode` satırları avukatın üzerinde çalıştığı canlı ağaçtır.
 *    Avukat ağacı düzenledikten sonra "sürüm yayınla" der ve o anki ağaç yeni
 *    (n+1) sürüm olarak dondurulur. Böylece hem elle düzenleme mümkün olur hem
 *    de "o gün ne düşünmüştük" sorusunun cevabı kaybolmaz.
 *
 * 3. BAYATLAMA TESPİT EDİLİR, OTOMATİK YENİDEN ÜRETİM YOKTUR.
 *    Dosyaya güncel sürümden SONRA belge/karar/safahat düştüyse strateji
 *    `BAYAT` işaretlenir ve arayüz "yeniden üret" önerir. Otomatik koşu
 *    bilinçli olarak yoktur: maliyet BYO-LLM'de büroya yazılır ve avukatın
 *    görmediği bir strateji değişikliği kontrolü elinden alır.
 */

import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma, Strategy, StrategyNodeType } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { assertRole, ROLE_SETS } from "../common/roles";
import { paged, resolvePage } from "../common/pagination";
import type { AuthUser } from "../common/types";
import { STRATEGY_CHAIN } from "./strategy.chain";
import type {
  CreateNodeInput,
  CreateStrategyInput,
  PublishVersionInput,
  SetStatusInput,
  UpdateNodeInput,
} from "./strategy.dto";
import {
  buildNodeTree,
  fingerprintNodes,
  NODE_TYPE_LABELS,
  summarizeChain,
  treeToText,
} from "./strategy.serialize";

export const STRATEGY_STATUS_LABELS = {
  TASLAK: "Taslak",
  GUNCEL: "Güncel",
  BAYAT: "Bayat — dosyada yeni gelişme var",
} as const;

const ADVISORY =
  "Strateji ağacındaki AI kaynaklı düğümler ÖNERİDİR; hukuki değerlendirme ve nihai " +
  "sorumluluk avukata aittir. Düğümler serbestçe düzenlenebilir, silinebilir ve elle eklenebilir.";

@Injectable()
export class StrategyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ================================================================== //
  // Dosya bazlı erişim
  // ================================================================== //

  /** GET /cases/:caseId/strategy */
  async getForCase(user: AuthUser, caseId: string) {
    await this.assertCase(user.tenantId, caseId);
    const strategy = await this.prisma.client.strategy.findFirst({
      where: { tenantId: user.tenantId, caseId },
      orderBy: { createdAt: "desc" },
    });
    if (!strategy) {
      return {
        strategy: null,
        chain: STRATEGY_CHAIN.map((l) => ({
          link: l.key,
          order: l.order,
          label: l.label,
          nodeType: l.nodeType,
          nodeCount: 0,
        })),
        advisory: ADVISORY,
        message:
          "Bu dosyada henüz strateji yok. POST /cases/:caseId/strategy ile boş bir iskelet " +
          "oluşturup POST /strategy/:id/build ile AI taslağı üretebilirsiniz.",
      };
    }
    return this.detailById(user, strategy.id);
  }

  /** POST /cases/:caseId/strategy — boş iskelet. */
  async createForCase(user: AuthUser, caseId: string, input: CreateStrategyInput) {
    assertRole(user, ROLE_SETS.HUKUKI, "strateji oluşturma");
    const kase = await this.assertCase(user.tenantId, caseId);

    // (1) Dosya başına tek strateji — servis katmanında zorlanır.
    const existing = await this.prisma.client.strategy.findFirst({
      where: { tenantId: user.tenantId, caseId },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({
        message:
          "Bu dosyada zaten bir strateji var. Dosya başına tek strateji tutulur; mevcut " +
          "stratejiyi yeniden üretin veya düğümlerini düzenleyin.",
        strategyId: existing.id,
      });
    }

    const strategy = await this.prisma.client.strategy.create({
      data: {
        tenantId: user.tenantId,
        caseId,
        title: input.title?.trim() || `${kase.fileNumber ?? kase.title} — dava stratejisi`,
        status: "TASLAK",
        createdBy: user.userId,
      },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "STRATEGY_CREATE",
      entity: "Strategy",
      entityId: strategy.id,
      detail: `caseId=${caseId}`,
    });

    return this.detailById(user, strategy.id);
  }

  // ================================================================== //
  // Strateji detayı
  // ================================================================== //

  /** GET /strategy/:id */
  async detailById(user: AuthUser, id: string) {
    const strategy = await this.assertStrategy(user.tenantId, id);
    const staleness = await this.refreshStaleness(user.tenantId, strategy);

    const [nodes, versionCount, currentVersion] = await Promise.all([
      this.prisma.client.strategyNode.findMany({
        where: { tenantId: user.tenantId, strategyId: id },
        orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
      }),
      this.prisma.client.strategyVersion.count({ where: { strategyId: id } }),
      staleness.strategy.currentVersionId
        ? this.prisma.client.strategyVersion.findFirst({
            where: { id: staleness.strategy.currentVersionId, strategyId: id },
          })
        : Promise.resolve(null),
    ]);

    return {
      strategy: {
        id: staleness.strategy.id,
        caseId: staleness.strategy.caseId,
        title: staleness.strategy.title,
        status: staleness.strategy.status,
        statusLabel: STRATEGY_STATUS_LABELS[staleness.strategy.status],
        currentVersionId: staleness.strategy.currentVersionId,
        createdBy: staleness.strategy.createdBy,
        createdAt: staleness.strategy.createdAt,
        updatedAt: staleness.strategy.updatedAt,
        versionCount,
      },
      currentVersion: currentVersion
        ? {
            id: currentVersion.id,
            versionNo: currentVersion.versionNo,
            summary: currentVersion.summary,
            model: currentVersion.model,
            createdBy: currentVersion.createdBy,
            createdAt: currentVersion.createdAt,
            tree: safeParse(currentVersion.treeJson),
          }
        : null,
      /** Canlı çalışma kopyası — avukatın düzenlediği ağaç. */
      tree: buildNodeTree(nodes),
      chain: summarizeChain(nodes),
      /**
       * Yayınlanmamış elle değişiklik var mı? Zaman damgasıyla DEĞİL, içerik
       * parmak iziyle belirlenir (bkz. `fingerprintNodes`).
       */
      hasUnpublishedChanges: currentVersion
        ? fingerprintOf(currentVersion.treeJson) !== fingerprintNodes(nodes)
        : nodes.length > 0,
      staleness: staleness.report,
      advisory: ADVISORY,
    };
  }

  // ================================================================== //
  // Bayatlama
  // ================================================================== //

  /**
   * Güncel sürümden SONRA dosyaya düşen belge / karar / safahat var mı?
   *
   * Okuma anında çalışır (tembel tespit): pipeline veya UYAP hattına kanca
   * takmadan da doğru sonuç verir. Olay anında işaretlemek isteyen modüller
   * `markStaleForCase` çağırabilir.
   */
  private async refreshStaleness(tenantId: string, strategy: Strategy) {
    if (!strategy.currentVersionId) {
      return {
        strategy,
        report: {
          isStale: false,
          since: null as Date | null,
          reasons: [] as string[],
          note: "Henüz yayınlanmış bir sürüm yok; bayatlama kontrolü ilk sürümden sonra başlar.",
        },
      };
    }

    const version = await this.prisma.client.strategyVersion.findFirst({
      where: { id: strategy.currentVersionId, strategyId: strategy.id },
      select: { createdAt: true },
    });
    if (!version) {
      return { strategy, report: { isStale: false, since: null, reasons: [], note: null } };
    }

    const since = version.createdAt;
    const [docs, events, decisions] = await Promise.all([
      this.prisma.client.document.count({
        where: { tenantId, caseId: strategy.caseId, createdAt: { gt: since } },
      }),
      this.prisma.client.timelineEvent.count({
        where: { tenantId, caseId: strategy.caseId, createdAt: { gt: since } },
      }),
      this.prisma.client.caseDecision.count({
        where: { tenantId, caseId: strategy.caseId, createdAt: { gt: since } },
      }),
    ]);

    const reasons: string[] = [];
    if (docs > 0) reasons.push(`${docs} yeni belge`);
    if (events > 0) reasons.push(`${events} yeni safahat kaydı`);
    if (decisions > 0) reasons.push(`${decisions} yeni karar kaydı`);

    const isStale = reasons.length > 0;
    let current = strategy;
    if (isStale && strategy.status !== "BAYAT") {
      current = await this.prisma.client.strategy.update({
        where: { id: strategy.id },
        data: { status: "BAYAT" },
      });
    }

    return {
      strategy: current,
      report: {
        isStale,
        since,
        reasons,
        note: isStale
          ? `Güncel sürümden (${since.toISOString().slice(0, 10)}) sonra dosyaya ${reasons.join(", ")} ` +
            "eklendi. Strateji BAYAT işaretlendi. Yeniden üretim OTOMATİK DEĞİLDİR: " +
            "POST /strategy/:id/build ile siz başlatırsınız."
          : null,
      },
    };
  }

  /**
   * Dış modüller için olay kancası: dosyaya yeni belge/karar düştüğünde çağrılır.
   * Strateji yoksa sessizce hiçbir şey yapmaz.
   */
  async markStaleForCase(tenantId: string, caseId: string, reason: string): Promise<void> {
    const strategy = await this.prisma.client.strategy.findFirst({
      where: { tenantId, caseId, status: { in: ["TASLAK", "GUNCEL"] } },
      select: { id: true, currentVersionId: true },
    });
    if (!strategy || !strategy.currentVersionId) return;
    await this.prisma.client.strategy.update({
      where: { id: strategy.id },
      data: { status: "BAYAT" },
    });
    await this.audit.log({
      tenantId,
      action: "STRATEGY_STALE",
      entity: "Strategy",
      entityId: strategy.id,
      detail: reason,
    });
  }

  /** PATCH /strategy/:id/status */
  async setStatus(user: AuthUser, id: string, input: SetStatusInput) {
    assertRole(user, ROLE_SETS.HUKUKI, "strateji durumu değiştirme");
    const strategy = await this.assertStrategy(user.tenantId, id);

    if (input.status === "GUNCEL" && !strategy.currentVersionId) {
      throw new ConflictException(
        "Yayınlanmış bir sürüm olmadan strateji GÜNCEL yapılamaz. Önce AI taslağı üretin " +
          "(POST /strategy/:id/build) veya çalışma kopyasını sürüm olarak yayınlayın.",
      );
    }

    const updated = await this.prisma.client.strategy.update({
      where: { id },
      data: { status: input.status },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "STRATEGY_STATUS",
      entity: "Strategy",
      entityId: id,
      detail: `${strategy.status} → ${input.status}${input.reason ? ` · ${input.reason}` : ""}`,
    });
    return { id: updated.id, status: updated.status, statusLabel: STRATEGY_STATUS_LABELS[updated.status] };
  }

  // ================================================================== //
  // Sürümler
  // ================================================================== //

  /** GET /strategy/:id/versions */
  async listVersions(user: AuthUser, id: string, query: { page?: string; limit?: string }) {
    await this.assertStrategy(user.tenantId, id);
    const page = resolvePage(query, 25);
    const [rows, total] = await Promise.all([
      this.prisma.client.strategyVersion.findMany({
        where: { strategyId: id },
        orderBy: { versionNo: "desc" },
        skip: page.skip,
        take: page.take,
        select: {
          id: true,
          versionNo: true,
          summary: true,
          model: true,
          createdBy: true,
          createdAt: true,
        },
      }),
      this.prisma.client.strategyVersion.count({ where: { strategyId: id } }),
    ]);
    return {
      ...paged(rows, total, page),
      note: "Sürümler DEĞİŞTİRİLEMEZ ve silinemez; her yeniden üretim yeni bir sürümdür.",
    };
  }

  /** GET /strategy-versions/:id */
  async getVersion(user: AuthUser, versionId: string) {
    const version = await this.prisma.client.strategyVersion.findFirst({
      where: { id: versionId, strategy: { tenantId: user.tenantId } },
      include: { strategy: { select: { id: true, caseId: true, title: true, currentVersionId: true } } },
    });
    if (!version) throw new NotFoundException("Strateji sürümü bulunamadı.");
    return {
      id: version.id,
      strategyId: version.strategyId,
      caseId: version.strategy.caseId,
      strategyTitle: version.strategy.title,
      versionNo: version.versionNo,
      summary: version.summary,
      model: version.model,
      createdBy: version.createdBy,
      createdAt: version.createdAt,
      isCurrent: version.strategy.currentVersionId === version.id,
      tree: safeParse(version.treeJson),
      advisory: ADVISORY,
    };
  }

  /**
   * POST /strategy/:id/versions — çalışma kopyasını sürüm olarak dondur.
   *
   * Elle düzenlenmiş ağacın kaydını almanın tek yoludur; AI koşusu kendi
   * sürümünü `StrategyBuildService` içinde açar.
   */
  async publishVersion(user: AuthUser, id: string, input: PublishVersionInput) {
    assertRole(user, ROLE_SETS.HUKUKI, "strateji sürümü yayınlama");
    await this.assertStrategy(user.tenantId, id);

    const nodes = await this.prisma.client.strategyNode.findMany({
      where: { tenantId: user.tenantId, strategyId: id },
      orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
    });
    if (nodes.length === 0) {
      throw new ConflictException(
        "Boş bir strateji ağacı sürüm olarak yayınlanamaz. Önce düğüm ekleyin veya AI taslağı üretin.",
      );
    }

    const version = await this.createVersion(id, {
      treeJson: JSON.stringify({
        nodes: buildNodeTree(nodes),
        fingerprint: fingerprintNodes(nodes),
        generatedAt: new Date().toISOString(),
        source: "MANUEL",
      }),
      summary: input.summary?.trim() || "Çalışma kopyası elle yayınlandı.",
      model: null,
      createdBy: user.userId,
    });

    await this.prisma.client.strategy.update({
      where: { id },
      data: { currentVersionId: version.id, status: "GUNCEL" },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "STRATEGY_VERSION_PUBLISH",
      entity: "StrategyVersion",
      entityId: version.id,
      detail: `strategyId=${id} versionNo=${version.versionNo} kaynak=MANUEL`,
    });

    return { id: version.id, versionNo: version.versionNo, createdAt: version.createdAt };
  }

  /**
   * Yeni sürüm satırı — sıra numarası ATOMİK olarak belirlenir.
   *
   * `versionNo`, `@@unique([strategyId, versionNo])` altındadır; iki eşzamanlı
   * koşu aynı numarayı hesaplayabileceği için işlem serileştirilir ve çakışmada
   * numara yeniden alınır.
   */
  async createVersion(
    strategyId: string,
    data: { treeJson: string; summary: string | null; model: string | null; createdBy: string },
  ) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const last = await this.prisma.client.strategyVersion.findFirst({
        where: { strategyId },
        orderBy: { versionNo: "desc" },
        select: { versionNo: true },
      });
      const versionNo = (last?.versionNo ?? 0) + 1;
      try {
        return await this.prisma.client.strategyVersion.create({
          data: { strategyId, versionNo, ...data },
        });
      } catch (err) {
        if (isUniqueViolation(err)) continue;
        throw err;
      }
    }
    throw new ConflictException(
      "Strateji sürümü oluşturulamadı: eşzamanlı yayın çakışması. Lütfen tekrar deneyin.",
    );
  }

  // ================================================================== //
  // Düğüm düzenleme — SON SÖZ AVUKATINDIR
  // ================================================================== //

  /** POST /strategy/:id/nodes */
  async createNode(user: AuthUser, strategyId: string, input: CreateNodeInput) {
    assertRole(user, [...ROLE_SETS.HUKUKI, "STAJYER"], "strateji düğümü ekleme");
    await this.assertStrategy(user.tenantId, strategyId);
    const parentId = await this.resolveParent(user.tenantId, strategyId, input.parentId ?? null);

    const orderIndex =
      input.orderIndex ??
      (await this.prisma.client.strategyNode.count({
        where: { tenantId: user.tenantId, strategyId },
      }));

    const node = await this.prisma.client.strategyNode.create({
      data: {
        tenantId: user.tenantId,
        strategyId,
        parentId,
        nodeType: input.nodeType as StrategyNodeType,
        content: input.content.trim(),
        strength: input.strength ?? null,
        sourceRef: (input.sourceRef as string | null | undefined) ?? null,
        orderIndex,
      },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "STRATEGY_NODE_CREATE",
      entity: "StrategyNode",
      entityId: node.id,
      detail: `strategyId=${strategyId} tür=${node.nodeType}`,
    });
    return this.serializeNode(node);
  }

  /** PATCH /strategy/:id/nodes/:nodeId */
  async updateNode(user: AuthUser, strategyId: string, nodeId: string, input: UpdateNodeInput) {
    assertRole(user, [...ROLE_SETS.HUKUKI, "STAJYER"], "strateji düğümü düzenleme");
    await this.assertStrategy(user.tenantId, strategyId);
    const node = await this.prisma.client.strategyNode.findFirst({
      where: { id: nodeId, tenantId: user.tenantId, strategyId },
    });
    if (!node) throw new NotFoundException("Strateji düğümü bulunamadı.");

    const data: Prisma.StrategyNodeUpdateInput = {};
    if (input.nodeType !== undefined) data.nodeType = input.nodeType as StrategyNodeType;
    if (input.content !== undefined) data.content = input.content.trim();
    if (input.strength !== undefined) data.strength = input.strength ?? null;
    if (input.sourceRef !== undefined) data.sourceRef = (input.sourceRef as string | null) ?? null;
    if (input.orderIndex !== undefined) data.orderIndex = input.orderIndex;
    if (input.parentId !== undefined) {
      const parentId = await this.resolveParent(
        user.tenantId,
        strategyId,
        input.parentId ?? null,
        nodeId,
      );
      data.parent = parentId ? { connect: { id: parentId } } : { disconnect: true };
    }

    const updated = await this.prisma.client.strategyNode.update({ where: { id: nodeId }, data });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "STRATEGY_NODE_UPDATE",
      entity: "StrategyNode",
      entityId: nodeId,
      detail: `strategyId=${strategyId} alanlar=${Object.keys(input).join(",")}`,
    });
    return this.serializeNode(updated);
  }

  /**
   * DELETE /strategy/:id/nodes/:nodeId
   *
   * ALT AĞAÇ DA GİDER (`parentId` self-cascade). Silinen ağaç kaybolmaz:
   * güncel sürüm dondurulmuş `treeJson` içinde durur.
   */
  async deleteNode(user: AuthUser, strategyId: string, nodeId: string) {
    assertRole(user, ROLE_SETS.HUKUKI, "strateji düğümü silme");
    await this.assertStrategy(user.tenantId, strategyId);
    const node = await this.prisma.client.strategyNode.findFirst({
      where: { id: nodeId, tenantId: user.tenantId, strategyId },
      select: { id: true, nodeType: true },
    });
    if (!node) throw new NotFoundException("Strateji düğümü bulunamadı.");

    const descendants = await this.countDescendants(user.tenantId, strategyId, nodeId);
    await this.prisma.client.strategyNode.delete({ where: { id: nodeId } });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "STRATEGY_NODE_DELETE",
      entity: "StrategyNode",
      entityId: nodeId,
      detail: `strategyId=${strategyId} tür=${node.nodeType} altDüğüm=${descendants}`,
    });
    return {
      deleted: true,
      id: nodeId,
      deletedDescendants: descendants,
      note:
        descendants > 0
          ? `Bu düğümün altındaki ${descendants} düğüm de silindi. Silinen ağaç, güncel sürümün ` +
            "dondurulmuş kaydında (StrategyVersion) korunmaktadır."
          : "Silinen düğüm, güncel sürümün dondurulmuş kaydında korunmaktadır.",
    };
  }

  // ================================================================== //
  // Yardımcılar
  // ================================================================== //

  /** LLM bağlamı için ağaç özeti (StrategyBuildService ve risk motoru kullanır). */
  async strategySummaryText(tenantId: string, caseId: string): Promise<string | undefined> {
    const strategy = await this.prisma.client.strategy.findFirst({
      where: { tenantId, caseId },
      select: { id: true },
    });
    if (!strategy) return undefined;
    const nodes = await this.prisma.client.strategyNode.findMany({
      where: { tenantId, strategyId: strategy.id },
      orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
    });
    if (nodes.length === 0) return undefined;
    return treeToText(nodes);
  }

  async assertStrategy(tenantId: string, id: string): Promise<Strategy> {
    const strategy = await this.prisma.client.strategy.findFirst({ where: { id, tenantId } });
    // Tenant süzgeci NOT-FOUND ile kapatılır: id tahmin edilse bile varlık sızmaz.
    if (!strategy) throw new NotFoundException("Strateji bulunamadı.");
    return strategy;
  }

  private async assertCase(tenantId: string, caseId: string) {
    const kase = await this.prisma.client.case.findFirst({
      where: { id: caseId, tenantId },
      select: { id: true, title: true, fileNumber: true },
    });
    if (!kase) throw new NotFoundException("Dosya bulunamadı.");
    return kase;
  }

  /** Üst düğüm aynı stratejide mi ve döngü üretmiyor mu? */
  private async resolveParent(
    tenantId: string,
    strategyId: string,
    parentId: string | null,
    selfId?: string,
  ): Promise<string | null> {
    if (!parentId) return null;
    if (parentId === selfId) {
      throw new ConflictException("Bir düğüm kendi üstü olamaz.");
    }
    const parent = await this.prisma.client.strategyNode.findFirst({
      where: { id: parentId, tenantId, strategyId },
      select: { id: true },
    });
    if (!parent) {
      throw new NotFoundException("Üst düğüm bu stratejide bulunamadı.");
    }
    if (selfId) {
      // Döngü kontrolü: yeni üstün atalarında kendimiz var mıyız?
      const all = await this.prisma.client.strategyNode.findMany({
        where: { tenantId, strategyId },
        select: { id: true, parentId: true },
      });
      const byId = new Map(all.map((n) => [n.id, n.parentId]));
      let cursor: string | null | undefined = parentId;
      let guard = 0;
      while (cursor && guard < 1000) {
        if (cursor === selfId) {
          throw new ConflictException("Bu taşıma strateji ağacında döngü oluşturur.");
        }
        cursor = byId.get(cursor) ?? null;
        guard += 1;
      }
    }
    return parentId;
  }

  private async countDescendants(
    tenantId: string,
    strategyId: string,
    nodeId: string,
  ): Promise<number> {
    const all = await this.prisma.client.strategyNode.findMany({
      where: { tenantId, strategyId },
      select: { id: true, parentId: true },
    });
    const childrenOf = new Map<string, string[]>();
    for (const n of all) {
      if (!n.parentId) continue;
      childrenOf.set(n.parentId, [...(childrenOf.get(n.parentId) ?? []), n.id]);
    }
    let count = 0;
    const stack = [...(childrenOf.get(nodeId) ?? [])];
    while (stack.length > 0 && count < 10_000) {
      const current = stack.pop() as string;
      count += 1;
      stack.push(...(childrenOf.get(current) ?? []));
    }
    return count;
  }

  private serializeNode(node: {
    id: string;
    strategyId: string;
    parentId: string | null;
    nodeType: StrategyNodeType;
    content: string;
    strength: number | null;
    sourceRef: string | null;
    orderIndex: number;
    createdAt: Date;
  }) {
    return {
      id: node.id,
      strategyId: node.strategyId,
      parentId: node.parentId,
      nodeType: node.nodeType,
      nodeTypeLabel: NODE_TYPE_LABELS[node.nodeType],
      content: node.content,
      strength: node.strength,
      sourceRef: node.sourceRef,
      orderIndex: node.orderIndex,
      createdAt: node.createdAt,
    };
  }
}

/** Dondurulmuş sürümün içerik parmak izi (yoksa null → karşılaştırma "değişti" der). */
function fingerprintOf(treeJson: string): string | null {
  try {
    const parsed = JSON.parse(treeJson) as { fingerprint?: unknown };
    return typeof parsed.fingerprint === "string" ? parsed.fingerprint : null;
  } catch {
    return null;
  }
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return { parseError: "Sürüm ağacı okunamadı (bozuk JSON).", raw: json.slice(0, 500) };
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "P2002"
  );
}
