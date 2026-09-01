"use client";

/**
 * DEMO TALEPLERİ — GET /demo-requests, PATCH /demo-requests/:id
 *
 * Tanıtım sitesindeki demo formu talepleri buraya Düşer (DemoRequest kaydı);
 * e-posta/webhook gönderilmez — satış hattı bu ekrandan takip eder (kullanıcı
 * kararı). Durum değişimi demoRequests.update yetkisi ister (OPS_ADMIN+;
 * SUPPORT_AGENT yalnız okur) ve PlatformAuditLog'a yazılır.
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
  InfoBox,
  PageHeader,
  ResourceView,
  Select,
  Table,
  type Column,
} from "@/components/ui";

interface DemoRequestRow {
  id: string;
  fullName: string;
  barAssociation: string | null;
  email: string;
  phone: string | null;
  lawyerCount: string | null;
  message: string | null;
  status: "YENI" | "ILETISIME_GECILDI" | "KAPANDI";
  statusChangedAt: string | null;
  createdAt: string;
}

interface DemoRequestsZarf {
  rows: DemoRequestRow[];
  total: number;
  yeniSayi: number;
}

const STATUS_LABELS: Record<DemoRequestRow["status"], string> = {
  YENI: "Yeni",
  ILETISIME_GECILDI: "İletişime geçildi",
  KAPANDI: "Kapandı",
};

const STATUS_TONES: Record<DemoRequestRow["status"], "blue" | "green" | "gray"> = {
  YENI: "blue",
  ILETISIME_GECILDI: "green",
  KAPANDI: "gray",
};

export default function DemoTalepleriPage() {
  return (
    <PageGate action="demoRequests.view">
      <DemoTalepleri />
    </PageGate>
  );
}

function DemoTalepleri() {
  const { role } = useAdminSession();
  const [status, setStatus] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const res = useResource<DemoRequestsZarf>(EP.demoRequests.list, {
    query: { status: status || undefined },
  });
  const rows = res.data?.rows ?? [];

  async function updateStatus(id: string, next: DemoRequestRow["status"]) {
    setBusyId(id);
    setError(null);
    try {
      await adminApi(EP.demoRequests.detail(id), { method: "PATCH", body: { status: next } });
      res.reload();
    } catch (err) {
      setError(errorMessage(err, "Durum güncellenemedi."));
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<DemoRequestRow>[] = [
    {
      key: "col_1", header: "Talep sahibiTalep sahibi",
      render: (r) => (
        <div>
          <p className="font-medium text-slate-900">{r.fullName}</p>
          <p className="text-xs text-slate-500">{r.email}{r.phone ? ` · ${r.phone}` : ""}</p>
        </div>
      ),
    },
    {
      key: "col_2", header: "BuroBüro",
      render: (r) => (
        <div>
          <p>{r.barAssociation ?? "—"}</p>
          {r.lawyerCount && <p className="text-xs text-slate-500">{r.lawyerCount} avukat</p>}
        </div>
      ),
    },
    {
      key: "col_3", header: "MesajMesaj",
      render: (r) => (
        <p className="max-w-xs truncate text-sm text-slate-600" title={r.message ?? ""}>
          {r.message ?? "—"}
        </p>
      ),
    },
    {
      key: "col_4", header: "DurumDurum",
      render: (r) => <Badge tone={STATUS_TONES[r.status]}>{STATUS_LABELS[r.status]}</Badge>,
    },
    {
      key: "col_5", header: "TarihTarih",
      render: (r) => (
        <span className="whitespace-nowrap text-sm text-slate-600">
          {new Date(r.createdAt).toLocaleString("tr-TR")}
        </span>
      ),
    },
    {
      key: "col_6", header: "Islemİşlem",
      render: (r) => {
        if (!canMutate(role, "demoRequests.update")) {
          return <span className="text-xs text-slate-400">Yalnız okuma</span>;
        }
        if (busyId === r.id) return <span className="text-xs text-slate-500">Güncelleniyor…</span>;
        return (
          <div className="flex gap-1.5">
            {r.status === "YENI" && (
              <Button size="sm" onClick={() => void updateStatus(r.id, "ILETISIME_GECILDI")}>
                İletişime geçildi
              </Button>
            )}
            {r.status !== "KAPANDI" && (
              <Button size="sm" variant="secondary" onClick={() => void updateStatus(r.id, "KAPANDI")}>
                Kapat
              </Button>
            )}
            {r.status === "KAPANDI" && (
              <Button size="sm" variant="secondary" onClick={() => void updateStatus(r.id, "YENI")}>
                Yeniden aç
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Demo Talepleri"
        description="Tanıtım sitesinden gelen demo talepleri — kayıt olarak burada izlenir; e-posta gönderilmez."
        action={
          <div className="flex items-center gap-2">
            <Select aria-label="Durum süzgeci" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Tümü</option>
              <option value="YENI">Yeni</option>
              <option value="ILETISIME_GECILDI">İletişime geçildi</option>
              <option value="KAPANDI">Kapandı</option>
            </Select>
            {res.data && (
              <span className="text-sm text-slate-500">
                {res.data.yeniSayi} yeni · {res.data.total} toplam
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
        what="Demo talepleri"
        emptyMessage="Bu süzgeçte demo talebi yok."
      >
        <Table<DemoRequestRow>
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          empty="Bu süzgeçte demo talebi yok."
        />
      </ResourceView>
    </div>
  );
}
