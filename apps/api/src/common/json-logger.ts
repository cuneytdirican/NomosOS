/**
 * JSON GÜNLÜK (Faz 4) — Nest `LoggerService`; pino uyumlu satır biçimi.
 *
 * `LOG_FORMAT=json` (üretim varsayılanı) → her satır tek JSON nesnesi:
 *   {"level":30,"time":1725500000000,"msg":"...","context":"Nest","reqId":"…","pid":1,"hostname":"api-1"}
 * pino seviyeleri (10 trace … 60 fatal) kullanılır; `pino-pretty`, Loki, Datadog, ELK
 * doğrudan okur. Geliştirmede (`LOG_FORMAT=pretty` ya da tanımsız + NODE_ENV≠production)
 * Nest'in renkli konsol biçimi kalır.
 *
 * `reqId` istek bağlamından (`request-context.ts`) otomatik eklenir; parametre taşınmaz.
 * Sır yazmaz: mesajlar zaten sanitize edilmiş Türkçe metinlerdir; gövde/başlık girmez.
 */

import { ConsoleLogger, type LoggerService } from "@nestjs/common";
import { hostname } from "node:os";
import { currentRequestId } from "./request-context";

export type LogFormat = "json" | "pretty";

export function resolveLogFormat(env: NodeJS.ProcessEnv = process.env): LogFormat {
  const v = env.LOG_FORMAT?.trim().toLowerCase();
  if (v === "json" || v === "pretty") return v;
  return env.NODE_ENV === "production" ? "json" : "pretty";
}

const LEVELS: Record<string, number> = { verbose: 10, debug: 20, log: 30, warn: 40, error: 50, fatal: 60 };

export function formatJsonLine(level: keyof typeof LEVELS, message: unknown, context?: string, extra?: Record<string, unknown>, now = Date.now()): string {
  const msg = typeof message === "string" ? message : message instanceof Error ? `${message.name}: ${message.message}` : JSON.stringify(message);
  const reqId = currentRequestId();
  return JSON.stringify({
    level: LEVELS[level] ?? 30,
    time: now,
    pid: process.pid,
    hostname: hostname(),
    context: context ?? undefined,
    reqId: reqId ?? undefined,
    msg,
    ...(extra ?? {}),
  });
}

export class JsonLogger implements LoggerService {
  private readonly minLevel: number;

  constructor(minLevelName: keyof typeof LEVELS = (process.env.LOG_LEVEL as keyof typeof LEVELS) || "log") {
    this.minLevel = LEVELS[minLevelName] ?? 30;
  }

  private write(level: keyof typeof LEVELS, message: unknown, optional: unknown[]): void {
    if ((LEVELS[level] ?? 30) < this.minLevel) return;
    // Nest çağrı biçimi: (message, [stack?], context?) — son dize bağlamdır.
    const rest = [...optional];
    const context = typeof rest[rest.length - 1] === "string" ? (rest.pop() as string) : undefined;
    const extra: Record<string, unknown> = {};
    if (level === "error" && typeof rest[0] === "string" && rest[0].includes("\n")) extra.stack = rest[0].split("\n").slice(0, 12).join("\n");
    const line = formatJsonLine(level, message, context, extra);
    if (level === "error" || level === "fatal") process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  }

  log(message: unknown, ...optional: unknown[]): void {
    this.write("log", message, optional);
  }
  error(message: unknown, ...optional: unknown[]): void {
    this.write("error", message, optional);
  }
  warn(message: unknown, ...optional: unknown[]): void {
    this.write("warn", message, optional);
  }
  debug(message: unknown, ...optional: unknown[]): void {
    this.write("debug", message, optional);
  }
  verbose(message: unknown, ...optional: unknown[]): void {
    this.write("verbose", message, optional);
  }
  fatal(message: unknown, ...optional: unknown[]): void {
    this.write("fatal", message, optional);
  }

  /** Erişim günlüğü (request-context ara katmanı) — yapısal alanlar korunur. */
  access(entry: Record<string, unknown>): void {
    if (this.minLevel > 30) return;
    process.stdout.write(`${JSON.stringify({ level: 30, time: Date.now(), pid: process.pid, hostname: hostname(), context: "HTTP", ...entry })}\n`);
  }
}

/** Ortama göre günlükçü: JSON ya da Nest konsolu. */
export function createAppLogger(): { logger: LoggerService; access: (entry: Record<string, unknown>) => void; format: LogFormat } {
  const format = resolveLogFormat();
  if (format === "json") {
    const logger = new JsonLogger();
    return { logger, access: (e) => logger.access(e), format };
  }
  const logger = new ConsoleLogger();
  return {
    logger,
    access: (e) => logger.log(`${e.method} ${e.route} → ${e.status} ${e.durationMs}ms${e.reqId ? ` [${String(e.reqId).slice(0, 8)}]` : ""}`, "HTTP"),
    format,
  };
}
