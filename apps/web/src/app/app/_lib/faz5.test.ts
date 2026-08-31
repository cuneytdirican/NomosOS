/**
 * REGRESYON TESTLERİ — denetim bulguları Ö-33, Ö-37, K-15.
 *
 * Ö-33: `rejectOutboundMessage()` yazılmış ama SIFIR ÇAĞRI ile ölü koddu;
 *       arayüzde reddetme yolu yoktu ve ipucu metni var olmayan bir düğmeye
 *       yönlendiriyordu. Burada fonksiyonun doğru uca, gerekçeyle gittiği
 *       doğrulanır.
 * Ö-37: Kanal/yön süzgeci istemcide, üstelik yalnızca son 200 kaydın üzerinde
 *       uygulanıyordu. Artık süzgeç SUNUCUYA gider.
 * K-15: Liste yardımcıları sayfalama zarfını okur; `total` atılmaz.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listCommunicationLogsPaged,
  listContractsPaged,
  listPoaPaged,
  rejectOutboundMessage,
  timelineMayBeTruncated,
} from "./faz5";
import type { CommEntry } from "./faz5-types";

interface Recorded {
  url: string;
  method: string;
  body: string | undefined;
}

function mockApi(body: unknown): Recorded[] {
  const calls: Recorded[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url: String(url),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body),
      } as unknown as Response;
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("rejectOutboundMessage — onaylanmış mesajı reddetme yolu (Ö-33)", () => {
  it("gerekçeyi gövdede, kırpılmış olarak gönderir", async () => {
    const calls = mockApi({ id: "m1", status: "TASLAK" });

    await rejectOutboundMessage("m1", "  Metindeki duruşma tarihi hatalı.  ");

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toContain("/m1/");
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      reason: "Metindeki duruşma tarihi hatalı.",
    });
  });
});

describe("listCommunicationLogsPaged — süzgeç sunucuda (Ö-37, K-15)", () => {
  it("kanal ve yön süzgeçlerini SUNUCUYA gönderir", async () => {
    const calls = mockApi({ items: [], total: 0, page: 1, limit: 50, totalPages: 1 });

    await listCommunicationLogsPaged({
      clientId: "c1",
      channel: "WHATSAPP",
      direction: "GELEN",
      page: 2,
      limit: 50,
    });

    const url = new URL(calls[0]!.url);
    // Kırılan davranış: bu iki süzgeç hiç gönderilmiyor, istemcide son 200
    // kaydın üzerinde uygulanıyordu.
    expect(url.searchParams.get("channel")).toBe("WHATSAPP");
    expect(url.searchParams.get("direction")).toBe("GELEN");
    expect(url.searchParams.get("clientId")).toBe("c1");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("limit")).toBe("50");
  });

  it("zarftaki total'i döndürür ve kayıtları eşler", async () => {
    mockApi({
      items: [{ id: "e1", channel: "EPOSTA", direction: "GIDEN", body: "merhaba" }],
      total: 812,
      page: 1,
      limit: 50,
      totalPages: 17,
    });

    const res = await listCommunicationLogsPaged({ channel: "EPOSTA" });

    expect(res.total).toBe(812);
    expect(res.totalPages).toBe(17);
    expect(res.hasMore).toBe(true);
    expect(res.items).toHaveLength(1);
    expect(res.items[0]!.id).toBe("e1");
  });
});

describe("timelineMayBeTruncated — kronoloji ucu zarfsız (K-15)", () => {
  const entry = (id: string) => ({ id }) as CommEntry;

  it("sunucu üst sınırına dayanan liste için uyarı ister", () => {
    expect(timelineMayBeTruncated(Array.from({ length: 200 }, (_, i) => entry(`e${i}`)))).toBe(
      true,
    );
  });

  it("kısa liste için uyarı istemez", () => {
    expect(timelineMayBeTruncated([entry("e1")])).toBe(false);
  });
});

describe("listPoaPaged / listContractsPaged — zarf okunur (K-15)", () => {
  it("vekaletname listesinde total atılmaz", async () => {
    mockApi({ items: [{ id: "p1" }], total: 240, page: 1, limit: 200, totalPages: 2 });
    const res = await listPoaPaged({ clientId: "c1", limit: 200 });
    expect(res.total).toBe(240);
    expect(res.hasMore).toBe(true);
  });

  it("sözleşme listesinde total atılmaz", async () => {
    mockApi({ items: [{ id: "s1" }], total: 5, page: 1, limit: 200, totalPages: 1 });
    const res = await listContractsPaged({ caseId: "k1", limit: 200 });
    expect(res.total).toBe(5);
    expect(res.hasMore).toBe(false);
  });
});
