"use client";

/**
 * BÜRO İÇİ MESAJLAŞMA — WhatsApp tarzı arayüz.
 *
 * Sol: sohbet listesi (çevrimiçi noktası, okunmayan sayacı, son mesaj,
 * "yazıyor…" göstergesi). Sağ: sohbet penceresi (baloncuklar, ekler,
 * okundu işaretleri).
 *
 * POLLING MİMARİSİ: WebSocket yoktur (bilinçli mimari seçim); istemci
 * kalp atışı (30 sn), sohbet listesi (10 sn) ve açık sohbet (3 sn)
 * aralıklarıyla yoklar. Ofis ölçeğinde bu gecikme kabul edilebilirdir.
 *
 * MESAJ SİLME YOK: arayüzde silme düğmesi yoktur; sunucuda da yoktur.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button, Card, EmptyState, ErrorBox, Input, Spinner } from "@/components/ui";
import { useVideoCall } from "@/components/video-call";
import { Avatar, AvatarUploadButton, useAvatar } from "@/components/chat-avatar";

/** Sohbet avatarı — foto varsa foto, yoksa baş harfler + çevrimiçi noktası. */
function ThreadAvatar({ peer }: { peer: { id: string; fullName: string; hasAvatar: boolean; online: boolean } }) {
  const url = useAvatar(peer.id, peer.hasAvatar);
  return <Avatar fullName={peer.fullName} url={url} online={peer.online} size={40} />;
}

/* ------------------------------- Tipler ------------------------------- */

interface ChatPeer {
  id: string;
  fullName: string;
  role: string;
  hasAvatar: boolean;
  online: boolean;
  lastSeenAt: string | null;
}

interface Thread {
  peer: ChatPeer;
  lastMessage: {
    id: string;
    content: string | null;
    fromMe: boolean;
    hasAttachment: boolean;
    createdAt: string;
  } | null;
  unread: number;
  typing: boolean;
}

interface ChatMsg {
  id: string;
  fromMe: boolean;
  content: string | null;
  attachment: { documentId: string; name: string; mimeType: string; sizeBytes: number } | null;
  createdAt: string;
}

interface MessagesPayload {
  peer: ChatPeer & { typing: boolean };
  messages: ChatMsg[];
  hasMoreBefore: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Yönetici",
  PARTNER: "Ortak",
  AVUKAT: "Avukat",
  STAJYER: "Stajyer",
  SEKRETER: "Sekreter",
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}
function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "long" });
}
function fmtSize(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Aynı gün mü? Tarih ayırıcıları için. */
function sameDay(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

export default function MesajlarPage() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activePeerId, setActivePeerId] = useState<string | null>(null);
  /** D1.4 — kendi kullanıcı kimliğimiz (gelen arama yoklaması için). */
  const [myUserId, setMyUserId] = useState<string | undefined>(undefined);

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [peerInfo, setPeerInfo] = useState<(ChatPeer & { typing: boolean }) | null>(null);
  const [hasMoreBefore, setHasMoreBefore] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [attachName, setAttachName] = useState<string | null>(null);
  const [attachBusy, setAttachBusy] = useState(false);

  const lastMsgIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // D1.4 — görüntülü arama kancası (WebRTC + sinyalleşme yoklaması).
  const call = useVideoCall(myUserId);
  const bottomRef = useRef<HTMLDivElement>(null);

  /* ------------------------- Kalp atışı + yoklama ------------------------- */

  useEffect(() => {
    void api("/chat/heartbeat", { method: "POST" }).catch(() => undefined);
    // D1.4 — kendi kimliğimiz (gelen arama yakalama + me dışında avatar).
    void api<{ userId?: string }>("/me")
      .then((me) => setMyUserId(me?.userId))
      .catch(() => undefined);
    const hb = setInterval(() => {
      void api("/chat/heartbeat", { method: "POST" }).catch(() => undefined);
    }, 30_000);
    return () => clearInterval(hb);
  }, []);

  const loadThreads = useCallback(async () => {
    try {
      const data = await api<unknown>("/chat/threads");
      setThreads(Array.isArray(data) ? (data as Thread[]) : []);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sohbet listesi yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadThreads();
    const t = setInterval(() => void loadThreads(), 10_000);
    return () => clearInterval(t);
  }, [loadThreads]);

  /* ------------------------------ Sohbet açma ------------------------------ */

  const openChat = useCallback(async (peerId: string) => {
    setActivePeerId(peerId);
    setChatLoading(true);
    setChatError(null);
    setMessages([]);
    lastMsgIdRef.current = null;
    try {
      const data = await api<MessagesPayload>("/chat/messages", { query: { peerId, limit: "60" } });
      setMessages(data.messages);
      setPeerInfo(data.peer);
      setHasMoreBefore(data.hasMoreBefore);
      const last = data.messages[data.messages.length - 1];
      if (last) {
        lastMsgIdRef.current = last.id;
        void api("/chat/read", { method: "PATCH", body: { peerId, lastReadMessageId: last.id } }).catch(
          () => undefined,
        );
      }
    } catch (err) {
      setChatError(err instanceof ApiError ? err.message : "Mesajlar yüklenemedi.");
    } finally {
      setChatLoading(false);
    }
  }, []);

  /** Açık sohbetin artımlı yoklaması — yeni mesajları çeker. */
  useEffect(() => {
    if (!activePeerId) return;
    const poll = async () => {
      try {
        const query: Record<string, string> = { peerId: activePeerId };
        if (lastMsgIdRef.current) query.after = lastMsgIdRef.current;
        const data = await api<MessagesPayload>("/chat/messages", { query });
        setPeerInfo(data.peer);
        if (data.messages.length > 0) {
          setMessages((prev) => {
            const seen = new Set(prev.map((m) => m.id));
            const fresh = data.messages.filter((m) => !seen.has(m.id));
            if (fresh.length === 0) return prev;
            const last = fresh[fresh.length - 1];
            lastMsgIdRef.current = last.id;
            void api("/chat/read", {
              method: "PATCH",
              body: { peerId: activePeerId, lastReadMessageId: last.id },
            }).catch(() => undefined);
            return [...prev, ...fresh];
          });
        }
      } catch {
        /* geçici yoklama hatası sessiz geçer */
      }
    };
    const t = setInterval(() => void poll(), 3_000);
    return () => clearInterval(t);
  }, [activePeerId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, activePeerId]);

  /* ------------------------------ Gönderme ------------------------------ */

  async function handleSend() {
    if (!activePeerId || sending) return;
    const content = draft.trim();
    if (!content && !attachName) return;
    setSending(true);
    try {
      await api("/chat/messages", { method: "POST", body: { peerId: activePeerId, content: content || undefined } });
      setDraft("");
      // Anında yansıt: bir sonraki poll hemen çalışsın.
      const data = await api<MessagesPayload>("/chat/messages", {
        query: { peerId: activePeerId, after: lastMsgIdRef.current ?? undefined, limit: "20" },
      });
      if (data.messages.length > 0) {
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          const fresh = data.messages.filter((m) => !seen.has(m.id));
          const last = fresh[fresh.length - 1];
          if (last) lastMsgIdRef.current = last.id;
          return fresh.length ? [...prev, ...fresh] : prev;
        });
      }
      void loadThreads();
    } catch (err) {
      setChatError(err instanceof ApiError ? err.message : "Mesaj gönderilemedi.");
    } finally {
      setSending(false);
    }
  }

  /** Yazıyor göstergesi — her tuşta (kısa aralıkla) bildirir. */
  const lastTypingSent = useRef(0);
  function handleDraftChange(value: string) {
    setDraft(value);
    if (activePeerId && Date.now() - lastTypingSent.current > 2000) {
      lastTypingSent.current = Date.now();
      void api("/chat/typing", { method: "POST", body: { peerId: activePeerId } }).catch(
        () => undefined,
      );
    }
  }

  /** Ek yükleme: presign → PUT → mesaj. */
  async function handleAttach(file: File) {
    if (!activePeerId) return;
    setAttachBusy(true);
    setChatError(null);
    try {
      const presign = await api<{
        uploadUrl: string;
        headers: Record<string, string>;
        storageKey: string;
      }>("/chat/messages/presign", {
        method: "POST",
        body: { fileName: file.name, mimeType: file.type || "application/octet-stream", sizeBytes: file.size },
      });
      await fetch(presign.uploadUrl, {
        method: "PUT",
        headers: presign.headers,
        body: file,
      });
      await api("/chat/messages", {
        method: "POST",
        body: {
          peerId: activePeerId,
          content: draft.trim() || undefined,
          attachment: {
            storageKey: presign.storageKey,
            fileName: file.name,
            mimeType: file.type || "application/octet-stream",
            sizeBytes: file.size,
          },
        },
      });
      setDraft("");
      setAttachName(null);
      const data = await api<MessagesPayload>("/chat/messages", {
        query: { peerId: activePeerId, after: lastMsgIdRef.current ?? undefined, limit: "20" },
      });
      if (data.messages.length > 0) {
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          const fresh = data.messages.filter((m) => !seen.has(m.id));
          const last = fresh[fresh.length - 1];
          if (last) lastMsgIdRef.current = last.id;
          return fresh.length ? [...prev, ...fresh] : prev;
        });
      }
      void loadThreads();
    } catch (err) {
      setChatError(err instanceof ApiError ? err.message : "Ek yüklenemedi.");
    } finally {
      setAttachBusy(false);
    }
  }

  /* -------------------------------- Render -------------------------------- */

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Mesajlar</h1>
          <p className="mt-1 text-sm text-slate-500">
            Büro içi yazışma — mesajlar silinemez, denetim izi olarak saklanır.
          </p>
          <div className="mt-1">
            <AvatarUploadButton />
          </div>
        </div>
      </div>

      <div className="grid h-[calc(100vh-220px)] min-h-[480px] grid-cols-1 gap-4 md:grid-cols-[320px_1fr]">
        {/* Sohbet listesi */}
        <Card className="flex flex-col overflow-hidden">
          <div className="border-b border-slate-100 p-3 text-sm font-semibold text-slate-700">
            Sohbetler
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-4">
                <Spinner />
              </div>
            ) : error ? (
              <div className="p-4">
                <ErrorBox message={error} />
              </div>
            ) : threads.length === 0 ? (
              <div className="p-4 text-sm text-slate-500">
                Büronuzda mesajlaşabileceğiniz başka kullanıcı yok.
              </div>
            ) : (
              threads.map((t) => (
                <button
                  key={t.peer.id}
                  type="button"
                  onClick={() => void openChat(t.peer.id)}
                  className={`flex w-full items-center gap-3 border-b border-slate-50 px-3 py-3 text-left transition-colors ${
                    activePeerId === t.peer.id ? "bg-amber-50" : "hover:bg-slate-50"
                  }`}
                >
                  <ThreadAvatar peer={t.peer} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-slate-900">{t.peer.fullName}</span>
                      {t.lastMessage && (
                        <span className="shrink-0 text-[10px] text-slate-500">{fmtTime(t.lastMessage.createdAt)}</span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-slate-500">
                      {t.typing ? (
                        <span className="italic text-emerald-700">yazıyor…</span>
                      ) : t.lastMessage ? (
                        `${t.lastMessage.fromMe ? "Siz: " : ""}${t.lastMessage.content ?? "📎 ek"}`
                      ) : (
                        ROLE_LABELS[t.peer.role] ?? t.peer.role
                      )}
                    </span>
                  </span>
                  {t.unread > 0 && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">
                      {t.unread > 99 ? "99+" : t.unread}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </Card>

        {/* Sohbet penceresi */}
        <Card className="flex flex-col overflow-hidden">
          {!activePeerId ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <EmptyState message="Sohbet açmak için soldan bir kişi seçin." />
            </div>
          ) : chatLoading ? (
            <div className="flex flex-1 items-center justify-center">
              <Spinner label="Mesajlar yükleniyor…" />
            </div>
          ) : (
            <>
              {/* Sohbet başlığı */}
              <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
                {peerInfo && <ThreadAvatar peer={peerInfo} />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">{peerInfo?.fullName}</p>
                  <p className="text-xs text-slate-500">
                    {peerInfo?.typing ? (
                      <span className="italic text-emerald-700">yazıyor…</span>
                    ) : peerInfo?.online ? (
                      <span className="text-emerald-700">çevrimiçi</span>
                    ) : (
                      ROLE_LABELS[peerInfo?.role ?? ""] ?? peerInfo?.role ?? ""
                    )}
                  </p>
                </div>
                {/* D1.4 — görüntülü arama düğmesi */}
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (peerInfo) void call.startCall(peerInfo.id, peerInfo.fullName);
                  }}
                  aria-label="Görüntülü ara"
                >
                  📹
                </Button>
              </div>

              {/* Görüntülü arama paneli (aktifken) */}
              {call.phase && (
                <div className="border-b border-slate-100 bg-slate-900 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-white">
                      {call.phase === "ringing-out" && `${call.peerName} aranıyor…`}
                      {call.phase === "active" && `${call.peerName} ile görüşme sürüyor`}
                      {call.phase === "ended" && "Arama sonlandı"}
                      {call.phase === "failed" && "Arama kurulamadı"}
                    </p>
                    <Button variant="danger" onClick={() => void call.endCall()}>
                      Kapat
                    </Button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <video ref={call.localVideoRef} autoPlay muted playsInline className="h-36 w-full rounded-lg bg-black object-cover" />
                    <video ref={call.remoteVideoRef} autoPlay playsInline className="h-36 w-full rounded-lg bg-slate-800 object-cover" />
                  </div>
                  {call.error && <p className="mt-1.5 text-[11px] text-red-300">{call.error}</p>}
                  <p className="mt-1 text-[10px] text-slate-500">
                    Görüntü ve ses doğrudan iki taraf arasında akar (P2P, STUN). Sıkı ağlarda
                    bağlanılamazsa mesajlaşmayı kullanın.
                  </p>
                </div>
              )}

              {/* Gelen arama bandı */}
              {call.incoming && !call.phase && (
                <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2.5">
                  <p className="text-sm font-medium text-amber-900">
                    📞 {call.incoming.from.fullName} sizi görüntülü arıyor…
                  </p>
                  <div className="flex gap-2">
                    <Button variant="gold" onClick={() => void call.acceptCall(call.incoming!)}>
                      Aç
                    </Button>
                    <Button variant="secondary" onClick={() => void call.rejectCall(call.incoming!)}>
                      Reddet
                    </Button>
                  </div>
                </div>
              )}

              {/* Mesaj akışı */}
              <div className="flex-1 space-y-1 overflow-y-auto bg-slate-50 px-4 py-3">
                {hasMoreBefore && (
                  <p className="pb-2 text-center text-[11px] text-slate-500">Daha eski mesajlar yukarıda…</p>
                )}
                {messages.length === 0 && (
                  <p className="pt-8 text-center text-xs text-slate-500">
                    Bu sohbette henüz mesaj yok — ilk mesajı siz yazın.
                  </p>
                )}
                {messages.map((m, i) => {
                  const showDay =
                    i === 0 || !sameDay(messages[i - 1].createdAt, m.createdAt);
                  return (
                    <div key={m.id}>
                      {showDay && (
                        <p className="py-2 text-center">
                          <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-[10px] font-medium text-slate-600">
                            {fmtDay(m.createdAt)}
                          </span>
                        </p>
                      )}
                      <div className={`flex ${m.fromMe ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                            m.fromMe
                              ? "rounded-br-md bg-amber-500 text-white"
                              : "rounded-bl-md bg-white text-slate-800"
                          }`}
                        >
                          {m.content && <p className="whitespace-pre-wrap break-words">{m.content}</p>}
                          {m.attachment && (
                            <p className={`text-xs ${m.fromMe ? "text-amber-50" : "text-slate-500"}`}>
                              📎 {m.attachment.name} · {fmtSize(m.attachment.sizeBytes)}
                            </p>
                          )}
                          <p className={`mt-0.5 text-right text-[10px] ${m.fromMe ? "text-amber-100" : "text-slate-500"}`}>
                            {fmtTime(m.createdAt)} {m.fromMe && "✓"}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              {chatError && (
                <div className="px-4 pt-2">
                  <ErrorBox message={chatError} />
                </div>
              )}

              {/* Yazma alanı */}
              <div className="flex items-center gap-2 border-t border-slate-100 px-3 py-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setAttachName(f.name);
                      void handleAttach(f);
                    }
                    e.target.value = "";
                  }}
                />
                <Button
                  variant="secondary"
                  disabled={attachBusy || sending}
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Dosya ekle"
                >
                  {attachBusy ? "…" : "📎"}
                </Button>
                <Input
                  value={draft}
                  onChange={(e) => handleDraftChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                  placeholder="Mesaj yazın… (Enter gönderir)"
                  aria-label="Mesaj"
                />
                <Button variant="gold" disabled={sending || (!draft.trim() && !attachName)} onClick={() => void handleSend()}>
                  {sending ? "…" : "Gönder"}
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
