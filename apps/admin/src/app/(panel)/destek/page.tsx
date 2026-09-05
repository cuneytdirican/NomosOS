"use client";

/**
 * DESTEK TALEPLERİ — GET /support-tickets, GET/PATCH /support-tickets/:id, POST /support-tickets/:id/messages
 *
 * FAZ 8C: kiracı bürolardan gelen destek talepleri + SLA ilk yanıt sayacı (Kritik 2 sa · Yüksek 8 sa ·
 * Normal 24 sa · Düşük 72 sa). Kamuya açık yanıt SLA'yı durdurur; iç not durdurmaz ve kiracıya görünmez.
 * Yanıt/durum `support.tickets.update` ister (SUPPORT_AGENT dahil); her mutasyon PlatformAuditLog'a yazılır.
 */

import { useState } from "react";
import { useResource } from "@/lib/useResource";
import { useAdminSession } from "@/lib/session";
import { adminApi, errorMessage } from "@/lib/api";
import { EP } from "@/lib/endpoints";
import { canMutate } from "@/lib/rbac";
import { PageGate } from "@/components/RoleGate";
import {
  Badge,
  Button,
  Card,
  InfoBox,
  PageHeader,
  ResourceView,
  Select,
  Table,
  Textarea,
  type Column,
} from "@/components/ui";
import {
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_PRIORITIES,
  SUPPORT_PRIORITY_LABELS,
  SUPPORT_STATUSES,
  SUPPORT_STATUS_LABELS,
  type SupportCategory,
  type SupportPriority,
  type SupportSla,
  type SupportStatus,
} from "@nomosos/shared";

interface TicketRow {
  id: string;
  tenantId: string;
  tenantName: string;
  subject: string;
  category: SupportCategory;
  priority: SupportPriority;
  status: SupportStatus;
  assignedPlatformUserId: string | null;
  createdAt: string;
  lastMessageAt: string;
  sla: SupportSla;
}

interface TicketMessage {
  id: string;
  authorKind: "KIRACI" | "PLATFORM";
  authorName: string;
  body: string;
  internal: boolean;
  createdAt: string;
}

interface TicketsZarf {
  items: TicketRow[];
  acik: number;
  slaIhlal: number;
  yanitBekleyen: number;
}

type TicketDetail = TicketRow & { messages: TicketMessage[] };

const STATUS_TONES: Record<SupportStatus, "blue" | "green" | "yellow" | "gray"> = {
  ACIK: "blue",
  YANITLANDI: "green",
  MUSTERI_BEKLENIYOR: "yellow",
  COZULDU: "green",
  KAPALI: "gray",
};

const PRIORITY_TONES: Record<SupportPriority, "gray" | "blue" | "yellow" | "red"> = {
  DUSUK: "gray",
  NORMAL: "blue",
  YUKSEK: "yellow",
  KRITIK: "red",
};

function slaBadge(s: SupportSla) {
  if (s.state === "ZAMANINDA") return <Badge tone="green">Zamanında</Badge>;
  if (s.state === "GEC") return <Badge tone="yellow">Geç yanıt</Badge>;
  if (s.state === "IHLAL") return <Badge tone="red">SLA aşıldı · {Math.abs(s.remainingMinutes ?? 0)} dk</Badge>;
  const m = s.remainingMinutes ?? 0;
  return <Badge tone={m < 60 ? "yellow" : "gray"}>{m >= 120 ? `${Math.round(m / 60)} sa kaldı` : `${m} dk kaldı`}</Badge>;
}

export default function DestekPage() {
  return (
    <PageGate action="support.tickets.view">
      <Destek />
    </PageGate>
  );
}

function Destek() {
  const { role } = useAdminSession();
  const [status, setStatus] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);

  const res = useResource<TicketsZarf>(EP.supportTickets.list, { query: { status: status || undefined } });
  const detail = useResource<TicketDetail>(selectedId ? EP.supportTickets.detail(selectedId) : null);
  const rows = res.data?.items ?? [];
  const mutable = canMutate(role, "support.tickets.update");

  async function send() {
    if (!selectedId || !reply.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi(EP.supportTickets.messages(selectedId), { method: "POST", body: { body: reply, internal } });
      setReply("");
      detail.reload();
      res.reload();
    } catch (err) {
      setError(errorMessage(err, "Yanıt gönderilemedi."));
    } finally {
      setBusy(false);
    }
  }

  async function patch(body: Record<string, unknown>) {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi(EP.supportTickets.detail(selectedId), { method: "PATCH", body });
      detail.reload();
      res.reload();
    } catch (err) {
      setError(errorMessage(err, "Güncellenemedi."));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<TicketRow>[] = [
    {
      key: "col_1", header: "Büro / konu",
      render: (r) => (
        <div>
          <p className="font-medium text-steel-100">{r.subject}</p>
          <p className="text-xs text-steel-500">{r.tenantName} · {SUPPORT_CATEGORY_LABELS[r.category]}</p>
        </div>
      ),
    },
    { key: "col_2", header: "Öncelik", render: (r) => <Badge tone={PRIORITY_TONES[r.priority]}>{SUPPORT_PRIORITY_LABELS[r.priority]}</Badge> },
    { key: "col_3", header: "Durum", render: (r) => <Badge tone={STATUS_TONES[r.status]}>{SUPPORT_STATUS_LABELS[r.status]}</Badge> },
    { key: "col_4", header: "SLA (ilk yanıt)", render: (r) => slaBadge(r.sla) },
    {
      key: "col_5", header: "Açılış",
      render: (r) => <span className="whitespace-nowrap text-sm text-steel-300">{new Date(r.createdAt).toLocaleString("tr-TR")}</span>,
    },
  ];

  const t = detail.data;

  return (
    <div>
      <PageHeader
        title="Destek Talepleri"
        description="Kiracı bürolardan gelen talepler ve SLA ilk yanıt sayacı. Kamuya açık yanıt sayacı durdurur; iç not kiracıya görünmez."
        action={
          <div className="flex items-center gap-2">
            <Select aria-label="Durum süzgeci" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Tümü</option>
              {SUPPORT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {SUPPORT_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
            {res.data && (
              <span className="text-sm text-slate-500" data-testid="destek-ozet">
                {res.data.yanitBekleyen} yanıt bekliyor · {res.data.slaIhlal} SLA aşımı · {res.data.acik} açık
              </span>
            )}
          </div>
        }
      />

      {error && (
        <InfoBox title="Hata">
          <p className="text-sm text-red-600">{error}</p>
        </InfoBox>
      )}

      <ResourceView
        loading={res.loading}
        missing={res.missing}
        forbidden={res.forbidden}
        error={res.error}
        empty={res.loaded && rows.length === 0}
        endpoint={res.endpoint}
        what="Destek talepleri"
        emptyMessage="Bu süzgeçte destek talebi yok."
      >
        <Table<TicketRow>
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          onRowClick={(r) => setSelectedId(r.id)}
          rowClassName={(r) => (r.id === selectedId ? "bg-steel-900/60" : "")}
          empty="Bu süzgeçte destek talebi yok."
        />
      </ResourceView>

      {selectedId && (
        <div className="mt-6">
          <Card
            title={t ? `${t.subject} — ${t.tenantName}` : "Talep"}
            subtitle={t ? `${SUPPORT_CATEGORY_LABELS[t.category]} · açılış ${new Date(t.createdAt).toLocaleString("tr-TR")} · hedef ${new Date(t.sla.dueAt).toLocaleString("tr-TR")}` : undefined}
          >
            {!t ? (
              <p className="text-sm text-steel-500">Yükleniyor…</p>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  {slaBadge(t.sla)}
                  <Badge tone={STATUS_TONES[t.status]}>{SUPPORT_STATUS_LABELS[t.status]}</Badge>
                  {mutable && (
                    <>
                      <Select aria-label="Durum" value={t.status} disabled={busy} onChange={(e) => void patch({ status: e.target.value })}>
                        {SUPPORT_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {SUPPORT_STATUS_LABELS[s]}
                          </option>
                        ))}
                      </Select>
                      <Select aria-label="Öncelik" value={t.priority} disabled={busy} onChange={(e) => void patch({ priority: e.target.value })}>
                        {SUPPORT_PRIORITIES.map((p) => (
                          <option key={p} value={p}>
                            {SUPPORT_PRIORITY_LABELS[p]}
                          </option>
                        ))}
                      </Select>
                      {!t.assignedPlatformUserId && (
                        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void patch({ assignedPlatformUserId: "me" })}>
                          Üstlen
                        </Button>
                      )}
                    </>
                  )}
                </div>
                <ul className="space-y-2" data-testid="destek-mesajlar">
                  {t.messages.map((m) => (
                    <li key={m.id} className={`rounded-lg border px-3 py-2 text-sm ${m.internal ? "border-amber-700/50 bg-amber-950/30" : m.authorKind === "PLATFORM" ? "border-emerald-800/60 bg-emerald-950/30" : "border-steel-800 bg-steel-950/60"}`}>
                      <p className="text-xs text-steel-500">
                        {m.authorKind === "PLATFORM" ? `Platform · ${m.authorName}` : `Büro · ${m.authorName}`}
                        {m.internal ? " · İÇ NOT" : ""} · {new Date(m.createdAt).toLocaleString("tr-TR")}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-steel-100">{m.body}</p>
                    </li>
                  ))}
                </ul>
                {mutable ? (
                  <div className="space-y-2">
                    <Textarea rows={3} placeholder="Yanıt…" value={reply} onChange={(e) => setReply(e.target.value)} data-testid="destek-yanit" />
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-2 text-sm text-steel-300">
                        <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> İç not (kiracıya görünmez, SLA'yı durdurmaz)
                      </label>
                      <Button size="sm" disabled={busy || !reply.trim()} onClick={() => void send()} data-testid="destek-gonder">
                        Gönder
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-steel-500">Yalnız okuma</p>
                )}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
