import { BadRequestException, Injectable, PayloadTooLargeException } from "@nestjs/common";
import { z } from "zod";
import {
  IMPORT_COLUMNS,
  IMPORT_KINDS,
  IMPORT_MAX_ROWS,
  IMPORT_MAX_ZIP_FILES,
  type ImportKind,
  type ImportPreviewResult,
  type ImportRowPreview,
  type ImportRunResult,
} from "@nomosos/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { DocumentsService } from "../documents/documents.service";
import { assertRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";
import { normalizeHeader, parseCsv, parseTrDate } from "./csv";

/**
 * FAZ 8E — veri göçü sihirbazı.
 *
 *  - `preview` (dry-run) hiçbir şey YAZMAZ; satır başına EKLE/ATLA/HATA planı döner.
 *  - `run` aynı planı uygular (ONAY rolü); satır bazlı hata diğerlerini düşürmez.
 *  - Dosya eşleme: esas no (birebir, boşluk/aksan bağımsız) → yoksa başlık.
 *  - Müvekkil eşleme: ad (aksan/büyük-küçük bağımsız); yoksa GERCEK_KISI olarak oluşturulur.
 *  - Duruşmalar doğrudan yazılır (HearingsService.create geçmiş tarihi reddeder — göçte geçmiş
 *    celseler meşrudur; geçmiş tarih + durum boş → YAPILDI).
 *  - Belgeler: ZIP + isteğe bağlı belgeler.csv; her dosya DocumentsService.upload hattından geçer
 *    (tür/boyut kapısı, kota, kopya kontrolü, otomatik aksiyon hattı).
 */

export const importCsvSchema = z.object({
  kind: z.enum(IMPORT_KINDS),
  csv: z.string().min(1).max(5_000_000),
});
export type ImportCsvInput = z.infer<typeof importCsvSchema>;

const CASE_TYPES = ["DAVA", "ICRA", "ARABULUCULUK", "CEZA", "DANISMANLIK"] as const;
const CASE_STATUSES = ["ACIK", "DERDEST", "KARAR", "ISTINAF", "TEMYIZ", "KESINLESTI", "ICRADA", "KAPANDI"] as const;
const HEARING_TYPES = ["DURUSMA", "ON_INCELEME", "KESIF", "E_DURUSMA", "MUZAKERE", "DIGER"] as const;
const HEARING_STATUSES = ["PLANLANDI", "YAPILDI", "ERTELENDI", "IPTAL"] as const;

export const MAX_ZIP_BYTES = 200 * 1024 * 1024;

function foldKey(s: string): string {
  return normalizeHeader(s);
}

/** Esas no anahtarı: "2025/1234", "2025-1234", "2025 / 1234" → "2025/1234". */
function fileNumberKey(s: string): string {
  return s.trim().replace(/\s+/g, "").replace(/[-_]/g, "/");
}

interface Plan<T> {
  preview: ImportPreviewResult;
  items: { row: number; data: T | null }[];
}

type CasePlanItem = {
  clientId: string | null;
  clientName: string;
  type: (typeof CASE_TYPES)[number];
  status: (typeof CASE_STATUSES)[number];
  title: string;
  courtName?: string;
  fileNumber?: string;
  subject?: string;
  responsibleUserId?: string;
};

type HearingPlanItem = {
  caseId: string;
  type: (typeof HEARING_TYPES)[number];
  status: (typeof HEARING_STATUSES)[number];
  date: Date;
  courtroom?: string;
  note?: string;
};

@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly documents: DocumentsService
  ) {}

  // ------------------------------------------------------------------ //
  // Ortak: başlık eşleme
  // ------------------------------------------------------------------ //

  private mapColumns(kind: ImportKind, normalizedHeaders: string[]) {
    const specs = IMPORT_COLUMNS[kind];
    const index = new Map<string, number>();
    const known = new Set<number>();
    for (const spec of specs) {
      const i = normalizedHeaders.findIndex((h) => spec.aliases.includes(h));
      if (i >= 0) {
        index.set(spec.key, i);
        known.add(i);
      }
    }
    const unknownHeaders = normalizedHeaders.filter((_, i) => !known.has(i)).filter(Boolean);
    const missingRequired = specs.filter((s) => s.required && !index.has(s.key)).map((s) => s.key);
    const get = (row: string[], key: string): string => {
      const i = index.get(key);
      return i === undefined ? "" : (row[i] ?? "").trim();
    };
    return { get, unknownHeaders, missingRequired };
  }

  private parse(kind: ImportKind, csv: string) {
    const parsed = parseCsv(csv);
    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      throw new BadRequestException("CSV en az bir başlık ve bir veri satırı içermelidir.");
    }
    if (parsed.rows.length > IMPORT_MAX_ROWS) {
      throw new BadRequestException(`Tek istekte en fazla ${IMPORT_MAX_ROWS} satır içe aktarılabilir.`);
    }
    const cols = this.mapColumns(kind, parsed.normalizedHeaders);
    return { parsed, cols };
  }

  private async caseIndex(tenantId: string) {
    const cases = await this.prisma.client.case.findMany({
      where: { tenantId },
      select: { id: true, title: true, fileNumber: true },
    });
    const byFileNo = new Map<string, string>();
    const byTitle = new Map<string, string>();
    for (const c of cases) {
      if (c.fileNumber) byFileNo.set(fileNumberKey(c.fileNumber), c.id);
      byTitle.set(foldKey(c.title), c.id);
    }
    return {
      resolve: (fileNumber: string, title: string): string | null => {
        if (fileNumber && byFileNo.has(fileNumberKey(fileNumber))) return byFileNo.get(fileNumberKey(fileNumber))!;
        if (title && byTitle.has(foldKey(title))) return byTitle.get(foldKey(title))!;
        return null;
      },
      byFileNo,
      byTitle,
    };
  }

  // ------------------------------------------------------------------ //
  // Dosyalar
  // ------------------------------------------------------------------ //

  private async planCases(user: AuthUser, csv: string): Promise<Plan<CasePlanItem>> {
    const { parsed, cols } = this.parse("dosyalar", csv);
    const [clients, users, cases] = await Promise.all([
      this.prisma.client.client.findMany({ where: { tenantId: user.tenantId }, select: { id: true, name: true } }),
      this.prisma.client.user.findMany({ where: { tenantId: user.tenantId, isActive: true }, select: { id: true, email: true } }),
      this.caseIndex(user.tenantId),
    ]);
    const clientByName = new Map(clients.map((c) => [foldKey(c.name), c.id]));
    const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));
    const seenFileNo = new Set<string>();

    const rows: ImportRowPreview[] = [];
    const items: { row: number; data: CasePlanItem | null }[] = [];
    parsed.rows.forEach((r, idx) => {
      const rowNo = idx + 2;
      const notes: string[] = [];
      const clientName = cols.get(r, "muvekkil");
      const title = cols.get(r, "baslik");
      const typeRaw = cols.get(r, "tur").toUpperCase() || "DAVA";
      const statusRaw = cols.get(r, "durum").toUpperCase() || "ACIK";
      const fileNumber = cols.get(r, "esas_no");
      const label = title || `(satır ${rowNo})`;
      if (cols.missingRequired.length > 0) {
        rows.push({ row: rowNo, action: "HATA", label, notes: [`Zorunlu kolon eksik: ${cols.missingRequired.join(", ")}`] });
        items.push({ row: rowNo, data: null });
        return;
      }
      if (!clientName) notes.push("müvekkil boş");
      if (title.length < 3) notes.push("başlık en az 3 karakter");
      if (!(CASE_TYPES as readonly string[]).includes(typeRaw)) notes.push(`geçersiz tür: ${typeRaw}`);
      if (!(CASE_STATUSES as readonly string[]).includes(statusRaw)) notes.push(`geçersiz durum: ${statusRaw}`);
      if (notes.length > 0) {
        rows.push({ row: rowNo, action: "HATA", label, notes });
        items.push({ row: rowNo, data: null });
        return;
      }
      // Mükerrer: aynı esas no zaten kayıtlı ya da bu CSV içinde tekrar → ATLA.
      if (fileNumber) {
        const key = fileNumberKey(fileNumber);
        if (cases.byFileNo.has(key)) {
          rows.push({ row: rowNo, action: "ATLA", label, notes: [`esas no ${fileNumber} zaten kayıtlı`] });
          items.push({ row: rowNo, data: null });
          return;
        }
        if (seenFileNo.has(key)) {
          rows.push({ row: rowNo, action: "ATLA", label, notes: [`esas no ${fileNumber} bu dosyada tekrar ediyor`] });
          items.push({ row: rowNo, data: null });
          return;
        }
        seenFileNo.add(key);
      } else if (cases.byTitle.has(foldKey(title))) {
        rows.push({ row: rowNo, action: "ATLA", label, notes: ["aynı başlıklı dosya zaten kayıtlı (esas no verilmedi)"] });
        items.push({ row: rowNo, data: null });
        return;
      }
      const clientId = clientByName.get(foldKey(clientName)) ?? null;
      if (!clientId) notes.push(`müvekkil "${clientName}" bulunamadı → gerçek kişi olarak oluşturulacak`);
      const respEmail = cols.get(r, "sorumlu_eposta").toLowerCase();
      const responsibleUserId = respEmail ? userByEmail.get(respEmail) : undefined;
      if (respEmail && !responsibleUserId) notes.push(`sorumlu ${respEmail} büroda bulunamadı (boş bırakılacak)`);
      items.push({
        row: rowNo,
        data: {
          clientId,
          clientName,
          type: typeRaw as CasePlanItem["type"],
          status: statusRaw as CasePlanItem["status"],
          title,
          courtName: cols.get(r, "mahkeme") || undefined,
          fileNumber: fileNumber || undefined,
          subject: cols.get(r, "konu") || undefined,
          responsibleUserId,
        },
      });
      rows.push({ row: rowNo, action: "EKLE", label, notes });
    });
    return { preview: this.summarize("dosyalar", parsed.delimiter, parsed.headers, cols, rows), items };
  }

  private async runCases(user: AuthUser, plan: Plan<CasePlanItem>): Promise<ImportRunResult> {
    let created = 0;
    let failed = 0;
    const createdClients = new Map<string, string>();
    for (const item of plan.items) {
      if (!item.data) continue;
      const row = plan.preview.rows.find((r) => r.row === item.row)!;
      try {
        let clientId = item.data.clientId ?? createdClients.get(foldKey(item.data.clientName)) ?? null;
        if (!clientId) {
          const c = await this.prisma.client.client.create({
            data: { tenantId: user.tenantId, type: "GERCEK_KISI", name: item.data.clientName },
            select: { id: true },
          });
          clientId = c.id;
          createdClients.set(foldKey(item.data.clientName), c.id);
        }
        await this.prisma.client.case.create({
          data: {
            tenantId: user.tenantId,
            clientId,
            type: item.data.type,
            status: item.data.status,
            title: item.data.title,
            courtName: item.data.courtName ?? null,
            fileNumber: item.data.fileNumber ?? null,
            subject: item.data.subject ?? null,
            responsibleUserId: item.data.responsibleUserId ?? null,
          },
        });
        created++;
      } catch (err) {
        failed++;
        row.action = "HATA";
        row.notes.push(err instanceof Error ? err.message : "bilinmeyen hata");
      }
    }
    return this.finish(user, plan.preview, created, failed);
  }

  // ------------------------------------------------------------------ //
  // Duruşmalar
  // ------------------------------------------------------------------ //

  private async planHearings(user: AuthUser, csv: string): Promise<Plan<HearingPlanItem>> {
    const { parsed, cols } = this.parse("durusmalar", csv);
    const cases = await this.caseIndex(user.tenantId);
    const now = Date.now();
    const rows: ImportRowPreview[] = [];
    const items: { row: number; data: HearingPlanItem | null }[] = [];
    parsed.rows.forEach((r, idx) => {
      const rowNo = idx + 2;
      const notes: string[] = [];
      const fileNumber = cols.get(r, "esas_no");
      const caseTitle = cols.get(r, "dosya_baslik");
      const dateRaw = cols.get(r, "tarih");
      const label = `${fileNumber || caseTitle || "?"} · ${dateRaw || "?"}`;
      if (cols.missingRequired.length > 0) {
        rows.push({ row: rowNo, action: "HATA", label, notes: [`Zorunlu kolon eksik: ${cols.missingRequired.join(", ")}`] });
        items.push({ row: rowNo, data: null });
        return;
      }
      const date = parseTrDate(dateRaw);
      if (!date) notes.push(`tarih okunamadı: "${dateRaw}"`);
      const caseId = cases.resolve(fileNumber, caseTitle);
      if (!caseId) notes.push(`dosya bulunamadı (esas no: "${fileNumber || "-"}", başlık: "${caseTitle || "-"}")`);
      const typeRaw = cols.get(r, "tur").toUpperCase() || "DURUSMA";
      if (!(HEARING_TYPES as readonly string[]).includes(typeRaw)) notes.push(`geçersiz tür: ${typeRaw}`);
      let statusRaw = cols.get(r, "durum").toUpperCase();
      if (statusRaw && !(HEARING_STATUSES as readonly string[]).includes(statusRaw)) notes.push(`geçersiz durum: ${statusRaw}`);
      if (notes.length > 0 || !date || !caseId) {
        rows.push({ row: rowNo, action: "HATA", label, notes });
        items.push({ row: rowNo, data: null });
        return;
      }
      if (!statusRaw) {
        statusRaw = date.getTime() < now ? "YAPILDI" : "PLANLANDI";
        if (statusRaw === "YAPILDI") notes.push("geçmiş tarih → YAPILDI");
      }
      items.push({
        row: rowNo,
        data: {
          caseId,
          type: typeRaw as HearingPlanItem["type"],
          status: statusRaw as HearingPlanItem["status"],
          date,
          courtroom: cols.get(r, "salon") || undefined,
          note: cols.get(r, "not") || undefined,
        },
      });
      rows.push({ row: rowNo, action: "EKLE", label, notes });
    });
    // Aynı dosya + aynı gün mevcut celse → ATLA (mükerrer kural, HearingsService ile aynı).
    const candidates = items.filter((i) => i.data).map((i) => i.data!);
    if (candidates.length > 0) {
      const minDate = new Date(Math.min(...candidates.map((c) => c.date.getTime())) - 86_400_000);
      const maxDate = new Date(Math.max(...candidates.map((c) => c.date.getTime())) + 86_400_000);
      const existing = await this.prisma.client.hearing.findMany({
        where: { tenantId: user.tenantId, date: { gte: minDate, lte: maxDate }, NOT: { status: "IPTAL" } },
        select: { caseId: true, date: true },
      });
      const key = (caseId: string, d: Date) => `${caseId}:${d.toISOString().slice(0, 10)}`;
      const existingKeys = new Set(existing.map((e) => key(e.caseId, e.date)));
      const seen = new Set<string>();
      for (const item of items) {
        if (!item.data) continue;
        const k = key(item.data.caseId, item.data.date);
        const row = rows.find((r) => r.row === item.row)!;
        if (existingKeys.has(k) || seen.has(k)) {
          row.action = "ATLA";
          row.notes.push("aynı dosyada aynı gün celse zaten var");
          item.data = null;
        } else {
          seen.add(k);
        }
      }
    }
    return { preview: this.summarize("durusmalar", parsed.delimiter, parsed.headers, cols, rows), items };
  }

  private async runHearings(user: AuthUser, plan: Plan<HearingPlanItem>): Promise<ImportRunResult> {
    let created = 0;
    let failed = 0;
    for (const item of plan.items) {
      if (!item.data) continue;
      const row = plan.preview.rows.find((r) => r.row === item.row)!;
      try {
        await this.prisma.client.hearing.create({
          data: {
            tenantId: user.tenantId,
            caseId: item.data.caseId,
            type: item.data.type,
            status: item.data.status,
            date: item.data.date,
            courtroom: item.data.courtroom ?? null,
            note: item.data.note ?? null,
          },
        });
        created++;
      } catch (err) {
        failed++;
        row.action = "HATA";
        row.notes.push(err instanceof Error ? err.message : "bilinmeyen hata");
      }
    }
    return this.finish(user, plan.preview, created, failed);
  }

  // ------------------------------------------------------------------ //
  // Belgeler (ZIP)
  // ------------------------------------------------------------------ //

  async importZip(user: AuthUser, file: Express.Multer.File | undefined, dryRun: boolean): Promise<ImportRunResult> {
    assertRole(user, ROLE_SETS.ONAY, "veri göçü");
    if (!file || !file.buffer || file.size === 0) throw new BadRequestException("ZIP dosyası bulunamadı (alan adı: file).");
    if (file.size > MAX_ZIP_BYTES) throw new PayloadTooLargeException("ZIP en fazla 200 MB olabilir.");
    const { default: JSZip } = await import("jszip");
    let zip: InstanceType<typeof JSZip>;
    try {
      zip = await JSZip.loadAsync(file.buffer);
    } catch {
      throw new BadRequestException("ZIP açılamadı; dosya bozuk ya da ZIP değil.");
    }
    const entries = Object.values(zip.files).filter((f) => !f.dir && !f.name.startsWith("__MACOSX/") && !/(^|\/)\.[^/]*$/.test(f.name));
    const manifestEntry = entries.find((e) => /(^|\/)(belgeler|manifest)\.csv$/i.test(e.name));
    const fileEntries = entries.filter((e) => e !== manifestEntry);
    if (fileEntries.length === 0) throw new BadRequestException("ZIP içinde belge yok.");
    if (fileEntries.length > IMPORT_MAX_ZIP_FILES) throw new BadRequestException(`ZIP'te en fazla ${IMPORT_MAX_ZIP_FILES} belge olabilir.`);

    // Manifest (isteğe bağlı): dosya_yolu → {esas_no, dosya_baslik, ad, sinif}
    const manifest = new Map<string, { esas_no: string; dosya_baslik: string; ad: string; sinif: string }>();
    let headers: string[] = [];
    let unknownHeaders: string[] = [];
    let delimiter = ";";
    if (manifestEntry) {
      const text = await manifestEntry.async("string");
      const parsed = parseCsv(text);
      const cols = this.mapColumns("belgeler", parsed.normalizedHeaders);
      headers = parsed.headers;
      unknownHeaders = cols.unknownHeaders;
      delimiter = parsed.delimiter;
      for (const r of parsed.rows) {
        const path = cols.get(r, "dosya_yolu").replace(/^\.?\//, "").replace(/\\/g, "/");
        if (path) manifest.set(path, { esas_no: cols.get(r, "esas_no"), dosya_baslik: cols.get(r, "dosya_baslik"), ad: cols.get(r, "ad"), sinif: cols.get(r, "sinif").toUpperCase() });
      }
    }
    const cases = await this.caseIndex(user.tenantId);
    const rows: ImportRowPreview[] = [];
    let created = 0;
    let failed = 0;
    let rowNo = 1;
    for (const entry of fileEntries) {
      rowNo++;
      const path = entry.name.replace(/\\/g, "/");
      const meta = manifest.get(path) ?? manifest.get(path.split("/").pop() ?? "");
      const folder = path.includes("/") ? path.split("/").slice(-2, -1)[0] ?? "" : "";
      const fileNumber = meta?.esas_no || (/^\d{4}[-/_ ]\d+$/.test(folder) ? folder : "");
      const caseTitle = meta?.dosya_baslik || (fileNumber ? "" : folder);
      const caseId = cases.resolve(fileNumber, caseTitle);
      const baseName = path.split("/").pop() ?? path;
      const label = meta?.ad || baseName;
      if (!caseId) {
        rows.push({ row: rowNo, action: "HATA", label: path, notes: [`dosya bulunamadı (esas no: "${fileNumber || "-"}", klasör/başlık: "${caseTitle || "-"}")`] });
        continue;
      }
      if (dryRun) {
        rows.push({ row: rowNo, action: "EKLE", label: path, notes: [`→ ${fileNumber || caseTitle}`] });
        continue;
      }
      try {
        const buffer = await entry.async("nodebuffer");
        const res = await this.documents.upload(
          user,
          { originalname: baseName, mimetype: guessMime(baseName), size: buffer.length, buffer } as Express.Multer.File,
          { caseId, name: label, source: "MANUEL", ...(meta?.sinif ? { class: meta.sinif as never } : {}) }
        );
        if ("duplicate" in res && res.duplicate) {
          rows.push({ row: rowNo, action: "ATLA", label: path, notes: ["aynı içerik bu dosyada zaten yüklü"] });
        } else {
          created++;
          rows.push({ row: rowNo, action: "EKLE", label: path, notes: [`→ ${fileNumber || caseTitle}`] });
        }
      } catch (err) {
        failed++;
        rows.push({ row: rowNo, action: "HATA", label: path, notes: [err instanceof Error ? err.message : "bilinmeyen hata"] });
      }
    }
    const preview: ImportPreviewResult = {
      kind: "belgeler",
      delimiter,
      headers,
      unknownHeaders,
      missingRequired: [],
      total: rows.length,
      ekle: rows.filter((r) => r.action === "EKLE").length,
      atla: rows.filter((r) => r.action === "ATLA").length,
      hata: rows.filter((r) => r.action === "HATA").length,
      rows,
    };
    if (dryRun) return { ...preview, created: 0, failed: 0 };
    return this.finish(user, preview, created, failed);
  }

  // ------------------------------------------------------------------ //
  // Giriş noktaları
  // ------------------------------------------------------------------ //

  async preview(user: AuthUser, input: ImportCsvInput): Promise<ImportPreviewResult> {
    assertRole(user, ROLE_SETS.ONAY, "veri göçü önizleme");
    if (input.kind === "dosyalar") return (await this.planCases(user, input.csv)).preview;
    if (input.kind === "durusmalar") return (await this.planHearings(user, input.csv)).preview;
    throw new BadRequestException("Belgeler için ZIP yükleyin (POST /import/zip).");
  }

  async run(user: AuthUser, input: ImportCsvInput): Promise<ImportRunResult> {
    assertRole(user, ROLE_SETS.ONAY, "veri göçü");
    if (input.kind === "dosyalar") return this.runCases(user, await this.planCases(user, input.csv));
    if (input.kind === "durusmalar") return this.runHearings(user, await this.planHearings(user, input.csv));
    throw new BadRequestException("Belgeler için ZIP yükleyin (POST /import/zip).");
  }

  private summarize(kind: ImportKind, delimiter: string, headers: string[], cols: { unknownHeaders: string[]; missingRequired: string[] }, rows: ImportRowPreview[]): ImportPreviewResult {
    return {
      kind,
      delimiter: delimiter === "\t" ? "TAB" : delimiter,
      headers,
      unknownHeaders: cols.unknownHeaders,
      missingRequired: cols.missingRequired,
      total: rows.length,
      ekle: rows.filter((r) => r.action === "EKLE").length,
      atla: rows.filter((r) => r.action === "ATLA").length,
      hata: rows.filter((r) => r.action === "HATA").length,
      rows,
    };
  }

  private async finish(user: AuthUser, preview: ImportPreviewResult, created: number, failed: number): Promise<ImportRunResult> {
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "DATA_IMPORT",
      entity: "Import",
      detail: `${preview.kind}: ${preview.total} satır · ${created} eklendi · ${preview.atla} atlandı · ${failed + preview.hata} hata`,
    });
    return {
      ...preview,
      ekle: created,
      hata: preview.rows.filter((r) => r.action === "HATA").length,
      atla: preview.rows.filter((r) => r.action === "ATLA").length,
      created,
      failed,
    };
  }
}

function guessMime(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    tif: "image/tiff",
    tiff: "image/tiff",
    txt: "text/plain",
    udf: "application/octet-stream",
  };
  return map[ext] ?? "application/octet-stream";
}
