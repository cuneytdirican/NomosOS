/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ GÜVENİLEN VEKİL (reverse proxy) KARARI — denetim bulgusu Ö-08           ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Express, `X-Forwarded-For` başlığını YALNIZCA `trust proxy` ayarlandığında
 * çözer. Ayar 0 iken `request.ip` her istemci için VEKİLİN adresidir ve üç
 * mekanizma birden sessizce çöker:
 *
 *   1. `PortalLockoutStore` / `LoginThrottleGuard` dar sayacı `${ip}|${email}`
 *      fiilen yalnız e-postaya çöker: e-postayı bilen herkes hesabı beş
 *      denemede kilitler (portal.constants.ts:56-88'de anlatılan düzeltme
 *      geri alınmış olur).
 *   2. Oran sınırı tüm kiracıları TEK kovaya toplar.
 *   3. `PortalAuditLog.ipAddress` / `PlatformAuditLog.ipAddress` sabit ve
 *      anlamsız olur — oysa `platform-jwt.guard.ts` bu alanı "10 yıl saklanan
 *      denetim izindeki en önemli tekil alan" diye tanımlıyor.
 *
 * ESKİ DAVRANIŞ: `Number(process.env.TRUSTED_PROXY_HOPS ?? 0)`; tanımsız da,
 * "1a" gibi bozuk bir değer de, "99" da SESSİZCE 0'a düşüyordu. Yani üretimde
 * yapılan bir yazım hatası, hiçbir uyarı üretmeden yukarıdaki üç mekanizmayı
 * kapatıyordu.
 *
 * YENİ DAVRANIŞ — üç kural:
 *   a) Bozuk değer HER ORTAMDA açılışı durdurur (sessizce 0'a düşmez).
 *   b) `NODE_ENV=production` iken değişken TANIMSIZSA açılış durur. Gerekçe
 *      `JWT_SECRET` ile aynıdır: üretimde bu ayarın doğru değeri kurulumu
 *      yapan kişi DIŞINDA kimse tarafından bilinemez ve yanlış varsayılan,
 *      çalışır görünen ama güvenliği sessizce boşa düşen bir sistem üretir.
 *      `docker-compose.prod.yml:279` zaten `:?` ile zorunlu kılıyor; bu kontrol
 *      compose dışında (systemd, k8s, elle `node dist/main.js`) çalıştıran
 *      kurulumları da kapsar.
 *   c) Vekil YOKSA üretimde de geçerli tek doğru cevap vardır: açıkça
 *      `TRUSTED_PROXY_HOPS=0` yazmak. "Ayarı unuttum" ile "vekilim yok"
 *      birbirinden ayrılabilir hâle gelir.
 *
 * ÜST SINIR NEDEN 10: `trust proxy` sayısal değeri "sondan N. adresi al"
 * demektir. Gerçek kurulumlarda 1 (tek vekil) ya da 2 (CDN + vekil) olur;
 * 10 fazlasıyla geniş bir tavandır ve elle girilmiş saçma değerleri (ör. 1000)
 * eler.
 */

/** Açılışta verilen karar — loglanabilir ve test edilebilir. */
export interface TrustedProxyDecision {
  /** Express `trust proxy` değeri. */
  hops: number;
  /** Değişken açıkça yazılmış mı (yoksa geliştirme varsayılanı mı)? */
  explicit: boolean;
  /** Açılış günlüğüne basılacak tek satırlık Türkçe açıklama. */
  summary: string;
}

export const TRUSTED_PROXY_MAX_HOPS = 10;

function isProduction(env: NodeJS.ProcessEnv): boolean {
  return (env.NODE_ENV ?? "").trim().toLowerCase() === "production";
}

/**
 * `TRUSTED_PROXY_HOPS`i çözer. Geçersiz yapılandırmada FIRLATIR.
 *
 * SAF: `process.env`i parametre olarak alır, hiçbir şey yazmaz, log basmaz.
 */
export function resolveTrustedProxy(env: NodeJS.ProcessEnv = process.env): TrustedProxyDecision {
  const raw = env.TRUSTED_PROXY_HOPS?.trim();

  if (raw === undefined || raw === "") {
    if (isProduction(env)) {
      throw new Error(
        "TRUSTED_PROXY_HOPS tanımlı değil. Üretimde bu ayar ZORUNLUDUR: ters vekil " +
          "arkasındaysanız hop sayısını yazın (Caddy/Traefik/nginx/ALB için genellikle 1), " +
          "API doğrudan internete açıksa AÇIKÇA TRUSTED_PROXY_HOPS=0 yazın. " +
          "Ayar olmadan istemci IP'si vekilin IP'sine çöker; hesap kilidi, oran sınırı ve " +
          "10 yıl saklanan denetim izindeki IP alanı birlikte anlamsızlaşır (Ö-08).",
      );
    }
    return {
      hops: 0,
      explicit: false,
      summary:
        "TRUSTED_PROXY_HOPS tanımsız — geliştirme varsayılanı 0 kullanılıyor " +
        "(X-Forwarded-For başlığına hiç bakılmaz). Üretimde bu değişken zorunludur.",
    };
  }

  // `Number("")` = 0 tuzağı yukarıda elendi; buradan sonrası gerçek bir değerdir.
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > TRUSTED_PROXY_MAX_HOPS) {
    throw new Error(
      `TRUSTED_PROXY_HOPS geçersiz: "${raw}". 0 ile ${TRUSTED_PROXY_MAX_HOPS} arasında bir ` +
        "tam sayı olmalıdır (0 = önümde vekil yok). Geçersiz değer eskiden sessizce 0'a " +
        "düşürülüyordu; bu, yazım hatasının güvenlik ayarını kapatması demekti (Ö-08).",
    );
  }

  return {
    hops: parsed,
    explicit: true,
    summary:
      parsed === 0
        ? "TRUSTED_PROXY_HOPS=0 — vekil yok; X-Forwarded-For başlığı YOK SAYILIR, " +
          "istemci IP'si TCP bağlantısından okunur."
        : `TRUSTED_PROXY_HOPS=${parsed} — istemci IP'si X-Forwarded-For zincirinin ` +
          `sondan ${parsed}. adresinden okunur.`,
  };
}
