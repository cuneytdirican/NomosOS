import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { attemptCounter } from "./attempt-counter";

/** Pencere başına izin verilen başarısız/toplam deneme sayısı. */
const MAX_ATTEMPTS = 5;

/** Sayaç penceresi (ms). */
const WINDOW_MS = 60_000;


/**
 * Giriş ucu için basit, bağımlılıksız hız sınırlayıcı.
 *
 * `POST /auth/login` @Public olduğu için sınırsız denemeye açıktı; `bcrypt.compare`
 * kasten maliyetli olduğundan bu aynı zamanda ucuz bir DoS yüzeyiydi
 * (denetim bulgusu 19).
 *
 * Anahtar = IP + e-posta. Böylece tek bir IP'den çok hesaba yapılan deneme de,
 * çok IP'den tek hesaba yapılan deneme de sınırlanır.
 *
 * denetim bulgusu Ö-09: SAYAÇ ARTIK SÜREÇ BELLEĞİNDE DEĞİL.
 * Ortak kova `attempt-counter.ts` üzerinden Redis'tedir; üç replikalı bir
 * kurulumda sınır 5'ten 15'e çıkmaz. Redis yoksa süreç-içi kovaya düşülür
 * ve açılışta uyarı basılır (API yine açılır).
 */
@Injectable()
export class LoginThrottleGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const now = Date.now();
    const hit = await attemptCounter().hit(
      `login|${this.buildKey(request)}`,
      WINDOW_MS,
      now
    );

    if (hit.count > MAX_ATTEMPTS) {
      const seconds = Math.max(1, Math.ceil((hit.resetAt - now) / 1000));
      throw new HttpException(
        `Çok fazla giriş denemesi yapıldı. Lütfen ${seconds} saniye sonra tekrar deneyin.`,
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
    return true;
  }

  /** Başarılı girişte sayacı sıfırlar — meşru kullanıcı cezalandırılmasın. */
  async reset(request: Request): Promise<void> {
    await attemptCounter().reset(`login|${this.buildKey(request)}`);
  }

  /**
   * Sayaç anahtarı: IP + KİMLİK.
   *
   * Kimlik önce `email` gövde alanından okunur. `POST /auth/2fa/verify`
   * gövdesinde e-posta YOKTUR (yalnız `challengeToken` + `code`); anahtar bu
   * durumda `ip|-`'ye çöker ve ikinci faktör denemeleri hesap ayrımı olmadan
   * tek kovaya düşerdi (denetim bulgusu 10.1). Bu yüzden e-posta yoksa
   * challenge token'ının `sub` alanı kimlik olarak kullanılır.
   *
   * DİKKAT: token burada DOĞRULANMAZ ve doğrulanmamalıdır — bu bir yetki
   * kararı değil, yalnızca sayaç anahtarıdır. Sahte bir `sub` saldırganı ancak
   * KENDİ kovasından ayırır; gerçek yaptırım hesap düzeyindeki kilittir
   * (PlatformUser.failedAttempts / lockedUntil).
   */
  private buildKey(request: Request): string {
    const ip = request.ip ?? request.socket?.remoteAddress ?? "bilinmeyen";
    const body = request.body as { email?: unknown; challengeToken?: unknown } | undefined;
    if (typeof body?.email === "string") {
      return `${ip}|${body.email.toLowerCase().slice(0, 200)}`;
    }
    if (typeof body?.challengeToken === "string") {
      return `${ip}|challenge:${subjectOf(body.challengeToken)}`;
    }
    return `${ip}|-`;
  }

}

/**
 * JWT gövdesindeki `sub` alanını İMZA DOĞRULAMADAN okur (yalnız sayaç anahtarı).
 * Okunamayan token'lar ortak bir kovada toplanır — bu, en sıkı davranıştır.
 */
function subjectOf(token: string): string {
  const part = token.split(".")[1];
  if (!part) return "gecersiz";
  try {
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === "string" ? sub.slice(0, 64) : "gecersiz";
  } catch {
    return "gecersiz";
  }
}
