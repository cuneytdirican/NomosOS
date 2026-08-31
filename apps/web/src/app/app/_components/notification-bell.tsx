"use client";

/**
 * BİLDİRİM MERKEZİ — üst çubuktaki zil ve açılır panel (Faz 6).
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ BİLDİRİM, İŞİN KENDİSİ DEĞİL İŞARETİDİR.                                 ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Panel hiçbir kaydı DEĞİŞTİRMEZ: "okundu" yalnızca bildirimin durumudur,
 * kaynak kaydı kapatmaz. Süresi geçmiş bir uyarıyı okundu işaretlemek süreyi
 * tamamlamaz — bu ayrım panelde açıkça yazılıdır.
 *
 * KRİTİK TÜRLER (SURE_GECTI, SURE_YAKLASIYOR) listenin BAŞINDA ve kırmızı
 * şeritle durur. Ölçüt "yeni mi" değil, TELAFİSİ VAR MI: üç gün önce yazılmış
 * bir "süre geçti" uyarısı, bugün gelen bir "ödeme alındı"dan önemlidir ve
 * zaman sıralaması onu listenin dibine gömerdi.
 *
 * Uç henüz yayında değilse zil KALIR ama rozet gösterilmez ve panel durumu
 * açıkça söyler; sahte bir "0 bildirim" göstermek, çalışan bir sistem izlenimi
 * verirdi.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, EmptyState, Spinner } from "@/components/ui";
import { FeatureUnavailable } from "@/components/ai-ui";
import {
  NOTIFICATION_KIND_ICONS,
  NOTIFICATION_KIND_LABELS,
  fmtRelativeTime,
  isCriticalNotification,
  labelOf,
} from "@/lib/labels";
import {
  NOTIFICATIONS_CHANGED_EVENT,
  fetchNotifications,
  isFeatureMissing,
  markAllNotificationsRead,
  markNotificationRead,
  notifyNotificationsChanged,
  sortNotifications,
} from "../_lib/faz6";
import type { NotificationItem } from "../_lib/faz6-types";

/** Kaç saniyede bir tazelenir — kredi göstergesi ve öneri rozetiyle aynı desen. */
const POLL_MS = 60_000;

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const feed = await fetchNotifications({ limit: 30 });
      setItems(sortNotifications(feed.items, isCriticalNotification));
      setUnread(feed.unreadCount);
      setMissing(false);
    } catch (err) {
      // Uç yoksa sessizleş; başka bir hata da kullanıcının işini durdurmaz.
      setItems([]);
      setUnread(0);
      setMissing(isFeatureMissing(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const handler = () => void load();
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, handler);
    const timer = window.setInterval(handler, POLL_MS);
    return () => {
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, handler);
      window.clearInterval(timer);
    };
  }, [load]);

  // Panel açıldığında taze veri: kullanıcı zile bastığında 60 saniyelik gecikme
  // "yeni bildirim yok" yanılgısı üretebilirdi.
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  async function readOne(n: NotificationItem) {
    if (n.readAt) return;
    // İYİMSER GÜNCELLEME: kullanıcı bağlantıya tıklayıp sayfadan ayrılıyor;
    // sunucu yanıtını beklemek rozeti eski değerde bırakırdı.
    setItems((prev) =>
      prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)),
    );
    setUnread((c) => Math.max(0, c - 1));
    try {
      await markNotificationRead(n.id);
      notifyNotificationsChanged();
    } catch {
      // Sunucu reddederse bir sonraki tazelemede gerçek durum geri gelir.
    }
  }

  async function readAll() {
    setBusy(true);
    try {
      await markAllNotificationsRead();
      await load();
      notifyNotificationsChanged();
    } catch {
      /* hata durumunda liste olduğu gibi kalır */
    } finally {
      setBusy(false);
    }
  }

  const criticalUnread = items.filter((n) => !n.readAt && isCriticalNotification(n.kind)).length;

  return (
    <div ref={rootRef} className="relative print:hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread > 0 ? `Bildirimler — ${unread} okunmamış` : "Bildirimler"}
        className={`relative flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${
          open
            ? "border-slate-400 bg-slate-100 text-slate-900"
            : "border-slate-300 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700"
        }`}
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
          <path
            fillRule="evenodd"
            d="M10 2a6 6 0 0 0-6 6v2.586l-.94.94A1.5 1.5 0 0 0 4.122 14h11.756a1.5 1.5 0 0 0 1.06-2.474l-.939-.94V8a6 6 0 0 0-6-6Zm-2.25 14a2.25 2.25 0 0 0 4.5 0h-4.5Z"
            clipRule="evenodd"
          />
        </svg>
        {unread > 0 && (
          <span
            className={`absolute -right-0.5 -top-0.5 inline-flex min-w-[1.15rem] items-center justify-center rounded-full px-1 py-0.5 text-[10px] font-bold tabular-nums text-white ${
              criticalUnread > 0 ? "bg-red-600" : "bg-slate-900"
            }`}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Bildirimler"
          className="absolute right-0 z-40 mt-2 w-[22rem] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl sm:w-96"
        >
          <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Bildirimler</p>
              <p className="text-[11px] text-slate-500">
                {unread > 0 ? `${unread} okunmamış` : "Tümü okundu"}
              </p>
            </div>
            {items.length > 0 && (
              <Button size="sm" variant="secondary" disabled={busy || unread === 0} onClick={() => void readAll()}>
                {busy ? "İşleniyor…" : "Tümünü okundu işaretle"}
              </Button>
            )}
          </header>

          <div className="max-h-[26rem] overflow-y-auto">
            {loading ? (
              <div className="px-4">
                <Spinner label="Bildirimler yükleniyor…" />
              </div>
            ) : missing ? (
              <div className="p-4">
                <FeatureUnavailable
                  title="Bildirim hattı henüz yayında değil"
                  detail="Zamanlanmış işler (BullMQ) bildirim üretmeye başladığında bu panel kendiliğinden dolar."
                />
              </div>
            ) : items.length === 0 ? (
              <div className="p-4">
                <EmptyState message="Bildiriminiz yok." />
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {items.map((n) => (
                  <NotificationRow key={n.id} item={n} onRead={() => void readOne(n)} onNavigate={() => setOpen(false)} />
                ))}
              </ul>
            )}
          </div>

          {items.length > 0 && (
            <footer className="border-t border-slate-100 bg-slate-50 px-4 py-2.5">
              <p className="text-[11px] leading-4 text-slate-500">
                &quot;Okundu&quot; yalnızca bildirimin durumudur; kaynak kaydı (süre, görev,
                fatura) <strong>kapatmaz</strong>.
              </p>
            </footer>
          )}
        </div>
      )}
    </div>
  );
}

function NotificationRow({
  item,
  onRead,
  onNavigate,
}: {
  item: NotificationItem;
  onRead: () => void;
  onNavigate: () => void;
}) {
  const critical = isCriticalNotification(item.kind);
  const unread = !item.readAt;

  const inner = (
    <div
      className={`flex gap-3 px-4 py-3 ${
        critical ? "border-l-4 border-l-red-600 bg-red-50/50" : unread ? "bg-amber-50/40" : ""
      }`}
    >
      <span aria-hidden="true" className="mt-0.5 shrink-0 text-base leading-none">
        {NOTIFICATION_KIND_ICONS[item.kind] ?? "🔔"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p
            className={`text-sm leading-5 ${
              critical
                ? "font-bold text-red-900"
                : unread
                  ? "font-semibold text-slate-900"
                  : "text-slate-700"
            }`}
          >
            {item.title}
          </p>
          {unread && (
            <span
              aria-hidden="true"
              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${critical ? "bg-red-600" : "bg-amber-500"}`}
            />
          )}
        </div>
        {item.body && (
          <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-slate-600">{item.body}</p>
        )}
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-400">
          <span className={critical ? "font-semibold text-red-700" : ""}>
            {labelOf(NOTIFICATION_KIND_LABELS, item.kind)}
          </span>
          <span aria-hidden="true">·</span>
          <time dateTime={item.sentAt ?? item.createdAt ?? undefined}>
            {fmtRelativeTime(item.sentAt ?? item.createdAt)}
          </time>
        </p>
      </div>
    </div>
  );

  // Hedefi çözülemeyen bildirim tıklanabilir GÖSTERİLMEZ (bkz. notificationHref):
  // kaynak silinmiş olabilir ve boşluğa götüren bir bağlantı güveni bozar.
  if (!item.href) {
    return (
      <li>
        <button
          type="button"
          onClick={onRead}
          className="block w-full text-left transition-colors hover:bg-slate-50"
        >
          {inner}
        </button>
      </li>
    );
  }

  return (
    <li>
      <Link
        href={item.href}
        onClick={() => {
          onRead();
          onNavigate();
        }}
        className="block transition-colors hover:bg-slate-50"
      >
        {inner}
      </Link>
    </li>
  );
}
