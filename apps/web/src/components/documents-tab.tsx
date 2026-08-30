"use client";

/**
 * Dosya detayı → Belgeler sekmesi.
 *
 * POST   /documents               (multipart, ilerleme göstergeli)
 * GET    /documents?caseId=
 * GET    /documents/:id/pipeline  → "Analiz ediliyor… → 3 öneri üretildi"
 * GET    /documents/:id/download  → ön-imzalı URL
 * PATCH  /documents/:id           → sınıf düzeltme (AI sınıflandırmasını ezer)
 * DELETE /documents/:id
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  deleteDocument,
  documentDownloadUrl,
  errText,
  getPipelineRun,
  isFeatureMissing,
  listCaseDocuments,
  listProposals,
  pipelineSteps,
  updateDocumentClass,
  uploadDocument,
} from "@/lib/faz2";
import type { ActionProposal, DocumentItem, PipelineRun } from "@/lib/types";
import { Badge, Button, Card, EmptyState, ErrorBox, Select, Spinner } from "@/components/ui";
import { ConfidenceMeter, FeatureUnavailable } from "@/components/ai-ui";
import {
  DOCUMENT_CLASS_LABELS,
  PIPELINE_STATUS_LABELS,
  PIPELINE_STATUS_TONES,
  PROCESSING_STATUS_LABELS,
  PROCESSING_STATUS_TONES,
  fmtBytes,
  fmtDateTime,
  labelOf,
} from "@/lib/labels";

/**
 * API'nin KABUL ETTİĞİ uzantılar (documents.dto.ts `ALLOWED_UPLOADS`).
 *
 * Liste eskiden `.doc/.tif/.tiff/.eml` de öneriyordu; kullanıcı dosyayı TAMAMEN
 * yükledikten sonra 415 alıyordu. İki liste artık BİREBİR aynıdır.
 */
const ALLOWED_EXTENSIONS = ["pdf", "docx", "jpg", "jpeg", "png", "txt", "udf"] as const;
const ACCEPTED = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(",");

/** API üst sınırı (documents.dto.ts MAX_UPLOAD_BYTES). İstemcide de kontrol edilir. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Yüklemeden ÖNCE uzantı + boyut denetimi; hata varsa Türkçe gerekçe döner. */
function preflight(file: File): string | null {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    return `Desteklenmeyen dosya türü (.${ext || "?"}). İzin verilenler: ${ALLOWED_EXTENSIONS.join(", ")}.`;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `Dosya ${(file.size / 1024 / 1024).toFixed(1)} MB; üst sınır 50 MB. Yükleme başlatılmadı.`;
  }
  if (file.size === 0) return "Dosya boş görünüyor.";
  return null;
}

/**
 * Hat ucu (/documents/:id/pipeline) henüz yayında değilse her belge satırı için
 * ayrı ayrı 404 istemenin anlamı yok — ilk başarısızlıkta oturum boyunca susarız.
 */
let pipelineEndpointDown = false;

interface UploadState {
  name: string;
  percent: number;
  error?: string | null;
  done?: boolean;
}

export function DocumentsTab({
  caseId,
  fallbackDocuments,
  onChanged,
  onNotify,
}: {
  caseId: string;
  /** Dosya detayında gömülü gelen liste — /documents ucu yoksa kullanılır. */
  fallbackDocuments: DocumentItem[];
  onChanged: () => void;
  onNotify: (text: string, tone?: "success" | "error" | "info") => void;
}) {
  const [docs, setDocs] = useState<DocumentItem[]>(fallbackDocuments);
  const [loading, setLoading] = useState(true);
  const [listMissing, setListMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [pipelines, setPipelines] = useState<Record<string, PipelineRun | null>>({});
  const [proposalsByDoc, setProposalsByDoc] = useState<Record<string, number>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listCaseDocuments(caseId);
      setDocs(list);
      setListMissing(false);
    } catch (err) {
      if (isFeatureMissing(err)) {
        // Faz 1 dosya detayında gömülü gelen liste hâlâ gösterilebilir.
        setDocs(fallbackDocuments);
        setListMissing(fallbackDocuments.length === 0);
      } else {
        setError(errText(err, "Belgeler yüklenemedi."));
      }
    } finally {
      setLoading(false);
    }
  }, [caseId, fallbackDocuments]);

  useEffect(() => {
    void load();
  }, [load]);

  // Dosyaya ait önerilerin belge bazında sayısı (rozet için).
  useEffect(() => {
    let alive = true;
    listProposals({ caseId, status: "BEKLIYOR", limit: 200 })
      .then((list: ActionProposal[]) => {
        if (!alive) return;
        const map: Record<string, number> = {};
        for (const p of list) {
          if (p.documentId) map[p.documentId] = (map[p.documentId] ?? 0) + 1;
        }
        setProposalsByDoc(map);
      })
      .catch(() => {
        /* öneri ucu yoksa rozet gösterilmez */
      });
    return () => {
      alive = false;
    };
  }, [caseId, docs.length]);

  const loadPipeline = useCallback(async (documentId: string) => {
    if (pipelineEndpointDown) {
      setPipelines((prev) => ({ ...prev, [documentId]: null }));
      return;
    }
    try {
      const run = await getPipelineRun(documentId);
      setPipelines((prev) => ({ ...prev, [documentId]: run }));
    } catch (err) {
      if (isFeatureMissing(err)) pipelineEndpointDown = true;
      setPipelines((prev) => ({ ...prev, [documentId]: null }));
    }
  }, []);

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setError(null);

    for (const file of list) {
      const entry: UploadState = { name: file.name, percent: 0 };
      setUploads((prev) => [...prev, entry]);
      const update = (patch: Partial<UploadState>) =>
        setUploads((prev) =>
          prev.map((u) => (u.name === entry.name && !u.done ? { ...u, ...patch } : u)),
        );

      // 300 MB'lık bir dosyayı tümüyle yükleyip 413 almak yerine burada dururuz.
      const problem = preflight(file);
      if (problem) {
        update({ error: problem, done: true });
        onNotify(`${file.name}: ${problem}`, "error");
        continue;
      }

      try {
        const doc = await uploadDocument({
          file,
          caseId,
          onProgress: (p) => update({ percent: p }),
        });
        update({ percent: 100, done: true });
        onNotify(`${file.name} yüklendi — belge analiz hattına alındı.`, "success");
        await load();
        onChanged();
        if (doc?.id) void loadPipeline(doc.id);
      } catch (err) {
        const msg = errText(err, "Yükleme başarısız oldu.");
        update({ error: msg, done: true });
        onNotify(`${file.name}: ${msg}`, "error");
      }
    }

    // Tamamlananları birkaç saniye sonra temizle.
    window.setTimeout(() => setUploads((prev) => prev.filter((u) => !u.done || u.error)), 4000);
  }

  async function handleDownload(doc: DocumentItem) {
    setBusyId(doc.id);
    try {
      const url = await documentDownloadUrl(doc.id);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      onNotify(errText(err, "İndirme bağlantısı alınamadı."), "error");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(doc: DocumentItem) {
    if (!window.confirm(`"${doc.name}" belgesi silinsin mi? Bu işlem geri alınamaz.`)) return;
    setBusyId(doc.id);
    try {
      await deleteDocument(doc.id);
      setDocs((prev) => prev.filter((d) => d.id !== doc.id));
      onNotify("Belge silindi.", "info");
      onChanged();
    } catch (err) {
      onNotify(errText(err, "Belge silinemedi."), "error");
    } finally {
      setBusyId(null);
    }
  }

  async function handleClassChange(doc: DocumentItem, next: string) {
    if (!next || next === doc.class) return;
    setBusyId(doc.id);
    try {
      await updateDocumentClass(doc.id, next);
      setDocs((prev) =>
        prev.map((d) => (d.id === doc.id ? { ...d, class: next, classSource: "MANUEL" } : d)),
      );
      onNotify(
        `Sınıf düzeltildi: ${labelOf(DOCUMENT_CLASS_LABELS, next)}. Düzeltmeniz AI için geri bildirim olarak kaydedildi.`,
        "success",
      );
    } catch (err) {
      onNotify(errText(err, "Sınıf güncellenemedi."), "error");
    } finally {
      setBusyId(null);
    }
  }

  const sorted = useMemo(
    () => [...docs].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")),
    [docs],
  );

  return (
    <div className="space-y-6">
      {/* Sürükle-bırak alanı */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files?.length) void handleFiles(e.dataTransfer.files);
        }}
        className={`rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
          dragging ? "border-amber-500 bg-amber-50" : "border-slate-300 bg-white"
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="mx-auto h-9 w-9 text-slate-400"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z"
          />
        </svg>
        <p className="mt-2 text-sm font-medium text-slate-700">
          Belgeleri buraya sürükleyin veya{" "}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="font-semibold text-amber-600 underline hover:text-amber-500"
          >
            bilgisayarınızdan seçin
          </button>
        </p>
        <p className="mt-1 text-xs text-slate-500">
          PDF, UDF, Word, görüntü ve e-posta dosyaları · Yükleme sonrası belge otomatik
          sınıflandırılır, metni çıkarılır ve aksiyon önerileri üretilir.
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {/* Yükleme ilerlemesi */}
      {uploads.length > 0 && (
        <ul className="space-y-2">
          {uploads.map((u, i) => (
            <li
              key={`${u.name}-${i}`}
              className={`rounded-lg border px-4 py-2.5 ${
                u.error ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="truncate font-medium text-slate-700">{u.name}</span>
                <span className={u.error ? "text-red-700" : "text-slate-500"}>
                  {u.error ? "Başarısız" : u.done ? "Yüklendi" : `%${u.percent}`}
                </span>
              </div>
              {!u.error && (
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-full rounded-full transition-all ${u.done ? "bg-emerald-500" : "bg-amber-500"}`}
                    style={{ width: `${u.percent}%` }}
                  />
                </div>
              )}
              {u.error && <p className="mt-1 text-xs text-red-700">{u.error}</p>}
            </li>
          ))}
        </ul>
      )}

      {error && <ErrorBox message={error} />}

      {/* Belge listesi */}
      <Card
        title={`Belgeler (${sorted.length})`}
        action={
          <Button size="sm" variant="secondary" onClick={() => void load()} disabled={loading}>
            Yenile
          </Button>
        }
      >
        {loading ? (
          <Spinner label="Belgeler yükleniyor…" />
        ) : listMissing ? (
          <FeatureUnavailable
            title="Belge yönetimi henüz hazır değil"
            detail="POST/GET /documents uçları yayına alındığında yüklediğiniz belgeler burada listelenecek; yükleme alanı şimdiden denenebilir."
            onRetry={() => void load()}
          />
        ) : sorted.length === 0 ? (
          <EmptyState message="Bu dosyada belge yok. Yukarıdaki alana bir tebligat veya karar sürükleyerek başlayın." />
        ) : (
          <ul className="space-y-3">
            {sorted.map((doc) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                busy={busyId === doc.id}
                pipeline={pipelines[doc.id]}
                pendingProposals={proposalsByDoc[doc.id] ?? 0}
                caseId={caseId}
                onLoadPipeline={() => void loadPipeline(doc.id)}
                onDownload={() => void handleDownload(doc)}
                onDelete={() => void handleDelete(doc)}
                onClassChange={(v) => void handleClassChange(doc, v)}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function DocumentRow({
  doc,
  busy,
  pipeline,
  pendingProposals,
  caseId,
  onLoadPipeline,
  onDownload,
  onDelete,
  onClassChange,
}: {
  doc: DocumentItem;
  busy: boolean;
  pipeline: PipelineRun | null | undefined;
  pendingProposals: number;
  caseId: string;
  onLoadPipeline: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onClassChange: (value: string) => void;
}) {
  const [editingClass, setEditingClass] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const aiClassified = doc.classSource === "AI";
  const confidence = doc.classConfidence ?? doc.confidence ?? null;
  const size = doc.size ?? doc.sizeBytes ?? null;

  useEffect(() => {
    if (pipeline === undefined) onLoadPipeline();
    // yalnızca ilk görünümde çek
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const steps = pipelineSteps(pipeline ?? null);

  return (
    <li className="rounded-lg border border-slate-200 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-slate-900">{doc.name}</p>
            <Badge tone="navy">{labelOf(DOCUMENT_CLASS_LABELS, doc.class)}</Badge>
            {aiClassified && <Badge tone="gold">AI</Badge>}
            {pendingProposals > 0 && (
              <Link href="/app/oneriler">
                <Badge tone="yellow">{pendingProposals} öneri bekliyor</Badge>
              </Link>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {fmtDateTime(doc.createdAt)}
            {size ? ` · ${fmtBytes(size)}` : ""}
            {doc.pageCount ? ` · ${doc.pageCount} sayfa` : ""}
            {doc.uploadedBy?.fullName ? ` · ${doc.uploadedBy.fullName}` : ""}
          </p>
          {aiClassified && confidence !== null && (
            <div className="mt-1.5">
              <ConfidenceMeter value={confidence} />
            </div>
          )}
          {doc.aiSummary && (
            <p className="mt-2 rounded bg-amber-50 px-2 py-1.5 text-xs leading-5 text-amber-900">
              <strong>AI özeti:</strong> {doc.aiSummary}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {doc.ocrStatus && (
            <Badge tone={PROCESSING_STATUS_TONES[doc.ocrStatus] ?? "gray"}>
              Metin: {labelOf(PROCESSING_STATUS_LABELS, doc.ocrStatus)}
            </Badge>
          )}
          {doc.chunkStatus && (
            <Badge tone={PROCESSING_STATUS_TONES[doc.chunkStatus] ?? "gray"}>
              Dizin: {labelOf(PROCESSING_STATUS_LABELS, doc.chunkStatus)}
            </Badge>
          )}
        </div>
      </div>

      {/* Hat durumu */}
      {pipeline && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Badge tone={PIPELINE_STATUS_TONES[pipeline.status] ?? "gray"}>
                {labelOf(PIPELINE_STATUS_LABELS, pipeline.status)}
              </Badge>
              {typeof pipeline.proposalCount === "number" && (
                <span className="text-xs text-slate-600">
                  {pipeline.proposalCount > 0
                    ? `→ ${pipeline.proposalCount} öneri üretildi`
                    : "→ öneri üretilmedi"}
                </span>
              )}
            </div>
            {steps.length > 0 && (
              <button
                type="button"
                onClick={() => setShowSteps((v) => !v)}
                className="text-[11px] font-medium text-slate-500 hover:text-amber-600"
              >
                {showSteps ? "Adımları gizle" : `Adımları göster (${steps.length})`}
              </button>
            )}
          </div>
          {pipeline.errorMessage && (
            <p className="mt-1.5 text-xs text-red-700">{pipeline.errorMessage}</p>
          )}
          {showSteps && steps.length > 0 && (
            <ol className="mt-2 space-y-1">
              {steps.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-[11px] text-slate-600">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                  <span>
                    <strong>{s.name ?? s.key ?? `Adım ${i + 1}`}</strong>
                    {s.status ? ` · ${s.status}` : ""}
                    {s.message ? ` — ${s.message}` : ""}
                    {typeof s.durationMs === "number" ? ` (${s.durationMs} ms)` : ""}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {pendingProposals > 0 && (
            <Link
              href="/app/oneriler"
              className="mt-2 inline-block text-xs font-semibold text-amber-600 hover:text-amber-500"
            >
              {pendingProposals} öneriyi incele ve onayla →
            </Link>
          )}
        </div>
      )}

      {/* Eylemler */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" disabled={busy} onClick={onDownload}>
          İndir
        </Button>
        {editingClass ? (
          <div className="flex items-center gap-2">
            <Select
              autoFocus
              defaultValue={doc.class ?? "DIGER"}
              onChange={(e) => {
                onClassChange(e.target.value);
                setEditingClass(false);
              }}
              className="w-52 py-1 text-xs"
            >
              {Object.entries(DOCUMENT_CLASS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="ghost" onClick={() => setEditingClass(false)}>
              Vazgeç
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditingClass(true)}>
            Sınıfı Düzelt
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={busy} onClick={onDelete}>
          Sil
        </Button>
        <Link
          href={`/app/dosyalar/${caseId}?sekme=ai&belge=${doc.id}`}
          className="ml-auto text-xs font-medium text-slate-500 hover:text-amber-600"
        >
          Asistana sor →
        </Link>
      </div>
    </li>
  );
}
