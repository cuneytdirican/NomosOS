import { afterEach, describe, expect, it, vi } from "vitest";
import { JsonLogger, formatJsonLine, resolveLogFormat } from "./json-logger";
import { requestContext } from "./request-context";

describe("json-logger", () => {
  afterEach(() => vi.restoreAllMocks());

  it("resolveLogFormat: açık ayar > üretimde json > geliştirmede pretty", () => {
    expect(resolveLogFormat({ LOG_FORMAT: "json" } as NodeJS.ProcessEnv)).toBe("json");
    expect(resolveLogFormat({ LOG_FORMAT: "pretty", NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe("pretty");
    expect(resolveLogFormat({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe("json");
    expect(resolveLogFormat({} as NodeJS.ProcessEnv)).toBe("pretty");
  });

  it("formatJsonLine: pino uyumlu alanlar (level sayı, time, msg, context) ve bağlamdan reqId", () => {
    const line = JSON.parse(formatJsonLine("warn", "Dikkat", "Test", { extra: 1 }, 1700000000000));
    expect(line).toMatchObject({ level: 40, time: 1700000000000, msg: "Dikkat", context: "Test", extra: 1 });
    expect(line.reqId).toBeUndefined();
    const inCtx = requestContext.run({ requestId: "req-1", startedAt: 0, method: "GET", path: "/" }, () => JSON.parse(formatJsonLine("log", "içeride")));
    expect(inCtx).toMatchObject({ level: 30, reqId: "req-1", msg: "içeride" });
    expect(JSON.parse(formatJsonLine("error", new Error("patladı"))).msg).toBe("Error: patladı");
  });

  it("JsonLogger: seviye eşiği; error stderr'a, log stdout'a; bağlam son parametreden", () => {
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logger = new JsonLogger("warn");
    logger.log("gizli");
    logger.warn("uyarı", "Ctx");
    logger.error("hata", "Error: x\n    at y", "Ctx2");
    expect(out).toHaveBeenCalledTimes(1); // yalnız warn (log eşiğin altında)
    expect(JSON.parse(String(out.mock.calls[0][0]))).toMatchObject({ level: 40, msg: "uyarı", context: "Ctx" });
    expect(JSON.parse(String(err.mock.calls[0][0]))).toMatchObject({ level: 50, msg: "hata", context: "Ctx2" });
    expect(JSON.parse(String(err.mock.calls[0][0])).stack).toContain("at y");
    logger.access({ msg: "http", status: 200 });
    expect(out).toHaveBeenCalledTimes(1); // access = level 30 < warn eşiği; yazılmadı
  });
});
