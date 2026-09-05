/**
 * T.C. CUMHURBAŞKANLIĞI SİTELERİ İÇİN TLS YARDIMCISI.
 *
 * SORUN (canlı doğrulandı): mevzuat.gov.tr ve resmigazete.gov.tr sunucuları
 * zincirde YALNIZCA yaprak sertifika gönderir (*.tccb.gov.tr, DigiCert).
 * Ara sertifika (GeoTrust TLS RSA CA G1) bağlantıda gönderilmez; tarayıcılar
 * AIA uzantısından ortayı kendileri indirir, Node/undici İNDİRMEZ ve sonuç
 * UNABLE_TO_VERIFY_LEAF_SIGNATURE hatasıdır.
 *
 * ÇÖZÜM: sertifikanın kendi AIA adresinden (cacerts.geotrust.com) indirilen
 * ARA sertifika + kökünü (DigiCert Global Root G2) sabit CA paketi olarak
 * sunuyoruz. `ca` seçeneği Node'un kök deposunu TAMAMEN DEĞİŞTİRDİĞİ için
 * kök de pakette bulunmak zorundadır.
 *
 * SERTİFİKA YENİLEME: ara sertifika 02.11.2027'de, kök 15.01.2038'de sona
 * erer. Yenilenirse konektörün healthCheck'i TLS hatasıyla düşer; paket o
 * zaman AIA adreslerinden yeniden üretilir (openssl s_client -showcerts ile
 * leaf AKI'sı eşleşen sertifika bulunup buraya gömülür).
 */

import https from "node:https";
import { URL } from "node:url";

/**
 * Leaf (*.tccb.gov.tr) → GeoTrust TLS RSA CA G1 (ara) → DigiCert Global Root G2 (kök).
 * İçerik AIA adreslerinden indirilip birebir gömülmüştür; elle değiştirilmez.
 */
export const GOV_CA_BUNDLE = `-----BEGIN CERTIFICATE-----
MIIEjTCCA3WgAwIBAgIQDQd4KhM/xvmlcpbhMf/ReTANBgkqhkiG9w0BAQsFADBh
MQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3
d3cuZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBH
MjAeFw0xNzExMDIxMjIzMzdaFw0yNzExMDIxMjIzMzdaMGAxCzAJBgNVBAYTAlVT
MRUwEwYDVQQKEwxEaWdpQ2VydCBJbmMxGTAXBgNVBAsTEHd3dy5kaWdpY2VydC5j
b20xHzAdBgNVBAMTFkdlb1RydXN0IFRMUyBSU0EgQ0EgRzEwggEiMA0GCSqGSIb3
DQEBAQUAA4IBDwAwggEKAoIBAQC+F+jsvikKy/65LWEx/TMkCDIuWegh1Ngwvm4Q
yISgP7oU5d79eoySG3vOhC3w/3jEMuipoH1fBtp7m0tTpsYbAhch4XA7rfuD6whU
gajeErLVxoiWMPkC/DnUvbgi74BJmdBiuGHQSd7LwsuXpTEGG9fYXcbTVN5SATYq
DfbexbYxTMwVJWoVb6lrBEgM3gBBqiiAiy800xu1Nq07JdCIQkBsNpFtZbIZhsDS
fzlGWP4wEmBQ3O67c+ZXkFr2DcrXBEtHam80Gp2SNhou2U5U7UesDL/xgLK6/0d7
6TnEVMSUVJkZ8VeZr+IUIlvoLrtjLbqugb0T3OYXW+CQU0kBAgMBAAGjggFAMIIB
PDAdBgNVHQ4EFgQUlE/UXYvkpOKmgP792PkA76O+AlcwHwYDVR0jBBgwFoAUTiJU
IBiV5uNu5g/6+rkS7QYXjzkwDgYDVR0PAQH/BAQDAgGGMB0GA1UdJQQWMBQGCCsG
AQUFBwMBBggrBgEFBQcDAjASBgNVHRMBAf8ECDAGAQH/AgEAMDQGCCsGAQUFBwEB
BCgwJjAkBggrBgEFBQcwAYYYaHR0cDovL29jc3AuZGlnaWNlcnQuY29tMEIGA1Ud
HwQ7MDkwN6A1oDOGMWh0dHA6Ly9jcmwzLmRpZ2ljZXJ0LmNvbS9EaWdpQ2VydEds
b2JhbFJvb3RHMi5jcmwwPQYDVR0gBDYwNDAyBgRVHSAAMCowKAYIKwYBBQUHAgEW
HGh0dHBzOi8vd3d3LmRpZ2ljZXJ0LmNvbS9DUFMwDQYJKoZIhvcNAQELBQADggEB
AIIcBDqC6cWpyGUSXAjjAcYwsK4iiGF7KweG97i1RJz1kwZhRoo6orU1JtBYnjzB
c4+/sXmnHJk3mlPyL1xuIAt9sMeC7+vreRIF5wFBC0MCN5sbHwhNN1JzKbifNeP5
ozpZdQFmkCo+neBiKR6HqIA+LMTMCMMuv2khGGuPHmtDze4GmEGZtYLyF8EQpa5Y
jPuV6k2Cr/N3XxFpT3hRpt/3usU/Zb9wfKPtWpoznZ4/44c1p9rzFcZYrWkj3A+7
TNBJE0GmP2fhXhP1D/XVfIW/h0yCJGEiV9Glm/uGOa3DXHlmbAcxSyCRraG+ZBkA
7h4SeM6Y8l/7MBRpPCz6l8Y=
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIDjjCCAnagAwIBAgIQAzrx5qcRqaC7KGSxHQn65TANBgkqhkiG9w0BAQsFADBh
MQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3
d3cuZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBH
MjAeFw0xMzA4MDExMjAwMDBaFw0zODAxMTUxMjAwMDBaMGExCzAJBgNVBAYTAlVT
MRUwEwYDVQQKEwxEaWdpQ2VydCBJbmMxGTAXBgNVBAsTEHd3dy5kaWdpY2VydC5j
b20xIDAeBgNVBAMTF0RpZ2lDZXJ0IEdsb2JhbCBSb290IEcyMIIBIjANBgkqhkiG
9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuzfNNNx7a8myaJCtSnX/RrohCgiN9RlUyfuI
2/Ou8jqJkTx65qsGGmvPrC3oXgkkRLpimn7Wo6h+4FR1IAWsULecYxpsMNzaHxmx
1x7e/dfgy5SDN67sH0NO3Xss0r0upS/kqbitOtSZpLYl6ZtrAGCSYP9PIUkY92eQ
q2EGnI/yuum06ZIya7XzV+hdG82MHauVBJVJ8zUtluNJbd134/tJS7SsVQepj5Wz
tCO7TG1F8PapspUwtP1MVYwnSlcUfIKdzXOS0xZKBgyMUNGPHgm+F6HmIcr9g+UQ
vIOlCsRnKPZzFBQ9RnbDhxSJITRNrw9FDKZJobq7nMWxM4MphQIDAQABo0IwQDAP
BgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBhjAdBgNVHQ4EFgQUTiJUIBiV
5uNu5g/6+rkS7QYXjzkwDQYJKoZIhvcNAQELBQADggEBAGBnKJRvDkhj6zHd6mcY
1Yl9PMWLSn/pvtsrF9+wX3N3KjITOYFnQoQj8kVnNeyIv/iPsGEMNKSuIEyExtv4
NeF22d+mQrvHRAiGfzZ0JFrabA0UWTW98kndth/Jsw1HKj2ZL7tcu7XUIOGZX1NG
Fdtom/DzMNU+MeKNhJ7jitralj41E6Vf8PlwUHBHQRFXGU7Aj64GxJUTFy8bJZ91
8rGOmaFvE7FBcf6IKshPECBV1/MUReXgRPTqh5Uykw7+U0b6LJ3/iyK5S9kJRaTe
pLiaWN0bfVKfjllDiIGknibVb63dDcY3fe0Dkhvld1927jyNxF1WW6LZZm6zNTfl
MrY=
-----END CERTIFICATE-----
`;

/**
 * Paketteki ARA sertifikanın (GeoTrust TLS RSA CA G1) son kullanma tarihi.
 * Konektör sağlık kontrolleri bu tarihe yaklaşınca UYARI üretir; tarih
 * geçince TLS doğrulaması düşer ve paket AIA adreslerinden yenilenmelidir.
 */
export const GOV_CA_INTERMEDIATE_EXPIRES_AT = new Date("2027-11-02T12:23:37Z");
/** Sona ermeden kaç gün önce uyarı verilir. */
export const GOV_CA_WARN_DAYS = 90;

/**
 * Sabit CA paketi için son kullanma uyarısı (yoksa null). Sağlık kontrolü
 * mesajına eklenir; sertifika DOLDUYSA bağlantı zaten düşer, mesaj nedeni
 * açıkça söyler ("paket yenilenmeli").
 */
export function govCaExpiryWarning(now: Date = new Date()): string | null {
  const msLeft = GOV_CA_INTERMEDIATE_EXPIRES_AT.getTime() - now.getTime();
  const daysLeft = Math.floor(msLeft / 86_400_000);
  if (daysLeft < 0) {
    return (
      `Gömülü ara sertifika ${GOV_CA_INTERMEDIATE_EXPIRES_AT.toISOString().slice(0, 10)} tarihinde SONA ERDİ; ` +
      "gov-tls.ts paketi AIA adreslerinden yenilenmeli."
    );
  }
  if (daysLeft <= GOV_CA_WARN_DAYS) {
    return `Gömülü ara sertifikanın süresi ${daysLeft} gün içinde doluyor (${GOV_CA_INTERMEDIATE_EXPIRES_AT
      .toISOString()
      .slice(0, 10)}); gov-tls.ts paketini yenilemeyi planlayın.`;
  }
  return null;
}

/** TLS zinciri hatası mı (paket yenileme gerektiren sınıf)? */
export function isTlsChainError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code ?? "";
  return (
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    code === "CERT_HAS_EXPIRED" ||
    code === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" ||
    code === "SELF_SIGNED_CERT_IN_CHAIN" ||
    code === "ERR_TLS_CERT_ALTNAME_INVALID"
  );
}

interface GovFetchOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** Gövde üst sınırı (bayt). Aşılırsa istek kesilir — bellek dolmaz. */
  maxBodyBytes?: number;
}

/** İzlenecek en fazla yönlendirme sayısı (aynı ana makine, yalnız HTTPS). */
const MAX_REDIRECTS = 3;
/** Varsayılan gövde tavanı — 32 MB. */
const DEFAULT_MAX_BODY_BYTES = 32 * 1024 * 1024;

export interface GovFetchResponse {
  status: number;
  ok: boolean;
  text: () => Promise<string>;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

/**
 * T.C. Cumhurbaşkanlığı (tccb) altyapısındaki sitelere HTTPS isteği.
 * Sabit CA paketiyle doğrulama; `rejectUnauthorized` ASLA kapatılmaz.
 */
export function govFetch(url: string, options: GovFetchOptions = {}): Promise<GovFetchResponse> {
  return govFetchInner(url, options, 0);
}

function govFetchInner(url: string, options: GovFetchOptions, redirects: number): Promise<GovFetchResponse> {
  const target = new URL(url);
  if (target.protocol !== "https:") {
    return Promise.reject(new Error("govFetch yalnızca HTTPS isteklerini destekler."));
  }
  const maxBody = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  return new Promise<GovFetchResponse>((resolve, reject) => {
    const req = https.request(
      {
        hostname: target.hostname,
        port: 443,
        path: `${target.pathname}${target.search}`,
        method: options.method ?? "GET",
        headers: {
          ...(options.body ? { "content-length": String(Buffer.byteLength(options.body)) } : {}),
          ...options.headers,
        },
        // ca: Node'un kök deposunu DEĞİŞTİRİR — paket kök sertifikayı içerir.
        ca: [GOV_CA_BUNDLE],
        timeout: options.timeoutMs ?? 15_000,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        // YÖNLENDİRME: yalnız aynı ana makineye ve HTTPS'e; sınırlı sayıda.
        // Resmî siteler zaman zaman "www." ya da sondaki "/" için 301 döner;
        // izlenmezse çekim sessizce "301 döndü" hatasıyla düşerdi.
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
          res.resume();
          if (redirects >= MAX_REDIRECTS) {
            reject(new Error(`Çok fazla yönlendirme (${MAX_REDIRECTS}+): ${url}`));
            return;
          }
          const next = new URL(res.headers.location, url);
          if (next.protocol !== "https:" || next.hostname !== target.hostname) {
            reject(new Error(`Yönlendirme başka ana makineye/şemaya gidiyor, izlenmedi: ${next.toString()}`));
            return;
          }
          const keepMethod = status === 307 || status === 308;
          govFetchInner(
            next.toString(),
            keepMethod ? options : { ...options, method: "GET", body: undefined },
            redirects + 1,
          ).then(resolve, reject);
          return;
        }

        const chunks: Buffer[] = [];
        let received = 0;
        res.on("data", (c: Buffer) => {
          received += c.length;
          if (received > maxBody) {
            // Akış SIRASINDA kesilir: 32 MB üstü gövde belleğe alınmaz.
            req.destroy(new Error(`Yanıt gövdesi boyut sınırını aşıyor (${maxBody} bayt).`));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => {
          if (req.destroyed) return;
          const buffer = Buffer.concat(chunks);
          resolve({
            status: res.statusCode ?? 0,
            ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
            text: async () => buffer.toString("utf8"),
            arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
          });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error("İstek zaman aşımına uğradı."));
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}
