/**
 * OpenAI-uyumlu adaptör — JSON modu sözlük uyumu (LM Studio bulgusu, 5 Eylül 2026):
 * LM Studio yalnız `json_schema`, eski OpenAI-uyumlular yalnız `json_object` kabul
 * eder. Her biçim önce AKIŞLI, 400'de akışsız denenir; ikisi de 400 ise sıradaki
 * biçime geçilir: json_schema → json_object → ipucusuz. 400 dışı yanıt yinelenmez;
 * "text" biçiminde response_format hiç gitmez.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiCompatProvider } from "@nomosos/ai";

const ok = (content: string) => ({
  ok: true,
  status: 200,
  headers: new Headers({ "content-type": "application/json" }),
  json: async () => ({ choices: [{ message: { content } }], usage: {} }),
  text: async () => "",
});
const bad = (msg: string) => ({ ok: false, status: 400, headers: new Headers(), json: async () => ({}), text: async () => msg });

function provider() {
  return new OpenAiCompatProvider({ type: "OPENAI_COMPAT", baseUrl: "http://lm:1234/v1", apiKey: "k", defaultModel: "m" });
}
const opts = { model: "m", messages: [{ role: "user" as const, content: "x" }], responseFormat: "json" as const };
const sent = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map((c) => {
    const b = JSON.parse((c[1] as { body: string }).body) as { response_format?: { type: string }; stream?: boolean };
    return `${b.response_format?.type ?? "-"}${b.stream ? "+s" : ""}`;
  });

afterEach(() => vi.unstubAllGlobals());

describe("OpenAiCompatProvider JSON modu", () => {
  it("LM Studio: json_schema (akışlı) ilk denemede kabul edilir", async () => {
    const f = vi.fn(async () => ok('{"a":1}'));
    vi.stubGlobal("fetch", f);
    expect((await provider().chat(opts)).content).toBe('{"a":1}');
    expect(sent(f)).toEqual(["json_schema+s"]);
    const body = JSON.parse(((f.mock.calls[0] as unknown[])[1] as { body: string }).body);
    expect(body.response_format).toEqual({ type: "json_schema", json_schema: { name: "nomosos_output", schema: { type: "object" } } });
  });

  it("eski sunucu: json_schema (akışlı+akışsız) 400 → json_object", async () => {
    const f = vi.fn().mockResolvedValueOnce(bad("x")).mockResolvedValueOnce(bad("x")).mockResolvedValueOnce(ok("{}"));
    vi.stubGlobal("fetch", f);
    await provider().chat(opts);
    expect(sent(f)).toEqual(["json_schema+s", "json_schema", "json_object+s"]);
  });

  it("hiçbiri yok: dört 400 → ipucusuz beşinci deneme; hepsi 400 ise hata (6 çağrı)", async () => {
    const f = vi.fn().mockResolvedValueOnce(bad("a")).mockResolvedValueOnce(bad("b")).mockResolvedValueOnce(bad("c")).mockResolvedValueOnce(bad("d")).mockResolvedValueOnce(ok("{}"));
    vi.stubGlobal("fetch", f);
    await provider().chat(opts);
    expect(sent(f)).toEqual(["json_schema+s", "json_schema", "json_object+s", "json_object", "-+s"]);
    const g = vi.fn(async () => bad("son"));
    vi.stubGlobal("fetch", g);
    await expect(provider().chat(opts)).rejects.toThrow(/400/);
    expect(g).toHaveBeenCalledTimes(6);
  });

  it("500 yinelenmez; text biçiminde response_format gönderilmez", async () => {
    const f = vi.fn(async () => ({ ok: false, status: 500, headers: new Headers(), json: async () => ({}), text: async () => "down" }));
    vi.stubGlobal("fetch", f);
    await expect(provider().chat(opts)).rejects.toThrow(/500/);
    expect(f).toHaveBeenCalledTimes(1);
    const g = vi.fn(async () => ok("düz"));
    vi.stubGlobal("fetch", g);
    expect((await provider().chat({ ...opts, responseFormat: "text" })).content).toBe("düz");
    expect(sent(g)).toEqual(["-+s"]);
  });
});
