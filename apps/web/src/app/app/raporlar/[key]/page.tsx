"use client";

/**
 * RAPOR GÖRÜNTÜLEYİCİ — /app/raporlar/:key
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ RAKAM ÜRETEN TEK YER SUNUCUDUR.                                          ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Bu ekran hiçbir toplam, oran veya fark HESAPLAMAZ; `POST /reports/:key/run`
 * sonucunu biçimlendirip çizer. Sıralama yalnızca satırların YERİNİ değiştirir.
 * CSV de sunucudan indirilir (ekrandan üretilmez): ekrandaki tablo rol
 * süzgecinden geçmiş bir kesittir ve onu dosyaya çevirmek, kullanıcıya "tam
 * veri" sandığı eksik bir dosya vermek olurdu.
 *
 * DURUM ADRES ÇUBUĞUNDA: dönem, karşılaştırma ve filtreler sorgu dizesine
 * yazılır. Böylece bir rapor görünümünün bağlantısı paylaşılabilir, tarayıcının
 * geri tuşu çalışır ve kayıtlı rapor aynı adresle açılır.
 */

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { errText } from "@/lib/faz2";
import { notifyCreditError, notifyCreditsChanged } from "@/lib/credits";
import { useCreditCosts } from "@/components/credits";
import { Badge, Button, Card, ErrorBox, Spinner } from "@/components/ui";
import { FeatureUnavailable, ToastStack, useToasts } from "@/components/ai-ui";
import {
  fmtCount,
  fmtDateTime,
  periodLabel,
  resolvePeriod,
  type ReportPeriodPreset,
} from "@/lib/labels";
import {
  FORBIDDEN_REPORT_TEXT,
  createSavedReport,
  downloadReportCsv,
  fetchReportCatalog,
  interpretReport,
  isFeatureMissing,
  isForbidden,
  runReport,
  selectReportTable,
} from "../../_lib/faz6";
import { csvFileName } from "../../_lib/faz6-format";
import type {
  ReportCatalogItem,
  ReportNarrative,
  ReportParams,
  ReportResult,
  ReportScope,
} from "../../_lib/faz6-types";
import { ReportToolbar, type ToolbarState } from "../_components/report-toolbar";
import { MetricStrip, ReportCharts } from "../_components/report-metrics";
import { ReportTable } from "../_components/report-table";
import { SaveReportModal } from "../_components/save-report-modal";
import { NarrativePanel } from "../_components/report-narrative";

/**
 * YAZDIRMA BİÇİMİ.
 *
 * Kurallar sayfaya gömülüdür (paylaşılan `globals.css` değiştirilmez):
 * menü ve üst çubuk zaten `print:hidden` taşır, burada tablo kâğıda tam
 * genişlikte yayılır, satırlar sayfa sonunda ORTADAN BÖLÜNMEZ ve başlık satırı
 * her sayfada tekrarlanır — çok sayfalı bir tahsilat listesinde ikinci sayfada
 * sütun başlığı olmaması, rakamları okunamaz kılar.
 */
const PRINT_CSS = `
@media print {
  @page { size: A4 landscape; margin: 12mm; }
  html, body { background: #fff !important; }
  .rapor-yazdirma-alani { width: 100% !important; max-width: none !important; }
  .rapor-yazdirma-alani table { width: 100% !important; min-width: 0 !important; font-size: 10pt; }
  .rapor-yazdirma-alani thead { display: table-header-group; }
  .rapor-yazdirma-alani tr, .rapor-yazdirma-alani figure { break-inside: avoid; }
  .rapor-yazdirma-alani section, .rapor-yazdirma-alani .print\\:break-inside-avoid { break-inside: avoid; }
  .rapor-yazdirma-alani .shadow-sm, .rapor-yazdirma-alani .shadow-md { box-shadow: none !important; }
}
`;

export default function ReportViewPage({ params }: { params: Promise<{ key: string }> }) {
  const { key: rawKey } = use(params);
  const reportKey = decodeURIComponent(rawKey);
  const router = useRouter();
  const { costs } = useCreditCosts();
  const { toasts, push, dismiss } = useToasts();

  const [def, setDef] = useState<ReportCatalogItem | null>(null);
  const [defLoading, setDefLoading] = useState(true);
  const [defMissing, setDefMissing] = useState(false);
  const [notInCatalog, setNotInCatalog] = useState(false);

  const [state, setState] = useState<ToolbarState | null>(null);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const [saveOpen, setSaveOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [narrative, setNarrative] = useState<ReportNarrative | null>(null);
  const [narrativeBusy, setNarrativeBusy] = useState(false);
  const [narrativeError, setNarrativeError] = useState<string | null>(null);

  // ------------------------------------------------------------ katalog

  useEffect(() => {
    let alive = true;
    fetchReportCatalog()
      .then((list) => {
        if (!alive) return;
        const found = list.find((c) => c.key === reportKey) ?? null;
        setDef(found);
        // Katalogda YOK ise iki ihtimal vardır: rapor hiç yoktur ya da role
        // kapalıdır. İkisini de "bulunamadı" diye göstermek yanlış olurdu;
        // çalıştırma denemesi 403 dönerse gerçek neden ortaya çıkar.
        setNotInCatalog(found === null);
        setDefMissing(false);
      })
      .catch((err) => {
        if (!alive) return;
        setDef(null);
        setDefMissing(isFeatureMissing(err));
        if (!isFeatureMissing(err)) setError(errText(err, "Rapor tanımı yüklenemedi."));
      })
      .finally(() => {
        if (alive) setDefLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [reportKey]);

  /**
   * Başlangıç durumu adres çubuğundan okunur; yoksa "bu ay" ve katalogdaki
   * filtre varsayılanları kullanılır.
   *
   * `useSearchParams` yerine `window.location` okunur — sayfa istemci bileşeni
   * olduğu için ek bir Suspense sınırı gerektirmesin (proje deseni).
   */
  useEffect(() => {
    if (defLoading || state !== null) return;
    const sp =
      typeof window === "undefined"
        ? new URLSearchParams()
        : new URLSearchParams(window.location.search);

    const preset = (sp.get("donem") ?? "BU_AY") as ReportPeriodPreset;
    const fallback = resolvePeriod(preset === "OZEL" ? "BU_AY" : preset);
    const filters: Record<string, string> = {};
    for (const f of def?.filters ?? []) {
      const fromUrl = sp.get(`f_${f.key}`);
      filters[f.key] = fromUrl ?? f.defaultValue ?? "";
    }
    setState({
      preset,
      from: sp.get("from") ?? fallback.from,
      to: sp.get("to") ?? fallback.to,
      compare: sp.get("kiyas") === "1",
      filters,
    });
  }, [defLoading, def, state]);

  const paramsOf = useCallback(
    (s: ToolbarState): ReportParams => ({
      from: def?.periodRequired === false ? undefined : s.from,
      to: def?.periodRequired === false ? undefined : s.to,
      preset: s.preset,
      compare: s.compare,
      filters: Object.fromEntries(Object.entries(s.filters).filter(([, v]) => v !== "")),
    }),
    [def],
  );

  /** Durumu adres çubuğuna yazar (geçmişe yığmadan). */
  const syncUrl = useCallback(
    (s: ToolbarState) => {
      if (typeof window === "undefined") return;
      const qs = new URLSearchParams();
      if (def?.periodRequired !== false) {
        qs.set("from", s.from);
        qs.set("to", s.to);
        qs.set("donem", s.preset);
      }
      if (s.compare) qs.set("kiyas", "1");
      for (const [k, v] of Object.entries(s.filters)) if (v) qs.set(`f_${k}`, v);
      router.replace(`/app/raporlar/${encodeURIComponent(reportKey)}?${qs.toString()}`, {
        scroll: false,
      });
    },
    [def, reportKey, router],
  );

  // ------------------------------------------------------------ çalıştırma

  const run = useCallback(
    async (s: ToolbarState) => {
      setRunning(true);
      setError(null);
      setForbidden(false);
      // Yeni rakamların altında eski dönemin AI yorumu kalmaz.
      setNarrative(null);
      setNarrativeError(null);
      try {
        const res = await runReport(reportKey, paramsOf(s));
        setResult(res);
        setNotInCatalog(false);
      } catch (err) {
        setResult(null);
        if (isForbidden(err)) {
          setForbidden(true);
        } else if (isFeatureMissing(err)) {
          setDefMissing(true);
        } else {
          setError(errText(err, "Rapor hesaplanamadı."));
        }
      } finally {
        setRunning(false);
      }
    },
    [reportKey, paramsOf],
  );

  // İlk açılışta rapor kendiliğinden çalışır: kullanıcı rapora tıkladıysa
  // sonucu görmek istemiştir, bir düğmeye daha basmak istememiştir.
  useEffect(() => {
    if (state && !defLoading && result === null && !running && !error && !forbidden && !defMissing) {
      void run(state);
    }
    // Yalnızca ilk yükleme tetiklenir; sonraki çalıştırmalar düğmeyle olur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, defLoading]);

  function handleRun() {
    if (!state) return;
    syncUrl(state);
    void run(state);
  }

  // ------------------------------------------------------------ CSV

  const [csvBusy, setCsvBusy] = useState(false);

  async function handleCsv() {
    if (!state) return;
    setCsvBusy(true);
    try {
      await downloadReportCsv(
        reportKey,
        // EKRANDA HANGİ TABLO AÇIKSA O İNER. Sunucu `tablo` verilmezse
        // varsayılana düşer; kullanıcı başka bir sekmeye bakarken "CSV indir"
        // demiş olsaydı eline baktığından farklı bir dosya geçerdi.
        { ...paramsOf(state), table: result?.tableKey ?? undefined },
        csvFileName(reportKey, state.from, state.to),
      );
      push("CSV indirildi.");
    } catch (err) {
      push(
        isForbidden(err)
          ? FORBIDDEN_REPORT_TEXT
          : errText(err, "CSV indirilemedi."),
        "error",
      );
    } finally {
      setCsvBusy(false);
    }
  }

  // ------------------------------------------------------------ kaydet

  async function handleSave(name: string, scope: ReportScope) {
    if (!state) return;
    setSaving(true);
    setSaveError(null);
    try {
      await createSavedReport({ name, reportKey, params: paramsOf(state), scope });
      setSaveOpen(false);
      push("Rapor kaydedildi. Raporlar sayfasının üstünde görünecek.");
    } catch (err) {
      setSaveError(errText(err, "Rapor kaydedilemedi."));
    } finally {
      setSaving(false);
    }
  }

  // ------------------------------------------------------------ AI yorumu

  async function handleInterpret() {
    if (!state || !def?.aiTaskType) return;
    setNarrativeBusy(true);
    setNarrativeError(null);
    try {
      const res = await interpretReport(reportKey, paramsOf(state));
      setNarrative(res);
      notifyCreditsChanged();
    } catch (err) {
      // 402 / 50-kredi tavanı kartı kabukta TEK yerde gösterilir.
      if (!notifyCreditError(err)) {
        setNarrativeError(errText(err, "AI yorumu üretilemedi."));
      }
    } finally {
      setNarrativeBusy(false);
    }
  }

  // ------------------------------------------------------------ çizim

  const title = def?.name ?? result?.title ?? reportKey;

  const periodText = useMemo(() => {
    if (result?.period) {
      return periodLabel(result.period.from, result.period.to, result.period.toInclusive);
    }
    if (state && def?.periodRequired !== false) return periodLabel(state.from, state.to);
    return null;
  }, [result, state, def]);

  if (defLoading) return <Spinner label="Rapor tanımı yükleniyor…" />;

  if (defMissing) {
    return (
      <div className="space-y-4">
        <Breadcrumb title={title} />
        <FeatureUnavailable
          title="Rapor motoru henüz yayında değil"
          detail="POST /reports/:key/run ucu yayına alındığında bu rapor kendiliğinden çalışacak."
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <style>{PRINT_CSS}</style>

      <Breadcrumb title={title} />

      {/* Ekran başlığı baskıda gizlidir; kâğıt kendi başlığını (ad + dönem)
          yazdırma alanının içinde taşır. */}
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
          {def?.description && (
            <p className="mt-1 max-w-3xl text-sm text-slate-500">{def.description}</p>
          )}
        </div>
        {result && (
          <p className="text-xs text-slate-400">
            {fmtCount(result.rowCount)} satır
            {result.generatedAt ? ` · ${fmtDateTime(result.generatedAt)}` : ""}
            {result.durationMs !== null ? ` · ${fmtCount(result.durationMs)} ms` : ""}
          </p>
        )}
      </div>

      {forbidden && <ErrorBox message={FORBIDDEN_REPORT_TEXT} />}
      {!forbidden && notInCatalog && !result && (
        <ErrorBox message="Bu rapor katalogda görünmüyor. Rapor kaldırılmış olabilir ya da rolünüze kapalı olabilir." />
      )}
      {error && <ErrorBox message={error} />}

      {def && state && (
        <ReportToolbar
          def={def}
          state={state}
          onChange={setState}
          onRun={handleRun}
          running={running}
          actions={
            <>
              {def.supportsCsv && (
                <Button size="sm" variant="secondary" disabled={csvBusy || !result} onClick={() => void handleCsv()}>
                  {csvBusy ? "Hazırlanıyor…" : "CSV indir"}
                </Button>
              )}
              <Button
                size="sm"
                variant="secondary"
                disabled={!result}
                onClick={() => window.print()}
                title="Tarayıcının yazdırma penceresini açar; menüler ve düğmeler kâğıda basılmaz."
              >
                Yazdır
              </Button>
              <Button size="sm" variant="gold" disabled={!result} onClick={() => setSaveOpen(true)}>
                Bu raporu kaydet
              </Button>
            </>
          }
        />
      )}

      {/* Yazdırılan alan: başlık + dönem + özet + grafik + tablo. */}
      <div className="rapor-yazdirma-alani space-y-5">
        {/* Kâğıtta bağlam kaybolmasın: başlık ve dönem yalnız baskıda tekrarlanır. */}
        <div className="hidden print:block">
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          {periodText && <p className="text-xs text-slate-600">{periodText}</p>}
        </div>

        {running && <Spinner label="Rapor hesaplanıyor…" />}

        {result && !running && (
          <>
            {result.note && (
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs leading-5 text-slate-600">
                {result.note}
              </p>
            )}

            <MetricStrip metrics={result.metrics} />

            {result.previousPeriod && (
              <p className="text-[11px] text-slate-400">
                Karşılaştırma dönemi:{" "}
                {periodLabel(
                  result.previousPeriod.from,
                  result.previousPeriod.to,
                  result.previousPeriod.toInclusive,
                )}
              </p>
            )}

            <ReportCharts series={result.series} />

            <Card
              title={
                result.tables.length > 1
                  ? (result.tables.find((t) => t.key === result.tableKey)?.title ?? "Sonuç tablosu")
                  : "Sonuç tablosu"
              }
              action={
                <span className="text-[11px] text-slate-400">
                  Sütun başlığına tıklayarak sıralayın
                </span>
              }
            >
              {/* ÇOK TABLOLU RAPOR SEKMELERİ.
                  Bütün tablolar tek yanıtta geldi; sekme değiştirmek sunucuya
                  GİTMEZ. Sekme olmasaydı kullanıcı yalnız varsayılan tabloyu
                  görür, raporun geri kalanının var olduğunu bile bilmezdi. */}
              {result.tables.length > 1 && (
                <div className="mb-3 flex flex-wrap gap-1.5 print:hidden">
                  {result.tables.map((t) => {
                    const active = t.key === result.tableKey;
                    return (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => setResult(selectReportTable(result, t.key))}
                        aria-pressed={active}
                        title={t.definition ?? undefined}
                        className={
                          active
                            ? "rounded-md bg-slate-900 px-2.5 py-1 text-[12px] font-medium text-white"
                            : "rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[12px] text-slate-600 hover:bg-slate-50"
                        }
                      >
                        {t.title}
                        <span className={active ? "ml-1.5 text-slate-300" : "ml-1.5 text-slate-400"}>
                          {fmtCount(t.totalRowCount ?? t.rows.length)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Tablonun kendi tanımı: "bu tablo neyi sayıyor" sorusu
                  başlıktan okunamaz; sunucu cümleyi zaten üretiyor. */}
              {result.tables.find((t) => t.key === result.tableKey)?.definition && (
                <p className="mb-3 text-[11px] leading-5 text-slate-500">
                  {result.tables.find((t) => t.key === result.tableKey)?.definition}
                </p>
              )}

              <ReportTable columns={result.columns} rows={result.rows} totals={result.totals} />

              {/* KIRPILMA AÇIKÇA SÖYLENİR: eksik bir listeyi tam sanmak,
                  raporu yanlış okumanın en sessiz yoludur. */}
              {result.tables.find((t) => t.key === result.tableKey)?.truncated && (
                <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-800">
                  Satır sınırı uygulandı: {fmtCount(result.rows.length)} satır gösteriliyor,
                  toplam {fmtCount(result.rowCount)} satır var. Ölçü kartlarındaki toplamlar
                  TÜM satırlardan hesaplanmıştır; yalnız bu liste kısaltılmıştır. Tamamı için
                  CSV indirin veya satır sınırını yükseltin.
                </p>
              )}
            </Card>
          </>
        )}
      </div>

      {/* AI yorumu yazdırma alanının DIŞINDADIR: kâğıda basılan bir rapora
          "öneri" niteliğindeki bir metni katmak, ikisini eşit ağırlıkta
          gösterirdi. */}
      {result && def?.aiTaskType && (
        <NarrativePanel
          taskType={def.aiTaskType}
          costs={costs}
          narrative={narrative}
          busy={narrativeBusy}
          error={narrativeError}
          metrics={result.metrics}
          columns={result.columns}
          onRun={() => void handleInterpret()}
          onClear={() => setNarrative(null)}
        />
      )}

      <p className="text-[11px] leading-5 text-slate-400">
        Bu rapordaki bütün rakamlar veritabanından deterministik olarak hesaplanmıştır. Rol
        kısıtları sunucuda uygulanır: rolünüze kapalı sütun ve satırlar bu sonuca hiç girmez.
      </p>

      {state && (
        <SaveReportModal
          open={saveOpen}
          onClose={() => setSaveOpen(false)}
          defaultName={`${title}${periodText ? ` — ${state.from} / ${state.to}` : ""}`}
          params={paramsOf(state)}
          saving={saving}
          error={saveError}
          onSave={(name, scope) => void handleSave(name, scope)}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

function Breadcrumb({ title }: { title: string }) {
  return (
    <nav className="flex items-center gap-2 text-xs text-slate-400 print:hidden" aria-label="Konum">
      <Link href="/app/raporlar" className="hover:text-amber-600">
        Raporlar
      </Link>
      <span aria-hidden="true">/</span>
      <span className="truncate text-slate-600">{title}</span>
      <Badge tone="gray" className="ml-1">
        deterministik
      </Badge>
    </nav>
  );
}
