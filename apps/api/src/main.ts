import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
// SADECE TİP: `express` doğrudan bağımlılık değildir (platform-express üzerinden
// gelir). Çalışma zamanı içe aktarımı yapılmaz; gövde tavanı Nest'in kendi
// `useBodyParser` API'siyle kurulur.
import type { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";

/**
 * İzin verilen tarayıcı kaynakları (CORS beyaz listesi).
 *
 * GÜVENLİK: `origin: true` gelen `Origin` başlığını olduğu gibi yansıtır; bu,
 * herhangi bir sitenin tarayıcı üzerinden API'ye kimlikli istek atmasına ve
 * hata/yanıt gövdelerini okumasına izin verir. `credentials: true` ile birlikte
 * çerez tabanlı oturuma geçildiği anda doğrudan CSRF yüzeyi doğar.
 */
function allowedOrigins(): string[] {
  return (process.env.WEB_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * Güvenlik başlıkları.
 *
 * `helmet` yeni bir bağımsız bağımlılıktır; API saf JSON döndürdüğü ve HTML
 * sunmadığı için ihtiyaç duyulan başlıklar elle ve açıkça yazılır — hangi
 * başlığın NEDEN konduğu kodda görünür.
 */
function securityHeaders() {
  return (_req: Request, res: Response, next: NextFunction): void => {
    // Tarayıcı MIME tipini tahmin edip JSON'u HTML gibi çalıştırmasın.
    res.setHeader("X-Content-Type-Options", "nosniff");
    // API yanıtları hiçbir çerçeveye gömülmemeli.
    res.setHeader("X-Frame-Options", "DENY");
    // Ön-imzalı URL'ler ve dosya adları Referer ile üçüncü tarafa sızmasın.
    res.setHeader("Referrer-Policy", "no-referrer");
    // JSON API'de betik/nesne yüklenmesine hiç gerek yok.
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    // Vekil/tarayıcı, müvekkil verisi taşıyan yanıtları saklamasın.
    res.setHeader("Cache-Control", "no-store");
    res.removeHeader("X-Powered-By");
    if (process.env.API_FORCE_HSTS === "true") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  };
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix("api/v1");

  app.use(securityHeaders());

  // JSON gövde tavanı AÇIKÇA belirlenir (Express varsayılanına güvenilmez).
  // Belge yüklemesi multipart'tır ve bu sınıra takılmaz (Multer 50 MB).
  const bodyLimit = process.env.API_JSON_BODY_LIMIT ?? "1mb";
  app.useBodyParser("json", { limit: bodyLimit });
  app.useBodyParser("urlencoded", { limit: bodyLimit, extended: true });

  // Tek biçimli hata + korelasyon kimliği (ham dış hata mesajları sızmaz).
  app.useGlobalFilters(new AllExceptionsFilter());

  const origins = allowedOrigins();
  app.enableCors({
    origin: origins,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  });

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`NomosOS API hazır: http://localhost:${port}/api/v1`);
  // eslint-disable-next-line no-console
  console.log(`CORS izinli kaynaklar: ${origins.join(", ")}`);
}

void bootstrap();
