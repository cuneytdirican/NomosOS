/**
 * /durusma/[id] — duruşma detayı ve DURUŞMA SONRASI HIZLI NOT + HIZLI SONUÇ.
 *
 * Sahadaki asıl senaryo bu ekrandır: avukat salondan çıkar, telefonu açar,
 * ara kararı iki cümleyle yazar. Bu yüzden not alanı ekranın en üstüne yakın
 * ve tek dokunuşla açılır durumdadır.
 *
 * SESLİ NOT YOKTUR — bilinçli karar. Adliye koridorunda yapılan bir ses kaydı,
 * çevredeki üçüncü kişilerin (başka müvekkiller, tanıklar) sesini de kaydeder;
 * bunun KVKK ve meslek sırrı bakımından savunulabilir bir hâli yok. Metin
 * girişi bu riski taşımaz.
 *
 * D2 A7 — HIZLI SONUÇ ARTIK VAR (iki adımlı onayla): sonuç kaydı safahat
 * açar, dosya durumunu değiştirir ve erteleme hâlinde yeni duruşma yaratır.
 * Bu yüzden yalnız PLANLANDI duruşmasında, HUKUKI/OPERASYON rolüyle ve
 * ÖZET ONAYINDAN sonra işler. Not alanı tek dokunuşla hızlı kalır.
 */

import React, { useCallback, useEffect, useState } from "react";
import { RefreshControl, StyleSheet, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { errorMessage } from "@/api/client";
import { fetchHearing, saveHearingNote } from "@/api/endpoints";
import { saveHearingResult } from "@/api/quick-result";
import { useSession } from "@/auth/session";
import { useOnline } from "@/net/connectivity";
import { useLoad } from "@/hooks/use-load";
import {
  HEARING_STATUS_LABELS,
  HEARING_STATUS_TONES,
  HEARING_TYPE_LABELS,
  OPERASYON_ROLES,
  inRoles,
  label,
  tone,
} from "@/lib/labels";
import { formatLocalDateLong, formatTime } from "@/lib/format";
import {
  AiSuggestionBanner,
  Badge,
  Body,
  Button,
  Card,
  DesktopOnlyNote,
  Divider,
  ErrorState,
  Field,
  Loading,
  Muted,
  ScrollScreen,
  Section,
} from "@/ui/components";
import { NoteDialog } from "@/ui/note-dialog";
import { QuickResultDialog } from "@/ui/quick-result-dialog";
import { colors, font, radius, space } from "@/ui/theme";

export default function HearingDetailScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const online = useOnline();
  const { user } = useSession();
  const hearingId = typeof id === "string" ? id : "";
  const canWriteNote = inRoles(user?.role, OPERASYON_ROLES);

  const { data, error, loading, reload } = useLoad(() => fetchHearing(hearingId), [hearingId]);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // D2 A7 — hızlı sonuç iletişim kutusu.
  const [resultOpen, setResultOpen] = useState(false);
  const [resultBusy, setResultBusy] = useState(false);
  const [resultError, setResultError] = useState<string | null>(null);

  // Yeni bir duruşmaya geçildiğinde önceki kaydetme onayı ekranda kalmasın.
  useEffect(() => {
    setSavedAt(null);
    setActionError(null);
  }, [hearingId]);

  const save = useCallback(
    async (note: string) => {
      if (!online) {
        // Hata PENCERENİN İÇİNDE de gösterilir (aşağıdaki `error` prop'u):
        // sayfa şeridine yazmak, tam ekran modalın ARKASINDA kalıyordu ve
        // kullanıcı düğmeye basıp hiçbir şey olmadığını görüyordu (bulgu 9).
        setActionError("Bağlantı gerekli. Not çevrimdışı kaydedilmez — yazdığınız metin kaybolmasın diye pencere açık bırakıldı.");
        return;
      }
      setSaving(true);
      setActionError(null);
      try {
        await saveHearingNote(hearingId, note);
        setEditing(false);
        setSavedAt(new Date().toISOString());
        reload();
      } catch (caught) {
        setActionError(errorMessage(caught));
      } finally {
        setSaving(false);
      }
    },
    [hearingId, online, reload],
  );

  // D2 A7 — hızlı sonuç kaydet: iki adımlı onaydan geçmiş girdiyle çağrılır.
  const submitResult = useCallback(
    async (input: { status: "YAPILDI" | "ERTELENDI" | "IPTAL"; note: string; nextDate?: string }) => {
      if (!online) {
        setResultError("Bağlantı gerekli — sonuç kaydı çevrimdışı yapılamaz.");
        return;
      }
      setResultBusy(true);
      setResultError(null);
      try {
        await saveHearingResult(hearingId, input);
        setResultOpen(false);
        setSavedAt(new Date().toISOString());
        reload();
      } catch (caught) {
        setResultError(errorMessage(caught));
      } finally {
        setResultBusy(false);
      }
    },
    [hearingId, online, reload],
  );

  if (loading && data === null) return <Loading label="Duruşma alınıyor…" />;
  if (error !== null && data === null) return <ErrorState message={error} onRetry={reload} />;
  if (data === null) return <ErrorState message="Duruşma bulunamadı." onRetry={reload} />;

  const relatedCase = data.case;

  return (
    <>
      <Stack.Screen options={{ title: formatTime(data.date) }} />
      <ScrollScreen refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={colors.navy} />}>
        {/* Duruşma anı — ekranın en okunaklı bloğu */}
        <Card accent={colors.gold}>
          <Body style={styles.time}>{formatTime(data.date)}</Body>
          <Body style={styles.date}>{formatLocalDateLong(data.date)}</Body>
          <View style={styles.badges}>
            <Badge text={label(HEARING_TYPE_LABELS, data.type)} tone="navy" />
            <Badge text={label(HEARING_STATUS_LABELS, data.status)} tone={tone(HEARING_STATUS_TONES, data.status)} />
            {data.courtroom ? <Badge text={`Salon ${data.courtroom}`} tone="gold" /> : null}
          </View>
        </Card>

        <Section title="Dosya künyesi">
          <Card onPress={relatedCase ? () => router.push(`/dosya/${relatedCase.id}`) : undefined}>
            <Field label="Mahkeme / Daire" value={relatedCase?.courtName ?? "—"} />
            <Field label="Esas no" value={relatedCase?.fileNumber ?? "—"} />
            <Field label="Dosya" value={relatedCase?.title ?? "—"} />
            <Field label="Müvekkil" value={relatedCase?.client?.name ?? "—"} />
            <Field label="Sorumlu" value={relatedCase?.responsibleUser?.fullName ?? "—"} />
            {relatedCase ? <Muted style={styles.tapHint}>Dosyanın tamamı için dokunun →</Muted> : null}
          </Card>
        </Section>

        {data.prepSummary ? (
          <Section title="Duruşma hazırlık paketi">
            {/*
              Hazırlık brifingi asistan modülünde AI ile üretilebilir; kaynağı
              ayırt edilemediği için HER ZAMAN öneri şeridiyle gösterilir.
              Ürün ilkesi: AI çıktısı öneridir, bağlayıcı değildir.
            */}
            <AiSuggestionBanner text="Hazırlık brifingi yapay zekâ desteğiyle üretilmiş olabilir. Bağlayıcı değildir; duruşmada dayanılacak her nokta dosyadan doğrulanmalıdır." />
            <Card>
              <Body style={styles.prepText}>{data.prepSummary}</Body>
              {data.preparedAt ? (
                <Muted style={styles.prepMeta}>Hazırlandı: {formatLocalDateLong(data.preparedAt)}</Muted>
              ) : null}
            </Card>
          </Section>
        ) : null}

        <Section title="Duruşma notu / ara karar">
          {actionError ? (
            <View style={styles.actionError}>
              <Body style={styles.actionErrorText}>{actionError}</Body>
            </View>
          ) : null}
          {savedAt ? (
            <View style={styles.saved}>
              <Body style={styles.savedText}>Not kaydedildi ({formatTime(savedAt)}).</Body>
            </View>
          ) : null}

          <Card>
            {data.note ? (
              <Body style={styles.noteText}>{data.note}</Body>
            ) : (
              <Muted>Henüz not girilmemiş.</Muted>
            )}
            {data.note ? <Divider /> : null}
            {canWriteNote ? (
              <Button
                title={data.note ? "Notu düzenle" : "Duruşma sonrası not ekle"}
                onPress={() => {
                  setActionError(null);
                  setEditing(true);
                }}
                style={styles.noteButton}
              />
            ) : (
              <Muted>Rolünüz duruşma notu yazma yetkisi taşımıyor.</Muted>
            )}
          </Card>

          {/* D2 A7 — HIZLI SONUÇ: yalnız PLANLANDI duruşmasında ve rol yeterliyse. */}
          {data.status === "PLANLANDI" && canWriteNote ? (
            <Card accent={colors.gold}>
              <Body style={styles.resultTitle}>Duruşma sonucunu işle</Body>
              <Muted style={styles.resultHint}>
                Yapıldı / ertelendi / iptal — safahata işlenir, ertelemede yeni duruşma açılır.
                İki adımda onaylanır.
              </Muted>
              <Button
                title="Sonuç kaydet"
                onPress={() => {
                  setResultError(null);
                  setResultOpen(true);
                }}
                style={styles.noteButton}
              />
            </Card>
          ) : null}
        </Section>

        <DesktopOnlyNote what="Duruşma sonucu işleme (yapıldı/ertelendi/iptal), yeni duruşma günü verme ve safahat kaydı" />
      </ScrollScreen>

      <NoteDialog
        visible={editing}
        title="Duruşma notu"
        description="Ara kararı ve duruşmada olanları kısaca yazın. Bu metin dosya kaydına işlenir; büro panelinden görülür."
        placeholder="Örn. Bilirkişi raporuna itiraz için iki hafta süre verildi; sonraki celse 14.10.2026."
        confirmLabel="Kaydet"
        busy={saving}
        initialValue={data.note ?? ""}
        maxLength={5000}
        required
        error={editing ? actionError : null}
        disabled={!online}
        disabledReason="Bağlantı yok — not kaydedilemez. Yazdığınız metin burada duruyor; bağlantı gelince «Kaydet» etkinleşir."
        onCancel={() => setEditing(false)}
        onConfirm={(note) => void save(note)}
      />

      {/* D2 A7 — hızlı sonuç iletişim kutusu (iki adımlı onay). */}
      <QuickResultDialog
        visible={resultOpen}
        busy={resultBusy}
        hearingLabel={`${formatTime(data.date)} · ${formatLocalDateLong(data.date)}`}
        error={resultError}
        onCancel={() => setResultOpen(false)}
        onConfirm={(input) => void submitResult(input)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  time: { fontSize: 44, fontWeight: "800", color: colors.navy, letterSpacing: -1.5, lineHeight: 50 },
  date: { fontSize: font.h3, color: colors.textSoft, fontWeight: "600", marginBottom: space.md },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  tapHint: { marginTop: space.sm, color: colors.gold, fontWeight: "600" },
  prepText: { lineHeight: 24 },
  prepMeta: { marginTop: space.md },
  noteText: { lineHeight: 24 },
  noteButton: { marginTop: space.md },
  resultTitle: { fontWeight: "700", color: colors.navy },
  resultHint: { marginTop: space.xs, marginBottom: space.sm },
  actionError: { backgroundColor: colors.dangerBg, borderRadius: radius.md, padding: space.md, marginBottom: space.md },
  actionErrorText: { color: "#7F1D1D", fontSize: font.small, lineHeight: 20 },
  saved: { backgroundColor: colors.okBg, borderRadius: radius.md, padding: space.md, marginBottom: space.md },
  savedText: { color: colors.ok, fontSize: font.small, fontWeight: "600" },
});
