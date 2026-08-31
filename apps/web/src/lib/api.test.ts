/**
 * SAYFALAMA ZARFI REGRESYON TESTLERİ — denetim bulgusu K-15.
 *
 * Kırılan davranış: istemci `limit: 200` isteyip `asList()` ile yalnızca
 * `items`'ı alıyor, `total` / `totalPages` atıyordu. 260 açık süresi olan
 * büroda 60 süre hiçbir ekranda görünmüyor, kırpıldığına dair bir işaret de
 * çıkmıyordu. Aşağıdaki testler zarfın okunduğunu, sunucu tavanının istenen
 * limitin altına indiği durumun (ör. `/clients` tavanı 100) doğru
 * yorumlandığını ve zarfsız uçlarda kırpma ihtimalinin BİLDİRİLDİĞİNİ
 * doğrular.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PAGE_SIZE, SERVER_MAX_PAGE_SIZE, fetchPaged, readPaged } from "./api";

interface FakeCall {
  url: string;
}

function mockFetchOnce(body: unknown, calls: FakeCall[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push({ url: String(url) });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body),
      } as unknown as Response;
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readPaged — sunucu zarfı", () => {
  it("total ve totalPages'i ATMAZ", () => {
    const res = readPaged<{ id: string }>(
      { items: [{ id: "a" }, { id: "b" }], total: 260, page: 1, limit: 200, totalPages: 2 },
      { page: 1, limit: 200 },
    );
    expect(res.total).toBe(260);
    expect(res.totalPages).toBe(2);
    expect(res.hasMore).toBe(true);
    expect(res.truncated).toBe(false);
  });

  it("son sayfada hasMore false döner", () => {
    const res = readPaged<unknown>(
      { items: [], total: 260, page: 2, limit: 200, totalPages: 2 },
      { page: 2, limit: 200 },
    );
    expect(res.hasMore).toBe(false);
  });

  it("sunucu tavanı istenen limitin ALTINDAysa sunucunun limitini esas alır", () => {
    // /clients ucunun tavanı 100'dür; 200 istense de zarf 100 döner.
    const res = readPaged<unknown>(
      { items: new Array(100).fill({}), total: 260, page: 1, limit: 100, totalPages: 3 },
      { page: 1, limit: 200 },
    );
    expect(res.limit).toBe(100);
    expect(res.totalPages).toBe(3);
    expect(res.hasMore).toBe(true);
  });

  it("totalPages gelmezse total/limit'ten hesaplar", () => {
    const res = readPaged<unknown>({ items: [{}], total: 41, page: 1, limit: 20 }, { page: 1 });
    expect(res.totalPages).toBe(3);
  });

  it("zarfsız uçta limite dayanan liste için truncated bildirir", () => {
    const items = new Array(20).fill({ id: "x" });
    const res = readPaged<unknown>(items, { page: 1, limit: 20 });
    expect(res.truncated).toBe(true);
    expect(res.total).toBe(20);
  });

  it("zarfsız uçta limitin altındaki liste truncated DEĞİLDİR", () => {
    const res = readPaged<unknown>([{ id: "x" }], { page: 1, limit: 20 });
    expect(res.truncated).toBe(false);
  });

  it("boş / bozuk yanıtta çökmeden boş sonuç döner", () => {
    expect(readPaged<unknown>(null).items).toEqual([]);
    expect(readPaged<unknown>(undefined).total).toBe(0);
    expect(readPaged<unknown>("beklenmedik").truncated).toBe(false);
  });
});

describe("fetchPaged — istek kurulumu", () => {
  it("page ve limit'i sorguya ekler, diğer süzgeçleri korur", async () => {
    const calls: FakeCall[] = [];
    mockFetchOnce({ items: [], total: 0, page: 2, limit: 20, totalPages: 1 }, calls);

    await fetchPaged("/cases", { query: { q: "2024/1877" }, page: 2, limit: 20 });

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("q")).toBe("2024/1877");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("limit")).toBe("20");
  });

  it("limit sunucu üst sınırının üstüne ÇIKAMAZ", async () => {
    const calls: FakeCall[] = [];
    mockFetchOnce({ items: [], total: 0, page: 1, limit: 200, totalPages: 1 }, calls);

    await fetchPaged("/deadlines", { limit: 5000 });

    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("limit")).toBe(String(SERVER_MAX_PAGE_SIZE));
  });

  it("limit verilmezse varsayılan sayfa boyutunu kullanır", async () => {
    const calls: FakeCall[] = [];
    mockFetchOnce({ items: [], total: 0, page: 1, limit: 20, totalPages: 1 }, calls);

    await fetchPaged("/tasks");

    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("limit")).toBe(String(DEFAULT_PAGE_SIZE));
    expect(url.searchParams.get("page")).toBe("1");
  });

  it("260 kayıtlı listede ikinci sayfaya geçilebildiğini zarftan bildirir", async () => {
    const calls: FakeCall[] = [];
    mockFetchOnce(
      { items: [{ id: "d1" }], total: 260, page: 1, limit: 200, totalPages: 2 },
      calls,
    );

    const res = await fetchPaged<{ id: string }>("/deadlines", { limit: 200 });

    // Kırılan davranış: 60 süre erişilemez kalıyordu ve kimse fark etmiyordu.
    expect(res.total).toBe(260);
    expect(res.hasMore).toBe(true);
  });
});
