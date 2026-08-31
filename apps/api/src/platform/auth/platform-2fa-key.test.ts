/**
 * K-01 REGRESYON TESTİ — panel 2FA kurulum anahtarı gidiş-dönüşü.
 *
 * Bulgu: kurulum token'ındaki `enc` alanı MASTER_ENCRYPTION_KEY ile
 * şifreleniyor ama `verify` bunu türetilmiş panel anahtarıyla çözmeye
 * çalışıyordu. Sonuç: kriptografik olarak DOĞRU üretilmiş TOTP kodu bile
 * 401 alıyor, üretimde (PLATFORM_REQUIRE_2FA=true) panel ERİŞİLEMEZ
 * kalıyordu. Bu test, kurulum→doğrulama zincirinin TEK anahtardan geçtiğini
 * kanıtlar; anahtarlar ayrışırsa kırmızıya döner.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "@nomosos/ai";
import { authenticator } from "otplib";
import { platform2faEncryptionKey } from "../platform.constants";

const ORIGINAL_MASTER = process.env.MASTER_ENCRYPTION_KEY;
const ORIGINAL_2FA_KEY = process.env.PLATFORM_2FA_ENCRYPTION_KEY;

afterEach(() => {
  if (ORIGINAL_MASTER === undefined) delete process.env.MASTER_ENCRYPTION_KEY;
  else process.env.MASTER_ENCRYPTION_KEY = ORIGINAL_MASTER;
  if (ORIGINAL_2FA_KEY === undefined) delete process.env.PLATFORM_2FA_ENCRYPTION_KEY;
  else process.env.PLATFORM_2FA_ENCRYPTION_KEY = ORIGINAL_2FA_KEY;
});

describe("K-01: kurulum ve doğrulama AYNI panel anahtarını kullanır", () => {
  it(
    "setup şifrelemesi → verify çözmesi gidiş-dönüşür; TOTP kodu geçerli kalır",
    () => {
      process.env.MASTER_ENCRYPTION_KEY = "a".repeat(64);
      delete process.env.PLATFORM_2FA_ENCRYPTION_KEY;

      const totpSecret = authenticator.generateSecret();
      // setup yolu (platform-auth.service.ts:328)
      const enc = encryptSecret(totpSecret, platform2faEncryptionKey());
      // verify yolu (decrypt → platform2faEncryptionKey)
      const resolved = decryptSecret(enc, platform2faEncryptionKey());

      expect(resolved).toBe(totpSecret);
      // Kod KENDİ KENDİNİ doğrulamalı — bulgunun canlı senaryosunun birebiri.
      const token = authenticator.generate(totpSecret);
      expect(authenticator.verify({ token, secret: resolved })).toBe(true);
    },
  );

  it("MASTER anahtar panel şifresini ÇÖZEMEZ — anahtarlar gerçekten farklıdır", () => {
    process.env.MASTER_ENCRYPTION_KEY = "b".repeat(64);
    delete process.env.PLATFORM_2FA_ENCRYPTION_KEY;

    const enc = encryptSecret("JBSWY3DPEHPK3PXP", platform2faEncryptionKey());
    expect(() => decryptSecret(enc, process.env.MASTER_ENCRYPTION_KEY!)).toThrow();
  });
});

describe("K-01: kaynak taahhüdü — servis anahtar ayrımını koruyor", () => {
  const SERVICE = readFileSync(
    join(process.cwd(), "src", "platform", "auth", "platform-auth.service.ts"),
    "utf-8",
  );

  it("kurulum token'ı panel anahtarıyla şifrelenir (çıplak encryptSecret DEĞİL)", () => {
    expect(SERVICE).toContain("encryptSecret(secret, platform2faEncryptionKey())");
  });

  it("kalıcılaştırma da panel anahtarıyla yazılır", () => {
    expect(SERVICE).toContain("twoFactorSecret: encryptSecret(secret, platform2faEncryptionKey())");
  });

  it("çözme yolu panel anahtarını kullanır; master bu dosyada şifrelemede YOK", () => {
    expect(SERVICE).toContain("decryptSecret(stored, platform2faEncryptionKey())");
    // Çıplak (tek argümanlı — anahtarsız) encryptSecret çağrısı K-01'in ta
    // kendisiydi. Yorum satırları ayıklanır (hatayı anlatan yorum metriği
    // yanlışlıkla paralamamalı).
    const codeOnly = SERVICE.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    expect(codeOnly).not.toMatch(/encryptSecret\([^,)]+\)/);
  });
});
