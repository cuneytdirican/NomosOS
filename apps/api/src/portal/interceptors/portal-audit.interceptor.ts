import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { throwError } from "rxjs";
import { catchError, tap } from "rxjs/operators";
import type { Observable } from "rxjs";
import {
  PORTAL_AUDIT_ACTION_KEY,
  PORTAL_AUDIT_RESOURCE_KEY,
} from "../decorators/portal-audit.decorator";
import { PortalAuditService } from "../portal-audit.service";
import type { PortalAuthUser } from "../portal.types";

/**
 * HER PORTAL İSTEĞİ DENETLENİR (görev tanımı §3, spec §İş Kuralları 7).
 *
 * Denetim çağrısını her servis metoduna elle serpiştirmek yerine tek bir
 * kesişim noktasına konur: yeni bir portal ucu eklendiğinde iz tutmayı
 * UNUTMAK MÜMKÜN DEĞİLDİR. Eylem adı `@PortalAudit("...")` ile verilir;
 * verilmezse yol ve yöntemden jenerik bir ad türetilir.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ BAŞARISIZ ERİŞİMLER DE KAYDEDİLİR (denetim bulgusu 15)                   ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Burada eskiden yalnızca `tap(...)` vardı, yani SADECE başarılı yanıtlar
 * yazılıyordu. Gerekçe "404 gövdesi zaten veri göstermez" idi ve gövde için
 * doğruydu — ama yanlış soruyu cevaplıyordu. Denetim izinin amacı veriyi
 * gizlemek değil, DENEMEYİ kayda geçirmektir:
 *
 *   Bir gün başka bir uçtan (bir hata mesajı, bir günlük satırı) sızmış
 *   GERÇEK bir id ile yapılan yatay erişim denemesi de aynı biçimde izsiz
 *   kalıyordu. KVKK ihlal soruşturmasında "bu müvekkil başka müvekkilin
 *   dosyasına erişmeye ÇALIŞTI MI?" sorusu cevaplanamıyordu. Modül 10
 *   §İş Kuralları 7'nin ("her portal erişimi kaydedilir") amacı tam olarak budur.
 *
 * 401'ler DIŞARIDA KALIR: kimliksiz bir istekte yazılacak `portalUserId`
 * yoktur (ve alan zorunludur). O akışların kaydını `PortalAuthService` yazar.
 * Diğer tüm hatalar `PORTAL_ACCESS_DENIED` eylemiyle, istenen kaynağın
 * kimliğiyle birlikte kaydedilir.
 *
 * Kayıt İSTEĞİ BEKLETMEZ: `void` ile ateşlenir, hata yutulur (servis zaten
 * kendi içinde yakalar). Müvekkilin dosyasını görmesi, denetim satırının
 * yazılmasını beklemek zorunda değildir.
 */
@Injectable()
export class PortalAuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: PortalAuditService
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { portalUser?: PortalAuthUser }>();

    const action =
      this.reflector.getAllAndOverride<string>(PORTAL_AUDIT_ACTION_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? fallbackAction(request);

    const resourceType =
      this.reflector.getAllAndOverride<string | null>(PORTAL_AUDIT_RESOURCE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? undefined;

    return next.handle().pipe(
      tap(() => {
        // Kimliksiz uçlar (giriş, davet kabulü) burada kaydedilmez: bir
        // portalUserId yoktur ve PortalAuditLog.portalUserId zorunludur.
        // O akışların kaydını PortalAuthService kendisi yazar.
        const user = request.portalUser;
        if (!user) return;
        void this.audit.log({
          tenantId: user.tenantId,
          portalUserId: user.portalUserId,
          action,
          resourceType,
          resourceId: singleParam(request),
          ipAddress: user.ip,
        });
      }),
      catchError((err: unknown) => {
        const user = request.portalUser;
        const status = err instanceof HttpException ? err.getStatus() : 500;
        // 401 = kimlik yok → yazacak portalUserId de yok.
        if (user && status !== 401) {
          void this.audit.log({
            tenantId: user.tenantId,
            portalUserId: user.portalUserId,
            // Eylem adı REDDEDİLDİĞİNİ söyler; hangi ucun denendiği ve hangi
            // kaynağın istendiği ayrıca yazılır.
            action: `PORTAL_ACCESS_DENIED:${action}`.slice(0, 160),
            resourceType,
            resourceId: singleParam(request),
            ipAddress: user.ip,
          });
        }
        return throwError(() => err);
      })
    );
  }
}

/** `@PortalAudit` yazılmamışsa: "PORTAL_GET_/api/v1/portal/cases" gibi bir ad. */
function fallbackAction(request: Request): string {
  const method = (request.method ?? "GET").toUpperCase();
  const path = (request.route?.path ?? request.path ?? "").slice(0, 120);
  return `PORTAL_${method}_${path}`.slice(0, 160);
}

/**
 * Yol parametresi varsa denetime iliştirilir (`/cases/:id` → id).
 * Birden çok parametre varsa hangisinin kaynak olduğu belirsizdir; o hâlde
 * hiçbiri yazılmaz — yanlış bir kaynak kimliği, kayıtsızlıktan kötüdür.
 */
function singleParam(request: Request): string | undefined {
  const params = request.params as Record<string, string> | undefined;
  if (!params) return undefined;
  const values = Object.values(params);
  return values.length === 1 ? values[0]?.slice(0, 64) : undefined;
}
