/**
 * KAYITLI RAPORLAR (`SavedReport`).
 *
 * ╔════════════════════════════════════════════════════════════════════════╗
 * ║  `scope = BURO` GÖRÜNÜRLÜKTÜR, YETKİ DEĞİLDİR.                         ║
 * ║  Bir ortağın büro kapsamına kaydettiği "Kârlılık" tanımı, Stajyer'in   ║
 * ║  listesinde GÖRÜNMEZ ve çalıştırılamaz: rol kapısı `report-access.ts`  ║
 * ║  matrisinden okunur ve kaydın kapsamı onu EZEMEZ.                      ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 *
 * KAYIT SONUÇ SAKLAMAZ: yalnız "hangi rapor + hangi filtre" bilgisidir.
 * `POST /reports/saved/:id/run` her seferinde rakamları yeniden hesaplar.
 *
 * `paramsJson` proje konvansiyonu gereği `Json` değil `String`'dir; yazarken
 * `JSON.stringify`, okurken `JSON.parse` yapılır ve ayrıştırılamayan bir kayıt
 * çalıştırmayı DÜŞÜRMEZ (boş parametreyle varsayılan döneme düşer, uyarı verilir).
 */

import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { ReportScope } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import type { AuthUser } from "../common/types";
import { canDeleteSavedReport } from "./report-access";
import { findReportDefinition } from "./report-catalog";
import { resolveReportParams } from "./report-params";
import { ReportsService } from "./reports.service";
import type { CreateSavedReportInput, UpdateSavedReportInput } from "./reports.dto";

@Injectable()
export class SavedReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
  ) {}

  /**
   * Kullanıcının görebileceği kayıtlı raporlar:
   *   (kendi KISISEL kayıtları) ∪ (büro kapsamındaki kayıtlar)
   * kesişim ROL KAPISI. Yetkisi olmayan rapora ait kayıt listeye girmez.
   */
  async list(user: AuthUser) {
    const rows = await this.prisma.client.savedReport.findMany({
      where: {
        tenantId: user.tenantId,
        OR: [{ scope: "BURO" }, { createdBy: user.userId }],
      },
      orderBy: [{ isPinned: "desc" }, { updatedAt: "desc" }],
    });

    const visible: ReturnType<typeof this.toDto>[] = [];
    const blocked: string[] = [];
    for (const row of rows) {
      const def = findReportDefinition(row.reportKey);
      if (!def) {
        // Katalogdan kaldırılmış anahtar — kayıt silinmez, "kullanılamaz" işaretlenir.
        visible.push(this.toDto(row, user, { unknownReport: true }));
        continue;
      }
      if (!def.requiredRoles.includes(user.role)) {
        blocked.push(row.name);
        continue;
      }
      visible.push(this.toDto(row, user, { definitionName: def.name, canonicalKey: def.key }));
    }

    return {
      items: visible,
      /** Rol nedeniyle listeden çıkarılan kayıtların ADI (içeriği değil). */
      hiddenByRole: blocked,
    };
  }

  async create(user: AuthUser, input: CreateSavedReportInput) {
    const def = findReportDefinition(input.reportKey);
    if (!def) {
      throw new NotFoundException(`Tanımlı olmayan rapor: ${input.reportKey}.`);
    }
    // Görüntüleyemediğin raporu kaydedemezsin.
    this.reports.definitionOf(user, input.reportKey);

    // Parametreler ŞİMDİ doğrulanır: bozuk filtre kaydedilip her açılışta
    // 400 üreten bir "kayıtlı rapor" bırakılmaz.
    resolveReportParams(input.params ?? {}, new Date(), {
      supportsComparison: def.supportsComparison,
    });

    const created = await this.prisma.client.savedReport.create({
      data: {
        tenantId: user.tenantId,
        name: input.name,
        // Takma adla gelen kayıt KANONİK anahtarla saklanır.
        reportKey: def.key,
        paramsJson: JSON.stringify(input.params ?? {}),
        scope: (input.scope ?? "KISISEL") as ReportScope,
        createdBy: user.userId,
        isPinned: input.isPinned ?? false,
      },
    });
    return this.toDto(created, user, { definitionName: def.name, canonicalKey: def.key });
  }

  async update(user: AuthUser, id: string, input: UpdateSavedReportInput) {
    const existing = await this.findOwned(user, id);
    if (!canDeleteSavedReport(user, existing.createdBy)) {
      throw new ForbiddenException(
        "Bu kayıtlı raporu yalnız oluşturan kullanıcı veya yönetim değiştirebilir.",
      );
    }

    const def = findReportDefinition(existing.reportKey);
    if (input.params !== undefined && def) {
      resolveReportParams(input.params, new Date(), {
        supportsComparison: def.supportsComparison,
      });
    }

    const updated = await this.prisma.client.savedReport.update({
      where: { id: existing.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.params !== undefined ? { paramsJson: JSON.stringify(input.params) } : {}),
        ...(input.scope !== undefined ? { scope: input.scope as ReportScope } : {}),
        ...(input.isPinned !== undefined ? { isPinned: input.isPinned } : {}),
      },
    });
    return this.toDto(updated, user, { definitionName: def?.name, canonicalKey: def?.key });
  }

  async remove(user: AuthUser, id: string) {
    const existing = await this.findOwned(user, id);
    if (!canDeleteSavedReport(user, existing.createdBy)) {
      throw new ForbiddenException(
        "Bu kayıtlı raporu yalnız oluşturan kullanıcı veya yönetim silebilir.",
      );
    }
    await this.prisma.client.savedReport.delete({ where: { id: existing.id } });
    return { id: existing.id, silindi: true };
  }

  /** Kayıtlı tanımı çalıştırır; istek parametreleri kayıtlı filtreyi EZER. */
  async run(user: AuthUser, id: string, overrides: Record<string, unknown> = {}) {
    const saved = await this.findOwned(user, id);
    const parsed = parseParams(saved.paramsJson);

    const result = await this.reports.run(
      user,
      saved.reportKey,
      { ...parsed.params, ...overrides },
      "EKRAN",
    );

    if (parsed.failed) {
      result.warnings = [
        ...(result.warnings ?? []),
        "Kayıtlı raporun filtre metni okunamadı; varsayılan dönem kullanıldı. " +
          "Filtreyi yeniden kaydetmeniz önerilir.",
      ];
    }

    return {
      savedReport: this.toDto(saved, user, {}),
      ...result,
    };
  }

  /**
   * Kaydı tenant + görünürlük süzgeciyle bulur.
   *
   * BAŞKASININ KİŞİSEL KAYDI 404 DÖNER, 403 DEĞİL: "bu kimlikte bir kayıt var
   * ama size kapalı" bilgisi, kayıt kimliklerini deneyerek başkalarının rapor
   * tanımlarını sayabilmeye kapı açardı.
   */
  private async findOwned(user: AuthUser, id: string) {
    const row = await this.prisma.client.savedReport.findFirst({
      where: {
        id,
        tenantId: user.tenantId,
        OR: [{ scope: "BURO" }, { createdBy: user.userId }],
      },
    });
    if (!row) throw new NotFoundException("Kayıtlı rapor bulunamadı.");
    // ROL KAPISI kapsamı EZER: BURO kapsamı yetki vermez.
    this.reports.definitionOf(user, row.reportKey);
    return row;
  }

  private toDto(
    row: {
      id: string;
      name: string;
      reportKey: string;
      paramsJson: string;
      scope: ReportScope;
      createdBy: string;
      isPinned: boolean;
      createdAt: Date;
      updatedAt: Date;
    },
    user: AuthUser,
    extra: { definitionName?: string; canonicalKey?: string; unknownReport?: boolean },
  ) {
    const parsed = parseParams(row.paramsJson);
    return {
      id: row.id,
      name: row.name,
      reportKey: extra.canonicalKey ?? row.reportKey,
      reportName: extra.definitionName ?? null,
      params: parsed.params,
      paramsReadable: !parsed.failed,
      scope: row.scope,
      createdBy: row.createdBy,
      isOwner: row.createdBy === user.userId,
      isPinned: row.isPinned,
      unknownReport: extra.unknownReport ?? false,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

function parseParams(json: string): { params: Record<string, unknown>; failed: boolean } {
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { params: parsed as Record<string, unknown>, failed: false };
    }
    return { params: {}, failed: true };
  } catch {
    return { params: {}, failed: true };
  }
}
