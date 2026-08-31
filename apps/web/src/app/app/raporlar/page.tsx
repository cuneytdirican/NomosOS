"use client";

/**
 * RAPORLAR — katalog ve kayıtlı raporlar (Faz 6, Modül 18 raporlama kesiti).
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ KATALOĞU SUNUCU SÜZER.                                                   ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Kullanıcının rolüne kapalı raporlar (STAJYER → finans, SEKRETER → kârlılık /
 * verimlilik) bu listeye HİÇ GELMEZ. Arayüz ayrıca gizleme yapmaz: istemcide
 * saklamak yetki değil dekordur, ve iki ayrı yerde tutulan bir kural er geç
 * ayrışır. Burada yalnızca sunucunun verdiği liste çizilir.
 *
 * Kayıtlı raporlar SONUÇ SAKLAMAZ — yalnız tanım (rapor + filtre + dönem).
 * Açıldıklarında rakam yeniden hesaplanır; ekranda dünkü rakam kalmaz.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, EmptyState, ErrorBox, Spinner } from "@/components/ui";
import { FeatureUnavailable } from "@/components/ai-ui";
import { ToastStack, useToasts } from "@/components/ai-ui";
import { errText } from "@/lib/faz2";
import {
  REPORT_SCOPE_LABELS,
  REPORT_SCOPE_TONES,
  fmtDate,
  labelOf,
  periodLabel,
} from "@/lib/labels";
import {
  deleteSavedReport,
  fetchReportCatalog,
  isFeatureMissing,
  listSavedReports,
  updateSavedReport,
} from "../_lib/faz6";
import type { ReportCatalogItem, SavedReportItem } from "../_lib/faz6-types";

export default function ReportsPage() {
  const [catalog, setCatalog] = useState<ReportCatalogItem[]>([]);
  const [saved, setSaved] = useState<SavedReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { toasts, push, dismiss } = useToasts();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchReportCatalog();
      setCatalog(list);
      setMissing(false);
    } catch (err) {
      if (isFeatureMissing(err)) {
        setMissing(true);
      } else {
        setError(errText(err, "Rapor kataloğu yüklenemedi."));
      }
      setCatalog([]);
    } finally {
      setLoading(false);
    }

    // Kayıtlı raporlar BAĞIMSIZ yüklenir: katalog gelmese bile kullanıcının
    // kendi tanımları görünür (ve tersi).
    try {
      setSaved(await listSavedReports());
    } catch {
      setSaved([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Katalog kategoriye göre gruplanır; kategorisiz raporlar "Diğer" altında. */
  const groups = useMemo(() => {
    const map = new Map<string, ReportCatalogItem[]>();
    for (const item of catalog) {
      const key = item.category ?? "Diğer";
      const bucket = map.get(key);
      if (bucket) bucket.push(item);
      else map.set(key, [item]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "tr-TR"));
  }, [catalog]);

  /** Sabitlenmiş kayıtlı raporlar HER ZAMAN üstte. */
  const sortedSaved = useMemo(
    () =>
      [...saved].sort((a, b) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        return a.name.localeCompare(b.name, "tr-TR");
      }),
    [saved],
  );

  const catalogByKey = useMemo(
    () => new Map(catalog.map((c) => [c.key, c])),
    [catalog],
  );

  async function togglePin(item: SavedReportItem) {
    setBusyId(item.id);
    try {
      const next = await updateSavedReport(item.id, { isPinned: !item.isPinned });
      setSaved((prev) => prev.map((s) => (s.id === item.id ? next : s)));
    } catch (err) {
      push(errText(err, "Sabitleme değiştirilemedi."), "error");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(item: SavedReportItem) {
    if (!window.confirm(`"${item.name}" kayıtlı raporu silinsin mi? Rapor tanımı kalıcı olarak kaldırılır.`)) {
      return;
    }
    setBusyId(item.id);
    try {
      await deleteSavedReport(item.id);
      setSaved((prev) => prev.filter((s) => s.id !== item.id));
      push("Kayıtlı rapor silindi.");
    } catch (err) {
      push(errText(err, "Kayıtlı rapor silinemedi."), "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Raporlar</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Bu raporlardaki bütün rakamlar <strong>veritabanından deterministik olarak</strong>{" "}
          hesaplanır. AI, yalnızca hazır rakamları Türkçe yorumlayabilir; hiçbir sayıyı kendisi
          üretmez.
        </p>
      </div>

      {error && <ErrorBox message={error} />}

      {/* ---------------- Kayıtlı raporlar ---------------- */}
      {sortedSaved.length > 0 && (
        <Card title={`Kayıtlı Raporlar (${sortedSaved.length})`}>
          <ul className="divide-y divide-slate-100">
            {sortedSaved.map((s) => {
              const def = catalogByKey.get(s.reportKey);
              return (
                <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {s.isPinned && (
                        <span aria-label="Sabitlenmiş" title="Sabitlenmiş" className="text-amber-500">
                          ★
                        </span>
                      )}
                      <Link
                        href={savedHref(s)}
                        className="text-sm font-semibold text-slate-900 hover:text-amber-600"
                      >
                        {s.name}
                      </Link>
                      <Badge tone={REPORT_SCOPE_TONES[s.scope] ?? "gray"}>
                        {labelOf(REPORT_SCOPE_LABELS, s.scope)}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {def?.name ?? s.reportKey}
                      {s.params.from && s.params.to
                        ? ` · ${periodLabel(s.params.from, s.params.to)}`
                        : ""}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {s.createdByName ? `${s.createdByName} oluşturdu` : "Oluşturan bilinmiyor"}
                      {s.createdAt ? ` · ${fmtDate(s.createdAt)}` : ""}
                      {" · sonuç saklanmaz, açılışta yeniden hesaplanır"}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busyId === s.id || !s.canEdit}
                      onClick={() => void togglePin(s)}
                      title={
                        s.canEdit
                          ? s.isPinned
                            ? "Sabitlemeyi kaldır"
                            : "Listenin üstüne sabitle"
                          : "Bu kaydı yalnızca oluşturan kişi düzenleyebilir."
                      }
                    >
                      {s.isPinned ? "Sabitlemeyi kaldır" : "Sabitle"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyId === s.id || !s.canEdit}
                      onClick={() => void remove(s)}
                    >
                      Sil
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {/* ---------------- Katalog ---------------- */}
      {loading ? (
        <Spinner label="Rapor kataloğu yükleniyor…" />
      ) : missing ? (
        <FeatureUnavailable
          title="Rapor motoru henüz yayında değil"
          detail="GET /reports/catalog ucu yayına alındığında bu sayfa kendiliğinden dolacak. Kayıtlı rapor tanımlarınız korunur."
          onRetry={() => void load()}
        />
      ) : catalog.length === 0 ? (
        <EmptyState message="Rolünüze açık rapor bulunmuyor. Rapor yetkileri sunucuda tanımlanır; erişim gerekiyorsa büro yöneticinize başvurun." />
      ) : (
        groups.map(([category, items]) => (
          <section key={category}>
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
              {category}
            </h2>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => (
                <CatalogCard key={item.key} item={item} />
              ))}
            </div>
          </section>
        ))
      )}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

/**
 * Kayıtlı raporun bağlantısı — parametreler URL'e yazılır.
 *
 * NEDEN URL: rapor görüntüleyici tek gerçek kaynak olarak adres çubuğunu okur.
 * Böylece kayıtlı rapor bağlantısı kopyalanıp paylaşılabilir ve tarayıcının
 * geri tuşu dönem değişikliklerini de geri alır.
 */
function savedHref(s: SavedReportItem): string {
  const qs = new URLSearchParams();
  if (s.params.from) qs.set("from", s.params.from);
  if (s.params.to) qs.set("to", s.params.to);
  if (s.params.preset) qs.set("donem", s.params.preset);
  if (s.params.compare) qs.set("kiyas", "1");
  for (const [k, v] of Object.entries(s.params.filters ?? {})) {
    if (v) qs.set(`f_${k}`, v);
  }
  qs.set("kayit", s.id);
  return `/app/raporlar/${encodeURIComponent(s.reportKey)}?${qs.toString()}`;
}

function CatalogCard({ item }: { item: ReportCatalogItem }) {
  return (
    <Link
      href={`/app/raporlar/${encodeURIComponent(item.key)}`}
      className="group flex h-full flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
    >
      <p className="text-sm font-semibold text-slate-900 group-hover:text-amber-600">{item.name}</p>
      {item.description && (
        <p className="mt-1.5 flex-1 text-xs leading-5 text-slate-500">{item.description}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {item.periodRequired && <Badge tone="gray">dönem seçimli</Badge>}
        {item.supportsComparison && <Badge tone="gray">önceki dönem kıyası</Badge>}
        {item.supportsCsv && <Badge tone="gray">CSV</Badge>}
        {item.aiTaskType && <Badge tone="gold">AI yorumu</Badge>}
      </div>
      {item.scopeNote && (
        <p className="mt-3 border-t border-slate-100 pt-2 text-[11px] leading-4 text-slate-400">
          {item.scopeNote}
        </p>
      )}
    </Link>
  );
}
