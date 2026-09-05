"use client";

/**
 * Ayarlar → KVKK (Enterprise++): saklama/imha politikası + veri öznesi talepleri.
 *
 * Hukuki çerçeve: Av. K. m.39 saklama (kapanış + N yıl), KVKK m.7 (saklama
 * yükümlülüğü varsa gerekçeli ret), m.13/2 (30 gün yanıt). OTOMATİK SİLME YOK —
 * imha adayları listelenir, imhayı yönetici gerekçeyle uygular. ADMIN/PARTNER.
 */

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, asList } from "@/lib/api";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Modal, Select, Spinner, SuccessBox, Textarea } from "@/components/ui";

interface RetentionReport {
  retentionYears: number;
  cutoff: string;
  candidates: Array<{
    id: string;
    title: string;
    fileNumber: string | null;
    closedAt: string | null;
    client: { id: string; name: string } | null;
    documentCount: number;
  }>;
  anonymizedCount: number;
  openRequests: number;
  overdueRequests: number;
}

interface KvkkRequestRow {
  id: string;
  type: string;
  status: "ACIK" | "YANITLANDI" | "REDDEDILDI";
  subject: string;
  requestedAt: string;
  dueAt: string;
  decision: string | null;
  respondedAt: string | null;
  overdue: boolean;
  client: { id: string; name: string };
}

interface Policy {
  retentionYears: number;
  canEdit: boolean;
}

const fmt = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString("tr-TR") : "—");

export default function KvkkPage() {
  const [report, setReport] = useState<RetentionReport | null>(null);
  const [requests, setRequests] = useState<KvkkRequestRow[]>([]);
  const [types, setTypes] = useState<Record<string, string>>({});
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [anonTarget, setAnonTarget] = useState<RetentionReport["candidates"][number] | null>(null);
  const [anonReason, setAnonReason] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ clientId: "", type: "ERISIM", subject: "", requestedAt: "" });
  const [respondTarget, setRespondTarget] = useState<KvkkRequestRow | null>(null);
  const [respond, setRespond] = useState<{ status: "YANITLANDI" | "REDDEDILDI"; decision: string }>({ status: "YANITLANDI", decision: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, q, p] = await Promise.all([
        api<RetentionReport>("/security/kvkk/retention"),
        api<{ items: KvkkRequestRow[]; types: Record<string, string> }>("/security/kvkk/requests"),
        api<Policy>("/security/policy").catch(() => null),
      ]);
      setReport(r);
      setRequests(q.items);
      setTypes(q.types);
      setPolicy(p);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof ApiError ? err.message : "KVKK bilgileri yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!createOpen || clients.length > 0) return;
    void api<unknown>("/clients", { query: { limit: 200 } })
      .then((rows) => setClients(asList<{ id: string; name: string }>(rows)))
      .catch(() => undefined);
  }, [createOpen, clients.length]);

  async function saveRetention(years: number) {
    setBusy(true);
    setError(null);
    try {
      await api("/security/policy", { method: "PATCH", body: { retentionYears: years } });
      setNotice(`Saklama süresi ${years} yıl olarak kaydedildi.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Politika kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  }

  async function anonymize() {
    if (!anonTarget) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ documents: number; chunks: number; storageFailures: number }>(
        `/security/kvkk/retention/cases/${anonTarget.id}/anonymize`,
        { method: "POST", body: { reason: anonReason } },
      );
      setAnonTarget(null);
      setAnonReason("");
      setNotice(`İmha uygulandı: ${res.documents} belge, ${res.chunks} RAG parçası silindi${res.storageFailures ? ` (${res.storageFailures} depo nesnesi silinemedi — denetim izinde)` : ""}. Künye ve safahat korundu.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "İmha uygulanamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function createRequest() {
    setBusy(true);
    setError(null);
    try {
      await api("/security/kvkk/requests", {
        method: "POST",
        body: {
          clientId: form.clientId,
          type: form.type,
          subject: form.subject.trim(),
          ...(form.requestedAt ? { requestedAt: form.requestedAt } : {}),
        },
      });
      setCreateOpen(false);
      setForm({ clientId: "", type: "ERISIM", subject: "", requestedAt: "" });
      setNotice("Talep kaydedildi; yasal yanıt süresi 30 gündür.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Talep kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  }

  async function respondRequest() {
    if (!respondTarget) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/security/kvkk/requests/${respondTarget.id}/respond`, { method: "POST", body: respond });
      setRespondTarget(null);
      setRespond({ status: "YANITLANDI", decision: "" });
      setNotice("Yanıt kaydedildi ve denetim izine yazıldı.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Yanıt kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner label="KVKK bilgileri yükleniyor…" />;
  if (forbidden) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-900">KVKK</h1>
        <Card>
          <p className="p-5 text-sm text-slate-600">
            KVKK yönetimi <strong>Ortak</strong> ve <strong>Yönetici</strong> rollerine açıktır.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">KVKK — Saklama, İmha ve Talepler</h1>
          <p className="mt-1 text-sm text-slate-500">
            Dosyalar kapanıştan itibaren saklama süresi boyunca tutulur (Av. K. m.39). Süresi dolan dosyalar imha
            <strong> adayı</strong> olur; hiçbir veri otomatik silinmez. Veri öznesi taleplerine 30 gün içinde gerekçeli yanıt verilir.
          </p>
        </div>
        <Button variant="gold" onClick={() => setCreateOpen(true)}>
          + KVKK Talebi
        </Button>
      </div>

      {notice && <SuccessBox message={notice} />}
      {error && <ErrorBox message={error} />}

      <div className="grid gap-4 sm:grid-cols-4">
        <Card title="Saklama süresi">
          <div className="flex items-center gap-2">
            <Select
              value={String(report?.retentionYears ?? 10)}
              disabled={!policy?.canEdit || busy}
              onChange={(e) => void saveRetention(Number(e.target.value))}
            >
              {[10, 15, 20, 25, 30].map((y) => (
                <option key={y} value={y}>
                  {y} yıl
                </option>
              ))}
            </Select>
          </div>
          <p className="mt-1 text-xs text-slate-500">kapanıştan itibaren; asgari 10 yıl{!policy?.canEdit && " · yalnız yönetici değiştirir"}</p>
        </Card>
        <Card title="İmha adayı">
          <p className="text-3xl font-semibold text-slate-900">{report?.candidates.length ?? 0}</p>
          <p className="text-xs text-slate-500">kapanış {fmt(report?.cutoff)} öncesi KAPANDI dosya</p>
        </Card>
        <Card title="İmha uygulanan">
          <p className="text-3xl font-semibold text-slate-900">{report?.anonymizedCount ?? 0}</p>
          <p className="text-xs text-slate-500">belgeleri silinmiş dosya (künye korunur)</p>
        </Card>
        <Card title="Açık talep">
          <p className="text-3xl font-semibold text-slate-900">{report?.openRequests ?? 0}</p>
          <p className="text-xs text-slate-500">{report?.overdueRequests ? <span className="text-red-600">{report.overdueRequests} tanesinin süresi geçti</span> : "yasal süre 30 gün"}</p>
        </Card>
      </div>

      <Card title="İmha adayları (saklama süresi dolan kapanmış dosyalar)">
        {!report || report.candidates.length === 0 ? (
          <EmptyState message="Saklama süresi dolan dosya yok." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">Dosya</th>
                  <th className="px-3 py-2 font-medium">Müvekkil</th>
                  <th className="px-3 py-2 font-medium">Kapanış</th>
                  <th className="px-3 py-2 font-medium">Belge</th>
                  <th className="px-3 py-2 font-medium">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.candidates.map((c) => (
                  <tr key={c.id}>
                    <td className="px-3 py-2">
                      <p className="font-medium text-slate-900">{c.title}</p>
                      <p className="text-xs text-slate-500">{c.fileNumber ?? "—"}</p>
                    </td>
                    <td className="px-3 py-2 text-slate-700">{c.client?.name ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-700">{fmt(c.closedAt)}</td>
                    <td className="px-3 py-2 text-slate-700">{c.documentCount}</td>
                    <td className="px-3 py-2">
                      <Button size="sm" variant="danger" disabled={!policy?.canEdit || busy} onClick={() => { setAnonTarget(c); setAnonReason(""); }}>
                        İmha et
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Veri öznesi talepleri">
        {requests.length === 0 ? (
          <EmptyState message="Kayıtlı KVKK talebi yok." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">Müvekkil</th>
                  <th className="px-3 py-2 font-medium">Tür</th>
                  <th className="px-3 py-2 font-medium">Konu</th>
                  <th className="px-3 py-2 font-medium">Talep / Son yanıt</th>
                  <th className="px-3 py-2 font-medium">Durum</th>
                  <th className="px-3 py-2 font-medium">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {requests.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="px-3 py-2 text-slate-900">{r.client.name}</td>
                    <td className="px-3 py-2 text-xs text-slate-700">{types[r.type] ?? r.type}</td>
                    <td className="max-w-md px-3 py-2 text-xs text-slate-700">
                      {r.subject}
                      {r.decision && <p className="mt-1 text-slate-500">Yanıt: {r.decision}</p>}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-700">
                      {fmt(r.requestedAt)} → <span className={r.overdue ? "font-semibold text-red-600" : ""}>{fmt(r.dueAt)}</span>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={r.status === "ACIK" ? (r.overdue ? "danger" : "gold") : r.status === "YANITLANDI" ? "green" : "gray"}>
                        {r.status === "ACIK" ? (r.overdue ? "Süresi geçti" : "Açık") : r.status === "YANITLANDI" ? "Yanıtlandı" : "Reddedildi"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      {r.status === "ACIK" && (
                        <Button size="sm" variant="secondary" onClick={() => { setRespondTarget(r); setRespond({ status: "YANITLANDI", decision: "" }); }}>
                          Yanıtla
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={!!anonTarget} onClose={() => setAnonTarget(null)} title="KVKK imhası">
        {anonTarget && (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              <strong>{anonTarget.title}</strong> dosyasının {anonTarget.documentCount} belgesi ve RAG parçaları silinecek. Künye, safahat ve
              denetim izi korunur. Bu işlem geri alınamaz.
            </p>
            <Field label="Gerekçe (zorunlu, denetim izine yazılır)">
              <Textarea rows={3} value={anonReason} onChange={(e) => setAnonReason(e.target.value)} placeholder="Saklama süresi doldu; müvekkil talebi yok / talep karşılandı…" />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setAnonTarget(null)}>Vazgeç</Button>
              <Button variant="danger" disabled={busy || anonReason.trim().length < 10} onClick={() => void anonymize()}>
                {busy ? "Uygulanıyor…" : "İmhayı uygula"}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="KVKK talebi kaydet">
        <div className="space-y-3">
          <Field label="Müvekkil">
            <Select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}>
              <option value="">Müvekkil seçin…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Talep türü">
              <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {Object.entries(types).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Talep tarihi (boşsa bugün)">
              <Input type="date" value={form.requestedAt} onChange={(e) => setForm({ ...form, requestedAt: e.target.value })} />
            </Field>
          </div>
          <Field label="Konu">
            <Textarea rows={3} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Müvekkil hangi veriyi, ne talep ediyor?" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Vazgeç</Button>
            <Button variant="gold" disabled={busy || !form.clientId || form.subject.trim().length < 3} onClick={() => void createRequest()}>
              {busy ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!respondTarget} onClose={() => setRespondTarget(null)} title="Talebe yanıt">
        {respondTarget && (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              <strong>{respondTarget.client.name}</strong> — {types[respondTarget.type] ?? respondTarget.type}
            </p>
            <Field label="Sonuç">
              <Select value={respond.status} onChange={(e) => setRespond({ ...respond, status: e.target.value as "YANITLANDI" | "REDDEDILDI" })}>
                <option value="YANITLANDI">Yerine getirildi / yanıtlandı</option>
                <option value="REDDEDILDI">Gerekçeli ret (örn. Av. K. m.39 saklama yükümlülüğü)</option>
              </Select>
            </Field>
            <Field label="Yanıt / gerekçe (zorunlu)">
              <Textarea rows={4} value={respond.decision} onChange={(e) => setRespond({ ...respond, decision: e.target.value })} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setRespondTarget(null)}>Vazgeç</Button>
              <Button variant="gold" disabled={busy || respond.decision.trim().length < 10} onClick={() => void respondRequest()}>
                {busy ? "Kaydediliyor…" : "Kaydet"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
