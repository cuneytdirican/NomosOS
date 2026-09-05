"use client";

/**
 * Dosya detayı — Faz 7G sekmeleri: Tanıklar, Harçlar, Vekaletname, Finans, Kapanış.
 * Tek dosyada beş küçük sekme; her biri kendi ucunu çeker ve `FeatureUnavailable` ile düşer.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { calculateDavaHarci } from "@nomosos/legal-core";
import { errText, isMissingEndpoint } from "@/lib/faz2";
import {
  SUMMONS_LABELS,
  createCaseExpense,
  createWitness,
  fetchCaseFinance,
  fetchClosingChecklist,
  fetchHarcTarifesi,
  fetchPoaStatus,
  listCaseExpenses,
  listWitnesses,
  saveClosingChecklist,
  updateWitness,
  type CaseExpenseRow,
  type CaseFinanceSummary,
  type ClosingChecklistView,
  type HarcTarifesiView,
  type PoaStatusView,
  type WitnessEvidence,
} from "@/lib/faz7-dosya";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Select, Spinner, StatCard, Textarea } from "@/components/ui";
import { FeatureUnavailable } from "@/components/ai-ui";
import { fmtAmount } from "@/lib/money";
import { fmtDate, fmtDateTime } from "@/lib/labels";
import { PoaTab } from "./poa-tab";
import type { CaseSummary } from "@/lib/types";

type Notify = (text: string, tone?: "success" | "error" | "info") => void;

/* ------------------------------------------------------------------ Tanıklar */

export function WitnessTab({ caseId, onNotify }: { caseId: string; onNotify: Notify }) {
  const [rows, setRows] = useState<WitnessEvidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("");
  const [contact, setContact] = useState("");
  const [topic, setTopic] = useState("");
  const [side, setSide] = useState<"BIZ" | "KARSI_TARAF">("BIZ");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listWitnesses(caseId));
      setMissing(false);
    } catch (err) {
      if (isMissingEndpoint(err)) setMissing(true);
      else setError(errText(err, "Tanıklar yüklenemedi."));
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    setBusy(true);
    try {
      await createWitness(caseId, { title: topic.trim() || `Tanık: ${name.trim()}`, witnessName: name.trim(), description: topic.trim() || null, offeredBy: side, witnessInfo: { contact: contact.trim() || null, relation: relation.trim() || null, summonsStatus: "BEKLIYOR", statementSummary: null } });
      onNotify("Tanık kaydedildi (delil listesine TANIK olarak işlendi).", "success");
      setName("");
      setRelation("");
      setContact("");
      setTopic("");
      await load();
    } catch (err) {
      onNotify(errText(err, "Tanık kaydedilemedi."), "error");
    } finally {
      setBusy(false);
    }
  }

  async function setSummons(w: WitnessEvidence, status: string) {
    setBusy(true);
    try {
      await updateWitness(w.id, { witnessInfo: { ...(w.witnessInfo ?? {}), summonsStatus: status as WitnessEvidence["witnessInfo"] extends infer T ? (T extends { summonsStatus?: infer S } ? S : never) : never } });
      await load();
    } catch (err) {
      onNotify(errText(err, "Güncellenemedi."), "error");
    } finally {
      setBusy(false);
    }
  }

  async function setStatement(w: WitnessEvidence) {
    const text = window.prompt("Beyan özeti (duruşmada ne söyledi / ne söylemesi bekleniyor):", w.witnessInfo?.statementSummary ?? "");
    if (text === null) return;
    setBusy(true);
    try {
      await updateWitness(w.id, { witnessInfo: { ...(w.witnessInfo ?? {}), statementSummary: text.trim() || null } });
      await load();
    } catch (err) {
      onNotify(errText(err, "Güncellenemedi."), "error");
    } finally {
      setBusy(false);
    }
  }

  if (missing) return <FeatureUnavailable title="Delil/tanık ucu yayında değil" detail="/api/v1/cases/:id/evidence" onRetry={() => void load()} />;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card title={`Tanıklar (${rows.length})`} className="lg:col-span-2">
        {error && <ErrorBox message={error} />}
        {loading ? (
          <Spinner label="Tanıklar yükleniyor…" />
        ) : rows.length === 0 ? (
          <EmptyState message="Tanık kaydı yok. Sağdaki formdan ekleyin; tanıklar Deliller sekmesinde de TANIK delili olarak görünür." />
        ) : (
          <ul className="space-y-3">
            {rows.map((w) => (
              <li key={w.id} className="rounded-lg border border-slate-200 px-4 py-3" data-testid="tanik-satiri">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{w.witnessName ?? w.title}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {w.witnessInfo?.relation ? `${w.witnessInfo.relation} · ` : ""}
                      {w.witnessInfo?.contact ? `${w.witnessInfo.contact} · ` : ""}
                      {w.offeredBy === "KARSI_TARAF" ? "karşı taraf tanığı" : "bizim tanığımız"}
                    </p>
                    {w.description && <p className="mt-1 text-xs text-slate-600">{w.description}</p>}
                    {w.witnessInfo?.statementSummary && <p className="mt-1 rounded bg-slate-50 px-2 py-1 text-xs text-slate-700">Beyan: {w.witnessInfo.statementSummary}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <Badge tone={w.witnessInfo?.summonsStatus === "DINLENDI" ? "green" : w.witnessInfo?.summonsStatus === "VAZGECILDI" ? "gray" : "yellow"}>{SUMMONS_LABELS[w.witnessInfo?.summonsStatus ?? "BEKLIYOR"]}</Badge>
                    <Select value={w.witnessInfo?.summonsStatus ?? "BEKLIYOR"} onChange={(e) => void setSummons(w, e.target.value)} className="w-40 py-1 text-xs" disabled={busy}>
                      {Object.entries(SUMMONS_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </Select>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void setStatement(w)}>
                      Beyan özeti
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Tanık Ekle">
        <div className="space-y-3">
          <Field label="Ad Soyad">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Yakınlık / sıfat">
            <Input value={relation} onChange={(e) => setRelation(e.target.value)} placeholder="Ör. iş arkadaşı, komşu" />
          </Field>
          <Field label="İletişim" hint="Yalnız büro içi; portala yayınlanmaz.">
            <Input value={contact} onChange={(e) => setContact(e.target.value)} />
          </Field>
          <Field label="Tanıklık konusu">
            <Textarea rows={2} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Hangi vakıayı ispatlayacak?" />
          </Field>
          <Field label="Taraf">
            <Select value={side} onChange={(e) => setSide(e.target.value as "BIZ" | "KARSI_TARAF")}>
              <option value="BIZ">Bizim tanığımız</option>
              <option value="KARSI_TARAF">Karşı taraf tanığı</option>
            </Select>
          </Field>
          <Button variant="gold" disabled={busy || name.trim().length < 3} onClick={() => void add()} data-testid="tanik-ekle">
            Tanığı kaydet
          </Button>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ Harçlar */

export function HarcTab({ caseId, onNotify }: { caseId: string; onNotify: Notify }) {
  const year = new Date().getFullYear();
  const [tarife, setTarife] = useState<HarcTarifesiView | null>(null);
  const [expenses, setExpenses] = useState<CaseExpenseRow[]>([]);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [t, e] = await Promise.all([fetchHarcTarifesi(year).catch(() => null), listCaseExpenses(caseId).catch(() => [])]);
      setTarife(t);
      setExpenses(e.filter((x) => x.category === "HARC"));
    } catch (err) {
      setError(errText(err, "Harç bilgileri yüklenemedi."));
    }
  }, [caseId, year]);

  useEffect(() => {
    void load();
  }, [load]);

  const result = useMemo(() => {
    const v = Number(value.replace(/\./g, "").replace(",", "."));
    if (!(v > 0)) return null;
    try {
      return calculateDavaHarci({
        caseValue: v,
        pesinRatePerMille: tarife?.pesinBinde ? Number(tarife.pesinBinde) : undefined,
        istinafRatePerMille: tarife?.istinafBinde ? Number(tarife.istinafBinde) : undefined,
        temyizRatePerMille: tarife?.temyizBinde ? Number(tarife.temyizBinde) : undefined,
      });
    } catch {
      return null;
    }
  }, [value, tarife]);

  async function record(title: string, amount: number) {
    setBusy(true);
    try {
      await createCaseExpense(caseId, { category: "HARC", title, amount: Math.round(amount * 100) / 100, spentAt: new Date().toISOString().slice(0, 10), paidFrom: "AVANS", refundable: false });
      onNotify(`${title} gider olarak kaydedildi (HARC).`, "success");
      await load();
    } catch (err) {
      onNotify(errText(err, "Gider kaydedilemedi."), "error");
    } finally {
      setBusy(false);
    }
  }

  const total = expenses.reduce((a, e) => a + Number(e.amount), 0);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card title={`Harç Hesabı (${year} tarifesi)`} className="lg:col-span-2">
        {error && <ErrorBox message={error} />}
        <p className="mb-3 text-xs leading-5 text-slate-500">
          {tarife?.tanimli
            ? `Platform tarifesi: peşin ‰${tarife.pesinBinde} · istinaf ‰${tarife.istinafBinde} · temyiz ‰${tarife.temyizBinde}${tarife.kaynak ? ` (${tarife.kaynak})` : ""}.`
            : tarife?.mesaj ?? "Tarife platformdan alınamadı; varsayılan binde oranlarıyla hesaplanır — Resmî Gazete tarifesiyle teyit edin."}
        </p>
        <Field label="Dava değeri (TL)">
          <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Ör. 250.000" inputMode="decimal" data-testid="harc-deger" />
        </Field>
        {result && (
          <div className="mt-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard label="Peşin harç" value={fmtAmount(result.pesinHarc.toFixed(2), "TRY")} tone="navy" />
              <StatCard label="İstinaf harcı" value={result.istinafHarc !== null ? fmtAmount(result.istinafHarc.toFixed(2), "TRY") : "—"} tone="slate" />
              <StatCard label="Temyiz harcı" value={result.temyizHarc !== null ? fmtAmount(result.temyizHarc.toFixed(2), "TRY") : "—"} tone="slate" />
            </div>
            <ol className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              {result.steps.map((s, i) => (
                <li key={i}>
                  {s.label}
                  {s.detail ? ` — ${s.detail}` : ""}
                  {s.value ? `: ${s.value}` : ""}
                </li>
              ))}
            </ol>
            {result.warnings.map((w, i) => (
              <p key={i} className="text-xs text-amber-800">{w}</p>
            ))}
            {(tarife?.maktuKalemler?.length ?? 0) > 0 && (
              <div className="text-xs text-slate-600">
                <p className="font-medium">Maktu kalemler ({year}):</p>
                <ul className="mt-1 flex flex-wrap gap-2">
                  {tarife!.maktuKalemler.map((k) => (
                    <li key={k.kod}>
                      <button type="button" className="rounded border border-slate-300 px-2 py-0.5 hover:bg-amber-50" disabled={busy} onClick={() => void record(k.ad, Number(k.tutar))}>
                        {k.ad}: {fmtAmount(k.tutar, "TRY")} → gider
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void record("Peşin harç", result.pesinHarc)}>
                Peşin harcı gider olarak kaydet
              </Button>
            </div>
          </div>
        )}
        <p className="mt-3 text-[11px] text-slate-500">Hesap deterministiktir (legal-core); nispi harç oranları tarifeden, maktu kalemler platform tarifesinden gelir. Muafiyet/indirim durumlarını avukat değerlendirir.</p>
      </Card>
      <Card title={`Harç Giderleri (${fmtAmount(total.toFixed(2), "TRY")})`}>
        {expenses.length === 0 ? (
          <EmptyState message="Bu dosyada HARC kategorili gider yok." />
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {expenses.map((e) => (
              <li key={e.id} className="flex items-center justify-between py-2">
                <span className="min-w-0 truncate">
                  {e.title}
                  <span className="block text-xs text-slate-500">{fmtDate(e.spentAt)}{e.paidAt ? " · ödendi" : " · ödenmedi"}</span>
                </span>
                <span className="font-semibold tabular-nums">{fmtAmount(String(e.amount), "TRY")}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[11px] text-slate-500">Tümü için Giderler sekmesine bakın.</p>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ Vekaletname */

export function CasePoaTab({ caseId, clientId, cases, onNotify }: { caseId: string; clientId: string | null; cases: CaseSummary[]; onNotify: Notify }) {
  const [status, setStatus] = useState<PoaStatusView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPoaStatus(caseId)
      .then(setStatus)
      .catch((err) => setError(errText(err, "Vekâlet durumu alınamadı.")));
  }, [caseId]);

  return (
    <div className="space-y-6">
      <Card title="Bu Dosya İçin Vekâlet Durumu">
        {error && <ErrorBox message={error} />}
        {status ? (
          <>
            <div className="flex items-center gap-3">
              <Badge tone={status.hasValidPoa ? "green" : "red"}>{status.hasValidPoa ? "Geçerli vekâlet var" : "Geçerli vekâlet yok"}</Badge>
              {status.banner && <p className="text-sm text-slate-700">{status.banner}</p>}
            </div>
            {status.items?.length > 0 && (
              <ul className="mt-3 divide-y divide-slate-100 text-sm">
                {status.items.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      {p.type} · {p.notary ?? "noter ?"} {p.number ?? ""} · {p.issuedAt ? fmtDate(p.issuedAt) : ""}
                      {p.scopedToCase ? " · bu dosyaya özel" : " · genel"}
                    </span>
                    <span className="flex gap-2">
                      {p.daysRemaining !== null && p.daysRemaining <= 60 && p.usable && <Badge tone="yellow">{p.daysRemaining} gün kaldı</Badge>}
                      <Badge tone={p.usable ? "green" : "gray"}>{p.usable ? "kullanılabilir" : "geçersiz"}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          !error && <Spinner label="Vekâlet durumu yükleniyor…" />
        )}
      </Card>
      {clientId ? <PoaTab clientId={clientId} cases={cases} onNotify={onNotify} /> : <EmptyState message="Dosyanın müvekkili yok." />}
    </div>
  );
}

/* ------------------------------------------------------------------ Finans */

export function CaseFinanceTab({ caseId }: { caseId: string }) {
  const [data, setData] = useState<CaseFinanceSummary | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCaseFinance(caseId)
      .then(setData)
      .catch((err) => {
        if (isMissingEndpoint(err)) setMissing(true);
        else setError(errText(err, "Finans özeti alınamadı."));
      });
  }, [caseId]);

  if (missing) return <FeatureUnavailable title="Dosya finans özeti ucu yayında değil" detail="/api/v1/finance/cases/:id/summary" />;
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Spinner label="Finans özeti yükleniyor…" />;
  const p = data.primary;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Tahakkuk" value={p ? fmtAmount(p.accrued, p.currency) : "—"} tone="navy" />
        <StatCard label="Net tahsilat" value={p ? fmtAmount(p.netCollected, p.currency) : "—"} tone="gold" hint={p ? `iade ${fmtAmount(p.refunded, p.currency)}` : undefined} />
        <StatCard label="Kalan bakiye" value={p ? fmtAmount(p.outstanding, p.currency) : "—"} tone={p && Number(p.outstanding) > 0 ? "red" : "slate"} />
        <StatCard label="Zaman" value={`${data.time.totalHours} sa`} tone="slate" hint={`${data.time.entryCount} kayıt`} />
      </div>
      {data.currencies.length > 1 && (
        <p className="text-xs text-slate-500">Diğer para birimleri: {data.currencies.filter((c) => c.currency !== p?.currency).map((c) => `${c.currency} bakiye ${fmtAmount(c.outstanding, c.currency)}`).join(" · ")}</p>
      )}
      <Card title="Son Hareketler" action={<Link href={`/app/finans?caseId=${caseId}`} className="text-xs font-medium text-amber-600">Tüm hareketler →</Link>}>
        {data.entries.length === 0 ? (
          <EmptyState message="Bu dosyada finans hareketi yok." />
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {data.entries.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <Badge tone="gray">{e.type}</Badge> <span className="text-slate-700">{e.description ?? ""}</span>
                  <span className="block text-xs text-slate-500">{fmtDate(e.date)}{e.invoiceId ? " · faturalandı" : ""}{e.isBillable === false ? " · faturalanmaz" : ""}</span>
                </span>
                <span className="font-semibold tabular-nums">{e.amountFormatted}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ Kapanış */

export function ClosingTab({ caseId, onNotify, onOpenStatus }: { caseId: string; onNotify: Notify; onOpenStatus: () => void }) {
  const [data, setData] = useState<ClosingChecklistView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [archive, setArchive] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await fetchClosingChecklist(caseId);
      setData(d);
      setArchive(d.archiveBoxNo ?? "");
    } catch (err) {
      setError(errText(err, "Kapanış listesi alınamadı."));
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(key: string, done: boolean) {
    setBusy(true);
    try {
      let note: string | null | undefined;
      if (done && key === "ARSIV" && !archive.trim()) {
        const box = window.prompt("Arşiv kutusu numarası:", "");
        if (box === null) return;
        setArchive(box);
        setData(await saveClosingChecklist(caseId, { items: [{ key, done, note }], archiveBoxNo: box.trim() || null }));
        return;
      }
      setData(await saveClosingChecklist(caseId, { items: [{ key, done, note }] }));
    } catch (err) {
      onNotify(errText(err, "Kaydedilemedi."), "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveArchive() {
    setBusy(true);
    try {
      setData(await saveClosingChecklist(caseId, { items: [], archiveBoxNo: archive.trim() || null }));
      onNotify("Arşiv kutusu kaydedildi.", "success");
    } catch (err) {
      onNotify(errText(err, "Kaydedilemedi."), "error");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorBox message={error} />;
  if (!data) return <Spinner label="Kapanış listesi yükleniyor…" />;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Sistem Kontrolleri" action={<Badge tone={data.readyToClose ? "green" : "yellow"}>{data.readyToClose ? "Kapanışa hazır" : data.summary}</Badge>}>
        <ul className="divide-y divide-slate-100">
          {data.auto.map((a) => (
            <li key={a.key} className="flex items-start justify-between gap-3 py-2" data-testid="kapanis-sistem">
              <span>
                <span className={`text-sm ${a.ok ? "text-slate-700" : "font-medium text-red-700"}`}>{a.ok ? "✓ " : "✗ "}{a.label}</span>
                {!a.ok && <span className="block text-xs text-slate-500">{a.hint}</span>}
              </span>
              {a.count > 0 && <Badge tone={a.ok ? "gray" : "red"}>{a.count}</Badge>}
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button size="sm" variant={data.readyToClose ? "gold" : "secondary"} onClick={onOpenStatus}>
            Durum Değiştir → Kapandı
          </Button>
          <span className="text-[11px] text-slate-500">Açık süre/görev varsa kapatma engellenir; ONAY rolü gerekçeyle zorlayabilir.</span>
        </div>
      </Card>
      <Card title="Kapanış Kalemleri (manuel)">
        <ul className="space-y-2">
          {data.manual.map((m) => (
            <li key={m.key} className="flex items-start gap-2" data-testid="kapanis-kalem">
              <input type="checkbox" className="mt-1" checked={m.done} disabled={busy} onChange={(e) => void toggle(m.key, e.target.checked)} aria-label={m.label} />
              <span className="min-w-0">
                <span className={`text-sm ${m.done ? "text-slate-500 line-through" : "text-slate-800"}`}>{m.label}</span>
                {m.done && m.at && <span className="block text-[11px] text-slate-500">{fmtDateTime(m.at)}{m.note ? ` · ${m.note}` : ""}</span>}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex items-end gap-2">
          <Field label="Arşiv kutusu no">
            <Input value={archive} onChange={(e) => setArchive(e.target.value)} placeholder="ARS-2026-012" />
          </Field>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void saveArchive()}>
            Kaydet
          </Button>
        </div>
        {data.closedAt && <p className="mt-3 text-xs text-slate-500">Dosya {fmtDateTime(data.closedAt)} tarihinde kapatıldı.</p>}
      </Card>
    </div>
  );
}
