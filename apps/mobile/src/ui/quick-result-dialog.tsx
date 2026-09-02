/**
 * D2 A7 — DURUŞMA HIZLI SONUÇ İLETİŞİM KUTUSU.
 *
 * İki adımlıdır:
 *   1. Adım: sonuç türü (YAPILDI/ERTELENDI/IPTAL) + not + ertelemede yeni tarih.
 *   2. Adım: ÖZET gösterilir; avukat ayrıca onaylar. (Sonuç kaydı dosyayı
 *      değiştirir, safahat açar, ertelemede YENİ duruşma yaratır — koridorda
 *      yanlış düğmeye basılmamalıdır.)
 */

import React, { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Button, Divider, Muted } from "./components";
import { colors, font, radius, space } from "./theme";

type ResultStatus = "YAPILDI" | "ERTELENDI" | "IPTAL";

const STATUS_OPTIONS: Array<{ value: ResultStatus; label: string }> = [
  { value: "YAPILDI", label: "Yapıldı" },
  { value: "ERTELENDI", label: "Ertelendi" },
  { value: "IPTAL", label: "İptal" },
];

function formatDateTr(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });
}

export function QuickResultDialog({
  visible,
  busy,
  hearingLabel,
  error,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  busy: boolean;
  /** Örn. "14:30 · 2 Eylül 2026". */
  hearingLabel: string;
  error: string | null;
  onCancel: () => void;
  onConfirm: (input: { status: ResultStatus; note: string; nextDate?: string }) => void;
}): React.JSX.Element {
  const [step, setStep] = useState<1 | 2>(1);
  const [status, setStatus] = useState<ResultStatus>("YAPILDI");
  const [note, setNote] = useState("");
  const [nextDate, setNextDate] = useState("");

  // Her açılışta form sıfırlanır — önceki duruşmanın girdisi sızmasın.
  useEffect(() => {
    if (visible) {
      setStep(1);
      setStatus("YAPILDI");
      setNote("");
      setNextDate("");
    }
  }, [visible]);

  const noteValid = note.trim().length >= 3;
  const dateValid = status !== "ERTELENDI" || /^\d{4}-\d{2}-\d{2}/.test(nextDate);
  const canSubmit = noteValid && dateValid;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.sheet}>
          <Text style={styles.title}>
            {step === 1 ? "Duruşma sonucu" : "Onaylayın"}
          </Text>
          <Muted style={styles.hearingLabel}>{hearingLabel}</Muted>

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {step === 1 ? (
            <>
              <Text style={styles.fieldLabel}>Sonuç</Text>
              <View style={styles.statusButtons}>
                {STATUS_OPTIONS.map((opt) => (
                  <Button
                    key={opt.value}
                    title={opt.label}
                    onPress={() => setStatus(opt.value)}
                    variant={status === opt.value ? "primary" : "secondary"}
                    style={styles.statusButton}
                  />
                ))}
              </View>
              <Muted style={styles.hint}>
                {status === "ERTELENDI"
                  ? "Ertelenen duruşma için yeni bir duruşma kaydı açılır ve ajandaya düşer."
                  : status === "IPTAL"
                    ? "Duruşma iptal edilir; yeni kayıt açılmaz."
                    : "Duruşma yapıldı olarak kaydedilir."}
              </Muted>

              <Text style={styles.fieldLabel}>Ara karar / sonuç (zorunlu)</Text>
              <TextInput
                style={styles.noteInput}
                multiline
                value={note}
                onChangeText={setNote}
                placeholder="Örn. Bilirkişi raporuna itiraz için iki hafta süre verildi."
                placeholderTextColor={colors.textMuted}
                maxLength={5000}
              />

              {status === "ERTELENDI" ? (
                <>
                  <Text style={styles.fieldLabel}>Yeni duruşma tarihi (YYYY-AA-GG)</Text>
                  <TextInput
                    style={styles.dateInput}
                    value={nextDate}
                    onChangeText={setNextDate}
                    placeholder="2026-10-14"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    keyboardType="numbers-and-punctuation"
                  />
                  <Muted style={styles.hint}>Ertelenen duruşma için yeni bir duruşma kaydı açılır ve ajandaya düşer.</Muted>
                </>
              ) : null}

              <View style={styles.actions}>
                <Button title="Vazgeç" onPress={onCancel} variant="secondary" style={styles.actionBtn} />
                <Button
                  title="Devam"
                  onPress={() => setStep(2)}
                  disabled={!canSubmit || busy}
                  style={styles.actionBtn}
                />
              </View>
            </>
          ) : (
            <>
              <View style={styles.summaryBox}>
                <Text style={styles.summaryRow}>Sonuç: {STATUS_OPTIONS.find((o) => o.value === status)?.label}</Text>
                {status === "ERTELENDI" && nextDate ? (
                  <Text style={styles.summaryRow}>Yeni tarih: {formatDateTr(nextDate)}</Text>
                ) : null}
                <Divider />
                <Text style={styles.summaryNote}>{note.trim()}</Text>
              </View>
              <Muted style={styles.hint}>
                Bu kayıt dosya safahatına işlenir{status === "ERTELENDI" ? " ve yeni duruşma açılır" : ""}. Geri alınması
                yönetici işlemidir.
              </Muted>
              <View style={styles.actions}>
                <Button title="Düzelt" onPress={() => setStep(1)} variant="secondary" style={styles.actionBtn} />
                <Button
                  title={busy ? "Kaydediliyor…" : "Onaylıyorum"}
                  onPress={() => onConfirm({ status, note: note.trim(), nextDate: nextDate || undefined })}
                  disabled={busy}
                  style={styles.actionBtn}
                />
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.55)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: space.lg,
    maxHeight: "92%",
  },
  title: { fontSize: font.h2, fontWeight: "700", color: colors.navy },
  hearingLabel: { marginTop: space.xs, marginBottom: space.md },
  errorBox: { backgroundColor: colors.dangerBg, borderRadius: radius.md, padding: space.md, marginBottom: space.md },
  errorText: { color: "#7F1D1D", fontSize: font.small, lineHeight: 20 },
  fieldLabel: { fontSize: font.small, fontWeight: "600", color: colors.text, marginTop: space.md, marginBottom: space.xs },
  statusButtons: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  statusButton: { flexGrow: 1, flexBasis: "30%" },
  noteInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    minHeight: 96,
    fontSize: font.body,
    color: colors.text,
    textAlignVertical: "top",
    backgroundColor: colors.surfaceAlt,
  },
  dateInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    fontSize: font.body,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
  },
  hint: { marginTop: space.sm, marginBottom: space.xs },
  summaryBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    backgroundColor: colors.surfaceAlt,
  },
  summaryRow: { fontSize: font.body, fontWeight: "600", color: colors.navy, marginBottom: space.xs },
  summaryNote: { fontSize: font.body, color: colors.text, lineHeight: 22, marginTop: space.xs },
  actions: { flexDirection: "row", gap: space.sm, marginTop: space.lg, marginBottom: space.sm },
  actionBtn: { flex: 1 },
});
