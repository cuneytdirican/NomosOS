"use client";

/**
 * Portal ana sayfası — hoş geldiniz + dört kart.
 *
 * VERİ KAYNAĞI: önce tek istekle `GET /portal/dashboard` denenir. Bu uç henüz
 * yoksa (ya da erişilemiyorsa) kartlar tek tek kendi listelerinden beslenir.
 * Böylece portal, Portal-API tarafı özet ucunu yazmadan önce de çalışır.
 *
 * PARA ARİTMETİĞİ YOKTUR. Açık bakiye yalnızca sunucu gönderirse yazılır;
 * gelmezse "bekleyen fatura sayısı" gösterilir. Fatura toplamı istemcide
 * ASLA hesaplanmaz (ürün ilkesi: para hesapları deterministik ve sunucuda).
 */

import Link from "next/link";
import {
  fmtDate,
  fmtDateTime,
  fmtMoney,
  plain,
  relativeDayLabel,
  HEARING_TYPE_PLAIN,
} from "@/lib/labels";
import { EP } from "@/lib/endpoints";
import { isFromClient, messageTime } from "@/lib/messages";
import { useListResource, useResource } from "@/lib/useResource";
import { usePortalSession } from "@/lib/session";
import type {
  DashboardSummary,
  PaymentsResponse,
  PortalCase,
  PortalHearing,
  PortalMessage,
} from "@/lib/types";
import { Card, PrivacyNote, StatCard } from "@/components/ui";
import { TermText } from "@/components/Term";

/** Kapanmış sayılan dosya durumları — "aktif dosyalarım" sayımından düşer. */
const CLOSED_STATUSES = new Set(["KAPANDI", "ARSIV"]);
/** Ödemesi tamamlanmamış sayılan fatura durumları. */
const OPEN_INVOICE_STATUSES = new Set(["GONDERILDI", "KISMI_ODENDI"]);

export default function PortalHomePage() {
  const { user } = usePortalSession();

  const summary = useResource<DashboardSummary>(EP.dashboard);
  // Özet ucu yoksa kartlar kendi listelerinden beslenir.
  const fallback = summary.missing;

  const cases = useListResource<PortalCase>(fallback ? EP.cases : null);
  const hearings = useListResource<PortalHearing>(fallback ? EP.hearings : null);
  const payments = useResource<PaymentsResponse>(fallback ? EP.payments : null);
  const messages = useListResource<PortalMessage>(fallback ? EP.messages : null);

  const s = summary.data;

  // ---- Aktif dosya sayısı ----
  const activeCases =
    s?.activeCaseCount ??
    (cases.loaded
      ? cases.data.filter((c) => !CLOSED_STATUSES.has(c.status ?? "")).length
      : null);

  // ---- Yaklaşan duruşma ----
  const nextHearing = s?.nextHearing ?? (hearings.loaded ? pickNextHearing(hearings.data) : null);

  // ---- Ödeme durumu ----
  const balanceRaw = s?.openBalance ?? payments.data?.openBalance ?? payments.data?.balance;
  const currency = payments.data?.currency ?? "TRY";
  const balanceLabel = fmtMoney(balanceRaw ?? null, currency);
  const openInvoiceCount =
    s?.openInvoiceCount ??
    (payments.loaded
      ? (payments.data?.invoices ?? []).filter((i) =>
          OPEN_INVOICE_STATUSES.has(i.status ?? ""),
        ).length
      : null);

  // ---- Avukattan mesaj ----
  const lastOfficeMessage = messages.loaded ? pickLastOfficeMessage(messages.data) : null;
  const lastMessageAt = s?.lastMessageAt ?? lastOfficeMessage?.createdAt ?? lastOfficeMessage?.sentAt;
  const unread = s?.unreadMessageCount ?? null;

  const clientName = s?.clientName ?? user?.clientName;
  const greetName = user?.fullName ?? clientName;

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-serif text-[1.75rem] font-semibold leading-tight text-ink sm:text-[2rem]">
          {greetName ? `Hoş geldiniz, ${greetName}` : "Hoş geldiniz"}
        </h1>
        <p className="mt-2 max-w-reading text-[15px] leading-relaxed text-ink-soft">
          Dosyalarınızın durumunu, yaklaşan duruşmalarınızı, paylaşılan belgeleri ve
          ödemelerinizi buradan takip edebilirsiniz.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Dosyalarım"
          href="/dosyalarim"
          value={
            activeCases === null
              ? "—"
              : activeCases === 0
                ? "Paylaşılan dosya yok"
                : `${activeCases} aktif dosya`
          }
          hint={
            activeCases === 0
              ? "Avukatınız henüz sizinle bir dosya paylaşmadı."
              : "Dosyalarınızın güncel durumunu görmek için dokunun."
          }
        />

        <StatCard
          label="Yaklaşan duruşmam"
          href="/durusmalarim"
          emphasis={Boolean(nextHearing)}
          value={
            nextHearing
              ? (fmtDate(nextHearing.scheduledAt ?? nextHearing.date) ?? "Tarihi belirlenecek")
              : "Planlanmış duruşma yok"
          }
          hint={
            nextHearing ? (
              <>
                {plain(HEARING_TYPE_PLAIN, nextHearing.type, "Duruşma")}
                {nextHearing.courtName || nextHearing.court
                  ? ` · ${nextHearing.courtName ?? nextHearing.court}`
                  : ""}
                {relativeDayLabel(nextHearing.scheduledAt ?? nextHearing.date)
                  ? ` · ${relativeDayLabel(nextHearing.scheduledAt ?? nextHearing.date)}`
                  : ""}
              </>
            ) : (
              "Yeni bir duruşma günü verildiğinde burada görünür."
            )
          }
        />

        <StatCard
          label="Bekleyen ödemem"
          href="/odemelerim"
          value={
            balanceLabel ??
            (openInvoiceCount === null
              ? "—"
              : openInvoiceCount === 0
                ? "Bekleyen ödeme yok"
                : `${openInvoiceCount} fatura bekliyor`)
          }
          hint={
            balanceLabel
              ? "Ödenmemiş toplam tutarınız."
              : openInvoiceCount && openInvoiceCount > 0
                ? "Tutar ve vade ayrıntıları Ödemelerim sayfasında."
                : "Ödemeleriniz güncel görünüyor."
          }
        />

        <StatCard
          label="Avukatımdan mesaj"
          href="/mesajlar"
          value={
            unread && unread > 0
              ? `${unread} yeni mesaj`
              : lastMessageAt
                ? "Yazışmanız güncel"
                : "Henüz mesaj yok"
          }
          hint={
            lastMessageAt
              ? `Son mesaj: ${fmtDateTime(lastMessageAt) ?? "—"}`
              : "Avukatınıza buradan yazabilirsiniz."
          }
        />
      </div>

      {lastOfficeMessage?.body && (
        <Card
          title="Avukatınızdan son mesaj"
          className="mt-6"
          action={
            <Link
              href="/mesajlar"
              className="text-sm font-medium text-gold-deep underline underline-offset-4"
            >
              Tüm mesajlar
            </Link>
          }
        >
          <p className="max-w-reading text-[15px] leading-relaxed text-ink">
            <TermText text={trim(lastOfficeMessage.body, 320)} />
          </p>
        </Card>
      )}

      <div className="mt-8">
        <PrivacyNote />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

/** Bugünden sonraki en yakın duruşma; yoksa null. İptal edilenler atlanır. */
function pickNextHearing(rows: PortalHearing[]): PortalHearing | null {
  const now = Date.now();
  const upcoming = rows
    .filter((h) => h.status !== "IPTAL")
    .map((h) => ({ h, t: new Date(h.scheduledAt ?? h.date ?? "").getTime() }))
    .filter((x) => Number.isFinite(x.t) && x.t >= now)
    .sort((a, b) => a.t - b.t);
  return upcoming.length > 0 ? upcoming[0].h : null;
}

/** Büronun gönderdiği en son mesaj. */
function pickLastOfficeMessage(rows: PortalMessage[]): PortalMessage | null {
  const fromOffice = rows
    .filter((m) => !isFromClient(m))
    .map((m) => ({ m, t: messageTime(m) }))
    .filter((x) => x.t > 0)
    .sort((a, b) => b.t - a.t);
  return fromOffice.length > 0 ? fromOffice[0].m : null;
}

function trim(value: string, max: number): string {
  const v = value.trim();
  return v.length > max ? `${v.slice(0, max)}…` : v;
}
