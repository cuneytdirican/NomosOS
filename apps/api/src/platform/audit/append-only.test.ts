import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  APPEND_ONLY_TABLES,
  appendOnlyMigrationSql,
  PURGE_ESCAPE_HATCH_GUC,
} from "./append-only";

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ APPEND-ONLY GARANTİSİ — denetim bulgusu Ö-27 regresyonu                  ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Denetimde bulunan durum: "append-only" YALNIZCA bir kod yorumuydu. Şemada
 * kısıt, migration'larda trigger/rol/RLS yoktu; bir sonraki `deleteMany` satırı
 * garantiyi sessizce bitirebilirdi.
 *
 * Buradaki iki test o boşluğu iki yönden kapatır:
 *   1. KAYNAK TARAMASI — repoda `platformAuditLog` üzerinde hiçbir
 *      update/delete/upsert çağrısı YOKTUR ve tek yazma yolu
 *      `PlatformAuditService`tir. Yeni bir silme çağrısı eklendiği an kırılır.
 *   2. MIGRATION SQL — veritabanı seviyesindeki tetikleyicinin metni burada
 *      üretilir ve doğrulanır; uygulaması `packages/db` (B ajanı) alanındadır.
 */
const apiSrc = path.resolve(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

describe("PlatformAuditLog append-only (denetim bulgusu Ö-27)", () => {
  const files = sourceFiles(apiSrc);

  it("tarama gerçekten çalışıyor (dosya sayısı makul)", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("hiçbir yerde denetim kaydı GÜNCELLENMEZ veya SİLİNMEZ", () => {
    const forbidden = /platformAuditLog\s*\.\s*(update|updateMany|delete|deleteMany|upsert)\b/;
    const violations: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      if (forbidden.test(source)) violations.push(path.relative(apiSrc, file));
    }
    expect(
      violations,
      `Denetim izi append-only'dir; şu dosyalar onu değiştiriyor:\n${violations.join("\n")}`
    ).toEqual([]);
  });

  it("TEK YAZMA YOLU PlatformAuditService'tir", () => {
    const writers: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      if (/platformAuditLog\s*\.\s*create\b/.test(source)) {
        writers.push(path.relative(apiSrc, file).replace(/\\/g, "/"));
      }
    }
    expect(writers).toEqual(["platform/platform-audit.service.ts"]);
  });
});

describe("veritabanı seviyesindeki tetikleyici (B ajanına migration notu)", () => {
  it("UPDATE ve DELETE'i reddeden trigger üretir", () => {
    const sql = appendOnlyMigrationSql(["PlatformAuditLog"]);
    expect(sql).toContain("CREATE OR REPLACE FUNCTION nomosos_append_only()");
    expect(sql).toContain("BEFORE UPDATE OR DELETE ON \"PlatformAuditLog\"");
    expect(sql).toContain("RAISE EXCEPTION");
    // INSERT engellenmemelidir: tablo append-ONLY'dir, write-none değil.
    expect(sql).not.toContain("INSERT OR");
  });

  it("spec'in saydığı üç tabloyu birden kapsar", () => {
    // Modül 25 (PlatformAuditLog), Modül 17 KK5 (RiskScoreHistory),
    // Modül 26 (CreditTransaction) — hepsi aynı gerekçeyi paylaşır.
    expect(APPEND_ONLY_TABLES).toContain("PlatformAuditLog");
    expect(APPEND_ONLY_TABLES).toContain("RiskScoreHistory");
    expect(APPEND_ONLY_TABLES).toContain("CreditTransaction");

    const sql = appendOnlyMigrationSql();
    for (const table of APPEND_ONLY_TABLES) {
      expect(sql).toContain(`"${table}_append_only"`);
    }
  });

  it("tetikleyici yeniden çalıştırılabilir (idempotent migration)", () => {
    const sql = appendOnlyMigrationSql(["PlatformAuditLog"]);
    expect(sql).toContain('DROP TRIGGER IF EXISTS "PlatformAuditLog_append_only"');
  });
});

/**
 * ENTEGRASYON TURU — Ö-27 artık YALNIZCA "B ajanına not" değil, uygulanmış bir
 * migration. Aşağıdaki üç test, üretilen SQL ile diske yazılan migration'ın
 * AYRIŞMASINI yakalar ve imha kaçış deliğinin genişlemesini engeller.
 */
describe("Ö-27 migration diske uygulandı (entegrasyon)", () => {
  const migrationPath = path.resolve(
    process.cwd(),
    "../../packages/db/prisma/migrations/20260909090000_append_only_denetim_izi/migration.sql"
  );

  it("migration dosyası vardır ve üretilen SQL ile BİREBİR aynıdır", () => {
    expect(fs.existsSync(migrationPath), `beklenen dosya: ${migrationPath}`).toBe(true);
    const onDisk = fs.readFileSync(migrationPath, "utf8").replace(/\r\n/g, "\n");
    expect(onDisk).toBe(appendOnlyMigrationSql());
  });

  it("kaçış deliği YALNIZCA DELETE'i açar, UPDATE'i asla", () => {
    const sql = appendOnlyMigrationSql();
    // Koşul TG_OP = 'DELETE' ile bağlıdır: koşul gevşetilirse (ör. TG_OP
    // kontrolü silinirse) denetim kaydı imha oturumunda GÜNCELLENEBİLİR olurdu.
    expect(sql).toContain("IF TG_OP = 'DELETE'");
    expect(sql).toContain(`current_setting('${PURGE_ESCAPE_HATCH_GUC}', true)`);
    expect(sql).toContain("RETURN OLD;");
  });

  it("kaçış deliğini AÇAN tek yer veri imhası transaction'ıdır", () => {
    // `SET LOCAL "nomosos.purge"` başka bir kod yoluna sızarsa append-only
    // garantisi sessizce biter; kaynak taraması o anda kırılır.
    // (Metnin migration SQL'ini ÜRETEN dosyada geçmesi normaldir — orada
    // çalıştırılmaz, yazılır; bu yüzden `$executeRaw…` ile birlikte aranır.)
    const opener = /\$executeRaw\w*\(\s*`SET LOCAL/;
    const openers: string[] = [];
    for (const file of sourceFiles(apiSrc)) {
      if (opener.test(fs.readFileSync(file, "utf8"))) {
        openers.push(path.relative(apiSrc, file).replace(/\\/g, "/"));
      }
    }
    expect(openers).toEqual(["platform/approvals/platform-approval-executor.service.ts"]);
  });
});
