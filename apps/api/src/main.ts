import "reflect-metadata";
import { RequestMethod } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
// SADECE TİP: `express` doğrudan bağımlılık değildir (platform-express üzerinden
// gelir). Çalışma zamanı içe aktarımı yapılmaz; gövde tavanı Nest'in kendi
// `useBodyParser` API'siyle kurulur.
import type { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { ADMIN_ROUTE_PREFIX, assertTwoFactorPolicy } from "./platform/platform.constants";
import { resolveTrustedProxy } from "./common/trusted-proxy";
import { createAppLogger } from "./common/json-logger";
import { requestContextMiddleware } from "./common/request-context";

/** Kiracı (büro) API'sinin genel öneki. */
const TENANT_ROUTE_PREFIX = "api/v1";

/**
 * Global önekten HARİÇ tutulacak yollar (platform yönetim paneli).
 *
 * `path-to-regexp` 3.x deseni; `(.*)` eğik çizgi dâhil her şeyi yakalar.
 * `ADMIN_ROUTE_PREFIX` ile birebir aynı kökten türetilir ki iki sabit ayrışmasın.
 */
const ADMIN_PREFIX_EXCLUDE_PATTERN = `${ADMIN_ROUTE_PREFIX}/(.*)`;

/**
 * İKİ ÖNEK, TEK UYGULAMA — neden `exclude` ile çözüldü?
 *
 * NomosOS'ta iki ayrı API yan yana yaşar:
 *   - kiracı (büro) uygulaması → `/api/v1/**`
 *   - platform yönetim paneli  → `/api/admin/v1/**`
 *
 * Nest'in global öneki tüm controller'lara uygulanır. Platform controller'ları
 * yolu TAM olarak (`api/admin/v1/...`) yazar ve bu desen global önekten hariç
 * tutulur; böylece:
 *   - mevcut kiracı controller'larının HİÇBİRİNE dokunulmaz (`clients` →
 *     `/api/v1/clients` olarak kalır),
 *   - platform uçları `/api/v1/admin/...` gibi ikinci bir adresten
 *     ERİŞİLEMEZ (tek adres, tek güvenlik zinciri),
 *   - URL yeniden yazan (`req.url = ...`) kırılgan bir ara katmana gerek
 *     kalmaz — yol tablosu gerçeği söyler.
 *
 * Sabitlerin ayrışmasına karşı açılışta doğrulama yapılır.
 */
function assertPrefixConfig(): void {
  if (!ADMIN_ROUTE_PREFIX.startsWith("api/")) {
    throw new Error(
      `ADMIN_ROUTE_PREFIX ("${ADMIN_ROUTE_PREFIX}") "api/" ile başlamalıdır; aksi hâlde ` +
        "platform uçları ters vekil (reverse proxy) kurallarının dışında kalır."
    );
  }
  if (ADMIN_ROUTE_PREFIX.startsWith(`${TENANT_ROUTE_PREFIX}/`)) {
    throw new Error(
      `ADMIN_ROUTE_PREFIX ("${ADMIN_ROUTE_PREFIX}") kiracı öneki "${TENANT_ROUTE_PREFIX}" ` +
        "altında olamaz: platform uçları kiracı API'sinin adres uzayına karışır."
    );
  }
}

/**
 * İzin verilen tarayıcı kaynakları (CORS beyaz listesi).
 *
 * GÜVENLİK: `origin: true` gelen `Origin` başlığını olduğu gibi yansıtır; bu,
 * herhangi bir sitenin tarayıcı üzerinden API'ye kimlikli istek atmasına ve
 * hata/yanıt gövdelerini okumasına izin verir. `credentials: true` ile birlikte
 * çerez tabanlı oturuma geçildiği anda doğrudan CSRF yüzeyi doğar.
 *
 * ÜÇ AYRI ARAYÜZ, ÜÇ AYRI PORT. Tek bir API üç ayrı tarayıcı uygulamasına
 * hizmet eder ve her biri CORS açısından BAĞIMSIZ bir kaynaktır:
 *
 *   | Uygulama            | Geliştirme portu | Kullandığı uçlar   |
 *   |---------------------|------------------|--------------------|
 *   | apps/web (büro)     | 3000             | /api/v1/**         |
 *   | apps/admin (platform)| 3002            | /api/admin/v1/**   |
 *   | apps/portal (müvekkil)| 3003           | /api/v1/portal/**  |
 *
 * Varsayılan liste yalnız `localhost:3000` taşıdığı için Faz 5'te eklenen
 * müvekkil portalı tarayıcıda CORS'a takılıyordu: API ayakta, uçlar doğru,
 * `curl` çalışıyor — ama gerçek kullanıcı hiçbir şey göremiyor. Bu, ancak
 * tarayıcıda fark edilen türden sessiz bir entegrasyon açığıdır.
 *
 * Varsayılan BİLEREK yalnız `localhost` adresleridir: üretimde `WEB_ORIGIN`
 * tanımlanır ve bu liste tamamen devre dışı kalır (birleştirilmez — üretim
 * beyaz listesine geliştirme adresi sızmamalıdır).
 */
const DEV_ORIGINS = [
  "http://localhost:3000", // apps/web    — büro paneli + pazarlama sitesi
  "http://localhost:3002", // apps/admin  — platform yönetim paneli
  "http://localhost:3003", // apps/portal — müvekkil portalı (Faz 5)
];

function allowedOrigins(): string[] {
  const configured = process.env.WEB_ORIGIN?.trim();
  if (!configured) return [...DEV_ORIGINS];
  return configured
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

/**
 * GÜVENİLEN VEKİL (reverse proxy) SAYISI — denetim bulgusu Ö-08.
 *
 * KARAR MANTIĞI `common/trusted-proxy.ts`e TAŞINDI ve orada birim testlenir.
 * Buradaki eski hâl (`Number(process.env.TRUSTED_PROXY_HOPS ?? 0)`) tanımsız
 * değeri de bozuk değeri de SESSİZCE 0'a düşürüyordu; üretimde bu, hesap
 * kilidini, oran sınırını ve denetim izindeki IP alanını hiçbir uyarı
 * üretmeden birlikte çürütüyordu. Artık üretimde tanımsız ya da geçersiz
 * değer AÇILIŞI DURDURUR (JWT_SECRET deseni).
 *
 * ÜRETİM REHBERİ: Caddy/Traefik/nginx/ALB arkasında `TRUSTED_PROXY_HOPS=1`;
 * CDN + vekil zinciri varsa 2; API doğrudan internete açıksa AÇIKÇA 0.
 */

async function bootstrap(): Promise<void> {
  assertPrefixConfig();
  // 2FA politikası uygulama AÇILMADAN önce doğrulanır: üretimde 2FA'sız bir
  // panel, çalışır durumdayken fark edilecek bir eksiklik değildir.
  assertTwoFactorPolicy();
  // denetim bulgusu Ö-08: geçersiz/eksik vekil ayarı UYGULAMA AÇILMADAN önce
  // fark edilir; sessizce 0'a düşen eski davranış kaldırıldı.
  const proxy = resolveTrustedProxy();
  // Faz 4: JSON günlük (LOG_FORMAT=json; üretim varsayılanı) + x-request-id bağlamı.
  const appLogger = createAppLogger();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: appLogger.logger });
  app.set("trust proxy", proxy.hops);
  app.setGlobalPrefix(TENANT_ROUTE_PREFIX, {
    exclude: [
      { path: ADMIN_PREFIX_EXCLUDE_PATTERN, method: RequestMethod.ALL },
      // D3 / C6: Prometheus /metrics — standart yol, önek YOK.
      { path: "metrics", method: RequestMethod.GET },
    ],
  });

  app.use(requestContextMiddleware({ log: appLogger.access }));
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

  // Faz 4: OpenAPI belgesi yalnız geliştirme/test (üretimde saldırı yüzeyi + gövde şemaları zod'dadır).
  if (process.env.NODE_ENV !== "production" && process.env.API_DOCS_ENABLED !== "false") {
    const { DocumentBuilder, SwaggerModule } = await import("@nestjs/swagger");
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle("NomosOS API").setDescription("Kiracı (/api/v1) ve platform (/api/admin/v1) uçları. Gövde şemaları zod ile doğrulanır; bu belge rota envanteridir.").setVersion(process.env.npm_package_version ?? "0.1.0").addBearerAuth().addCookieAuth("nomosos_token").build(),
    );
    SwaggerModule.setup("api/docs", app, doc, { customSiteTitle: "NomosOS API" });
  }

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  console.log(`NomosOS API hazır: http://localhost:${port}/${TENANT_ROUTE_PREFIX}`);
  console.log(`Platform yönetim paneli API'si: http://localhost:${port}/${ADMIN_ROUTE_PREFIX}`);
  console.log(`CORS izinli kaynaklar: ${origins.join(", ")}`);
  // denetim bulgusu Ö-08: karar açılış günlüğüne AÇIKÇA basılır — "hangi IP'yi
  // gerçek istemci sayıyoruz" sorusu üretimde log'dan yanıtlanabilmelidir.
  console.log(`Ters vekil: ${proxy.summary}`);
  console.log(`Günlük biçimi: ${appLogger.format}${process.env.NODE_ENV !== "production" ? " · OpenAPI: /api/docs" : ""}`);
}

void bootstrap();
