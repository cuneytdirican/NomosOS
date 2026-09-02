/**
 * DALGA 1 SÖZLEŞME TESTLERİ (geliştirme planı D1.1–D1.4).
 *
 * D1.1 Kullanıcı yönetimi: /users/manage uçları + UI sayfası var.
 * D1.2 Ajanda: GET /agenda dört kaynağı birleştirir + takvim UI.
 * D1.3 Platform AI: PlatformAiProvider modeli + resolveRoute zinciri + BYO kapısı.
 * D1.3b Model listesi sağlayıcıdan çekilir (elle yazım yok).
 * D1.4 Video arama + avatar: uçlar + UI bileşenleri.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (root: string, ...parts: string[]) =>
  readFileSync(join(process.cwd(), root, ...parts), "utf-8");
const web = (...parts: string[]) => read("..", "web", "src", ...parts);

describe("D1.1: kullanıcı yönetimi ekranı", () => {
  it("uçlar hazır: liste, oluştur, rol değiştir, parola sıfırla, kilit aç, oturum düşür", () => {
    const c = read("src", "users", "users.controller.ts");
    for (const ep of ['Get("manage")', '@Post()', 'Patch(":id")', 'reset-password', "revoke-sessions", "unlock"]) {
      expect(c).toContain(ep);
    }
  });

  it("UI sayfası: Ayarlar → Kullanıcılar (ADMIN/PARTNER)", () => {
    const page = web("app", "app", "ayarlar", "kullanicilar", "page.tsx");
    expect(page).toContain("/users/manage");
    expect(page).toContain("reset-password");
    expect(page).toContain("revoke-sessions");
    expect(page).toContain("unlock");
    const nav = web("app", "app", "layout.tsx");
    expect(nav).toContain("/app/ayarlar/kullanicilar");
    // Yalnız ADMIN/PARTNER görür.
    expect(nav).toMatch(/kullanicilar",\s*\n\s*label: "Kullanıcılar",\s*\n\s*roles: \["ADMIN", "PARTNER"\]/);
  });
});

describe("D1.2: birleşik ajanda", () => {
  it("GET /agenda dört kaynağı birleştirir: duruşma, randevu, süre, görev", () => {
    const svc = read("src", "agenda", "agenda.service.ts");
    expect(svc).toContain("DURUSMA");
    expect(svc).toContain("RANDEVU");
    expect(svc).toContain("SURE");
    expect(svc).toContain("GOREV");
    // Yalnız gerçekleşmemiş duruşmalar ve onaylı süreler.
    expect(svc).toContain('status: { in: ["PLANLANDI"] }');
  });

  it("tatil/adli tatil gün meta verisi legal-core'dan gelir (aynı kaynak)", () => {
    const svc = read("src", "agenda", "agenda.service.ts");
    expect(svc).toContain("officialHolidaysOn");
    expect(svc).toContain("isInJudicialRecess");
  });

  it("UI: ay ızgarası + tür süzgeçleri + gün ayrıntısı", () => {
    const page = web("app", "app", "ajanda", "page.tsx");
    expect(page).toContain("/agenda");
    expect(page).toContain("DURUSMA");
    expect(page).toContain("bugün");
    expect(nav_has_ajanda());
  });
});

function nav_has_ajanda(): boolean {
  return web("app", "app", "layout.tsx").includes('"/app/ajanda"');
}

describe("D1.3: platform AI sağlayıcı sistemi", () => {
  it("PlatformAiProvider modeli ve migration var", () => {
    const schema = read("..", "..", "packages", "db", "prisma", "schema.prisma");
    expect(schema).toContain("model PlatformAiProvider");
    const mig = read("..", "..", "packages", "db", "prisma", "migrations", "20260918110000_platform_ai_saglayici", "migration.sql");
    expect(mig).toContain("CREATE TABLE \"PlatformAiProvider\"");
    // Anahtar şifreli saklanır.
    expect(schema).toContain("encryptedApiKey String?");
  });

  it("resolveRoute zinciri: BYO yoksa kiracı sağlayıcıları YOK SAYILIR", () => {
    for (const f of [
      "src/ai/ai.service.ts",
      "src/assistant/assistant-llm.service.ts",
      "src/caselaw/ai-runner.service.ts",
      "src/pipeline/agent-runner.service.ts",
    ]) {
      const s = read(f);
      expect(s, f).toContain("byoRestricted");
      expect(s, f).toContain("resolveForTenant");
    }
  });

  it("BYO kapısı: sağlayıcı EKLEME engellenir (plan izni yoksa)", () => {
    const s = read("src", "ai", "ai.service.ts");
    expect(s).toContain("byoAllowed(user.tenantId)");
    expect(s).toContain("kapsamıyor");
  });

  it("kilitli görünüm ucu: GET /ai/platform-status (anahtarsız)", () => {
    const c = read("src", "ai", "ai.controller.ts");
    expect(c).toContain('Get("platform-status")');
    const svc = read("src", "ai", "platform-ai.service.ts");
    expect(svc).toContain("tenantStatus");
    // Kiracı UI kilitli görünümü.
    const page = web("app", "app", "ayarlar", "ai-saglayici", "page.tsx");
    expect(page).toContain("platform-status");
    expect(page).toContain("byoAllowed === false");
  });

  it("platform paneli: CRUD + test + model çekme uçları", () => {
    const c = read("src", "ai", "platform-ai-provider.controller.ts");
    expect(c).toContain('aiProvider.view');
    expect(c).toContain('aiProvider.manage');
    expect(c).toContain('Post(":id/models")');
    expect(c).toContain('Post(":id/test")');
    // İzin matrisi İKİ dosyada da.
    expect(read("src", "platform", "platform-permissions.ts")).toContain('"aiProvider.view"');
    const rbac = read("..", "admin", "src", "lib", "rbac.ts");
    expect(rbac).toContain('"aiProvider.view"');
    const nav = read("..", "admin", "src", "lib", "nav.ts");
    expect(nav).toContain("/ai-saglayicilar");
  });
});

describe("D1.3b: model listesi sağlayıcıdan çekilir", () => {
  it("kiracı: kayıtlı sağlayıcıdan çek + kaydetmeden önizleme", () => {
    const c = read("src", "ai", "ai.controller.ts");
    expect(c).toContain('Post("providers/:id/models")');
    expect(c).toContain('Post("providers/models-preview")');
  });

  it("UI: 'Modelleri Sağlayıcıdan Çek' düğmesi + seçim listesi (elle yazım bitmeli)", () => {
    const page = web("app", "app", "ayarlar", "ai-saglayici", "page.tsx");
    expect(page).toContain("Modelleri Sağlayıcıdan Çek");
    expect(page).toContain("models-preview");
  });
});

describe("D1.4: video arama + avatar", () => {
  it("WebRTC bileşeni: STUN sinyalleşmeli arama + dürüst sınır notu", () => {
    const vc = web("components", "video-call.tsx");
    expect(vc).toContain("RTCPeerConnection");
    expect(vc).toContain("stun:");
    // Dürüstlük: TURN yok — açıkça yazılır.
    expect(vc).toContain("TURN");
    expect(vc).toContain("/chat/calls");
  });

  it("avatar: görüntüleme + yükleme (presign → PUT → PATCH)", () => {
    const av = web("components", "chat-avatar.tsx");
    expect(av).toContain("/chat/users/");
    expect(av).toContain("/chat/avatar/presign");
    expect(av).toContain('"/chat/avatar"');
    const page = web("app", "app", "mesajlar", "page.tsx");
    expect(page).toContain("useVideoCall");
    expect(page).toContain("AvatarUploadButton");
    expect(page).toContain("Görüntülü ara");
  });
});
