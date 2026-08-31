import { Controller, UseGuards, UseInterceptors, applyDecorators } from "@nestjs/common";
import { Public } from "../../common/decorators/public.decorator";
import { PortalJwtGuard } from "../guards/portal-jwt.guard";
import { PortalRateLimit, PortalRateLimitGuard } from "../guards/portal-rate-limit.guard";
import { PortalAuditInterceptor } from "../interceptors/portal-audit.interceptor";

/**
 * HER PORTAL UCUNUN VARSAYILAN HIZ SINIRI (denetim bulgusu 15).
 *
 * Eskiden yalnızca `POST /messages` ve kimlik uçlarında kova vardı; veri
 * uçlarında (`GET /cases/:id`, `GET /documents/:id/download`) HİÇ SINIR YOKTU.
 * Kimliği doğrulanmış bir portal kullanıcısı saniyede yüzlerce istek atabilir
 * ve her istek `assertPublished` üzerinden 2-3 Prisma sorgusu çalıştırırdı —
 * ucuz bir hizmet dışı bırakma yüzeyi.
 *
 * Sınır ELVERİŞLİDİR: dakikada 120 istek, normal bir müvekkilin gezinmesinden
 * kat kat yüksektir ama sınırsız tarama denemesini durdurur. Uç bazlı
 * `@PortalRateLimit` bu varsayılanı EZER (`getAllAndOverride` handler'ı önce
 * okur), yani mesaj yazma kovası dakikada 10'da kalır.
 */
const PORTAL_DEFAULT_RATE_LIMIT = {
  limit: 120,
  windowMs: 60_000,
  bucket: "portal-genel",
} as const;

/**
 * PORTAL CONTROLLER BİLEŞİK DEKORATÖRÜ.
 *
 * Dört şeyi bir arada yapar; HER portal controller'ı bunu kullanır ve başka
 * hiçbir yol portal uçlarına erişemez:
 *
 * 1. `@Controller(path)` — yol. Global önek (`api/v1`) uygulanır, yani
 *    `@PortalController("portal/cases")` → `/api/v1/portal/cases`.
 *
 * 2. `@Public()` — BÜRO guard zincirini (`JwtAuthGuard` + `TenantStatusGuard`)
 *    devre dışı bırakır. Bunlar `app.module.ts`'te APP_GUARD olarak GLOBAL
 *    çalışır ve portal token'ını (büro User tablosunda karşılığı olmadığı için)
 *    401 ile reddederdi. Uç açıkta kalmaz, çünkü…
 *
 * 3. `@UseGuards(PortalJwtGuard, PortalRateLimitGuard)` — …portal kimliği
 *    controller düzeyinde uygulanır. Sıra önemlidir: önce kimlik
 *    (`request.portalUser` kurulur), sonra hız sınırı (sayaç anahtarı portal
 *    kullanıcısını kullanabilsin). Kimliksiz uçlar `@PortalAnonymous()` ile
 *    AÇIKÇA işaretlenir; işaretlenmeyen uç KAPALIDIR.
 *
 * 4. `@UseInterceptors(PortalAuditInterceptor)` — her başarılı istek
 *    `PortalAuditLog`'a düşer. Unutulması mümkün değildir.
 *
 * ENTEGRASYON NOTU: bu tasarım sayesinde `app.module.ts` ve `main.ts`
 * dosyalarına DOKUNMADAN üçüncü kimlik zinciri yan yana çalışır — platform
 * modülünde uygulanan desenin aynısı.
 */
export function PortalController(path: string) {
  return applyDecorators(
    Controller(path),
    Public(),
    // Controller düzeyinde varsayılan kova; uç bazlı `@PortalRateLimit` ezer.
    PortalRateLimit(PORTAL_DEFAULT_RATE_LIMIT),
    UseGuards(PortalJwtGuard, PortalRateLimitGuard),
    UseInterceptors(PortalAuditInterceptor)
  );
}
