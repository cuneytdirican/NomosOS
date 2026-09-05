/**
 * GLOBAL ORAN SINIRI (Faz 4) — her uç için kaba tavan; AI uçlarının ince sınırı
 * (`AiRateLimitGuard`) ve giriş kapısı (`LoginThrottleGuard`) ayrıca koşar.
 *
 * Anahtar: kimlikli istekte kullanıcı (`user:<id>`), kimliksiz istekte IP (`ip:<addr>`).
 * Pencere 60 sn. Varsayılanlar: IP 300/dk, kullanıcı 600/dk (env `RATE_LIMIT_GLOBAL_PER_IP`,
 * `RATE_LIMIT_GLOBAL_PER_USER`; 0 = kapalı). Sayaç deposu `getCounterStore()`: REDIS_URL
 * varsa Redis (çok örnekli kurulumda ortak), yoksa süreç-içi.
 *
 * Muaf: /health*, /metrics, sağlayıcı geri dönüşleri (webhook/callback — imza zaten
 * doğrulanır). Aşımda 429 + `Retry-After` + Türkçe mesaj; sayaç deposu hata verirse
 * istek GEÇER (fail-open) — oran sınırı kullanılabilirliği kesmemeli, günlüğe yazılır.
 *
 * `JwtAuthGuard`'dan ÖNCE kayıtlıdır; bu yüzden kullanıcı kimliği yalnız çerez/başlık
 * çözümlendiyse görünür — kimlik çözülmeden önce IP anahtarı kullanılır (yeterli).
 */

import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import { getCounterStore } from "../rate-limit/counter-store";
import { httpRequests } from "../../metrics/metrics.registry";

const WINDOW_MS = 60_000;
const EXEMPT_PREFIXES = ["/api/v1/health", "/metrics", "/api/v1/billing/odeme/webhook", "/api/v1/billing/odeme/callback", "/api/v1/integrations/webhooks/"];

export function globalLimits(env: NodeJS.ProcessEnv = process.env): { perIp: number; perUser: number } {
  const n = (v: string | undefined, d: number) => {
    const p = Number.parseInt(v ?? "", 10);
    return Number.isFinite(p) && p >= 0 ? p : d;
  };
  return { perIp: n(env.RATE_LIMIT_GLOBAL_PER_IP, 300), perUser: n(env.RATE_LIMIT_GLOBAL_PER_USER, 600) };
}

export function isExemptPath(path: string): boolean {
  return EXEMPT_PREFIXES.some((p) => path.startsWith(p));
}

@Injectable()
export class GlobalRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(GlobalRateLimitGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: { userId?: string } }>();
    const res = context.switchToHttp().getResponse<Response>();
    const path = (req.originalUrl ?? req.url ?? "").split("?")[0];
    if (isExemptPath(path)) return true;

    const limits = globalLimits();
    const userId = req.user?.userId;
    const key = userId ? `global:user:${userId}` : `global:ip:${req.ip ?? "bilinmiyor"}`;
    const limit = userId ? limits.perUser : limits.perIp;
    if (limit === 0) return true;

    try {
      const window = await getCounterStore().increment(key, WINDOW_MS, 1);
      const remaining = Math.max(0, limit - window.count);
      res.setHeader("X-RateLimit-Limit", String(limit));
      res.setHeader("X-RateLimit-Remaining", String(remaining));
      if (window.count > limit) {
        const retryAfter = Math.max(1, Math.ceil((window.resetAt - Date.now()) / 1000));
        res.setHeader("Retry-After", String(retryAfter));
        httpRequests.labels(req.method, "rate-limited", "429").inc();
        throw new HttpException(
          `Çok fazla istek: dakikada en fazla ${limit} istek. ${retryAfter} sn sonra tekrar deneyin.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      return true;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.warn(`Oran sınırı sayacı okunamadı; istek geçirildi: ${(err as Error).message}`);
      return true;
    }
  }
}
