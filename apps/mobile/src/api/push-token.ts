/**
 * ANLIK BİLDİRİM (PUSH) JETONU KAYNAĞI — Faz 2: Expo Push.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ JETON YALNIZ SAĞLAYICIDAN GELİR. TÜRETİLMEZ, UYDURULMAZ.                 ║
 * ║                                                                          ║
 * ║ Cihaz jetonu bir KİMLİK BİLGİSİDİR: onu bilen, o cihaza bildirim         ║
 * ║ gönderebilir. Tek geçerli kaynağı Expo Push servisidir                   ║
 * ║ (`ExponentPushToken[...]`); Expo bunu FCM/APNs'e kendisi eşler. Sunucu   ║
 * ║ tarafı (`ExpoPushProvider`) yalnız bu biçimdeki jetonlara gönderir.      ║
 * ║                                                                          ║
 * ║ İzin verilmezse, fiziksel cihaz değilse (simülatör push alamaz) ya da    ║
 * ║ EAS projectId yoksa `null` döner ve çağıran taraf CİHAZ KAYDI YAPMAZ.    ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

/** Ön planda gelen bildirim de gösterilsin (varsayılan sessizdir). */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId;
}

/**
 * Sağlayıcının verdiği gerçek Expo push jetonu; izin/cihaz/proje yoksa `null`.
 */
export async function getPushProviderToken(): Promise<string | null> {
  if (!Device.isDevice) return null;
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "NomosOS hatırlatmaları",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== "granted") {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== "granted") return null;
    const id = projectId();
    const token = await Notifications.getExpoPushTokenAsync(id ? { projectId: id } : undefined);
    return token.data || null;
  } catch {
    return null;
  }
}

/** Sağlayıcı yapılandırılmış mı — arayüz metinleri buna bakabilir. */
export const PUSH_PROVIDER_CONFIGURED = true;
