"use client";

/**
 * SÖZLEŞME DETAYI — Sözleşme Analizi ve Simülasyon (ÇOK SAYFALI ÖLÇEK).
 *
 * SEKMELER:
 *  · Genel bakış — akış zaman çizelgesi (SON N olay + "daha fazla"; 30 sn
 *    yoklamayla canlı), güncel risk skoru + dağılım, son analizden iki taraflı
 *    özet (ilk 8 bulgu + "tümünü göster").
 *  · Metin + Şerhler — güncel sürüm metni SAYFA PENCERELERİYLE yüklenir
 *    (sayfa seçici + önceki/sonraki pencere); yüzlerce sayfalık sözleşmede
 *    binlerce DOM düğümü ÜRETİLMEZ. Şerhler sunucudan SAYFALI gelir.
 *  · Versiyonlar — iki sürüm seç → sayfa pencereli diff (yalnızca değişen
 *    sayfalar, sayfa seçiciyle gezinilir).
 *  · Analizler — koşu arşivi; her koşu iki perspektifli rapor + parça künyesi.
 *
 * İŞLEMLER: analiz çalıştır (ILK/REVIZYON/NIHAI — parça sayısı ve tahmini
 * kredi modalda GÖSTERİLİR), yeni sürüm, şerh kapat (gerekçe zorunlu),
 * müvekkile kritik şerh özeti gönder (portal yayını), otomatik bildirim kipi
 * (PARTNER+).
 *
 * Skor, diff ve sayfalama SUNUCUDAN gelir; bu ekran hiçbir hukuki ölçüm ve
 * hiçbir büyük listeyi TEK İSTEKTE çekmez.
 */

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  Disclosure,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  SuccessBox,
  Tabs,
  tabPanelProps,
  Textarea,
} from "@/components/ui";
import { AiDisclaimer, PiiApprovalBox, ToastStack, useToasts } from "@/components/ai-ui";
import { CreditBadge, useCreditCosts } from "@/components/credits";
import { errText } from "@/lib/faz2";
import {
  CONTRACT_ANALYSIS_MODE_LABELS,
  CONTRACT_ANALYSIS_MODES,
  CONTRACT_ANNOTATION_STATUS_LABELS,
  CONTRACT_ANNOTATION_STATUS_TONES,
  CONTRACT_EVENT_TYPE_LABELS,
  CONTRACT_RISK_BAND_LABELS,
  CONTRACT_RISK_BAND_TONES,
  CONTRACT_SEVERITY_TONES,
  CONTRACT_STATUS_LABELS,
  CONTRACT_STATUS_TONES,
  SEVERITY_LABELS,
  SEVERITY_TONES,
  fmtDate,
  fmtDateTime,
  labelOf,
} from "@/lib/labels";
import { useAiCall } from "../../_lib/use-ai-call";
import {
  createContractVersion,
  getContract,
  isFeatureMissing,
  listContractVersions,
} from "../../_lib/faz5";
import type { ContractItem, ContractVersionItem } from "../../_lib/faz5-types";
import {
  annotationsForBlock,
  blockSeverity,
  closeAnnotation,
  getAnalysisEstimate,
  getContractDiff,
  getContractVersionTextPage,
  getNotifyMode,
  getRiskSummary,
  listAnalyses,
  listAnnotations,
  listEvents,
  notifyClient,
  runAnalysis,
  setNotifyMode,
  splitClauses,
} from "../../_lib/contract-analysis";
import type {
  ContractAnalysisEstimate,
  ContractAnalysisMode,
  ContractAnalysisResult,
  ContractAnalysisRunItem,
  ContractAnnotation,
  ContractEventItem,
  ContractRiskSummary,
  ContractVersionDiffResult,
} from "../../_lib/contract-analysis-types";

const TABS = [
  { key: "ozet", label: "Genel bakış" },
  { key: "metin", label: "Metin + Şerhler" },
  { key: "versiyonlar", label: "Versiyonlar" },
  { key: "analizler", label: "Analiz arşivi" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/** Şerh kenarlık rengi — KRITIK kırmızı, ORTA turuncu, DUSUK sarı. */
const SEVERITY_BORDER: Record<string, string> = {
  KRITIK: "border-l-4 border-l-red-600",
  ORTA: "border-l-4 border-l-orange-400",
  DUSUK: "border-l-4 border-l-amber-300",
};

const EVENTS_POLL_MS = 30_000;
/** Zaman çizelgesi: ilk yükte/görünümde tutulan olay sayısı (geçmişe yükleme ile artar). */
const EVENTS_PAGE_SIZE = 20;
/** Zaman çizelgesinde aynı anda bellekte tutulabilecek azami olay (DOM tavanı). */
const EVENTS_MAX_LOADED = 100;
/** Şerh listesi sayfa boyutu (sunucu take/skip ile döner). */
const ANNOTATIONS_PAGE_SIZE = 100;
/** Metin sekmesi: tek pencerede yüklenen sanal sayfa sayısı (≈5 sayfa ≈ 15.000 karakter). */
const TEXT_WINDOW_PAGES = 5;
/** Perspektif panelinde ilk gösterilen bulgu sayısı (kalan "tümünü göster" ile açılır). */
const FINDINGS_PREVIEW = 8;

export default function SozlesmeDetayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { toasts, push, dismiss } = useToasts();

  const [contract, setContract] = useState<ContractItem | null>(null);
  const [versions, setVersions] = useState<ContractVersionItem[]>([]);
  const [annotations, setAnnotations] = useState<ContractAnnotation[]>([]);
  const [annotationsTotal, setAnnotationsTotal] = useState(0);
  const [annotationsBusy, setAnnotationsBusy] = useState(false);
  const [analyses, setAnalyses] = useState<ContractAnalysisRunItem[]>([]);
  const [events, setEvents] = useState<ContractEventItem[]>([]);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [eventsBusy, setEventsBusy] = useState(false);
  const [risk, setRisk] = useState<ContractRiskSummary | null>(null);
  const [notifyMode, setMode] = useState<"MANUAL" | "OTOMATIK">("MANUAL");

  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("ozet");

  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [versionModalOpen, setVersionModalOpen] = useState(false);
  const [notifyModal, setNotifyModal] = useState(false);
  const [closeFor, setCloseFor] = useState<ContractAnnotation | null>(null);
  const [analysisResult, setAnalysisResult] = useState<ContractAnalysisResult | null>(null);

  const loadCore = useCallback(async () => {
    try {
      const [c, v] = await Promise.all([getContract(id), listContractVersions(id)]);
      setContract(c);
      setVersions(v);
      setMissing(false);
    } catch (err) {
      if (isFeatureMissing(err)) setMissing(true);
      else setError(errText(err, "Sözleşme yüklenemedi."));
    }
  }, [id]);

  /** Olay akışı — SON N olay (geçmiş "daha fazla" ile yüklenir). */
  const loadEventsFirstPage = useCallback(async () => {
    try {
      const p = await listEvents(id, { limit: EVENTS_PAGE_SIZE });
      setEvents(p.items);
      setEventsTotal(p.total);
    } catch {
      setEvents([]);
      setEventsTotal(0);
    }
  }, [id]);

  const loadAnalysisData = useCallback(async () => {
    try {
      const [a, r, m] = await Promise.all([
        listAnnotations(id, { limit: ANNOTATIONS_PAGE_SIZE }).catch(() => null),
        getRiskSummary(id).catch(() => null),
        getNotifyMode(id).catch(() => "MANUAL" as const),
      ]);
      if (a) {
        setAnnotations(a.items);
        setAnnotationsTotal(a.total);
      }
      setRisk(r);
      setMode(m);
      await loadEventsFirstPage();
    } catch {
      /* analiz uçları henüz yayında değil — liste yine çalışır */
    }
  }, [id, loadEventsFirstPage]);

  const loadMoreAnnotations = useCallback(async () => {
    const loaded = annotations.length;
    if (loaded === 0 || annotationsBusy) return;
    setAnnotationsBusy(true);
    try {
      const p = await listAnnotations(id, {
        page: Math.floor(loaded / ANNOTATIONS_PAGE_SIZE) + 1,
        limit: ANNOTATIONS_PAGE_SIZE,
      });
      setAnnotations((prev) => {
        const known = new Set(prev.map((a) => a.id));
        return [...prev, ...p.items.filter((a) => !known.has(a.id))];
      });
      setAnnotationsTotal(p.total);
    } catch {
      /* kalınan sayfa yeniden denenebilir */
    } finally {
      setAnnotationsBusy(false);
    }
  }, [id, annotations.length, annotationsBusy]);

  const loadMoreEvents = useCallback(async () => {
    const loaded = events.length;
    if (loaded === 0 || eventsBusy || loaded >= EVENTS_MAX_LOADED) return;
    setEventsBusy(true);
    try {
      const p = await listEvents(id, {
        page: Math.floor(loaded / EVENTS_PAGE_SIZE) + 1,
        limit: EVENTS_PAGE_SIZE,
      });
      setEvents((prev) => {
        const known = new Set(prev.map((e) => e.id));
        return [...prev, ...p.items.filter((e) => !known.has(e.id))].slice(0, EVENTS_MAX_LOADED);
      });
      setEventsTotal(p.total);
    } catch {
      /* kalınan sayfa yeniden denenebilir */
    } finally {
      setEventsBusy(false);
    }
  }, [id, events.length, eventsBusy]);

  const loadAnalyses = useCallback(async () => {
    listAnalyses(id)
      .then(setAnalyses)
      .catch(() => setAnalyses([]));
  }, [id]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void (async () => {
      await loadCore();
      await loadAnalysisData();
      await loadAnalyses();
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [loadCore, loadAnalysisData, loadAnalyses]);

  // ZAMAN ÇİZELGESİ CANLI — 30 sn yoklama. Yalnız YÜKLÜ pencere tazelenir
  // (WebSocket bu ölçekte gereksiz karmaşıklık; ajanda/mesaj altyapısındaki
  // yoklama deseni).
  useEffect(() => {
    const timer = window.setInterval(() => {
      const loaded = Math.min(EVENTS_MAX_LOADED, Math.max(EVENTS_PAGE_SIZE, events.length));
      listEvents(id, { page: 1, limit: loaded })
        .then((p) => {
          setEvents(p.items.slice(0, loaded));
          setEventsTotal(p.total);
        })
        .catch(() => undefined);
    }, EVENTS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [id, events.length]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadCore(), loadAnalysisData(), loadAnalyses()]);
  }, [loadCore, loadAnalysisData, loadAnalyses]);

  const currentVersion = useMemo(
    () => versions.find((v) => v.id === contract?.currentVersionId) ?? versions[0] ?? null,
    [versions, contract],
  );
  const openCritical = annotations.filter((a) => a.status === "ACIK" && a.severity === "KRITIK");
  const lastRun = analyses[0] ?? null;

  if (loading) return <Spinner label="Sözleşme yükleniyor…" />;
  if (missing) {
    return (
      <Card title="Sözleşme bulunamadı">
        <EmptyState message="Sözleşme uçları henüz yayında değil ya da kayıt silinmiş." />
        <div className="mt-3">
          <Link href="/app/sozlesmeler" className="text-sm font-medium text-amber-600">
            ← Listeye dön
          </Link>
        </div>
      </Card>
    );
  }
  if (!contract) {
    return (
      <div className="space-y-4">
        {error && <ErrorBox message={error} />}
        <Link href="/app/sozlesmeler" className="text-sm font-medium text-amber-600">
          ← Listeye dön
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Künye */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900">{contract.title}</h1>
            <Badge tone={CONTRACT_STATUS_TONES[contract.status] ?? "gray"}>
              {labelOf(CONTRACT_STATUS_LABELS, contract.status)}
            </Badge>
            {risk?.currentBand && (
              <Badge tone={CONTRACT_RISK_BAND_TONES[risk.currentBand] ?? "gray"}>
                {labelOf(CONTRACT_RISK_BAND_LABELS, risk.currentBand)} · {risk.currentScore}/100
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {contract.client?.name ?? "İlişkisiz sözleşme"}
            {contract.case?.title ? ` · ${contract.case.title}` : ""}
            {currentVersion ? ` · güncel sürüm v${currentVersion.versionNo}` : " · sürüm yok"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setVersionModalOpen(true)}>
            + Yeni Sürüm
          </Button>
          <Button size="sm" variant="gold" onClick={() => setAnalysisOpen(true)}>
            Analiz çalıştır
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setNotifyModal(true)}
            disabled={openCritical.length === 0}
            title={
              openCritical.length === 0
                ? "Açık KRİTİK şerh yok; müvekkile kritik şerh bildirimi gönderilemez."
                : undefined
            }
          >
            Müvekkile Bildir{openCritical.length > 0 ? ` (${openCritical.length})` : ""}
          </Button>
        </div>
      </div>

      <Tabs
        idPrefix="sozlesme"
        tabs={TABS.map((t) =>
          t.key === "metin"
            ? { ...t, count: annotations.filter((a) => a.status === "ACIK").length }
            : t,
        )}
        active={tab}
        onChange={setTab}
      />

      {tab === "ozet" && (
        <div {...tabPanelProps("sozlesme", "ozet")} className="space-y-5">
          <OverviewTab
            contract={contract}
            risk={risk}
            events={events}
            eventsTotal={eventsTotal}
            eventsBusy={eventsBusy}
            onLoadMoreEvents={() => void loadMoreEvents()}
            lastRun={lastRun}
            annotations={annotations}
            notifyMode={notifyMode}
            onNotifyModeChange={async (mode) => {
              try {
                const next = await setNotifyMode(id, mode);
                setMode(next);
                push(
                  next === "OTOMATIK"
                    ? "Otomatik bildirim AÇILDI: kritik şerh çıkan analizde avukatlar bilgilendirilir."
                    : "Otomatik bildirim kapatıldı (MANUAL).",
                  "success",
                );
              } catch (err) {
                push(errText(err, "Bildirim kipi değiştirilemedi."), "error");
              }
            }}
          />
        </div>
      )}

      {tab === "metin" && (
        <div {...tabPanelProps("sozlesme", "metin")}>
          <TextAnnotationsTab
            contractId={id}
            version={currentVersion}
            annotations={annotations}
            annotationsTotal={annotationsTotal}
            annotationsBusy={annotationsBusy}
            onLoadMoreAnnotations={() => void loadMoreAnnotations()}
            onClose={(a) => setCloseFor(a)}
          />
        </div>
      )}

      {tab === "versiyonlar" && (
        <div {...tabPanelProps("sozlesme", "versiyonlar")}>
          <VersionsTab contractId={id} versions={versions} />
        </div>
      )}

      {tab === "analizler" && (
        <div {...tabPanelProps("sozlesme", "analizler")}>
          <AnalysisArchiveTab analyses={analyses} annotations={annotations} />
        </div>
      )}

      {/* Analiz çalıştırma */}
      <RunAnalysisModal
        open={analysisOpen}
        contractId={id}
        versions={versions}
        currentVersionId={contract.currentVersionId ?? null}
        onClose={() => setAnalysisOpen(false)}
        onDone={(result) => {
          setAnalysisOpen(false);
          setAnalysisResult(result);
          push(
            `Analiz tamamlandı — ${result.annotations.length} şerh, skor ${result.overallRiskScore}/100` +
              (result.chunks
                ? ` (${result.chunks.ok}/${result.chunks.count} parça, ${result.chunks.pages} sayfa).`
                : "."),
            "success",
          );
          void refreshAll();
        }}
      />

      {/* Son analiz sonucu — iki taraf panelleri */}
      <LastAnalysisModal
        result={analysisResult}
        onClose={() => setAnalysisResult(null)}
      />

      {/* Yeni sürüm */}
      <NewVersionModal
        open={versionModalOpen}
        contract={contract}
        onClose={() => setVersionModalOpen(false)}
        onSaved={async () => {
          setVersionModalOpen(false);
          push("Yeni sürüm kaydedildi.", "success");
          await refreshAll();
        }}
        onNotify={push}
      />

      {/* Şerh kapatma */}
      <CloseAnnotationModal
        annotation={closeFor}
        contractId={id}
        onClose={() => setCloseFor(null)}
        onClosed={async (label) => {
          setCloseFor(null);
          push(label, "success");
          await refreshAll();
        }}
        onNotify={push}
      />

      {/* Müvekkile bildirim */}
      <NotifyClientModal
        open={notifyModal}
        contract={contract}
        criticalCount={openCritical.length}
        onClose={() => setNotifyModal(false)}
        onSent={async (note) => {
          setNotifyModal(false);
          push(note, "success");
          await refreshAll();
        }}
        onNotify={push}
      />

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

// ---------- Genel bakış ----------

function OverviewTab({
  contract,
  risk,
  events,
  eventsTotal,
  eventsBusy,
  onLoadMoreEvents,
  lastRun,
  annotations,
  notifyMode,
  onNotifyModeChange,
}: {
  contract: ContractItem;
  risk: ContractRiskSummary | null;
  events: ContractEventItem[];
  eventsTotal: number;
  eventsBusy: boolean;
  onLoadMoreEvents: () => void;
  lastRun: ContractAnalysisRunItem | null;
  annotations: ContractAnnotation[];
  notifyMode: "MANUAL" | "OTOMATIK";
  onNotifyModeChange: (mode: "MANUAL" | "OTOMATIK") => void | Promise<void>;
}) {
  const open = annotations.filter((a) => a.status === "ACIK");
  const counts = risk?.counts?.ACIK ?? {};
  const eventsHidden = Math.max(0, eventsTotal - events.length);

  return (
    <div className="space-y-5">
      {/* Risk skoru + dağılım */}
      <Card title="Genel risk skoru">
        {!risk ? (
          <EmptyState message="Analiz henüz çalıştırılmadı; skor ölçülmemiş." />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-3xl font-bold text-slate-900">{risk.currentScore}</span>
              <span className="text-sm text-slate-500">/ 100</span>
              {risk.currentBand && (
                <Badge tone={CONTRACT_RISK_BAND_TONES[risk.currentBand] ?? "gray"}>
                  {labelOf(CONTRACT_RISK_BAND_LABELS, risk.currentBand)}
                </Badge>
              )}
              <span className="text-xs text-slate-500">
                {risk.openAnnotations} açık şerh — kapatılanlar skoru düşürmez, dışında kalır.
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {(["KRITIK", "ORTA", "DUSUK"] as const).map((sev) => (
                <Badge key={sev} tone={SEVERITY_TONES[sev] ?? "gray"}>
                  {labelOf(SEVERITY_LABELS, sev)}: {counts[sev] ?? 0} açık
                </Badge>
              ))}
            </div>
            {risk.lastRun && (
              <p className="text-xs text-slate-500">
                Son koşu: {labelOf(CONTRACT_ANALYSIS_MODE_LABELS, risk.lastRun.mode)} ·{" "}
                {fmtDateTime(risk.lastRun.createdAt)}
              </p>
            )}
          </div>
        )}
      </Card>

      {/* Son analizden iki taraflı özet */}
      <Card title="Son analiz — iki taraf perspektifi">
        {!lastRun ? (
          <EmptyState message="Analiz arşivi boş. 'Analiz çalıştır' ile ilk incelemeyi başlatın." />
        ) : (
          <div className="space-y-3">
            {lastRun.chunks && lastRun.chunks.count > 1 && (
              <p className="text-[11px] text-slate-500">
                Parça bazlı koşu: {lastRun.chunks.ok}/{lastRun.chunks.count} parça ·{" "}
                {lastRun.chunks.pages} sanal sayfa
                {lastRun.chunks.failed > 0 ? ` · ${lastRun.chunks.failed} parça HATA` : ""}
              </p>
            )}
            <div className="grid gap-4 lg:grid-cols-2">
              <PerspectivePanel title="Bizim taraf (müvekkil)" findings={lastRun.ourSide} />
              <PerspectivePanel title="Karşı taraf" findings={lastRun.otherSide} />
            </div>
          </div>
        )}
      </Card>

      {/* Zaman çizelgesi — son N olay + geçmişe yükleme (30 sn yoklamayla canlı) */}
      <Card title={`Süreç akışı (${events.length}${eventsHidden > 0 ? ` / ${eventsTotal}` : ""})`}>
        {events.length === 0 ? (
          <EmptyState message="Olay kaydı yok. Sürüm yükleyerek akışı başlatın." />
        ) : (
          <ol className="space-y-3">
            {events.map((e) => (
              <li key={e.id} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500"
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-900">
                      {labelOf(CONTRACT_EVENT_TYPE_LABELS, e.type) || e.type}
                    </span>
                    <span className="text-xs text-slate-500">{fmtDateTime(e.createdAt)}</span>
                    {e.actor?.role && <Badge tone="gray">{String(e.actor.role)}</Badge>}
                  </div>
                  {e.detail && <p className="mt-0.5 text-xs leading-5 text-slate-600">{e.detail}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
        {eventsHidden > 0 && (
          <div className="mt-3">
            <Button
              size="sm"
              variant="secondary"
              disabled={eventsBusy || events.length >= EVENTS_MAX_LOADED}
              onClick={onLoadMoreEvents}
            >
              {eventsBusy ? "Yükleniyor…" : `Daha fazla yükle (${eventsHidden} eski olay)`}
            </Button>
            {events.length >= EVENTS_MAX_LOADED && (
              <p className="mt-1.5 text-[11px] text-slate-500">
                Görünüm ilk {EVENTS_MAX_LOADED} olayla sınırlıdır; tam akış kayıttadır.
              </p>
            )}
          </div>
        )}
        <p className="mt-3 text-[11px] text-slate-500">
          Akış append-only'dir: kayıtlar değiştirilemez. Liste 30 saniyede bir yenilenir.
        </p>
      </Card>

      {/* Bildirim kipi — PARTNER+ (sunucu 403 dönerse mesaj görünür) */}
      <Card title="Müvekkil bildirim kipi">
        <div className="flex flex-wrap items-center gap-3">
          <Select
            className="w-auto"
            value={notifyMode}
            onChange={(e) => void onNotifyModeChange(e.target.value as "MANUAL" | "OTOMATIK")}
          >
            <option value="MANUAL">Manuel (avukat gönderir)</option>
            <option value="OTOMATIK">Otomatik (kritik şerhte avukatlar bilgilendirilir)</option>
          </Select>
          <span className="text-xs text-slate-500">
            Otomatik kipte analizde KRİTİK şerh çıktığında büro avukatlarına bildirim düşer;
            müvekkile gönderim yine avukat komutuyla yapılır. Kip değişikliği PARTNER+ yetkisidir.
          </span>
        </div>
      </Card>

      {open.length > 0 && (
        <p className="text-xs leading-5 text-slate-500">
          {open.length} açık şerh görünümlü. Sözleşme{" "}
          <strong>{contract.title}</strong> — şerhleri &quot;Metin + Şerhler&quot; sekmesinden
          gerekçeli olarak kapatabilirsiniz.
        </p>
      )}
    </div>
  );
}

function PerspectivePanel({
  title,
  findings,
}: {
  title: string;
  findings: {
    rank: number;
    title: string;
    severity: string | null;
    body: string | null;
    clauseRef: string | null;
    pageFrom: number | null;
    pageTo: number | null;
  }[];
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? findings : findings.slice(0, FINDINGS_PREVIEW);
  const hidden = findings.length - visible.length;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      {findings.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">Bulgu yok.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {visible.map((f, i) => (
            <li key={i} className="rounded border border-slate-200 bg-white px-2.5 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-slate-500">#{f.rank}</span>
                {f.severity && (
                  <Badge tone={SEVERITY_TONES[f.severity] ?? "gray"}>
                    {labelOf(SEVERITY_LABELS, f.severity)}
                  </Badge>
                )}
                {f.clauseRef && <Badge tone="navy">{f.clauseRef}</Badge>}
                {f.pageFrom !== null && f.pageFrom !== undefined && (
                  <Badge tone="gray">
                    s.{f.pageFrom}
                    {f.pageTo && f.pageTo !== f.pageFrom ? `-${f.pageTo}` : ""}
                  </Badge>
                )}
                <span className="text-sm font-medium text-slate-900">{f.title}</span>
              </div>
              {f.body && <p className="mt-1 text-xs leading-5 text-slate-600">{f.body}</p>}
            </li>
          ))}
        </ul>
      )}
      {hidden > 0 && (
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => setShowAll(true)}>
          Kalan {hidden} bulgunun tamamını göster
        </Button>
      )}
    </div>
  );
}

// ---------- Metin + Şerhler ----------

function TextAnnotationsTab({
  contractId,
  version,
  annotations,
  annotationsTotal,
  annotationsBusy,
  onLoadMoreAnnotations,
  onClose,
}: {
  contractId: string;
  version: ContractVersionItem | null;
  annotations: ContractAnnotation[];
  annotationsTotal: number;
  annotationsBusy: boolean;
  onLoadMoreAnnotations: () => void;
  onClose: (a: ContractAnnotation) => void;
}) {
  const [windowFrom, setWindowFrom] = useState(1);
  const [textPage, setTextPage] = useState<{ contentText: string; pageFrom: number; pageTo: number; pageCount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Metin PENCERE PENCERE yüklenir: her istekte en fazla TEXT_WINDOW_PAGES
  // sanal sayfa (~15.000 karakter) döner; yüzlerce sayfalık sözleşmede DOM
  // sınırlı kalır.
  useEffect(() => {
    if (!version?.id) {
      setTextPage(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    getContractVersionTextPage(version.id, windowFrom, windowFrom + TEXT_WINDOW_PAGES - 1)
      .then((p) => {
        if (alive) setTextPage(p);
      })
      .catch((err) => {
        if (alive) setError(errText(err, "Sürüm metni yüklenemedi."));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [contractId, version?.id, windowFrom]);

  const blocks = useMemo(() => (textPage ? splitClauses(textPage.contentText) : []), [textPage]);
  const open = annotations.filter((a) => a.status === "ACIK");
  const pageCount = textPage?.pageCount ?? 1;
  const windowTo = Math.min(windowFrom + TEXT_WINDOW_PAGES - 1, pageCount);

  if (!version) {
    return <EmptyState message="Bu sözleşmenin metin sürümü yok. Önce bir sürüm ekleyin." />;
  }

  return (
    <div className="space-y-4">
      <AiDisclaimer text="Şerhler analiz koşusuyla kayda geçmiş AI bulgularıdır; gerekçe ve alıntı sunucuda doğrulanmıştır. Metne işlemek ve şerhleri kapatmak avukatın kararıdır." />
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <Badge tone="gray">v{version.versionNo}</Badge>
        {textPage && (
          <Badge tone="gray">
            {pageCount} sayfa · {windowFrom === windowTo ? `s.${windowFrom}` : `s.${windowFrom}-${windowTo}`}
          </Badge>
        )}
        <span>
          {open.length} açık / {annotationsTotal > 0 ? annotationsTotal : annotations.length} şerh
        </span>
        <span>· Kenarlık: kırmızı = kritik, turuncu = orta, sarı = düşük</span>
      </div>

      {/* Sayfa seçici — tembel render */}
      {pageCount > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={windowFrom <= 1 || loading}
            onClick={() => setWindowFrom((w) => Math.max(1, w - TEXT_WINDOW_PAGES))}
          >
            ‹ Önceki sayfalar
          </Button>
          <Select
            className="w-auto"
            value={String(windowFrom)}
            disabled={loading}
            onChange={(e) => setWindowFrom(Number(e.target.value))}
            aria-label="Metin sayfası seç"
          >
            {Array.from({ length: pageCount }, (_, i) => i + 1)
              .filter((p) => (p - 1) % TEXT_WINDOW_PAGES === 0)
              .map((p) => (
                <option key={p} value={p}>
                  s.{p}
                  {p + TEXT_WINDOW_PAGES - 1 <= pageCount
                    ? `-${p + TEXT_WINDOW_PAGES - 1}`
                    : `-${pageCount}`}
                </option>
              ))}
          </Select>
          <Button
            size="sm"
            variant="secondary"
            disabled={windowTo >= pageCount || loading}
            onClick={() => setWindowFrom((w) => Math.min(pageCount, w + TEXT_WINDOW_PAGES))}
          >
            Sonraki sayfalar ›
          </Button>
          <span className="text-[11px] text-slate-500">
            Metin {TEXT_WINDOW_PAGES} sayfalık pencerelerle yüklenir (sunucu tek istekte tüm
            metni döndürmez).
          </span>
        </div>
      )}

      {loading && <Spinner label="Sözleşme metni yükleniyor…" />}
      {error && <ErrorBox message={error} />}
      {!loading && !error && textPage && (
        <>
          {blocks.length === 0 ? (
            <EmptyState message="Metin madde başlığı bulunamadı; şerhler madde eşleştirmesi olmadan listelenir." />
          ) : (
            <div className="space-y-2">
              {blocks.map((block, i) => {
                const blockAnnotations = annotationsForBlock(block, annotations);
                const severity = blockSeverity(blockAnnotations.filter((a) => a.status === "ACIK"));
                return (
                  <div
                    key={i}
                    className={`rounded-r-lg bg-white p-3 text-sm leading-6 text-slate-800 shadow-sm ring-1 ring-slate-200 ${
                      severity ? SEVERITY_BORDER[severity] : "border-l-4 border-l-slate-200"
                    }`}
                  >
                    <pre className="whitespace-pre-wrap font-sans">{block.text}</pre>
                    {blockAnnotations.length > 0 && (
                      <ul className="mt-2 space-y-2 border-t border-slate-100 pt-2">
                        {blockAnnotations.map((a) => (
                          <AnnotationCard key={a.id} annotation={a} onClose={onClose} />
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {annotationsTotal > annotations.length && (
            <div>
              <Button size="sm" variant="secondary" disabled={annotationsBusy} onClick={onLoadMoreAnnotations}>
                {annotationsBusy ? "Yükleniyor…" : `Daha fazla şerh yükle (${annotationsTotal - annotations.length})`}
              </Button>
              <p className="mt-1.5 text-[11px] text-slate-500">
                Şerhler sunucudan sayfalı gelir; yalnız yüklü pencere için eşleştirilir.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AnnotationCard({
  annotation,
  onClose,
}: {
  annotation: ContractAnnotation;
  onClose: (a: ContractAnnotation) => void;
}) {
  return (
    <li className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {annotation.severity && (
          <Badge tone={CONTRACT_SEVERITY_TONES[annotation.severity] ?? "gray"}>
            {labelOf(SEVERITY_LABELS, annotation.severity)}
          </Badge>
        )}
        {annotation.clauseRef && <Badge tone="navy">{annotation.clauseRef}</Badge>}
        {annotation.pageFrom !== null && annotation.pageFrom !== undefined && (
          <Badge tone="gray">
            s.{annotation.pageFrom}
            {annotation.pageTo && annotation.pageTo !== annotation.pageFrom ? `-${annotation.pageTo}` : ""}
          </Badge>
        )}
        <Badge tone={CONTRACT_ANNOTATION_STATUS_TONES[annotation.status ?? "ACIK"] ?? "gray"}>
          {labelOf(CONTRACT_ANNOTATION_STATUS_LABELS, annotation.status ?? "ACIK")}
        </Badge>
        {annotation.createdAt && (
          <span className="text-[11px] text-slate-500">{fmtDateTime(annotation.createdAt)}</span>
        )}
      </div>
      <p className="mt-1.5 text-xs leading-5 text-slate-700">{annotation.explanation}</p>
      {annotation.quote && (
        <p className="mt-1.5 border-l-2 border-amber-300 pl-2 text-[11px] italic leading-5 text-slate-500">
          “{annotation.quote}”
        </p>
      )}
      {annotation.proposedFix && (
        <p className="mt-1.5 rounded border border-slate-200 bg-white px-2 py-1.5 text-xs leading-5 text-slate-700">
          <span className="font-medium">Önerilen düzeltme:</span> {annotation.proposedFix}
        </p>
      )}
      {annotation.status === "KAPALI" && annotation.closeNote && (
        <p className="mt-1.5 text-[11px] leading-5 text-green-800">
          Kapatma gerekçesi: {annotation.closeNote}
        </p>
      )}
      {annotation.status === "ACIK" && (
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => onClose(annotation)}>
          Şerhi kapat (gerekçeli)
        </Button>
      )}
      {annotation.status === "SUPERSEDED" && (
        <p className="mt-1.5 text-[11px] leading-5 text-slate-500">
          Bu şerh yeni bir revizyon analizinde geçersizleşti; güncel metin için yeni analiz
          çalıştırın.
        </p>
      )}
    </li>
  );
}

// ---------- Versiyonlar + diff ----------

function VersionsTab({
  contractId,
  versions,
}: {
  contractId: string;
  versions: ContractVersionItem[];
}) {
  const sorted = useMemo(() => [...versions].sort((a, b) => a.versionNo - b.versionNo), [versions]);
  const [aId, setAId] = useState("");
  const [bId, setBId] = useState("");
  const [diff, setDiff] = useState<ContractVersionDiffResult | null>(null);
  const [diffPage, setDiffPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Varsayılan: varsa son iki sürüm seçili gelsin.
  useEffect(() => {
    if (sorted.length >= 2) {
      setAId((prev) => prev || sorted[sorted.length - 2].id);
      setBId((prev) => prev || sorted[sorted.length - 1].id);
    }
  }, [sorted]);

  async function compare(page = 1) {
    if (!aId || !bId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await getContractDiff(contractId, aId, bId, { page, limit: 5 });
      setDiff(result);
      setDiffPage(result.pages.page);
    } catch (err) {
      setError(errText(err, "Fark hesaplanamadı."));
      setDiff(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card title={`Sürümler (${versions.length}) — değiştirilemez`}>
        {versions.length === 0 ? (
          <EmptyState message="Henüz sürüm yok." />
        ) : (
          <ul className="space-y-1.5">
            {[...versions]
              .sort((a, b) => b.versionNo - a.versionNo)
              .map((v) => (
                <li
                  key={v.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-100 bg-slate-50 px-2.5 py-1.5"
                >
                  <span className="text-xs text-slate-700">
                    <strong>v{v.versionNo}</strong>
                    {v.changeNote ? ` · ${v.changeNote}` : ""}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {v.createdAt ? fmtDateTime(v.createdAt) : ""}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </Card>

      <Card title="Anlık sürüm farkı (sayfa pencereli)">
        {sorted.length < 2 ? (
          <EmptyState message="Fark için en az iki sürüm gerekir." />
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Eski sürüm (A)">
                <Select value={aId} onChange={(e) => setAId(e.target.value)}>
                  {sorted.map((v) => (
                    <option key={v.id} value={v.id}>
                      v{v.versionNo}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Yeni sürüm (B)">
                <Select value={bId} onChange={(e) => setBId(e.target.value)}>
                  {sorted.map((v) => (
                    <option key={v.id} value={v.id}>
                      v{v.versionNo}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Button disabled={busy || !aId || !bId || aId === bId} onClick={() => void compare(1)}>
              {busy ? "Hesaplanıyor…" : "Farkı göster"}
            </Button>
            <p className="text-[11px] text-slate-500">
              Fark SUNUCUDA sayfa pencereli LCS ile üretilir ve denetim izine yazılır; değişmeyen
              sayfalar atlanır, yalnızca değişen sayfalar sayfalanmış döner.
            </p>
            {error && <ErrorBox message={error} />}
          </div>
        )}
      </Card>

      {diff && (
        <Card
          title={`v${diff.versionA.versionNo} → v${diff.versionB.versionNo} (+${diff.counts.added} / -${diff.counts.removed} / ~${diff.counts.changed})`}
        >
          <div className="space-y-4">
            <p className="text-[11px] text-slate-500">
              {diff.pages.total} sayfa değişti
              {diff.unchangedPages !== null ? ` · ${diff.unchangedPages} sayfa değişmedi (atlandı)` : ""}
              {diff.pageCounts.a !== null && diff.pageCounts.b !== null
                ? ` · v${diff.versionA.versionNo}: ${diff.pageCounts.a} sayfa → v${diff.versionB.versionNo}: ${diff.pageCounts.b} sayfa`
                : ""}
            </p>

            {diff.pages.total === 0 ? (
              <SuccessBox message="İki sürüm metin bakımından özdeş." />
            ) : (
              <>
                {/* Değişen sayfa seçici — sayfalanmış diff gezinme */}
                {diff.pages.totalPages > 1 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={diffPage <= 1 || busy}
                      onClick={() => void compare(diffPage - 1)}
                    >
                      ‹ Önceki
                    </Button>
                    <Select
                      className="w-auto"
                      value={String(diffPage)}
                      disabled={busy}
                      onChange={(e) => void compare(Number(e.target.value))}
                      aria-label="Değişen sayfa seç"
                    >
                      {Array.from({ length: diff.pages.totalPages }, (_, i) => i + 1).map((p) => (
                        <option key={p} value={p}>
                          Değişen sayfa bloğu {p}/{diff.pages.totalPages}
                        </option>
                      ))}
                    </Select>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={diffPage >= diff.pages.totalPages || busy}
                      onClick={() => void compare(diffPage + 1)}
                    >
                      Sonraki ›
                    </Button>
                  </div>
                )}

                {diff.pages.items.map((p) => (
                  <div key={p.page} className="space-y-1.5 rounded border border-slate-100 p-2">
                    <div className="flex items-center gap-2">
                      <Badge tone="navy">s.{p.page}</Badge>
                      <Badge tone={p.status === "EKLENDI" ? "green" : p.status === "SILINDI" ? "red" : "gray"}>
                        {p.status === "EKLENDI" ? "Eklenen sayfa" : p.status === "SILINDI" ? "Silinen sayfa" : "Değişen sayfa"}
                      </Badge>
                    </div>
                    {p.changed.length > 0 && (
                      <ul className="space-y-1.5">
                        {p.changed.map((c, i) => (
                          <li key={i} className="grid gap-1.5 sm:grid-cols-2">
                            <pre className="whitespace-pre-wrap rounded bg-red-50 px-2.5 py-1.5 text-xs leading-5 text-red-900 ring-1 ring-red-200">
                              {c.before}
                            </pre>
                            <pre className="whitespace-pre-wrap rounded bg-green-50 px-2.5 py-1.5 text-xs leading-5 text-green-900 ring-1 ring-green-200">
                              {c.after}
                            </pre>
                          </li>
                        ))}
                      </ul>
                    )}
                    {p.removed.length > 0 && (
                      <ul className="space-y-1">
                        {p.removed.map((l, i) => (
                          <li
                            key={i}
                            className="whitespace-pre-wrap rounded bg-red-50 px-2.5 py-1 text-xs leading-5 text-red-900 ring-1 ring-red-200"
                          >
                            {l}
                          </li>
                        ))}
                      </ul>
                    )}
                    {p.added.length > 0 && (
                      <ul className="space-y-1">
                        {p.added.map((l, i) => (
                          <li
                            key={i}
                            className="whitespace-pre-wrap rounded bg-green-50 px-2.5 py-1 text-xs leading-5 text-green-900 ring-1 ring-green-200"
                          >
                            {l}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------- Analiz arşivi ----------

function AnalysisArchiveTab({
  analyses,
  annotations,
}: {
  analyses: ContractAnalysisRunItem[];
  annotations: ContractAnnotation[];
}) {
  if (analyses.length === 0) {
    return <EmptyState message="Analiz arşivi boş. 'Analiz çalıştır' ile ilk incelemeyi başlatın." />;
  }
  return (
    <div className="space-y-3">
      {analyses.map((run) => {
        const runAnnotations = annotations.filter((a) => a.runId === run.id);
        return (
          <Disclosure
            key={run.id}
            summary={`${labelOf(CONTRACT_ANALYSIS_MODE_LABELS, run.mode ?? "")} — ${fmtDate(run.createdAt)} · skor ${run.overallRiskScore}/100 · ${runAnnotations.length} şerh`}
          >
            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                {run.createdAt ? fmtDateTime(run.createdAt) : ""}
                {run.model ? ` · model: ${run.model}` : ""}
                {run.durationMs ? ` · ${(run.durationMs / 1000).toFixed(1)} sn` : ""}
                {run.chunks && run.chunks.count > 1
                  ? ` · parça bazlı: ${run.chunks.ok}/${run.chunks.count} parça, ${run.chunks.pages} sayfa`
                  : ""}
              </p>
              <div className="grid gap-4 lg:grid-cols-2">
                <PerspectivePanel title="Bizim taraf (müvekkil)" findings={run.ourSide} />
                <PerspectivePanel title="Karşı taraf" findings={run.otherSide} />
              </div>
              {runAnnotations.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Bu koşunun şerhleri
                  </p>
                  <ul className="space-y-2">
                    {runAnnotations.map((a) => (
                      <AnnotationCard key={a.id} annotation={a} onClose={() => undefined} />
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-[11px] text-slate-500">
                Koşular değiştirilemez; yeniden analiz yeni koşu açar.
              </p>
            </div>
          </Disclosure>
        );
      })}
    </div>
  );
}

// ---------- Analiz çalıştırma modalı ----------

function RunAnalysisModal({
  open,
  contractId,
  versions,
  currentVersionId,
  onClose,
  onDone,
}: {
  open: boolean;
  contractId: string;
  versions: ContractVersionItem[];
  currentVersionId: string | null;
  onClose: () => void;
  onDone: (result: ContractAnalysisResult) => void | Promise<void>;
}) {
  const { costs } = useCreditCosts();
  const [mode, setMode] = useState<ContractAnalysisMode>("ILK");
  const [versionId, setVersionId] = useState("");
  const [ourParty, setOurParty] = useState("");
  const [focus, setFocus] = useState("");
  const [estimate, setEstimate] = useState<ContractAnalysisEstimate | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode("ILK");
    setVersionId(currentVersionId ?? "");
    setOurParty("");
    setFocus("");
    setEstimate(null);
    setEstimateError(null);
  }, [open, currentVersionId]);

  // TAHMİN — deterministik (AI yok, kredi yok): metin aynı chunker hesabıyla
  // bölünür; kaç parça, kaç kredi, tahmini süre modalda GÖRÜNÜR.
  useEffect(() => {
    if (!open || !versionId) {
      setEstimate(null);
      setEstimateError(null);
      return;
    }
    let alive = true;
    getAnalysisEstimate(contractId, versionId)
      .then((e) => {
        if (alive) {
          setEstimate(e);
          setEstimateError(null);
        }
      })
      .catch((err) => {
        if (alive) {
          setEstimate(null);
          setEstimateError(errText(err, "Tahmin alınamadı."));
        }
      });
    return () => {
      alive = false;
    };
  }, [open, contractId, versionId]);

  const ai = useAiCall(
    useCallback(
      (piiApproved: boolean) =>
        runAnalysis(
          contractId,
          {
            versionId: versionId || undefined,
            mode,
            ourParty: ourParty.trim() || undefined,
            focus: focus.trim() || undefined,
          },
          piiApproved,
        ),
      [contractId, versionId, mode, ourParty, focus],
    ),
    "Sözleşme analizi çalıştırılamadı.",
  );

  return (
    <Modal open={open} wide title="Sözleşme analizi (iki taraf)" onClose={onClose}>
      <div className="space-y-4">
        <AiDisclaimer text="Analiz bir ÖNERİDİR. Şerhler kayda geçer ama metne işlenmeleri avukatın kararıdır." />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Analiz türü">
            <Select value={mode} onChange={(e) => setMode(e.target.value as ContractAnalysisMode)}>
              {CONTRACT_ANALYSIS_MODES.map((m) => (
                <option key={m} value={m}>
                  {labelOf(CONTRACT_ANALYSIS_MODE_LABELS, m)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="İncelenecek sürüm" hint="Boş bırakılırsa güncel sürüm incelenir.">
            <Select value={versionId} onChange={(e) => setVersionId(e.target.value)}>
              <option value="">(güncel sürüm)</option>
              {[...versions]
                .sort((a, b) => b.versionNo - a.versionNo)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.versionNo}
                    {v.changeNote ? ` · ${v.changeNote}` : ""}
                  </option>
                ))}
            </Select>
          </Field>
        </div>

        {/* Parça/kredi tahmini — fiyat = parça sayısı × parça başına kredi */}
        {estimate && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-700">
            <strong>Tahmin:</strong> {estimate.pageCount} sayfa · <strong>{estimate.chunkCount} parça</strong> ·
            her parça ayrı AI çağrısı · fiyat ≈ {estimate.pricing.parcaSayisi} ×{" "}
            {estimate.pricing.parcaBasiKredi} = <strong>{estimate.pricing.tahminiKredi} kredi</strong> ·
            tahmini süre ~{Math.max(1, Math.round(estimate.estimatedDurationMs / 1000 / 15) * 15 / 60)} dk
            <p className="mt-1 text-[11px] text-slate-500">
              Sözleşme parça parça incelenir; her şerh sanal sayfa konumu (s.N) taşır. Tek parça
              hatası koşuyu düşürmez, raporda görünür.
            </p>
          </div>
        )}
        {estimateError && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {estimateError}
          </p>
        )}

        {mode === "REVIZYON" && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
            Revizyon incelemesi, önceki AÇIK şerhleri GEÇERSİZ KILAR (SUPERSEDED): hangi şerhin
            hangi metne ait olduğu kayıtta kalır.
          </p>
        )}
        {mode === "NIHAI" && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
            Nihai kontrol imza öncesindedir; açıkta kalan şerhler renk kodlu listede döner. Yalnızca
            avukat ve üzeri çalıştırabilir.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Müvekkilimizin tarafı" hint="İki perspektifin yönünü belirler.">
            <Input
              value={ourParty}
              onChange={(e) => setOurParty(e.target.value)}
              placeholder="Örn. Hizmet Alan / Kiracı"
            />
          </Field>
          <Field label="Odak (isteğe bağlı)">
            <Input
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="Örn. cezai şart ve yetki maddeleri"
            />
          </Field>
        </div>

        <Button variant="gold" disabled={ai.busy} onClick={() => void ai.run()}>
          {ai.busy ? "Analiz ediliyor…" : "Analizi çalıştır"}
          <CreditBadge taskType="CONTRACT_ANALYSIS" costs={costs} />
        </Button>

        {ai.pii && (
          <PiiApprovalBox
            prompt={ai.pii}
            busy={ai.busy}
            onApprove={() => void ai.approvePii()}
            onCancel={ai.cancelPii}
          />
        )}
        {ai.error && <ErrorBox message={ai.error} />}
        {ai.data && (
          <div className="flex justify-end pt-2">
            <Button
              variant="primary"
              onClick={() => {
                const result = ai.data;
                if (result) void onDone(result);
              }}
            >
              Sonucu gör ve kaydet
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------- Son analiz sonucu (iki panel) ----------

function LastAnalysisModal({
  result,
  onClose,
}: {
  result: ContractAnalysisResult | null;
  onClose: () => void;
}) {
  if (!result) return null;
  const failedChunks = result.chunkReports.filter((c) => c.status === "HATA");
  return (
    <Modal open wide title="Analiz sonucu" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-2xl font-bold text-slate-900">{result.overallRiskScore}</span>
          <span className="text-sm text-slate-500">/ 100</span>
          {result.riskBand && (
            <Badge tone={CONTRACT_RISK_BAND_TONES[result.riskBand] ?? "gray"}>
              {labelOf(CONTRACT_RISK_BAND_LABELS, result.riskBand)}
            </Badge>
          )}
          {result.mode && <Badge tone="gray">{labelOf(CONTRACT_ANALYSIS_MODE_LABELS, result.mode)}</Badge>}
          {result.versionNo !== null && <Badge tone="gray">v{result.versionNo}</Badge>}
          {result.chunks && (
            <Badge tone={result.chunks.failed > 0 ? "yellow" : "gray"}>
              {result.chunks.ok}/{result.chunks.count} parça · {result.chunks.pages} sayfa
            </Badge>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <PerspectivePanel title="Bizim taraf (müvekkil)" findings={result.ourSide} />
          <PerspectivePanel title="Karşı taraf" findings={result.otherSide} />
        </div>

        {failedChunks.length > 0 && (
          <Disclosure summary={`Başarısız parçalar (${failedChunks.length}) — koşu kalan parçalarla tamamlandı`}>
            <ul className="space-y-1.5">
              {failedChunks.map((c) => (
                <li key={c.index} className="text-xs leading-5 text-slate-600">
                  Parça {c.index + 1}
                  {c.pageFrom !== null ? ` (s.${c.pageFrom}${c.pageTo && c.pageTo !== c.pageFrom ? `-${c.pageTo}` : ""})` : ""}
                  : {c.errorNote ?? "bilinmeyen hata"}
                </li>
              ))}
            </ul>
          </Disclosure>
        )}

        {result.droppedQuotes.length > 0 && (
          <Disclosure summary={`Denetimde elenen bulgular (${result.droppedQuotes.length})`}>
            <ul className="space-y-1.5">
              {result.droppedQuotes.map((d, i) => (
                <li key={i} className="text-xs leading-5 text-slate-600">
                  [{d.perspective}] {d.label}
                  {d.pageFrom !== null ? ` (s.${d.pageFrom})` : ""}: {d.reasonLabel}
                </li>
              ))}
            </ul>
          </Disclosure>
        )}

        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Kapat
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Yeni sürüm ----------

function NewVersionModal({
  open,
  contract,
  onClose,
  onSaved,
  onNotify,
}: {
  open: boolean;
  contract: ContractItem | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onNotify: (text: string, tone?: "success" | "error" | "info") => void;
}) {
  const [contentText, setContentText] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setContentText("");
    setChangeNote("");
    setError(null);
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!contract) return;
    setBusy(true);
    setError(null);
    try {
      await createContractVersion(contract.id, { contentText, changeNote });
      await onSaved();
    } catch (err) {
      setError(errText(err, "Sürüm kaydedilemedi."));
      onNotify(errText(err, "Sürüm kaydedilemedi."), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} wide title="Yeni sürüm yükle" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
          Sürümler değiştirilemez. Karşı taraftan gelen metni yeni sürüm olarak kaydedin; süreç
          akışına &quot;revizyon alındı&quot; olayı düşer. Ardından revizyon analizini
          &quot;Analiz çalıştır → Revizyon incelemesi&quot; ile başlatın.
        </p>
        <Field label="Değişiklik notu">
          <Input
            value={changeNote}
            onChange={(e) => setChangeNote(e.target.value)}
            placeholder="Örn. karşı taraf revizyonu — m.7 cezai şart değişti"
          />
        </Field>
        <Field label="Sözleşme metni">
          <Textarea
            rows={12}
            value={contentText}
            onChange={(e) => setContentText(e.target.value)}
            required
          />
        </Field>
        {error && <ErrorBox message={error} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Kaydediliyor…" : "Sürümü kaydet"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- Şerh kapatma ----------

function CloseAnnotationModal({
  annotation,
  contractId,
  onClose,
  onClosed,
  onNotify,
}: {
  annotation: ContractAnnotation | null;
  contractId: string;
  onClose: () => void;
  onClosed: (label: string) => void | Promise<void>;
  onNotify: (text: string, tone?: "success" | "error" | "info") => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNote("");
    setError(null);
  }, [annotation?.id]);

  if (!annotation) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!annotation) return;
    setBusy(true);
    setError(null);
    try {
      await closeAnnotation(contractId, annotation.id, note.trim());
      await onClosed("Şerh kapatıldı ve süreç akışına yazıldı.");
    } catch (err) {
      const text = errText(err, "Şerh kapatılamadı.");
      setError(text);
      onNotify(text, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title="Şerhi kapat" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
          {annotation.clauseRef ? `${annotation.clauseRef} · ` : ""}
          {annotation.explanation?.slice(0, 200)}…
        </p>
        <Field
          label="Kapatma gerekçesi (zorunlu)"
          hint="Örn. 'm.7 revizyonda karşılıklı hâle getirildi' ya da 'risk kabul edildi'."
        >
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} required />
        </Field>
        {error && <ErrorBox message={error} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" disabled={busy || note.trim().length < 5}>
            {busy ? "Kapatılıyor…" : "Şerhi kapat"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- Müvekkile bildirim ----------

function NotifyClientModal({
  open,
  contract,
  criticalCount,
  onClose,
  onSent,
  onNotify,
}: {
  open: boolean;
  contract: ContractItem | null;
  criticalCount: number;
  onClose: () => void;
  onSent: (note: string) => void | Promise<void>;
  onNotify: (text: string, tone?: "success" | "error" | "info") => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setNote("");
      setError(null);
    }
  }, [open]);

  if (!contract) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!contract) return;
    setBusy(true);
    setError(null);
    try {
      const res = await notifyClient(contract.id, note.trim() || undefined);
      await onSent(
        res.published
          ? `Kritik şerh özeti müvekkilin portalında yayında (${res.criticalCount} kritik husus).`
          : `Mesaj kaydedildi ancak portal yayını AÇILAMADI; Portal Yönetimi'nden elle yayınlayın.`,
      );
    } catch (err) {
      const text = errText(err, "Müvekkile bildirim gönderilemedi.");
      setError(text);
      onNotify(text, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="Müvekkile kritik şerh bildirimi" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          {criticalCount} açık KRİTİK şerh, sunucuda hazırlanan özetle müvekkilin portalına
          YAYINLANIR (AI çağrısı yok, kredi tüketilmez). Özet; gönderen avukatın onayıyla portal
          görünür olur ve Portal Yönetimi'nden geri çekilebilir.
        </p>
        <Field label="Avukat notu (özete eklenir, isteğe bağlı)">
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {error && <ErrorBox message={error} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Gönderiliyor…" : "Özeti portala yayınla"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
