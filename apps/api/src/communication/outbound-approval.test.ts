/**
 * ONAY AKIŞININ ZORLANMASI — `OutboundService` davranış testleri.
 *
 * Bu dosya modülün TEK EN ÖNEMLİ vaadini sınar: onaysız hiçbir metin müvekkile
 * gitmez. Prisma yerine bellek-içi bir sahte istemci kullanılır; amaç veritabanı
 * davranışını değil, DURUM MAKİNESİNİN KAPILARINI sınamaktır.
 */

import { ConflictException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { AuthUser } from "../common/types";
import { ChannelNotConfiguredError, ChannelProviderRegistry } from "./channel-providers";
import { OutboundService } from "./outbound.service";

/* -------------------------------------------------------------------------- *
 * Sahteler
 * -------------------------------------------------------------------------- */

interface Row {
  id: string;
  tenantId: string;
  clientId: string;
  caseId: string | null;
  channel: string;
  templateId: string | null;
  subject: string | null;
  draftBody: string;
  finalBody: string | null;
  status: string;
  piiScanJson: string | null;
  createdBy: string;
  approvedBy: string | null;
  approvedAt: Date | null;
  sentAt: Date | null;
  providerRef: string | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const TENANT = "t1";
const CLIENT = {
  id: "c1",
  name: "ABC Holding A.Ş.",
  email: "info@abc.com",
  phone: "0532 111 22 33",
  tckn: null,
  iban: null,
  isActive: true,
};

function makeRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "m1",
    tenantId: TENANT,
    clientId: CLIENT.id,
    caseId: null,
    channel: "EPOSTA",
    templateId: null,
    subject: "Durum bilgilendirmesi",
    draftBody: "Sayın yetkili, dosyanızda gelişme oldu.",
    finalBody: null,
    status: "TASLAK",
    piiScanJson: null,
    createdBy: "u-sekreter",
    approvedBy: null,
    approvedAt: null,
    sentAt: null,
    providerRef: null,
    failureReason: null,
    createdAt: new Date("2026-08-30T09:00:00.000Z"),
    updatedAt: new Date("2026-08-30T09:00:00.000Z"),
    ...overrides,
  };
}

function buildService(row: Row) {
  const store = { row };
  const communicationLogs: unknown[] = [];

  const prisma = {
    client: {
      outboundMessage: {
        findFirst: async ({ where }: { where: { id: string; tenantId: string } }) =>
          where.id === store.row.id && where.tenantId === store.row.tenantId ? { ...store.row } : null,
        update: async ({ data }: { data: Partial<Row> }) => {
          store.row = { ...store.row, ...data } as Row;
          return { ...store.row };
        },
      },
      communicationLog: {
        create: async ({ data }: { data: unknown }) => {
          communicationLogs.push(data);
          return data;
        },
      },
      clientContact: { findMany: async () => [] },
      $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
    },
  };

  const communication = {
    requireClient: async () => CLIENT,
    requireCase: async () => ({ id: "k1", clientId: CLIENT.id }),
  };
  const audit = { log: async () => undefined };
  const channels = new ChannelProviderRegistry();

  /**
   * Portal yayın servisi — sahte. PORTAL kanalından gönderilen mesaj için
   * allow-list satırı açılır (denetim bulgusu 1); test bu çağrının GERÇEKTEN
   * yapıldığını da doğrular.
   */
  const portalPublications = {
    published: [] as { outboundMessageId: string; clientId: string; publishedBy: string }[],
    async publishOutboundMessage(input: {
      outboundMessageId: string;
      clientId: string;
      publishedBy: string;
    }) {
      portalPublications.published.push({
        outboundMessageId: input.outboundMessageId,
        clientId: input.clientId,
        publishedBy: input.publishedBy,
      });
    },
  };

  const service = new OutboundService(
    prisma as never,
    audit as never,
    communication as never,
    {} as never,
    {} as never,
    channels,
    portalPublications as never,
  );

  return { service, store, communicationLogs, channels, portalPublications };
}

const AVUKAT: AuthUser = { userId: "u-avukat", tenantId: TENANT, role: "AVUKAT" };
const SEKRETER: AuthUser = { userId: "u-sekreter", tenantId: TENANT, role: "SEKRETER" };
const PARTNER: AuthUser = { userId: "u-partner", tenantId: TENANT, role: "PARTNER" };

/* -------------------------------------------------------------------------- *
 * Testler
 * -------------------------------------------------------------------------- */

describe("gönderim kapısı — onaysız gönderim YOK", () => {
  it("TASLAK durumunda gönderim denemesi 409 döner", async () => {
    const { service } = buildService(makeRow());
    await expect(service.send(AVUKAT, "m1", {})).rejects.toBeInstanceOf(ConflictException);
    await expect(service.send(AVUKAT, "m1", {})).rejects.toThrow(/onaylanmadan gönderilemez/i);
  });

  it("durum ONAYLANDI'ya elle çekilse bile approvedBy boşsa gönderim 409", async () => {
    // Veri taşıma / hatalı betik senaryosu: durum sütunu kurcalanmış.
    const { service } = buildService(
      makeRow({ status: "ONAYLANDI", finalBody: "Metin", approvedBy: null, approvedAt: null }),
    );
    await expect(service.send(AVUKAT, "m1", {})).rejects.toThrow(/onaylanmadan gönderilemez/i);
  });

  it("onaylayan var ama nihai metin yoksa gönderim 409", async () => {
    const { service } = buildService(
      makeRow({
        status: "ONAYLANDI",
        approvedBy: "u-avukat",
        approvedAt: new Date(),
        finalBody: null,
      }),
    );
    await expect(service.send(AVUKAT, "m1", {})).rejects.toThrow(/nihai metin/i);
  });

  it("gönderilmiş mesaj ikinci kez gönderilemez", async () => {
    const { service } = buildService(
      makeRow({
        status: "GONDERILDI",
        approvedBy: "u-avukat",
        approvedAt: new Date(),
        finalBody: "Metin",
      }),
    );
    await expect(service.send(AVUKAT, "m1", {})).rejects.toThrow(/zaten gönderildi/i);
  });
});

describe("onay yetkisi", () => {
  it("SEKRETER onaylayamaz (403)", async () => {
    const { service } = buildService(makeRow());
    await expect(service.approve(SEKRETER, "m1", {})).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("SEKRETER gönderemez (403)", async () => {
    const { service } = buildService(
      makeRow({ status: "ONAYLANDI", approvedBy: "u-avukat", approvedAt: new Date(), finalBody: "x" }),
    );
    await expect(service.send(SEKRETER, "m1", {})).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("AVUKAT onaylayabilir ve approvedBy DOLAR", async () => {
    const { service, store } = buildService(makeRow());
    const result = await service.approve(AVUKAT, "m1", {});
    expect(store.row.approvedBy).toBe("u-avukat");
    expect(store.row.status).toBe("ONAYLANDI");
    expect(result.canSend).toBe(true);
  });
});

describe("draftBody / finalBody ayrımı (iş kuralı 3)", () => {
  it("onay, düzenlenmemiş metni finalBody'ye AÇIKÇA yazar; draftBody değişmez", async () => {
    const { service, store } = buildService(makeRow());
    const original = store.row.draftBody;
    await service.approve(AVUKAT, "m1", {});
    expect(store.row.draftBody).toBe(original);
    expect(store.row.finalBody).toBe(original);
  });

  it("düzenleme yalnız finalBody'yi değiştirir — AI'ın önerisi korunur", async () => {
    const { service, store } = buildService(makeRow());
    const aiDraft = store.row.draftBody;
    await service.update(AVUKAT, "m1", { finalBody: "Avukatın düzelttiği metin." });
    expect(store.row.draftBody).toBe(aiDraft);
    expect(store.row.finalBody).toBe("Avukatın düzelttiği metin.");
  });
});

describe("onay sonrası düzenleme — ONAY DÜŞER", () => {
  it("onaylanmış mesaj düzenlenirse approvedBy silinir ve durum TASLAK'a döner", async () => {
    const { service, store } = buildService(makeRow());
    await service.approve(AVUKAT, "m1", {});
    expect(store.row.approvedBy).toBe("u-avukat");

    const updated = await service.update(AVUKAT, "m1", { finalBody: "Sonradan değiştirilmiş metin." });

    expect(store.row.approvedBy).toBeNull();
    expect(store.row.status).toBe("TASLAK");
    expect(updated.warning).toContain("ONAY DÜŞÜRÜLDÜ");
  });

  it("onay düştükten sonra gönderim yine 409 verir — 'onaylat, değiştir, gönder' yolu kapalı", async () => {
    const { service } = buildService(makeRow());
    await service.approve(AVUKAT, "m1", {});
    await service.update(AVUKAT, "m1", { finalBody: "Gizlice değiştirilmiş metin." });
    await expect(service.send(AVUKAT, "m1", {})).rejects.toThrow(/onaylanmadan gönderilemez/i);
  });

  it("gönderilmiş mesaj artık düzenlenemez", async () => {
    const { service } = buildService(
      makeRow({ status: "GONDERILDI", approvedBy: "u-avukat", finalBody: "x" }),
    );
    await expect(service.update(AVUKAT, "m1", { finalBody: "y" })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe("KVKK — üçüncü kişi verisi onayı engeller", () => {
  it("üçüncü kişi e-postası içeren metnin onayı 409 ile durur", async () => {
    const { service } = buildService(
      makeRow({ draftBody: "Karşı taraf vekili avukat@karsitaraf.com ile görüşüldü." }),
    );
    await expect(service.approve(PARTNER, "m1", {})).rejects.toMatchObject({
      response: { reasonCode: "UCUNCU_KISI_KISISEL_VERI" },
    });
  });

  it("piiApproved verilse bile GEREKÇESİZ onay reddedilir", async () => {
    const { service } = buildService(
      makeRow({ draftBody: "Karşı taraf vekili avukat@karsitaraf.com ile görüşüldü." }),
    );
    await expect(service.approve(PARTNER, "m1", { piiApproved: true })).rejects.toThrow(/gerekçe/i);
  });

  it("gerekçeli onay geçer ve tarama sonucu kayda yazılır", async () => {
    const { service, store } = buildService(
      makeRow({ draftBody: "Karşı taraf vekili avukat@karsitaraf.com ile görüşüldü." }),
    );
    await service.approve(PARTNER, "m1", {
      piiApproved: true,
      piiOverrideNote: "Vekil adresi müvekkilin talebiyle paylaşıldı.",
    });
    expect(store.row.approvedBy).toBe("u-partner");
    const scan = JSON.parse(store.row.piiScanJson as string);
    expect(scan.hasThirdPartyPii).toBe(true);
    // Ham adres kayda YAZILMAZ.
    expect(store.row.piiScanJson).not.toContain("avukat@karsitaraf.com");
  });

  it("müvekkilin KENDİ e-postası onayı engellemez", async () => {
    const { service, store } = buildService(
      makeRow({ draftBody: "Sorularınız için info@abc.com adresine yazabilirsiniz." }),
    );
    await service.approve(AVUKAT, "m1", {});
    expect(store.row.status).toBe("ONAYLANDI");
  });
});

describe("kanal sağlayıcısı — yapılandırılmamışsa YALAN SÖYLEMEZ", () => {
  it("EPOSTA yapılandırılmamışsa 503 döner ve mesaj ONAYLANDI kalır", async () => {
    const { service, store } = buildService(makeRow());
    await service.approve(AVUKAT, "m1", {});

    await expect(service.send(AVUKAT, "m1", {})).rejects.toThrow(/yapılandırılmadı/i);

    // Onay yakılmaz, mesaj BAŞARISIZ'a düşmez: bu bir kurulum eksikliğidir.
    expect(store.row.status).toBe("ONAYLANDI");
    expect(store.row.approvedBy).toBe("u-avukat");
    expect(store.row.sentAt).toBeNull();
    expect(store.row.failureReason).toContain("SMTP_HOST");
  });

  it("yapılandırılmamış kanal gönderimi iletişim geçmişine KAYIT DÜŞMEZ", async () => {
    const { service, communicationLogs } = buildService(makeRow());
    await service.approve(AVUKAT, "m1", {});
    await expect(service.send(AVUKAT, "m1", {})).rejects.toThrow();
    expect(communicationLogs).toHaveLength(0);
  });

  it("çalışan sağlayıcıda gönderim başarılı olur ve iletişim geçmişine yazılır", async () => {
    const { service, store, communicationLogs, channels } = buildService(makeRow());
    channels.register({
      channel: "EPOSTA",
      name: "Test SMTP",
      send: async () => ({ providerRef: "smtp-42" }),
    });

    await service.approve(AVUKAT, "m1", {});
    const result = await service.send(AVUKAT, "m1", {});

    expect(store.row.status).toBe("GONDERILDI");
    expect(store.row.providerRef).toBe("smtp-42");
    expect(store.row.sentAt).not.toBeNull();
    expect(result.provider).toBe("Test SMTP");
    expect(communicationLogs).toHaveLength(1);
    expect(communicationLogs[0]).toMatchObject({ direction: "GIDEN", channel: "EPOSTA" });
  });

  it("sağlayıcı hatası mesajı BASARISIZ yapar — sessizce kaybolmaz", async () => {
    const { service, store, channels } = buildService(makeRow());
    channels.register({
      channel: "EPOSTA",
      name: "Bozuk SMTP",
      send: async () => {
        throw new Error("bağlantı reddedildi");
      },
    });

    await service.approve(AVUKAT, "m1", {});
    await expect(service.send(AVUKAT, "m1", {})).rejects.toThrow(/BAŞARISIZ/);
    expect(store.row.status).toBe("BASARISIZ");
    expect(store.row.failureReason).toContain("bağlantı reddedildi");
  });

  it("NoopChannelProvider eksik ayarları ADIYLA söyler", async () => {
    const registry = new ChannelProviderRegistry();
    const provider = registry.resolve("WHATSAPP");
    await expect(
      provider.send({ channel: "WHATSAPP", to: "+905321112233", body: "x" }),
    ).rejects.toBeInstanceOf(ChannelNotConfiguredError);
  });

  /**
   * ═══ PORTAL GÖRÜNÜRLÜĞÜ ALLOW-LIST'E YAZILIR ═══
   *
   * "PORTAL kanalından gönderilmiş olmak" tek başına görünürlük sayılıyordu ve
   * hiçbir yayın kaydı açılmıyordu; sonucu, yanlış gönderilmiş bir mesajın
   * portaldan GERİ ÇEKİLEMEMESİYDİ (kaldırılacak satır yoktu). Artık gönderim
   * gerçek bir `PortalPublication` satırı doğurur ve o satır kaldırılabilir.
   */
  it("PORTAL kanalından gönderim, portal yayın kaydını AÇAR", async () => {
    const { service, portalPublications, channels } = buildService(
      makeRow({ channel: "PORTAL" }),
    );
    channels.register({
      channel: "PORTAL",
      name: "Portal",
      send: async () => ({ providerRef: "portal-1" }),
    });

    await service.approve(AVUKAT, "m1", {});
    await service.send(AVUKAT, "m1", {});

    expect(portalPublications.published).toHaveLength(1);
    expect(portalPublications.published[0]).toMatchObject({
      outboundMessageId: "m1",
      clientId: CLIENT.id,
      // Yayın kararının sorumlusu ONAYLAYANDIR.
      publishedBy: AVUKAT.userId,
    });
  });

  it("PORTAL DIŞI kanalda yayın kaydı AÇILMAZ (görünürlük ayrı bir karardır)", async () => {
    const { service, portalPublications, channels } = buildService(makeRow());
    channels.register({
      channel: "EPOSTA",
      name: "Test SMTP",
      send: async () => ({ providerRef: "smtp-1" }),
    });

    await service.approve(AVUKAT, "m1", {});
    await service.send(AVUKAT, "m1", {});

    expect(portalPublications.published).toHaveLength(0);
  });

  it("iletişim geçmişi kaydı KAYNAĞINI ve giden mesajı taşır", async () => {
    const { service, communicationLogs, channels } = buildService(makeRow());
    channels.register({
      channel: "EPOSTA",
      name: "Test SMTP",
      send: async () => ({ providerRef: "smtp-1" }),
    });

    await service.approve(AVUKAT, "m1", {});
    await service.send(AVUKAT, "m1", {});

    // "Müvekkile ne söylendi, kim onayladı?" sorusu tek sorguyla cevaplanabilir.
    expect(communicationLogs[0]).toMatchObject({
      source: "SISTEM",
      outboundMessageId: "m1",
    });
  });

  it("gönderim anında üçüncü kişi verisi çıkarsa GEREKÇESİZ geçilemez", async () => {
    // Onay sırasında temiz olan metin, gönderim öncesi taramada üçüncü kişi
    // verisi taşıyor sayılsın diye müvekkilin e-postası kayıttan düşürülür.
    const { service, channels } = buildService(
      makeRow({ draftBody: "Karşı taraf vekili: av.mehmet@karsi.com ile görüşüldü." }),
    );
    channels.register({
      channel: "EPOSTA",
      name: "Test SMTP",
      send: async () => ({ providerRef: "smtp-1" }),
    });

    await service.approve(AVUKAT, "m1", {
      piiApproved: true,
      piiOverrideNote: "Karşı vekil bilgisi müvekkile bildirilecek.",
    });

    // Onay gerekçeliydi; gönderimde gerekçe verilmezse KAPI TUTAR.
    await expect(service.send(AVUKAT, "m1", { piiApproved: true })).rejects.toThrow(
      /gerekçe/i,
    );

    // Gerekçeyle geçer.
    const sent = await service.send(AVUKAT, "m1", {
      piiApproved: true,
      piiOverrideNote: "Karşı vekil bilgisi müvekkile bildirilecek.",
    });
    expect(sent.status).toBe("GONDERILDI");
  });

  it("çözülmemiş {{degisken}} kalan metin ONAYLANAMAZ", async () => {
    const { service } = buildService(
      makeRow({ draftBody: "Sayın {{muvekkilAdi}}, dosyanızda gelişme oldu." }),
    );
    await expect(service.approve(AVUKAT, "m1", {})).rejects.toThrow(/çözülmemiş değişken/i);
  });

  it("PORTAL kanalı Noop DEĞİLDİR — yerel teslim gerçekten çalışır", () => {
    const registry = new ChannelProviderRegistry();
    const status = registry.status();
    expect(status.find((s) => s.channel === "PORTAL")?.configured).toBe(true);
    expect(status.find((s) => s.channel === "EPOSTA")?.configured).toBe(false);
  });
});

describe("red akışı", () => {
  it("reddedilen mesaj IPTAL olur ve gönderilemez", async () => {
    const { service, store } = buildService(makeRow());
    await service.reject(PARTNER, "m1", { reason: "Üslup uygun değil, yeniden yazılacak." });
    expect(store.row.status).toBe("IPTAL");
    expect(store.row.failureReason).toContain("Üslup uygun değil");
    await expect(service.send(PARTNER, "m1", {})).rejects.toThrow(/İptal edilmiş/);
  });
});
