"use client";

/**
 * Yapılacaklar — büronun sizden istedikleri (belge, imza, bilgi). Tamamlayınca büro bilgilenir.
 */

import { useState } from "react";
import { EP } from "@/lib/endpoints";
import { errorMessage, portalApi } from "@/lib/api";
import { useListResource } from "@/lib/useResource";
import { Badge, Button, Card, ErrorBox, PageHeader, PrivacyNote, ResourceView, SuccessBox, Textarea } from "@/components/ui";

interface Todo {
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

function fmt(d: string | null): string {
  return d ? new Date(d).toLocaleDateString("tr-TR") : "—";
}

export default function YapilacaklarPage() {
  const todos = useListResource<Todo>(EP.todos);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function complete(t: Todo) {
    setBusy(t.id);
    setError(null);
    try {
      await portalApi(EP.todoComplete(t.id), { method: "POST", body: { note: notes[t.id]?.trim() || null } });
      setNotice(`"${t.title}" tamamlandı olarak işaretlendi; büronuz bilgilendirildi.`);
      todos.reload();
    } catch (err) {
      setError(errorMessage(err, "İşaretlenemedi."));
    } finally {
      setBusy(null);
    }
  }

  const open = todos.data.filter((t) => t.status === "ACIK");
  const done = todos.data.filter((t) => t.status === "TAMAMLANDI");

  return (
    <div>
      <PageHeader title="Yapılacaklar" description="Avukatınızın sizden istediği belge, imza ve bilgiler. Tamamladığınızda kısa bir not bırakabilirsiniz." />
      {notice && <SuccessBox>{notice}</SuccessBox>}
      {error && <ErrorBox message={error} />}
      <ResourceView
        loading={todos.loading}
        missing={todos.missing}
        forbidden={todos.forbidden}
        error={todos.error}
        empty={todos.empty}
        endpoint={todos.endpoint}
        onRetry={todos.reload}
        loadingLabel="İstekler getiriliyor…"
        emptyMessage="Şu anda sizden beklenen bir işlem yok."
        emptyHint="Avukatınız bir belge ya da bilgi istediğinde burada görünür."
      >
        <div className="space-y-6">
          <Card title="Bekleyenler" subtitle={`${open.length} istek`}>
            {open.length === 0 ? (
              <p className="text-sm text-slate-500">Bekleyen istek yok.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {open.map((t) => (
                  <li key={t.id} className="py-3" data-testid="portal-yapilacak">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-slate-900">{t.title}</p>
                        {t.description && <p className="mt-0.5 text-sm text-slate-600">{t.description}</p>}
                        <p className="mt-1 text-xs text-slate-500">
                          {t.caseTitle ? `${t.caseFileNumber ? `${t.caseFileNumber} — ` : ""}${t.caseTitle} · ` : ""}
                          {t.dueDate ? `Son tarih: ${fmt(t.dueDate)}` : `İstendi: ${fmt(t.createdAt)}`}
                        </p>
                      </div>
                      {t.dueDate && new Date(t.dueDate).getTime() < Date.now() && <Badge tone="alert">Süresi geçti</Badge>}
                    </div>
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      <div className="min-w-[240px] flex-1">
                        <Textarea rows={2} placeholder="Not (isteğe bağlı): ör. belgeyi portaldan yükledim" value={notes[t.id] ?? ""} onChange={(e) => setNotes({ ...notes, [t.id]: e.target.value })} />
                      </div>
                      <Button disabled={busy === t.id} onClick={() => void complete(t)}>
                        {busy === t.id ? "İşleniyor…" : "Tamamladım"}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {done.length > 0 && (
            <Card title="Tamamlananlar" subtitle={`${done.length} istek`}>
              <ul className="divide-y divide-slate-100">
                {done.map((t) => (
                  <li key={t.id} className="py-2 text-sm">
                    <span className="font-medium text-slate-800">{t.title}</span>
                    <span className="text-slate-500"> · {fmt(t.completedAt)}</span>
                    {t.completedNote && <p className="text-xs text-slate-500">Notunuz: {t.completedNote}</p>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </ResourceView>
      <div className="mt-8">
        <PrivacyNote />
      </div>
    </div>
  );
}
