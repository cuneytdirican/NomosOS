"use client";

/**
 * Ayarlar → Destek (Faz 8C): büro destek talepleri. Talep aç, yanıtları oku, cevap yaz, kapat.
 * SLA ilk yanıt hedefi önceliğe göre (Kritik 2 sa · Yüksek 8 sa · Normal 24 sa · Düşük 72 sa).
 */

import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_PRIORITIES,
  SUPPORT_PRIORITY_LABELS,
  SUPPORT_SLA_HOURS,
  SUPPORT_STATUS_LABELS,
  SUPPORT_TICKET_ROUTES,
  type SupportCategory,
  type SupportPriority,
  type SupportSla,
  type SupportStatus,
} from "@nomosos/shared";
import { Badge, Button, Card, ErrorBox, Input, Select, SuccessBox, Textarea } from "@/components/ui";
import { fmtDateTime } from "@/lib/labels";

interface TicketRow {
  id: string;
  subject: string;
  category: SupportCategory;
  priority: SupportPriority;
  status: SupportStatus;
  createdAt: string;
  lastMessageAt: string;
  sla: SupportSla;
}

interface TicketMessage {
  id: string;
  authorKind: "KIRACI" | "PLATFORM";
  authorName: string;
  body: string;
  createdAt: string;
}

type TicketDetail = TicketRow & { messages: TicketMessage[] };

const STATUS_TONE: Record<SupportStatus, "gray" | "green" | "yellow" | "red" | "blue"> = {
  ACIK: "blue",
  YANITLANDI: "green",
  MUSTERI_BEKLENIYOR: "yellow",
  COZULDU: "green",
  KAPALI: "gray",
};

function slaText(s: SupportSla): string {
  if (s.state === "ZAMANINDA") return "İlk yanıt zamanında";
  if (s.state === "GEC") return "İlk yanıt geç";
  if (s.state === "IHLAL") return `SLA aşıldı (${Math.abs(s.remainingMinutes ?? 0)} dk)`;
  const m = s.remainingMinutes ?? 0;
  return m >= 120 ? `İlk yanıt hedefi ${Math.round(m / 60)} sa` : `İlk yanıt hedefi ${m} dk`;
}

export default function DestekPage() {
  const [items, setItems] = useState<TicketRow[]>([]);
  const [selected, setSelected] = useState<TicketDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ subject: "", body: "", category: "GENEL" as SupportCategory, priority: "NORMAL" as SupportPriority });
  const [reply, setReply] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await api<{ items: TicketRow[] }>(SUPPORT_TICKET_ROUTES.list);
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Destek talepleri alınamadı.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function openDetail(id: string) {
    setError(null);
    try {
      setSelected(await api<TicketDetail>(SUPPORT_TICKET_ROUTES.detail(id)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Talep açılamadı.");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const t = await api<TicketRow>(SUPPORT_TICKET_ROUTES.create, { method: "POST", body: form });
      setNotice(`Talep açıldı. İlk yanıt hedefi: ${SUPPORT_SLA_HOURS[form.priority]} saat.`);
      setForm({ subject: "", body: "", category: "GENEL", priority: "NORMAL" });
      setShowForm(false);
      await load();
      await openDetail(t.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Talep açılamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function sendReply() {
    if (!selected || !reply.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setSelected(await api<TicketDetail>(SUPPORT_TICKET_ROUTES.message(selected.id), { method: "POST", body: { body: reply } }));
      setReply("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Mesaj gönderilemedi.");
    } finally {
      setBusy(false);
    }
  }

  async function closeTicket() {
    if (!selected || !window.confirm("Talep kapatılsın mı? Kapalı talebe mesaj eklenemez.")) return;
    setBusy(true);
    try {
      setSelected(await api<TicketDetail>(SUPPORT_TICKET_ROUTES.close(selected.id), { method: "POST" }));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Talep kapatılamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Destek</h1>
          <p className="mt-1 text-sm text-slate-500">Platform destek ekibine talep açın. İlk yanıt hedefi: Kritik 2 sa · Yüksek 8 sa · Normal 24 sa · Düşük 72 sa (takvim saati).</p>
        </div>
        <Button variant="gold" onClick={() => setShowForm((v) => !v)} data-testid="destek-yeni">
          {showForm ? "Vazgeç" : "Yeni talep"}
        </Button>
      </div>
      {notice && <SuccessBox message={notice} />}
      {error && <ErrorBox message={error} />}

      {showForm && (
        <Card title="Yeni destek talebi">
          <form onSubmit={(e) => void submit(e)} className="space-y-3">
            <Input placeholder="Konu" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} required minLength={3} maxLength={200} data-testid="destek-konu" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as SupportCategory })} aria-label="Kategori">
                {SUPPORT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {SUPPORT_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </Select>
              <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as SupportPriority })} aria-label="Öncelik" data-testid="destek-oncelik">
                {SUPPORT_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {SUPPORT_PRIORITY_LABELS[p]} · ilk yanıt {SUPPORT_SLA_HOURS[p]} sa
                  </option>
                ))}
              </Select>
            </div>
            <Textarea rows={5} placeholder="Sorunu, hangi ekranda ve ne zaman oluştuğunu yazın. Müvekkil kişisel verisi paylaşmayın." value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} required minLength={3} data-testid="destek-mesaj" />
            <Button type="submit" disabled={busy} data-testid="destek-gonder">
              {busy ? "Gönderiliyor…" : "Talebi gönder"}
            </Button>
          </form>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Card title={`Talepler (${items.length})`}>
          {items.length === 0 ? (
            <p className="text-sm text-slate-500">Henüz destek talebi yok.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {items.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => void openDetail(t.id)} className={`w-full px-1 py-2 text-left hover:bg-slate-50 ${selected?.id === t.id ? "bg-slate-50" : ""}`} data-testid="destek-satir">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-slate-900">{t.subject}</span>
                      <Badge tone={STATUS_TONE[t.status]}>{SUPPORT_STATUS_LABELS[t.status]}</Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {SUPPORT_CATEGORY_LABELS[t.category]} · {SUPPORT_PRIORITY_LABELS[t.priority]} · {fmtDateTime(t.createdAt)} · {slaText(t.sla)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={selected ? selected.subject : "Talep detayı"} action={selected && selected.status !== "KAPALI" ? <Button size="sm" variant="secondary" onClick={() => void closeTicket()} disabled={busy}>Kapat</Button> : undefined}>
          {!selected ? (
            <p className="text-sm text-slate-500">Soldan bir talep seçin.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                {SUPPORT_STATUS_LABELS[selected.status]} · {SUPPORT_PRIORITY_LABELS[selected.priority]} · {slaText(selected.sla)}
              </p>
              <ul className="space-y-2" data-testid="destek-mesajlar">
                {selected.messages.map((m) => (
                  <li key={m.id} className={`rounded-lg px-3 py-2 text-sm ${m.authorKind === "PLATFORM" ? "border border-emerald-200 bg-emerald-50" : "bg-slate-50"}`}>
                    <p className="text-xs text-slate-500">
                      {m.authorKind === "PLATFORM" ? "NomosOS Destek" : m.authorName} · {fmtDateTime(m.createdAt)}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-slate-800">{m.body}</p>
                  </li>
                ))}
              </ul>
              {selected.status !== "KAPALI" && (
                <div className="space-y-2">
                  <Textarea rows={3} placeholder="Yanıt yazın…" value={reply} onChange={(e) => setReply(e.target.value)} data-testid="destek-yanit" />
                  <Button size="sm" onClick={() => void sendReply()} disabled={busy || !reply.trim()}>
                    Gönder
                  </Button>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
