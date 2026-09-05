import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { currentRequestId, pickRequestId, requestContextMiddleware, routePattern } from "./request-context";

function fakeReq(over: Partial<Request> & { route?: { path: string } } = {}): Request {
  return { method: "GET", originalUrl: "/api/v1/cases/123?x=1", url: "/api/v1/cases/123?x=1", headers: {}, baseUrl: "", ip: "1.2.3.4", ...over } as unknown as Request;
}
function fakeRes() {
  const headers: Record<string, string> = {};
  const listeners: Record<string, () => void> = {};
  return {
    headers,
    statusCode: 200,
    setHeader: (k: string, v: string) => { headers[k] = v; },
    on: (ev: string, fn: () => void) => { listeners[ev] = fn; },
    finish: () => listeners.finish?.(),
  } as unknown as Response & { headers: Record<string, string>; finish: () => void };
}

describe("request-context", () => {
  it("pickRequestId: geçerli başlık korunur, geçersiz/eksikte UUID üretilir", () => {
    expect(pickRequestId("abc-123-def-456")).toBe("abc-123-def-456");
    expect(pickRequestId("kısa")).toMatch(/^[0-9a-f-]{36}$/);
    expect(pickRequestId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
    expect(pickRequestId("x".repeat(200))).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("routePattern: eşleşen rota kalıbı; yoksa UUID'ler :id olur ve sorgu düşer", () => {
    expect(routePattern(fakeReq({ baseUrl: "/api/v1", route: { path: "/cases/:id" } }))).toBe("/api/v1/cases/:id");
    expect(routePattern(fakeReq({ originalUrl: "/api/v1/cases/3f2504e0-4f89-11d3-9a0c-0305e82c3301/notes?p=2" }))).toBe("/api/v1/cases/:id/notes");
  });

  it("middleware: x-request-id yanıta yazılır, bağlam içinde okunur, bitişte erişim günlüğü yazılır", () => {
    const sink = { log: vi.fn() };
    const mw = requestContextMiddleware(sink);
    const req = fakeReq({ headers: { "x-request-id": "istemci-req-0001" } as never, route: { path: "/cases/:id" }, baseUrl: "/api/v1" });
    const res = fakeRes();
    let seen: string | null = null;
    mw(req, res, () => { seen = currentRequestId(); });
    expect(seen).toBe("istemci-req-0001");
    expect(res.headers["x-request-id"]).toBe("istemci-req-0001");
    res.statusCode = 404;
    res.finish();
    expect(sink.log).toHaveBeenCalledWith(expect.objectContaining({ msg: "http", reqId: "istemci-req-0001", route: "/api/v1/cases/:id", status: 404, method: "GET" }));
    const entry = (sink.log.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(entry.path).toBe("/api/v1/cases/123"); // sorgu dizesi yok
  });

  it("sağlık/metrik uçları erişim günlüğüne yazılmaz", () => {
    const sink = { log: vi.fn() };
    const res = fakeRes();
    requestContextMiddleware(sink)(fakeReq({ originalUrl: "/api/v1/health/live", url: "/api/v1/health/live" }), res, () => undefined);
    res.finish();
    expect(sink.log).not.toHaveBeenCalled();
    expect(currentRequestId()).toBeNull(); // bağlam dışında
  });
});
