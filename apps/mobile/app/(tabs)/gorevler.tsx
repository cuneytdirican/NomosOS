/**
 * /gorevler — bana atanmış AÇIK görevler ve hızlı durum değiştirme.
 *
 * Durum makinesinin sahibi SUNUCUDUR. Mobil, geçerli geçişleri tahmin etmez:
 * bir göreve dokunulduğunda `GET /tasks/:id` çağrılır ve sunucunun döndürdüğü
 * `allowedStatusTransitions` düğmeye çevrilir. Böylece kural sunucuda
 * değiştiğinde mobil kendiliğinden doğru kalır.
 *
 * Görev AÇMA, atama ve düzenleme mobilde YOKTUR — sorumlu/kontrol eden seçimi
 * ve öncelik kararı büro içi bir iştir, koridorda yapılmaz.
 */

import React, { useCallback, useState } from "react";
import { RefreshControl, StyleSheet, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { errorMessage } from "@/api/client";
import { fetchMyTasks, fetchTask, updateTaskStatus } from "@/api/endpoints";
import type { Task } from "@/api/types";
import { useSession } from "@/auth/session";
import { useOnline } from "@/net/connectivity";
import { TASK_STATUS_LABELS, label } from "@/lib/labels";
import {
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
import { TaskRow } from "@/ui/list-items";
import { NoteDialog } from "@/ui/note-dialog";
import { colors, font, radius, space } from "@/ui/theme";

/**
 * İ-57: gerekçe zorunluluğu SUNUCU SÖZLEŞMESİNE göre — api/src/tasks/task-status.ts
 * REJECTION_TRANSITIONS: yalnız KONTROLDE/ONAY_BEKLIYOR → DEVAM_EDIYOR geri
 * göndermesi gerekçe ister. (Eski istemci sabiti hedef durumları sayıyordu ve
 * normal başlangıçta da gerekçe isteyordu.) Sunucu değişirse bu kopya da
 * güncellenmelidir — sözleşme testi apps/api'de izler.
 */
function noteRequiredFor(from: string | null | undefined, to: string): boolean {
  if (from !== "KONTROLDE" && from !== "ONAY_BEKLIYOR") return false;
  return to === "DEVAM_EDIYOR";
}

export default function TasksScreen(): React.JSX.Element {
  const { user } = useSession();
  const online = useOnline();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedTask, setExpandedTask] = useState<Task | null>(null);
  const [expandLoading, setExpandLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [noteTarget, setNoteTarget] = useState<{ task: Task; status: string } | null>(null);

  const load = useCallback(
    async (isRefresh: boolean) => {
      if (!user) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        setTasks(await fetchMyTasks(user.id));
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [user],
  );

  useFocusEffect(
    useCallback(() => {
      void load(false);
    }, [load]),
  );

  /** Kartı açar ve sunucudan izin verilen geçişleri getirir. */
  const toggle = useCallback(
    async (task: Task) => {
      setActionError(null);
      if (expandedId === task.id) {
        setExpandedId(null);
        setExpandedTask(null);
        return;
      }
      setExpandedId(task.id);
      setExpandedTask(null);
      if (!online) {
        setActionError("Bağlantı gerekli. Görev durumu çevrimdışı değiştirilemez.");
        return;
      }
      setExpandLoading(true);
      try {
        setExpandedTask(await fetchTask(task.id));
      } catch (caught) {
        setActionError(errorMessage(caught));
      } finally {
        setExpandLoading(false);
      }
    },
    [expandedId, online],
  );

  const applyStatus = useCallback(
    async (task: Task, status: string, note?: string) => {
      if (!online) {
        setActionError("Bağlantı gerekli. Bu işlem çevrimdışı kaydedilmez.");
        return;
      }
      setBusy(true);
      setActionError(null);
      try {
        await updateTaskStatus(task.id, status, note);
        setNoteTarget(null);
        setExpandedId(null);
        setExpandedTask(null);
        await load(true);
      } catch (caught) {
        setActionError(errorMessage(caught));
      } finally {
        setBusy(false);
      }
    },
    [load, online],
  );

  if (loading && tasks.length === 0) return <Loading label="Görevler alınıyor…" />;
  if (error !== null && tasks.length === 0) return <ErrorState message={error} onRetry={() => void load(false)} />;

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

        <Section title={`Görevlerim${tasks.length > 0 ? ` (${tasks.length})` : ""}`}>
          <Muted style={styles.hint}>Size atanmış açık görevler. Durum değiştirmek için karta dokunun.</Muted>

          {tasks.length === 0 ? (
            <EmptyState title="Açık göreviniz yok." />
          ) : (
            tasks.map((task) => (
              <TaskRow
                key={task.id}
                item={{
                  id: task.id,
                  title: task.title,
                  status: task.status,
                  priority: task.priority,
                  dueDate: task.dueDate ?? null,
                  caseTitle: task.case?.title ?? null,
                }}
                onPress={() => void toggle(task)}
                footer={
                  expandedId === task.id ? (
                    <View style={styles.expand}>
                      {task.description ? <Muted style={styles.description}>{task.description}</Muted> : null}
                      {expandLoading ? (
                        <Muted>Geçerli işlemler alınıyor…</Muted>
                      ) : expandedTask?.allowedStatusTransitions?.length ? (
                        <View style={styles.transitions}>
                          {expandedTask.allowedStatusTransitions.map((status) => (
                            <Button
                              key={status}
                              title={label(TASK_STATUS_LABELS, status)}
                              variant={status === "TAMAMLANDI" ? "primary" : "secondary"}
                              disabled={busy}
                              onPress={() => {
                                if (noteRequiredFor(task.status, status)) {
                                  setNoteTarget({ task, status });
                                } else {
                                  void applyStatus(task, status);
                                }
                              }}
                              style={styles.transitionButton}
                            />
                          ))}
                        </View>
                      ) : expandedTask ? (
                        <Muted>Bu görev için mobilden yapılabilecek bir durum değişikliği yok.</Muted>
                      ) : null}
                    </View>
                  ) : null
                }
              />
            ))
          )}
        </Section>

        <DesktopOnlyNote what="Görev açma, sorumlu atama, öncelik ve son tarih düzenleme" />
      </ScrollScreen>

      <NoteDialog
        visible={noteTarget !== null}
        title={noteTarget ? `Durum: ${label(TASK_STATUS_LABELS, noteTarget.status)}` : ""}
        description="Geri gönderme ve iptalde gerekçe yazılması zorunludur; kayıt görev geçmişinde kalır."
        placeholder="Gerekçe…"
        confirmLabel="Uygula"
        required
        busy={busy}
        onCancel={() => setNoteTarget(null)}
        onConfirm={(note) => {
          if (noteTarget) void applyStatus(noteTarget.task, noteTarget.status, note);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  hint: { marginTop: -space.sm, marginBottom: space.md },
  expand: { marginTop: space.md, borderTopWidth: 1, borderTopColor: colors.borderSoft, paddingTop: space.md },
  description: { marginBottom: space.md },
  transitions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  transitionButton: { flexGrow: 1, flexBasis: "45%" },
  actionError: {
    backgroundColor: colors.dangerBg,
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.lg,
  },
  actionErrorText: { color: "#7F1D1D", fontSize: font.small, lineHeight: 20 },
});
