/**
 * Biyometrik kilit — expo-local-authentication.
 *
 * NE OLDUĞU: uygulamayı arka plandan dönüşte kapatan bir EKRAN KİLİDİDİR.
 * NE OLMADIĞI: şifreleme değildir. Parmak izi doğrulaması token'ı çözmez;
 * token zaten anahtarlıkta durur. Kilit, telefonu masada açık bırakmış bir
 * avukatın ekranını yanındaki kişiden korur — cihazı ele geçirmiş, kök
 * erişimi olan bir saldırgandan korumaz. Bu ayrım README'de de yazılıdır.
 */

import * as LocalAuthentication from "expo-local-authentication";

export interface BiometricCapability {
  /** Cihazda parmak izi/yüz donanımı var mı? */
  hasHardware: boolean;
  /** Kullanıcı en az bir biyometri kaydetmiş mi? */
  isEnrolled: boolean;
  /** Kilit açılabilir durumda mı? */
  available: boolean;
  /** "Parmak izi" / "Yüz tanıma" / "Cihaz kilidi" — arayüz metni için. */
  label: string;
}

export async function getBiometricCapability(): Promise<BiometricCapability> {
  try {
    const [hasHardware, isEnrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);

    let label = "Cihaz kilidi";
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
      label = "Yüz tanıma";
    } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
      label = "Parmak izi";
    } else if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
      label = "İris";
    }

    return { hasHardware, isEnrolled, available: hasHardware && isEnrolled, label };
  } catch {
    return { hasHardware: false, isEnrolled: false, available: false, label: "Cihaz kilidi" };
  }
}

export interface BiometricResult {
  success: boolean;
  /** Kullanıcıya gösterilecek Türkçe açıklama (başarısızlıkta). */
  message?: string;
}

export async function authenticate(reason = "NomosOS'u açmak için kimliğinizi doğrulayın"): Promise<BiometricResult> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      cancelLabel: "Vazgeç",
      // Biyometri başarısız olursa cihazın PIN/desen ekranına düşülür:
      // parmağı ıslak bir avukat dosyasına erişemez hâle gelmemeli.
      disableDeviceFallback: false,
    });

    if (result.success) return { success: true };

    const error = "error" in result ? result.error : "unknown";
    if (error === "user_cancel" || error === "system_cancel" || error === "app_cancel") {
      return { success: false, message: "Doğrulama iptal edildi." };
    }
    if (error === "lockout" || error === "lockout_permanent") {
      return {
        success: false,
        message: "Çok fazla başarısız deneme. Cihazınızı kilit ekranından açın, sonra tekrar deneyin.",
      };
    }
    if (error === "not_enrolled" || error === "not_available") {
      return { success: false, message: "Bu cihazda biyometrik doğrulama kullanılamıyor." };
    }
    return { success: false, message: "Kimlik doğrulanamadı." };
  } catch {
    return { success: false, message: "Kimlik doğrulama başlatılamadı." };
  }
}
