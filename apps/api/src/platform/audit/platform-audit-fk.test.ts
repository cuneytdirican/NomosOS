/**
 * Ö-27 KALINTISI REGRESYON TESTİ — PlatformUser hard delete'inin yapısal
 * olarak imkânsız kılınması (üretim öncesi kapatıcı 2).
 *
 * SORUN: `PlatformAuditLog.platformUser` FK'sı (`onDelete: SetNull`),
 * PlatformUser hard delete'ini olanaklı kılıyordu. Hard delete denetim
 * satırlarında UPDATE koşar, Ö-27'nin append-only trigger'ı UPDATE'i
 * reddeder, silme KİLİTLENİRDİ. Güvence "repoda böyle bir çağrı yok"
 * gözlemine dayanıyordu — kaynak taraması bulgusu, yapısal garanti değil.
 *
 * ÇÖZÜM: FK kaldırıldı; `platformUserId` artık `tenantId` gibi FK'sız
 * nullable skaler kolon. Bu test, FK'nin geri gelmesini yakalar: schema'ya
 * relation yazılırsa VEYA migration silinirse kırmızıya döner.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** vitest apps/api içinde çalışır — iki üst dizin depo köküdür. */
const REPO_ROOT = join(process.cwd(), "..", "..");
const SCHEMA = readFileSync(join(REPO_ROOT, "packages", "db", "prisma", "schema.prisma"), "utf-8");
const MIGRATION = readFileSync(
  join(
    REPO_ROOT,
    "packages",
    "db",
    "prisma",
    "migrations",
    "20260910090000_platform_audit_fk_kaldirma",
    "migration.sql",
  ),
  "utf-8",
);

/** PlatformAuditLog model bloğunu çıkarır (model adı ile sonraki model arası). */
function modelBlock(schema: string, modelName: string): string {
  const start = schema.indexOf(`model ${modelName} {`);
  expect(start, `${modelName} modeli şemada bulunamadı`).toBeGreaterThan(0);
  const next = schema.indexOf("\nmodel ", start + 1);
  return schema.slice(start, next > start ? next : undefined);
}

describe("PlatformAuditLog — platformUser FK'si YOK (Ö-27 kalıntısı)", () => {
  const auditLog = modelBlock(SCHEMA, "PlatformAuditLog");

  it("platformUserId skaler nullable kolondur, relation taşımaz", () => {
    expect(auditLog).toMatch(/platformUserId\s+String\?/);
    expect(auditLog).not.toMatch(/platformUser\s+PlatformUser\?/);
    expect(auditLog).not.toContain("@relation(fields: [platformUserId]");
  });

  it("tenantId ile AYNI deseni izler: FK yok, iz kiracı/kullanıcı silinse ayakta", () => {
    // tenantId zaten FK'sız skaler; iki kolon aynı blokta bu deseni paylaşmalı.
    expect(auditLog).toMatch(/tenantId\s+String\?/);
  });

  it("PlatformUser tarafında auditLogs ilişkisi geri gelmedi", () => {
    const platformUser = modelBlock(SCHEMA, "PlatformUser");
    expect(platformUser).not.toMatch(/auditLogs\s+PlatformAuditLog\[\]/);
    // supportGrants GERÇEK bir ilişkidir (cascade silme meşrudur) — kalmalıdır.
    expect(platformUser).toMatch(/supportGrants\s+SupportAccessGrant\[\]/);
  });
});

describe("migration 20260910090000 — FK veritabanından düşürülüyor", () => {
  it("FK kısıtını DROP ediyor", () => {
    expect(MIGRATION).toMatch(/DROP CONSTRAINT "PlatformAuditLog_platformUserId_fkey"/);
  });

  it("migration çözümü geri alacak yeni FK tanımı İÇERMEZ", () => {
    expect(MIGRATION).not.toContain("ADD CONSTRAINT");
  });
});
