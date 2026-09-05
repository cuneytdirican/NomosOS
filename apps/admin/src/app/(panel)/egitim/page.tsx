"use client";

/**
 * MODEL EĞİTİM İŞLERİ (D5 / M4 + kullanıcı tanımlı model eğitimi) — fine-tuning
 * iş yönetimi. MODEL YALNIZ KATALOGDAN SEÇİLİR: platform AI sağlayıcıları
 * ekranında tanımlı ve AKTİF kayıtlar; serbest metin sağlayıcı/model girişi YOKTUR.
 *
 * DÜRÜSTLÜK: sağlayıcıya otomatik iş gönderimi YOKTUR. Bu sayfa iş kaydını,
 * ONAYLANMIŞ örnek havuzunun anlık görüntüsünü, manifest (JSONL) indirmeyi ve
 * şerit denetimli durum geçişlerini kapsar. Manifestin sağlayıcıya yüklenmesi
 * operatörün ELLE yaptığı, sistemin dışında bir adımdır.
 */

import { useCallback, useEffect, useState } from "react";
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

/** Platform kataloğu satırı (EP.platformAi.list) — model seçim listesi. */
interface CatalogProvider {
  id: string;
  name: string;
  type: string;
  defaultModel: string;
  isActive: boolean;
  origin?: string;
}

interface FineTuneJobRow {
  id: string;
  name: string;
  provider: string;
  baseModel: string;
  status: string;
  sampleCount: number;
  taskTypes?: Record<string, number>;
  resultModelName: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  requestedBy?: { fullName: string; email: string } | null;
}

interface PoolState {
  approvedCount: number;
  byTaskType: Record<string, number>;
}

/** Sunucudaki şeritle AYNI (fine-tune.schemas.ts FINE_TUNE_TRANSITIONS). */
const NEXT: Record<string, string[]> = {
  HAZIRLANDI: ["GONDERILDI", "IPTAL"],
  GONDERILDI: ["EGITILIYOR", "BASARISIZ", "IPTAL"],
  EGITILIYOR: ["TAMAMLANDI", "BASARISIZ"],
  TAMAMLANDI: [],
  BASARISIZ: [],
  IPTAL: [],
};

const STATUS_TONES: Record<string, "blue" | "gray" | "yellow" | "green" | "red" | "steel"> = {
  HAZIRLANDI: "steel",
  GONDERILDI: "blue",
  EGITILIYOR: "yellow",
  TAMAMLANDI: "green",
  BASARISIZ: "red",
  IPTAL: "gray",
};

export default function EgitimPage() {
  return (
    <PageGate action="aiProvider.view">
      <Egitim />
    </PageGate>
  );
}

function Egitim() {
  const [jobs, setJobs] = useState<FineTuneJobRow[]>([]);
  const [pool, setPool] = useState<PoolState | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", platformAiProviderId: "", note: "" });
  const [catalog, setCatalog] = useState<CatalogProvider[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminApi<{ items?: FineTuneJobRow[]; pool?: PoolState }>(EP.fineTune.list);
      setJobs(data.items ?? []);
      setPool(data.pool ?? null);
      setMissing(false);
      // Model seçim listesi: yalnız AKTİF platform sağlayıcıları (serbest metin yok).
      try {
        const rows = await adminApi<CatalogProvider[]>(EP.platformAi.list);
        setCatalog((Array.isArray(rows) ? rows : []).filter((r) => r.isActive));
      } catch {
        setCatalog([]);
      }
    } catch (err) {
      setMissing(true);
      setError(errorMessage(err, "Eğitim işleri yüklenemedi."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    setFormError(null);
    try {
      await adminApi(EP.fineTune.create, {
        method: "POST",
        body: {
          name: form.name.trim(),
          platformAiProviderId: form.platformAiProviderId,
          ...(form.note.trim() ? { note: form.note.trim() } : {}),
        },
      });
      setCreateOpen(false);
      setForm({ name: "", platformAiProviderId: "", note: "" });
      setNotice("İş açıldı (HAZIRLANDI). Manifesti indirip sağlayıcıya ELLE yükleyin; durumu buradan izleyin.");
      await load();
    } catch (err) {
      setFormError(errorMessage(err, "İş açılamadı."));
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(job: FineTuneJobRow, status: string) {
    let resultModelName: string | undefined;
    if (status === "TAMAMLANDI") {
      const name = window.prompt("Sağlayıcının döndürdüğü SONUÇ MODEL ADI (zorunlu):");
      if (!name || name.trim().length < 2) return;
      resultModelName = name.trim();
    }
    setBusy(true);
    try {
      await adminApi(EP.fineTune.status(job.id), { method: "POST", body: { status, ...(resultModelName ? { resultModelName } : {}) } });
      setNotice(`"${job.name}" durumu → ${status}.`);
      await load();
    } catch (err) {
      setError(errorMessage(err, "Durum değiştirilemedi."));
    } finally {
      setBusy(false);
    }
  }

  async function downloadManifest(job: FineTuneJobRow) {
    setBusy(true);
    try {
      const data = await adminApi<{ jsonl: string; count: number }>(EP.fineTune.manifest(job.id));
      const blob = new Blob([data.jsonl], { type: "application/jsonl" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `finetune-${job.name.replace(/[^a-zA-Z0-9_-]+/g, "_")}.jsonl`;
      a.click();
      URL.revokeObjectURL(url);
      setNotice(`Manifest indirildi (${data.count} ONAYLANMIŞ örnek). Sağlayıcıya ELLE yükleyin.`);
    } catch (err) {
      setError(errorMessage(err, "Manifest indirilemedi."));
    } finally {
      setBusy(false);
    }
  }

  const columns: Array<Column<FineTuneJobRow>> = [
    {
      key: "name",
      header: "İş",
      render: (j) => (
        <div>
          <p className="font-medium text-steel-50">{j.name}</p>
          <p className="text-xs text-steel-500">
            {j.provider} · {j.baseModel} · {j.requestedBy?.fullName ?? "—"}
          </p>
          {j.resultModelName ? (
            <p className="mt-0.5 font-mono text-[11px] text-emerald-400">{j.resultModelName}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: "status",
      header: "Durum",
      render: (j) => <Badge tone={STATUS_TONES[j.status] ?? "slate"}>{j.status}</Badge>,
    },
    {
      key: "samples",
      header: "Örnek (anlık görüntü)",
      align: "right",
      render: (j) => j.sampleCount.toLocaleString("tr-TR"),
    },
    {
      key: "createdAt",
      header: "Açılış",
      render: (j) => new Date(j.createdAt).toLocaleDateString("tr-TR"),
    },
    {
      key: "actions",
      header: "İşlem",
      render: (j) => (
        <div className="flex flex-wrap gap-1.5">
          {(j.status === "HAZIRLANDI" || j.status === "GONDERILDI") && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void downloadManifest(j)}>
              Manifest
            </Button>
          )}
          {(NEXT[j.status] ?? []).map((s) => (
            <Button key={s} size="sm" variant="secondary" disabled={busy} onClick={() => void setStatus(j, s)}>
              → {s}
            </Button>
          ))}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Model Eğitim İşleri"
        description="Kullanıcı tanımlı model: ONAYLANMIŞ örnek havuzundan, platform kataloğunda tanımlı bir model üzerinde fine-tuning işi açın; manifesti (JSONL) indirin, durumu izleyin. Sağlayıcıya otomatik gönderim YOKTUR — yükleme operatörün elindedir."
        action={
          <Button onClick={() => setCreateOpen(true)} disabled={!pool || pool.approvedCount === 0}>
            Eğitim İşi Aç
          </Button>
        }
      />

      <InfoBox title="Dürüstlük ilkesi">
        Bu sayfa hiçbir sağlayıcıya otomatik istek göndermez. İş kaydı, ONAYLANMIŞ (kiracı opt-in +
        örnek onayı) havuzun anlık görüntüsünü tutar; manifest elle indirilir, sağlayıcıya elle
        yüklenir ve sonuç model adı TAMAMLANDI adımında elle yazılır. Tüm adımlar denetim izine düşer.
      </InfoBox>

      {notice ? (
        <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{notice}</p>
      ) : null}
      {error ? <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p> : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card title="Onaylı havuz (anlık)">
          <p className="text-3xl font-semibold text-steel-50">{pool?.approvedCount ?? "—"}</p>
          <p className="text-xs text-steel-500">ONAYLANMIŞ örnek — yalnız bunlar manifeste girer</p>
        </Card>
        <Card title="Açık işler">
          <p className="text-3xl font-semibold text-steel-50">
            {jobs.filter((j) => !["TAMAMLANDI", "BASARISIZ", "IPTAL"].includes(j.status)).length}
          </p>
          <p className="text-xs text-steel-500">HAZIRLANDI / GONDERILDI / EGITILIYOR</p>
        </Card>
        <Card title="Tamamlanan">
          <p className="text-3xl font-semibold text-steel-50">
            {jobs.filter((j) => j.status === "TAMAMLANDI").length}
          </p>
          <p className="text-xs text-steel-500">sonuç modeli kayıtlı işler</p>
        </Card>
      </div>

      {pool && Object.keys(pool.byTaskType).length > 0 ? (
        <Card title="Havuz kırılımı (görev tipi)">
          <div className="flex flex-wrap gap-2">
            {Object.entries(pool.byTaskType).map(([t, n]) => (
              <Badge key={t} tone="steel">
                {t}: {n}
              </Badge>
            ))}
          </div>
        </Card>
      ) : null}

      <Card title={jobs.length > 0 ? `${jobs.length} iş` : "Eğitim İşleri"}>
        <ResourceView
          loading={loading}
          missing={missing}
          forbidden={false}
          error={error}
          empty={jobs.length === 0}
          endpoint={EP.fineTune.list}
          what="Eğitim işleri"
          emptyMessage="Henüz fine-tuning işi açılmamış."
        >
          <Table columns={columns} rows={jobs} rowKey={(j) => j.id} dense />
        </ResourceView>
      </Card>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Eğitim İşi Aç">
        {formError ? (
          <p className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{formError}</p>
        ) : null}
        <div className="space-y-3">
          <p className="text-xs text-steel-400">
            İş açıldığında ONAYLANMIŞ havuzun anlık görüntüsü kaydedilir ({pool?.approvedCount ?? 0} örnek).
            Manifesti indirdikten sonra sağlayıcıya ELLE yükleyin.
          </p>
          <Field label="İş adı">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Örn. 2026-Q4 belge sınıflandırıcı" />
          </Field>
          <Field
            label="Model (platform kataloğundan)"
            hint="Yalnız Platform AI Sağlayıcıları ekranında tanımlı ve AKTİF modeller seçilebilir; serbest metin girişi yoktur."
          >
            {catalog.length === 0 ? (
              <p className="text-xs text-amber-300">
                Aktif platform sağlayıcısı yok. Önce Platform AI Sağlayıcıları ekranından bir model tanımlayın ya da eğitilmiş model kaydı içe aktarın.
              </p>
            ) : (
              <Select
                value={form.platformAiProviderId}
                onChange={(e) => setForm({ ...form, platformAiProviderId: e.target.value })}
              >
                <option value="">Model seçin…</option>
                {catalog.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.defaultModel}
                    {c.origin === "IMPORTED" ? " (içe aktarıldı)" : ""}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Not (isteğe bağlı)">
            <Textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Vazgeç
            </Button>
            <Button onClick={() => void create()} disabled={busy || form.name.trim().length < 3 || !form.platformAiProviderId}>
              {busy ? "Açılıyor…" : "Aç"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
