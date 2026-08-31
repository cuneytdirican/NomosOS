/**
 * Ortak arayüz parçaları.
 *
 * Saha kuralları burada kodlanır: büyük dokunma hedefi (TOUCH.min), yüksek
 * kontrast, hata durumunda TEKRAR DENE düğmesi (adliyede şebeke gelip gider),
 * ve AI çıktısının her göründüğü yerde "öneri" şeridi.
 */

import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { colors, font, radius, space, TOUCH, tones, type ToneName } from "./theme";

// ---------------------------------------------------------------------------
// Metin
// ---------------------------------------------------------------------------

export function H1({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.h1, style]}>{children}</Text>;
}

export function H2({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.h2, style]}>{children}</Text>;
}

export function Body({
  children,
  style,
  numberOfLines,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  return (
    <Text style={[styles.body, style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

export function Muted({
  children,
  style,
  numberOfLines,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  return (
    <Text style={[styles.muted, style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

/** Etiket + değer satırı — künye ekranlarının temel yapı taşı. */
export function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {typeof value === "string" || typeof value === "number" ? (
        <Text style={styles.fieldValue} selectable>
          {value === "" ? "—" : value}
        </Text>
      ) : (
        value
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Kaplar
// ---------------------------------------------------------------------------

export function Card({
  children,
  style,
  onPress,
  accent,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  /** Sol kenar şeridi rengi — aciliyet göstergesi. */
  accent?: string;
}) {
  const content = (
    <View style={[styles.card, accent ? { borderLeftWidth: 5, borderLeftColor: accent } : null, style]}>
      {children}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => (pressed ? styles.pressed : null)}>
      {content}
    </Pressable>
  );
}

export function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <H2>{title}</H2>
        {right}
      </View>
      {children}
    </View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

// ---------------------------------------------------------------------------
// Rozet
// ---------------------------------------------------------------------------

export function Badge({ text, tone: toneName = "gray" }: { text: string; tone?: ToneName }) {
  const palette = tones[toneName];
  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }]}>
      <Text style={[styles.badgeText, { color: palette.fg }]}>{text}</Text>
    </View>
  );
}

/**
 * AI ÖNERİ ŞERİDİ — ürün ilkesi: "AI çıktısı ÖNERİDİR".
 * AI üretimi hiçbir metin bu şerit olmadan gösterilmez.
 */
export function AiSuggestionBanner({ text = "Bu metin yapay zekâ tarafından üretilmiş bir ÖNERİDİR; bağlayıcı değildir, kontrol edilmelidir." }: { text?: string }) {
  return (
    <View style={styles.aiBanner}>
      <Text style={styles.aiBannerTitle}>AI ÖNERİSİ</Text>
      <Text style={styles.aiBannerText}>{text}</Text>
    </View>
  );
}

/** Çevrimdışı şeridi — verinin yaşını saklamaz. */
export function OfflineBanner({ capturedAtLabel }: { capturedAtLabel: string }) {
  return (
    <View style={styles.offlineBanner}>
      <Text style={styles.offlineText}>Çevrimdışı — son güncelleme {capturedAtLabel}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Düğmeler
// ---------------------------------------------------------------------------

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export function Button({
  title,
  onPress,
  variant = "primary",
  disabled,
  loading,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const isDisabled = disabled === true || loading === true;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading === true }}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        buttonVariants[variant],
        isDisabled ? styles.buttonDisabled : null,
        pressed && !isDisabled ? styles.pressed : null,
        style,
      ]}
    >
      {loading === true ? (
        <ActivityIndicator color={variant === "secondary" || variant === "ghost" ? colors.navy : "#FFFFFF"} />
      ) : (
        <Text style={[styles.buttonText, buttonTextVariants[variant]]}>{title}</Text>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Durum ekranları
// ---------------------------------------------------------------------------

export function Loading({ label = "Yükleniyor…" }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.navy} />
      <Text style={styles.centerText}>{label}</Text>
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.center}>
      <View style={styles.errorBox}>
        <Text style={styles.errorTitle}>İşlem tamamlanamadı</Text>
        <Text style={styles.errorText}>{message}</Text>
      </View>
      {onRetry ? <Button title="Tekrar dene" onPress={onRetry} variant="secondary" style={styles.retry} /> : null}
    </View>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {hint ? <Text style={styles.emptyHint}>{hint}</Text> : null}
    </View>
  );
}

/**
 * Mobilde bilinçli olarak bulunmayan işlemler için yönlendirme kutusu.
 * "Bozuk" hissi vermez; kararın kasıtlı olduğunu söyler.
 */
export function DesktopOnlyNote({ what }: { what: string }) {
  return (
    <View style={styles.desktopNote}>
      <Text style={styles.desktopNoteText}>
        {what} mobilde yapılmaz. Bu işlem büro panelinden (masaüstü) yürütülür.
      </Text>
    </View>
  );
}

export function Screen({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.screen, style]}>{children}</View>;
}

export function ScrollScreen({
  children,
  refreshControl,
}: {
  children: React.ReactNode;
  /** ScrollView'in beklediği tipin aynısı — `RefreshControl` öğesi. */
  refreshControl?: React.ComponentProps<typeof ScrollView>["refreshControl"];
}) {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
    >
      {children}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------

const buttonVariants: Record<ButtonVariant, ViewStyle> = {
  primary: { backgroundColor: colors.gold },
  secondary: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.navyLighter },
  danger: { backgroundColor: colors.danger },
  ghost: { backgroundColor: "transparent" },
};

const buttonTextVariants: Record<ButtonVariant, TextStyle> = {
  primary: { color: "#FFFFFF" },
  secondary: { color: colors.navy },
  danger: { color: "#FFFFFF" },
  ghost: { color: colors.navy },
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { padding: space.lg, paddingBottom: space.xxl * 2 },

  h1: { fontSize: font.h1, fontWeight: "700", color: colors.text, letterSpacing: -0.4 },
  h2: { fontSize: font.h2, fontWeight: "700", color: colors.text },
  body: { fontSize: font.body, color: colors.text, lineHeight: 23 },
  muted: { fontSize: font.small, color: colors.textSoft, lineHeight: 20 },

  field: { marginBottom: space.md },
  fieldLabel: {
    fontSize: font.tiny,
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    fontWeight: "700",
    marginBottom: 2,
  },
  fieldValue: { fontSize: font.body, color: colors.text, lineHeight: 22 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: space.lg,
    marginBottom: space.md,
  },
  pressed: { opacity: 0.7 },

  section: { marginBottom: space.xl },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: space.md,
  },
  divider: { height: 1, backgroundColor: colors.borderSoft, marginVertical: space.md },

  badge: {
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    alignSelf: "flex-start",
  },
  badgeText: { fontSize: font.tiny, fontWeight: "700" },

  aiBanner: {
    backgroundColor: "#FEF3C7",
    borderLeftWidth: 5,
    borderLeftColor: colors.gold,
    borderRadius: radius.sm,
    padding: space.md,
    marginBottom: space.md,
  },
  aiBannerTitle: {
    fontSize: font.tiny,
    fontWeight: "800",
    color: "#92400E",
    letterSpacing: 0.8,
    marginBottom: 3,
  },
  aiBannerText: { fontSize: font.small, color: "#78350F", lineHeight: 19 },

  offlineBanner: {
    backgroundColor: colors.navyLight,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
  },
  offlineText: { color: colors.goldSoft, fontSize: font.small, fontWeight: "600", textAlign: "center" },

  button: {
    minHeight: TOUCH.min,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.lg,
  },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { fontSize: font.body, fontWeight: "700" },

  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl },
  centerText: { marginTop: space.md, color: colors.textSoft, fontSize: font.body },

  errorBox: {
    backgroundColor: colors.dangerBg,
    borderRadius: radius.md,
    padding: space.lg,
    width: "100%",
  },
  errorTitle: { fontSize: font.h3, fontWeight: "700", color: colors.danger, marginBottom: space.xs },
  errorText: { fontSize: font.body, color: "#7F1D1D", lineHeight: 22 },
  retry: { marginTop: space.lg, alignSelf: "stretch" },

  empty: { padding: space.xl, alignItems: "center" },
  emptyTitle: { fontSize: font.body, fontWeight: "600", color: colors.textSoft, textAlign: "center" },
  emptyHint: { fontSize: font.small, color: colors.textMuted, marginTop: space.xs, textAlign: "center" },

  desktopNote: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed",
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.md,
  },
  desktopNoteText: { fontSize: font.small, color: colors.textSoft, lineHeight: 19 },
});
