"use client";

/**
 * Dilekçe Stüdyosu — büro geneli dilekçe yazma ekranı (Modül 22).
 *
 * GET    /petitions                    — büro geneli liste (dosya/ürün/durum süzgeci)
 * GET    /petition-templates           — şablon kütüphanesi
 * POST   /petitions                    — şablondan boş taslak aç
 * GET    /petitions/:id                — sürümler + bölümler + teyit kapısı
 * POST   /petitions/:id/generate       — PETITION_DRAFT (AI, bölüm bölüm)
 * POST   /petitions/:id/sections/:key/rewrite — tek bölümü yeniden yaz (AI)
 * POST   /petitions/:id/verify         — Teyit Ajanı (deterministik)
 * PATCH  /petitions/:id/status         — TASLAK→TEYIT→…→HAZIR (kapı HAZIR'da)
 * POST   /petitions/:id/versions       — elle düzenleme (yeni SÜRÜM, geri alınamaz)
 * POST   /petitions/:id/export/udf    — UDF üretimi + ön-imzalı indirme
 *
 * ÜRÜN İLKESİ: AI taslağı ÖNERİDİR — bölümler avukat onayına kadar TASLAK'tır.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { exportPetitionUdf } from "@/lib/faz2";
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
} from "@/components/ui";

/* ----------------------------- Tipler ----------------------------- */

interface StudioPetition {
  id: string;
  caseId: string;
  case: {
    id: string;
    title: string;
    fileNumber: string | null;
    status: string;
    client: { id: string; name: string };
  } | null;
  type: string;
  title: string;
  status: string;
  latestVersionNo: number;
  createdAt: string;
  updatedAt: string;
}

interface CaseOption {
  id: string;
  title: string;
  fileNumber: string | null;
  clientName?: string;
}

interface PetitionTemplate {
  id: string;
  key: string;
  name: string;
  petitionType: string;
  isSystem: boolean;
}

interface PetitionSection {
  key: string;
  title: string;
  body: string;
  origin?: "TEMPLATE" | "AI" | "MANUAL";
  hint?: string;
  required?: boolean;
}

interface PetitionDetail {
  id: string;
  caseId: string;
  type: string;
  title: string;
  status: string;
  currentVersion: {
    id: string;
    versionNo: number;
    sections: PetitionSection[];
  } | null;
  versions?: Array<{ id: string; versionNo: number; createdAt: string }>;
  readyGate?: { ready: boolean; reasons?: string[] };
}

/** D5 / cila — sürüm farkı yanıtı (GET /petitions/:id/versions/diff). */
interface VersionDiffSection {
  key: string;
  title: string;
  change: "ADDED" | "REMOVED" | "CHANGED" | "UNCHANGED";
  lines: Array<{ op: "same" | "added" | "removed"; text: string }>;
  addedLines: number;
  removedLines: number;
}

interface VersionDiff {
  from: { versionNo: number; createdAt: string };
  to: { versionNo: number; createdAt: string };
  summary: {
    addedSections: number;
    removedSections: number;
    changedSections: number;
    unchangedSections: number;
    addedLines: number;
    removedLines: number;
  };
  sections: VersionDiffSection[];
}

const PETITION_TYPE_LABELS: Record<string, string> = {
  DAVA_DILEKCESI: "Dava Dilekçesi",
  CEVAP: "Cevap Dilekçesi",
  CEVABA_CEVAP: "Cevaba Cevap",
  IKINCI_CEVAP: "İkinci Cevap",
  ISTINAF: "İstinaf Dilekçesi",
  TEMYIZ: "Temyiz Dilekçesi",
  ITIRAZ: "İtiraz Dilekçesi",
  DELIL_LISTESI: "Delil Listesi",
  ISLAH: "Islah Dilekçesi",
  BILIRKISI_ITIRAZ: "Bilirkişi Raporuna İtiraz",
  ICRA_TAKIP_TALEBI: "İcra Takip Talebi",
  SIKAYET: "Şikâyet Dilekçesi",
  BEYAN: "Beyan",
  DIGER: "Diğer",
};

const PETITION_STATUS_LABELS: Record<string, string> = {
  TASLAK: "Taslak",
  TEYIT_EDILIYOR: "Teyit ediliyor",
  TEYIT_EDILDI: "Teyit edildi",
  INCELEMEDE: "İnceleniyor",
  HAZIR: "Hazır",
  DISA_AKTARILDI: "Dışa aktarıldı",
  GONDERILDI: "Gönderildi",
};

const STATUS_TONES: Record<string, "gray" | "blue" | "yellow" | "green" | "navy"> = {
  TASLAK: "gray",
  TEYIT_EDILIYOR: "yellow",
  TEYIT_EDILDI: "blue",
  INCELEMEDE: "blue",
  HAZIR: "green",
  DISA_AKTARILDI: "navy",
  GONDERILDI: "navy",
};

export default function DilekceStudyoPage() {
  const [rows, setRows] = useState<StudioPetition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const [cases, setCases] = useState<CaseOption[]>([]);
  const [templates, setTemplates] = useState<PetitionTemplate[]>([]);

  const [newOpen, setNewOpen] = useState(false);
  const [newCaseId, setNewCaseId] = useState("");
  const [newType, setNewType] = useState("DAVA_DILEKCESI");
  const [newTitle, setNewTitle] = useState("");
  const [newBusy, setNewBusy] = useState(false);
  const [newError, setNewError] = useState<string | null>(null);

  const [detail, setDetail] = useState<PetitionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // D5 / cila — sürüm fark görünümü
  const [diffFrom, setDiffFrom] = useState<number | null>(null);
  const [diffTo, setDiffTo] = useState<number | null>(null);
  const [diffData, setDiffData] = useState<VersionDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diffShowAll, setDiffShowAll] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [udfUrl, setUdfUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<unknown>("/petitions", { query: q ? { q } : undefined });
      setRows(Array.isArray(data) ? (data as StudioPetition[]) : []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Dilekçeler yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  // Yeni dilekçe modalı için dosya + şablon listeleri.
  useEffect(() => {
    if (!newOpen || cases.length > 0) return;
    void (async () => {
      try {
        const res = await api<unknown>("/cases", { query: { limit: 200 } });
        const items = (Array.isArray(res) ? res : ((res as { items?: unknown[] }).items ?? [])) as Array<{
          id: string;
          title: string;
          fileNumber: string | null;
          client?: { name?: string };
        }>;
        setCases(
          items.map((c) => ({
            id: c.id,
            title: c.title,
            fileNumber: c.fileNumber,
            clientName: c.client?.name,
          })),
        );
      } catch {
        // Modal içinde dosya listesi gelmezse avukat yine de küçük listeyle çalışır.
      }
      try {
        const t = await api<unknown>("/petition-templates");
        setTemplates((Array.isArray(t) ? t : []) as PetitionTemplate[]);
      } catch {
        /* şablonlar isteğe bağlı */
      }
    })();
  }, [newOpen, cases.length]);

  async function openDetail(id: string) {
    setDetailLoading(true);
    setDetailError(null);
    setActionError(null);
    setUdfUrl(null);
    try {
      setDetail(await api<PetitionDetail>(`/petitions/${id}`));
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : "Dilekçe açılamadı.");
    } finally {
      setDetailLoading(false);
    }
  }

  /** D5 / cila — iki sürüm arasındaki farkı sunucudan çeker (LCS sunucuda). */
  async function loadDiff() {
    if (!detail || diffFrom === null || diffTo === null) return;
    setDiffLoading(true);
    setDiffError(null);
    try {
      const data = await api<VersionDiff>(`/petitions/${detail.id}/versions/diff`, {
        query: { from: String(diffFrom), to: String(diffTo) },
      });
      setDiffData(data);
    } catch (err) {
      setDiffError(err instanceof ApiError ? err.message : "Sürüm farkı alınamadı.");
    } finally {
      setDiffLoading(false);
    }
  }

  async function handleCreate() {
    setNewBusy(true);
    setNewError(null);
    try {
      const template = templates.find((t) => t.petitionType === newType);
      const created = await api<{ id: string }>("/petitions", {
        method: "POST",
        body: {
          caseId: newCaseId,
          type: newType,
          ...(template ? { templateId: template.id } : {}),
          ...(newTitle.trim() ? { title: newTitle.trim() } : {}),
        },
      });
      setNewOpen(false);
      setNewCaseId("");
      setNewTitle("");
      await load();
      await openDetail(created.id);
    } catch (err) {
      setNewError(err instanceof ApiError ? err.message : "Dilekçe açılamadı.");
    } finally {
      setNewBusy(false);
    }
  }

  /** PETITION_DRAFT — dosya bağlamından bölüm bölüm AI taslağı. */
  async function handleGenerate(piiApproved: boolean) {
    if (!detail) return;
    setBusyAction("generate");
    setActionError(null);
    try {
      await api(`/petitions/${detail.id}/generate`, {
        method: "POST",
        body: { piiApproved },
      });
      await openDetail(detail.id);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Taslak üretilemedi.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRewrite(sectionKey: string) {
    if (!detail) return;
    const instruction = window.prompt(
      "Bu bölüm için yeniden yazım talimatı (ne değişsin?):",
    );
    if (!instruction || instruction.trim().length < 3) return;
    setBusyAction(`rewrite-${sectionKey}`);
    setActionError(null);
    try {
      await api(`/petitions/${detail.id}/sections/${sectionKey}/rewrite`, {
        method: "POST",
        body: { instruction: instruction.trim() },
      });
      await openDetail(detail.id);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Bölüm yeniden yazılamadı.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleVerify() {
    if (!detail) return;
    setBusyAction("verify");
    setActionError(null);
    try {
      await api(`/petitions/${detail.id}/verify`, { method: "POST" });
      await openDetail(detail.id);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Teyit çalıştırılamadı.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleStatus(status: string) {
    if (!detail) return;
    setBusyAction("status");
    setActionError(null);
    try {
      await api(`/petitions/${detail.id}/status`, {
        method: "PATCH",
        body: { status },
      });
      await openDetail(detail.id);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Durum değiştirilemedi.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleExportUdf() {
    if (!detail) return;
    setBusyAction("udf");
    setActionError(null);
    try {
      // exportPetitionUdf: imzalı URL (downloadUrl) ya da üretilen belge —
      // sunucu sözleşmesiyle hizalı tek yardımcı; ayrıca mevzuat atıf beyanı
      // gerekiyorsa 422 hatasını anlaşılır biçimde iletir.
      setUdfUrl(await exportPetitionUdf(detail.id));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "UDF üretilemedi.");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dilekçe Stüdyosu</h1>
          <p className="mt-1 text-sm text-slate-500">
            Şablondan açın, AI taslağı bölüm bölüm üretsin, atıfları teyit edin, UDF olarak indirin.
          </p>
        </div>
        <Button variant="gold" onClick={() => setNewOpen(true)}>
          + Yeni Dilekçe
        </Button>
      </div>

      <Card>
        <div className="mb-4">
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Dilekçe başlığı ara…"
            aria-label="Dilekçe ara"
          />
        </div>
        {loading ? (
          <Spinner />
        ) : error ? (
          <ErrorBox message={error} />
        ) : rows.length === 0 ? (
          <EmptyState
            message={
              q
                ? "Aramanızla eşleşen dilekçe yok."
                : "Henüz dilekçe yok. «+ Yeni Dilekçe» ile bir dosyaya şablondan taslak açın."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-4 font-medium">Dilekçe</th>
                  <th className="py-2 pr-4 font-medium">Dosya</th>
                  <th className="py-2 pr-4 font-medium">Tür</th>
                  <th className="py-2 pr-4 font-medium">Durum</th>
                  <th className="py-2 font-medium">Güncelleme</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => void openDetail(p.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        void openDetail(p.id);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label={`Dilekçe ${p.title} — aç`}
                    className="cursor-pointer outline-none transition-colors hover:bg-slate-50 focus-visible:bg-amber-50 focus-visible:ring-1 focus-visible:ring-amber-400"
                  >
                    <td className="py-3 pr-4">
                      <p className="font-medium text-slate-900">{p.title}</p>
                      <p className="text-xs text-slate-500">Sürüm {p.latestVersionNo}</p>
                    </td>
                    <td className="py-3 pr-4">
                      <p className="text-slate-700">{p.case?.title ?? "—"}</p>
                      <p className="text-xs text-slate-500">
                        {p.case?.fileNumber ?? "esas no yok"}
                        {p.case?.client?.name ? ` · ${p.case.client.name}` : ""}
                      </p>
                    </td>
                    <td className="py-3 pr-4 text-slate-600">
                      {PETITION_TYPE_LABELS[p.type] ?? p.type}
                    </td>
                    <td className="py-3 pr-4">
                      <Badge tone={STATUS_TONES[p.status] ?? "gray"}>
                        {PETITION_STATUS_LABELS[p.status] ?? p.status}
                      </Badge>
                    </td>
                    <td className="py-3 text-xs text-slate-500">
                      {new Date(p.updatedAt).toLocaleString("tr-TR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ---------- Yeni dilekçe modalı ---------- */}
      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="Yeni Dilekçe">
        <div className="space-y-4">
          <Field label="Dosya" hint="Dilekçe bir dosyaya bağlıdır.">
            <Select value={newCaseId} onChange={(e) => setNewCaseId(e.target.value)}>
              <option value="">Dosya seçin…</option>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                  {c.fileNumber ? ` (${c.fileNumber})` : ""}
                  {c.clientName ? ` — ${c.clientName}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Dilekçe türü" hint="Seçilen türe uygun şablon kullanılır.">
            <Select value={newType} onChange={(e) => setNewType(e.target.value)}>
              {Object.entries(PETITION_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Başlık (isteğe bağlı)" hint="Boş bırakılırsa şablon adı kullanılır.">
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Örn. Islah dilekçesi — talep artırımı"
              maxLength={200}
            />
          </Field>
          {newError && <ErrorBox message={newError} />}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setNewOpen(false)}>
              Vazgeç
            </Button>
            <Button disabled={newBusy || !newCaseId} onClick={() => void handleCreate()}>
              {newBusy ? "Açılıyor…" : "Taslağı Aç"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ---------- Dilekçe detay modalı ---------- */}
      <Modal
        open={detail !== null}
        onClose={() => {
          setDetail(null);
          setDiffFrom(null);
          setDiffTo(null);
          setDiffData(null);
          setDiffError(null);
          setDiffShowAll(false);
        }}
        title={detail?.title ?? "Dilekçe"}
      >
        {detailLoading ? (
          <Spinner label="Dilekçe açılıyor…" />
        ) : detailError ? (
          <ErrorBox message={detailError} />
        ) : detail ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONES[detail.status] ?? "gray"}>
                {PETITION_STATUS_LABELS[detail.status] ?? detail.status}
              </Badge>
              <Badge tone="navy">{PETITION_TYPE_LABELS[detail.type] ?? detail.type}</Badge>
              {detail.currentVersion && (
                <span className="text-xs text-slate-500">
                  Sürüm {detail.currentVersion.versionNo}
                </span>
              )}
            </div>

            {/* Ürün ilkesi şeridi: AI önerir, avukat onaylar. */}
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-4 text-amber-800">
              AI taslağı ÖNERİDİR; atıflar Teyit Ajanı'ndan geçmeden dilekçe HAZIR olmaz.
              Bölümleri gözden geçirin, gerekirse yeniden yazdırın.
            </p>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="gold"
                disabled={busyAction !== null}
                onClick={() => void handleGenerate(false)}
              >
                {busyAction === "generate" ? "Üretiliyor…" : "AI ile Taslak Üret"}
              </Button>
              <Button
                variant="secondary"
                disabled={busyAction !== null}
                onClick={() => void handleVerify()}
              >
                {busyAction === "verify" ? "Teyit ediliyor…" : "Atıfları Teyit Et"}
              </Button>
              {detail.status !== "HAZIR" && (
                <Button
                  variant="secondary"
                  disabled={busyAction !== null}
                  onClick={() => void handleStatus("HAZIR")}
                >
                  Hazır İşaretle
                </Button>
              )}
              <Button
                variant="secondary"
                disabled={busyAction !== null || detail.status === "TASLAK"}
                onClick={() => void handleExportUdf()}
              >
                {busyAction === "udf" ? "UDF üretiliyor…" : "UDF olarak indir"}
              </Button>
            </div>

            {detail.readyGate && !detail.readyGate.ready && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                <p className="font-semibold">Hazırlık kapısı kapalı:</p>
                <ul className="mt-1 list-inside list-disc space-y-0.5">
                  {(detail.readyGate.reasons ?? []).map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
            {udfUrl && (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                UDF üretildi —{" "}
                <a href={udfUrl} className="font-medium underline" rel="noreferrer">
                  dosyayı indir
                </a>{" "}
                (bağlantı kısa süreli geçerlidir).
              </p>
            )}
            {actionError && <ErrorBox message={actionError} />}

            {/* Bölümler */}
            {!detail.currentVersion ? (
              <EmptyState message="Bu dilekçede henüz sürüm yok. «AI ile Taslak Üret» ile başlayın." />
            ) : (
              <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
                {detail.currentVersion.sections.map((s) => (
                  <div key={s.key} className="rounded-lg border border-slate-200 p-3">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-800">{s.title}</p>
                      <div className="flex items-center gap-2">
                        {s.origin === "AI" && <Badge tone="yellow">AI taslağı</Badge>}
                        {s.origin === "MANUAL" && <Badge tone="blue">elle</Badge>}
                        <button
                          type="button"
                          className="text-xs font-medium text-amber-700 underline"
                          disabled={busyAction !== null}
                          onClick={() => void handleRewrite(s.key)}
                        >
                          {busyAction === `rewrite-${s.key}` ? "Yazılıyor…" : "Yeniden yazdır"}
                        </button>
                      </div>
                    </div>
                    {s.body ? (
                      <p className="whitespace-pre-wrap text-xs leading-5 text-slate-700">
                        {s.body}
                      </p>
                    ) : (
                      <p className="text-xs italic text-slate-500">
                        {s.hint ?? "Bu bölüm henüz boş."}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ---------- Sürüm farkı (D5 / cila) ---------- */}
            {(detail.versions?.length ?? 0) > 1 && (
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-800">
                    Sürümler ({detail.versions!.length}) — fark karşılaştırması
                  </p>
                  {diffData && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setDiffShowAll(!diffShowAll)}>
                        {diffShowAll ? "Yalnız değişenler" : "Tüm bölümler"}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => { setDiffData(null); setDiffError(null); }}>
                        Kapat
                      </Button>
                    </div>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                  {detail.versions!.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => {
                        if (diffFrom === null) { setDiffFrom(v.versionNo); return; }
                        if (diffTo === null && v.versionNo !== diffFrom) setDiffTo(v.versionNo);
                      }}
                      className={[
                        "rounded-full border px-2.5 py-1 transition",
                        diffFrom === v.versionNo || diffTo === v.versionNo
                          ? "border-amber-500 bg-amber-50 font-semibold text-amber-800"
                          : "border-slate-300 text-slate-600 hover:border-amber-400",
                      ].join(" ")}
                      title={new Date(v.createdAt).toLocaleString("tr-TR")}
                    >
                      v{v.versionNo}
                    </button>
                  ))}
                  <span className="ml-1 text-slate-500">
                    {diffFrom === null
                      ? "— önce ilk sürümü seçin"
                      : diffTo === null
                        ? "— sonra karşılaştırılacak sürümü seçin"
                        : `v${diffFrom} → v${diffTo}`}
                  </span>
                  {diffFrom !== null && (
                    <button
                      type="button"
                      className="text-amber-700 underline"
                      onClick={() => { setDiffFrom(null); setDiffTo(null); setDiffData(null); }}
                    >
                      sıfırla
                    </button>
                  )}
                  <Button
                    size="sm"
                    disabled={diffLoading || diffFrom === null || diffTo === null}
                    onClick={() => void loadDiff()}
                  >
                    {diffLoading ? "Hesaplanıyor…" : "Farkı Göster"}
                  </Button>
                </div>

                {diffError && <ErrorBox message={diffError} />}

                {diffData && (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs text-slate-600">
                      v{diffData.from.versionNo} → v{diffData.to.versionNo}:{" "}
                      <strong>{diffData.summary.changedSections}</strong> bölüm değişti,{" "}
                      <strong>{diffData.summary.addedSections}</strong> eklendi,{" "}
                      <strong>{diffData.summary.removedSections}</strong> çıkarıldı ·{" "}
                      <span className="text-emerald-700">+{diffData.summary.addedLines} satır</span>{" "}
                      <span className="text-red-700">−{diffData.summary.removedLines} satır</span>
                    </p>
                    <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                      {diffData.sections
                        .filter((s) => diffShowAll || s.change !== "UNCHANGED")
                        .map((s) => (
                          <div key={s.key} className="rounded-lg border border-slate-200 p-2">
                            <div className="mb-1 flex flex-wrap items-center gap-2">
                              <p className="text-sm font-semibold text-slate-800">{s.title}</p>
                              {s.change === "ADDED" && <Badge tone="green">eklendi</Badge>}
                              {s.change === "REMOVED" && <Badge tone="red">çıkarıldı</Badge>}
                              {s.change === "CHANGED" && <Badge tone="yellow">değişti</Badge>}
                              {s.change === "UNCHANGED" && <Badge tone="gray">değişmedi</Badge>}
                            </div>
                            <pre className="overflow-x-auto rounded bg-slate-50 p-2 text-[11px] leading-5">
                              {s.lines.map((l, i) => (
                                <span
                                  key={i}
                                  className={
                                    l.op === "added"
                                      ? "block bg-emerald-50 text-emerald-800"
                                      : l.op === "removed"
                                        ? "block bg-red-50 text-red-800 line-through decoration-red-300"
                                        : "block text-slate-600"
                                  }
                                >
                                  {l.op === "added" ? "+ " : l.op === "removed" ? "− " : "  "}
                                  {l.text}
                                </span>
                              ))}
                            </pre>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <p className="text-[11px] text-slate-500">
              Dilekçe dosyasına bağlıdır —{" "}
              {detail.caseId ? (
                <Link href={`/app/dosyalar/${detail.caseId}`} className="underline">
                  dosyayı aç
                </Link>
              ) : null}
            </p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
