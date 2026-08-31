"use client";

/**
 * Rapor denetim çubuğu — dönem seçici, rapora özel filtreler ve eylemler.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ DÖNEM SINIRI AÇIKÇA YAZILIR (ortak karar 2).                             ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Aralık KAPALIDIR: `from` ve `to` günlerinin ikisi de rapora dâhildir ve bu
 * çubukta bu cümle yazılı durur. Bir tahsilat raporunun 31 Ağustos'u kapsayıp
 * kapsamadığı, ay kapanış toplamını değiştirir; kullanıcının bunu tahmin
 * etmesi gerekmemelidir.
 *
 * Filtre ALANLARI koda gömülmez, katalogdan gelir: rapor motoru yeni bir
 * filtre eklediğinde bu ekran değiştirilmeden çalışır.
 */

import { Button, Field, Input, Select } from "@/components/ui";
import {
  REPORT_PERIOD_PRESETS,
  periodLabel,
  previousPeriodOf,
  resolvePeriod,
  type ReportPeriodPreset,
} from "@/lib/labels";
import type { ReportCatalogItem } from "../../_lib/faz6-types";

export interface ToolbarState {
  preset: ReportPeriodPreset;
  from: string;
  to: string;
  compare: boolean;
  filters: Record<string, string>;
}

export function ReportToolbar({
  def,
  state,
  onChange,
  onRun,
  running,
  actions,
}: {
  def: ReportCatalogItem;
  state: ToolbarState;
  onChange: (next: ToolbarState) => void;
  onRun: () => void;
  running: boolean;
  /** CSV / Yazdır / Kaydet / AI düğmeleri — sayfa tarafından verilir. */
  actions: React.ReactNode;
}) {
  const prev = state.compare ? previousPeriodOf(state.from, state.to) : null;

  function setPreset(preset: ReportPeriodPreset) {
    if (preset === "OZEL") {
      onChange({ ...state, preset });
      return;
    }
    // Ön tanımlı dönemler tarihleri de yeniler; "geçen ay" seçip eski
    // tarihlerin kalması, kullanıcıya yanlış dönemin rakamını gösterirdi.
    const { from, to } = resolvePeriod(preset);
    onChange({ ...state, preset, from, to });
  }

  // Çubuk baskıda gizlenir: form alanları kâğıtta anlamsızdır. Dönem bilgisi
  // yazdırma alanının kendi başlığında tekrarlanır.
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm print:hidden">
      <div className="flex flex-wrap items-end gap-3">
        {def.periodRequired && (
          <>
            <div className="w-40">
              <Field label="Dönem">
                <Select
                  value={state.preset}
                  onChange={(e) => setPreset(e.target.value as ReportPeriodPreset)}
                >
                  {REPORT_PERIOD_PRESETS.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="w-44">
              <Field label="Başlangıç (dâhil)">
                <Input
                  type="date"
                  value={state.from}
                  onChange={(e) => onChange({ ...state, preset: "OZEL", from: e.target.value })}
                />
              </Field>
            </div>
            <div className="w-44">
              <Field label="Bitiş (dâhil)">
                <Input
                  type="date"
                  value={state.to}
                  onChange={(e) => onChange({ ...state, preset: "OZEL", to: e.target.value })}
                />
              </Field>
            </div>
          </>
        )}

        {def.filters.map((f) => (
          <div key={f.key} className="w-48">
            <Field label={f.label} hint={f.hint ?? undefined}>
              {f.type === "SECIM" ? (
                <Select
                  value={state.filters[f.key] ?? ""}
                  onChange={(e) =>
                    onChange({ ...state, filters: { ...state.filters, [f.key]: e.target.value } })
                  }
                >
                  <option value="">Tümü</option>
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              ) : f.type === "BOOL" ? (
                <Select
                  value={state.filters[f.key] ?? ""}
                  onChange={(e) =>
                    onChange({ ...state, filters: { ...state.filters, [f.key]: e.target.value } })
                  }
                >
                  <option value="">Farketmez</option>
                  <option value="true">Evet</option>
                  <option value="false">Hayır</option>
                </Select>
              ) : (
                <Input
                  type={f.type === "TARIH" ? "date" : f.type === "SAYI" ? "number" : "text"}
                  value={state.filters[f.key] ?? ""}
                  onChange={(e) =>
                    onChange({ ...state, filters: { ...state.filters, [f.key]: e.target.value } })
                  }
                />
              )}
            </Field>
          </div>
        ))}

        <Button variant="primary" onClick={onRun} disabled={running}>
          {running ? "Hesaplanıyor…" : "Raporu çalıştır"}
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <div className="min-w-0">
          {def.periodRequired && (
            <p className="text-xs text-slate-600">
              <strong>Dönem:</strong> {periodLabel(state.from, state.to)}
            </p>
          )}
          {def.supportsComparison && (
            <label className="mt-1.5 inline-flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={state.compare}
                onChange={(e) => onChange({ ...state, compare: e.target.checked })}
                className="h-3.5 w-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
              />
              Önceki dönemle karşılaştır
              {prev && (
                <span className="text-slate-400">
                  ({periodLabel(prev.from, prev.to)})
                </span>
              )}
            </label>
          )}
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">{actions}</div>
      </div>
    </div>
  );
}
