/**
 * /bildirimler — NotificationOutbox kayıtlarının listesi + okundu işaretleme.
 *
 * UÇLARIN SAHİBİ BU AJAN DEĞİLDİR: `/notifications` ve `/notifications/:id/read`
 * Zamanlı-iş modülüyle birlikte yayına girer. Uç henüz yoksa sunucu 404 döner
 * ve ekran bunu HATA GİBİ DEĞİL, "modül henüz açılmadı" bilgisi olarak gösterir
 * — kullanıcı bozuk bir uygulama görmez.
 */

import React, { useCallback, useState } from "react";
import { RefreshControl, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { ApiError, errorMessage } from "@/api/client";
import { fetchNotifications, markNotificationRead } from "@/api/endpoints";
import type { NotificationItem } from "@/api/types";
import { useOnline } from "@/net/connectivity";
import { NOTIFICATION_KIND_LABELS, label } from "@/lib/labels";
import { formatDateTime } from "@/lib/format";
import {
  Badge,
  Body,
  Card,
  EmptyState,
  ErrorState,
  Loading,
  Muted,
  ScrollScreen,
  Section,
} from "@/ui/components";
import { colors, font, radius, space } from "@/ui/theme";

/** Bildirim türünden uygulama içi hedefe eşleme. */
function targetRoute(item: NotificationItem): string | null {
  if (!item.resourceId) return null;
  switch (item.resourceType) {
    case "Hearing":
      return `/durusma/${item.resourceId}`;
    case "Case":
      return `/dosya/${item.resourceId}`;
    default:
      return null;
  }
}

export default function NotificationsScreen(): React.JSX.Element {
  const router = useRouter();
  const online = useOnline();

  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh: boolean) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      setItems(await fetchNotifications());
      setUnavailable(false);
    } catch (caught) {
      if (caught instanceof ApiError && caught.isNotImplemented) {
        setUnavailable(true);
        setItems([]);
      } else {
        setError(errorMessage(caught));
      }
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

  const open = useCallback(
    async (item: NotificationItem) => {
      const route = targetRoute(item);

      // Okundu işaretleme İYİMSER yapılır: yerel liste hemen güncellenir,
      // sunucu yazımı arka planda denenir. Başarısız olursa liste yenilenince
      // gerçek durum geri gelir — kullanıcı beklemez, veri de uydurulmaz.
      if (item.readAt === null || item.readAt === undefined) {
        setItems((current) =>
          current.map((row) => (row.id === item.id ? { ...row, readAt: new Date().toISOString() } : row)),
        );
        if (online) {
          try {
            await markNotificationRead(item.id);
          } catch (caught) {
            if (!(caught instanceof ApiError && caught.isNotImplemented)) {
              setActionError(errorMessage(caught));
            }
          }
        }
      }

      if (route) router.push(route);
    },
    [online, router],
  );

  if (loading && items.length === 0 && !unavailable) return <Loading label="Bildirimler alınıyor…" />;
  if (error !== null && items.length === 0) return <ErrorState message={error} onRetry={() => void load(false)} />;

  return (
    <ScrollScreen
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.navy} />}
    >
      {actionError ? (
        <View style={styles.actionError}>
          <Body style={styles.actionErrorText}>{actionError}</Body>
        </View>
      ) : null}

      {unavailable ? (
        <View style={styles.unavailable}>
          <Body style={styles.unavailableTitle}>Bildirim modülü bu sunucuda henüz açık değil.</Body>
          <Muted>
            Süre ve duruşma hatırlatmaları yayına alındığında bu ekran kendiliğinden dolar. Bu arada Bugün ve
            Süreler sekmeleri güncel bilgiyi gösterir.
          </Muted>
        </View>
      ) : (
        <Section title="Bildirimler">
          {items.length === 0 ? (
            <EmptyState title="Bildirim yok." hint="Aşağı çekerek yenileyebilirsiniz." />
          ) : (
            items.map((item) => {
              const unread = item.readAt === null || item.readAt === undefined;
              return (
                <Card
                  key={item.id}
                  onPress={() => void open(item)}
                  accent={unread ? colors.gold : undefined}
                  style={unread ? undefined : styles.read}
                >
                  <View style={styles.head}>
                    <Badge text={label(NOTIFICATION_KIND_LABELS, item.kind)} tone={unread ? "gold" : "gray"} />
                    <Muted>{formatDateTime(item.createdAt)}</Muted>
                  </View>
                  <Body style={unread ? styles.unreadTitle : styles.readTitle}>{item.title}</Body>
                  <Muted numberOfLines={4}>{item.body}</Muted>
                </Card>
              );
            })
          )}
        </Section>
      )}
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space.sm },
  unreadTitle: { fontWeight: "700" },
  readTitle: { fontWeight: "500", color: colors.textSoft },
  read: { opacity: 0.75 },
  unavailable: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: space.lg,
  },
  unavailableTitle: { fontWeight: "700", marginBottom: space.sm },
  actionError: { backgroundColor: colors.dangerBg, borderRadius: radius.md, padding: space.md, marginBottom: space.lg },
  actionErrorText: { color: "#7F1D1D", fontSize: font.small, lineHeight: 20 },
});
