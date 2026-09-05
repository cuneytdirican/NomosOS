/**
 * /ayarlar — oturum bilgisi, biyometrik kilit, cihaz kaydı, çıkış.
 *
 * Bu ekran aynı zamanda uygulamanın GÜVENLİK BEYANIDIR: kullanıcı cihazında
 * neyin durduğunu ve çıkışın neyi sildiğini burada okur.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Alert, Platform, StyleSheet, Switch, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { API_BASE, API_BASE_PROBLEM, ApiError, errorMessage } from "@/api/client";
import { registerDevice } from "@/api/endpoints";
import { getPushProviderToken } from "@/api/push-token";
import { authenticate, getBiometricCapability, type BiometricCapability } from "@/auth/biometrics";
import { useSession } from "@/auth/session";
import { secureStorage } from "@/auth/secure-storage";
import { useOnline } from "@/net/connectivity";
import { ROLE_LABELS, label } from "@/lib/labels";
import {
  Body,
  Button,
  Card,
  Divider,
  Field,
  Muted,
  ScrollScreen,
  Section,
} from "@/ui/components";
import { colors, font, radius, space } from "@/ui/theme";

export default function SettingsScreen(): React.JSX.Element {
  const router = useRouter();
  const online = useOnline();
  const { user, biometricEnabled, setBiometricEnabled, signOut, lockNow } = useSession();

  const [capability, setCapability] = useState<BiometricCapability | null>(null);
  const [biometricError, setBiometricError] = useState<string | null>(null);
  const [deviceState, setDeviceState] = useState<"idle" | "busy" | "done" | "unavailable" | "error">("idle");
  const [deviceMessage, setDeviceMessage] = useState<string | null>(null);

  useEffect(() => {
    void getBiometricCapability().then(setCapability);
  }, []);

  const toggleBiometric = useCallback(
    async (next: boolean) => {
      setBiometricError(null);
      if (!next) {
        // KAPATIRKEN de doğrulama istenir: telefonu eline geçiren biri
        // kilidi tek dokunuşla kaldıramamalı.
        const result = await authenticate("Biyometrik kilidi kapatmak için kimliğinizi doğrulayın");
        if (!result.success) {
          setBiometricError(result.message ?? "Doğrulanamadı; kilit açık kaldı.");
          return;
        }
        await setBiometricEnabled(false);
        return;
      }

      if (capability?.available !== true) {
        setBiometricError(
          "Bu cihazda kayıtlı bir parmak izi/yüz bulunamadı. Önce cihaz ayarlarından biyometri tanımlayın.",
        );
        return;
      }
      const result = await authenticate("Kilidi kurmak için kimliğinizi doğrulayın");
      if (!result.success) {
        setBiometricError(result.message ?? "Doğrulanamadı.");
        return;
      }
      await setBiometricEnabled(true);
    },
    [capability, setBiometricEnabled],
  );

  /**
   * Cihaz kaydı — anlık bildirim adresi.
   *
   * ╔══════════════════════════════════════════════════════════════════════╗
   * ║ JETON TÜRETİLMEZ (denetim bulgusu 1 — KRİTİK).                       ║
   * ║                                                                      ║
   * ║ Burada eskiden şu satır vardı:                                       ║
   * ║   const token = `${platform}:${user?.id ?? "anonim"}:${Platform.OS}` ║
   * ║                                                                      ║
   * ║ Yani cihaz jetonu TAMAMEN TAHMİN EDİLEBİLİR bir dizeydi ve içindeki  ║
   * ║ `userId` uygulamanın başka uçlarında (görev `assigneeId`, dosya      ║
   * ║ `responsibleUser.id`) açıkça dönüyordu. Sunucudaki `@@unique([token])║
   * ║ tenant'tan bağımsız olduğu ve kayıt `upsert` ile DEVREDİLDİĞİ için,  ║
   * ║ bir stajyer ortağın kimliğiyle jetonu kurup POST edince satır ona    ║
   * ║ geçiyordu — aynı saldırı KİRACILAR ARASI da çalışıyordu. Gerçek      ║
   * ║ FCM/APNs devreye girdiği anda bu, kurbanın süre ve duruşma           ║
   * ║ bildirimlerinin saldırganın telefonuna düşmesi ve kurbanın kendi     ║
   * ║ hatırlatmalarını almayı bırakması demekti.                           ║
   * ║                                                                      ║
   * ║ Gerçek bir sağlayıcı jetonu OLMADAN cihaz kaydı YAPILMAZ. Bugün      ║
   * ║ zaten hiçbir şey gönderilmiyordu (sunucuda NoopPushProvider), yani   ║
   * ║ kaydın tek etkisi bu açığı ayakta tutmaktı. Sunucu da artık          ║
   * ║ türetilmiş jetonları reddediyor (device-tokens.schemas.ts).          ║
   * ║                                                                      ║
   * ║ Faz 2: Expo push jetonu (`getExpoPushTokenAsync`) `push-token.ts`'ten   ║
   * ║ jeton `registerDevice(token, platform)` çağrısına verilecek; bu      ║
   * ║ ekranda değişecek tek şey jetonun KAYNAĞIDIR.                        ║
   * ╚══════════════════════════════════════════════════════════════════════╝
   */
  const registerThisDevice = useCallback(async () => {
    if (!online) {
      setDeviceState("error");
      setDeviceMessage("Bağlantı gerekli.");
      return;
    }
    const providerToken = await getPushProviderToken();
    if (providerToken === null) {
      setDeviceState("unavailable");
      setDeviceMessage(
        "Anlık bildirim jetonu alınamadı: bildirim izni verilmemiş olabilir ya da bu bir simülatördür " +
          "(push yalnız fiziksel cihazda çalışır). Kimlikten türetilmiş sahte bir jeton KAYDEDİLMEZ. " +
          "Süre ve duruşma hatırlatmaları uygulama içinde tam olarak çalışmaya devam ediyor.",
      );
      return;
    }
    setDeviceState("busy");
    setDeviceMessage(null);
    const platform = Platform.OS === "ios" ? "IOS" : Platform.OS === "android" ? "ANDROID" : "WEB";
    try {
      await registerDevice(providerToken, platform);
      // Jeton anahtarlığa yazılır: çıkışta sunucudaki kaydı İPTAL edebilmek
      // için hangi jetonun kaydedildiğini bilmek gerekir (bulgu 8).
      await secureStorage.setDeviceToken(providerToken);
      setDeviceState("done");
      setDeviceMessage("Cihaz kaydedildi. Bildirimler yayına alındığında bu cihaza gelir.");
    } catch (caught) {
      if (caught instanceof ApiError && caught.isNotImplemented) {
        setDeviceState("unavailable");
        setDeviceMessage("Cihaz kaydı ucu bu sunucuda henüz açık değil. Uygulamanın geri kalanı etkilenmez.");
      } else {
        setDeviceState("error");
        setDeviceMessage(errorMessage(caught));
      }
    }
  }, [online]);

  const confirmSignOut = useCallback(() => {
    Alert.alert(
      "Çıkış yapılsın mı?",
      "Oturum kapatılır ve cihazdaki kopya veriler (oturum anahtarı, «Bugün» önbelleği) silinir.",
      [
        { text: "Vazgeç", style: "cancel" },
        {
          text: "Çıkış yap",
          style: "destructive",
          onPress: () => {
            void signOut().then(() => router.replace("/giris"));
          },
        },
      ],
    );
  }, [router, signOut]);

  return (
    <>
      <Stack.Screen options={{ title: "Ayarlar" }} />
      <ScrollScreen>
        <Section title="Oturum">
          <Card>
            <Field label="Ad soyad" value={user?.fullName ?? "—"} />
            <Field label="E-posta" value={user?.email ?? "—"} />
            <Field label="Rol" value={label(ROLE_LABELS, user?.role)} />
            <Divider />
            <Muted>Sunucu: {API_BASE || "— (yapılandırılmamış)"}</Muted>
            {API_BASE_PROBLEM ? <Body style={styles.error}>{API_BASE_PROBLEM}</Body> : null}
            <Muted>Kimlik alanı: büro (tenant) API'si — /api/v1</Muted>
          </Card>
        </Section>

        <Section title="Güvenlik">
          <Card>
            <View style={styles.switchRow}>
              <View style={styles.switchText}>
                <Body style={styles.switchLabel}>
                  {capability?.label ?? "Biyometrik"} kilidi
                </Body>
                <Muted>
                  Uygulama arka planda 45 saniyeden uzun kalırsa ekran kilitlenir ve kimlik doğrulaması ister.
                </Muted>
              </View>
              <Switch
                value={biometricEnabled}
                onValueChange={(next) => void toggleBiometric(next)}
                trackColor={{ false: colors.border, true: colors.goldLight }}
                thumbColor={colors.surface}
              />
            </View>
            {capability !== null && !capability.available ? (
              <Muted style={styles.warn}>
                Bu cihazda kullanılabilir biyometri bulunamadı ({capability.hasHardware ? "kayıt yok" : "donanım yok"}).
              </Muted>
            ) : null}
            {biometricError ? <Body style={styles.error}>{biometricError}</Body> : null}

            {biometricEnabled ? (
              <Button title="Şimdi kilitle" variant="secondary" onPress={lockNow} style={styles.action} />
            ) : null}
          </Card>

          <Card>
            <Body style={styles.noticeTitle}>Cihazınızda ne duruyor?</Body>
            <Muted style={styles.notice}>
              • Oturum anahtarı (JWT) — cihazın donanım destekli anahtarlığında (Keychain / Keystore); yedeğe çıkmaz.
              {"\n"}• «Bugün» ekranının indirgenmiş bir kopyası — duruşma saati, mahkeme, esas no, müvekkil adı,
              süre başlıkları. Kimlik numarası, adres, telefon, belge içeriği ve hazırlık brifingi cihazda TUTULMAZ.
              {"\n"}• Belgeler bu uygulamaya indirilmez; sunucudan süreli bağlantıyla açılır. DİKKAT: bağlantı
              cihazın tarayıcısında açılır. Tarayıcı dosyayı kendi önbelleğine alabilir, PDF'i İndirilenler'e
              kaydedebilir ve adresi geçmişine yazar; bunlar bu uygulamanın alanı DIŞINDADIR ve çıkışta silinmez.
              Hassas belgeleri açtıktan sonra tarayıcı sekmesini ve indirilenleri kendiniz temizleyin.
              {"\n\n"}Çıkış yaptığınızda uygulamanın kendi sakladıkları (oturum anahtarı, «Bugün» önbelleği, kayıtlı
              cihaz kaydı) silinir. Cihazınız kaybolursa bürodan oturumu kapattırın ve cihazı uzaktan silin.
            </Muted>
          </Card>
        </Section>

        <Section title="Bildirimler">
          <Card>
            <Body style={styles.switchLabel}>Bu cihazı kaydet</Body>
            <Muted style={styles.notice}>
              Süre ve duruşma hatırlatmalarının bu cihaza ulaşabilmesi için cihaz sunucuya kaydedilir.
            </Muted>
            {deviceMessage ? (
              <Body
                style={
                  deviceState === "error"
                    ? styles.error
                    : deviceState === "done"
                      ? styles.info
                      : styles.neutral
                }
              >
                {deviceMessage}
              </Body>
            ) : null}
            <Button
              title={deviceState === "done" ? "Yeniden kaydet" : "Cihazı kaydet"}
              variant="secondary"
              loading={deviceState === "busy"}
              onPress={() => void registerThisDevice()}
              style={styles.action}
            />
          </Card>
        </Section>

        <Section title="Mobilde olmayan işlemler">
          <Card>
            <Muted style={styles.notice}>
              Dosya ve müvekkil açma · dilekçe üretimi · belge yükleme · finans, fatura ve tahsilat · raporlar ·
              icra takibi · çakışma taraması · AI asistanı. Bunlar bilinçli olarak büro panelinde (masaüstü)
              bırakılmıştır; ayrıntısı için README'ye bakın.
            </Muted>
          </Card>
        </Section>

        <Button title="Çıkış yap" variant="danger" onPress={confirmSignOut} style={styles.signOut} />
      </ScrollScreen>
    </>
  );
}

const styles = StyleSheet.create({
  switchRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  switchText: { flex: 1 },
  switchLabel: { fontWeight: "700", marginBottom: 2 },
  notice: { lineHeight: 21 },
  noticeTitle: { fontWeight: "700", marginBottom: space.sm },
  warn: { color: colors.warn, marginTop: space.sm },
  error: {
    color: colors.danger,
    backgroundColor: colors.dangerBg,
    borderRadius: radius.sm,
    padding: space.sm,
    fontSize: font.small,
    marginTop: space.sm,
  },
  info: {
    color: colors.ok,
    backgroundColor: colors.okBg,
    borderRadius: radius.sm,
    padding: space.sm,
    fontSize: font.small,
    marginTop: space.sm,
  },
  neutral: {
    color: colors.textSoft,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: space.sm,
    fontSize: font.small,
    marginTop: space.sm,
  },
  action: { marginTop: space.md },
  signOut: { marginTop: space.lg },
});
