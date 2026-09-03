/**
 * SSE OLAY VERİYOLU TESTLERİ (D3 / C4 + D5 çoklu örnek kapanışı).
 *
 * Zarf işlemleri saf işlevlerdir; yerel dağıtım ve abonelik yaşam döngüsü
 * sahte dinleyicilerle sınanır. Redis bağımlı yollar canlı doğrulanır
 * (redis-cli SUBSCRIBE + /chat/stream).
 */

import { describe, expect, it } from "vitest";
import {
  buildChatEventEnvelope,
  ChatEventsService,
  parseChatEventEnvelope,
  type ChatEvent,
} from "./chat-events.service";

const sample: ChatEvent = { type: "chat.message", by: "user-1", to: "user-2", at: 1_756_000_000_000 };

describe("zarf (envelope) işlemleri", () => {
  it("gidiş-dönüş: kur → çöz → olay birebir döner", () => {
    const raw = buildChatEventEnvelope("instance-a", "tenant-1", sample);
    const parsed = parseChatEventEnvelope(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.origin).toBe("instance-a");
    expect(parsed?.tenantId).toBe("tenant-1");
    expect(parsed?.event).toEqual(sample);
  });

  it("bozuk JSON null döner — abone akışı düşmez", () => {
    expect(parseChatEventEnvelope("bu json değil")).toBeNull();
  });

  it("eksik alanlı zarf null döner (origin/tenantId/event zorunlu)", () => {
    expect(parseChatEventEnvelope(JSON.stringify({ origin: "a" }))).toBeNull();
    expect(parseChatEventEnvelope(JSON.stringify({ origin: "a", tenantId: "t" }))).toBeNull();
    // event nesne değilse de reddedilir.
    expect(parseChatEventEnvelope(JSON.stringify({ origin: "a", tenantId: "t", event: 5 }))).toBeNull();
  });

  it("farklı origin'li zarf kabul edilir — yankı önleme anahtarı korunur", () => {
    const raw = buildChatEventEnvelope("instance-b", "tenant-1", sample);
    const parsed = parseChatEventEnvelope(raw);
    expect(parsed?.origin).toBe("instance-b");
  });
});

describe("yerel veriyolu (Redis'siz)", () => {
  it("abone dinleyici olayı alır", () => {
    const bus = new ChatEventsService();
    const got: ChatEvent[] = [];
    bus.subscribe("tenant-1", (e) => got.push(e));
    bus.publish("tenant-1", sample);
    expect(got).toEqual([sample]);
  });

  it("başka kiracının dinleyicisi olayı ALMAZ (kiracı izolasyonu)", () => {
    const bus = new ChatEventsService();
    const got: ChatEvent[] = [];
    bus.subscribe("tenant-2", (e) => got.push(e));
    bus.publish("tenant-1", sample);
    expect(got).toHaveLength(0);
  });

  it("abonelik geri alınınca dinleyici olayı almaz", () => {
    const bus = new ChatEventsService();
    const got: ChatEvent[] = [];
    const off = bus.subscribe("tenant-1", (e) => got.push(e));
    off();
    bus.publish("tenant-1", sample);
    expect(got).toHaveLength(0);
    expect(bus.connectionCount).toBe(0);
  });

  it("dinleyici hatası yayın zincirini düşürmez", () => {
    const bus = new ChatEventsService();
    const got: ChatEvent[] = [];
    bus.subscribe("tenant-1", () => {
      throw new Error("dinleyici patladı");
    });
    bus.subscribe("tenant-1", (e) => got.push(e));
    expect(() => bus.publish("tenant-1", sample)).not.toThrow();
    expect(got).toEqual([sample]);
  });

  it("dinleyici yokken yayın sessizce boşa gider", () => {
    const bus = new ChatEventsService();
    expect(() => bus.publish("yok", sample)).not.toThrow();
  });

  it("yerel kipte busMode local'dir (Redis kurulumu yapılmadan)", () => {
    const bus = new ChatEventsService();
    expect(bus.busMode).toBe("local");
  });

  it("dinleyici çözümlemesi güvenlidir — publish sırasında abonelik kapanabilir", () => {
    const bus = new ChatEventsService();
    const seen: ChatEvent[] = [];
    bus.subscribe("tenant-1", (e) => {
      seen.push(e);
      off();
    });
    const off = bus.subscribe("tenant-1", () => undefined);
    bus.publish("tenant-1", sample);
    expect(seen).toEqual([sample]);
  });
});
