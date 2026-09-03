/**
 * /ajanda — birleşik büro ajandasının mobil görünümü (D5 / cila).
 *
 * Web'deki ajanda ile AYNI ucu okur (GET /agenda). Mobil, mahkeme koridorunda
 * hızlı bakış için GÜN bazlıdır: önceki gün / bugün / sonraki gün + çekerek
 * yenile. Duruşma satırı duruşma detay ekranına götürür; diğer olay türleri
 * satır içinde özet olarak kalır (mobil salt-okur ağırlıklıdır).
 *
 * Ekleme/düzenleme YOKTUR: takvim yazma işlemi masaüstünde yapılır.
 */

import React, { useCallback, useState } from "react";
import { Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { errorMessage } from "@/api/client";
import { fetchAgenda } from "@/api/endpoints";
import type { AgendaEvent, AgendaEventKind } from "@/api/types";
import {
  Body,
  EmptyState,
  ErrorState,
  Loading,
  Muted,
  ScrollScreen,
  Section,
} from "@/ui/components";
import { colors, radius, space, TOUCH } from "@/ui/theme";

const KIND_LABELS: Record<AgendaEventKind, string> = {
  DURUSMA: "Duruşma",
  RANDEVU: "Randevu",
  SURE: "Süre",
  GOREV: "Görev",
};

const KIND_ICONS: Record<AgendaEventKind, keyof typeof Ionicons.glyphMap> = {
  DURUSMA: "school-outline",
  RANDEVU: "people-outline",
  SURE: "alarm-outline",
  GOREV: "checkmark-circle-outline",
};

/** YYYY-MM-DD (yerel gün). */
function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function parseKey(key: string): Date {
  const [y = 0, m = 1, d = 1] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(key: string, delta: number): string {
  const d = parseKey(key);
  d.setDate(d.getDate() + delta);
  return dayKey(d);
}

function isWeekend(key: string): boolean {
  const day = parseKey(key).getDay();
  return day === 0 || day === 6;
}

export default function AjandaScreen(): React.JSX.Element {
  const router = useRouter();
  const [day, setDay] = useState<string>(dayKey(new Date()));
  const [events, setEvents] = useState<AgendaEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (key: string, isRefresh: boolean) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const data = await fetchAgenda(key, addDays(key, 1));
      setEvents(data.events ?? []);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load(day, false);
    }, [load, day]),
  );

  const go = (delta: number) => {
    const next = addDays(day, delta);
    setDay(next);
    void load(next, false);
  };

  const today = dayKey(new Date());
  const label = parseKey(day).toLocaleDateString("tr-TR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <ScrollScreen
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void load(day, true)} tintColor={colors.gold} />
      }
    >
      {/* Gün gezinme çubuğu — dokunma hedefleri adliye kullanımı için büyüktür. */}
      <View style={styles.navRow}>
        <Pressable style={styles.navBtn} onPress={() => go(-1)} accessibilityRole="button" accessibilityLabel="Önceki gün">
          <Ionicons name="chevron-back" size={22} color={colors.onNavy} />
        </Pressable>
        <Pressable
          style={styles.dayBtn}
          onPress={() => {
            setDay(today);
            void load(today, false);
          }}
          accessibilityRole="button"
          accessibilityLabel="Bugüne dön"
        >
          <Body>{label.charAt(0).toLocaleUpperCase("tr-TR") + label.slice(1)}</Body>
          <Muted>{day === today ? "bugün" : "bugüne dön"}</Muted>
        </Pressable>
        <Pressable style={styles.navBtn} onPress={() => go(1)} accessibilityRole="button" accessibilityLabel="Sonraki gün">
          <Ionicons name="chevron-forward" size={22} color={colors.onNavy} />
        </Pressable>
      </View>

      {isWeekend(day) ? (
        <View style={styles.weekendNote}>
          <Ionicons name="information-circle-outline" size={18} color={colors.textMuted} />
          <Muted> Hafta sonu — adli tatil ve resmî tatiller sürelere işlemez.</Muted>
        </View>
      ) : null}

      {loading ? (
        <Loading label="Ajanda yükleniyor…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load(day, false)} />
      ) : events.length === 0 ? (
        <EmptyState title="Bu gün için kayıt yok." hint="Önceki/sonraki gün için gezinme oklarını kullanın." />
      ) : (
        <Section title={`${events.length} kayıt`}>
          {events.map((e) => {
            const icon = KIND_ICONS[e.kind] ?? "ellipse-outline";
            const isHearing = e.kind === "DURUSMA" && e.id.startsWith("h-");
            return (
              <Pressable
                key={e.id}
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                disabled={!isHearing}
                onPress={() => isHearing && router.push(`/durusma/${e.id.slice(2)}`)}
                accessibilityRole={isHearing ? "button" : "text"}
                accessibilityLabel={`${KIND_LABELS[e.kind]}: ${e.title}`}
              >
                <View style={styles.rowIcon}>
                  <Ionicons name={icon} size={20} color={colors.gold} />
                </View>
                <View style={{ flex: 1 }}>
                  <Body>{e.title}</Body>
                  <Muted>
                    {KIND_LABELS[e.kind] ?? e.kind}
                    {e.note ? ` · ${e.note}` : ""}
                  </Muted>
                </View>
                {isHearing ? (
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                ) : null}
              </Pressable>
            );
          })}
        </Section>
      )}
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    marginBottom: space.md,
  },
  navBtn: {
    width: TOUCH.min,
    height: TOUCH.min,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  dayBtn: {
    flex: 1,
    minHeight: TOUCH.min,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.md,
  },
  weekendNote: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: space.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSoft,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
});
