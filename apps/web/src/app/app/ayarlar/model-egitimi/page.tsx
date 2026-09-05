"use client";

/**
 * Ayarlar → Model Eğitimi (kullanıcı tanımlı model eğitimi, gereksinim 2).
 *
 * Lisanslı büro (planında kendi model tanımlama yetkisi — allowBYOLLM) KENDİ
 * tanımladığı bir sağlayıcı/model üzerinde fine-tuning işi açar; manifesti
 * (JSONL) indirir, sağlayıcısına ELLE yükler, durumu buradan izler. RAG
 * "yeniden eğitimi" = dosyanın belgelerini yeniden indeksleme (mevcut hat).
 *
 * DÜRÜSTLÜK: sağlayıcıya otomatik gönderim YOKTUR. Manifest yalnız bu
 * büronun ONAYLANMIŞ (rıza + platform onayı) örneklerini içerir.
 * Lisans yoksa ekran kilitli bilgi kutusu gösterir; asıl yaptırım API'dedir.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, asList, ApiError } from "@/lib/api";
import type { AiProvider, CaseSummary } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  SuccessBox,
  Textarea,
} from "@/components/ui";

interface FineTuneJobRow {
  id: string;
  name: string;
  provider: string;
  baseModel: string;
  providerConfigId: string | null;
  status: string;
  sampleCount: number;
  taskTypes?: Record<string, number>;
  resultModelName: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

interface JobsResponse {
  licensed: boolean;
  licenseMessage: string | null;
  items: FineTuneJobRow[];
  pool: { approvedCount: number; byTaskType: Record<string, number> };
}

interface IndexResult {
  caseId: string;
  documentCount: number;
  chunkCount: number;
  retrievalMode: "EMBEDDING" | "KEYWORD";
  embeddingModel?: string;
  notice: string;
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

const STATUS_TONES: Record<string, "navy" | "gray" | "gold" | "green" | "red"> = {
  HAZIRLANDI: "navy",
  GONDERILDI: "navy",
  EGITILIYOR: "gold",
  TAMAMLANDI: "green",
  BASARISIZ: "red",
  IPTAL: "gray",
};

const STATUS_LABELS: Record<string, string> = {
  HAZIRLANDI: "Hazırlandı",
  GONDERILDI: "Gönderildi",
  EGITILIYOR: "Eğitiliyor",
  TAMAMLANDI: "Tamamlandı",
  BASARISIZ: "Başarısız",
  IPTAL: "İptal",
};

export default function ModelEgitimiPage() {
  const [data, setData] = useState<JobsResponse | null>(null);
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", providerConfigId: "", note: "" });
  const [formError, setFormError] = useState<string | null>(null);

  const [reindexCaseId, setReindexCaseId] = useState("");
  const [reindexResult, setReindexResult] = useState<IndexResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<JobsResponse>("/ai-training/fine-tune-jobs");
      setData(res);
      if (res.licensed) {
        const [p, c] = await Promise.all([
          api<unknown>("/ai/providers").catch(() => []),
          api<unknown>("/cases", { query: { take: 100 } }).catch(() => []),
        ]);
        setProviders(asList<AiProvider>(p).filter((x) => x.isActive !== false));
        setCases(asList<CaseSummary>(c));
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof ApiError ? err.message : "Model eğitim işleri yüklenemedi.");
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
      await api("/ai-training/fine-tune-jobs", {
        method: "POST",
        body: {
          name: form.name.trim(),
          providerConfigId: form.providerConfigId,
          ...(form.note.trim() ? { note: form.note.trim() } : {}),
        },
      });
      setCreateOpen(false);
      setForm({ name: "", providerConfigId: "", note: "" });
      setNotice("İş açıldı (Hazırlandı). Manifesti indirip kendi sağlayıcınıza ELLE yükleyin; durumu buradan izleyin.");
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "İş açılamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(job: FineTuneJobRow, status: string) {
    let resultModelName: string | undefined;
    if (status === "TAMAMLANDI") {
      const name = window.prompt("Sağlayıcınızın döndürdüğü SONUÇ MODEL ADI (zorunlu):");
      if (!name || name.trim().length < 2) return;
      resultModelName = name.trim();
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/ai-training/fine-tune-jobs/${job.id}/status`, {
        method: "POST",
        body: { status, ...(resultModelName ? { resultModelName } : {}) },
      });
      setNotice(
        status === "TAMAMLANDI"
          ? `"${job.name}" tamamlandı. Sonuç modelini "Eğitilmiş Model İçe Aktar" ile sağlayıcı kaydı olarak ekleyip görev eşlemelerine bağlayabilirsiniz.`
          : `"${job.name}" durumu → ${STATUS_LABELS[status] ?? status}.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Durum değiştirilemedi.");
    } finally {
      setBusy(false);
    }
  }

  async function downloadManifest(job: FineTuneJobRow) {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ jsonl: string; count: number }>(`/ai-training/fine-tune-jobs/${job.id}/manifest`);
      const blob = new Blob([res.jsonl], { type: "application/jsonl" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `model-egitimi-${job.name.replace(/[^a-zA-Z0-9_-]+/g, "_")}.jsonl`;
      a.click();
      URL.revokeObjectURL(url);
      setNotice(`Manifest indirildi (${res.count} ONAYLANMIŞ örnek — yalnız büronuzun verisi). Sağlayıcınıza ELLE yükleyin.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Manifest indirilemedi.");
    } finally {
      setBusy(false);
    }
  }

  /** RAG'ı yeniden eğit = dosyanın belgelerini yeniden parçala/maskele/göm. */
  async function reindex() {
    if (!reindexCaseId) return;
    setBusy(true);
    setError(null);
    setReindexResult(null);
    try {
      const res = await api<IndexResult>(`/assistant/index/${reindexCaseId}`, { method: "POST", body: { force: true } });
      setReindexResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Yeniden indeksleme başarısız.");
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Model Eğitimi</h1>
      <p className="mt-1 text-sm text-slate-500">
        Kendi tanımladığınız model üzerinde eğitim işi açın, manifesti indirin, RAG dizinini yeniden oluşturun.
        Sağlayıcıya otomatik gönderim yoktur; her adım büronuzun denetim izine yazılır.
      </p>
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-6">
        {header}
        <Spinner />
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="space-y-6">
        {header}
        <Card>
          <p className="p-5 text-sm text-slate-600">
            Model eğitimi <strong>Ortak</strong> ve <strong>Yönetici</strong> rollerine açıktır — eğitim verisi ve
            sağlayıcı anahtarı kararıdır.
          </p>
        </Card>
      </div>
    );
  }

  if (data && !data.licensed) {
    return (
      <div className="space-y-6">
        {header}
        <Card>
          <div className="space-y-3 p-6">
            <p className="text-sm font-semibold text-slate-800">
              Planınız kendi model tanımlama/eğitim lisansı içermiyor
            </p>
            <p className="text-sm leading-6 text-slate-600">{data.licenseMessage}</p>
            <p className="text-xs text-slate-500">
              AI görevleriniz NomosOS platform sağlayıcılarından yürütülmeye devam eder. Lisans için{" "}
              <Link href="/app/ayarlar/ai-kullanim" className="underline">
                AI Kullanımı
              </Link>{" "}
              üzerinden ya da satış ekibimizle görüşün.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  const jobs = data?.items ?? [];
  const pool = data?.pool ?? { approvedCount: 0, byTaskType: {} };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {header}
        <Button variant="gold" onClick={() => { setFormError(null); setCreateOpen(true); }} disabled={pool.approvedCount === 0 || providers.length === 0}>
          Eğitim İşi Aç
        </Button>
      </div>

      {notice && <SuccessBox message={notice} />}
      {error && <ErrorBox message={error} />}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card title="Onaylı örnek havuzu (büronuz)">
          <p className="text-3xl font-semibold text-slate-900">{pool.approvedCount}</p>
          <p className="text-xs text-slate-500">
            rıza verilmiş ve onaylanmış örnek — yalnız bunlar manifeste girer.{" "}
            {pool.approvedCount === 0 && (
              <Link href="/app/ayarlar/ai-kullanim" className="underline">
                AI eğitim verisi rızası
              </Link>
            )}
          </p>
        </Card>
        <Card title="Tanımlı modelleriniz">
          <p className="text-3xl font-semibold text-slate-900">{providers.length}</p>
          <p className="text-xs text-slate-500">
            eğitim işi yalnız bunlardan birinde açılır ·{" "}
            <Link href="/app/ayarlar/ai-saglayici" className="underline">
              AI Sağlayıcı
            </Link>
          </p>
        </Card>
        <Card title="Açık işler">
          <p className="text-3xl font-semibold text-slate-900">
            {jobs.filter((j) => !["TAMAMLANDI", "BASARISIZ", "IPTAL"].includes(j.status)).length}
          </p>
          <p className="text-xs text-slate-500">Hazırlandı / Gönderildi / Eğitiliyor</p>
        </Card>
      </div>

      <Card title={jobs.length > 0 ? `${jobs.length} eğitim işi` : "Eğitim işleri"}>
        {jobs.length === 0 ? (
          <EmptyState message="Henüz model eğitim işi açılmamış." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {jobs.map((j) => (
              <li key={j.id} className="flex flex-wrap items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-slate-900">{j.name}</p>
                    <Badge tone={STATUS_TONES[j.status] ?? "gray"}>{STATUS_LABELS[j.status] ?? j.status}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {j.provider} · <code>{j.baseModel}</code> · {j.sampleCount} örnek ·{" "}
                    {new Date(j.createdAt).toLocaleDateString("tr-TR")}
                  </p>
                  {j.resultModelName && (
                    <p className="mt-1 font-mono text-xs text-emerald-700">sonuç modeli: {j.resultModelName}</p>
                  )}
                  {j.note && <p className="mt-1 text-xs text-slate-500">{j.note}</p>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(j.status === "HAZIRLANDI" || j.status === "GONDERILDI") && (
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => void downloadManifest(j)}>
                      Manifest
                    </Button>
                  )}
                  {(NEXT[j.status] ?? []).map((s) => (
                    <Button key={s} size="sm" variant="secondary" disabled={busy} onClick={() => void setStatus(j, s)}>
                      → {STATUS_LABELS[s] ?? s}
                    </Button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="RAG'ı yeniden eğit (dosya dizinini yeniden oluştur)">
        <p className="mb-3 text-xs text-slate-500">
          Gömme modelinizi değiştirdiyseniz ya da dosyaya yeni belgeler eklendiyse dosyanın belgeleri yeniden
          parçalanır, maskelenir ve gömülür. Ham metin dışarı çıkmaz; dış sağlayıcıya yalnız MASKELİ metin gider.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-80">
            <Field label="Dosya">
              <Select value={reindexCaseId} onChange={(e) => setReindexCaseId(e.target.value)}>
                <option value="">Dosya seçin…</option>
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                    {c.fileNumber ? ` · ${c.fileNumber}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Button variant="secondary" disabled={busy || !reindexCaseId} onClick={() => void reindex()}>
            {busy ? "İndeksleniyor…" : "Yeniden indeksle"}
          </Button>
        </div>
        {reindexResult && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
            <p>
              {reindexResult.documentCount} belge · {reindexResult.chunkCount} parça · erişim modu{" "}
              <strong>{reindexResult.retrievalMode === "EMBEDDING" ? "gömme" : "anahtar sözcük"}</strong>
              {reindexResult.embeddingModel ? ` (${reindexResult.embeddingModel})` : ""}
            </p>
            <p className="mt-1 text-slate-500">{reindexResult.notice}</p>
          </div>
        )}
      </Card>

      <Modal open={createOpen} title="Eğitim İşi Aç" onClose={() => setCreateOpen(false)}>
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            İş açıldığında büronuzun ONAYLANMIŞ havuzunun anlık görüntüsü ({pool.approvedCount} örnek) kaydedilir.
            Manifesti indirdikten sonra sağlayıcınıza ELLE yükleyin.
          </p>
          <Field label="İş adı">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Örn. 2026-Q4 dilekçe taslak modeli" />
          </Field>
          <Field label="Model (kendi tanımladıklarınız)" hint="Yalnız AI Sağlayıcı ekranında tanımladığınız aktif modeller seçilebilir.">
            <Select value={form.providerConfigId} onChange={(e) => setForm({ ...form, providerConfigId: e.target.value })}>
              <option value="">Model seçin…</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.defaultModel}
                  {p.origin === "IMPORTED" ? " (içe aktarıldı)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Not (isteğe bağlı)">
            <Textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </Field>
          {formError && <ErrorBox message={formError} />}
          <div className="flex justify-end gap-3 pt-1">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Vazgeç
            </Button>
            <Button onClick={() => void create()} disabled={busy || form.name.trim().length < 3 || !form.providerConfigId}>
              {busy ? "Açılıyor…" : "Aç"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
