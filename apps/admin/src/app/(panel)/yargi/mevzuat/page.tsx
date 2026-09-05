"use client";

/**
 * MEVZUAT ONAY MASASI (hukuki veri kaynağı besleme planı, Faz 1+3) —
 * platform mevzuat havuzunun OKUYARAK onay ekranı.
 *
 * Üreticiler → tek kuyruk → tek onay kapısı:
 *  - Çekirdek kanun tohumu (mevzuat.gov.tr; TCK, TMK, HMK, İİK, İş K., TBK…)
 *  - Resmî Gazete günlük izleyici (dünün sayfası; KANUN/YÖNETMELİK/TEBLİĞ…)
 *  - KVKK Kurul kararları ve Rekabet Kurulu kararları izleyicileri (Faz 3)
 *
 * Süreç kuralları (sunucuda zorlanır, panel yalnız iletir):
 *  - Hiçbir çekim havuza OTOMATİK yazılmaz; kayıt burada bekler.
 *  - Onay LegislationPoolService'ten (tek kapı) geçer: kanunlar madde sürümü
 *    olarak (StatuteArticleVersion), diğer belgeler Legislation platform kaydı
 *    (tenantId=null) olarak girer. RG kanun değişikliği onayında etkilenen
 *    kanunların konsolide metni yeniden çekilip sürüm farkı işlenir.
 *  - Red gerekçesi ZORUNLUDUR; denetim izine yazılır.
 *
 * Yerleşim: solda kuyruk (durum/kaynak süzgeçli), sağda sabit okuma bölmesi
 * (kuyruk metni ya da kaynaktan canlı önizleme; A−/A+ yazı boyutu).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { adminApi, errorMessage } from "@/lib/api";
import { EP } from "@/lib/endpoints";
import { PageGate } from "@/components/RoleGate";
import {
  Badge,
  Button,
  Card,
  Field,
  InfoBox,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";

type IngestStatus = "BEKLIYOR" | "ONAYLANDI" | "REDDEDILDI";

interface PoolStats {
  statutes: number;
  articles: number;
  articleVersions: number;
  platformLegislation: number;
}

interface ConnectorHealth {
  key: string;
  name: string;
  healthy: boolean;
  message: string;
  checkedAt: string;
}

interface IngestItem {
  id: string;
  sourceKey: string;
  externalKey: string;
  docType: string;
  title: string;
  number: string | null;
  abbrs: string | null;
  rgDate: string | null;
  rgNo: string | null;
  sourceUrl: string | null;
  status: IngestStatus;
  fetchedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectReason: string | null;
  poolRecordId: string | null;
}

interface ItemsResponse {
  items: IngestItem[];
  counts: Record<IngestStatus, number>;
}

interface PreviewResponse {
  item: { id: string; title: string; docType: string; sourceKey: string; sourceUrl: string | null };
  source: "KUYRUK" | "MEVZUAT_GOV" | "RG" | "KVKK";
  text: string;
}

interface RunSummary {
  source: string;
  ok: boolean;
  fetched: number;
  queued: number;
  note?: string;
}

interface StatuteResult {
  status: "EKLENDI" | "GUNCELLENDI" | "ATLANDI" | "REDDEDILDI";
  reason?: string;
  statuteId?: string;
  diff?: { added: number; changed: number; removed: number; unchanged: number };
}

interface ApproveResponse {
  item: { status: string };
  poolOutcome: string;
  statuteResults?: StatuteResult[];
  note?: string;
}

const SOURCE_LABELS: Record<string, string> = {
  MEVZUAT_TOHUM: "Çekirdek kanun tohumu",
  RG_GUNLUK: "Resmî Gazete",
  KVKK_KURUL: "KVKK Kurul kararı",
  REKABET_KURUL: "Rekabet Kurulu kararı",
};

const SOURCE_TONES: Record<string, "green" | "blue" | "yellow" | "steel"> = {
  MEVZUAT_TOHUM: "green",
  RG_GUNLUK: "blue",
  KVKK_KURUL: "yellow",
  REKABET_KURUL: "steel",
};

const DOC_TYPE_LABELS: Record<string, string> = {
  KANUN: "Kanun",
  KHK: "KHK / CB Kararnamesi",
  YONETMELIK: "Yönetmelik",
  TEBLIG: "Tebliğ",
  GENELGE: "Genelge",
  DIGER: "Diğer",
};

const RUNS: ReadonlyArray<{ key: "tohum" | "rg" | "kvkk" | "rekabet"; label: string; hint: string }> = [
  { key: "tohum", label: "Kanun tohumu", hint: "Çekirdek kanunları mevzuat.gov.tr'de bul, kuyruğa yaz" },
  { key: "rg", label: "RG tara", hint: "Son 3 günün Resmî Gazete sayfalarını tara" },
  { key: "kvkk", label: "KVKK tara", hint: "KVKK Kurul kararları listesinin ilk sayfaları" },
  { key: "rekabet", label: "Rekabet tara", hint: "Rekabet Kurulu kararları listesinin ilk sayfaları" },
];

const FONT_KEY = "nomosos.admin.reading.fontSize";

function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("tr-TR");
}

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString("tr-TR");
}

export default function MevzuatOnayPage() {
  return (
    <PageGate action="aiProvider.view">
      <MevzuatOnay />
    </PageGate>
  );
}

function MevzuatOnay() {
  // --- havuz + konektör durumu ---
  const [stats, setStats] = useState<PoolStats | null>(null);
  const [health, setHealth] = useState<ConnectorHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  // --- kuyruk ---
  const [items, setItems] = useState<IngestItem[]>([]);
  const [counts, setCounts] = useState<Record<IngestStatus, number> | null>(null);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<IngestStatus | "">("BEKLIYOR");
  const [sourceFilter, setSourceFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // --- okuma bölmesi ---
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(15);

  // --- işlemler ---
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [lastApprove, setLastApprove] = useState<ApproveResponse | null>(null);

  useEffect(() => {
    try {
      const saved = Number.parseInt(window.localStorage.getItem(FONT_KEY) ?? "", 10);
      if (saved >= 12 && saved <= 26) setFontSize(saved);
    } catch {
      /* localStorage kapalı olabilir */
    }
  }, []);

  function changeFont(next: number) {
    const v = Math.max(12, Math.min(26, next));
    setFontSize(v);
    try {
      window.localStorage.setItem(FONT_KEY, String(v));
    } catch {
      /* yoksay */
    }
  }

  const loadStats = useCallback(async () => {
    try {
      setStats(await adminApi<PoolStats>(EP.legislationIngest.stats));
    } catch {
      setStats(null);
    }
  }, []);

  const loadQueue = useCallback(async () => {
    setQueueLoading(true);
    setQueueError(null);
    try {
      const res = await adminApi<ItemsResponse>(EP.legislationIngest.items, {
        query: {
          status: statusFilter || undefined,
          sourceKey: sourceFilter || undefined,
          limit: 200,
        },
      });
      setItems(res.items ?? []);
      setCounts(res.counts);
    } catch (err) {
      setQueueError(errorMessage(err, "Kuyruk yüklenemedi."));
    } finally {
      setQueueLoading(false);
    }
  }, [statusFilter, sourceFilter]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  async function checkHealth() {
    setHealthLoading(true);
    try {
      setHealth(await adminApi<ConnectorHealth>(EP.legislationIngest.health));
    } catch (err) {
      setHealth({
        key: "MEVZUAT_GOV",
        name: "Mevzuat Bilgi Sistemi",
        healthy: false,
        message: errorMessage(err, "Sağlık kontrolü çalıştırılamadı."),
        checkedAt: new Date().toISOString(),
      });
    } finally {
      setHealthLoading(false);
    }
  }

  const selected = useMemo(() => items.find((i) => i.id === selectedId) ?? null, [items, selectedId]);

  // Seçim değişince metin bölmesi kaynaktan/kuyruktan yüklenir.
  useEffect(() => {
    if (!selectedId) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreview(null);
    adminApi<PreviewResponse>(EP.legislationIngest.preview(selectedId))
      .then((res) => {
        if (!cancelled) setPreview(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setPreviewError(errorMessage(err, "Metin önizlemesi alınamadı."));
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  async function runSource(key: "tohum" | "rg" | "kvkk" | "rekabet", label: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const s = await adminApi<RunSummary>(EP.legislationIngest.run(key), { method: "POST", body: {} });
      setNotice(
        `${label}: ${s.fetched} kalem tarandı, ${s.queued} yeni kayıt kuyrukta` +
          (s.note ? ` · not: ${s.note}` : ""),
      );
      if (!s.ok) setError(`${label} kısmen başarısız: ${s.note ?? "kaynak hatası"}`);
      await Promise.all([loadQueue(), loadStats()]);
    } catch (err) {
      setError(errorMessage(err, `${label} çalıştırılamadı.`));
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!selected || selected.status !== "BEKLIYOR") return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await adminApi<ApproveResponse>(EP.legislationIngest.approve(selected.id), {
        method: "POST",
        body: {},
      });
      setLastApprove(res);
      const statuteLine = (res.statuteResults ?? [])
        .map((r) =>
          r.diff
            ? `${r.status} (+${r.diff.added} / ~${r.diff.changed} / −${r.diff.removed})`
            : `${r.status}${r.reason ? `: ${r.reason}` : ""}`,
        )
        .join(" · ");
      setNotice(
        `Onaylandı — havuz sonucu: ${res.poolOutcome}` +
          (statuteLine ? ` · kanun: ${statuteLine}` : "") +
          (res.note ? ` · ${res.note}` : ""),
      );
      await Promise.all([loadQueue(), loadStats()]);
    } catch (err) {
      setError(errorMessage(err, "Onaylanamadı."));
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!selected || selected.status !== "BEKLIYOR") return;
    const reason = rejectReason.trim();
    if (reason.length < 3) {
      setError("Red gerekçesi en az 3 karakter olmalıdır (denetim izine yazılır).");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await adminApi(EP.legislationIngest.reject(selected.id), { method: "POST", body: { reason } });
      setRejectOpen(false);
      setRejectReason("");
      setNotice("Kayıt reddedildi; aynı belge bir daha kuyruğa girmez.");
      await loadQueue();
    } catch (err) {
      setError(errorMessage(err, "Reddedilemedi."));
    } finally {
      setBusy(false);
    }
  }

  // Klavye: O = onayla, R = reddet (BEKLIYOR kayıt seçiliyken; form alanı odaklı değilken).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (!selected || selected.status !== "BEKLIYOR" || busy || rejectOpen) return;
      if (e.key === "o" || e.key === "O") void approve();
      if (e.key === "r" || e.key === "R") setRejectOpen(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // approve kapanışı selected/busy'ye bağlıdır; her değişimde yeniden bağlanır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, busy, rejectOpen]);

  const sourceOptions = useMemo(() => Object.keys(SOURCE_LABELS), []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mevzuat Onay Masası"
        description="Platform mevzuat havuzu: mevzuat.gov.tr kanun tohumu, Resmî Gazete izleyici ve regülatör (KVKK/Rekabet) kararları. Hiçbir belge otomatik yayınlanmaz — metni okuyup onayladığınızda havuza girer."
        action={
          <div className="flex flex-wrap gap-2">
            {RUNS.map((r) => (
              <Button
                key={r.key}
                size="sm"
                variant="secondary"
                disabled={busy}
                title={r.hint}
                onClick={() => void runSource(r.key, r.label)}
              >
                {r.label}
              </Button>
            ))}
          </div>
        }
      />

      <InfoBox title="Onay ne yapar?">
        <span className="font-medium">Kanun tohumu</span> kaydı: konsolide metin mevzuat.gov.tr'den çekilir,
        maddelere ayrıştırılır, kanun havuzuna sürüm 1 olarak girer (atıf teyidi &quot;TCK 86&quot; bu havuzdan
        DOGRULANDI üretir). <span className="font-medium">RG kanun</span> kaydı: değişikliğin etkilediği
        kanunların konsolide metni yeniden çekilir, değişen maddeler yeni sürüm alır — eski metin ezilmez.{" "}
        <span className="font-medium">Diğer belgeler</span> (yönetmelik/tebliğ/kurul kararı): platform
        mevzuat kaydı olarak tüm bürolara okunur. Red gerekçesi zorunludur.
      </InfoBox>

      {notice ? (
        <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-4">
        <Card title="Kanun">
          <p className="text-3xl font-semibold text-steel-50">{stats?.statutes.toLocaleString("tr-TR") ?? "—"}</p>
          <p className="text-xs text-steel-500">platform kanun havuzu (Statute)</p>
        </Card>
        <Card title="Yürürlükteki madde">
          <p className="text-3xl font-semibold text-steel-50">{stats?.articles.toLocaleString("tr-TR") ?? "—"}</p>
          <p className="text-xs text-steel-500">
            toplam {stats?.articleVersions.toLocaleString("tr-TR") ?? "—"} madde sürümü
          </p>
        </Card>
        <Card title="Platform belgesi">
          <p className="text-3xl font-semibold text-steel-50">
            {stats?.platformLegislation.toLocaleString("tr-TR") ?? "—"}
          </p>
          <p className="text-xs text-steel-500">yönetmelik/tebliğ/kurul kararı (tenantId=null)</p>
        </Card>
        <Card
          title="mevzuat.gov.tr"
          action={
            <Button size="sm" variant="secondary" disabled={healthLoading} onClick={() => void checkHealth()}>
              {healthLoading ? "Yoklanıyor…" : "Sağlık kontrolü"}
            </Button>
          }
        >
          {health ? (
            <div className="space-y-1">
              <Badge tone={health.healthy ? "green" : "red"}>{health.healthy ? "Sağlıklı" : "Sorun"}</Badge>
              <p className="text-xs text-steel-400">{health.message}</p>
              <p className="text-[11px] text-steel-600">{fmtDateTime(health.checkedAt)}</p>
            </div>
          ) : (
            <p className="text-xs text-steel-500">Örnek aramayla (TCK 5237) konektörü yoklar; sertifika süresi uyarısını da gösterir.</p>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* ---------------- SOL: KUYRUK ---------------- */}
        <Card
          title="Onay kuyruğu"
          subtitle={
            counts
              ? `${counts.BEKLIYOR} bekleyen · ${counts.ONAYLANDI} onaylanmış · ${counts.REDDEDILDI} reddedilmiş`
              : undefined
          }
          bodyClassName="p-0"
        >
          <div className="flex flex-wrap gap-2 border-b border-steel-800 px-4 py-3">
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as IngestStatus | "")}
              aria-label="Durum süzgeci"
              className="w-40"
            >
              <option value="BEKLIYOR">Bekleyenler</option>
              <option value="ONAYLANDI">Onaylananlar</option>
              <option value="REDDEDILDI">Reddedilenler</option>
              <option value="">Tümü</option>
            </Select>
            <Select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              aria-label="Kaynak süzgeci"
              className="w-52"
            >
              <option value="">Tüm kaynaklar</option>
              {sourceOptions.map((k) => (
                <option key={k} value={k}>
                  {SOURCE_LABELS[k]}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="secondary" disabled={queueLoading} onClick={() => void loadQueue()}>
              Yenile
            </Button>
          </div>

          {queueLoading ? (
            <div className="p-4">
              <Spinner label="Kuyruk yükleniyor…" />
            </div>
          ) : queueError ? (
            <p className="p-4 text-sm text-red-300">{queueError}</p>
          ) : items.length === 0 ? (
            <p className="p-4 text-sm text-steel-500">
              Bu süzgeçte kayıt yok. Üstteki tarama düğmeleriyle kuyruğu doldurun; zamanlanmış işler de
              (RG her sabah 07:30, tohum/KVKK/Rekabet pazartesi) kuyruğa yazar.
            </p>
          ) : (
            <ul className="max-h-[70vh] divide-y divide-steel-800 overflow-y-auto">
              {items.map((it) => {
                const active = it.id === selectedId;
                return (
                  <li key={it.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(it.id)}
                      className={`w-full px-4 py-3 text-left transition ${
                        active ? "bg-sky-500/10" : "hover:bg-steel-900/60"
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={SOURCE_TONES[it.sourceKey] ?? "steel"}>
                          {SOURCE_LABELS[it.sourceKey] ?? it.sourceKey}
                        </Badge>
                        <Badge tone="gray">{DOC_TYPE_LABELS[it.docType] ?? it.docType}</Badge>
                        {it.status !== "BEKLIYOR" && (
                          <Badge tone={it.status === "ONAYLANDI" ? "green" : "red"}>
                            {it.status === "ONAYLANDI" ? "Onaylandı" : "Reddedildi"}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-sm font-medium text-steel-50">{it.title}</p>
                      <p className="text-xs text-steel-500">
                        {it.number ? `No ${it.number} · ` : ""}
                        {it.rgDate ? `RG ${fmtDate(it.rgDate)}${it.rgNo ? ` / ${it.rgNo}` : ""} · ` : ""}
                        çekim {fmtDate(it.fetchedAt)}
                      </p>
                      {it.rejectReason && <p className="mt-0.5 text-[11px] text-red-300">{it.rejectReason}</p>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* ---------------- SAĞ: OKUMA BÖLMESİ ---------------- */}
        <Card
          title={selected ? selected.title : "Okuma bölmesi"}
          subtitle={
            selected
              ? `${SOURCE_LABELS[selected.sourceKey] ?? selected.sourceKey} · ${
                  DOC_TYPE_LABELS[selected.docType] ?? selected.docType
                }${selected.abbrs ? ` · kısaltma: ${selected.abbrs}` : ""}`
              : "Soldan bir kayıt seçin; metin kuyruktan ya da kaynaktan canlı okunur."
          }
          action={
            selected ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <Button size="sm" variant="secondary" onClick={() => changeFont(fontSize - 2)} title="Yazıyı küçült">
                  A−
                </Button>
                <span className="px-1 text-[11px] tabular-nums text-steel-500">{fontSize}px</span>
                <Button size="sm" variant="secondary" onClick={() => changeFont(fontSize + 2)} title="Yazıyı büyüt">
                  A+
                </Button>
                {selected.sourceUrl ? (
                  <a
                    href={selected.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-2 text-xs text-sky-300 hover:underline"
                  >
                    Kaynağı aç ↗
                  </a>
                ) : null}
              </div>
            ) : undefined
          }
        >
          {!selected ? (
            <p className="text-sm text-steel-500">Seçili kayıt yok.</p>
          ) : (
            <div className="space-y-3">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-steel-400 sm:grid-cols-3">
                <div>
                  <dt className="text-steel-600">Dış kimlik</dt>
                  <dd className="font-mono text-steel-300">{selected.externalKey}</dd>
                </div>
                <div>
                  <dt className="text-steel-600">RG künyesi</dt>
                  <dd>
                    {selected.rgDate ? `${fmtDate(selected.rgDate)} / ${selected.rgNo ?? "?"}` : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-steel-600">Durum</dt>
                  <dd>
                    {selected.status}
                    {selected.reviewedAt ? ` · ${fmtDateTime(selected.reviewedAt)}` : ""}
                  </dd>
                </div>
              </dl>

              {selected.status === "BEKLIYOR" ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button disabled={busy} onClick={() => void approve()}>
                    {busy ? "İşleniyor…" : "Onayla (O)"}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      setRejectOpen(true);
                      setError(null);
                    }}
                  >
                    Reddet (R)
                  </Button>
                  {selected.docType === "KANUN" && selected.sourceKey === "RG_GUNLUK" ? (
                    <span className="text-[11px] text-steel-500">
                      Onayda etkilenen kanunların konsolide metni mevzuat.gov.tr'den yeniden çekilir.
                    </span>
                  ) : null}
                </div>
              ) : selected.poolRecordId ? (
                <p className="text-xs text-steel-500">
                  Havuz kaydı: <span className="font-mono">{selected.poolRecordId}</span>
                </p>
              ) : null}

              {lastApprove && lastApprove.statuteResults && selected.status !== "BEKLIYOR" ? (
                <div className="rounded-lg border border-steel-800 bg-steel-950/60 p-3 text-xs text-steel-300">
                  <p className="mb-1 font-medium text-steel-100">Son onay — kanun sürüm sonucu</p>
                  <ul className="space-y-0.5">
                    {lastApprove.statuteResults.map((r, i) => (
                      <li key={i}>
                        <Badge
                          tone={
                            r.status === "EKLENDI"
                              ? "green"
                              : r.status === "GUNCELLENDI"
                                ? "blue"
                                : r.status === "ATLANDI"
                                  ? "gray"
                                  : "red"
                          }
                        >
                          {r.status}
                        </Badge>{" "}
                        {r.diff
                          ? `+${r.diff.added} yeni · ~${r.diff.changed} değişen · −${r.diff.removed} kapanan · ${r.diff.unchanged} aynı`
                          : (r.reason ?? "")}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="rounded-lg border border-steel-800 bg-steel-950/60 p-4">
                {previewLoading ? (
                  <Spinner label="Metin kaynaktan okunuyor…" />
                ) : previewError ? (
                  <div className="space-y-1">
                    <p className="text-sm text-amber-300">{previewError}</p>
                    <p className="text-xs text-steel-500">
                      Metin önizlemesi yoksa (PDF belge) karar künye ve kaynak sayfası üzerinden verilir.
                    </p>
                  </div>
                ) : preview ? (
                  <>
                    <p className="mb-2 text-[11px] uppercase tracking-wide text-steel-600">
                      kaynak: {preview.source} · {preview.text.length.toLocaleString("tr-TR")} karakter
                    </p>
                    <pre
                      className="max-h-[62vh] overflow-y-auto whitespace-pre-wrap break-words font-sans leading-relaxed text-steel-100"
                      style={{ fontSize: `${fontSize}px` }}
                    >
                      {preview.text}
                    </pre>
                  </>
                ) : null}
              </div>
            </div>
          )}
        </Card>
      </div>

      <Modal open={rejectOpen} onClose={() => setRejectOpen(false)} title="Kaydı reddet">
        <div className="space-y-3">
          <p className="text-sm text-steel-300">{selected?.title}</p>
          <Field label="Red gerekçesi (zorunlu — denetim izine yazılır)">
            <Textarea
              rows={4}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="örn. Mükerrer kayıt / kapsam dışı ilan / metin bozuk çekildi"
            />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setRejectOpen(false)}>
              Vazgeç
            </Button>
            <Button onClick={() => void reject()} disabled={busy || rejectReason.trim().length < 3}>
              {busy ? "Reddediliyor…" : "Reddet"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
