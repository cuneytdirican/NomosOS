/**
 * /mesajlar — büroyiçi mesajlaşmanın mobil görünümü (D5 / cila).
 *
 * Web mesajlar sayfasıyla AYNI uçları kullanır. SSE mobilde YOKTUR
 * (EventSource tarayıcı API'sidir) — açık sohbet 15 saniyede bir yenilenir;
 * mahkeme salonunda bu gecikme kabul edilebilir. Yeni mesaj gönderme ve
 * okundu işaretleme, mobilin sayılı yazma listesinde bilinçli olarak
 * listededir (endpoints.ts başlığına bakınız).
 *
 * Video arama ve dosya eki mobilde YOKTUR: ek yüklemesi masaüstü akışıdır.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { errorMessage } from "@/api/client";
import {
  fetchChatMessages,
  fetchChatThreads,
  markChatRead,
  sendChatMessage,
} from "@/api/endpoints";
import type { ChatMsg, ChatThread } from "@/api/types";
import { Body, EmptyState, ErrorState, Loading, Muted } from "@/ui/components";
import { ROLE_LABELS } from "@/lib/labels";
import { colors, font, radius, space, TOUCH } from "@/ui/theme";

/** Açık sohbet yenileme aralığı (ms) — SSE yerine basit zamanlayıcı. */
const REFRESH_MS = 15_000;

export default function MesajlarScreen(): React.JSX.Element {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Konuşma görünümü
  const [activePeer, setActivePeer] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef = useRef<TextInput>(null);

  const loadThreads = useCallback(async (isRefresh: boolean) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const rows = await fetchChatThreads();
      setThreads(rows);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadMessages = useCallback(async (peerId: string) => {
    try {
      const data = await fetchChatMessages(peerId);
      setMessages(data.messages ?? []);
      setMessagesError(null);
      // Görüntüleme = okundu: en son mesaj işaretlenir (yenilenince okunmamış düşer).
      const last = data.messages?.[data.messages.length - 1];
      if (last && !last.fromMe) {
        void markChatRead(peerId, last.id).catch(() => undefined);
      }
    } catch (caught) {
      setMessagesError(errorMessage(caught));
    }
  }, []);

  const openThread = useCallback(
    (thread: ChatThread) => {
      setActivePeer(thread);
      setMessages([]);
      setMessagesError(null);
      setDraft("");
      setMessagesLoading(true);
      void loadMessages(thread.peer.id).finally(() => setMessagesLoading(false));
    },
    [loadMessages],
  );

  const closeThread = useCallback(() => {
    setActivePeer(null);
    setMessages([]);
    void loadThreads(false);
  }, [loadThreads]);

  useFocusEffect(
    useCallback(() => {
      void loadThreads(false);
      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    }, [loadThreads]),
  );

  // Açık sohbet yenileme — SSE yerine zamanlayıcı; ekranından çıkınca durur.
  useEffect(() => {
    if (!activePeer) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => {
      void loadMessages(activePeer.peer.id);
    }, REFRESH_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [activePeer, loadMessages]);

  async function send() {
    if (!activePeer || draft.trim().length === 0 || sending) return;
    setSending(true);
    try {
      await sendChatMessage(activePeer.peer.id, draft.trim());
      setDraft("");
      await loadMessages(activePeer.peer.id);
    } catch (caught) {
      setMessagesError(errorMessage(caught));
    } finally {
      setSending(false);
    }
  }

  // ------------------------------------------------------------- konuşma
  if (activePeer) {
    return (
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.bg }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.headerBar}>
          <Pressable
            style={styles.backBtn}
            onPress={closeThread}
            accessibilityRole="button"
            accessibilityLabel="Sohbet listesine dön"
          >
            <Ionicons name="chevron-back" size={22} color={colors.onNavy} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Body>{activePeer.peer.fullName}</Body>
            <Muted>
              {ROLE_LABELS[activePeer.peer.role] ?? activePeer.peer.role} ·{" "}
              {activePeer.peer.online ? "çevrimiçi" : "çevrimdışı"}
            </Muted>
          </View>
          <View
            style={[styles.dot, { backgroundColor: activePeer.peer.online ? colors.ok : colors.textMuted }]}
          />
        </View>

        {messagesLoading ? (
          <Loading label="Mesajlar yükleniyor…" />
        ) : messagesError ? (
          <ErrorState message={messagesError} onRetry={() => activePeer && void loadMessages(activePeer.peer.id)} />
        ) : messages.length === 0 ? (
          <EmptyState title="Bu sohbette henüz mesaj yok." hint="Aşağıdan ilk mesajı yazın." />
        ) : (
          <FlatList
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={{ padding: space.md }}
            renderItem={({ item }) => (
              <View style={[styles.bubble, item.fromMe ? styles.bubbleMine : styles.bubbleTheirs]}>
                {item.content ? <Body>{item.content}</Body> : null}
                {item.attachment ? (
                  <Muted>📎 {item.attachment.name}</Muted>
                ) : null}
                <Muted>{new Date(item.createdAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}</Muted>
              </View>
            )}
          />
        )}

        <View style={styles.inputBar}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Mesaj yazın…"
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={4000}
            accessibilityLabel="Mesaj metni"
          />
          <Pressable
            style={[styles.sendBtn, (sending || draft.trim().length === 0) && { opacity: 0.5 }]}
            onPress={() => void send()}
            disabled={sending || draft.trim().length === 0}
            accessibilityRole="button"
            accessibilityLabel="Mesajı gönder"
          >
            <Ionicons name="send" size={20} color={colors.onNavy} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // --------------------------------------------------------------- liste
  return (
    <FlatList
      data={threads}
      keyExtractor={(t) => t.peer.id}
      contentContainerStyle={{ padding: space.md }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void loadThreads(true)} tintColor={colors.gold} />
      }
      ListHeaderComponent={
        loading ? (
          <Loading label="Sohbetler yükleniyor…" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void loadThreads(false)} />
        ) : null
      }
      ListEmptyComponent={
        !loading && !error ? (
          <EmptyState
            title="Henüz sohbet yok."
            hint="Büroda mesajlaştığınız kişiler burada listelenir."
          />
        ) : null
      }
      renderItem={({ item }) => (
        <Pressable
          style={({ pressed }) => [styles.threadRow, pressed && { opacity: 0.7 }]}
          onPress={() => openThread(item)}
          accessibilityRole="button"
          accessibilityLabel={`${item.peer.fullName} ile sohbeti aç`}
        >
          <View style={styles.avatar}>
            <Body>{item.peer.fullName.charAt(0).toLocaleUpperCase("tr-TR")}</Body>
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
              <Body>{item.peer.fullName}</Body>
              {item.peer.online ? <View style={[styles.dot, { backgroundColor: colors.ok }]} /> : null}
            </View>
            <Muted numberOfLines={1}>
              {item.lastMessage
                ? `${item.lastMessage.fromMe ? "Siz: " : ""}${item.lastMessage.content ?? "📎 ek"}`
                : ROLE_LABELS[item.peer.role] ?? item.peer.role}
            </Muted>
          </View>
          {item.unread > 0 ? (
            <View style={styles.badge}>
              <Body>{item.unread}</Body>
            </View>
          ) : null}
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    backgroundColor: colors.navy,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  bubble: {
    maxWidth: "80%",
    borderRadius: radius.lg,
    padding: space.md,
    marginBottom: space.sm,
  },
  bubbleMine: { alignSelf: "flex-end", backgroundColor: colors.infoBg },
  bubbleTheirs: { alignSelf: "flex-start", backgroundColor: colors.surface },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: space.sm,
    padding: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSoft,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    minHeight: TOUCH.min - 16,
    maxHeight: 120,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    color: colors.text,
    fontSize: font.body,
    backgroundColor: colors.bg,
    textAlignVertical: "center",
  },
  sendBtn: {
    width: TOUCH.min - 8,
    height: TOUCH.min - 8,
    borderRadius: radius.lg,
    backgroundColor: colors.gold,
    alignItems: "center",
    justifyContent: "center",
  },
  threadRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    marginBottom: space.sm,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.navy,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.gold,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
});
