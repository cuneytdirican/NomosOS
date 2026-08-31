/**
 * ANLIK BİLDİRİM (PUSH) JETONU KAYNAĞI.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ JETON YALNIZ SAĞLAYICIDAN GELİR. TÜRETİLMEZ, UYDURULMAZ.                 ║
 * ║                                                                          ║
 * ║ Cihaz jetonu bir KİMLİK BİLGİSİDİR: onu bilen, o cihaza bildirim         ║
 * ║ gönderebilir ve sunucu tarafındaki devir mekanizması sayesinde o kaydın  ║
 * ║ sahibi olabilir. Bu yüzden tek geçerli kaynağı FCM/APNs'tir; kullanıcı   ║
 * ║ kimliğinden ya da platform adından türetilen bir dize, tahmin edilebilir ║
 * ║ olduğu için jeton DEĞİL, açık kapıdır (denetim bulgusu 1 — KRİTİK).      ║
 * ║                                                                          ║
 * ║ Bu fazda sağlayıcı YAPILANDIRILMAMIŞTIR (`expo-notifications` bağımlılık ║
 * ║ listesinde yoktur, APNs/FCM anahtarları da kurulmamıştır). Bu durumda    ║
 * ║ fonksiyon `null` döner ve çağıran taraf CİHAZ KAYDI YAPMAZ. "Bir şeyler  ║
 * ║ kaydedelim de dursun" yaklaşımı, hiçbir işe yaramayan ama sömürülebilen  ║
 * ║ bir kayıt bırakırdı.                                                     ║
 * ║                                                                          ║
 * ║ SAĞLAYICI EKLENDİĞİNDE değişecek TEK YER burasıdır:                      ║
 * ║   import * as Notifications from "expo-notifications";                   ║
 * ║   const { status } = await Notifications.requestPermissionsAsync();      ║
 * ║   if (status !== "granted") return null;                                 ║
 * ║   return (await Notifications.getDevicePushTokenAsync()).data;           ║
 * ║ Çağıran ekran (ayarlar.tsx) ve sunucu ucu DEĞİŞMEZ.                      ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

/**
 * Sağlayıcının verdiği gerçek cihaz jetonu; yapılandırma yoksa `null`.
 *
 * `Promise` döner çünkü gerçek uygulama izin istemi ve ağ çağrısı içerir;
 * çağıran taraf bugünden itibaren o şekle göre yazılmıştır.
 */
export async function getPushProviderToken(): Promise<string | null> {
  return null;
}

/** Sağlayıcı yapılandırılmış mı — arayüz metinleri buna bakabilir. */
export const PUSH_PROVIDER_CONFIGURED = false;
