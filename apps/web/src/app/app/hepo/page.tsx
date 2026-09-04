"use client";

/**
 * HEPO (Modül 28) — Sağlık, Güvenlik ve Çevre uyum hukuku bölümü.
 *
 * Sekmeler: Genel Bakış, Yükümlülükler, Yasal Takvim, Yaptırım Matrisi,
 * Dava Rehberi, Kontrol Listeleri. İçerik statik bilgi katmanından
 * (hepo-content.ts) gelir; arama tüm sekmelerde çalışır.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, Input, Tabs, tabPanelProps } from "@/components/ui";
import { api } from "@/lib/api";
import {
  HEPO_CASE_GUIDES,
  HEPO_CHECKLISTS,
  HEPO_DEADLINES,
  HEPO_OBLIGATIONS,
  HEPO_PENALTIES,
  HEPO_STATUS_LABELS,
  HEPO_TOPIC_LABELS,
  type HepoTopic,
} from "@nomosos/shared";

const TABS = [
  { key: "genel", label: "Genel Bakış" },
  { key: "yukumluluk", label: "Yükümlülükler", count: HEPO_OBLIGATIONS.length },
  { key: "takvim", label: "Yasal Takvim", count: HEPO_DEADLINES.length },
  { key: "yaptirim", label: "Yaptırım Matrisi", count: HEPO_PENALTIES.length },
  { key: "dava", label: "Dava Rehberi", count: HEPO_CASE_GUIDES.length },
  { key: "kontrol", label: "Kontrol Listeleri", count: HEPO_CHECKLISTS.length },
  { key: "takip", label: "Müvekkil Takibi" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const TOPIC_TONES: Record<HepoTopic, "red" | "green" | "navy"> = {
  ISG: "red",
  CEVRE: "green",
  SAGLIK: "navy",
};

function matches(haystack: string, query: string): boolean {
  const q = query.trim().toLocaleLowerCase("tr");
  if (!q) return true;
  return q.split(/\s+/).every((t) => haystack.toLocaleLowerCase("tr").includes(t));
}

export default function HepoPage() {
  const [tab, setTab] = useState<TabKey>("genel");
  const [query, setQuery] = useState("");

  const obligations = useMemo(
    () =>
      HEPO_OBLIGATIONS.filter((o) =>
        matches(
          `${o.title} ${o.legalBasis} ${o.summary} ${HEPO_TOPIC_LABELS[o.topic]} ${o.penaltyNote} ${o.responsible} ${o.periodicity}`,
          query,
        ),
      ),
    [query],
  );
  const deadlines = useMemo(
    () => HEPO_DEADLINES.filter((d) => matches(`${d.title} ${d.basis} ${d.period}`, query)),
    [query],
  );
  const penalties = useMemo(
    () =>
      HEPO_PENALTIES.filter((p) =>
        matches(`${p.violation} ${p.law} ${p.fineBasis} ${p.aggravating.join(" ")}`, query),
      ),
    [query],
  );
  const guides = useMemo(
    () =>
      HEPO_CASE_GUIDES.filter((g) =>
        matches(`${g.caseType} ${g.burden} ${g.deadlines} ${g.strategy.join(" ")}`, query),
      ),
    [query],
  );
  const checklists = useMemo(
    () =>
      HEPO_CHECKLISTS.filter((c) => matches(`${c.sector} ${c.items.join(" ")}`, query)),
    [query],
  );

  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-slate-900">HEPO</h1>
          <Badge tone="red">Sağlık</Badge>
          <Badge tone="red">Güvenlik</Badge>
          <Badge tone="green">Çevre</Badge>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Müşteri şirketlerin İSG (6331), çevre ve sağlık mevzuatı uyum hukuku: yükümlülük kütüphanesi,
          yasal takvim, idari yaptırım matrisi, dava rehberi ve kontrol listeleri.
        </p>
      </div>

      <Card>
        <div className="flex items-center gap-3">
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 shrink-0 text-slate-500">
            <path
              fillRule="evenodd"
              d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z"
              clipRule="evenodd"
            />
          </svg>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="HEPO içinde ara: risk değerlendirmesi, atık, iş kazası, ceza…"
            aria-label="HEPO içinde ara"
          />
        </div>
      </Card>

      <Tabs tabs={TABS} active={tab} onChange={setTab} idPrefix="hepo" />

      <div {...tabPanelProps("hepo", "genel")} hidden={tab !== "genel"}>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="İş Sağlığı ve Güvenliği">
            <p className="text-sm leading-relaxed text-slate-600">
              6331 sayılı Kanun çerçevesinde işveren yükümlülükleri, İSG-Katip süreçleri, eğitim ve
              sağlık gözetimi takibi.{" "}
              <Link href="/app/yardim?konu=hepo" className="font-medium text-amber-700 hover:underline">
                Kılavuz →
              </Link>
            </p>
          </Card>
          <Card title="Çevre">
            <p className="text-sm leading-relaxed text-slate-600">
              ÇED, çevre izin/lisans (E-İZİN/E-İL), atık yönetimi ve emisyon/deşaraj ölçüm yükümlülükleri.
            </p>
          </Card>
          <Card title="Sağlık Hukuku">
            <p className="text-sm leading-relaxed text-slate-600">
              Hasta hakları, tıbbi müdahale onamı, sağlık verileri (KVKK özel rejim) ve meslek
              hastalığı bildirimleri.
            </p>
          </Card>
        </div>
        <div className="mt-4">
          <Card title="Avukat için kritik noktalar">
            <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-slate-600">
              <li>
                Kaza sonrası ilk 3 iş günü bildirim penceresi kaçırılırsa ceza ve tazminat riski büyür —
                <Link href="/app/ajanda" className="font-medium text-amber-700 hover:underline"> Ajandaya</Link>
                {" "}hatırlatma ekleyin.
              </li>
              <li>Yükümlülük kayıtları (eğitim, muayene, İSG-Katip) tazminat savunmasının ispat omurgasıdır.</li>
              <li>İdari cezada itiraz süresi 15 gündür; 30 günde yargı yolu (İYUK) kapanır.</li>
              <li>
                Kıdem/ihbar ve faiz hesapları için{" "}
                <Link href="/app/araclar/hesap-araclari" className="font-medium text-amber-700 hover:underline">
                  Hesap Araçları
                </Link>{" "}
                kullanılır.
              </li>
            </ul>
          </Card>
        </div>
      </div>

      <div {...tabPanelProps("hepo", "yukumluluk")} hidden={tab !== "yukumluluk"}>
        {obligations.length === 0 ? <EmptyFilter /> : (
          <div className="space-y-3">
            {obligations.map((o) => (
              <Card key={o.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-slate-900">{o.title}</p>
                    <p className="mt-0.5 font-mono text-xs text-slate-500">{o.legalBasis}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge tone={TOPIC_TONES[o.topic]}>{HEPO_TOPIC_LABELS[o.topic]}</Badge>
                    <Badge tone="gray">{o.periodicity}</Badge>
                  </div>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{o.summary}</p>
                <div className="mt-2 grid gap-1 text-xs text-slate-500 sm:grid-cols-2">
                  <p><span className="font-semibold text-slate-600">Sorumlu:</span> {o.responsible}</p>
                  <p><span className="font-semibold text-slate-600">Yaptırım:</span> {o.penaltyNote}</p>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div {...tabPanelProps("hepo", "takvim")} hidden={tab !== "takvim"}>
        {deadlines.length === 0 ? <EmptyFilter /> : (
          <Card title="Yasal süreler ve hatırlatma penceleri">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-3">Yükümlülük</th>
                    <th className="py-2 pr-3">Dayanak</th>
                    <th className="py-2 pr-3">Periyot / süre</th>
                    <th className="py-2">Hatırlatma</th>
                  </tr>
                </thead>
                <tbody>
                  {deadlines.map((d) => (
                    <tr key={d.id} className="border-b border-slate-100 align-top">
                      <td className="py-2.5 pr-3 font-medium text-slate-800">{d.title}</td>
                      <td className="py-2.5 pr-3 font-mono text-xs text-slate-500">{d.basis}</td>
                      <td className="py-2.5 pr-3 text-slate-600">{d.period}</td>
                      <td className="py-2.5 text-slate-600">
                        {d.remindBeforeDays === 0 ? "Derhal" : `${d.remindBeforeDays} gün önce`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      <div {...tabPanelProps("hepo", "yaptirim")} hidden={tab !== "yaptirim"}>
        {penalties.length === 0 ? <EmptyFilter /> : (
          <div className="space-y-3">
            {penalties.map((p) => (
              <Card key={p.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-medium text-slate-900">{p.violation}</p>
                  <Badge tone="gray">{p.law}</Badge>
                </div>
                <p className="mt-1.5 text-sm text-slate-600">{p.fineBasis}</p>
                {p.aggravating.length > 0 ? (
                  <div className="mt-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cezayı artıran nitelikler</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {p.aggravating.map((a) => (
                        <Badge key={a} tone="yellow">{a}</Badge>
                      ))}
                    </div>
                  </div>
                ) : null}
              </Card>
            ))}
          </div>
        )}
      </div>

      <div {...tabPanelProps("hepo", "dava")} hidden={tab !== "dava"}>
        {guides.length === 0 ? <EmptyFilter /> : (
          <div className="space-y-3">
            {guides.map((g) => (
              <Card key={g.id}>
                <p className="font-medium text-slate-900">{g.caseType}</p>
                <div className="mt-2 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
                  <p><span className="font-semibold text-slate-700">İspat yükü:</span> {g.burden}</p>
                  <p><span className="font-semibold text-slate-700">Süreler:</span> {g.deadlines}</p>
                </div>
                <div className="mt-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Strateji adımları</p>
                  <ul className="mt-1 list-decimal space-y-1 pl-5 text-sm text-slate-600">
                    {g.strategy.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div {...tabPanelProps("hepo", "kontrol")} hidden={tab !== "kontrol"}>
        {checklists.length === 0 ? <EmptyFilter /> : (
          <div className="grid gap-3 lg:grid-cols-2">
            {checklists.map((c) => (
              <Card key={c.id} title={c.sector}>
                <ul className="space-y-1.5 text-sm text-slate-600">
                  {c.items.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span aria-hidden="true" className="mt-0.5 text-amber-600">☐</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div {...tabPanelProps("hepo", "takip")} hidden={tab !== "takip"}>
        <ClientTrackingTab query={query} />
      </div>

      <p className="text-xs leading-relaxed text-slate-500">
        Bilgilendirme: bu bölümdeki içerik genel bilgi amaçlıdır; ceza tutarları ve sürelerin dava
        tarihinde yürürlükte olan metne göre doğrulanması avukatın sorumluluğundadır.
      </p>
    </div>
  );
}

function EmptyFilter() {
  return (
    <Card>
      <p className="text-sm text-slate-500">Arama kriterine uyan kayıt yok. Daha kısa bir terim deneyin.</p>
    </Card>
  );
}

// ---------- Müvekkil Takibi (Modül 28 Faz 2) ----------
//
// API'ye bağlı tek sekme: katalog statik (paylaşılan paket), atama ve durum
// takibi GET/POST/PATCH /hepo uçlarından gelir. Uç henüz yayında değilse
// sekmeler yalnız statik içerikle çalışmaya devam eder (hata bastırılmaz,
// kullanıcı bilgilendirilir).

interface ClientOption {
  id: string;
  name: string;
}

interface TrackedObligation {
  id: string;
  status: string;
  dueDate: string | null;
  lastDoneAt: string | null;
  note: string | null;
  overdue: boolean;
  obligation: { slug: string; topic: string; title: string; legalBasis: string; periodicity: string };
}

interface TrackSummary {
  total: number;
  counts: Record<string, number>;
  overdue: number;
}

function ClientTrackingTab({ query }: { query: string }) {
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientId, setClientId] = useState("");
  const [rows, setRows] = useState<TrackedObligation[]>([]);
  const [summary, setSummary] = useState<TrackSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignForm, setAssignForm] = useState({ obligationSlug: "", dueDate: "", note: "" });
  const [assignError, setAssignError] = useState<string | null>(null);

  // Müvekkil listesi — sekme ilk açıldığında bir kez.
  useEffect(() => {
    let alive = true;
    void api<{ items?: ClientOption[] }>("/clients", { query: { take: 100, active: true } })
      .then((d) => {
        if (alive) setClients(d.items ?? []);
      })
      .catch(() => {
        /* uç yoksa seçenek listesi boş kalır; hata satır seçiminde gösterilir */
      });
    return () => {
      alive = false;
    };
  }, []);

  const loadTracked = async (id: string) => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [ob, sum] = await Promise.all([
        api<TrackedObligation[]>(`/hepo/clients/${id}/obligations`),
        api<TrackSummary>(`/hepo/clients/${id}/summary`),
      ]);
      setRows(ob);
      setSummary(sum);
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? `Müvekkil yükümlülükleri yüklenemedi: ${err.message}`
          : "Müvekkil yükümlülükleri yüklenemedi.",
      );
      setRows([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (clientId) void loadTracked(clientId);
  }, [clientId]);

  const filtered = useMemo(
    () =>
      rows.filter((r) =>
        matches(`${r.obligation.title} ${r.obligation.legalBasis} ${r.status} ${r.note ?? ""}`, query),
      ),
    [rows, query],
  );

  async function setStatus(row: TrackedObligation, status: string, markDone = false) {
    setBusy(true);
    setNotice(null);
    try {
      await api(`/hepo/client-obligations/${row.id}`, {
        method: "PATCH",
        body: {
          status,
          ...(markDone ? { lastDoneAt: new Date().toISOString().slice(0, 10) } : {}),
        },
      });
      setNotice(`${row.obligation.title} → ${HEPO_STATUS_LABELS[status as keyof typeof HEPO_STATUS_LABELS] ?? status}.`);
      await loadTracked(clientId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Durum güncellenemedi.");
    } finally {
      setBusy(false);
    }
  }

  async function assign() {
    setBusy(true);
    setAssignError(null);
    try {
      const slug = assignForm.obligationSlug;
      // Statik katalog slug'ları API katalogunda kimliktir; API katalog kimliği
      // farklıysa (id yerine slug) atama ucu slug ile de aranır — burada
      // katalog kimliğini /hepo/obligations'tan çözüyoruz.
      const catalog = await api<Array<{ id: string; slug: string }>>("/hepo/obligations");
      const found = catalog.find((c) => c.slug === slug);
      if (!found) throw new Error("Yükümlülük katalogda bulunamadı.");
      await api(`/hepo/clients/${clientId}/obligations`, {
        method: "POST",
        body: {
          obligationId: found.id,
          ...(assignForm.dueDate ? { dueDate: assignForm.dueDate } : {}),
          ...(assignForm.note.trim() ? { note: assignForm.note.trim() } : {}),
        },
      });
      setAssignOpen(false);
      setAssignForm({ obligationSlug: "", dueDate: "", note: "" });
      setNotice("Yükümlülük atandı.");
      await loadTracked(clientId);
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : "Atama yapılamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Müvekkil</span>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"
              aria-label="Müvekkil seçin"
            >
              <option value="">Müvekkil seçin…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {clientId ? (
            <Button variant="secondary" onClick={() => setAssignOpen(true)} disabled={busy}>
              Yükümlülük Ata
            </Button>
          ) : null}
        </div>
        {summary && clientId ? (
          <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
            <Badge tone="gray">Toplam: {summary.total}</Badge>
            <Badge tone="green">Uygun: {summary.counts.UYGUN ?? 0}</Badge>
            <Badge tone="yellow">Açık: {summary.counts.ACIK ?? 0}</Badge>
            <Badge tone="red">Uygun değil: {summary.counts.UYGUN_DEGIL ?? 0}</Badge>
            <Badge tone="red">İhlal: {summary.counts.IHLAL ?? 0}</Badge>
            {summary.overdue > 0 ? <Badge tone="red">Vadesi geçmiş: {summary.overdue}</Badge> : null}
          </div>
        ) : null}
      </Card>

      {notice ? (
        <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {clientId && !loading && filtered.length === 0 && !error ? (
        <Card>
          <p className="text-sm text-slate-500">
            Bu müvekkile atanmış yükümlülük yok — "Yükümlülük Ata" ile başlayın.
          </p>
        </Card>
      ) : null}

      {filtered.length > 0 ? (
        <div className="space-y-3">
          {filtered.map((r) => (
            <Card key={r.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-slate-900">{r.obligation.title}</p>
                  <p className="mt-0.5 font-mono text-xs text-slate-500">{r.obligation.legalBasis}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Badge tone="gray">{HEPO_STATUS_LABELS[r.status as keyof typeof HEPO_STATUS_LABELS] ?? r.status}</Badge>
                    {r.obligation.periodicity !== "TEK SEFER" ? <Badge tone="gray">{r.obligation.periodicity}</Badge> : null}
                    {r.dueDate ? (
                      <Badge tone={r.overdue ? "red" : "gray"}>
                        Vade: {new Date(r.dueDate).toLocaleDateString("tr-TR")}
                        {r.overdue ? " (geçti)" : ""}
                      </Badge>
                    ) : null}
                    {r.lastDoneAt ? (
                      <Badge tone="green">
                        Son yerine getirme: {new Date(r.lastDoneAt).toLocaleDateString("tr-TR")}
                      </Badge>
                    ) : null}
                  </div>
                  {r.note ? <p className="mt-1.5 text-sm text-slate-500">{r.note}</p> : null}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => void setStatus(r, "UYGUN", true)}>
                    Yapıldı
                  </Button>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => void setStatus(r, "UYGUN_DEGIL")}>
                    Uygun değil
                  </Button>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => void setStatus(r, "IHLAL")}>
                    İhlal
                  </Button>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => void setStatus(r, "ACIK")}>
                    Açık
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {assignOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h3 className="mb-3 text-lg font-semibold text-slate-900">Yükümlülük Ata</h3>
            {assignError ? (
              <p className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{assignError}</p>
            ) : null}
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Yükümlülük</span>
                <select
                  value={assignForm.obligationSlug}
                  onChange={(e) => setAssignForm({ ...assignForm, obligationSlug: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"
                >
                  <option value="">Seçin…</option>
                  {HEPO_OBLIGATIONS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.title} ({o.legalBasis})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Vade (isteğe bağlı)</span>
                <input
                  type="date"
                  value={assignForm.dueDate}
                  onChange={(e) => setAssignForm({ ...assignForm, dueDate: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Not (isteğe bağlı)</span>
                <textarea
                  rows={2}
                  value={assignForm.note}
                  onChange={(e) => setAssignForm({ ...assignForm, note: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"
                />
              </label>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="secondary" onClick={() => setAssignOpen(false)}>
                  Vazgeç
                </Button>
                <Button onClick={() => void assign()} disabled={busy || !assignForm.obligationSlug}>
                  {busy ? "Atanıyor…" : "Ata"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
