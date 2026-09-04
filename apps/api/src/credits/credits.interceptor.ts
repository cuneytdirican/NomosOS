/**
 * KREDİ KAPISI — `@AiCredits()` taşıyan uçları saran NestJS interceptor'ı.
 *
 * `CreditsModule` bunu `APP_INTERCEPTOR` olarak sağlar; yani app.module.ts'e
 * DOKUNULMADAN (yalnız `CreditsModule` import edilerek) tüm uçlarda etkinleşir.
 * Metadata taşımayan uçlarda hiçbir iş yapmadan geçer.
 *
 * SIRALAMA (Nest yürütme hattı):
 *   guard'lar → INTERCEPTOR (ön) → pipe'lar → handler → INTERCEPTOR (son)
 * Kapı pipe'lardan ÖNCE çalıştığı için gövde HAMDIR; kararlar (özellikle
 * `when`) buna göre yazılmalıdır. Bunun karşılığında kazanılan şey büyüktür:
 * geçersiz bir gövde bile kredi rezerve etmeden reddedilir mi? HAYIR — pipe
 * hatası handler'dan önce fırlar, `catchError` dalı rezervasyonu İADE EDER.
 *
 * AsyncLocalStorage: handler `creditRunContext.run()` içinde abone edilir;
 * böylece çağrı zincirinin herhangi bir derinliğindeki LLM yürütücüsü
 * `creditRunContext.record()` ile gerçek token'ı bildirebilir.
 */

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { Observable, from, throwError } from "rxjs";
import { catchError, concatMap, switchMap } from "rxjs/operators";
import type { AuthUser } from "../common/types";
import { AI_CREDITS_KEY, type AiCreditsMeta } from "./ai-credits.decorator";
import { creditRunContext, type CreditRunStore } from "./credit-context";
import { CreditService, type CreditTicket } from "./credit.service";

@Injectable()
export class CreditsInterceptor implements NestInterceptor {
  private readonly logger = new Logger(CreditsInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly credits: CreditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.getAllAndOverride<AiCreditsMeta>(AI_CREDITS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!meta) return next.handle();

    // HTTP dışı bağlamlarda (ileride kuyruk/cron) kapı çalışmaz.
    if (context.getType() !== "http") return next.handle();

    const request = context.switchToHttp().getRequest<
      Request & { user?: AuthUser; params?: Record<string, string> }
    >();
    const user = request.user;
    // Kimlik yoksa JwtAuthGuard zaten reddetmiştir; burada kredi düşmenin
    // anlamı yok (ve tenantId olmadan zaten yapılamaz).
    if (!user?.tenantId) return next.handle();

    const body: unknown = request.body;
    if (meta.when && !meta.when(body)) return next.handle();

    const contextChars = meta.contextChars
      ? Math.max(0, meta.contextChars(body) || 0)
      : approximateBodyChars(body);
    const caseId = meta.caseIdParam
      ? request.params?.[meta.caseIdParam]
      : meta.caseIdFrom
        ? readCaseIdFromBody(meta.caseIdFrom, body)
        : undefined;
    const taskType = (meta.taskTypeFrom ? meta.taskTypeFrom(body) : undefined) ?? meta.taskType;

    // Üst kayıttan (strateji/dilekçe/icra/bilirkişi raporu) dosya kimliği —
    // bu uçlarda yolda `:caseId` yoktur ve bağlam uzunluğu gövdede DEĞİL
    // dosyada durur. Çözüm başarısız olursa tahmin taban fiyata düşer.
    const parentIds = meta.parentCaseId ? collectParentIds(meta.parentCaseId, request, body) : [];

    // Sözleşme analizinde fiyat PARÇA SAYISINA bağlıdır ve metin yine gövdede
    // değil veritabanındadır (ContractVersion.contentText). Kapı üst kayıttan
    // parça ölçüsünü çözer; çözülemezse tahmin taban fiyata düşer.
    const contractVersionId = meta.parentContract?.versionIdFrom
      ? readCaseIdFromBody(meta.parentContract.versionIdFrom, body)
      : undefined;
    const contractParam = meta.parentContract?.param
      ? request.params?.[meta.parentContract.param]
      : undefined;

    return from(
      (async () => {
        const contextCaseIds =
          meta.parentCaseId && parentIds.length > 0
            ? await this.credits.resolveParentCaseIds(
                user.tenantId,
                meta.parentCaseId.kind,
                parentIds,
              )
            : [];
        const contractUnits = meta.parentContract
          ? await this.credits.resolveContractAnalysisUnits(
              user.tenantId,
              contractParam,
              contractVersionId,
            )
          : undefined;
        return this.credits.checkAndReserve({
          user,
          taskType,
          contextChars,
          caseId,
          contextCaseIds,
          ...(contractUnits ? { units: contractUnits } : {}),
        });
      })(),
    ).pipe(
      switchMap((gate) => {
        if (!gate.billed) return next.handle();

        const ticket: CreditTicket = gate.ticket;
        const store: CreditRunStore = this.credits.newStore(ticket);

        // Handler'ı kredi bağlamının İÇİNDE abone et. `next.handle()` çağrısı
        // handler'ı senkron olarak tetikler; ALS bağlamı bütün alt zincire
        // (await'lerin ötesine) taşınır.
        const handled$ = new Observable((subscriber) => {
          let sub: { unsubscribe(): void } | undefined;
          creditRunContext.run(store, () => {
            sub = next.handle().subscribe(subscriber);
          });
          return () => sub?.unsubscribe();
        });

        return handled$.pipe(
          // BAŞARI — gerçek token'a göre mahsuplaş.
          concatMap(async (value) => {
            await this.credits.settle(ticket, store);
            return value;
          }),
          // HATA — sağlayıcı hatası, doğrulama hatası, KVKK 409, iptal:
          // hepsinde rezervasyon iade edilir, HİÇ kredi düşülmez (iş kuralı 4).
          catchError((err: unknown) =>
            from(this.credits.release(ticket, describe(err))).pipe(
              switchMap(() => throwError(() => err)),
            ),
          ),
        );
      }),
    );
  }
}

/** Ham gövdeden dosya kimliği; gövde beklenen biçimde değilse `undefined`. */
function readCaseIdFromBody(
  from: (body: unknown) => string | undefined,
  body: unknown,
): string | undefined {
  try {
    const value = from(body);
    return typeof value === "string" && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `parentCaseId` bildiriminden ham kimlikleri toplar (yol parametresi + gövde).
 * DOĞRULAMA YAPMAZ: kimlik geçersizse çözüm boş döner ve tahmin taban fiyata
 * iner; hata mesajı işin kendi servisinden gelir.
 */
function collectParentIds(
  spec: NonNullable<AiCreditsMeta["parentCaseId"]>,
  request: Request & { params?: Record<string, string> },
  body: unknown,
): string[] {
  const ids: string[] = [];
  if (spec.param) {
    const value = request.params?.[spec.param];
    if (typeof value === "string" && value) ids.push(value);
  }
  if (spec.from) {
    try {
      const found = spec.from(body);
      if (typeof found === "string") ids.push(found);
      else if (Array.isArray(found)) ids.push(...found.filter((v) => typeof v === "string"));
    } catch {
      /* Ham gövde beklenen biçimde değil — tahmin taban fiyatta kalır. */
    }
  }
  return ids;
}

/**
 * Gövdenin kaba karakter uzunluğu — uzun bağlam çarpanının tek girdisi.
 * Gövde serileştirilemezse 0 döner (tahmin taban fiyata iner).
 */
function approximateBodyChars(body: unknown): number {
  if (body === undefined || body === null) return 0;
  if (typeof body === "string") return body.length;
  try {
    return JSON.stringify(body)?.length ?? 0;
  } catch {
    return 0;
  }
}

function describe(err: unknown): string {
  if (err && typeof err === "object" && "status" in err) {
    return `HTTP ${(err as { status: unknown }).status}`;
  }
  return err instanceof Error ? err.name : "bilinmeyen hata";
}
