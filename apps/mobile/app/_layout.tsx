/**
 * Kök düzen — oturum, bağlantı ve kilit katmanları.
 *
 * Yönlendirme kuralı tek yerdedir: oturum yoksa /giris, varsa sekmeler.
 * Kilit, yönlendirmenin ÜSTÜNDE bir kaplamadır (ekranı sökmez), böylece
 * kilit açılınca kullanıcı kaldığı yerden devam eder.
 */

import React, { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { Stack, useRouter, useSegments } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StyleSheet, Text, View } from "react-native";
import { SessionProvider, useSession } from "@/auth/session";
import { LockScreen } from "@/auth/lock-screen";
import { ConnectivityProvider } from "@/net/connectivity";
import { Loading } from "@/ui/components";
import { colors } from "@/ui/theme";

function RootNavigator(): React.JSX.Element {
  const { authenticated, ready, locked, obscured } = useSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    const onLoginScreen = segments[0] === "giris";
    if (!authenticated && !onLoginScreen) {
      router.replace("/giris");
    } else if (authenticated && onLoginScreen) {
      router.replace("/");
    }
  }, [ready, authenticated, segments, router]);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Loading label="Oturum kontrol ediliyor…" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.navy },
          headerTintColor: colors.onNavy,
          headerTitleStyle: { fontWeight: "700" },
          headerBackTitle: "Geri",
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="giris" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="durusma/[id]" options={{ title: "Duruşma" }} />
        <Stack.Screen name="dosya/[id]" options={{ title: "Dosya" }} />
        <Stack.Screen name="belge/yukle" options={{ title: "Belge yükle" }} />
        <Stack.Screen name="ayarlar" options={{ title: "Ayarlar" }} />
        <Stack.Screen name="ajanda" options={{ title: "Ajanda" }} />
        <Stack.Screen name="mesajlar" options={{ title: "Mesajlar" }} />
      </Stack>
      {authenticated && locked ? <LockScreen /> : null}
      {/*
        GİZLEME KAPLAMASI — kilitten AYRI ve ONUN ÜSTÜNDE.
        Uygulama arka plana geçerken (`inactive`) işletim sistemi görev
        değiştirici için bir anlık görüntü alır; kaplama olmasaydı "Bugün"
        ekranı müvekkil adları ve esas numaralarıyla OS'un anlık görüntü
        deposuna yazılır ve uygulama değiştiricide herkese görünürdü
        (denetim bulgusu 16). Kaplama biyometri KAPALIYKEN de gösterilir:
        anlık görüntü her kullanıcıda alınır. Geri dönüşte doğrulama
        istemeden kalkar; doğrulama kararı `locked`ın işidir.
      */}
      {authenticated && obscured ? (
        <View style={styles.obscure}>
          <Text style={styles.obscureText}>NomosOS</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  obscure: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.navy,
    alignItems: "center",
    justifyContent: "center",
    // Kilit ekranı zIndex 100 kullanır; kaplama onun da üstünde olmalıdır ki
    // kilit açılırken alınan anlık görüntüde altı görünmesin.
    zIndex: 200,
  },
  obscureText: { color: colors.onNavy, fontSize: 24, fontWeight: "700", letterSpacing: 1 },
});

export default function RootLayout(): React.JSX.Element {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ConnectivityProvider>
          <SessionProvider>
            <StatusBar style="light" backgroundColor={colors.navy} />
            <RootNavigator />
          </SessionProvider>
        </ConnectivityProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/** Derin bağlantıyla açılan bir alt ekrandan geri dönüşte kök sekmelere düşülür. */
export const unstable_settings = { initialRouteName: "(tabs)" };
