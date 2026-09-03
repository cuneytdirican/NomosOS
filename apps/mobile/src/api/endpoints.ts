/**
 * Ekran → uç eşlemesi. Mobilin sunucudan İSTEDİĞİ HER ŞEY burada listelidir.
 *
 * Yazma işlemleri bilinçli olarak SAYILIDIR (proje kararı 4 — "mobil salt-okur
 * ağırlıklıdır"). İzin verilen yazmalar:
 *   1. duruşma notu ekleme        → PATCH /hearings/:id
 *   2. görev durumu değiştirme    → PATCH /tasks/:id/status
 *   3. süre onaylama / reddetme   → PATCH /deadlines/:id/status
 *   4. bildirim okundu            → PATCH /notifications/:id/read
 *   5. mesaj gönderme             → POST /chat/messages        (D5/cila — mobil mesajlar)
 *   6. sohbet okundu              → PATCH /chat/read           (D5/cila — mobil mesajlar)
 * Bunların dışında hiçbir POST/PATCH/DELETE çağrısı YOKTUR.
 */

import { api, asList } from "./client";
import { localDateParam } from "@/lib/format";
import type {
  CaseBrief,
  CaseDetail,
  DashboardSummary,
  Deadline,
  Hearing,
  LoginResponse,
  MeResponse,
  AgendaPayload,
  ChatMessagesPayload,
  ChatMsg,
  ChatThread,
  NotificationItem,
  Task,
} from "./types";

// ---------------------------------------------------------------------------
// Kimlik
// ---------------------------------------------------------------------------

export function login(email: string, password: string): Promise<LoginResponse> {
  return api<LoginResponse>("/auth/login", {
    method: "POST",
    body: { email, password },
    skipAuth: true,
  });
}

export function fetchMe(): Promise<MeResponse> {
  return api<MeResponse>("/me");
}

// ---------------------------------------------------------------------------
// Bugün (ana ekran)
// ---------------------------------------------------------------------------

/**
 * Bugünün duruşmaları.
 *
 * `from`/`to` cihazın YEREL takvim günüdür; sunucu bu günün UTC 00:00–23:59
 * penceresine çevirir. Türkiye (+03) için duruşma saatleri (09:00-17:00) her
 * zaman aynı UTC gününe düşer.
 */
export async function fetchTodayHearings(): Promise<Hearing[]> {
  const day = localDateParam();
  const payload = await api<unknown>("/hearings", {
    query: { from: day, to: day, status: "PLANLANDI", limit: 50 },
  });
  return asList<Hearing>(payload);
}

/**
 * Kritik süreler: bugün dâhil `days` gün içinde dolan AÇIK süreler
 * ve GECİKMİŞ olanlar.
 *
 * `/deadlines/upcoming` yerine `/deadlines?open=true&to=…` kullanılır: upcoming
 * ucu `gte: now` süzdüğü için BUGÜN dolan süreleri (gün başı 00:00Z) sabahın
 * ilk saatinden sonra dışarıda bırakır. Sahada "bugün son gün" bilgisi
 * kaçırılamaz; alt sınır konmaz, geciken süreler de listeye girer.
 */
export async function fetchCriticalDeadlines(days = 3): Promise<Deadline[]> {
  const payload = await api<unknown>("/deadlines", {
    query: { open: "true", to: localDateParam(days), limit: 100 },
  });
  return sortByDueDate(asList<Deadline>(payload));
}

export function fetchDashboard(): Promise<DashboardSummary> {
  return api<DashboardSummary>("/dashboard/summary", { query: { scope: "me" } });
}

// ---------------------------------------------------------------------------
// Duruşmalar
// ---------------------------------------------------------------------------

export function fetchHearing(id: string): Promise<Hearing> {
  return api<Hearing>(`/hearings/${id}`);
}

/**
 * Duruşma notu ekleme — mobilin izin verdiği tek duruşma yazımı.
 *
 * `PATCH /hearings/:id` ile YALNIZCA `note` gönderilir. Duruşma SONUCU girme
 * (`PATCH /hearings/:id/result`) mobilde YOKTUR: sonuç girmek safahat kaydı
 * açar, dosya durumunu etkiler ve erteleme hâlinde yeni duruşma yaratır —
 * koridorda tek elle yapılacak bir işlem değildir.
 */
export function saveHearingNote(id: string, note: string): Promise<Hearing> {
  return api<Hearing>(`/hearings/${id}`, { method: "PATCH", body: { note } });
}

// ---------------------------------------------------------------------------
// Dosyalar
// ---------------------------------------------------------------------------

export async function searchCases(query: string): Promise<CaseBrief[]> {
  const payload = await api<unknown>("/cases", {
    query: { q: query.trim() || undefined, limit: 30 },
  });
  return asList<CaseBrief>(payload);
}

export function fetchCase(id: string): Promise<CaseDetail> {
  return api<CaseDetail>(`/cases/${id}`);
}

/** Belge indirme — süreli imzalı URL üretir ve sunucuda denetim kaydı yazar. */
export function requestDocumentUrl(id: string): Promise<{ url: string; expiresIn?: number }> {
  return api<{ url: string; expiresIn?: number }>(`/documents/${id}/download`);
}

// ---------------------------------------------------------------------------
// Süreler
// ---------------------------------------------------------------------------

/** Açık süreler: gecikmiş olanlar dâhil, `days` gün ilerisine kadar. */
export async function fetchDeadlines(days = 30): Promise<Deadline[]> {
  const payload = await api<unknown>("/deadlines", {
    query: { open: "true", to: localDateParam(days), limit: 200 },
  });
  return sortByDueDate(asList<Deadline>(payload));
}

/** AI önerisi olup onay bekleyen süreler — sahadaki hızlı aksiyonun hedefi. */
export async function fetchPendingProposals(): Promise<Deadline[]> {
  const payload = await api<unknown>("/deadlines", {
    query: { status: "BEKLIYOR", source: "AI_ONERISI", limit: 100 },
  });
  return sortByDueDate(asList<Deadline>(payload));
}

/**
 * Süre önerisini ONAYLAR. Sunucu ROLE_SETS.HUKUKI arar (ADMIN/PARTNER/AVUKAT).
 * Onay, AI önerisini kesinleştiren insan kararıdır — ürün ilkesi gereği
 * AI çıktısı onaysız süre doğurmaz.
 */
export function approveDeadline(id: string, note?: string): Promise<unknown> {
  return api(`/deadlines/${id}/status`, {
    method: "PATCH",
    body: { status: "ONAYLANDI", ...(note ? { note } : {}) },
  });
}

/** Süre önerisini REDDEDER (IPTAL). Gerekçe zorunlu tutulur — denetim izinde kalır. */
export function rejectDeadline(id: string, note: string): Promise<unknown> {
  return api(`/deadlines/${id}/status`, { method: "PATCH", body: { status: "IPTAL", note } });
}

// ---------------------------------------------------------------------------
// Görevler
// ---------------------------------------------------------------------------

export async function fetchMyTasks(assigneeId: string): Promise<Task[]> {
  const payload = await api<unknown>("/tasks", {
    query: { assigneeId, open: "true", limit: 100 },
  });
  return asList<Task>(payload);
}

export function fetchTask(id: string): Promise<Task> {
  return api<Task>(`/tasks/${id}`);
}

/**
 * Görev durumu değiştirme. Sunucu durum makinesini doğrular
 * (`allowedStatusTransitions`) ve onay/ret kurallarını uygular; mobil yalnızca
 * sunucunun izin verdiği geçişleri düğme olarak gösterir.
 */
export function updateTaskStatus(id: string, status: string, note?: string): Promise<unknown> {
  return api(`/tasks/${id}/status`, {
    method: "PATCH",
    body: { status, ...(note ? { note } : {}) },
  });
}

// ---------------------------------------------------------------------------
// Bildirimler  (NotificationOutbox — Zamanlı-iş modülü yayına alır)
// ---------------------------------------------------------------------------

export async function fetchNotifications(): Promise<NotificationItem[]> {
  const payload = await api<unknown>("/notifications", { query: { limit: 100 } });
  return asList<NotificationItem>(payload);
}

export function markNotificationRead(id: string): Promise<unknown> {
  return api(`/notifications/${id}/read`, { method: "PATCH" });
}

/**
 * Cihaz kaydı — anlık bildirim adresi.
 *
 * Bu çağrı BAŞARISIZ OLABİLİR (uç henüz yayında değilse 404) ve bu bir hata
 * değildir: uygulamanın geri kalanı cihaz kaydı olmadan da çalışır. Çağıran
 * taraf sonucu kullanıcıya bilgi olarak gösterir, akışı kesmez.
 */
export function registerDevice(token: string, platform: "IOS" | "ANDROID" | "WEB"): Promise<unknown> {
  return api("/device-tokens", { method: "POST", body: { token, platform } });
}

/**
 * Cihaz kaydını sunucuda PASİFLEŞTİRİR — çıkışın ayrılmaz parçası.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ ÇIKIŞ SUNUCUYA DA SÖYLENİR (denetim bulgusu 8).                          ║
 * ║ Eskiden `wipeLocalSession` yalnız CİHAZDAKİ izleri siliyordu; sunucudaki ║
 * ║ satır `isActive=true` kalıyordu. Avukat telefonunu değiştirip eski       ║
 * ║ cihazdan çıkış yapar ve cihazı satarsa, sunucu o cihazı hâlâ aktif push  ║
 * ║ hedefi sayardı — push kanalı açıldığında müvekkil bilgisi taşıyan        ║
 * ║ bildirimler artık BAŞKASININ elindeki telefona düşerdi. Ayarlar          ║
 * ║ ekranındaki "çıkışta hepsi silinir" beyanı da bu yönüyle doğru değildi.  ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Sunucu süzgeci `tenantId` + `userId` içerir: kimse başkasının jetonunu
 * kapatamaz. Bulunamazsa 404 döner ve bu çıkışı ENGELLEMEZ.
 */
export function revokeDevice(token: string): Promise<unknown> {
  return api(`/device-tokens/${encodeURIComponent(token)}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Ajanda (D5 / cila) — GET /agenda. Sekme değil, yığın ekranıdır: /ajanda.
// ---------------------------------------------------------------------------

export function fetchAgenda(from: string, to: string): Promise<AgendaPayload> {
  return api<AgendaPayload>("/agenda", { query: { from, to } });
}

// ---------------------------------------------------------------------------
// Büroyiçi mesajlaşma (D5 / cila) — web mesajlar sayfasıyla aynı uçlar.
// SSE mobilde YOKTUR (EventSource tarayıcı API'sidir); açık sohbet 15 sn'de
// bir yenilenir — mahkeme salonunda bu gecime kabul edilebilir.
// ---------------------------------------------------------------------------

export function fetchChatThreads(): Promise<ChatThread[]> {
  return api<ChatThread[]>("/chat/threads").then((r) => asList<ChatThread>(r));
}

export function fetchChatMessages(peerId: string, limit = 60): Promise<ChatMessagesPayload> {
  return api<ChatMessagesPayload>("/chat/messages", {
    query: { peerId, limit },
  });
}

export function sendChatMessage(peerId: string, content: string): Promise<ChatMsg> {
  return api<ChatMsg>("/chat/messages", {
    method: "POST",
    body: { peerId, content },
  });
}

export function markChatRead(peerId: string, lastReadMessageId: string): Promise<unknown> {
  return api("/chat/read", {
    method: "PATCH",
    body: { peerId, lastReadMessageId },
  });
}

// ---------------------------------------------------------------------------

function sortByDueDate<T extends { dueDate: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}
