/**
 * Hassas veri deposu — expo-secure-store (iOS Keychain / Android Keystore).
 *
 * NEDEN AsyncStorage DEĞİL: AsyncStorage, Android'de uygulama sanal alanındaki
 * düz bir SQLite dosyasıdır. Root'lu/jailbreak'li ya da yedeği alınmış bir
 * cihazda okunabilir. JWT bu uygulamada MÜVEKKİL DOSYALARINA açılan anahtardır;
 * donanım destekli anahtarlıkta durur.
 *
 * SINIR: SecureStore büyük değerler için uygun değildir (Android'de ~2 KB
 * üzerinde uyarı verir/başarısız olabilir). Yalnızca token ve küçük tercihler
 * burada tutulur; "Bugün" önbelleği ayrı bir dosyaya yazılır
 * (bkz. src/cache/today-cache.ts).
 */

import * as SecureStore from "expo-secure-store";

const KEY_TOKEN = "nomosos_token";
const KEY_USER = "nomosos_user";
const KEY_BIOMETRIC = "nomosos_biometric_enabled";
const KEY_REMEMBER_EMAIL = "nomosos_remember_email";
/**
 * Sunucuya kaydedilmiş cihaz jetonu.
 *
 * Çıkışta `DELETE /device-tokens/:token` çağrılabilsin diye saklanır: hangi
 * jetonun iptal edileceğini bilmeden sunucudaki kayıt aktif kalır ve cihaz,
 * artık kullanmadığı hesabın bildirim hedefi olmayı sürdürür (bulgu 8).
 * Jeton bir kimlik bilgisidir; bu yüzden düz dosyaya değil anahtarlığa yazılır.
 */
const KEY_DEVICE_TOKEN = "nomosos_device_token";

async function read(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    // Anahtarlık erişilemiyorsa (cihaz kilidi kaldırılmış, anahtar geçersiz)
    // oturum yokmuş gibi davranılır — kullanıcı yeniden giriş yapar.
    return null;
  }
}

async function write(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value, {
      // Anahtar yalnızca cihaz bu cihazda kilidi açıldıktan sonra çözülür ve
      // iCloud/iTunes yedeğine ÇIKMAZ: yedekten başka bir cihaza taşınan bir
      // token'la müvekkil verisine erişilmesini engeller.
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch {
    /* Yazılamazsa oturum kalıcı olmaz; uygulama çalışmaya devam eder. */
  }
}

async function remove(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    /* yoksay */
  }
}

export const secureStorage = {
  getToken: () => read(KEY_TOKEN),
  setToken: (token: string) => write(KEY_TOKEN, token),
  clearToken: () => remove(KEY_TOKEN),

  async getUser<T>(): Promise<T | null> {
    const raw = await read(KEY_USER);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
  setUser: (user: unknown) => write(KEY_USER, JSON.stringify(user)),
  clearUser: () => remove(KEY_USER),

  async isBiometricEnabled(): Promise<boolean> {
    return (await read(KEY_BIOMETRIC)) === "1";
  },
  setBiometricEnabled: (enabled: boolean) =>
    enabled ? write(KEY_BIOMETRIC, "1") : remove(KEY_BIOMETRIC),

  /**
   * "Beni hatırla" YALNIZCA E-POSTAYI saklar. Şifre hiçbir koşulda cihazda
   * tutulmaz; oturumun kalıcılığı zaten token ile sağlanır.
   */
  getRememberedEmail: () => read(KEY_REMEMBER_EMAIL),
  setRememberedEmail: (email: string) => write(KEY_REMEMBER_EMAIL, email),
  clearRememberedEmail: () => remove(KEY_REMEMBER_EMAIL),

  getDeviceToken: () => read(KEY_DEVICE_TOKEN),
  setDeviceToken: (token: string) => write(KEY_DEVICE_TOKEN, token),
  clearDeviceToken: () => remove(KEY_DEVICE_TOKEN),
};
