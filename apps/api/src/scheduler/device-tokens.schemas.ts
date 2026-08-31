import { z } from "zod";

/**
 * CİHAZ JETONU DOĞRULAMASI.
 *
 * Jeton uzunluğu sınırlanır: FCM jetonları ~160-200, APNs ~64 karakterdir.
 * Üst sınır olmasaydı uç, kullanıcı başına sınırsız uzunlukta metin saklayan
 * bir depo hâline gelirdi. Biçim sağlayıcıya göre değiştiği için desen
 * gevşektir; yalnız görünür karakterler kabul edilir (boşluk ve kontrol
 * karakteri, kopyala-yapıştır artığı demektir).
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ ÖNGÖRÜLEBİLİR JETON REDDEDİLİR (denetim bulgusu 1 — KRİTİK).             ║
 * ║                                                                          ║
 * ║ `DeviceToken` üzerindeki `@@unique([token])` TENANT'TAN BAĞIMSIZDIR ve   ║
 * ║ kayıt `upsert` ile DEVREDİLİR. Bu, GERÇEK sağlayıcı jetonları için       ║
 * ║ doğru davranıştır: aynı cihaza başka bir hesapla girildiğinde FCM/APNs   ║
 * ║ AYNI jetonu verir ve kayıt eski sahipte kalırsa o cihaz artık            ║
 * ║ kullanmadığı hesabın bildirimlerini almaya devam ederdi.                 ║
 * ║                                                                          ║
 * ║ Ama devir mekanizması yalnız jeton TAHMİN EDİLEMEZ olduğunda güvenlidir. ║
 * ║ Mobil istemci jetonu `"<platform>:<userId>:<os>"` gibi türetilmiş bir    ║
 * ║ dizeden üretiyordu; `userId` değerleri görev `assigneeId` ve dosya       ║
 * ║ `responsibleUser.id` alanlarında açıkça dönüyor. Bir stajyer ortağın     ║
 * ║ kimliğiyle jetonu kurup POST edince satır ONA geçiyordu — üstelik        ║
 * ║ kiracılar arası da çalışıyordu, çünkü anahtarda tenant yok.              ║
 * ║                                                                          ║
 * ║ Bu yüzden jeton artık İKİ kapıdan geçer:                                 ║
 * ║   1. İçinde UUID GEÇEMEZ (kullanıcı/kiracı kimliği taşıyan jeton).       ║
 * ║   2. Yeterli çeşitlilik taşımalıdır — ayrık karakter sayısı eşiği.       ║
 * ║ Gerçek FCM/APNs jetonları her ikisini de rahatça geçer; türetilmiş bir   ║
 * ║ dize geçemez.                                                            ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

/** Jeton gövdesinde bir UUID görünüyorsa jeton türetilmiştir; kabul edilmez. */
const UUID_ANYWHERE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

/** Gerçek sağlayıcı jetonlarında en az bu kadar ayrık karakter bulunur. */
const MIN_DISTINCT_CHARS = 12;

export function isPredictableDeviceToken(token: string): boolean {
  if (UUID_ANYWHERE.test(token)) return true;
  return new Set(token).size < MIN_DISTINCT_CHARS;
}

export const deviceTokenRegisterSchema = z.object({
  platform: z.enum(["IOS", "ANDROID", "WEB"], {
    errorMap: () => ({ message: "Platform IOS, ANDROID veya WEB olmalıdır." }),
  }),
  token: z
    .string()
    .trim()
    .min(32, "Cihaz jetonu en az 32 karakter olmalıdır.")
    .max(512, "Cihaz jetonu 512 karakteri aşamaz.")
    .regex(/^[\x21-\x7E]+$/, "Cihaz jetonu boşluk ve kontrol karakteri içeremez.")
    .refine((t) => !isPredictableDeviceToken(t), {
      message:
        "Cihaz jetonu tahmin edilebilir görünüyor (kullanıcı/kayıt kimliği içeriyor ya da " +
        "yeterince çeşitli değil). Yalnız itme sağlayıcısının (FCM/APNs) verdiği gerçek " +
        "jeton kabul edilir; kimlikten türetilmiş bir dize, başkasının cihaz kaydını " +
        "ele geçirmeye açık kapı bırakır.",
    }),
});
export type DeviceTokenRegisterInput = z.infer<typeof deviceTokenRegisterSchema>;
