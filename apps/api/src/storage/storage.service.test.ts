/**
 * İ-15 SÖZLEŞME TESTİ — S3 gömülü geliştirme varsayılanları üretimde YASAK.
 *
 * Bulgu: StorageService kodda gömülü `nomosos/nomosos-gizli-123` kimlik
 * varsayınlarıyla açılıyordu; üretimde ortam değişkenleri unutulsa bile
 * uygulama "ayakta ama yanlış kovaya yazamıyor" durumunda sessizce açılırdı.
 *
 * Kapatıcı: NODE_ENV=production'da S3_ACCESS_KEY / S3_SECRET_KEY / S3_BUCKET
 * zorunludur; eksikse kurucu AÇILIŞTA düşer. Test tam bunu kilitler.
 */

import { afterEach, describe, expect, it } from "vitest";
import { StorageService } from "./storage.service";

const REQUIRED = ["S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET"] as const;
const ORIGINAL: Record<string, string | undefined> = {};

function saveEnv() {
  for (const key of [...REQUIRED, "NODE_ENV"]) ORIGINAL[key] = process.env[key];
}

function restoreEnv() {
  for (const key of Object.keys(ORIGINAL)) {
    if (ORIGINAL[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL[key];
  }
}

describe("İ-15: üretimde gömülü S3 varsayılanı yasak", () => {
  afterEach(restoreEnv);

  it("NODE_ENV=production + eksik kimlik → kurucu açılışta düşer", () => {
    saveEnv();
    process.env.NODE_ENV = "production";
    delete process.env.S3_ACCESS_KEY;
    process.env.S3_SECRET_KEY = "var";
    process.env.S3_BUCKET = "var";
    expect(() => new StorageService()).toThrow(/S3 yapılandırması eksik: S3_ACCESS_KEY/);
  });

  it("NODE_ENV=production + tüm kimlikler dolu → kurucu açılır", () => {
    saveEnv();
    process.env.NODE_ENV = "production";
    process.env.S3_ACCESS_KEY = "uretim-anahtar";
    process.env.S3_SECRET_KEY = "uretim-sir";
    process.env.S3_BUCKET = "uretim-kova";
    expect(() => new StorageService()).not.toThrow();
  });

  it("geliştirme ortamında varsayılanlar serbesttir (yerel MinIO)", () => {
    saveEnv();
    delete process.env.NODE_ENV;
    delete process.env.S3_ACCESS_KEY;
    delete process.env.S3_SECRET_KEY;
    delete process.env.S3_BUCKET;
    expect(() => new StorageService()).not.toThrow();
  });
});
