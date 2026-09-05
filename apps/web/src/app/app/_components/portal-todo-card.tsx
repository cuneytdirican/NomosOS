"use client";

/**
 * Müvekkil kartı → Portal: "Müvekkilden istenenler" (PortalTodo) + rıza kayıtları (Faz 7F).
 * Büro istek açar (belge/imza/bilgi); müvekkil portalda tamamlar, notu burada görünür.
 */

import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { PORTAL_TODO_ROUTES } from "@nomosos/shared";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Select, Textarea } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/labels";

interface TodoRow {
  id: string;
  caseId: string | null;
  caseTitle: string | null;
  caseFileNumber: string | null;
  title: string;
  description: string | null;
  dueDate: string | null;
  status: "ACIK" | "TAMAMLANDI" | "IPTAL";
  completedAt: string | null;
  completedNote: string | null;
  createdAt: string;
}

interface ConsentView {
  current: Array<{ kind: string; title: string; accepted: boolean }>;
  history: Array<{ id: string; kind: string; version: string; accepted: boolean; at: string; by: string; email: string; ip: string | null }>;
}

export function PortalTodoCard({ clientId, cases, onNotify }: { clientId: string; cases: Array<{ id: string; title: string; fileNumber?: string | null }>; onNotify: (m: string, tone?: "success" | "error" | "info") => void }) {
  const [rows, setRows] = useState<TodoRow[]>([]);
  const [consents, setConsents] = useState<ConsentView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [caseId, setCaseId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [t, c] = await Promise.all([
        api<{ items: TodoRow[] }>(PORTAL_TODO_ROUTES.adminTodos, { query: { clientId } }),
        api<ConsentView>(PORTAL_TODO_ROUTES.adminConsents, { query: { clientId } }).catch(() => null),
      ]);
      setRows(t.items ?? []);
      setConsents(c);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Portal istekleri yüklenemedi.");
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    try {
      await api(PORTAL_TODO_ROUTES.adminTodos, { method: "POST", body: { clientId, caseId: caseId || null, title: title.trim(), description: description.trim() || null, dueDate: dueDate || null } });
      onNotify("İstek müvekkilin portalına düştü.", "success");
      setTitle("");
      setDescription("");
      setDueDate("");
      await load();
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : "İstek açılamadı.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(row: TodoRow) {
    if (!window.confirm(`"${row.title}" isteği iptal edilsin mi?`)) return;
    setBusy(true);
    try {
      await api(PORTAL_TODO_ROUTES.adminTodoCancel(row.id), { method: "DELETE" });
      await load();
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : "İptal edilemedi.", "error");
    } finally {
      setBusy(false);
    }
  }

  const open = rows.filter((r) => r.status === "ACIK");
  const done = rows.filter((r) => r.status === "TAMAMLANDI");

  return (
    <div className="space-y-6">
      <Card title="Müvekkilden İstenenler" action={<Badge tone={open.length > 0 ? "yellow" : "gray"}>{open.length} açık</Badge>}>
        {error && <ErrorBox message={error} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="İstek">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ör. Kira sözleşmesinin aslını yükleyin" />
          </Field>
          <Field label="Dosya (isteğe bağlı)" hint="Yalnız portalda yayında olan dosya müvekkile görünür.">
            <Select value={caseId} onChange={(e) => setCaseId(e.target.value)}>
              <option value="">Dosyasız</option>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.fileNumber ? `${c.fileNumber} — ` : ""}
                  {c.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Açıklama">
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="Son tarih">
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
        <div className="mt-3">
          <Button variant="gold" size="sm" disabled={busy || title.trim().length < 3} onClick={() => void create()} data-testid="portal-istek-ac">
            Müvekkilden iste
          </Button>
        </div>
        <div className="mt-4">
          {rows.length === 0 ? (
            <EmptyState message="Bu müvekkilden istenen bir şey yok." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {[...open, ...done].map((r) => (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-900">{r.title}</p>
                    <p className="text-xs text-slate-500">
                      {r.caseTitle ? `${r.caseFileNumber ?? r.caseTitle} · ` : ""}
                      {r.dueDate ? `son tarih ${fmtDate(r.dueDate)} · ` : ""}
                      {r.status === "TAMAMLANDI" ? `müvekkil tamamladı ${fmtDateTime(r.completedAt)}` : `açıldı ${fmtDate(r.createdAt)}`}
                    </p>
                    {r.completedNote && <p className="mt-0.5 text-xs text-emerald-800">Müvekkil notu: {r.completedNote}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={r.status === "TAMAMLANDI" ? "green" : "yellow"}>{r.status === "TAMAMLANDI" ? "Tamamlandı" : "Bekliyor"}</Badge>
                    {r.status === "ACIK" && (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void cancel(r)}>
                        İptal
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {consents && (
        <Card title="Rıza ve İzin Kayıtları (KVKK / İYS)" action={<Button size="sm" variant="ghost" onClick={() => setShowHistory((v) => !v)}>{showHistory ? "Geçmişi gizle" : "Geçmiş"}</Button>}>
          <div className="flex flex-wrap gap-2" data-testid="riza-durumu">
            {consents.current.map((c) => (
              <Badge key={c.kind} tone={c.accepted ? "green" : "gray"}>
                {c.title}: {c.accepted ? "onaylı" : "yok"}
              </Badge>
            ))}
          </div>
          {showHistory && (
            <ul className="mt-3 divide-y divide-slate-100 text-xs text-slate-600">
              {consents.history.length === 0 && <li className="py-2">Kayıt yok.</li>}
              {consents.history.map((h) => (
                <li key={h.id} className="py-1.5">
                  {fmtDateTime(h.at)} · {h.kind} {h.version} · {h.accepted ? "KABUL" : "GERİ ÇEKME"} · {h.by} ({h.email}){h.ip ? ` · ${h.ip}` : ""}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11px] text-slate-500">Kayıtlar ekleme-yalnızdır; metin sürümü ve özeti ile birlikte saklanır. İletişim izinleri İYS kaydı için kanıt dosyasıdır.</p>
        </Card>
      )}
    </div>
  );
}
