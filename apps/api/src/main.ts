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

/**
 * GÜVENİLEN VEKİL (reverse proxy) SAYISI.
 *
 * Express, `X-Forwarded-For` başlığını YALNIZCA `trust proxy` ayarlandığında
 * çözer. Ayar yokken başlık istemci tarafından uydurulabilir ve `request.ip`
 * ile başlık birbirinden ayrışır: hız sınırlayıcı bir IP, denetim kaydı başka
 * bir IP görür (denetim bulgusu 4).
 *
 * VARSAYILAN 0 = "önümde vekil yok, başlığa hiç bakma" (en güvenli varsayım).
 * Nginx/ALB arkasında dağıtıyorsanız kaç hop olduğunu AÇIKÇA yazın:
 *   TRUSTED_PROXY_HOPS=1
 */
function trustedProxyHops(): number {
  const raw = Number(process.env.TRUSTED_PROXY_HOPS ?? 0);
  return Number.isInteger(raw) && raw >= 0 && raw <= 10 ? raw : 0;
}

async function bootstrap(): Promise<void> {
  assertPrefixConfig();
  // 2FA politikası uygulama AÇILMADAN önce doğrulanır: üretimde 2FA'sız bir
  // panel, çalışır durumdayken fark edilecek bir eksiklik değildir.
  assertTwoFactorPolicy();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.set("trust proxy", trustedProxyHops());
  app.setGlobalPrefix(TENANT_ROUTE_PREFIX, {
    exclude: [{ path: ADMIN_PREFIX_EXCLUDE_PATTERN, method: RequestMethod.ALL }],
  });

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
  console.log(`NomosOS API hazır: http://localhost:${port}/${TENANT_ROUTE_PREFIX}`);
  // eslint-disable-next-line no-console
  console.log(`Platform yönetim paneli API'si: http://localhost:${port}/${ADMIN_ROUTE_PREFIX}`);
  // eslint-disable-next-line no-console
  console.log(`CORS izinli kaynaklar: ${origins.join(", ")}`);
}

void bootstrap();
