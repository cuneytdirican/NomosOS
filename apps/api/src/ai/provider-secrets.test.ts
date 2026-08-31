/**
 * K-08 / K-09 REGRESYON TESTİ — AI sağlayıcı kimlik bilgilerinin şifrelenmesi
 * ve sağlayıcı uçlarının rol kapıları.
 *
 * K-08 (canlı): `headersJson` şifresiz gidiyordu ve `stripSecret` KARA LİSTE
 * olduğu için yanıta düşüyordu ("api-key: sk-…" ham görünüyordu).
 * K-09: sağlayıcı yazma uçlarında rol kapısı yoktu — stajyer/sekreter kendi
 * LLM sağlayıcısını tanımlayıp tüm AI trafiğini kendi ucuna çekebiliyordu.
 * Bu test iki düzeltmenin de geri alınmasını yakalar.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SERVICE = readFileSync(join(process.cwd(), "src", "ai", "ai.service.ts"), "utf-8");

describe("K-08: sağlayıcı kimlik bilgisi şifreli ve yanıta sızmıyor", () => {
  it("headersJson ŞİFRELENEREK yazılır (PLAIN JSON DEĞİL)", () => {
    expect(SERVICE).toContain(
      "headersJson: input.headers ? encryptSecret(JSON.stringify(input.headers)) : null",
    );
  });

  it("encryptedApiKey encryptSecret ile yazılır", () => {
    expect(SERVICE).toContain("encryptSecret(input.apiKey)");
  });

  it("yanıt beyaz listedir — şifreli sırlar ve headersJson döndürülmez", () => {
    // toPublicProvider çıktısı sır alanı İÇERMEZ.
    const fn = SERVICE.slice(SERVICE.indexOf("function toPublicProvider"), SERVICE.indexOf("safeJsonParse"));
    expect(fn).toContain("hasApiKey: Boolean(config.encryptedApiKey)");
    expect(fn).toContain("headerNames: headers ? Object.keys(headers) : []");
    expect(fn).not.toMatch(/encryptedApiKey:\s*config\.encryptedApiKey/);
    expect(fn).not.toMatch(/headersJson:\s*config\.headersJson/);
  });

  it("beyaz liste sabiti — sır alanları yalnız türetme için okunur", () => {
    const select = SERVICE.slice(
      SERVICE.indexOf("PROVIDER_PUBLIC_SELECT"),
      SERVICE.indexOf("type ProviderPublicRow"),
    );
    expect(select).toContain("encryptedApiKey: true");
    expect(select).toContain("headersJson: true");
    // Yorumu zorunlu kıl: alanın "döndürülmez" olduğu beyaz listede yazılıdır.
    expect(select).toContain("DÖNDÜRÜLMEZ");
  });
});

describe("K-09: sağlayıcı uçlarının TAMAMI rol kapısından geçer", () => {
  it("altı yazma/listeleme ucunun herbiri assertRole taşır", () => {
    // Bulgu, uç başına değil KATALOG olarak düzeltildi; her assertRole satırı
    // sayılır ve en az altı farklı yöntemde bulunmalıdır.
    const gated = SERVICE.match(/assertRole\(user, ROLE_SETS\.ONAY/g);
    expect(gated?.length ?? 0).toBeGreaterThanOrEqual(6);
  });

  it("kapı ONAY setiyle açılır (ADMIN/PARTNER) — büro yönetimi verisidir", () => {
    expect(SERVICE).toMatch(/assertRole\(user, ROLE_SETS\.ONAY, "AI sağlayıcı listesini görüntüleme"\)/);
    expect(SERVICE).toMatch(/assertRole\(user, ROLE_SETS\.ONAY, "AI sağlayıcı tanımlama"\)/);
  });

  it("liste uçta değil SERVİSTE kapatılır — controller bypass'ı yetmez", () => {
    // Kapı service katmanındadır; doğrudan servis çağrısı da kapıdan geçer.
    const listBody = SERVICE.slice(SERVICE.indexOf("async listProviders"), SERVICE.indexOf("async createProvider"));
    expect(listBody).toContain("assertRole(user, ROLE_SETS.ONAY");
  });
});
