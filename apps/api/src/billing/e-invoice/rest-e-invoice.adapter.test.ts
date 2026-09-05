import { afterEach, describe, expect, it, vi } from "vitest";
import * as ai from "@nomosos/ai";
import { RestEInvoiceAdapter } from "./rest-e-invoice.adapter";
import type { UblInvoicePayload } from "./e-invoice.types";

vi.mock("@nomosos/ai", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@nomosos/ai")>();
  return { ...mod, fetchWithTimeout: vi.fn() };
});
const fetchMock = ai.fetchWithTimeout as unknown as ReturnType<typeof vi.fn>;
afterEach(() => fetchMock.mockReset());

const res = (status: number, body: unknown, pdf = false) => ({
  ok: status < 300,
  status,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  arrayBuffer: async () => (pdf ? new TextEncoder().encode("%PDF-1.4 test").buffer : new ArrayBuffer(0)),
});
const adapter = new RestEInvoiceAdapter({ baseUrl: "https://entegrator.example/api/", apiKey: "KEY", senderAlias: "urn:mail:defaultpk@buro.av.tr" });

describe("RestEInvoiceAdapter (fixture)", () => {
  it("mükellef sorgusu: GET /taxpayers/{vkn}, Bearer + X-Sender-Alias", async () => {
    fetchMock.mockResolvedValueOnce(res(200, { isEInvoiceUser: true, alias: "urn:mail:pk@musteri.com", title: "Müşteri A.Ş." }));
    const r = await adapter.checkTaxpayer("1234567890");
    expect(r).toEqual({ isEInvoiceUser: true, alias: "urn:mail:pk@musteri.com", title: "Müşteri A.Ş." });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://entegrator.example/api/taxpayers/1234567890");
    const h = init.headers as Record<string, string>;
    expect(h.authorization).toBe("Bearer KEY");
    expect(h["x-sender-alias"]).toBe("urn:mail:defaultpk@buro.av.tr");
  });

  it("gönderim: POST /invoices, Idempotency-Key = uuid; providerRef zorunlu; durum eşlemesi", async () => {
    fetchMock.mockResolvedValueOnce(res(201, { providerRef: "REF-1", gibUuid: "u-1", status: "GONDERILDI" }));
    const payload = { uuid: "u-1", invoiceNumber: "NOM2026000001" } as UblInvoicePayload;
    const r = await adapter.sendInvoice(payload);
    expect(r).toEqual({ providerRef: "REF-1", gibUuid: "u-1", status: "GONDERILDI" });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("u-1");
    fetchMock.mockResolvedValueOnce(res(200, { gibUuid: "u-1" }));
    await expect(adapter.sendInvoice(payload)).rejects.toThrow("providerRef");
  });

  it("durum / iptal / pdf; HTTP hatası fırlatır (fatura alanı değişmez)", async () => {
    fetchMock.mockResolvedValueOnce(res(200, { status: "kabul" }));
    expect(await adapter.getStatus("REF-1")).toBe("KABUL");
    fetchMock.mockResolvedValueOnce(res(200, { status: "garip" }));
    expect(await adapter.getStatus("REF-1")).toBe("BILINMIYOR");
    fetchMock.mockResolvedValueOnce(res(204, ""));
    await expect(adapter.cancelInvoice("REF-1", "yanlış kesildi")).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(res(200, "", true));
    expect((await adapter.downloadPdf("REF-1")).toString().startsWith("%PDF")).toBe(true);
    fetchMock.mockResolvedValueOnce(res(502, "Bad Gateway"));
    await expect(adapter.getStatus("REF-1")).rejects.toThrow("HTTP 502");
  });
});
