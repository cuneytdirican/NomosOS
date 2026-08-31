/**
 * Kilit ekranı — uygulama arka plandan döndüğünde içeriğin ÜZERİNİ kapatır.
 *
 * Kilit açılmadan altındaki ekran görünmez; ekran görüntüsü alan/omuz üstünden
 * bakan biri müvekkil adını dahi göremez. Çıkış her zaman kullanılabilirdir:
 * biyometri bozulduğunda kullanıcı uygulamada mahsur kalmamalıdır.
 */

import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/ui/components";
import { colors, font, space } from "@/ui/theme";
import { authenticate } from "./biometrics";
import { useSession } from "./session";

export function LockScreen(): React.JSX.Element {
  const { unlock, signOut, user } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tryUnlock = useCallback(async () => {
    setBusy(true);
    setError(null);
    const result = await authenticate("NomosOS'u açmak için kimliğinizi doğrulayın");
    setBusy(false);
    if (result.success) {
      unlock();
    } else {
      setError(result.message ?? "Kimlik doğrulanamadı.");
    }
  }, [unlock]);

  // Kilit görünür olur olmaz doğrulama istenir; kullanıcı fazladan bir
  // dokunuş yapmak zorunda kalmasın.
  useEffect(() => {
    void tryUnlock();
  }, [tryUnlock]);

  return (
    <View style={styles.root}>
      <View style={styles.content}>
        <Text style={styles.brand}>NomosOS</Text>
        <Text style={styles.title}>Uygulama kilitli</Text>
        <Text style={styles.subtitle}>
          {user ? `${user.fullName} olarak oturum açık.` : "Oturum açık."} Devam etmek için kimliğinizi doğrulayın.
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button title="Kilidi aç" onPress={() => void tryUnlock()} loading={busy} style={styles.action} />
        <Button title="Çıkış yap" variant="ghost" onPress={() => void signOut()} style={styles.actionGhost} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.navy,
    alignItems: "center",
    justifyContent: "center",
    padding: space.xl,
    zIndex: 100,
  },
  content: { width: "100%", maxWidth: 420, alignItems: "center" },
  brand: { color: colors.goldSoft, fontSize: font.h2, fontWeight: "800", letterSpacing: 2, marginBottom: space.xxl },
  title: { color: colors.onNavy, fontSize: font.h1, fontWeight: "700", marginBottom: space.sm },
  subtitle: {
    color: colors.onNavySoft,
    fontSize: font.body,
    textAlign: "center",
    lineHeight: 23,
    marginBottom: space.xl,
  },
  error: { color: colors.goldSoft, fontSize: font.small, textAlign: "center", marginBottom: space.lg },
  action: { alignSelf: "stretch" },
  actionGhost: { alignSelf: "stretch", marginTop: space.sm },
});
