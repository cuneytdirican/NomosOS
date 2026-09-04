"use client";

/**
 * İÇTİHAT HAVUZ YÖNETİMİ (ai-egitim-stratejisi.md D1) — RAG'ın kamusal
 * tarafını (CaseLawDocument ortak havuzu) platform eliyle doldurma.
 *
 * İçerik güvenliği taahhütleri (sunucu tarafında uygulanır):
 *  - Biçimsiz künye havuza GİREMEZ (şema ön doğrulaması).
 *  - Büronun manuel kaydı (createdByTenantId != null) EZİLMEZ — atlanır.
 *  - İçe aktarılan her parti denetim izine düşer.
 *
 * Bu sayfa yalnız platform yönetimi (aiProvider.view/manage); büro
 * kullanıcıları (avukat/büro) bu uçlara erişemez — Türk hukuku "eğitimi"
 * Super Admin'in tekelidir.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { adminApi, errorMessage } from "@/lib/api";
import { EP } from "@/lib/endpoints";
import { PageGate } from "@/components/RoleGate";
import {
  Badge,
  Button,
  Card,
  Field,
  InfoBox,
  Input,
  Modal,
  PageHeader,
  ResourceView,
  Select,
  Table,
  Textarea,
  type Column,
} from "@/components/ui";

interface PoolStats {
  total: number;
  systemEntered: number;
  tenantEntered: number;
  bySource: { sourceAdapter: string; count: number }[];
  topCourts: { court: string; count: number }[];
}

/** caselaw-ingest — besleme kaynağı. */
interface IngestSource {
  id: string;
  key: string;
  name: string;
  baseUrl: string;
  isEnabled: boolean;
  lastFetchedAt: string | null;
  note: string | null;
  pendingCount: number;
}

/** caselaw-ingest — onay kuyruğu kaydı. */
interface IngestItem {
  id: string;
  sourceKey: string;
  court: string;
  chamber: string | null;
  caseNumber: string;
  decisionNumber: string;
  decisionDate: string | null;
  summary: string | null;
  status: "BEKLIYOR" | "ONAYLANDI" | "REDDEDILDI";
  fetchedAt: string;
  rejectReason: string | null;
  poolRecordId: string | null;
}

interface IngestRunSummary {
  key: string;
  ok: boolean;
  fetched: number;
  queued: number;
  skippedDuplicate: number;
  rejected: number;
  note?: string;
}

interface PoolRecordRow {
  id: string;
  court: string;
  chamber: string | null;
  caseNumber: string;
  decisionNumber: string;
  decisionDate: string | null;
  sourceAdapter: string;
  createdByTenantId: string | null;
  fetchedAt: string;
}

interface ImportResult {
  index: number;
  court: string;
  caseNumber: string;
  decisionNumber: string;
  status: "EKLENDI" | "GUNCELLENDI" | "ATLANDI" | "REDDEDILDI";
  reason?: string;
}

const RESULT_TONES: Record<string, "green" | "blue" | "gray" | "red"> = {
  EKLENDI: "green",
  GUNCELLENDI: "blue",
  ATLANDI: "gray",
  REDDEDILDI: "red",
};

const SAMPLE_JSON = `[
  {
    "court": "Yargıtay 9. Hukuk Dairesi",
    "caseNumber": "2016/1234",
    "decisionNumber": "2017/5678",
    "decisionDate": "2017-06-15",
    "summary": "İş kazasında tazminat sorumluluğu…",
    "sourceUrl": "https://…"
  }
]`;

export default function HavuzPage() {
  return (
    <PageGate action="aiProvider.view">
      <Havuz />
    </PageGate>
  );
}

function Havuz() {
  const [stats, setStats] = useState<PoolStats | null>(null);
  const [records, setRecords] = useState<PoolRecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState("");

  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({ sourceAdapter: "PLATFORM_ICAKTARIM", sourceNote: "", json: "" });
  const [results, setResults] = useState<{ results: ImportResult[]; counts: Record<string, number> } | null>(null);

  // --- caselaw-ingest: kaynaklar + onay kuyruğu ---
  const [sources, setSources] = useState<IngestSource[]>([]);
  const [queue, setQueue] = useState<IngestItem[]>([]);
  const [queueCounts, setQueueCounts] = useState<{ BEKLIYOR: number; ONAYLANDI: number; REDDEDILDI: number } | null>(null);
  const [ingestBusy, setIngestBusy] = useState(false);
  const [ingestNotice, setIngestNotice] = useState<string | null>(null);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [sourceFormOpen, setSourceFormOpen] = useState(false);
  const [sourceForm, setSourceForm] = useState({ key: "", name: "", baseUrl: "", note: "" });

  const loadIngest = useCallback(async () => {
    try {
      const [s, q] = await Promise.all([
        adminApi<{ items: IngestSource[] }>(EP.caseLawIngest.sources),
        adminApi<{ items: IngestItem[]; counts: { BEKLIYOR: number; ONAYLANDI: number; REDDEDILDI: number } }>(
          EP.caseLawIngest.items,
          { query: { limit: 100 } },
        ),
      ]);
      setSources(s.items ?? []);
      setQueue(q.items ?? []);
      setQueueCounts(q.counts);
    } catch {
      // Kaynak uçları görünmezse bölüm sessiz kalır; havuz bölümü çalışmaya devam eder.
    }
  }, []);

  useEffect(() => {
    void loadIngest();
  }, [loadIngest]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, r] = await Promise.all([
        adminApi<PoolStats>(EP.caseLawPool.stats),
        adminApi<{ items?: PoolRecordRow[] }>(EP.caseLawPool.records, {
          query: sourceFilter ? { sourceAdapter: sourceFilter } : undefined,
        }),
      ]);
      setStats(s);
      setRecords(r.items ?? []);
      setMissing(false);
    } catch (err) {
      setMissing(true);
      setError(errorMessage(err, "Havuz bilgileri yüklenemedi."));
    } finally {
      setLoading(false);
    }
  }, [sourceFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runImport() {
    setBusy(true);
    setFormError(null);
    try {
      const parsed = JSON.parse(form.json) as unknown[];
      if (!Array.isArray(parsed)) throw new Error("Kaynak veri bir JSON DİZİSİ olmalıdır.");
      const data = await adminApi<{ results: ImportResult[]; counts: Record<string, number> }>(EP.caseLawPool.import, {
        method: "POST",
        body: {
          sourceAdapter: form.sourceAdapter.trim(),
          ...(form.sourceNote.trim() ? { sourceNote: form.sourceNote.trim() } : {}),
          records: parsed,
        },
      });
      setResults(data);
      setNotice(
        `İçe aktarım tamamlandı: ${data.counts.added} eklendi, ${data.counts.updated} güncellendi, ` +
          `${data.counts.skipped} atlandı, ${data.counts.rejected} reddedildi.`,
      );
      await load();
    } catch (err) {
      setFormError(errorMessage(err, "İçe aktarılamadı. JSON'u ve künye biçimlerini kontrol edin."));
    } finally {
      setBusy(false);
    }
  }

  async function runIngest() {
    setIngestBusy(true);
    setIngestError(null);
    setIngestNotice(null);
    try {
      const data = await adminApi<{ summaries: IngestRunSummary[]; totals: { queued: number; skippedDuplicate: number; rejected: number; failedSources: number } }>(
        EP.caseLawIngest.run,
        { method: "POST", body: {} },
      );
      setIngestNotice(
        data.summaries.length === 0
          ? "Açık besleme kaynağı yok — önce kaynak ekleyin."
          : `Çekim tamamlandı: ${data.totals.queued} kayıt kuyrukta · ${data.totals.skippedDuplicate} mükerrer · ${data.totals.rejected} reddedilen` +
            (data.totals.failedSources > 0 ? ` · ${data.totals.failedSources} kaynak HATA verdi` : ""),
      );
      if (data.summaries.some((s) => !s.ok)) {
        setIngestError(data.summaries.filter((s) => !s.ok).map((s) => `${s.key}: ${s.note ?? ""}`).join(" · "));
      }
      await loadIngest();
    } catch (err) {
      setIngestError(errorMessage(err, "Çekim çalıştırılamadı."));
    } finally {
      setIngestBusy(false);
    }
  }

  async function saveSource() {
    setIngestBusy(true);
    setIngestError(null);
    try {
      await adminApi(EP.caseLawIngest.upsertSource, {
        method: "PUT",
        body: {
          key: sourceForm.key.trim(),
          name: sourceForm.name.trim(),
          baseUrl: sourceForm.baseUrl.trim(),
          isEnabled: true,
          ...(sourceForm.note.trim() ? { note: sourceForm.note.trim() } : {}),
        },
      });
      setSourceFormOpen(false);
      setIngestNotice(`Kaynak kaydedildi: ${sourceForm.key.trim()}`);
      await loadIngest();
    } catch (err) {
      setIngestError(errorMessage(err, "Kaynak kaydedilemedi."));
    } finally {
      setIngestBusy(false);
    }
  }

  async function approveItem(id: string) {
    setIngestBusy(true);
    setIngestError(null);
    try {
      const res = await adminApi<{ poolOutcome: string }>(EP.caseLawIngest.approve(id), { method: "POST", body: {} });
      setIngestNotice(`Onaylandı — havuz sonucu: ${res.poolOutcome}`);
      await Promise.all([loadIngest(), load()]);
    } catch (err) {
      setIngestError(errorMessage(err, "Onaylanamadı."));
    } finally {
      setIngestBusy(false);
    }
  }

  async function rejectItem(id: string) {
    const reason = window.prompt("Red gerekçesi (zorunlu — denetim izine yazılır):");
    if (!reason || reason.trim().length < 3) return;
    setIngestBusy(true);
    setIngestError(null);
    try {
      await adminApi(EP.caseLawIngest.reject(id), { method: "POST", body: { reason: reason.trim() } });
      setIngestNotice("Kayıt reddedildi.");
      await loadIngest();
    } catch (err) {
      setIngestError(errorMessage(err, "Reddedilemedi."));
    } finally {
      setIngestBusy(false);
    }
  }

  const recordColumns: Array<Column<PoolRecordRow>> = [
    {
      key: "citation",
      header: "Künye",
      render: (r) => (
        <div>
          <p className="font-medium text-steel-50">{r.court}</p>
          <p className="text-xs text-steel-500">
            E. {r.caseNumber} · K. {r.decisionNumber}
            {r.decisionDate ? ` · ${new Date(r.decisionDate).toLocaleDateString("tr-TR")}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "source",
      header: "Kaynak",
      render: (r) => (
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="steel">{r.sourceAdapter}</Badge>
          {r.createdByTenantId ? <Badge tone="yellow">büro kaydı</Badge> : <Badge tone="green">sistem</Badge>}
        </div>
      ),
    },
    {
      key: "fetchedAt",
      header: "Giriş",
      render: (r) => new Date(r.fetchedAt).toLocaleDateString("tr-TR"),
    },
  ];

  const resultColumns: Array<Column<ImportResult>> = [
    {
      key: "citation",
      header: "Künye",
      render: (r) => (
        <div>
          <p className="font-medium text-steel-50">{r.court}</p>
          <p className="text-xs text-steel-500">
            E. {r.caseNumber} · K. {r.decisionNumber}
          </p>
        </div>
      ),
    },
    { key: "status", header: "Sonuç", render: (r) => <Badge tone={RESULT_TONES[r.status] ?? "steel"}>{r.status}</Badge> },
    { key: "reason", header: "Açıklama", render: (r) => r.reason ?? "—" },
  ];

  const ingestColumns: Array<Column<IngestItem>> = [
    {
      key: "citation",
      header: "Künye",
      render: (r) => (
        <div>
          <p className="font-medium text-steel-50">{r.court}</p>
          <p className="text-xs text-steel-500">
            E. {r.caseNumber} · K. {r.decisionNumber}
            {r.decisionDate ? ` · ${new Date(r.decisionDate).toLocaleDateString("tr-TR")}` : ""}
          </p>
          {r.summary && (
            <p className="mt-0.5 max-w-md text-[11px] text-steel-500" title={r.summary}>
              {r.summary.slice(0, 120)}
              {r.summary.length > 120 ? "…" : ""}
            </p>
          )}
          <Link
            href="/ictihat/onay"
            className="mt-0.5 inline-block text-[11px] text-sky-300 hover:underline"
          >
            Onay Masası&apos;nda aç →
          </Link>
        </div>
      ),
    },
    {
      key: "source",
      header: "Kaynak",
      render: (r) => <Badge tone="steel">{r.sourceKey}</Badge>,
    },
    {
      key: "status",
      header: "Durum",
      render: (r) => (
        <div className="space-y-1">
          <Badge
            tone={r.status === "BEKLIYOR" ? "yellow" : r.status === "ONAYLANDI" ? "green" : "red"}
          >
            {r.status === "BEKLIYOR" ? "Onay bekliyor" : r.status === "ONAYLANDI" ? "Onaylandı" : "Reddedildi"}
          </Badge>
          {r.rejectReason && <p className="text-[11px] text-red-300">{r.rejectReason}</p>}
        </div>
      ),
    },
    {
      key: "actions",
      header: "İşlem",
      render: (r) =>
        r.status === "BEKLIYOR" ? (
          <div className="flex gap-1.5">
            <Button size="sm" disabled={ingestBusy} onClick={() => void approveItem(r.id)}>
              Onayla
            </Button>
            <Button size="sm" variant="secondary" disabled={ingestBusy} onClick={() => void rejectItem(r.id)}>
              Reddet
            </Button>
          </div>
        ) : (
          <span className="text-xs text-steel-600">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="İçtihat Havuzu"
        description="RAG'ın kamusal tarafı: Yargıtay/Danıştay kararlarının ortak havuzu. Toplu içe aktarım (biçim ön doğrulamalı), havuz sağlığı ve son kayıtlar."
        action={
          <Button
            onClick={() => {
              setImportOpen(true);
              setResults(null);
              setFormError(null);
            }}
          >
            Toplu İçe Aktar
          </Button>
        }
      />

      <InfoBox title="İçerik güvenliği">
        Biçimsiz künye (esas/karar no) havuza GİREMEZ — reddedilir. Aynı künye bir büronun manuel
        kaydındaysa üzerine YAZILMAZ, kayıt atlanır. Her içe aktarma partisi denetim izine düşer.
        Bu sayfa yalnız platform yönetimine açıktır; büro kullanıcıları havuzu yalnızca ARAMA
        sonucu olarak görür.
      </InfoBox>

      {notice ? (
        <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{notice}</p>
      ) : null}
      {error ? <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p> : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card title="Havuz toplamı">
          <p className="text-3xl font-semibold text-steel-50">{stats?.total.toLocaleString("tr-TR") ?? "—"}</p>
          <p className="text-xs text-steel-500">ortak CaseLawDocument kaydı</p>
        </Card>
        <Card title="Sistem kaydı">
          <p className="text-3xl font-semibold text-steel-50">{stats?.systemEntered.toLocaleString("tr-TR") ?? "—"}</p>
          <p className="text-xs text-steel-500">içe aktarım + resmî kaynak (platform)</p>
        </Card>
        <Card title="Büro kaydı">
          <p className="text-3xl font-semibold text-steel-50">{stats?.tenantEntered.toLocaleString("tr-TR") ?? "—"}</p>
          <p className="text-xs text-steel-500">büroların elle girdiği kayıtlar</p>
        </Card>
      </div>

      {stats && stats.bySource.length > 0 ? (
        <Card title="Kaynak kırılımı">
          <div className="flex flex-wrap gap-2">
            {stats.bySource.map((s) => (
              <Badge key={s.sourceAdapter} tone="steel">
                {s.sourceAdapter}: {s.count.toLocaleString("tr-TR")}
              </Badge>
            ))}
          </div>
        </Card>
      ) : null}

      {stats && stats.topCourts.length > 0 ? (
        <Card title="En çok kayıt barındıran daireler (ilk 10)">
          <ul className="space-y-1 text-sm text-steel-300">
            {stats.topCourts.map((c) => (
              <li key={c.court} className="flex justify-between gap-3">
                <span>{c.court}</span>
                <span className="font-mono text-steel-500">{c.count.toLocaleString("tr-TR")}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card
        title="Toplama Hattı — besleme → onay kuyruğu"
        subtitle="Zamanlanmış iş (caselaw-ingest-daily, her gün 06:00) yapılandırılmış beslemelerden yeni kararları çeker. Çekilen kayıt havuza OTOMATİK girmez; burada bekler, onayladığınızda havuz kapısının künye doğrulamasından geçer."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={ingestBusy} onClick={() => void runIngest()}>
              {ingestBusy ? "Çekiliyor…" : "Şimdi Topla"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setSourceFormOpen(true);
                setIngestError(null);
              }}
            >
              + Kaynak
            </Button>
          </div>
        }
      >
        {ingestNotice ? (
          <p className="mb-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
            {ingestNotice}
          </p>
        ) : null}
        {ingestError ? (
          <p className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {ingestError}
          </p>
        ) : null}

        {sources.length === 0 ? (
          <p className="text-sm text-steel-500">
            Tanımlı besleme kaynağı yok. "+ Kaynak" ile sözleşmeli bir besleme adresi (GET →{" "}
            <span className="font-mono">{"{ records: [...] }"}</span>) tanımlayın.
          </p>
        ) : (
          <div className="mb-4 space-y-2">
            {sources.map((s) => (
              <div
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-steel-800 bg-steel-950/60 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge tone={s.isEnabled ? "green" : "gray"}>{s.key}</Badge>
                    <span className="text-sm text-steel-100">{s.name}</span>
                    {s.pendingCount > 0 && <Badge tone="yellow">{s.pendingCount} bekleyen</Badge>}
                  </div>
                  <p className="truncate font-mono text-[11px] text-steel-500" title={s.baseUrl}>
                    {s.baseUrl}
                  </p>
                </div>
                <p className="text-[11px] text-steel-500">
                  {s.lastFetchedAt
                    ? `son çekim: ${new Date(s.lastFetchedAt).toLocaleString("tr-TR")}`
                    : "hiç çekilmedi"}
                </p>
              </div>
            ))}
          </div>
        )}

        {queueCounts ? (
          <p className="mb-2 text-xs text-steel-400">
            Kuyruk: {queueCounts.BEKLIYOR} bekleyen · {queueCounts.ONAYLANDI} onaylanmış ·{" "}
            {queueCounts.REDDEDILDI} reddedilmiş
          </p>
        ) : null}
        {queue.length === 0 ? (
          <p className="text-sm text-steel-500">Kuyrukta kayıt yok.</p>
        ) : (
          <Table columns={ingestColumns} rows={queue} rowKey={(r) => r.id} dense />
        )}
      </Card>

      <Card
        title="Son kayıtlar"
        action={
          <Select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            aria-label="Kaynak süzgeci"
            className="w-56"
          >
            <option value="">Tüm kaynaklar</option>
            {(stats?.bySource ?? []).map((s) => (
              <option key={s.sourceAdapter} value={s.sourceAdapter}>
                {s.sourceAdapter}
              </option>
            ))}
          </Select>
        }
      >
        <ResourceView
          loading={loading}
          missing={missing}
          forbidden={false}
          error={error}
          empty={records.length === 0}
          endpoint={EP.caseLawPool.records}
          what="Havuz kayıtları"
          emptyMessage="Havuz boş — toplu içe aktarma ile doldurun."
        >
          <Table columns={recordColumns} rows={records} rowKey={(r) => r.id} dense />
        </ResourceView>
      </Card>

      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Toplu İçe Aktarım">        {formError ? (
          <p className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{formError}</p>
        ) : null}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Kaynak etiketi (BÜYÜK harf/rakam/_)">
              <Input value={form.sourceAdapter} onChange={(e) => setForm({ ...form, sourceAdapter: e.target.value })} />
            </Field>
            <Field label="Kaynak notu (isteğe bağlı)">
              <Input value={form.sourceNote} onChange={(e) => setForm({ ...form, sourceNote: e.target.value })} placeholder="örn. 2026-Q2 Lexpera dışa aktarımı" />
            </Field>
          </div>
          <Field label="Kayıtlar (JSON dizisi)">
            <Textarea
              rows={10}
              value={form.json}
              onChange={(e) => setForm({ ...form, json: e.target.value })}
              placeholder={SAMPLE_JSON}
            />
          </Field>
          <p className="text-xs text-steel-400">
            Alanlar: court, chamber?, caseNumber, decisionNumber, decisionDate? (YYYY-MM-DD),
            summary?, fullText?, sourceUrl?. Partide en fazla 500 kayıt; biçimsiz künye reddedilir,
            tek kayıt hatası partiyi düşürmez.
          </p>
          {results ? (
            <div className="max-h-64 overflow-y-auto rounded-lg border border-steel-800">
              <Table columns={resultColumns} rows={results.results} rowKey={(r) => `${r.index}`} dense />
            </div>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setImportOpen(false)}>
              Kapat
            </Button>
            <Button onClick={() => void runImport()} disabled={busy || form.json.trim().length < 3 || form.sourceAdapter.trim().length < 2}>
              {busy ? "İçe aktarılıyor…" : "İçe Aktar"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={sourceFormOpen} onClose={() => setSourceFormOpen(false)} title="Besleme Kaynağı">
        <div className="space-y-3">
          <InfoBox>
            Sözleşme: kaynak adresine GET atılır, yanıt{" "}
            <span className="font-mono">{"{ records: [...] }"}</span> JSON'u beklenir. Kayıt alanları havuz
            içe aktarma ile birebir aynıdır (court, caseNumber, decisionNumber, decisionDate?…). Biçimsiz
            künye kuyruğa da girmez; kayıt onaylanmadan havuza YAZILMAZ.
          </InfoBox>
          <Field label="Kaynak anahtarı (BÜYÜK harf/rakam/_)" hint="Havuzda kaynak etiketi olarak görünecek.">
            <Input
              value={sourceForm.key}
              onChange={(e) => setSourceForm({ ...sourceForm, key: e.target.value.toUpperCase() })}
              placeholder="örn. LEXPERA_FEED"
            />
          </Field>
          <Field label="Kaynak adı">
            <Input
              value={sourceForm.name}
              onChange={(e) => setSourceForm({ ...sourceForm, name: e.target.value })}
              placeholder="örn. Lisanslı içtihat beslemesi"
            />
          </Field>
          <Field label="Besleme adresi (URL)">
            <Input
              value={sourceForm.baseUrl}
              onChange={(e) => setSourceForm({ ...sourceForm, baseUrl: e.target.value })}
              placeholder="https://…/kararlar.json"
            />
          </Field>
          <Field label="Not (isteğe bağlı)">
            <Input
              value={sourceForm.note}
              onChange={(e) => setSourceForm({ ...sourceForm, note: e.target.value })}
              placeholder="sözleşme/lisans notu"
            />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setSourceFormOpen(false)}>
              Kapat
            </Button>
            <Button
              onClick={() => void saveSource()}
              disabled={ingestBusy || sourceForm.key.trim().length < 2 || sourceForm.name.trim().length < 3 || !sourceForm.baseUrl.trim().startsWith("http")}
            >
              {ingestBusy ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
