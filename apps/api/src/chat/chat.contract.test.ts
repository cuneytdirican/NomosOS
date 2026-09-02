/**
 * MESAJLAŞMA SÖZLEŞMESİ — ürün ilkelerinin kod tarafı.
 *
 * 1. MESAJ SİLME YOK: ChatController'da Delete ucu YOKTUR; OfficeMessage
 *    modelinde deletedAt alanı YOKTUR. Büro içi yazışma denetim izidir.
 * 2. KİRALAR AYRI: mesajlar yalnız kendi bürosunun kullanıcılarına gider
 *    (controller'da her sorgu tenantId süzgeçli — kaynak taraması).
 * 3. DİSK KAPISI: belge yükleme ve UYAP commit'i kota kapısından geçer.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf-8");

const CONTROLLER = read("src", "chat", "chat.controller.ts");
const SERVICE = read("src", "chat", "chat.service.ts");
const SCHEMA = read("..", "..", "packages", "db", "prisma", "schema.prisma");
const DOCS_UPLOAD = read("src", "documents", "documents.service.ts");

describe("Mesajlaşma sözleşmesi", () => {
  it("mesaj SİLME ucu yoktur — Delete hiçbir yerde yayınlanmaz", () => {
    // @Delete dekorörü chat denetleyicisinde olmamalıdır.
    expect(CONTROLLER).not.toContain("@Delete(");
    // Service'te officeMessage.delete çağrısı olmamalıdır.
    expect(SERVICE).not.toMatch(/officeMessage\.delete/);
  });

  it("OfficeMessage modelinde deletedAt yoktur — silme kalıcı olarak imkânsızdır", () => {
    const modelBlock = SCHEMA.slice(
      SCHEMA.indexOf("model OfficeMessage {"),
      SCHEMA.indexOf("model OfficeReadState {"),
    );
    expect(modelBlock).not.toContain("deletedAt");
  });

  it("her sorgu kiracı süzgeçlidir (tenantId)", () => {
    expect(CONTROLLER).toContain("tenantId: user.tenantId");
  });

  it("çevrimiçi pencere ve yazıyor TTL'i controller sözleşmesinden okunur", () => {
    expect(CONTROLLER).toContain("ONLINE_WINDOW_MS");
    expect(CONTROLLER).toContain("TYPING_TTL_MS");
  });

  it("ekler Document olarak saklanır — kota sayacına işler", () => {
    expect(SERVICE).toContain("recordUsage");
    expect(SERVICE).toContain("assertCanStore");
  });
});

describe("Disk kotası sözleşmesi", () => {
  it("belge yükleme kota kapısından geçer", () => {
    expect(DOCS_UPLOAD).toContain("assertCanStore(user.tenantId, file.size)");
    expect(DOCS_UPLOAD).toContain("recordUsage(user.tenantId, file.size)");
  });

  it("DiskQuota modeli: dahil + satın alınan − kullanılan", () => {
    const quotaBlock = SCHEMA.slice(
      SCHEMA.indexOf("model DiskQuota {"),
      SCHEMA.indexOf("model DiskQuotaAdjustment {"),
    );
    expect(quotaBlock).toContain("includedBytes");
    expect(quotaBlock).toContain("purchasedBytes");
    expect(quotaBlock).toContain("usedBytes");
  });

  it("satın alma fatura üretir (kredi deseni)", () => {
    const quotaService = read("src", "disk-quota", "disk-quota.service.ts");
    expect(quotaService).toContain("invoiceRecord.create");
    expect(quotaService).toContain("purchasedBytes: { increment");
  });
});
