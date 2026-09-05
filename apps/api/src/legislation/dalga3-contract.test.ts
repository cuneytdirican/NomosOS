/**
 * DALGA 3 SÖZLEŞME TESTLERİ (geliştirme planı D3).
 *
 * A4 mevzuat kütüphanesi: yerel yükleme modeli + tam metin arama +
 * sürüm notu disiplini. C7 İ-46: JWT httpOnly cookie. C6: izleme/DR.
 *
 * Bunlar KAYNAK sözleşme testleridir: uç davranışı e2e ile doğrulanır,
 * burada mimari kararla bağlanır (kiracı izolasyonu, rol kapısı, vaat
 * kısıtı, güvenlik borcu).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(...parts: string[]): string {
  return readFileSync(join(process.cwd(), ...parts), "utf-8");
}

describe("A4: mevzuat kütüphanesi (yerel yükleme modeli)", () => {
  it("model: Legislation tablosu + preview (liste tam metni taşımaz)", () => {
    const schema = read("..", "..", "packages", "db", "prisma", "schema.prisma");
    expect(schema).toContain("model Legislation");
    expect(schema).toContain("preview");
    // Kiracı izolasyonu şemada başlar: tenantId'siz erişim olamaz.
    expect(schema).toMatch(/model Legislation \{[^}]*tenantId/s);
  });

  it("tam metin arama + tavan (500) + belge türü doğrulaması", () => {
    const s = read("src", "legislation", "legislation.service.ts");
    expect(s).toContain("contains");
    expect(s).toContain("insensitive");
    expect(s).toContain("Math.min(Math.max(filters.take ?? 50, 1), 500)");
    expect(s).toContain("LEGISLATION_DOC_TYPES");
  });

  it("sürüm notu disiplini: tam metin değişiyorsa ZORUNLU", () => {
    const s = read("src", "legislation", "legislation.service.ts");
    expect(s).toContain("SÜRÜM NOTU zorunludur");
  });

  it("rol kapısı: yazma uçları HUKUKI kümesi ister", () => {
    const s = read("src", "legislation", "legislation.service.ts");
    expect((s.match(/assertRole\(user, ROLE_SETS\.HUKUKI/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("yumuşak silme (isActive=false) — geçmişe erişim hukuken gerekli", () => {
    const s = read("src", "legislation", "legislation.service.ts");
    expect(s).toContain("isActive: false");
  });

  it("VAAT KISITI (faz 1 sonrası): RG izleyici ONAY KUYRUĞUYLA çalışır — otomatik havuz yazımı yoktur", () => {
    // Faz 1 (hukuki veri kaynağı besleme): platform mevzuat havuzu kuruldu.
    // Yeni vaat: RG izleyici vardır ama yalnızca ONAY KUYRUĞUNA yazar;
    // hiçbir RG belgesi otomatik yayınlanmaz (halüsinasyon zinciri kuyrukta kesilir).
    const rgJob = read("src", "scheduler", "jobs", "resmi-gazete.job.ts");
    expect(rgJob).toContain("HAVUZA YAZIM BU İŞTE YAPILMAZ");
    // Kiracı kütüphanesi hâlâ elle yüklemeye dayanır: büro kaydı kiracıya aittir.
    const s = read("src", "legislation", "legislation.service.ts");
    expect(s).toContain("YOKTUR");
    // Zamanlayıcı çekirdeği mevzuat bilmez; iş tanımı job dosyasındadır.
    const scheduler = read("src", "scheduler", "scheduler.service.ts");
    expect(scheduler).not.toContain("legislation");
  });

  it("web arayüzü: arama + yükleme + sürüm notu alanı", () => {
    const page = read("..", "..", "apps", "web", "src", "app", "app", "mevzuat", "page.tsx");
    expect(page).toContain("/legislation");
    expect(page).toContain("senkronu yoktur");
    expect(page).toContain("versionNote");
    expect(page).toContain("Mevzuat Yükle");
  });

  it("navigasyona eklendi", () => {
    const layout = read("..", "..", "apps", "web", "src", "app", "app", "layout.tsx");
    expect(layout).toContain("/app/mevzuat");
  });

  it("rota kataloğunda", () => {
    const routes = read("..", "..", "packages", "shared", "src", "api-routes.ts");
    expect(routes).toContain("LEGISLATION_ROUTES");
  });
});

describe("C7 / İ-46: JWT httpOnly çerez (XSS belirteç hırsızlığı)", () => {
  it("girişte çerez YAZILIR: httpOnly + SameSite=Lax + path=/api/v1", () => {
    const cookie = read("src", "common", "auth-cookie.ts");
    expect(cookie).toContain("httpOnly: true");
    expect(cookie).toContain('sameSite: "lax"');
    expect(cookie).toContain('path: AUTH_COOKIE_PATH');
    expect(cookie).toContain('AUTH_COOKIE_PATH = "/api/v1"');
  });

  it("guard Authorization başlığı YOKSA çerezden okur (mobil başlığı sürdürür)", () => {
    const guard = read("src", "common", "guards", "jwt-auth.guard.ts");
    expect(guard).toContain("readCookie(request, AUTH_COOKIE_NAME)");
    expect(guard).toContain("Bearer ");
  });

  it("giriş ucu çerezi yazar, çıkış ucu düşürür", () => {
    const ctrl = read("src", "auth", "auth.controller.ts");
    expect(ctrl).toContain("response.cookie(AUTH_COOKIE_NAME");
    expect(ctrl).toContain("clearCookie");
  });

  it("web istemcisi JWT'yi localStorage'a YAZMAZ ve çerezle gider", () => {
    const client = read("..", "..", "apps", "web", "src", "lib", "api.ts");
    expect(client).not.toContain('localStorage.setItem(TOKEN_KEY');
    expect(client).not.toContain("nomosos_token"); // istemcide belirteç adı geçmemeli
    expect(client).toContain('credentials: "include"');
    // getToken artık bir SİNYAL döndürür (kimlik değil).
    expect(client).toContain("readSessionCookie");
  });

  it("doğrudan fetch/XHR kullanan akışlar da çerezle gider", () => {
    const faz2 = read("..", "..", "apps", "web", "src", "lib", "faz2.ts");
    expect(faz2).toContain("withCredentials = true");
    expect(faz2).not.toContain('Bearer ${token}');
    const faz6 = read("..", "..", "apps", "web", "src", "app", "app", "_lib", "faz6.ts");
    expect(faz6).toContain('credentials: "include"');
  });
});

describe("C6: izleme + DR", () => {
  it("GET /metrics — Prometheus metin biçimi + token kapısı", () => {
    const ctrl = read("src", "metrics", "metrics.controller.ts");
    expect(ctrl).toContain("text/plain; version=0.0.4");
    expect(ctrl).toContain("METRICS_TOKEN");
    // Üretimde token'sız uç VAROLMAZ.
    expect(ctrl).toContain("NotFoundException");
    // Faz 4: metrik tanımları prom-client kayıt defterine taşındı.
    expect(read("src", "metrics", "metrics.registry.ts")).toContain("nomosos_db_up");
  });

  it("genel önekten hariçtir (standart /metrics yolu)", () => {
    const main = read("src", "main.ts");
    expect(main).toContain('path: "metrics"');
  });

  it("DR/yedekleme prosedürü BELGELİ (RPO/RTO + tatbikat)", () => {
    const doc = read("..", "..", "docs", "yedekleme-ve-felaket-kurtarma.md");
    expect(doc).toContain("pg_dump");
    expect(doc).toContain("pg_restore");
    expect(doc).toContain("tatbikat");
    expect(doc).toContain("3-2-1");
  });
});

describe("C4: SSE gerçek zamanlı iletişim", () => {
  it("GET /chat/stream — olay veriyolu keep-alive ile", () => {
    const ctrl = read("src", "chat", "chat.controller.ts");
    expect(ctrl).toContain('@Sse("stream")');
    expect(ctrl).toContain("keepAlive");
    expect(ctrl).toContain("25_000");
  });

  it("mesaj gönderimi sinyal yayınlar (içerik taşımaz — KVKK)", () => {
    const ctrl = read("src", "chat", "chat.controller.ts");
    expect(ctrl).toContain('this.events.publish');
    expect(ctrl).toContain("chat.message");
    const svc = read("src", "chat", "chat-events.service.ts");
    expect(svc).toContain("kişiye özgü veri YOKTUR");
  });

  it("web sayfası EventSource dinler; polling YEDEK kalır", () => {
    const page = read("..", "..", "apps", "web", "src", "app", "app", "mesajlar", "page.tsx");
    expect(page).toContain("new EventSource");
    expect(page).toContain("withCredentials: true");
    // Polling hâlâ kurulu — SSE kopunca sayfa çalışmaya devam eder.
    expect(page).toContain("setInterval(() => void poll(), 3_000)");
  });

  it("çoklu örnek sınırı AÇIKÇA belgeli (Redis pub/sub gerekliliği)", () => {
    const svc = read("src", "chat", "chat-events.service.ts");
    expect(svc).toContain("tek örnek");
  });
});
