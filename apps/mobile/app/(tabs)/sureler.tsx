/**
 * /sureler — yaklaşan ve gecikmiş AÇIK süreler + AI önerilerinin hızlı onayı.
 *
 * ÜRÜN İLKESİ: "AI çıktısı ÖNERİDİR". `source=AI_ONERISI, status=BEKLIYOR`
 * kayıtları en üstte, ayrı bir blokta ve AI şeridiyle gösterilir; bir süre
 * ancak avukatın onayıyla kesinleşir. Onay/ret sunucuda ROLE_SETS.HUKUKI
 * (Yönetici/Ortak/Avukat) ister — düğmeler yalnız bu rollere gösterilir,
 * ama ASIL KAPI SUNUCUDADIR.
 *
 * Süre TAMAMLAMA, süre AÇMA ve KAÇIRILDI işaretleme mobilde YOKTUR: ilki
 * dosya kapatma zincirini, sonuncusu meslek sorumluluğu doğuran bir tespiti
 * etkiler; ikisi de masaüstünde, hesap izi görülerek yapılır.
 */

import React, { useCallback, useState } from "react";
import { RefreshControl, StyleSheet, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { errorMessage } from "@/api/client";
import { approveDeadline, fetchDeadlines, fetchPendingProposals, rejectDeadline } from "@/api/endpoints";
import type { Deadline } from "@/api/types";
import { useSession } from "@/auth/session";
import { useOnline } from "@/net/connectivity";
import { HUKUKI_ROLES, inRoles } from "@/lib/labels";
import {
  AiSuggestionBanner,
  Body,
  Button,
  DesktopOnlyNote,
  EmptyState,
  ErrorState,
  Loading,
  Muted,
  ScrollScreen,
  Section,
} from "@/ui/components";
import { DeadlineRow } from "@/ui/list-items";
import { NoteDialog } from "@/ui/note-dialog";
import { colors, font, radius, space } from "@/ui/theme";

export default function DeadlinesScreen(): React.JSX.Element {
  const { user } = useSession();
  const online = useOnline();
  const canDecide = inRoles(user?.role, HUKUKI_ROLES);

  const [proposals, setProposals] = useState<Deadline[]>([]);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Deadline | null>(null);

  const load = useCallback(async (isRefresh: boolean) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [pending, open] = await Promise.all([fetchPendingProposals(), fetchDeadlines(30)]);
      setProposals(pending);
      // Öneriler ayrı blokta zaten görünüyor; alt listede tekrar edilmez.
      const pendingIds = new Set(pending.map((item) => item.id));
      setDeadlines(open.filter((item) => !pendingIds.has(item.id)));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load(false);
    }, [load]),
  );

  const requireOnline = useCallback((): boolean => {
    if (online) return true;
    setActionError("Bağlantı gerekli. Bu işlem çevrimdışı kaydedilmez; bağlantı gelince tekrar deneyin.");
    return false;
  }, [online]);

  const approve = useCallback(
    async (deadline: Deadline) => {
      if (!requireOnline()) return;
      setBusyId(deadline.id);
      setActionError(null);
      try {
        await approveDeadline(deadline.id);
        await load(true);
      } catch (caught) {
        setActionError(errorMessage(caught));
      } finally {
        setBusyId(null);
      }
    },
    [load, requireOnline],
  );

  const reject = useCallback(
    async (deadline: Deadline, note: string) => {
      if (!requireOnline()) return;
      setBusyId(deadline.id);
      setActionError(null);
      try {
        await rejectDeadline(deadline.id, note);
        setRejecting(null);
        await load(true);
      } catch (caught) {
        setActionError(errorMessage(caught));
      } finally {
        setBusyId(null);
      }
    },
    [load, requireOnline],
  );

  if (loading && deadlines.length === 0 && proposals.length === 0) {
    return <Loading label="Süreler alınıyor…" />;
  }
  if (error !== null && deadlines.length === 0 && proposals.length === 0) {
    return <ErrorState message={error} onRetry={() => void load(false)} />;
  }

  return (
    <>
      <ScrollScreen
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.navy} />
        }
      >
        {actionError ? (
          <View style={styles.actionError}>
            <Body style={styles.actionErrorText}>{actionError}</Body>
          </View>
        ) : null}

        {proposals.length > 0 ? (
          <Section title={`Onay bekleyen AI önerileri (${proposals.length})`}>
            <AiSuggestionBanner text="Aşağıdaki süreler yapay zekâ tarafından tespit edilmiş ÖNERİLERDİR. Onaylanmadan takvime girmez; hesap izini kontrol etmeden onaylamayın." />
            {!canDecide ? (
              <View style={styles.roleNote}>
                <Body style={styles.roleNoteText}>
                  Rolünüz süre onaylama/reddetme yetkisi taşımıyor. Bu kararı avukat, ortak veya yönetici verir;
                  öneriler burada bilgi amacıyla listelenir.
                </Body>
              </View>
            ) : null}
            {proposals.map((item) => (
              <DeadlineRow
                key={item.id}
                item={{
                  id: item.id,
                  title: item.title,
                  dueDate: item.dueDate,
                  status: item.status,
                  source: item.source,
                  legalBasis: item.legalBasis ?? null,
                  fileNumber: item.case?.fileNumber ?? null,
                  caseTitle: item.case?.title ?? null,
                }}
                footer={
                  <View>
                    {item.computeNote ? (
                      <View style={styles.computeNote}>
                        <Muted>Hesap izi: {item.computeNote}</Muted>
                      </View>
                    ) : null}
                    {canDecide ? (
                      <View style={styles.actions}>
                        <Button
                          title="Onayla"
                          onPress={() => void approve(item)}
                          loading={busyId === item.id}
                          style={styles.actionButton}
                        />
                        <Button
                          title="Reddet"
                          variant="secondary"
                          onPress={() => {
                            setActionError(null);
                            setRejecting(item);
                          }}
                          disabled={busyId === item.id}
                          style={styles.actionButton}
                        />
                      </View>
                    ) : null}
                  </View>
                }
              />
            ))}
          </Section>
        ) : null}

        <Section title="Açık süreler">
          <Muted style={styles.hint}>Gecikmiş olanlar ve önümüzdeki 30 gün. Tarihe göre sıralı.</Muted>
          {deadlines.length === 0 ? (
            <EmptyState title="Açık süre yok." hint="Aşağı çekerek yenileyebilirsiniz." />
          ) : (
            deadlines.map((item) => (
              <DeadlineRow
                key={item.id}
                item={{
                  id: item.id,
                  title: item.title,
                  dueDate: item.dueDate,
                  status: item.status,
                  source: item.source,
                  legalBasis: item.legalBasis ?? null,
                  fileNumber: item.case?.fileNumber ?? null,
                  caseTitle: item.case?.title ?? null,
                }}
              />
            ))
          )}
        </Section>

        <DesktopOnlyNote what="Yeni süre açma, süreyi tamamlama ve «kaçırıldı» olarak işaretleme" />
      </ScrollScreen>

      <NoteDialog
        visible={rejecting !== null}
        title="Süre önerisini reddet"
        description="Ret gerekçesi denetim izinde kalır. Neden bu sürenin geçerli olmadığını kısaca yazın."
        placeholder="Örn. Tebliğ tarihi hatalı okunmuş; asıl tebliğ 12.08.2026."
        confirmLabel="Reddet"
        required
        busy={busyId !== null}
        // Hata ve "bağlantı yok" uyarısı PENCERENİN İÇİNDE görünür; sayfa
        // şeridi tam ekran modalın arkasında kalıyordu (denetim bulgusu 9).
        error={rejecting !== null ? actionError : null}
        disabled={!online}
        disabledReason="Bağlantı yok — ret gerekçesi kaydedilemez. Yazdığınız metin burada duruyor; bağlantı gelince «Reddet» etkinleşir."
        onCancel={() => setRejecting(null)}
        onConfirm={(note) => {
          if (rejecting) void reject(rejecting, note);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  hint: { marginTop: -space.sm, marginBottom: space.md },
  actions: { flexDirection: "row", gap: space.sm, marginTop: space.md },
  actionButton: { flex: 1 },
  computeNote: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: space.sm,
    marginTop: space.sm,
  },
  actionError: {
    backgroundColor: colors.dangerBg,
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.lg,
  },
  actionErrorText: { color: "#7F1D1D", fontSize: font.small, lineHeight: 20 },
  roleNote: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    marginBottom: space.md,
  },
  roleNoteText: { color: colors.textSoft, fontSize: font.small, lineHeight: 20 },
});
