/**
 * "/" — BUGÜN. Sahada en çok bakılan ekran.
 *
 * Üç blok, aciliyet sırasıyla: bugünün duruşmaları → kritik süreler (bugün
 * dâhil 3 gün + gecikmişler) → bugünkü/açık görevlerim.
 *
 * ÇEVRİMDIŞI: çekilen veri indirgenmiş biçimde önbelleğe yazılır. Sonraki
 * açılışta ağ yoksa önbellek gösterilir ve üstte "çevrimdışı — son güncelleme
 * HH:MM" şeridi çıkar. Önbellekten gelen kayıtlar TIKLANMAZ (detay için ağ
 * gerekir) — dokununca boş ekran açmak yerine bunu söyleriz.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { RefreshControl, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { fetchCriticalDeadlines, fetchDashboard, fetchTodayHearings } from "@/api/endpoints";
import type { Deadline, Hearing, Task } from "@/api/types";
import { useSession } from "@/auth/session";
import {
  buildSnapshot,
  loadSnapshot,
  saveSnapshot,
  type TodaySnapshot,
} from "@/cache/today-cache";
import { ApiError, errorMessage } from "@/api/client";
import { useOnline } from "@/net/connectivity";
import {
  Body,
  Button,
  EmptyState,
  ErrorState,
  Loading,
  Muted,
  OfflineBanner,
  ScrollScreen,
  Section,
} from "@/ui/components";
import {
  DeadlineRow,
  HearingRow,
  TaskRow,
  type DeadlineRowData,
  type HearingRowData,
  type TaskRowData,
} from "@/ui/list-items";
import { colors, font, radius, space } from "@/ui/theme";
import { formatLocalDateLong, formatTime } from "@/lib/format";

interface TodayData {
  hearings: Hearing[];
  deadlines: Deadline[];
  tasks: Task[];
}

// Sunucu yanıtı → satır verisi. Önbellek kayıtları zaten bu biçimdedir.
function toHearingRow(hearing: Hearing): HearingRowData {
  return {
    id: hearing.id,
    date: hearing.date,
    type: hearing.type,
    courtroom: hearing.courtroom ?? null,
    caseTitle: hearing.case?.title ?? null,
    fileNumber: hearing.case?.fileNumber ?? null,
    courtName: hearing.case?.courtName ?? null,
    clientName: hearing.case?.client?.name ?? null,
  };
}

function toDeadlineRow(deadline: Deadline): DeadlineRowData {
  return {
    id: deadline.id,
    title: deadline.title,
    dueDate: deadline.dueDate,
    status: deadline.status,
    source: deadline.source,
    legalBasis: deadline.legalBasis ?? null,
    fileNumber: deadline.case?.fileNumber ?? null,
    caseTitle: deadline.case?.title ?? null,
  };
}

function toTaskRow(task: Task): TaskRowData {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate ?? null,
    caseTitle: task.case?.title ?? null,
  };
}

export default function TodayScreen(): React.JSX.Element {
  const router = useRouter();
  const online = useOnline();
  const { user } = useSession();

  const [data, setData] = useState<TodayData | null>(null);
  const [cached, setCached] = useState<TodaySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (isRefresh: boolean) => {
      if (!user) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        // Üç bağımsız çağrı paralel: sahada bekleme süresi toplamları değil,
        // en yavaş çağrı kadar olsun.
        const [hearings, deadlines, dashboard] = await Promise.all([
          fetchTodayHearings(),
          fetchCriticalDeadlines(3),
          fetchDashboard(),
        ]);
        const tasks = dashboard.myTasks?.items ?? [];
        setData({ hearings, deadlines, tasks });
        setCached(null);
        await saveSnapshot(buildSnapshot(user.id, hearings, deadlines, tasks));
      } catch (caught) {
        /**
         * ╔══════════════════════════════════════════════════════════════════╗
         * ║ HATANIN TÜRÜ SORULUR (denetim bulgusu 11).                       ║
         * ║                                                                  ║
         * ║ Eskiden HER hata önbelleğe düşüyordu ve ekranda "Bağlantı yok"    ║
         * ║ yazıyordu. Sunucuda bir dağıtım hatası `/hearings`i 500'e         ║
         * ║ düşürdüğünde avukat sabah uygulamayı açıyor, "bağlantı yok"       ║
         * ║ diyor, telefonunun şebekesini suçluyor ve DÜNKÜ duruşma listesine ║
         * ║ bakarak güne başlıyordu — gece eklenen duruşmayı hiç görmeden.    ║
         * ║ Gerçek sebep sunucudaydı ve kimse haberdar olmuyordu.             ║
         * ║                                                                  ║
         * ║ Kural: bayat veriyi "güncelmiş gibi" sunmak yasak, sebebi yanlış  ║
         * ║ söylemek de yasak. Ağ hatasında önbellek + "bağlantı yok";        ║
         * ║ sunucu hatasında hata ekranı — önbellek varsa "son kopya" olarak  ║
         * ║ ayrıca sunulur ama sebep doğru yazılır.                           ║
         * ╚══════════════════════════════════════════════════════════════════╝
         */
        const networkFault = caught instanceof ApiError && caught.isNetwork;
        const snapshot = await loadSnapshot(user.id);
        if (networkFault && snapshot) {
          setCached(snapshot);
          setData(null);
        } else {
          setCached(null);
          setError(errorMessage(caught));
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [user],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  /**
   * Duruşma notu yazıp geri dönen kullanıcı güncel listeyi görsün.
   *
   * İlk odaklanma `useEffect`'teki yüklemeyle çakışmasın diye bir ref ile
   * atlanır; sonraki her dönüşte sessiz yenileme yapılır. (Bayrak `state`
   * değil `ref`: değişmesi yeni bir render tetiklememeli.)
   */
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void load(true);
    }, [load]),
  );

  if (loading && data === null && cached === null) {
    return <Loading label="Bugünün verileri alınıyor…" />;
  }

  if (error !== null && data === null && cached === null) {
    return <ErrorState message={error} onRetry={() => void load(false)} />;
  }

  // Çevrimiçi yanıt ile önbellek kaydı aynı satır tipine indirgenir; aşağıdaki
  // JSX iki kaynağı ayırt etmek zorunda kalmaz.
  const offline = cached !== null;
  const hearings: HearingRowData[] = offline
    ? cached.hearings
    : (data?.hearings ?? []).map(toHearingRow);
  const deadlines: DeadlineRowData[] = offline
    ? cached.deadlines
    : (data?.deadlines ?? []).map(toDeadlineRow);
  const tasks: TaskRowData[] = offline ? cached.tasks : (data?.tasks ?? []).map(toTaskRow);

  const openHearing = (id: string) => {
    if (offline) return;
    router.push(`/durusma/${id}`);
  };

  return (
    <>
      {offline ? <OfflineBanner capturedAtLabel={formatTime(cached.capturedAt)} /> : null}
      <ScrollScreen
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.navy} />
        }
      >
        <View style={styles.dateBar}>
          <Text style={styles.dateText}>{formatLocalDateLong(new Date())}</Text>
          {user ? <Muted>{user.fullName}</Muted> : null}
        </View>

        {offline ? (
          <View style={styles.offlineNote}>
            <Body style={styles.offlineNoteText}>
              Bağlantı yok. Aşağıdaki bilgiler son çekilen kopyadır; bu sırada değişmiş olabilir. Detay açmak ve
              işlem yapmak için bağlantı gerekir.
            </Body>
            <Button
              title="Yeniden dene"
              variant="secondary"
              onPress={() => void load(true)}
              style={{ marginTop: space.md }}
            />
          </View>
        ) : null}

        {!offline && !online ? (
          <View style={styles.offlineNote}>
            <Body style={styles.offlineNoteText}>Bağlantı kesildi. Yazma işlemleri şu anda yapılamaz.</Body>
          </View>
        ) : null}

        <Section title={`Bugünün duruşmaları${hearings.length > 0 ? ` (${hearings.length})` : ""}`}>
          {hearings.length === 0 ? (
            <EmptyState title="Bugün planlanmış duruşma yok." />
          ) : (
            hearings.map((hearing) => (
              <HearingRow key={hearing.id} item={hearing} onPress={() => openHearing(hearing.id)} />
            ))
          )}
        </Section>

        <Section title="Kritik süreler">
          <Muted style={styles.sectionHint}>Bugün dâhil 3 gün içinde dolanlar ve gecikmiş olanlar.</Muted>
          {deadlines.length === 0 ? (
            <EmptyState title="Yakın vadede kritik süre görünmüyor." hint="Tüm açık süreler için Süreler sekmesine bakın." />
          ) : (
            deadlines.map((deadline) => <DeadlineRow key={deadline.id} item={deadline} />)
          )}
        </Section>

        <Section title="Görevlerim">
          {tasks.length === 0 ? (
            <EmptyState title="Açık göreviniz yok." />
          ) : (
            tasks.slice(0, 8).map((task) => <TaskRow key={task.id} item={task} />)
          )}
        </Section>
      </ScrollScreen>
    </>
  );
}

const styles = StyleSheet.create({
  dateBar: { marginBottom: space.lg },
  dateText: { fontSize: font.h2, fontWeight: "700", color: colors.navy },
  sectionHint: { marginTop: -space.sm, marginBottom: space.md },
  offlineNote: {
    backgroundColor: colors.warnBg,
    borderRadius: radius.md,
    padding: space.lg,
    marginBottom: space.lg,
  },
  offlineNoteText: { color: "#78350F", fontSize: font.small, lineHeight: 20 },
});
