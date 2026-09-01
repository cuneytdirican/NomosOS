"use client";

/**
 * ZAMANLANMIŞ İŞLER — GET /jobs · GET /jobs/:key/runs · POST /jobs/:key/run
 *
 * F2-Ö-33: Platform panelinde işler sayfası YOKTU; risk-nightly, credit-low-warning
 * gibi işler görünmüyordu ve elle tetiklenemiyordu. Bu sayfa iş tanımlarını,
 * son çalışma durumunu ve cron ifadelerini gösterir; OPERATör işi elle tetikler.
 */

import { useState } from "react";
import { useResource } from "@/lib/useResource";
import { useMutation } from "@/lib/useMutation";
import { useAdminSession } from "@/lib/session";
import { adminApi, errorMessage } from "@/lib/api";
import { EP } from "@/lib/endpoints";
import { levelOf } from "@/lib/rbac";
import { PageGate } from "@/components/RoleGate";
import {
  Badge,
  Button,
  InfoBox,
  PageHeader,
  ResourceView,
  Table,
  type Column,
} from "@/components/ui";

interface JobRow {
  key: string;
  name: string;
  defaultCron: string;
  cronOverride: string | null;
  enabled: boolean;
  lastStatus: string | null;
  lastFinishedAt: string | null;
  lastDetail: string | null;
}

const STATUS_TONES: Record<string, "green" | "red" | "gray"> = {
  BASARILI: "green",
  BASARISIZ: "red",
};

const STATUS_LABELS: Record<string, string> = {
  BASARILI: "Başarılı",
  BASARISIZ: "Başarısız",
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
  const [error, setError] = useState<string | null>(null);

  const res = useResource<JobRow[]>(EP.jobs.list);
  const jobs = res.data ?? [];
  const canRun = levelOf(role, "system.settings") === "full";

  async function runJob(key: string) {
    setBusyKey(key);
    setError(null);
    try {
      await adminApi(EP.jobs.run(key), { method: "POST" });
      res.reload();
    } catch (err) {
      setError(errorMessage(err, "İş tetiklenemedi."));
    } finally {
      setBusyKey(null);
    }
  }

  const columns: Column<JobRow>[] = [
    {
      key: "name",
      header: "İş",
      render: (j) => (
        <div>
          <p className="font-medium text-slate-900">{j.name}</p>
          <p className="font-mono text-[11px] text-slate-500">{j.key}</p>
        </div>
      ),
    },
    {
      key: "cron",
      header: "Cron",
      render: (j) => (
        <span className="font-mono text-xs text-slate-600">
          {j.cronOverride ?? j.defaultCron}
          {j.cronOverride && <span className="ml-1 text-amber-600">(özel)</span>}
        </span>
      ),
    },
    {
      key: "enabled",
      header: "Durum",
      render: (j) => (
        <Badge tone={j.enabled ? "green" : "gray"}>{j.enabled ? "Açık" : "Kapalı"}</Badge>
      ),
    },
    {
      key: "last",
      header: "Son Çalışma",
      render: (j) => (
        <div>
          {j.lastStatus ? (
            <>
              <Badge tone={STATUS_TONES[j.lastStatus] ?? "gray"}>
                {STATUS_LABELS[j.lastStatus] ?? j.lastStatus}
              </Badge>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {j.lastFinishedAt ? new Date(j.lastFinishedAt).toLocaleString("tr-TR") : ""}
              </p>
            </>
          ) : (
            <span className="text-sm text-slate-500">hiç çalışmadı</span>
          )}
          {j.lastDetail && (
            <p className="max-w-xs truncate text-[11px] text-slate-400" title={j.lastDetail}>
              {j.lastDetail}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "actions",
      header: "İşlem",
      render: (j) => (
        <Button
          size="sm"
          variant="secondary"
          disabled={!canRun || busyKey !== null || !j.enabled}
          onClick={() => void runJob(j.key)}
          title={canRun ? "İşi şimdi tetikler" : "Yalnız yazma yetkisi olan roller tetikleyebilir"}
        >
          {busyKey === j.key ? "Çalışıyor…" : "Şimdi çalıştır"}
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Zamanlanmış İşler"
        description="Platform iş tanımları, cron ifadeleri ve son çalışma durumları. İşler İstanbul saat diliminde çalışır."
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
        empty={res.loaded && jobs.length === 0}
        endpoint={res.endpoint}
        what="Zamanlanmış işler"
      >
        <Table<JobRow> columns={columns} rows={jobs} rowKey={(j) => j.key} />
      </ResourceView>
    </div>
  );
}
