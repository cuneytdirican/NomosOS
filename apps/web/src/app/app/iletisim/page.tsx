"use client";

/**
 * İletişim Merkezi (Modül 19).
 *
 * GET   /communications/timeline           — birleşik kronoloji (üç tablo)
 * GET   /communications/channels           — hangi kanal gerçekten gönderebiliyor
 * GET   /outbound-messages/approvals       — onay kuyruğu
 * GET   /inbound-messages?matchStatus=     — eşleşmemiş gelen mesajlar
 * POST  /inbound-messages/:id/suggest-case — AI dosya önerisi (kredili)
 * PATCH /inbound-messages/:id/match        — İNSAN kararı
 *
 * SAYFA DÜZENİ BİR ÖNCELİK SIRASIDIR:
 *  1. Eşleşmemiş GELEN mesajlar — dosyaya bağlanmamış bir müvekkil mesajı,
 *     kimsenin takip etmediği iştir; en üstte durur.
 *  2. Onay bekleyen GİDEN taslaklar — avukatın kapıda bekleyen kararı.
 *  3. Kronoloji — geri kalan her şey.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, asList } from "@/lib/api";
import type { CaseSummary, Client } from "@/lib/types";
import { Badge, Button, Card, ErrorBox, Field, Select, Spinner } from "@/components/ui";
import { FeatureUnavailable, ToastStack, useToasts } from "@/components/ai-ui";
import { CreditBadge, useCreditCosts } from "@/components/credits";
import {
  COMM_CHANNELS,
  COMM_CHANNEL_LABELS,
  COMM_DIRECTION_LABELS,
  MATCH_PRESELECT_FLOOR,
  MATCH_STATUS_LABELS,
  MATCH_STATUS_TONES,
  MATCH_SUGGESTION_FLOOR,
  OUTBOUND_STATUS_LABELS,
  OUTBOUND_STATUS_TONES,
  confidencePercent,
  fmtDateTime,
  labelOf,
} from "@/lib/labels";
import { errText } from "@/lib/faz2";
import { CommTimeline } from "../_components/comm-timeline";
import { ComposeMessageModal } from "../_components/compose-message-modal";
import {
  isFeatureMissing,
  listApprovalQueue,
  listChannelStatus,
  listInboundMessages,
  listTimeline,
  matchInboundMessage,
  suggestInboundCase,
  type ChannelStatus,
} from "../_lib/faz5";
import type { CaseRef, ClientRef, CommEntry } from "../_lib/faz5-types";

export default function IletisimMerkeziPage() {
  const [entries, setEntries] = useState<CommEntry[]>([]);
  const [pending, setPending] = useState<CommEntry[]>([]);
  const [inbound, setInbound] = useState<CommEntry[]>([]);
  const [channelStatus, setChannelStatus] = useState<ChannelStatus[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [channel, setChannel] = useState("");
  const [clientId, setClientId] = useState("");
  const [direction, setDirection] = useState("");

  const [composeOpen, setComposeOpen] = useState(false);
  const [editing, setEditing] = useState<CommEntry | null>(null);

  const { toasts, push, dismiss } = useToasts();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMissing(false);
    const [t, a, i] = await Promise.allSettled([
      listTimeline({ clientId: clientId || undefined }),
      listApprovalQueue(),
      listInboundMessages({ matchStatus: "BEKLIYOR" }),
    ]);

    setEntries(t.status === "fulfilled" ? t.value : []);
    setPending(a.status === "fulfilled" ? a.value : []);
    setInbound(i.status === "fulfilled" ? i.value : []);

    if (t.status === "rejected") {
      if (isFeatureMissing(t.reason)) setMissing(true);
      else setError(errText(t.reason, "İletişim kayıtları yüklenemedi."));
    }
    setLoading(false);
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Kanal durumu + seçenek listeleri — bir kez yüklenir. */
  useEffect(() => {
    let alive = true;
    void Promise.allSettled([
      api<unknown>("/clients", { query: { limit: "200" } }),
      api<unknown>("/cases", { query: { limit: "200" } }),
      listChannelStatus(),
    ]).then(([c, k, ch]) => {
      if (!alive) return;
      setClients(c.status === "fulfilled" ? asList<Client>(c.value) : []);
      setCases(k.status === "fulfilled" ? asList<CaseSummary>(k.value) : []);
      setChannelStatus(ch.status === "fulfilled" ? ch.value : []);
    });
    return () => {
      alive = false;
    };
  }, []);

  const clientRefs: ClientRef[] = useMemo(
    () => clients.map((c) => ({ id: c.id, name: c.name })),
    [clients],
  );
  const caseRefs: Array<CaseRef & { clientId?: string | null }> = useMemo(
    () =>
      cases.map((c) => ({
        id: c.id,
        title: c.title,
        fileNumber: c.fileNumber ?? null,
        status: c.status ?? null,
        clientId: c.client?.id ?? null,
      })),
    [cases],
  );

  /** Kronolojiyi istemcide süzeriz: uç kanal/yön süzgeci almıyor. */
  const visible = useMemo(
    () =>
      entries.filter(
        (e) =>
          (!channel || e.channel === channel) && (!direction || e.direction === direction),
      ),
    [entries, channel, direction],
  );

  const unconfigured = useMemo(
    () => channelStatus.filter((c) => !c.configured),
    [channelStatus],
  );
  const failures = useMemo(
    () => entries.filter((e) => e.status === "BASARISIZ" && e.failureReason),
    [entries],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">İletişim Merkezi</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Müvekkille yapılan her yazışma tek kronolojide. Giden mesajlarda akış değişmez:{" "}
            <strong className="text-slate-700">
              AI ya da şablon taslak yazar → avukat onaylar → sistem gönderir.
            </strong>
          </p>
        </div>
        <Button
          variant="gold"
          onClick={() => {
            setEditing(null);
            setComposeOpen(true);
          }}
        >
          + Yeni Mesaj
        </Button>
      </div>

      {/* Kanal yapılandırma bilgisi */}
      {unconfigured.length > 0 && (
        <div className="rounded-xl border border-slate-300 bg-slate-50 px-5 py-4">
          <p className="text-sm font-semibold text-slate-800">
            {unconfigured.length} kanalda gönderim sağlayıcısı yapılandırılmamış
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            NomosOS sahte gönderim yapmaz. Bu kanallarda taslak hazırlayıp onaylayabilirsiniz;
            gönderim, sağlayıcı tanımlanana kadar denenmez ve mesaj ONAYLANDI durumunda korunur.
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {unconfigured.map((c) => (
              <li
                key={c.channel}
                className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[11px] text-slate-600"
              >
                {labelOf(COMM_CHANNEL_LABELS, c.channel)}
                {c.requires.length > 0 ? ` — gerekli: ${c.requires.join(", ")}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Filtreler */}
      <Card title="Filtreler">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Kanal">
            <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option value="">Tümü</option>
              {COMM_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {labelOf(COMM_CHANNEL_LABELS, c)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Müvekkil">
            <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Tümü</option>
              {clientRefs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name ?? c.id}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Yön">
            <Select value={direction} onChange={(e) => setDirection(e.target.value)}>
              <option value="">Tümü</option>
              {(["GELEN", "GIDEN"] as const).map((d) => (
                <option key={d} value={d}>
                  {labelOf(COMM_DIRECTION_LABELS, d)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      {error && <ErrorBox message={error} />}

      {missing ? (
        <FeatureUnavailable
          title="İletişim Merkezi henüz hazır değil"
          detail="İletişim uçları yayına alındığında bu ekran otomatik olarak çalışacak."
          onRetry={() => void load()}
        />
      ) : loading ? (
        <Spinner label="Yazışmalar yükleniyor…" />
      ) : (
        <>
          {failures.length > 0 && (
            <div className="rounded-xl border border-red-300 bg-red-50 px-5 py-4">
              <p className="text-sm font-semibold text-red-900">
                {failures.length} mesaj gönderilemedi
              </p>
              <ul className="mt-2 space-y-1">
                {failures.slice(0, 3).map((e) => (
                  <li key={e.id} className="text-xs text-red-900">
                    • {e.subject ?? e.body.slice(0, 60)} — {e.failureReason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 1. Eşleşmemiş gelen mesajlar */}
          {inbound.length > 0 && (
            <Card title={`Eşleşmemiş Gelen Mesajlar (${inbound.length})`}>
              <p className="text-xs leading-5 text-slate-600">
                Bu mesajlar bir dosyaya bağlanmadı. AI önerisi yalnızca ÖNERİDİR; kaydı siz
                onaylarsınız.
              </p>
              <ul className="mt-3 space-y-3">
                {inbound.map((e) => (
                  <InboundMatchRow
                    key={e.id}
                    entry={e}
                    clients={clientRefs}
                    cases={caseRefs}
                    onChanged={async (text) => {
                      push(text, "success");
                      await load();
                    }}
                    onError={(m) => push(m, "error")}
                  />
                ))}
              </ul>
            </Card>
          )}

          {/* 2. Onay bekleyen giden taslaklar */}
          {pending.length > 0 && (
            <Card title={`Onayınızı Bekleyen Mesajlar (${pending.length})`}>
              <p className="text-xs leading-5 text-slate-600">
                Onaylanmadan hiçbiri gönderilmez. Onaylayan kullanıcı, gönderilen metnin
                sorumlusudur.
              </p>
              <ul className="mt-3 space-y-2">
                {pending.map((e) => (
                  <li
                    key={e.id}
                    className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50/60 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">
                        {e.subject ?? `${labelOf(COMM_CHANNEL_LABELS, e.channel)} mesajı`}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {e.client?.name ?? "Müvekkil"}
                        {e.case?.title ? ` · ${e.case.title}` : ""}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-600">
                        {e.body.slice(0, 160)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge tone={OUTBOUND_STATUS_TONES[e.status ?? ""] ?? "gray"}>
                        {labelOf(OUTBOUND_STATUS_LABELS, e.status)}
                      </Badge>
                      <Button
                        size="sm"
                        onClick={() => {
                          setEditing(e);
                          setComposeOpen(true);
                        }}
                      >
                        İncele ve onayla
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* 3. Birleşik kronoloji */}
          <CommTimeline
            entries={visible}
            onOpen={(e) => {
              setEditing(e);
              setComposeOpen(true);
            }}
            emptyMessage="Seçtiğiniz filtrelerde yazışma yok. “Yeni Mesaj” ile ilk taslağı oluşturabilirsiniz."
          />
        </>
      )}

      <ComposeMessageModal
        open={composeOpen}
        existing={editing}
        clients={clientRefs}
        cases={caseRefs}
        channelStatus={channelStatus}
        onNotify={push}
        onClose={() => setComposeOpen(false)}
        onSaved={load}
      />

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

// ---------- Gelen mesaj eşleştirme ----------

/**
 * Elle eşleştirme satırı.
 *
 * AI önerisi ÖN-SEÇİLİ gelebilir ama kaydı insan yapar (Modül 19, iş kuralı 5):
 *  - güven < 0.5  → öneri HİÇ gösterilmez (zayıf tahmin yanlış yönlendirir),
 *  - güven ≥ 0.85 → öneri ön-seçili gelir,
 *  - arada        → öneri gösterilir ama seçili DEĞİLDİR.
 *
 * "İlgisiz" düğmesi `matched: false` gönderir: mesajı bir dosyaya bağlamamak da
 * bir karardır ve kayıt altına alınır — kuyrukta sonsuza dek bekleyen bir satır
 * bırakmaz.
 */
function InboundMatchRow({
  entry,
  clients,
  cases,
  onChanged,
  onError,
}: {
  entry: CommEntry;
  clients: ClientRef[];
  cases: Array<CaseRef & { clientId?: string | null }>;
  onChanged: (text: string) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const { costs } = useCreditCosts();
  const confidence = entry.matchConfidence;
  const pct = confidencePercent(confidence);
  const showSuggestion =
    confidence !== null && confidence >= MATCH_SUGGESTION_FLOOR && Boolean(entry.case?.id);
  const preselect = showSuggestion && confidence !== null && confidence >= MATCH_PRESELECT_FLOOR;

  const [clientId, setClientId] = useState(entry.client?.id ?? "");
  const [caseId, setCaseId] = useState(preselect ? (entry.case?.id ?? "") : "");
  const [busy, setBusy] = useState<"match" | "reject" | "suggest" | null>(null);

  const caseOptions = useMemo(
    () => (clientId ? cases.filter((c) => !c.clientId || c.clientId === clientId) : cases),
    [cases, clientId],
  );

  async function act(kind: "match" | "reject" | "suggest") {
    setBusy(kind);
    try {
      if (kind === "suggest") {
        await suggestInboundCase(entry.id);
        await onChanged("AI dosya önerisi üretildi — kararı siz verirsiniz.");
      } else if (kind === "reject") {
        await matchInboundMessage(entry.id, { matched: false });
        await onChanged("Mesaj “ilgisiz” olarak işaretlendi.");
      } else {
        await matchInboundMessage(entry.id, {
          clientId: clientId || null,
          caseId: caseId || null,
        });
        await onChanged("Mesaj dosyaya bağlandı.");
      }
    } catch (err) {
      onError(errText(err, "İşlem tamamlanamadı."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900">
            {entry.subject ?? `${labelOf(COMM_CHANNEL_LABELS, entry.channel)} mesajı`}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {entry.fromRef ?? "gönderen bilinmiyor"} · {fmtDateTime(entry.occurredAt)}
          </p>
        </div>
        <Badge tone={MATCH_STATUS_TONES[entry.matchStatus ?? ""] ?? "gray"}>
          {labelOf(MATCH_STATUS_LABELS, entry.matchStatus)}
        </Badge>
      </div>

      <p className="mt-2 whitespace-pre-wrap rounded border border-slate-100 bg-slate-50 px-2 py-1.5 text-xs leading-5 text-slate-700">
        {entry.body.slice(0, 300)}
        {entry.body.length > 300 ? "…" : ""}
      </p>

      {showSuggestion && (
        <p className="mt-2 text-[11px] leading-5 text-slate-600">
          <span className="font-semibold text-slate-700">AI önerisi:</span>{" "}
          {entry.case?.title ?? entry.case?.id}
          {pct !== null ? ` · %${pct} güven` : ""} —{" "}
          {preselect
            ? "öneri ön-seçili geldi, yine de onayınızla kaydedilir."
            : "öneri seçili DEĞİL; doğruluğunu siz teyit edin."}
        </p>
      )}
      {confidence !== null && confidence < MATCH_SUGGESTION_FLOOR && (
        <p className="mt-2 text-[11px] leading-5 text-slate-400">
          AI önerisi güven eşiğinin altında kaldığı için gösterilmiyor; eşleştirmeyi elle yapın.
        </p>
      )}

      <div className="mt-3 grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <Field label="Müvekkil">
          <Select
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              setCaseId("");
            }}
          >
            <option value="">Seçiniz…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name ?? c.id}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Dosya">
          <Select value={caseId} onChange={(e) => setCaseId(e.target.value)}>
            <option value="">(dosyasız — yalnız müvekkile bağla)</option>
            {caseOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title ?? c.fileNumber ?? c.id}
              </option>
            ))}
          </Select>
        </Field>
        <Button
          disabled={busy !== null || (!clientId && !caseId)}
          onClick={() => void act("match")}
          title={!clientId && !caseId ? "En az bir müvekkil ya da dosya seçin." : undefined}
        >
          {busy === "match" ? "Bağlanıyor…" : "Eşleştir"}
        </Button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={busy !== null}
          onClick={() => void act("suggest")}
          title="Mesaj metnine bakarak dosya önerisi üretir. Kararı yine siz verirsiniz."
        >
          {busy === "suggest" ? "Öneri isteniyor…" : "AI dosya önerisi iste"}
          <CreditBadge taskType="MESSAGE_CASE_MATCH" costs={costs} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy !== null}
          onClick={() => void act("reject")}
          title="Bu mesaj hiçbir dosyayla ilgili değil."
        >
          {busy === "reject" ? "İşleniyor…" : "İlgisiz olarak işaretle"}
        </Button>
        {entry.client?.id && (
          <Link
            href={`/app/muvekkiller/${entry.client.id}`}
            className="text-[11px] text-slate-400 hover:text-amber-600"
          >
            Müvekkil kartı →
          </Link>
        )}
      </div>
    </li>
  );
}
