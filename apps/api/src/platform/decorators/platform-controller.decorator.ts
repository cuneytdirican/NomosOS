import { Controller, UseGuards, applyDecorators } from "@nestjs/common";
import { Public } from "../../common/decorators/public.decorator";
import { PlatformJwtGuard } from "../guards/platform-jwt.guard";
import { PlatformPermissionGuard } from "../guards/platform-permission.guard";

/**
 * PLATFORM CONTROLLER BİLEŞİK DEKORATÖRÜ.
 *
 * Üç şeyi bir arada yapar ve her platform controller'ı bunu kullanır:
 *
 * 1. `@Controller(path)` — yol.
 *
 * 2. `@Public()` — TENANT guard'ını devre dışı bırakır. `app.module.ts` içinde
 *    `APP_GUARD` olarak kayıtlı `JwtAuthGuard` GLOBAL çalışır ve platform
 *    token'ını (tenant tablosunda karşılığı olmadığı için) 401 ile reddederdi.
 *    `@Public()` yalnızca TENANT zincirini atlatır; uç açıkta kalmaz, çünkü…
 *
 * 3. `@UseGuards(PlatformJwtGuard, PlatformPermissionGuard)` — …platform
 *    kimliği ve yetki matrisi controller düzeyinde uygulanır. Sıra önemlidir:
 *    önce kimlik (request.platformUser kurulur), sonra yetki.
 *
 * ENTEGRASYON NOTU: bu tasarım sayesinde `app.module.ts` ve `main.ts`
 * dosyalarına dokunmadan iki ayrı kimlik zinciri yan yana çalışır.
 */
export function PlatformController(path: string) {
  return applyDecorators(
    Controller(path),
    Public(),
    UseGuards(PlatformJwtGuard, PlatformPermissionGuard)
  );
}
