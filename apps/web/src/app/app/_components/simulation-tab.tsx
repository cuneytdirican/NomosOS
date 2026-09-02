"use client";

/**
 * Dosya detayı → SİMÜLASYON sekmesi (Modül 16).
 *
 * Beş mod, her biri kendi JSON şemasıyla çalışan ayrı bir AI görevidir. Koşular
 * DEĞİŞTİRİLEMEZ (immutable): yeniden analiz = yeni koşu.
 *
 * ÜRÜN İLKESİ: hiçbir bulgu kendiliğinden göreve, dilekçeye ya da stratejiye
 * dönüşmez. Her çıktının başında "bu bir simülasyondur" şeridi durur; şerit
 * kapatılamaz, çünkü modun tamamı bir varsayım egzersizidir.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Disclosure,
  EmptyState,
  ErrorBox,
  Field,
  Select,
  Spinner,
} from "@/components/ui";
import { FeatureUnavailable, PiiApprovalBox, SourceQuote } from "@/components/ai-ui";
import { errText, isFeatureMissing } from "@/lib/faz2";
import {
  EVIDENCE_STATE_LABELS,
  EVIDENCE_STATE_TONES,
  LEANING_LABELS,
  LEANING_TONES,
  SEVERITY_LABELS,
  SEVERITY_TONES,
  SIMULATION_MODES,
  SIMULATION_MODE_HINTS,
  SIMULATION_MODE_LABELS,
  SIMULATION_MODE_TONES,
  WEAKNESS_TYPE_LABELS,
  fmtDateTime,
  labelOf,
} from "@/lib/labels";
import type { DocumentItem } from "@/lib/types";
import {
  listSimulations,
  runSimulation,
  simulationAssessment,
  simulationFindings,
  simulationLeaning,
} from "../_lib/faz4";
import type { SimFinding, SimulationRun } from "../_lib/faz4-types";
import { useAiCall } from "../_lib/use-ai-call";

type Notify = (text: string, tone?: "success" | "error" | "info") => void;

export function SimulationTab({
  caseId,
  documents,
  onNotify,
}: {
  caseId: string;
  documents: DocumentItem[];
  onNotify: Notify;
}) {
  const [runs, setRuns] = useState<SimulationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<string>("KARSI_TARAF_AVUKATI");
  const [targetDocumentId, setTargetDocumentId] = useState("");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMissing(false);
    try {
      const list = await listSimulations(caseId);
      setRuns(list);
      // Seçili koşu hâlâ listede mi? Değilse seçimi bırak — `activeRun` en yeni
      // koşuya düşer (liste sırası API'ye göre değişebilir, ilk eleman "en yeni"
      // demek değildir).
      setActiveRunId((prev) => (prev && list.some((r) => r.id === prev) ? prev : null));
    } catch (err) {
      if (isFeatureMissing(err)) setMissing(true);
      else setError(errText(err, "Simülasyon koşuları yüklenemedi."));
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const runFn = useCallback(
    (piiApproved: boolean) =>
      runSimulation(
        caseId,
        mode,
        mode === "KARSI_DILEKCE_ZAYIFLIK" && targetDocumentId
          ? { target_document_id: targetDocumentId }
          : {},
        piiApproved,
      ),
    [caseId, mode, targetDocumentId],
  );
  const runAi = useAiCall<SimulationRun>(runFn, "Simülasyon çalıştırılamadı.");

  const sortedRuns = useMemo(
    () => [...runs].sort((a, b) => (a.createdAt ?? "") < (b.createdAt ?? "") ? 1 : -1),
    [runs],
  );

  const activeRun = useMemo(
    () => sortedRuns.find((r) => r.id === activeRunId) ?? sortedRuns[0] ?? null,
    [sortedRuns, activeRunId],
  );

  async function start() {
    const res = await runAi.run();
    if (res) {
      onNotify(`${labelOf(SIMULATION_MODE_LABELS, mode)} simülasyonu tamamlandı.`, "success");
      setActiveRunId(res.id);
      await load();
    }
  }

  async function approvePii() {
    const res = await runAi.approvePii();
    if (res) {
      setActiveRunId(res.id);
      await load();
    }
  }

  if (loading) return <Spinner label="Simülasyon merkezi yükleniyor…" />;
  if (missing) {
    return (
      <FeatureUnavailable
        title="Simülasyon modları henüz hazır değil"
        detail="Simülasyon uçları yayına alındığında bu ekran otomatik olarak çalışacak."
        onRetry={() => void load()}
      />
    );
  }

  const needsDocument = mode === "KARSI_DILEKCE_ZAYIFLIK";

  return (
    <div className="space-y-6">
      {error && <ErrorBox message={error} />}

      {/* ---------- Mod seçimi ---------- */}
      <Card title="Simülasyon Modu Seçin">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {SIMULATION_MODES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                mode === m
                  ? "border-amber-500 bg-amber-50"
                  : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <p className="text-sm font-semibold text-slate-900">
                {labelOf(SIMULATION_MODE_LABELS, m)}
              </p>
              <p className="mt-1 text-[11px] leading-4 text-slate-500">
                {SIMULATION_MODE_HINTS[m]}
              </p>
            </button>
          ))}
        </div>

        {needsDocument && (
          <div className="mt-4">
            <Field
              label="Karşı tarafın dilekçesi"
              hint="Bu mod yalnızca karşı taraf menşeli bir belge seçiliyken çalışır."
            >
              <Select
                value={targetDocumentId}
                onChange={(e) => setTargetDocumentId(e.target.value)}
              >
                <option value="">Belge seçin…</option>
                {documents.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            {documents.length === 0 && (
              <p className="mt-1 text-xs text-slate-500">
                Dosyada belge yok. Önce Belgeler sekmesinden karşı tarafın dilekçesini yükleyin.
              </p>
            )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            variant="gold"
            disabled={runAi.busy || (needsDocument && !targetDocumentId)}
            onClick={() => void start()}
          >
            {runAi.busy ? "Çalıştırılıyor…" : "Simülasyonu Çalıştır"}
          </Button>
          <p className="text-[11px] text-slate-500">
            Koşular değiştirilemez; her çalıştırma yeni bir kayıt üretir.
          </p>
        </div>

        {runAi.pii && (
          <div className="mt-4">
            <PiiApprovalBox
              prompt={runAi.pii}
              busy={runAi.busy}
              onApprove={() => void approvePii()}
              onCancel={runAi.cancelPii}
            />
          </div>
        )}
        {runAi.missing && (
          <div className="mt-4">
            <FeatureUnavailable detail="Simülasyon çalıştırma ucu henüz yayında değil." />
          </div>
        )}
        {runAi.error && !runAi.missing && (
          <div className="mt-4">
            <ErrorBox message={runAi.error} />
          </div>
        )}
      </Card>

      {/* ---------- Aktif koşu çıktısı ---------- */}
      {activeRun && <RunResult run={activeRun} />}

      {/* ---------- Geçmiş koşular ---------- */}
      <Card title={`Geçmiş Koşular (${sortedRuns.length})`}>
        {sortedRuns.length === 0 ? (
          <EmptyState message="Bu dosyada simülasyon koşusu yok." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {sortedRuns.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
                    <Badge tone={SIMULATION_MODE_TONES[String(r.mode)] ?? "gray"}>
                      {labelOf(SIMULATION_MODE_LABELS, String(r.mode))}
                    </Badge>
                    {fmtDateTime(r.createdAt)}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {r.model ? `Model: ${r.model}` : "Model bilgisi yok"}
                    {typeof r.durationMs === "number"
                      ? ` · ${(r.durationMs / 1000).toFixed(1)} sn`
                      : ""}
                    {` · ${simulationFindings(r).length} bulgu`}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={r.id === activeRun?.id ? "primary" : "secondary"}
                  onClick={() => setActiveRunId(r.id)}
                >
                  {r.id === activeRun?.id ? "Görüntüleniyor" : "Görüntüle"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ---------- Karşılaştırma ---------- */}
      {sortedRuns.length >= 2 && (
        <Card title="İki Koşuyu Karşılaştır">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr] ">
            <Field label="Koşu A">
              <Select value={compareA} onChange={(e) => setCompareA(e.target.value)}>
                <option value="">Seçin…</option>
                {sortedRuns.map((r) => (
                  <option key={r.id} value={r.id}>
                    {labelOf(SIMULATION_MODE_LABELS, String(r.mode))} · {fmtDateTime(r.createdAt)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Koşu B">
              <Select value={compareB} onChange={(e) => setCompareB(e.target.value)}>
                <option value="">Seçin…</option>
                {sortedRuns.map((r) => (
                  <option key={r.id} value={r.id}>
                    {labelOf(SIMULATION_MODE_LABELS, String(r.mode))} · {fmtDateTime(r.createdAt)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <RunComparison
            a={sortedRuns.find((r) => r.id === compareA) ?? null}
            b={sortedRuns.find((r) => r.id === compareB) ?? null}
          />
        </Card>
      )}
    </div>
  );
}

// -------------------------------------------------------------- koşu çıktısı

function RunResult({ run }: { run: SimulationRun }) {
  const findings = simulationFindings(run);
  const leaning = simulationLeaning(run);
  const assessment = simulationAssessment(run);
  const mode = String(run.mode);

  return (
    <Card
      title={`${labelOf(SIMULATION_MODE_LABELS, mode)} — ${fmtDateTime(run.createdAt)}`}
      action={<Badge tone={SIMULATION_MODE_TONES[mode] ?? "gray"}>Simülasyon</Badge>}
    >
      <div className="space-y-4">
        <SimulationBanner />

        <p className="text-[11px] text-slate-500">
          {run.model ? `Model: ${run.model}` : "Model bilgisi yok"}
          {typeof run.durationMs === "number"
            ? ` · Süre: ${(run.durationMs / 1000).toFixed(1)} sn`
            : ""}
        </p>

        {leaning && (
          <p className="flex items-center gap-2 text-sm">
            <span className="text-slate-600">Hakimin genel eğilimi:</span>
            <Badge tone={LEANING_TONES[leaning.toUpperCase()] ?? "gray"}>
              {labelOf(LEANING_LABELS, leaning.toUpperCase())}
            </Badge>
          </p>
        )}

        {findings.length === 0 ? (
          <div className="space-y-3">
            {/* Model kaynak bulamadıysa ARGÜMAN UYDURMAZ (çekirdek prompt kuralı
                1-2) — boş liste dürüst yanıttır. Modelin NEDEN boş bıraktığını
                anlatan overallAssessment bu yüzden gösterilir; "boş koşu"nun
                kendisi bir bilgi değil, eksik veri işaretidir. */}
            {assessment ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-900">
                  Bu koşu kaynak temelli bulgu üretmedi — modelin değerlendirmesi:
                </p>
                <p className="mt-1.5 whitespace-pre-wrap text-xs leading-5 text-amber-900">
                  {assessment}
                </p>
              </div>
            ) : null}
            <EmptyState
              message={
                assessment
                  ? "Bulgu üretilmedi — yukarıdaki değerlendirmeye bakın."
                  : "Bu koşu görüntülenebilir bir bulgu üretmedi."
              }
            />
            <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] leading-4 text-slate-600">
              Simülasyon, dosyadaki BELGE METİNLERİYLE (dilekçe, karar, tutanak)
              çalışır — kaynaksız argüman üretemez. Dosyaya metni okunabilir
              belgeler yükleyip yeniden deneyin; OCR henüz çalışmadıysası
              birkaç dakika sonra tekrar deneyin.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {findings.map((f) => (
              <FindingCard key={f.key} finding={f} mode={mode} />
            ))}
          </ul>
        )}

        <Disclosure summary="Koşuya giren veriler (input snapshot)">
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-slate-600">
            {safeJson(run.inputSnapshotJson) ?? "Kayıt yok."}
          </pre>
        </Disclosure>
      </div>
    </Card>
  );
}

function FindingCard({ finding, mode }: { finding: SimFinding; mode: string }) {
  const severityKey = String(finding.severity ?? "").toUpperCase();
  return (
    <li className="rounded-lg border border-slate-200 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm font-semibold text-slate-900">
          {finding.rank ? `${finding.rank}. ` : ""}
          {finding.title}
        </p>
        {finding.severity && <SeverityBadge mode={mode} value={severityKey} />}
      </div>

      {finding.quote && <SourceQuote quote={finding.quote} />}

      {finding.fields.length > 0 && (
        <dl className="mt-2 space-y-1.5">
          {finding.fields.map((f, i) => (
            <div key={i} className="text-xs leading-5">
              <dt className="inline font-semibold text-slate-500">{f.label}: </dt>
              <dd className="inline text-slate-700">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {(finding.citations ?? []).length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {(finding.citations ?? []).map((c, i) => (
            <li key={i}>
              <Badge tone={c.verified ? "green" : "yellow"}>
                {c.ref ?? "Atıf"} {c.verified ? "· teyitli" : "· teyit bekliyor"}
              </Badge>
            </li>
          ))}
        </ul>
      )}

      {(finding.sourceRefs ?? []).length > 0 && (
        <div className="mt-2">
          {(finding.sourceRefs ?? []).map((r, i) => (
            <SourceQuote
              key={i}
              quote={r.quote ?? r.label ?? r.locator}
              source={r.documentName ?? r.documentId ?? undefined}
            />
          ))}
        </div>
      )}
    </li>
  );
}

function SeverityBadge({ mode, value }: { mode: string; value: string }) {
  if (mode === "KARSI_DILEKCE_ZAYIFLIK") {
    return <Badge tone="yellow">{labelOf(WEAKNESS_TYPE_LABELS, value)}</Badge>;
  }
  if (mode === "BILIRKISI_ODAGI") {
    return (
      <Badge tone={EVIDENCE_STATE_TONES[value] ?? "gray"}>
        {labelOf(EVIDENCE_STATE_LABELS, value)}
      </Badge>
    );
  }
  if (mode === "HAKIM_GOZU") {
    const map: Record<string, string> = { USUL: "Usul", ESAS: "Esas", EKSIK: "Eksik husus" };
    return <Badge tone="navy">{map[value] ?? value}</Badge>;
  }
  // KARSI_TARAF_AVUKATI için güç 1–10 sayısı gelir.
  const numeric = Number(value);
  if (!Number.isNaN(numeric) && value !== "") {
    const tone = numeric >= 8 ? "danger" : numeric >= 5 ? "yellow" : "gray";
    return <Badge tone={tone}>Güç {numeric}/10</Badge>;
  }
  return <Badge tone={SEVERITY_TONES[value] ?? "gray"}>{labelOf(SEVERITY_LABELS, value)}</Badge>;
}

/** Kapatılamayan uyarı şeridi — mod çıktısı bir varsayım egzersizidir. */
function SimulationBanner() {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-700">
      <span aria-hidden="true">🎭</span>
      <span>
        <strong>Bu bir simülasyondur.</strong> Çıktı, gerçek bir karşı vekilin, hakimin ya
        da bilirkişinin görüşü değildir; dosya verisinden üretilmiş bir varsayımdır. Hiçbir
        bulgu kendiliğinden göreve, süreye veya dilekçeye dönüşmez.
      </span>
    </p>
  );
}

// ------------------------------------------------------------ karşılaştırma

/**
 * İki koşunun BAŞLIK BAZLI karşılaştırması.
 *
 * Sunucuda bulgu kimliği tutulmadığı için eşleştirme bulgu başlığına göre
 * yapılır ve bu HEURİSTİKTİR: yeniden ifade edilmiş bir bulgu "yeni" görünebilir.
 * Ekranda da böyle etiketlenir; kesin diff için koşuların tam çıktısı okunmalıdır.
 */
function RunComparison({ a, b }: { a: SimulationRun | null; b: SimulationRun | null }) {
  if (!a || !b) {
    return (
      <p className="mt-3 text-xs text-slate-500">
        Karşılaştırmak için iki koşu seçin.
      </p>
    );
  }
  if (a.id === b.id) {
    return <p className="mt-3 text-xs text-red-600">İki farklı koşu seçmelisiniz.</p>;
  }
  if (String(a.mode) !== String(b.mode)) {
    return (
      <p className="mt-3 text-xs text-red-600">
        Yalnızca aynı moddaki koşular karşılaştırılabilir.
      </p>
    );
  }

  const fa = simulationFindings(a);
  const fb = simulationFindings(b);
  const norm = (t: string) => t.toLocaleLowerCase("tr-TR").replace(/\s+/g, " ").trim();
  const setA = new Set(fa.map((f) => norm(f.title)));
  const setB = new Set(fb.map((f) => norm(f.title)));

  const onlyA = fa.filter((f) => !setB.has(norm(f.title)));
  const onlyB = fb.filter((f) => !setA.has(norm(f.title)));
  const both = fa.filter((f) => setB.has(norm(f.title)));

  return (
    <div className="mt-4 space-y-3">
      <SimulationBanner />
      <p className="text-[11px] text-slate-500">
        Eşleştirme bulgu başlığına göre yapılır; yeniden ifade edilmiş bir bulgu
        &quot;yeni&quot; görünebilir.
      </p>
      <div className="grid gap-4 lg:grid-cols-3">
        <CompareColumn
          title={`Yalnız A'da (${fmtDateTime(a.createdAt)})`}
          tone="border-red-200 bg-red-50"
          items={onlyA}
        />
        <CompareColumn
          title={`Yalnız B'de (${fmtDateTime(b.createdAt)})`}
          tone="border-emerald-200 bg-emerald-50"
          items={onlyB}
        />
        <CompareColumn title="İkisinde de var" tone="border-slate-200 bg-white" items={both} />
      </div>
    </div>
  );
}

function CompareColumn({
  title,
  tone,
  items,
}: {
  title: string;
  tone: string;
  items: SimFinding[];
}) {
  return (
    <div className={`rounded-lg border px-4 py-3 ${tone}`}>
      <p className="text-xs font-semibold text-slate-700">
        {title} · {items.length}
      </p>
      {items.length === 0 ? (
        <p className="mt-1 text-xs text-slate-500">Yok.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {items.map((f) => (
            <li key={f.key} className="text-xs leading-5 text-slate-700">
              • {f.title}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function safeJson(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return null;
  }
}
