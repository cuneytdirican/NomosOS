/**
 * RAPORLAMA ÇEKİRDEĞİ — rol kapısı, dönem çözümü, ölçüm ve DENETİM tek yerde.
 *
 * ╔════════════════════════════════════════════════════════════════════════╗
 * ║  HER ÇALIŞTIRMA `ReportRun`'A YAZILIR: kim, hangi rapor, hangi         ║
 * ║  filtreyle, kaç satır, hangi biçim, ne kadar sürdü.                    ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 *
 * `ReportRun` APPEND-ONLY'dir ve rapor ÇIKTISINI SAKLAMAZ — yalnız ölçüyü.
 * Bu bilinçli: bir raporun sonucu saklanırsa, kaynak veri değiştiğinde saklanan
 * kopya sessizce yanlışa döner ve iki farklı "gerçek" oluşur. Rapor her açılışta
 * yeniden hesaplanır (Hazırlık raporu, not 4).
 *
 * DENETİM YAZIMI RAPORU DÜŞÜRMEZ: `ReportRun` yazımı başarısız olursa uyarı
 * günlüğe düşer ve rapor yine döner (AuditService ile aynı sözleşme). Tersi,
 * denetim tablosundaki geçici bir sorunun avukatın işini durdurması olurdu.
 */

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { ReportFormat } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import type { AuthUser } from "../common/types";
import { ROLE_LABELS } from "../common/roles";
import { assertReportAccess } from "./report-access";
import { findReportDefinition, REPORT_DEFINITIONS, type ReportDefinition } from "./report-catalog";
import { resolveReportParams } from "./report-params";
import { REPORT_BUILDERS } from "./report-registry";
import type { ReportResult, ReportTable } from "./report-types";

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Kullanıcının YETKİLİ olduğu raporlar. Yetkisiz rapor listede GÖRÜNMEZ. */
  catalog(user: AuthUser) {
    const items = REPORT_DEFINITIONS.filter((def) => def.requiredRoles.includes(user.role)).map(
      (def) => ({
        key: def.key,
        name: def.name,
        description: def.description,
        requiredRoles: def.requiredRoles,
        params: def.params,
        supportsComparison: def.supportsComparison,
        containsMoney: def.containsMoney,
        defaultTable: def.defaultTable,
        notes: def.notes ?? [],
      }),
    );

    const hidden = REPORT_DEFINITIONS.filter((def) => !def.requiredRoles.includes(user.role)).map(
      (def) => def.name,
    );

    return {
      role: user.role,
      roleLabel: ROLE_LABELS[user.role],
      items,
      /**
       * Gizlenen raporların ADI döner, içeriği değil. Kullanıcının "böyle bir
       * rapor var ama bana kapalı" bilgisine erişmesi, ekranın eksik görünüp
       * destek çağrısı üretmesinden iyidir.
       */
      hiddenReports: hidden,
      deterministicNotice:
        "Rapor rakamlarının tamamı veritabanından deterministik olarak hesaplanır. " +
        "Yapay zekâ rakam üretmez; yalnız hazır rakamları yorumlayabilir.",
    };
  }

  /** Anahtarı (takma ad dâhil) çözer ve rol kapısını uygular. */
  private resolveDefinition(user: AuthUser, key: string): ReportDefinition {
    const def = findReportDefinition(key);
    if (!def) {
      throw new NotFoundException(
        `Tanımlı olmayan rapor: ${key}. Kullanılabilir raporlar için /reports/catalog ucuna bakın.`,
      );
    }
    assertReportAccess(user, def.requiredRoles, `"${def.name}" raporunu görüntüleme`);
    return def;
  }

  /**
   * Raporu çalıştırır.
   *
   * @param format Denetim kaydına yazılacak biçim. Rapor GÖVDESİ biçimden
   *   bağımsızdır — CSV, aynı sonucun dönüşümüdür; iki ayrı hesap yapılmaz.
   */
  async run(
    user: AuthUser,
    key: string,
    raw: Record<string, unknown>,
    format: ReportFormat = "EKRAN",
  ): Promise<ReportResult> {
    const def = this.resolveDefinition(user, key);
    const builder = REPORT_BUILDERS[def.key];
    if (!builder) {
      // Katalogda olup builder'ı olmayan rapor = dağıtım hatası; 404 değil 500.
      throw new Error(`Rapor builder'ı kayıtlı değil: ${def.key}`);
    }

    const now = new Date();
    const { params, warnings: paramWarnings } = resolveReportParams(raw, now, {
      supportsComparison: def.supportsComparison,
    });

    const startedAt = Date.now();
    const body = await builder({ user, prisma: this.prisma, params, now });
    const durationMs = Date.now() - startedAt;

    const rowCount = body.tables.reduce((sum, t) => sum + t.rows.length, 0);

    const result: ReportResult = {
      key: def.key,
      name: def.name,
      description: def.description,
      generatedAt: now,
      period: params.period,
      comparisonPeriod: params.comparison,
      // `pickTable` ile AYNI kaynak: ekranın gösterdiği tablo ile `?tablo=`
      // verilmeden inen CSV birbirinden ayrışmasın.
      defaultTable: def.defaultTable ?? body.tables[0]?.key,
      metrics: body.metrics ?? [],
      tables: body.tables,
      notes: [...(def.notes ?? []), ...(body.notes ?? [])],
      warnings: [...paramWarnings, ...(body.warnings ?? [])],
      hiddenSections: body.hiddenSections ?? [],
      rowCount,
      durationMs,
      deterministic: true,
      runByRole: user.role,
    };

    await this.recordRun(user, def.key, params.raw, result, format);
    return result;
  }

  /** Sonuçtan istenen tabloyu seçer; verilmezse raporun varsayılan tablosu. */
  pickTable(result: ReportResult, def: ReportDefinition, tableKey?: string): ReportTable {
    if (tableKey) {
      const found = result.tables.find((t) => t.key === tableKey);
      if (!found) {
        throw new NotFoundException(
          `"${result.name}" raporunda "${tableKey}" adlı tablo yok. ` +
            `Mevcut tablolar: ${result.tables.map((t) => t.key).join(", ")}.`,
        );
      }
      return found;
    }
    return (
      result.tables.find((t) => t.key === def.defaultTable) ??
      result.tables[0] ?? {
        key: "bos",
        title: "Veri yok",
        columns: [{ key: "bilgi", label: "Bilgi", type: "text" }],
        rows: [],
      }
    );
  }

  /** Denetim kaydı — APPEND-ONLY, sonuç saklamaz. */
  private async recordRun(
    user: AuthUser,
    reportKey: string,
    params: Record<string, unknown>,
    result: ReportResult,
    format: ReportFormat,
  ): Promise<void> {
    try {
      await this.prisma.client.reportRun.create({
        data: {
          tenantId: user.tenantId,
          reportKey,
          // Proje konvansiyonu: JSON alanları STRING olarak saklanır.
          paramsJson: JSON.stringify({
            ...params,
            _cozulmusDonem: {
              from: result.period.from.toISOString().slice(0, 10),
              to: result.period.to.toISOString().slice(0, 10),
              bitisDahil: result.period.endInclusive,
              onTanim: result.period.preset,
            },
          }),
          rowCount: result.rowCount,
          durationMs: result.durationMs,
          format,
          runBy: user.userId,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Rapor çalıştırma kaydı yazılamadı (${reportKey}): ${(err as Error).message}`,
      );
    }
  }

  /** Denetim geçmişi — kim neyi ne zaman çalıştırdı. */
  async runHistory(user: AuthUser, options: { reportKey?: string; limit: number }) {
    const rows = await this.prisma.client.reportRun.findMany({
      where: {
        tenantId: user.tenantId,
        ...(options.reportKey ? { reportKey: options.reportKey } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(200, Math.max(1, options.limit)),
    });
    return rows.map((r) => ({
      id: r.id,
      reportKey: r.reportKey,
      params: safeParse(r.paramsJson),
      rowCount: r.rowCount,
      durationMs: r.durationMs,
      format: r.format,
      runBy: r.runBy,
      createdAt: r.createdAt,
    }));
  }

  /** Rapor tanımına dışarıdan erişim (controller CSV tablosunu seçerken kullanır). */
  definitionOf(user: AuthUser, key: string): ReportDefinition {
    return this.resolveDefinition(user, key);
  }
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return { _ayrıştırılamadı: value };
  }
}
