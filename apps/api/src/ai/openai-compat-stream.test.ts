/**
 * OpenAI-uyumlu adaptör — AKIŞLI yanıt (SSE). Canlı bulgu (LM Studio, 5 Eylül 2026):
 * yavaş yerel model ilk baytı 5 dk'dan geç gönderince undici başlık zaman aşımı
 * (UND_ERR_HEADERS_TIMEOUT) isteği düşürüyordu. Akışta parçalar birleştirilir,
 * kullanım son parçadan okunur; akışı reddeden sunucuda akışsız yinelenir.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiCompatProvider, readSseChat } from "@nomosos/ai";

function sse(lines: string[], contentType = "text/event-stream") {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      // Parçaları satır ortasından böl — tampon birleştirme sınanır.
      const text = lines.join("\n") + "\n";
      const mid = Math.floor(text.length / 2);
      controller.enqueue(enc.encode(text.slice(0, mid)));
      controller.enqueue(enc.encode(text.slice(mid)));
      controller.close();
    },
  });
  return { ok: true, status: 200, headers: new Headers({ "content-type": contentType }), body, json: async () => ({}), text: async () => "" };
}
const chunk = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`;
const usage = `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 120, completion_tokens: 45 } })}`;

afterEach(() => vi.unstubAllGlobals());

describe("readSseChat", () => {
  it("delta parçalarını birleştirir, usage'ı son parçadan alır, [DONE] ve bozuk satırları yok sayar", async () => {
    const res = sse([": ısınma", chunk("Merhaba"), "data: {bozuk", chunk(" dünya"), usage, "data: [DONE]"]);
    const r = await readSseChat(res as unknown as Response);
    expect(r).toEqual({ content: "Merhaba dünya", inputTokens: 120, outputTokens: 45 });
  });

  it("akış içi hata nesnesi → istisna", async () => {
    const res = sse([`data: ${JSON.stringify({ error: { message: "Context size has been exceeded." } })}`]);
    await expect(readSseChat(res as unknown as Response)).rejects.toThrow(/Context size/);
  });
});

describe("OpenAiCompatProvider.chat akış", () => {
  const provider = () => new OpenAiCompatProvider({ type: "OPENAI_COMPAT", baseUrl: "http://lm:1234/v1", apiKey: "k", defaultModel: "m" });
  const opts = { model: "m", messages: [{ role: "user" as const, content: "x" }] };
  const sent = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => JSON.parse((c[1] as { body: string }).body) as Record<string, unknown>);

  it("stream:true + include_usage gönderir; SSE gövdesini birleştirir", async () => {
    const f = vi.fn(async () => sse([chunk("A"), chunk("B"), usage, "data: [DONE]"]));
    vi.stubGlobal("fetch", f);
    const r = await provider().chat(opts);
    expect(r).toEqual({ content: "AB", inputTokens: 120, outputTokens: 45 });
    expect(sent(f)[0]).toMatchObject({ stream: true, stream_options: { include_usage: true } });
  });

  it("akışı reddeden sunucu (400) → akışsız yineleme, JSON gövde okunur", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 400, headers: new Headers(), json: async () => ({}), text: async () => "stream unsupported" })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ choices: [{ message: { content: "düz" } }], usage: { prompt_tokens: 1, completion_tokens: 2 } }), text: async () => "" });
    vi.stubGlobal("fetch", f);
    const r = await provider().chat(opts);
    expect(r).toEqual({ content: "düz", inputTokens: 1, outputTokens: 2 });
    expect(sent(f).map((b) => b.stream ?? null)).toEqual([true, null]);
  });

  it("JSON modu + akış: json_schema akışlı reddedilirse akışsız json_schema, sonra json_object akışlı denenir", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 400, headers: new Headers(), json: async () => ({}), text: async () => "x" })
      .mockResolvedValueOnce({ ok: false, status: 400, headers: new Headers(), json: async () => ({}), text: async () => "x" })
      .mockResolvedValueOnce(sse([chunk("{}"), "data: [DONE]"]));
    vi.stubGlobal("fetch", f);
    const r = await provider().chat({ ...opts, responseFormat: "json" });
    expect(r.content).toBe("{}");
    const b = sent(f);
    expect(b[0]).toMatchObject({ stream: true, response_format: { type: "json_schema" } });
    expect(b[1]).toMatchObject({ response_format: { type: "json_schema" } });
    expect(b[1].stream).toBeUndefined();
    expect(b[2]).toMatchObject({ stream: true, response_format: { type: "json_object" } });
  });
});
