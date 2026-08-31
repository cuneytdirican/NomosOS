/**
 * Katalog ve rol matrisi testleri.
 *
 * Bu testler VERİTABANI GEREKTİRMEZ: katalog saf veridir ve rol kapısı saf
 * fonksiyondur. Görev tanımındaki madde 6 (rol kısıtları) burada satır satır
 * doğrulanır — kural bir yorum satırında değil, testte yaşar.
 */

import { describe, expect, it } from "vitest";
import type { UserRole } from "@nomosos/shared";
import {
  REPORT_DEFINITIONS,
  findReportDefinition,
  resolveReportKey,
} from "./report-catalog";
import { REPORT_BUILDERS } from "./report-registry";

const ALL_ROLES: UserRole[] = ["ADMIN", "PARTNER", "AVUKAT", "STAJYER", "SEKRETER"];

function rolesFor(key: string): UserRole[] {
  const def = findReportDefinition(key);
  if (!def) throw new Error(`Rapor bulunamadı: ${key}`);
  return [...def.requiredRoles];
}

describe("rapor kataloğu", () => {
  it("her tanımın bir builder'ı vardır (katalog ve kayıt ayrışmaz)", () => {
    for (const def of REPORT_DEFINITIONS) {
      expect(REPORT_BUILDERS[def.key], `builder eksik: ${def.key}`).toBeTypeOf("function");
    }
  });

  it("her builder katalogda tanımlıdır (yetim builder kalmaz)", () => {
    const keys = new Set(REPORT_DEFINITIONS.map((d) => d.key));
    for (const key of Object.keys(REPORT_BUILDERS)) {
      expect(keys.has(key), `katalogda yok: ${key}`).toBe(true);
    }
  });

  it("anahtarlar ve takma adlar benzersizdir", () => {
    const seen = new Set<string>();
    for (const def of REPORT_DEFINITIONS) {
      for (const k of [def.key, ...(def.aliases ?? [])]) {
        expect(seen.has(k), `çakışan anahtar: ${k}`).toBe(false);
        seen.add(k);
      }
    }
  });

  it("seed'in kullandığı 'buro-aylik-ozet' anahtarı kanonik anahtara çözülür", () => {
    // packages/db seed'i bu anahtarla kayıtlı rapor tohumluyor; çözülemezse
    // tohumlanan kayıt çalıştırılamazdı.
    expect(resolveReportKey("buro-aylik-ozet")).toBe("buro-ozet");
    expect(findReportDefinition("buro-aylik-ozet")?.key).toBe("buro-ozet");
  });

  it("bilinmeyen anahtar olduğu gibi döner ve tanım bulunmaz", () => {
    expect(resolveReportKey("olmayan-rapor")).toBe("olmayan-rapor");
    expect(findReportDefinition("olmayan-rapor")).toBeUndefined();
  });

  it("her raporda en az bir dönem parametresi ve tanım metni vardır", () => {
    for (const def of REPORT_DEFINITIONS) {
      expect(def.params.some((p) => p.type === "period"), def.key).toBe(true);
      expect(def.description.length, def.key).toBeGreaterThan(20);
      expect(def.defaultTable.length, def.key).toBeGreaterThan(0);
    }
  });
});

describe("rol kısıtları (görev tanımı madde 6)", () => {
  it("STAJYER finans içeren raporları göremez", () => {
    for (const key of ["tahsilat-yaslandirma", "karlilik", "ai-kullanim", "icra-tahsilat"]) {
      expect(rolesFor(key), key).not.toContain("STAJYER");
    }
  });

  it("SEKRETER kârlılık ve avukat iş yükü raporlarını göremez", () => {
    expect(rolesFor("karlilik")).not.toContain("SEKRETER");
    expect(rolesFor("avukat-is-yuku")).not.toContain("SEKRETER");
  });

  it("kârlılık yalnız yönetimindir", () => {
    expect(rolesFor("karlilik").sort()).toEqual(["ADMIN", "PARTNER"]);
  });

  it("PARTNER ve ADMIN her raporu görür", () => {
    for (const def of REPORT_DEFINITIONS) {
      expect(def.requiredRoles, def.key).toContain("PARTNER");
      expect(def.requiredRoles, def.key).toContain("ADMIN");
    }
  });

  it("rol kümeleri beyaz listedir — bilinmeyen rol hiçbir rapora giremez", () => {
    for (const def of REPORT_DEFINITIONS) {
      for (const role of def.requiredRoles) {
        expect(ALL_ROLES, `tanımsız rol: ${role}`).toContain(role);
      }
    }
  });

  it("para içeren her rapor en azından STAJYER'i dışlar", () => {
    for (const def of REPORT_DEFINITIONS.filter((d) => d.containsMoney)) {
      if (def.key === "buro-ozet") {
        // İSTİSNA VE GEREKÇESİ: büro özeti herkese açıktır, ama finans ÖLÇÜLERİ
        // rapor içinde ayrıca süzülür (canSeeMoney) ve gizlenen bölüm bildirilir.
        expect(def.requiredRoles).toContain("STAJYER");
        expect(def.notes?.join(" ")).toMatch(/Stajyer/i);
        continue;
      }
      expect(def.requiredRoles, def.key).not.toContain("STAJYER");
    }
  });
});
