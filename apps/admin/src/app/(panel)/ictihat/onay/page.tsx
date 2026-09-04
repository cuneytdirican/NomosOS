"use client";

/**
 * İÇTİHAT ONAY MASASI (plans/ictihat-havuzu-yol-haritasi.md madde 4) —
 * OKUYARAK onay ekranı.
 *
 * Yerleşim: solda onay kuyruğu (durum/kaynak süzgeçli, satır seçimli), sağda
 * SABİT okuma bölmesi. Onay körlemeye çevrilmez: seçilen kaydın karar metni
 * kuyruktaki fullText'ten ya da (externalRef varsa) resmî kaynaktan TEMİZ METİN
 * olarak okunur — bkz. GET /caselaw-ingest/items/:id/preview.
 *
 * Süreç kuralları (sunucuda zorlanır, panel yalnız iletir):
 *  - Onay havuza CaselawPoolService'ten girer (tek kapı değişmez).
 *  - Red gerekçesi ZORUNLUDUR; denetim izine yazılır.
 *  - Onay/red yalnız BEKLIYOR kayıtlarda geçerlidir.
 *
 * Klavye kısayolları: O = onayla, R = reddet (BEKLIYOR kayıt seçiliyken).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { adminApi, errorMessage } from "@/lib/api";
import { EP } from "@/lib/endpoints";
import { PageGate } from "@/components/RoleGate";
import { fmtDateTime } from "@/lib/labels";
import {
  Badge,
  Button,
  Card,
  Field,
  InfoBox,
  Modal,
  PageHeader,
  ResourceView,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";

type IngestStatus = "BEKLIYOR" | "ONAYLANDI" | "REDDEDILDI";

interface IngestItem {
  id: string;
  sourceKey: string;
  court: string;
  chamber: string | null;
  caseNumber: string;
  decisionNumber: string;
  decisionDate: string | null;
  summary: string | null;
  fullText: string | null;
  sourceUrl: string | null;
  externalRef: string | null;
  status: IngestStatus;
  fetchedAt: string;
  rejectReason: string | null;
  poolRecordId: string | null;
}

interface QueueResponse {
  items: IngestItem[];
  counts: Record<IngestStatus, number>;
}

interface PreviewResponse {
  item: IngestItem;
  source: "KUYRUK" | "CANLI";
  text: string;
  sourceUrl: string | null;
}

const STATUS_TABS: ReadonlyArray<{ key: IngestStatus; label: string }> = [
  { key: "BEKLIYOR", label: "Onay Bekleyen" },
  { key: "ONAYLANDI", label: "Onaylanmış" },
  { key: "REDDEDILDI", label: "Reddedilmiş" },
];

export default function OnayMasasiPage() {
  return (
    <PageGate action="aiProvider.view">
      <OnayMasasi />
    </PageGate>
  );
}

function OnayMasasi() {
  const [status, setStatus] = useState<IngestStatus>("BEKLIYOR");
  const [sourceFilter, setSourceFilter] = useState("");
  const [queue, setQueue] = useState<IngestItem[]>([]);
  const [counts, setCounts] = useState<Record<IngestStatus, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<IngestItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminApi<QueueResponse>(EP.caseLawIngest.items, {
        query: { limit: 200, ...(status ? { status } : {}), ...(sourceFilter ? { sourceKey: sourceFilter } : {}) },
      });
      setQueue(data.items ?? []);
      setCounts(data.counts ?? null);
    } catch (err) {
      setError(errorMessage(err, "Kuyruk yüklenemedi."));
    } finally {
      setLoading(false);
    }
  }, [status, sourceFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const sourceKeys = useMemo(() => Array.from(new Set(queue.map((i) => i.sourceKey))).sort(), [queue]);
  const selected = useMemo(
    () => queue.find((i) => i.id === selectedId) ?? null,
    [queue, selectedId],
  );

  const approve = useCallback(
    async (item: IngestItem) => {
      if (item.status !== "BEKLIYOR") return;
      setActionBusy(true);
      setActionError(null);
      setNotice(null);
      try {
        const res = await adminApi<{ poolOutcome: string }>(EP.caseLawIngest.approve(item.id), {
          method: "POST",
          body: {},
        });
        setNotice(`Onaylandı — havuz sonucu: ${res.poolOutcome}`);
        await load();
        // Sonraki BEKLIYOR kayda otomatik geç (okuma akışı kopmaz).
        setSelectedId(nextPendingId(queue, item.id));
      } catch (err) {
        setActionError(errorMessage(err, "Onaylanamadı."));
      } finally {
        setActionBusy(false);
      }
    },
    [load, queue],
  );

  const reject = useCallback(
    async (item: IngestItem, reason: string) => {
      setActionBusy(true);
      setActionError(null);
      try {
        await adminApi(EP.caseLawIngest.reject(item.id), { method: "POST", body: { reason } });
        setNotice("Kayıt reddedildi.");
        setRejectTarget(null);
        await load();
        setSelectedId(nextPendingId(queue, item.id));
      } catch (err) {
        setActionError(errorMessage(err, "Reddedilemedi."));
      } finally {
        setActionBusy(false);
      }
    },
    [load, queue],
  );

  // Klavye kısayolları: O = onayla, R = reddet (yalnız BEKLIYOR + işlem boşta).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (actionBusy || !selected || selected.status !== "BEKLIYOR") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
      if (e.key === "o" || e.key === "O") {
        e.preventDefault();
        void approve(selected);
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        setRejectTarget(selected);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actionBusy, selected, approve]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="İçtihat Onay Masası"
        description="Çekilen/önerilen kararlar burada bekler; onaylanmadan havuza girmez. Soldan kaydı seçin, karar metnini okuyun, ardından onaylayın ya da gerekçeli reddedin."
        action={
          <Button variant="secondary" onClick={() => void load()} disabled={loading}>
            {loading ? "Yenileniyor…" : "Yenile"}
          </Button>
        }
      />

      <InfoBox title="Klavye kısayolları">
        Seçili BEKLIYOR kayıt için <strong>O</strong> = onayla, <strong>R</strong> = reddet. Onay havuza
        CaselawPoolService'in künye doğrulamasından geçerek girer; red gerekçesi zorunludur ve denetim
        izine yazılır.
      </InfoBox>

      {notice ? (
        <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{notice}</p>
      ) : null}
      {actionError ? (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{actionError}</p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* SOL: kuyruk listesi */}
        <Card
          title="Onay kuyruğu"
          subtitle="Satıra tıklayın — karar metni sağda açılır."
          bodyClassName="p-4"
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1.5">
              {STATUS_TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    setStatus(t.key);
                    setSelectedId(null);
                  }}
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                    status === t.key
                      ? "border-accent-500 bg-accent-950/60 text-accent-200"
                      : "border-steel-700 bg-steel-900 text-steel-300 hover:border-steel-500"
                  }`}
                >
                  {t.label}
                  {counts?.[t.key] ? (
                    <span className="ml-1.5 rounded-full bg-steel-800 px-1.5 py-0.5 text-[11px] font-semibold text-steel-200">
                      {counts[t.key]}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
            <Select
              value={sourceFilter}
              onChange={(e) => {
                setSourceFilter(e.target.value);
                setSelectedId(null);
              }}
              aria-label="Kaynak süzgeci"
              className="ml-auto w-48"
            >
              <option value="">Tüm kaynaklar</option>
              {sourceKeys.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </Select>
          </div>

          <ResourceView
            loading={loading}
            missing={false}
            forbidden={false}
            error={error}
            empty={queue.length === 0}
            endpoint={EP.caseLawIngest.items}
            what="Onay kuyruğu"
            emptyMessage="Bu süzgeçte kuyruk kaydı yok."
          >
            <ul className="max-h-[70vh] space-y-1.5 overflow-y-auto pr-1">
              {queue.map((item) => (
                <QueueRow
                  key={item.id}
                  item={item}
                  active={item.id === selectedId}
                  onSelect={() => setSelectedId(item.id)}
                />
              ))}
            </ul>
          </ResourceView>
        </Card>

        {/* SAĞ: sticky okuma bölmesi */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          {selected ? (
            <ReadingPane
              item={selected}
              busy={actionBusy}
              onApprove={() => void approve(selected)}
              onReject={() => setRejectTarget(selected)}
            />
          ) : (
            <Card title="Okuma bölmesi">
              <p className="py-8 text-center text-sm text-steel-500">
                Soldan bir kuyruk kaydı seçin — künye kartı ve karar metni burada açılır.
              </p>
            </Card>
          )}
        </div>
      </div>

      {rejectTarget ? (
        <RejectModal
          item={rejectTarget}
          busy={actionBusy}
          onClose={() => setRejectTarget(null)}
          onSubmit={(reason) => void reject(rejectTarget, reason)}
        />
      ) : null}
    </div>
  );
}

/** Listedeki bir sonraki BEKLIYOR kayda geçiş (onay/red sonrası otomatik seçim). */
function nextPendingId(queue: IngestItem[], doneId: string): string | null {
  const pending = queue.filter((i) => i.status === "BEKLIYOR" && i.id !== doneId);
  return pending[0]?.id ?? null;
}

function QueueRow({
  item,
  active,
  onSelect,
}: {
  item: IngestItem;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? "true" : undefined}
        className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
          active
            ? "border-accent-500 bg-accent-950/40"
            : "border-steel-800 bg-steel-950/60 hover:border-steel-600"
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-steel-50">{item.court}</p>
            <p className="mt-0.5 text-xs text-steel-400">
              E. {item.caseNumber} · K. {item.decisionNumber}
              {item.decisionDate ? ` · ${new Date(item.decisionDate).toLocaleDateString("tr-TR")}` : ""}
            </p>
            {item.summary ? (
              <p className="mt-1 line-clamp-2 text-[11px] text-steel-500">{item.summary}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Badge tone="steel">{item.sourceKey}</Badge>
            <Badge
              tone={
                item.status === "BEKLIYOR" ? "yellow" : item.status === "ONAYLANDI" ? "green" : "red"
              }
            >
              {item.status === "BEKLIYOR" ? "Onay bekliyor" : item.status === "ONAYLANDI" ? "Onaylandı" : "Reddedildi"}
            </Badge>
            <span className="text-[10px] text-steel-600">{new Date(item.fetchedAt).toLocaleDateString("tr-TR")}</span>
          </div>
        </div>
        {item.status === "BEKLIYOR" && !item.fullText && item.externalRef ? (
          <p className="mt-1.5 text-[10px] text-sky-300">metin kaynaktan çekilir (canlı önizleme)</p>
        ) : null}
      </button>
    </li>
  );
}

function ReadingPane({
  item,
  busy,
  onApprove,
  onReject,
}: {
  item: IngestItem;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const actionable = item.status === "BEKLIYOR";

  return (
    <div className="space-y-4">
      <Card
        title="Künye"
        action={
          <div className="flex flex-wrap justify-end gap-1.5">
            <Badge tone="steel">{item.sourceKey}</Badge>
            <Badge tone={actionable ? "yellow" : item.status === "ONAYLANDI" ? "green" : "red"}>
              {item.status === "BEKLIYOR" ? "Onay bekliyor" : item.status === "ONAYLANDI" ? "Onaylandı" : "Reddedildi"}
            </Badge>
          </div>
        }
      >
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-steel-500">Mahkeme</dt>
            <dd className="text-right font-medium text-steel-50">{item.court}</dd>
          </div>
          {item.chamber ? (
            <div className="flex justify-between gap-3">
              <dt className="text-steel-500">Daire</dt>
              <dd className="text-right text-steel-100">{item.chamber}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-3">
            <dt className="text-steel-500">Esas / Karar</dt>
            <dd className="text-right font-mono text-steel-100">
              {item.caseNumber} E. / {item.decisionNumber} K.
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-steel-500">Karar tarihi</dt>
            <dd className="text-right text-steel-100">
              {item.decisionDate ? new Date(item.decisionDate).toLocaleDateString("tr-TR") : "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-steel-500">Çekim</dt>
            <dd className="text-right text-steel-300">{fmtDateTime(item.fetchedAt)}</dd>
          </div>
          {item.externalRef ? (
            <div className="flex justify-between gap-3">
              <dt className="text-steel-500">Dış kaynak kimliği</dt>
              <dd className="text-right font-mono text-steel-300">{item.externalRef}</dd>
            </div>
          ) : null}
          {item.rejectReason ? (
            <div className="flex justify-between gap-3">
              <dt className="text-red-400">Red gerekçesi</dt>
              <dd className="text-right text-red-300">{item.rejectReason}</dd>
            </div>
          ) : null}
        </dl>
        {item.summary ? (
          <p className="mt-3 rounded-lg border border-steel-800 bg-steel-950/60 p-3 text-xs text-steel-300">
            {item.summary}
          </p>
        ) : null}
      </Card>

      <DecisionText item={item} />

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onApprove} disabled={!actionable || busy}>
          {busy ? "İşleniyor…" : "Onayla"} <span className="text-[10px] opacity-70">(O)</span>
        </Button>
        <Button variant="danger" onClick={onReject} disabled={!actionable || busy}>
          Reddet <span className="text-[10px] opacity-70">(R)</span>
        </Button>
        {!actionable ? (
          <span className="text-xs text-steel-500">
            Bu kayıt zaten {item.status === "ONAYLANDI" ? "onaylanmış" : "reddedilmiş"}; yalnız BEKLIYOR kayıtlar işlenebilir.
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Karar metni: kuyruk fullText ya da (externalRef varsa) canlı önizleme. */
function DecisionText({ item }: { item: IngestItem }) {
  const [state, setState] = useState<{ loading: boolean; error: string | null; preview: PreviewResponse | null }>({
    loading: false,
    error: null,
    preview: null,
  });
  const itemRef = useRef(item.id);
  const liveNeeded = !item.fullText && Boolean(item.externalRef);

  useEffect(() => {
    itemRef.current = item.id;
    if (item.fullText) {
      setState({ loading: false, error: null, preview: null });
      return;
    }
    if (!liveNeeded) {
      setState({
        loading: false,
        error:
          "Bu kayıtta karar metni yok ve dış kaynak kimliği de taşınmıyor; karar yalnız künye/özet üzerinden değerlendirilebilir.",
        preview: null,
      });
      return;
    }
    setState({ loading: true, error: null, preview: null });
    adminApi<PreviewResponse>(EP.caseLawIngest.preview(item.id))
      .then((preview) => {
        if (itemRef.current !== item.id) return;
        setState({ loading: false, error: null, preview });
      })
      .catch((err: unknown) => {
        if (itemRef.current !== item.id) return;
        setState({ loading: false, error: errorMessage(err, "Karar metni alınamadı."), preview: null });
      });
  }, [item.id, item.fullText, liveNeeded]);

  const text = item.fullText ?? state.preview?.text ?? null;
  const sourceUrl = item.fullText ? item.sourceUrl : state.preview?.sourceUrl ?? null;

  // OKUMA KONFORU: yazı boyutu A−/A+ (kalıcı) + TAM EKRAN geçişi. Bölme
  // dar kalır; "Tam ekran" metni ekranın tamamına yayar (mobilde de tam kaplar).
  const [fontSize, setFontSize] = useState(() => {
    if (typeof window === "undefined") return 15;
    const saved = Number.parseInt(window.localStorage.getItem("nomosos.admin.reading.fontSize") ?? "", 10);
    return Number.isFinite(saved) && saved >= 12 && saved <= 24 ? saved : 15;
  });
  const [expanded, setExpanded] = useState(false);
  const changeFont = (next: number) => {
    const v = Math.max(12, Math.min(24, next));
    setFontSize(v);
    window.localStorage.setItem("nomosos.admin.reading.fontSize", String(v));
  };

  const textBlock = (
    <pre
      className="whitespace-pre-wrap break-words font-sans leading-relaxed text-steel-100"
      style={{ fontSize: `${fontSize}px` }}
    >
      {text}
    </pre>
  );

  // TAM EKRAN okuma katmanı — panelin üstünde, ekranın tamamında.
  if (expanded && text) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-steel-950">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-steel-800 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-steel-100">{item.court}</p>
            <p className="text-xs text-steel-500">
              E. {item.caseNumber} · K. {item.decisionNumber}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <div className="flex items-center rounded-lg border border-steel-800">
              <button
                type="button"
                onClick={() => changeFont(fontSize - 2)}
                className="px-2.5 py-1.5 text-xs font-semibold text-steel-300 hover:bg-steel-900"
                title="Yazıyı küçült"
              >
                A−
              </button>
              <span className="px-1 text-[11px] tabular-nums text-steel-500">{fontSize}px</span>
              <button
                type="button"
                onClick={() => changeFont(fontSize + 2)}
                className="px-2.5 py-1.5 text-xs font-semibold text-steel-300 hover:bg-steel-900"
                title="Yazıyı büyüt"
              >
                A+
              </button>
            </div>
            <Button size="sm" variant="secondary" onClick={() => setExpanded(false)}>
              Bölmesine dön ⤡
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="mx-auto max-w-3xl">{textBlock}</div>
        </div>
      </div>
    );
  }

  return (
    <Card
      title="Karar metni"
      subtitle={
        item.fullText
          ? "Kuyrukta saklanan metin"
          : state.preview
            ? state.preview.source === "CANLI"
              ? "Resmî kaynaktan çekilen temiz metin (canlı önizleme)"
              : "Kuyruk metni"
            : undefined
      }
      action={
        text ? (
          <div className="flex items-center gap-1">
            <div className="flex items-center rounded-lg border border-steel-800" aria-label="Yazı boyutu">
              <button
                type="button"
                onClick={() => changeFont(fontSize - 2)}
                disabled={fontSize <= 12}
                className="px-2 py-1 text-xs font-semibold text-steel-300 hover:bg-steel-900 disabled:opacity-40"
                title="Yazıyı küçült"
              >
                A−
              </button>
              <button
                type="button"
                onClick={() => changeFont(fontSize + 2)}
                disabled={fontSize >= 24}
                className="px-2 py-1 text-xs font-semibold text-steel-300 hover:bg-steel-900 disabled:opacity-40"
                title="Yazıyı büyüt"
              >
                A+
              </button>
            </div>
            <Button size="sm" variant="secondary" onClick={() => setExpanded(true)} title="Metni ekranın tamamında oku">
              Tam ekran ⤢
            </Button>
          </div>
        ) : undefined
      }
      bodyClassName="p-0"
    >
      {state.loading ? (
        <div className="p-4">
          <Spinner label="Karar metni kaynaktan çekiliyor…" />
        </div>
      ) : text ? (
        <div className="max-h-[62vh] overflow-y-auto px-5 py-4">{textBlock}</div>
      ) : state.error ? (
        <div className="p-4">
          <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {state.error}
          </p>
        </div>
      ) : (
        <p className="p-4 text-sm text-steel-500">Karar metni yok.</p>
      )}
      {sourceUrl ? (
        <p className="border-t border-steel-800 px-5 py-2 text-xs">
          <a href={sourceUrl} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">
            Kaynak belgeyi yeni sekmede aç →
          </a>
        </p>
      ) : null}
    </Card>
  );
}

function RejectModal({
  item,
  busy,
  onClose,
  onSubmit,
}: {
  item: IngestItem;
  busy: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();

  return (
    <Modal open onClose={onClose} title="Kararı reddet — gerekçe zorunlu" subtitle={`${item.court} · E. ${item.caseNumber} / K. ${item.decisionNumber}`}>
      <div className="space-y-3">
        <InfoBox>
          Red gerekçesi denetim izine yazılır ve kayıt bir daha kuyruğa girmez. En az 3 karakter.
        </InfoBox>
        <Field label="Red gerekçesi" required>
          <Textarea
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="örn. Künye kaynakla doğrulanamadı / karar metni bozuk"
            autoFocus
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button variant="danger" disabled={busy || trimmed.length < 3} onClick={() => onSubmit(trimmed)}>
            {busy ? "Reddediliyor…" : "Reddet"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
