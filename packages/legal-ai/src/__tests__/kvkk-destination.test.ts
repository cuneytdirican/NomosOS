/**
 * KVKK DIŞSALLIK VE SSRF KAPISI TESTLERİ.
 *
 * Denetim bulgusu: `isExternalProvider` yalnızca TİPE bakıyordu
 * (ANTHROPIC/OPENAI_COMPAT/GEMINI). `CUSTOM` ve `OLLAMA` "büro içi" sayılıyordu,
 * oysa ikisinin de `baseUrl`'i kiracının serbestçe girdiği bir adrestir:
 * `type=CUSTOM, baseUrl=https://herhangi-bir-sunucu/` tanımlayan bir büro dosya
 * bağlamını ve taraf TCKN'lerini MASKESİZ, 409 onayı bile sorulmadan dışarı
 * gönderiyordu. Aynı yapı bir SSRF kapısıydı (169.254.169.254 metadata ucu).
 *
 * Bu testler, kararın artık ADRESE bakılarak verildiğini ve fail-closed
 * davrandığını sabitler.
 *
 * (Test @nomosos/ai'nin fonksiyonlarını doğrular; o paketin kendi vitest kurulumu
 * olmadığı için, ona zaten bağımlı olan legal-ai paketinde tutulur.)
 */

import { describe, expect, it } from "vitest";
import {
  isExternalDestination,
  isPrivateHost,
  partiallyMask,
  scanPii,
  summarizeFindings,
  validateProviderBaseUrl,
} from "@nomosos/ai";

describe("isPrivateHost", () => {
  it("loopback ve yerel adları büro içi sayar", () => {
    for (const host of ["localhost", "127.0.0.1", "127.5.5.5", "::1", "llm.local", "ai.internal"]) {
      expect(isPrivateHost(host)).toBe(true);
    }
  });

  it("RFC1918 özel aralıklarını büro içi sayar", () => {
    for (const host of ["10.0.0.5", "172.16.3.9", "172.31.255.1", "192.168.1.50"]) {
      expect(isPrivateHost(host)).toBe(true);
    }
  });

  it("172.32.x gibi ARALIK DIŞI adresleri özel saymaz", () => {
    expect(isPrivateHost("172.32.0.1")).toBe(false);
    expect(isPrivateHost("11.0.0.1")).toBe(false);
    expect(isPrivateHost("api.openai.com")).toBe(false);
  });
});

describe("isExternalDestination", () => {
  it("bulut sağlayıcıları daima dış sayar", () => {
    expect(isExternalDestination("ANTHROPIC")).toBe(true);
    expect(isExternalDestination("GEMINI")).toBe(true);
    expect(isExternalDestination("OPENAI_COMPAT")).toBe(true);
  });

  it("OLLAMA varsayılanı (localhost) büro içidir", () => {
    expect(isExternalDestination("OLLAMA")).toBe(false);
    expect(isExternalDestination("OLLAMA", "http://localhost:11434")).toBe(false);
    expect(isExternalDestination("OLLAMA", "http://192.168.1.20:11434")).toBe(false);
  });

  it("ASIL AÇIK: buluta yönlendirilmiş OLLAMA/CUSTOM dış sayılır", () => {
    // Eski `isExternalProvider` bu iki satırda da false döner ve maskesiz
    // TCKN/IBAN'ın dışarı çıkmasına izin verirdi.
    expect(isExternalDestination("OLLAMA", "https://ollama.baskabirsunucu.com")).toBe(true);
    expect(isExternalDestination("CUSTOM", "https://herhangi-bir-sunucu/v1/chat")).toBe(true);
  });

  it("büro-içi CUSTOM adresi iç sayılır", () => {
    expect(isExternalDestination("CUSTOM", "http://10.0.0.9:8080/chat")).toBe(false);
  });

  it("FAIL-CLOSED: çözülemeyen veya eksik adres DIŞ sayılır", () => {
    expect(isExternalDestination("CUSTOM", "bozuk-adres")).toBe(true);
    expect(isExternalDestination("CUSTOM", undefined)).toBe(true);
    expect(isExternalDestination("BILINMEYEN_TIP")).toBe(true);
  });
});

describe("validateProviderBaseUrl (SSRF kapısı)", () => {
  it("bulut metadata adresini reddeder", () => {
    const result = validateProviderBaseUrl("http://169.254.169.254/latest/meta-data/");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/metadata/i);
  });

  it("metadata.google.internal adını reddeder", () => {
    expect(validateProviderBaseUrl("http://metadata.google.internal/").ok).toBe(false);
  });

  it("http/https dışı şemaları reddeder", () => {
    expect(validateProviderBaseUrl("file:///etc/passwd").ok).toBe(false);
    expect(validateProviderBaseUrl("gopher://x/").ok).toBe(false);
  });

  it("geçerli adresleri ve boş değeri kabul eder", () => {
    expect(validateProviderBaseUrl("https://api.openai.com/v1").ok).toBe(true);
    expect(validateProviderBaseUrl("http://localhost:11434").ok).toBe(true);
    expect(validateProviderBaseUrl(undefined).ok).toBe(true);
  });

  it("geçersiz URL'yi anlaşılır bir mesajla reddeder", () => {
    const result = validateProviderBaseUrl("sadece-metin");
    expect(result.ok).toBe(false);
    expect(result.message).toBeTruthy();
  });
});

describe("409 gövdesi ham kişisel veri taşımaz", () => {
  it("partiallyMask değerin ortasını gizler", () => {
    expect(partiallyMask("10000000146")).toBe("100******46");
    expect(partiallyMask("abcd")).toBe("*ab*".replace(/./g, "*"));
  });

  it("summarizeFindings tür + kısmi maske + adet döner, HAM DEĞER DÖNMEZ", () => {
    // Geçerli bir TCKN algoritmasıyla üretilmiş örnek.
    const scan = scanPii("Müvekkil 10000000146 numaralı kişi, iletişim: av@ornek.com");
    expect(scan.hasPii).toBe(true);

    const summary = summarizeFindings(scan.findings);
    const serialized = JSON.stringify(summary);

    expect(serialized).not.toContain("10000000146");
    expect(serialized).not.toContain("av@ornek.com");
    for (const item of summary) {
      expect(item.count).toBeGreaterThan(0);
      expect(item.masked).toContain("*");
    }
  });
});
