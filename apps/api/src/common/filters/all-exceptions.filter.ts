/**
 * TEK BİÇİMLİ HATA YANITI + KORELASYON KİMLİĞİ.
 *
 * Nest'in varsayılan davranışı beklenmeyen hatalarda düz bir 500 döner: yığın
 * izi istemciye sızmaz (bu iyi) ama hiçbir korelasyon kimliği ve denetim izi
 * üretmez — destek, kullanıcının gördüğü hatayı sunucu günlüğünde bulamaz.
 *
 * Bu filtre:
 *   - HttpException'ları OLDUĞU GİBİ geçirir (Türkçe iş mesajları, 409 KVKK
 *     gövdesi, 422 teyit kapısı gövdesi bozulmamalıdır),
 *   - beklenmeyen hatalarda ham mesajı YALNIZCA günlüğe yazar ve istemciye
 *     korelasyon kimlikli sabit bir Türkçe mesaj döner.
 */

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { newCorrelationId } from "../errors";
import { currentRequestId } from "../request-context";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("HTTP");

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      // 5xx sınıfı HttpException'lar da izlenebilir olmalı.
      if (status >= 500) {
        this.logger.error(`${request.method} ${request.url} → ${status}: ${exception.message}`);
      }
      response.status(status).json(
        typeof body === "string" ? { statusCode: status, message: body } : body,
      );
      return;
    }

    // Faz 4: korelasyon kimliği = istek kimliği (x-request-id); günlük ve yanıt aynı kodu taşır.
    const ref = currentRequestId() ?? newCorrelationId();
    const raw = exception instanceof Error ? `${exception.name}: ${exception.message}` : String(exception);
    this.logger.error(
      `[${ref}] ${request.method} ${request.url} → beklenmeyen hata: ${raw}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      ref,
      message:
        `Beklenmeyen bir hata oluştu (ref: ${ref}). Sorun sürerse bu kodu sistem yöneticinize ` +
        "iletin; ayrıntılı iz sunucu günlüğündedir.",
    });
  }
}
