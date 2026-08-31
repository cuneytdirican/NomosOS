/**
 * /giris — kiracı (büro) girişi.
 *
 * Sunucu tarafında IP + e-posta başına dakikada 5 deneme sınırı vardır
 * (LoginThrottleGuard); istemci de art arda gönderimi engeller. Hata mesajı
 * sunucudan geldiği gibi gösterilir — "hesap var mı yok mu" bilgisini sızdırmaz.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { API_BASE, errorMessage } from "@/api/client";
import { getBiometricCapability } from "@/auth/biometrics";
import { useSession } from "@/auth/session";
import { Button } from "@/ui/components";
import { colors, font, radius, space, TOUCH } from "@/ui/theme";

export default function LoginScreen(): React.JSX.Element {
  const { signIn, rememberedEmail, setBiometricEnabled, biometricEnabled } = useSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [biometricLabel, setBiometricLabel] = useState<string | null>(null);
  const [offerBiometric, setOfferBiometric] = useState(false);

  useEffect(() => {
    if (rememberedEmail) {
      setEmail(rememberedEmail);
      setRemember(true);
    }
  }, [rememberedEmail]);

  useEffect(() => {
    void getBiometricCapability().then((capability) => {
      if (capability.available) setBiometricLabel(capability.label);
    });
  }, []);

  const submit = useCallback(async () => {
    if (busy) return;
    if (email.trim().length === 0 || password.length === 0) {
      setError("E-posta ve şifre girilmelidir.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password, remember);
      // Giriş başarılı: biyometri kurulu değilse ÖNERİ gösterilir, zorlanmaz.
      if (biometricLabel !== null && !biometricEnabled) {
        setOfferBiometric(true);
      }
      // Yönlendirmeyi kök düzen yapar (oturum durumu değişince).
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }, [busy, email, password, remember, signIn, biometricLabel, biometricEnabled]);

  if (offerBiometric && biometricLabel) {
    return (
      <View style={styles.root}>
        <View style={styles.offerBox}>
          <Text style={styles.brand}>NomosOS</Text>
          <Text style={styles.offerTitle}>{biometricLabel} ile kilitleyin</Text>
          <Text style={styles.offerText}>
            Bu uygulama müvekkil dosyalarına erişir. Telefonunuz kaybolursa ya da elden ele geçerse,
            {" "}
            {biometricLabel.toLocaleLowerCase("tr-TR")} kilidi ekranı kapalı tutar. Ayarlar bölümünden istediğiniz
            zaman değiştirebilirsiniz.
          </Text>
          <Button
            title={`${biometricLabel} kilidini aç`}
            onPress={() => {
              void setBiometricEnabled(true).then(() => setOfferBiometric(false));
            }}
            style={styles.offerAction}
          />
          <Button title="Şimdilik geç" variant="ghost" onPress={() => setOfferBiometric(false)} style={styles.offerAction} />
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>NomosOS</Text>
        <Text style={styles.tagline}>Büro paneli — saha erişimi</Text>

        <View style={styles.form}>
          <Text style={styles.label}>E-posta</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            placeholder="ad.soyad@buro.av.tr"
            placeholderTextColor={colors.textMuted}
            editable={!busy}
            returnKeyType="next"
          />

          <Text style={styles.label}>Şifre</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="password"
            textContentType="password"
            placeholder="••••••••"
            placeholderTextColor={colors.textMuted}
            editable={!busy}
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
          />

          <Pressable
            style={styles.rememberRow}
            onPress={() => setRemember((value) => !value)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: remember }}
          >
            <View style={[styles.checkbox, remember ? styles.checkboxOn : null]}>
              {remember ? <Text style={styles.checkmark}>✓</Text> : null}
            </View>
            <View style={styles.rememberTextBox}>
              <Text style={styles.rememberLabel}>Beni hatırla</Text>
              <Text style={styles.rememberHint}>Yalnızca e-posta adresi saklanır; şifre cihazda tutulmaz.</Text>
            </View>
          </Pressable>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button title="Giriş yap" onPress={() => void submit()} loading={busy} style={styles.submit} />
        </View>

        <Text style={styles.footer}>Sunucu: {API_BASE}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.navy },
  scroll: { flexGrow: 1, justifyContent: "center", padding: space.xl },

  brand: { color: colors.goldSoft, fontSize: 32, fontWeight: "800", letterSpacing: 2, textAlign: "center" },
  tagline: {
    color: colors.onNavySoft,
    fontSize: font.body,
    textAlign: "center",
    marginTop: space.xs,
    marginBottom: space.xxl,
  },

  form: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.xl },
  label: { fontSize: font.small, fontWeight: "700", color: colors.textSoft, marginBottom: space.xs },
  input: {
    minHeight: TOUCH.min,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    fontSize: font.body,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    marginBottom: space.lg,
  },

  rememberRow: { flexDirection: "row", alignItems: "flex-start", paddingVertical: space.sm, minHeight: TOUCH.min },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.navyLighter,
    alignItems: "center",
    justifyContent: "center",
    marginRight: space.md,
    marginTop: 2,
  },
  checkboxOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  checkmark: { color: "#FFFFFF", fontSize: 16, fontWeight: "800", lineHeight: 18 },
  rememberTextBox: { flex: 1 },
  rememberLabel: { fontSize: font.body, fontWeight: "600", color: colors.text },
  rememberHint: { fontSize: font.tiny, color: colors.textMuted, lineHeight: 17, marginTop: 2 },

  error: {
    color: colors.danger,
    backgroundColor: colors.dangerBg,
    borderRadius: radius.sm,
    padding: space.md,
    fontSize: font.small,
    lineHeight: 20,
    marginTop: space.sm,
  },
  submit: { marginTop: space.lg },

  footer: { color: colors.navyLighter, fontSize: font.tiny, textAlign: "center", marginTop: space.xl },

  offerBox: {
    flex: 1,
    justifyContent: "center",
    padding: space.xl,
  },
  offerTitle: {
    color: colors.onNavy,
    fontSize: font.h1,
    fontWeight: "700",
    textAlign: "center",
    marginTop: space.xxl,
    marginBottom: space.md,
  },
  offerText: {
    color: colors.onNavySoft,
    fontSize: font.body,
    lineHeight: 24,
    textAlign: "center",
    marginBottom: space.xl,
  },
  offerAction: { alignSelf: "stretch", marginBottom: space.sm },
});
