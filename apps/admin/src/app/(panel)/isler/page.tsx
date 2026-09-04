"use client";

/**
 * ZAMANLANMIŞ İŞLER — GET /jobs · GET /jobs/:key/runs · POST /jobs/:key/run · PATCH /jobs/:key
 *
 * F2-Ö-33: Platform panelinde işler sayfası YOKTU; risk-nightly, credit-low-warning
 * gibi işler görünmüyordu ve elle tetiklenemiyordu. Bu sayfa iş tanımlarını,
 * cron ifadelerini, son çalışma durumunu VE zamanlayıcının kendi durumunu gösterir;
 * operatör işi elle tetikler, açıp kapatır, cron'u değiştirir, koşu geçmişini açar.
 *
 * Sözleşme (platform-jobs.service.ts): GET /jobs → { items: JobListItem[], scheduler }.
 * Cron kaydetmeden önce SUNUCU doğrular (saatlik alt sınır dahil); panel yalnız
 * iletir, kendi cron ayrıştırıcısını içermez.
 */

import { useState } from "react";
import Link from "next/link";
import { useListResource, useResource } from "@/lib/useResource";
import { useMutation } from "@/lib/useMutation";

import { useAdminSession } from "@/lib/session";
import { adminApi, errorMessage } from "@/lib/api";
import { EP } from "@/lib/endpoints";
import { levelOf } from "@/lib/rbac";
import { PageGate } from "@/components/RoleGate";
import { fmtDateTime, fmtNumber } from "@/lib/labels";
import {
  Badge,
  Button,
  Card,
  InfoBox,
  Modal,
  PageHeader,
  ResourceView,
  StatCard,
  Table,
  Textarea,
  Field,
  type Column,
} from "@/components/ui";

interface JobListItem {
  key: string;
  name: string;
  description: string | null;
  cronExpression: string;
  defaultCron: string | null;
  isEnabled: boolean;
  /** Tabloda var, kodda yok — zamanlayıcıya alınmayan artık tanım. */
  isOrphan: boolean;
  isRunning: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastStatusLabel: string | null;
  lastError: string | null;
  lastDurationMs: number | null;
  nextRunAt: string | null;
  updatedAt: string | null;
}

interface JobRunRow {
  id: string;
  status: string;
  statusLabel: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  itemsProcessed: number | null;
  errorMessage: string | null;
}

const STATUS_TONES: Record<string, "green" | "red" | "gray" | "yellow"> = {
  BASARILI: "green",
  BASARISIZ: "red",
  CALISIYOR: "yellow",
  ATLANDI: "gray",
};

export default function IslerPage() {
  return (
    <PageGate action="system.settings">
      <Isler />
    </PageGate>
  );
}

function Isler() {
  const { role } = useAdminSession();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [patchJob, setPatchJob] = useState<JobListItem | null>(null);
  const [runsJob, setRunsJob] = useState<JobListItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const res = useResource<{ items: JobListItem[]; scheduler: { mode?: string; queue?: string } }>(
    EP.jobs.list,
  );
  const jobs = res.data?.items ?? [];
  const scheduler = res.data?.scheduler;
  const canRun = levelOf(role, "system.settings") === "full";

  async function runJob(key: string) {
    setBusyKey(key);
    setError(null);
    try {
      await adminApi(EP.jobs.run(key), { method: "POST", body: {} });
      res.reload();
    } catch (err) {
      setError(errorMessage(err, "İş tetiklenemedi."));
    } finally {
      setBusyKey(null);
    }
  }

  const columns: Column<JobListItem>[] = [
    {
      key: "name",
      header: "İş",
      render: (j) => (
        <div>
          <p className="font-medium text-steel-100">{j.name}</p>
          <p className="font-mono text-[11px] text-steel-500">{j.key}</p>
          {j.description && (
            <p className="mt-0.5 max-w-md text-[11px] text-steel-500">{j.description}</p>
          )}
          {j.key === "caselaw-ingest-daily" && <IngestQueueNote />}
        </div>
      ),
    },
    {
      key: "cron",
      header: "Cron",
      render: (j) => (
        <div>
          <span className="font-mono text-xs text-steel-200">{j.cronExpression}</span>
          {j.cronExpression !== j.defaultCron && (
            <p className="text-[11px] text-amber-300">
              özel (varsayılan: <span className="font-mono">{j.defaultCron ?? "—"}</span>)
            </p>
          )}
        </div>
      ),
    },
    {
      key: "enabled",
      header: "Durum",
      render: (j) => (
        <div className="flex flex-col items-start gap-1">
          <Badge tone={j.isEnabled ? "green" : "gray"}>{j.isEnabled ? "Açık" : "Kapalı"}</Badge>
          {j.isOrphan && <Badge tone="red">artık tanım</Badge>}
          {j.isRunning && <Badge tone="yellow">çalışıyor</Badge>}
        </div>
      ),
    },
    {
      key: "last",
      header: "Son çalışma",
      render: (j) => (
        <div>
          {j.lastStatusLabel ? (
            <>
              <Badge tone={STATUS_TONES[j.lastStatus ?? ""] ?? "gray"}>{j.lastStatusLabel}</Badge>
              <p className="mt-0.5 text-[11px] text-steel-500">{fmtDateTime(j.lastRunAt)}</p>
            </>
          ) : (
            <span className="text-sm text-steel-500">hiç çalışmadı</span>
          )}
          {j.lastError && (
            <p
              className="max-w-xs truncate text-[11px] text-red-300"
              title={j.lastError}
            >
              {j.lastError}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "next",
      header: "Sıradaki",
      render: (j) => (
        <span className="text-xs text-steel-400">{j.isEnabled ? fmtDateTime(j.nextRunAt) : "—"}</span>
      ),
    },
    {
      key: "actions",
      header: "İşlem",
      render: (j) => (
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            disabled={!canRun || busyKey !== null || !j.isEnabled || j.isOrphan}
            onClick={() => void runJob(j.key)}
            title={canRun ? "İşi şimdi tetikler" : "Yalnız yazma yetkisi olan roller tetikleyebilir"}
          >
            {busyKey === j.key ? "Çalışıyor…" : "Şimdi çalıştır"}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setRunsJob(j)}>
            Geçmiş
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!canRun || j.isOrphan}
            onClick={() => {
              setError(null);
              setPatchJob(j);
            }}
          >
            Ayarla
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Zamanlanmış İşler"
        description="Platform iş tanımları, cron ifadeleri ve son çalışma durumları. İşler İstanbul saat diliminde çalışır; koşu geçmişi her işin satırından açılır."
      />

      {error && (
        <InfoBox title="Hata">
          <p className="text-sm text-red-300">{error}</p>
        </InfoBox>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Tanımlı iş" value={fmtNumber(jobs.length)} />
        <StatCard
          label="Açık iş"
          value={fmtNumber(jobs.filter((j) => j.isEnabled).length)}
          tone="green"
        />
        <StatCard
          label="Artık tanım"
          value={fmtNumber(jobs.filter((j) => j.isOrphan).length)}
          tone={jobs.some((j) => j.isOrphan) ? "red" : "steel"}
          hint="tabloda var, kodda yok"
        />
        <StatCard
          label="Zamanlayıcı"
          value={scheduler?.mode ?? "—"}
          hint={scheduler?.queue ? `kuyruk: ${scheduler.queue}` : undefined}
        />
      </div>

      <ResourceView
        loading={res.loading}
        missing={res.missing}
        forbidden={res.forbidden}
        error={res.error}
        empty={res.loaded && jobs.length === 0}
        endpoint={res.endpoint}
        what="Zamanlanmış işler"
      >
        <Card title="İş tanımları">
          <Table<JobListItem> columns={columns} rows={jobs} rowKey={(j) => j.key} dense />
        </Card>
      </ResourceView>

      {runsJob && (
        <Modal
          open
          onClose={() => setRunsJob(null)}
          title={`Koşu geçmişi — ${runsJob.name}`}
          subtitle={`GET /api/admin/v1${EP.jobs.runs(runsJob.key)}`}
          wide
        >
          <RunsTable jobKey={runsJob.key} />
        </Modal>
      )}

      {patchJob && (
        <PatchModal
          job={patchJob}
          onClose={() => setPatchJob(null)}
          onSaved={() => {
            setPatchJob(null);
            res.reload();
          }}
        />
      )}
    </div>
  );
}

/**
 * İçtihat besleme işi için kuyruk köprüsü (plans/ictihat-havuzu-yol-haritasi.md
 * madde 8): iş satırında "Kuyrukta bekleyen: N kayıt" + Onay Masası bağlantısı.
 *
 * Sayı, İŞ KAYIT SERVİSİNDEN değil caselaw-ingest kuyruk ucundan gelir (ikinci
 * fetch): GET /caselaw-ingest/items → counts.BEKLIYOR. Uç görünmezse (yetki/
 * hazır değil) yalnız bağlantı gösterilir; sayı uydurulmaz.
 */
function IngestQueueNote() {
  const res = useResource<{ counts?: { BEKLIYOR?: number } }>(EP.caseLawIngest.items, {
    query: { limit: 1 },
  });
  const pending = res.data?.counts?.BEKLIYOR;

  return (
    <p className="mt-1 text-[11px]">
      {typeof pending === "number" ? (
        <span className="text-amber-300">Kuyrukta bekleyen: {pending.toLocaleString("tr-TR")} kayıt · </span>
      ) : null}
      <Link href="/ictihat/onay" className="text-sky-300 hover:underline">
        Onay Masası&apos;na git →
      </Link>
    </p>
  );
}

/** Bir işin append-only koşu günlüğü — GET /jobs/:key/runs. */
function RunsTable({ jobKey }: { jobKey: string }) {
  const res = useListResource<JobRunRow>(EP.jobs.runs(jobKey), {
    query: { limit: "10" },
  });

  const columns: Column<JobRunRow>[] = [
    {
      key: "status",
      header: "Durum",
      render: (r) => (
        <Badge tone={STATUS_TONES[r.status] ?? "gray"}>{r.statusLabel ?? r.status}</Badge>
      ),
    },
    {
      key: "started",
      header: "Başlangıç",
      render: (r) => <span className="text-xs text-steel-300">{fmtDateTime(r.startedAt)}</span>,
    },
    {
      key: "duration",
      header: "Süre",
      align: "right",
      render: (r) => (
        <span className="font-mono text-xs text-steel-300">
          {r.durationMs !== null ? `${(r.durationMs / 1000).toFixed(1)} sn` : "—"}
        </span>
      ),
    },
    {
      key: "items",
      header: "İşlenen",
      align: "right",
      render: (r) => <span className="font-mono text-xs">{fmtNumber(r.itemsProcessed)}</span>,
    },
    {
      key: "error",
      header: "Hata",
      render: (r) =>
        r.errorMessage ? (
          <span className="text-xs text-red-300" title={r.errorMessage}>
            {r.errorMessage.slice(0, 80)}
          </span>
        ) : (
          <span className="text-steel-600">—</span>
        ),
    },
  ];

  return (
    <div className="px-4 pb-4">
      <ResourceView
        loading={res.loading}
        missing={res.missing}
        forbidden={res.forbidden}
        error={res.error}
        empty={res.empty}
        endpoint={EP.jobs.runs(jobKey)}
        what="Koşu geçmişi"
        emptyMessage="Bu iş için koşu kaydı yok."
      >
        <Table<JobRunRow> columns={columns} rows={res.data} rowKey={(r) => r.id} dense />
      </ResourceView>
    </div>
  );
}

/** Aç/kapat + cron değiştir — PATCH /jobs/:key (sunucu cron'u doğrular). */
function PatchModal({
  job,
  onClose,
  onSaved,
}: {
  job: JobListItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const mutation = useMutation();
  const [cron, setCron] = useState(job.cronExpression);
  const [enabled, setEnabled] = useState(job.isEnabled);
  const dirty = cron.trim() !== job.cronExpression || enabled !== job.isEnabled;

  async function submit() {
    const body: { isEnabled?: boolean; cronExpression?: string } = {};
    if (enabled !== job.isEnabled) body.isEnabled = enabled;
    if (cron.trim() !== job.cronExpression) body.cronExpression = cron.trim();
    const ok = await mutation.run(
      EP.jobs.patch(job.key),
      { method: "PATCH", body },
      { successMessage: "İş tanımı güncellendi; zamanlayıcı kuyruğu anında yeniden eşitlendi." },
    );
    if (ok) onSaved();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`İş ayarı — ${job.name}`}
      subtitle={`PATCH /api/admin/v1${EP.jobs.patch(job.key)}`}
    >
      <div className="space-y-4">
        <InfoBox>
          Cron ifadesi sunucuda <strong>kaydedilmeden önce doğrulanır</strong>; dakika alanı tek
          sabit değer olmalıdır (en sık saatlik). Varsayılan:{" "}
          <span className="font-mono">{job.defaultCron ?? "—"}</span>.
        </InfoBox>
        <Field label="Cron ifadesi" hint='Beş alan, ör. "0 7 * * *" (her gün 07:00 TR).'>
          <Textarea rows={2} value={cron} onChange={(e) => setCron(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-steel-200">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4"
          />
          İş açık (zamanlayıcı bu tanımı çalıştırır)
        </label>
        {mutation.error && <p className="text-sm text-red-300">{mutation.error}</p>}
        {mutation.success && <p className="text-sm text-emerald-300">{mutation.success}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Kapat
          </Button>
          <Button disabled={!dirty || mutation.loading} onClick={() => void submit()}>
            {mutation.loading ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
