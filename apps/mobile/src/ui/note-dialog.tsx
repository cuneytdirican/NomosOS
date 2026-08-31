/**
 * Metin girişli onay penceresi — ret gerekçesi, görev notu, duruşma notu.
 *
 * `Alert.prompt` KULLANILMAZ: yalnızca iOS'ta vardır ve Android'de sessizce
 * hiçbir şey yapmaz. Gerekçe zorunlu olan bir akışta bunun bedeli, kullanıcının
 * düğmeye basıp hiçbir şey olmadığını görmesidir.
 */

import React, { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "./components";
import { colors, font, radius, space } from "./theme";

export function NoteDialog({
  visible,
  title,
  description,
  placeholder,
  confirmLabel = "Kaydet",
  required = false,
  busy = false,
  initialValue = "",
  maxLength = 2000,
  error,
  disabled = false,
  disabledReason,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  description?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** true ise boş metinle onaylanamaz (sunucu da gerekçe arar). */
  required?: boolean;
  busy?: boolean;
  initialValue?: string;
  maxLength?: number;
  /**
   * Bu pencerede olan hata — PENCERENİN İÇİNDE gösterilir.
   *
   * ╔══════════════════════════════════════════════════════════════════════╗
   * ║ HATA MODALIN ARKASINDA KALAMAZ (denetim bulgusu 9).                  ║
   * ║ Ekranların hata şeridi `ScrollScreen` içindeydi, bu pencere ise onun  ║
   * ║ ÜSTÜNDE tam ekran bir `Modal`. Çevrimdışıyken kullanıcı 5000          ║
   * ║ karakterlik ara kararını yazıp "Kaydet"e basıyor, çağrı sessizce      ║
   * ║ erken dönüyor ve HİÇBİR GÖRSEL GERİ BİLDİRİM olmuyordu. Kullanıcı     ║
   * ║ düğmeye tekrar tekrar basıyor, sonunda "Vazgeç"e basınca metnini      ║
   * ║ kaybediyordu.                                                        ║
   * ╚══════════════════════════════════════════════════════════════════════╝
   */
  error?: string | null;
  /** Onay düğmesi baştan kapalı (ör. bağlantı yok) — sebebi `disabledReason`. */
  disabled?: boolean;
  disabledReason?: string;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}): React.JSX.Element {
  const [value, setValue] = useState(initialValue);

  // Pencere her açılışta temiz (ya da verilen başlangıç değeriyle) başlar;
  // önceki reddin gerekçesi bir sonrakine taşınmamalıdır.
  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue]);

  const trimmed = value.trim();
  const canConfirm = !busy && !disabled && (!required || trimmed.length > 0);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{title}</Text>
          {description ? <Text style={styles.description}>{description}</Text> : null}

          <TextInput
            style={styles.input}
            value={value}
            onChangeText={setValue}
            placeholder={placeholder}
            placeholderTextColor={colors.textMuted}
            multiline
            textAlignVertical="top"
            maxLength={maxLength}
            editable={!busy}
            autoFocus
          />
          <Text style={styles.counter}>
            {value.length} / {maxLength}
            {required && trimmed.length === 0 ? "  ·  gerekçe zorunlu" : ""}
          </Text>

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
          {!error && disabled && disabledReason ? (
            <View style={styles.warnBox}>
              <Text style={styles.warnText}>{disabledReason}</Text>
            </View>
          ) : null}

          <View style={styles.actions}>
            <Button title="Vazgeç" variant="secondary" onPress={onCancel} disabled={busy} style={styles.action} />
            <Button
              title={confirmLabel}
              onPress={() => onConfirm(trimmed)}
              disabled={!canConfirm}
              loading={busy}
              style={styles.action}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.72)",
    justifyContent: "center",
    padding: space.lg,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.xl,
    maxHeight: "85%",
  },
  title: { fontSize: font.h2, fontWeight: "700", color: colors.text, marginBottom: space.sm },
  description: { fontSize: font.small, color: colors.textSoft, lineHeight: 20, marginBottom: space.lg },
  input: {
    minHeight: 130,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    fontSize: font.body,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    lineHeight: 22,
  },
  counter: { fontSize: font.tiny, color: colors.textMuted, marginTop: space.xs, textAlign: "right" },
  errorBox: {
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.danger,
    backgroundColor: colors.dangerBg,
  },
  errorText: { fontSize: font.small, color: colors.danger, lineHeight: 20 },
  warnBox: {
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.warn,
    backgroundColor: colors.warnBg,
  },
  warnText: { fontSize: font.small, color: colors.warn, lineHeight: 20 },
  actions: { flexDirection: "row", gap: space.sm, marginTop: space.lg },
  action: { flex: 1 },
});
