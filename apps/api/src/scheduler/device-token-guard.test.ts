import { describe, expect, it } from "vitest";
import {
  deviceTokenRegisterSchema,
  isPredictableDeviceToken,
} from "./device-tokens.schemas";

/**
 * CİHAZ JETONU KAÇIRMA KAPISI — denetim bulgusu 1 (KRİTİK).
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ NEDEN BU TEST VAR:                                                       ║
 * ║ `DeviceToken.token` benzersizliği TENANT'TAN BAĞIMSIZDIR ve kayıt        ║
 * ║ `upsert` ile devredilir. Bu, gerçek FCM/APNs jetonları için doğru        ║
 * ║ davranıştır (aynı cihaza başka hesapla girildiğinde sağlayıcı aynı       ║
 * ║ jetonu verir), ama YALNIZCA jeton tahmin edilemezse güvenlidir.          ║
 * ║                                                                          ║
 * ║ Mobil istemci jetonu `"<platform>:<userId>:<os>"` biçiminde ÜRETİYORDU   ║
 * ║ ve `userId` uygulamanın başka uçlarında açıkça dönüyordu. Bir stajyer,   ║
 * ║ ortağın kimliğiyle jetonu kurup POST edince kayıt ONA geçiyor; aynı      ║
 * ║ saldırı kiracılar arası da çalışıyordu. Gerçek push açıldığı anda        ║
 * ║ kurbanın süre/duruşma bildirimleri saldırganın telefonuna düşerdi.       ║
 * ║                                                                          ║
 * ║ Bu testler kapının AÇILMAMASINI kilitler. Kapı kaldırılırsa test kırmızı ║
 * ║ olur ve gerekçe burada yazılıdır.                                        ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
describe("cihaz jetonu — öngörülebilirlik kapısı", () => {
  const victimId = "9f3c1a2b-4d5e-4f60-8a71-b2c3d4e5f607";

  it("mobilin ESKİ türetilmiş jeton biçimi REDDEDİLİR", () => {
    // Tam olarak kaldırılan satırın ürettiği dize:
    //   `${platform.toLowerCase()}:${user?.id}:${Platform.OS}`
    const forged = `ios:${victimId}:ios`;
    expect(isPredictableDeviceToken(forged)).toBe(true);
    expect(deviceTokenRegisterSchema.safeParse({ platform: "IOS", token: forged }).success).toBe(
      false,
    );
  });

  it("içinde UUID geçen her jeton reddedilir — kimlik taşıyan jeton jeton değildir", () => {
    expect(isPredictableDeviceToken(`android:${victimId}:android`)).toBe(true);
    expect(isPredictableDeviceToken(`prefix-${victimId}-suffix-abcdefghijklmnop`)).toBe(true);
    expect(isPredictableDeviceToken(victimId.toUpperCase())).toBe(true);
  });

  it("yeterince çeşitli olmayan jeton reddedilir (aaaa… gibi doldurulmuş dizeler)", () => {
    expect(isPredictableDeviceToken("a".repeat(64))).toBe(true);
    expect(isPredictableDeviceToken("ababababababababababababababababababab")).toBe(true);
  });

  it("gerçek sağlayıcı jetonuna benzeyen değer KABUL EDİLİR", () => {
    // FCM jetonları ~160 karakter, yüksek çeşitlilikte ve UUID içermez.
    const realistic =
      "fMEP0vJqR0yQ3nLxKd7TgH:APA91bH7xQ2ZmV8sNrCyU4wKpLd6TfXaB9gJhMnQeRsVtYuIoP1zXcVbNmAsDfGhJkLqWeRtYu" +
      "IoP0987654321QwErTyUiOpAsDfGhJkLzXcVbNm";
    expect(isPredictableDeviceToken(realistic)).toBe(false);
    expect(
      deviceTokenRegisterSchema.safeParse({ platform: "ANDROID", token: realistic }).success,
    ).toBe(true);
  });

  it("kısa jetonlar da reddedilir — tahmin uzayı küçüktür", () => {
    const short = "aB3dEfGh7JkL";
    expect(deviceTokenRegisterSchema.safeParse({ platform: "IOS", token: short }).success).toBe(
      false,
    );
  });

  it("ret mesajı SEBEBİ söyler — istemci ne yapacağını bilmelidir", () => {
    const result = deviceTokenRegisterSchema.safeParse({
      platform: "IOS",
      token: `ios:${victimId}:ios`,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues.map((i) => i.message).join(" ");
      expect(message).toContain("FCM/APNs");
    }
  });
});
