/**
 * Sekme düzeni — sahada ihtiyaç sırasına göre soldan sağa:
 * Bugün → Süreler → Görevler → Dosyalar → Bildirimler.
 *
 * Sekme sayısı beşle sınırlıdır; altıncı sekme dokunma hedeflerini
 * adliyede kullanılamayacak kadar daraltır. Ayarlar sekmede değil,
 * Bugün ekranının başlığındaki dişli simgesindedir.
 */

import React from "react";
import { Pressable } from "react-native";
import { Tabs, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, TOUCH } from "@/ui/theme";

export default function TabsLayout(): React.JSX.Element {
  const router = useRouter();

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.navy },
        headerTintColor: colors.onNavy,
        headerTitleStyle: { fontWeight: "700" },
        tabBarActiveTintColor: colors.gold,
        tabBarInactiveTintColor: colors.onNavySoft,
        tabBarStyle: { backgroundColor: colors.navy, borderTopColor: colors.navyLight, height: TOUCH.min + 26 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "700", paddingBottom: 4 },
        tabBarItemStyle: { paddingTop: 6 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Bugün",
          tabBarIcon: ({ color, size }) => <Ionicons name="today-outline" color={color} size={size} />,
          // Ayarlar sekme çubuğunda yer kaplamasın diye başlıktaki dişlidedir.
          headerRight: () => (
            <Pressable
              onPress={() => router.push("/ayarlar")}
              hitSlop={14}
              accessibilityRole="button"
              accessibilityLabel="Ayarlar"
              style={{ paddingHorizontal: 12 }}
            >
              <Ionicons name="settings-outline" size={24} color={colors.onNavy} />
            </Pressable>
          ),
        }}
      />
      <Tabs.Screen
        name="sureler"
        options={{
          title: "Süreler",
          tabBarIcon: ({ color, size }) => <Ionicons name="alarm-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="gorevler"
        options={{
          title: "Görevler",
          tabBarIcon: ({ color, size }) => <Ionicons name="checkbox-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="dosyalar"
        options={{
          title: "Dosyalar",
          tabBarIcon: ({ color, size }) => <Ionicons name="folder-open-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="bildirimler"
        options={{
          title: "Bildirim",
          tabBarIcon: ({ color, size }) => <Ionicons name="notifications-outline" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
