/**
 * İSTEK BAĞLAMI (Faz 4 — operasyon): korelasyon kimliği + erişim günlüğü + HTTP metrikleri.
 *
 *  - `x-request-id`: istemci gönderdiyse (ters vekil/Caddy) korunur, yoksa üretilir;
 *    yanıta da yazılır. Destek, kullanıcının gördüğü `ref` ile sunucu günlüğünü eşler.
 *  - `AsyncLocalStorage`: aynı isteğin tüm günlük satırları (`JsonLogger`) ve hata
 *    filtresi kimliği buradan okur — parametre taşımaya gerek yok.
 *  - Erişim günlüğü: bitişte tek satır (yöntem, yol, durum, süre, kiracı) — sır yok,
 *    gövde yok, sorgu dizesi yok (KVKK: URL'de TCKN olabilir; yalnız rota kalıbı).
 *  - Metrik: `observeHttp` (süre histogramı + durum sayacı) rota kalıbıyla etiketlenir
 *    (`/api/v1/cases/:id`), ham kimliklerle değil — kardinalite patlamaz.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { observeHttp } from "../metrics/metrics.registry";

export interface RequestContext {
  requestId: string;
  startedAt: number;
  method: string;
  path: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function currentRequestId(): string | null {
  return requestContext.getStore()?.requestId ?? null;
}

const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{8,128}$/;

export function pickRequestId(header: string | string[] | undefined): string {
  const raw = Array.isArray(header) ? header[0] : header;
  return raw && REQUEST_ID_RE.test(raw) ? raw : randomUUID();
}

/** Eşleşen rota kalıbı (Express `req.route`), yoksa sorgu dizesinden arındırılmış yol. */
export function routePattern(req: Request): string {
  const route = (req as Request & { route?: { path?: string } }).route?.path;
  if (route) return `${req.baseUrl ?? ""}${route}`;
  return (req.originalUrl ?? req.url ?? "").split("?")[0].replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id");
}

export interface AccessLogSink {
  log(entry: Record<string, unknown>): void;
}

/**
 * Express ara katmanı: bağlamı kurar, yanıtta `x-request-id` döner, bitişte erişim
 * günlüğü + metrik yazar. Sağlık/metrik uçları günlükten muaftır (gürültü).
 */
export function requestContextMiddleware(sink: AccessLogSink) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const requestId = pickRequestId(req.headers["x-request-id"]);
    res.setHeader("x-request-id", requestId);
    const ctx: RequestContext = { requestId, startedAt: Date.now(), method: req.method, path: (req.originalUrl ?? req.url ?? "").split("?")[0] };
    res.on("finish", () => {
      const durationMs = Date.now() - ctx.startedAt;
      const route = routePattern(req);
      const quiet = ctx.path.includes("/health") || ctx.path === "/metrics";
      observeHttp(req.method, route, res.statusCode, durationMs);
      if (quiet) return;
      const user = (req as Request & { user?: { tenantId?: string; userId?: string } }).user;
      sink.log({
        msg: "http",
        reqId: requestId,
        method: req.method,
        route,
        path: ctx.path,
        status: res.statusCode,
        durationMs,
        tenantId: user?.tenantId ?? null,
        userId: user?.userId ?? null,
        ip: req.ip ?? null,
        ua: (req.headers["user-agent"] ?? "").toString().slice(0, 120),
      });
    });
    requestContext.run(ctx, () => next());
  };
}
