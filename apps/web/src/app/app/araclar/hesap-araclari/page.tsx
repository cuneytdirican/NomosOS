"use client";

/**
 * HESAP ARAÇLARI (D2 A3) — kıdem/ihbar, faiz, dava harcı.
 *
 * Tüm motorlar legal-core'da DETERMİNİSTİKTİR (vekalet ücreti deseni); bu
 * sayfa yalnızca girdi toplar ve ADIMLARI aynen gösterir — avukat hesabı
 * denetleyebilir. Motor uyarıları (tavan, işe iade, tarife değişimi) eksiksiz
 * listelenir.
 */

import { useState } from "react";
import {
  calculateKidemIhbar,
  calculateSimpleInterest,
  calculateDavaHarci,
} from "@nomosos/legal-core";
import { Badge, Button, Card, Field, Input } from "@/components/ui";

function Steps({ steps }: { steps: Array<{ label: string; detail?: string; value?: string }> }) {
  return (
    <ol className="mt-3 space-y-1.5">
      {steps.map((s, i) => (
        <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-1.5 text-xs">
          <span className="font-medium text-slate-700">
            {s.label}
            {s.detail && <span className="ml-1 font-normal text-slate-500">— {s.detail}</span>}
          </span>
          {s.value && <span className="font-semibold tabular-nums text-slate-900">{s.value}</span>}
        </li>
      ))}
    </ol>
  );
}

function Warnings({ items }: { items: string[] }) {
  return (
    <ul className="mt-3 list-inside list-disc space-y-0.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] leading-4 text-amber-900">
      {items.map((w, i) => (
        <li key={i}>{w}</li>
      ))}
    </ul>
  );
}

export default function HesapAraclariPage() {
  const [tab, setTab] = useState<"kidem" | "faiz" | "harc">("kidem");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Hesap Araçları</h1>
        <p className="mt-1 text-sm text-slate-500">
          Kıdem/ihbar tazminatı, faiz ve dava harcı — deterministik motorlar, her adım görünür.
        </p>
      </div>

      <div className="flex gap-2">
        {(
          [
            ["kidem", "Kıdem / İhbar"],
            ["faiz", "Faiz"],
            ["harc", "Dava Harcı"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === key ? "border-slate-300 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "kidem" && <KidemIhbar />}
      {tab === "faiz" && <Faiz />}
      {tab === "harc" && <Harc />}
    </div>
  );
}

function KidemIhbar() {
  const [monthlyGross, setMonthlyGross] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [ceiling, setCeiling] = useState("");
  const [includeNotice, setIncludeNotice] = useState(true);
  const [result, setResult] = useState<ReturnType<typeof calculateKidemIhbar> | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    try {
      setResult(
        calculateKidemIhbar({
          monthlyGross: Number(monthlyGross.replace(",", ".")),
          startDate,
          endDate,
          ceiling: ceiling ? Number(ceiling.replace(",", ".")) : undefined,
          includeNotice,
        }),
      );
    } catch (err) {
      setError((err as Error).message);
      setResult(null);
    }
  }

  return (
    <Card>
      <div className="grid gap-3 p-5 sm:grid-cols-2">
        <Field label="Brüt ücret (aylık TL)">
          <Input value={monthlyGross} onChange={(e) => setMonthlyGross(e.target.value)} placeholder="30000" inputMode="decimal" />
        </Field>
        <Field label="Kıdem tazminatı tavanı (TL)" hint="Boş: tavan uygulanmaz. Dönem tavanını teyit ederek girin.">
          <Input value={ceiling} onChange={(e) => setCeiling(e.target.value)} placeholder="35.000" inputMode="decimal" />
        </Field>
        <Field label="İşe giriş">
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <Field label="Çıkış">
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={includeNotice}
            onChange={(e) => setIncludeNotice(e.target.checked)}
            className="h-4 w-4 accent-amber-600"
          />
          İhbar tazminatını da hesapla (İş K. m.17)
        </label>
        <div className="flex items-end justify-end">
          <Button
            disabled={!monthlyGross || !startDate || !endDate}
            onClick={run}
          >
            Hesapla
          </Button>
        </div>
      </div>
      {error && <p className="px-5 pb-3 text-xs text-red-700">{error}</p>}
      {result && (
        <div className="border-t border-slate-100 p-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs text-slate-500">Kıdem tazminatı</p>
              <p className="mt-1 text-xl font-bold text-slate-900">
                {result.kidemTazminat.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
              </p>
              <p className="text-[11px] text-slate-500">{result.kidemDays} gün</p>
            </div>
            {result.ihbarTazminat !== null && (
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs text-slate-500">İhbar tazminatı</p>
                <p className="mt-1 text-xl font-bold text-slate-900">
                  {result.ihbarTazminat.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
                </p>
                <p className="text-[11px] text-slate-500">{result.ihbarWeeks} hafta (m.17)</p>
              </div>
            )}
          </div>
          {result.ceilingApplied && (
            <p className="mt-2">
              <Badge tone="yellow">Tavan uygulandı</Badge>
            </p>
          )}
          <Steps steps={result.steps} />
          <Warnings items={result.warnings} />
        </div>
      )}
    </Card>
  );
}

function Faiz() {
  const [principal, setPrincipal] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [rate, setRate] = useState("");
  const [result, setResult] = useState<ReturnType<typeof calculateSimpleInterest> | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    try {
      setResult(
        calculateSimpleInterest({
          principal: Number(principal.replace(",", ".")),
          fromDate,
          toDate,
          annualRatePercent: Number(rate.replace(",", ".")),
        }),
      );
    } catch (err) {
      setError((err as Error).message);
      setResult(null);
    }
  }

  return (
    <Card>
      <div className="grid gap-3 p-5 sm:grid-cols-2">
        <Field label="Ana para (TL)">
          <Input value={principal} onChange={(e) => setPrincipal(e.target.value)} placeholder="100000" inputMode="decimal" />
        </Field>
        <Field label="Yıllık faiz oranı (%)" hint="Güncel oran: temerrüt faizi dönemsel değişir; teyit edin.">
          <Input value={rate} onChange={(e) => setRate(e.target.value)} placeholder="24.75" inputMode="decimal" />
        </Field>
        <Field label="Başlangıç (temerrüt)">
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </Field>
        <Field label="Bitiş">
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </Field>
        <div className="flex items-end justify-end sm:col-span-2">
          <Button disabled={!principal || !rate || !fromDate || !toDate} onClick={run}>
            Hesapla
          </Button>
        </div>
      </div>
      {error && <p className="px-5 pb-3 text-xs text-red-700">{error}</p>}
      {result && (
        <div className="border-t border-slate-100 p-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs text-slate-500">İşlemiş faiz ({result.days} gün)</p>
              <p className="mt-1 text-xl font-bold text-slate-900">
                {result.interest.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs text-slate-500">Ana para + faiz</p>
              <p className="mt-1 text-xl font-bold text-slate-900">
                {result.total.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
              </p>
            </div>
          </div>
          <Steps steps={result.steps} />
          <p className="mt-2 text-[11px] text-slate-500">
            Basit faiz esastır (Yargıtay icra uygulaması); bileşik faiz hesaplanmaz.
          </p>
        </div>
      )}
    </Card>
  );
}

function Harc() {
  const [caseValue, setCaseValue] = useState("");
  const [pesinRate, setPesinRate] = useState("");
  const [result, setResult] = useState<ReturnType<typeof calculateDavaHarci> | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    try {
      setResult(
        calculateDavaHarci({
          caseValue: Number(caseValue.replace(",", ".")),
          pesinRatePerMille: pesinRate ? Number(pesinRate.replace(",", ".")) : undefined,
        }),
      );
    } catch (err) {
      setError((err as Error).message);
      setResult(null);
    }
  }

  return (
    <Card>
      <div className="grid gap-3 p-5 sm:grid-cols-2">
        <Field label="Dava değeri (TL)">
          <Input value={caseValue} onChange={(e) => setCaseValue(e.target.value)} placeholder="150000" inputMode="decimal" />
        </Field>
        <Field label="Peşin harç oranı (‰)" hint="Boş: binde 68,31. Güncel tarife oranını teyit edin.">
          <Input value={pesinRate} onChange={(e) => setPesinRate(e.target.value)} placeholder="68.31" inputMode="decimal" />
        </Field>
        <div className="flex items-end justify-end sm:col-span-2">
          <Button disabled={!caseValue} onClick={run}>
            Hesapla
          </Button>
        </div>
      </div>
      {error && <p className="px-5 pb-3 text-xs text-red-700">{error}</p>}
      {result && (
        <div className="border-t border-slate-100 p-5">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs text-slate-500">Peşin harç</p>
              <p className="mt-1 text-lg font-bold text-slate-900">
                {result.pesinHarc.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs text-slate-500">İstinaf</p>
              <p className="mt-1 text-lg font-bold text-slate-900">
                {result.istinafHarc?.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs text-slate-500">Temyiz</p>
              <p className="mt-1 text-lg font-bold text-slate-900">
                {result.temyizHarc?.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
              </p>
            </div>
          </div>
          <Steps steps={result.steps} />
          <Warnings items={result.warnings} />
        </div>
      )}
    </Card>
  );
}
