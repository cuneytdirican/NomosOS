"use client";

/**
 * Dosya detayı → RİSK sekmesi (Modül 17).
 *
 * Sekiz satır gösterilir: GENEL (büyük kart) + yedi boyut.
 *
 * SKOR HİBRİTTİR ve ekran bunu GÖRÜNÜR KILAR: "neden bu skor" panelinde kural
 * sinyalleri ile AI yorumu AYRI BLOKLARDA durur. Bu ayrım kozmetik değildir —
 * bandın kaynağı daima deterministik kural tabanıdır; AI düzeltmesi ±25 ile
 * sınırlıdır ve bandı tek başına değiştiremez (Modül 17, kural 1). İki kaynağı
 * tek listede eritmek, avukata "AI beni 🔴 yaptı" izlenimi verirdi.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Disclosure,
  ErrorBox,
  Field,
  Modal,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import { AiDisclaimer, FeatureUnavailable } from "@/components/ai-ui";
import { errText, isFeatureMissing } from "@/lib/faz2";
import {
  RISK_BANDS,
  RISK_BAND_BARS,
  RISK_BAND_DOTS,
  RISK_BAND_LABELS,
  RISK_BAND_TONES,
  RISK_DIMENSIONS,
  RISK_DIMENSION_HINTS,
  RISK_DIMENSION_LABELS,
  RISK_SIGNAL_SOURCE_LABELS,
  fmtDateTime,
  labelOf,
  riskBandOf,
} from "@/lib/labels";
import {
  clearRiskOverride,
  getCaseRisk,
  overrideRiskBand,
  recomputeRisk,
  riskSignals,
} from "../_lib/faz4";
import type { CaseRisk, RiskScore, RiskSignal } from "../_lib/faz4-types";

type Notify = (text: string, tone?: "success" | "error" | "info") => void;

export function RiskTab({ caseId, onNotify }: { caseId: string; onNotify: Notify }) {
  const [risk, setRisk] = useState<CaseRisk | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [overrideDim, setOverrideDim] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMissing(false);
    try {
      setRisk(await getCaseRisk(caseId));
    } catch (err) {
      if (isFeatureMissing(err)) setMissing(true);
      else setError(errText(err, "Risk kartı yüklenemedi."));
      setRisk(null);
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const byDimension = useMemo(() => {
    const map = new Map<string, RiskScore>();
    for (const s of risk?.scores ?? []) map.set(String(s.dimension), s);
    return map;
  }, [risk]);

  const overrideOf = useCallback(
    (dimension: string) =>
      (risk?.overrides ?? []).find((o) => String(o.dimension) === dimension) ?? null,
    [risk],
  );

  async function handleRecompute() {
    setBusy(true);
    try {
      await recomputeRisk(caseId);
      onNotify("Risk yeniden hesaplandı.", "success");
      await load();
    } catch (err) {
      onNotify(errText(err, "Risk yeniden hesaplanamadı."), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleClearOverride(dimension: string) {
    if (!window.confirm("Elle düzeltme kaldırılsın ve otomatik hesaba dönülsün mü?")) return;
    try {
      await clearRiskOverride(caseId, dimension);
      onNotify("Elle düzeltme kaldırıldı.", "info");
      await load();
    } catch (err) {
      onNotify(errText(err, "Elle düzeltme kaldırılamadı."), "error");
    }
  }

  if (loading) return <Spinner label="Risk kartı yükleniyor…" />;
  if (missing) {
    return (
      <FeatureUnavailable
        title="Risk motoru henüz hazır değil"
        detail="Risk uçları yayına alındığında bu ekran otomatik olarak çalışacak."
        onRetry={() => void load()}
      />
    );
  }

  const overall = byDimension.get("GENEL") ?? null;
  const dimensions = RISK_DIMENSIONS.filter((d) => d !== "GENEL");
  const hasAny = (risk?.scores.length ?? 0) > 0;

  return (
    <div className="space-y-6">
      {error && <ErrorBox message={error} />}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3.5">
        <p className="max-w-xl text-xs leading-5 text-slate-600">
          Skorun tabanı <strong>deterministik kural sinyalleridir</strong>. AI yalnızca
          sınırlı (±25) bir düzeltme önerir ve bandı tek başına değiştiremez.
          {risk?.computedAt ? ` Son hesap: ${fmtDateTime(risk.computedAt)}.` : ""}
        </p>
        <Button variant="gold" disabled={busy} onClick={() => void handleRecompute()}>
          {busy ? "Hesaplanıyor…" : "Yeniden Hesapla"}
        </Button>
      </div>

      {!hasAny ? (
        <Card>
          <p className="text-sm text-slate-500">
            Bu dosya için henüz risk skoru hesaplanmamış. &quot;Yeniden Hesapla&quot; ile ilk
            hesabı başlatabilirsiniz.
          </p>
        </Card>
      ) : (
        <>
          {/* GENEL — büyük kart */}
          {overall && (
            <OverallCard
              score={overall}
              overridden={Boolean(overrideOf("GENEL"))}
              onOverride={() => setOverrideDim("GENEL")}
              onClearOverride={() => void handleClearOverride("GENEL")}
            />
          )}

          {/* Yedi boyut */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {dimensions.map((d) => (
              <DimensionCard
                key={d}
                dimension={d}
                score={byDimension.get(d) ?? null}
                overrideReason={overrideOf(d)?.reason ?? null}
                onOverride={() => setOverrideDim(d)}
                onClearOverride={() => void handleClearOverride(d)}
              />
            ))}
          </div>
        </>
      )}

      <OverrideModal
        caseId={caseId}
        dimension={overrideDim}
        current={overrideDim ? (byDimension.get(overrideDim) ?? null) : null}
        onClose={() => setOverrideDim(null)}
        onSaved={async () => {
          setOverrideDim(null);
          onNotify("Boyut elle düzeltildi. Karar denetim izine yazıldı.", "success");
          await load();
        }}
      />
    </div>
  );
}

// ------------------------------------------------------------ genel kart

function OverallCard({
  score,
  overridden,
  onOverride,
  onClearOverride,
}: {
  score: RiskScore;
  overridden: boolean;
  onOverride: () => void;
  onClearOverride: () => void;
}) {
  const band = String(score.band ?? riskBandOf(score.score));
  return (
    <section className="rounded-xl border border-slate-200 bg-slate-900 p-6 text-white">
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <span className="text-4xl leading-none">{RISK_BAND_DOTS[band] ?? "⚪"}</span>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Genel Risk
            </p>
            <p className="mt-1 text-5xl font-bold leading-none">{score.score}</p>
            <p className="mt-2 text-xs text-slate-300">
              {labelOf(RISK_BAND_LABELS, band)} bant · boyutların ağırlıklı bileşkesi
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {overridden && <Badge tone="gold">Elle düzeltildi</Badge>}
          <Button size="sm" variant="secondary" onClick={onOverride}>
            Elle düzelt
          </Button>
          {overridden && (
            <Button size="sm" variant="ghost" className="text-slate-300" onClick={onClearOverride}>
              Düzeltmeyi kaldır
            </Button>
          )}
        </div>
      </div>
      <div className="mt-5">
        <ScoreBar score={score.score} band={band} dark />
      </div>
      <div className="mt-4 rounded-lg bg-white/5 p-1">
        <SignalPanel score={score} dark />
      </div>
    </section>
  );
}

// ------------------------------------------------------------ boyut kartı

function DimensionCard({
  dimension,
  score,
  overrideReason,
  onOverride,
  onClearOverride,
}: {
  dimension: string;
  score: RiskScore | null;
  overrideReason: string | null;
  onOverride: () => void;
  onClearOverride: () => void;
}) {
  const band = score ? String(score.band ?? riskBandOf(score.score)) : null;

  return (
    <section className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {labelOf(RISK_DIMENSION_LABELS, dimension)}
          </p>
          <p className="mt-1 text-3xl font-bold leading-none text-slate-900">
            {score ? score.score : "—"}
          </p>
        </div>
        <span className="text-xl leading-none">{band ? (RISK_BAND_DOTS[band] ?? "⚪") : "⚪"}</span>
      </div>

      {band && (
        <div className="mt-3">
          <ScoreBar score={score?.score ?? 0} band={band} />
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {band && (
          <Badge tone={RISK_BAND_TONES[band] ?? "gray"}>{labelOf(RISK_BAND_LABELS, band)}</Badge>
        )}
        {overrideReason && <Badge tone="gold">Elle düzeltildi</Badge>}
      </div>

      <p className="mt-2 text-[11px] leading-4 text-slate-400">
        {RISK_DIMENSION_HINTS[dimension]}
      </p>

      {score && (
        <div className="mt-3">
          <SignalPanel score={score} />
        </div>
      )}

      {overrideReason && (
        <p className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] leading-4 text-amber-900">
          <strong>Düzeltme gerekçesi:</strong> {overrideReason}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
        <Button size="sm" variant="secondary" onClick={onOverride}>
          Elle düzelt
        </Button>
        {overrideReason && (
          <Button size="sm" variant="ghost" onClick={onClearOverride}>
            Kaldır
          </Button>
        )}
      </div>
    </section>
  );
}

function ScoreBar({
  score,
  band,
  dark = false,
}: {
  score: number;
  band: string;
  dark?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(score)));
  return (
    <div
      className={`h-2 w-full overflow-hidden rounded-full ${dark ? "bg-white/15" : "bg-slate-100"}`}
      role="img"
      aria-label={`Risk skoru ${pct} / 100 — ${labelOf(RISK_BAND_LABELS, band)} bant`}
    >
      <div
        className={`h-full rounded-full ${RISK_BAND_BARS[band] ?? "bg-slate-400"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/**
 * "Neden bu skor" paneli.
 *
 * KURAL sinyalleri ve AI yorumu AYRI gösterilir; AI düzeltmesinin sayısal
 * sınırı (±25) da ekranda yazar ki avukat bandın kaynağını ayırt edebilsin.
 */
function SignalPanel({ score, dark = false }: { score: RiskScore; dark?: boolean }) {
  const signals = riskSignals(score);
  const ruleSignals = signals.filter((s) => String(s.source ?? "KURAL").toUpperCase() !== "AI");
  const aiSignals = signals.filter((s) => String(s.source ?? "").toUpperCase() === "AI");
  const hasAi = aiSignals.length > 0 || score.aiCommentary || typeof score.aiAdjustment === "number";

  return (
    <Disclosure
      summary={
        <span className={dark ? "text-slate-200" : undefined}>
          Neden bu skor? · {ruleSignals.length} kural sinyali
          {hasAi ? " + AI yorumu" : ""}
        </span>
      }
      className={dark ? "border-white/10 bg-white/5" : ""}
    >
      <div className="space-y-3">
        {/* Kural tabanı */}
        <div>
          <p className={`text-[11px] font-semibold uppercase tracking-wide ${dark ? "text-slate-300" : "text-slate-500"}`}>
            Kural sinyalleri (deterministik taban)
          </p>
          {ruleSignals.length === 0 ? (
            <p className={`mt-1 text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>
              Kayıtlı kural sinyali yok.
            </p>
          ) : (
            <ul className="mt-1 space-y-1">
              {ruleSignals.map((s, i) => (
                <li key={i} className={`text-xs leading-5 ${dark ? "text-slate-200" : "text-slate-700"}`}>
                  <SignalLine signal={s} />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* AI düzeltmesi */}
        {hasAi && (
          <div
            className={`rounded-lg px-3 py-2 ${dark ? "bg-white/5" : "border border-amber-200 bg-amber-50"}`}
          >
            <p className={`text-[11px] font-semibold uppercase tracking-wide ${dark ? "text-amber-300" : "text-amber-800"}`}>
              AI değerlendirmesi (öneri · en çok ±25)
            </p>
            {typeof score.aiAdjustment === "number" && (
              <p className={`mt-1 text-xs font-medium ${dark ? "text-amber-200" : "text-amber-900"}`}>
                Düzeltme: {score.aiAdjustment > 0 ? "+" : ""}
                {score.aiAdjustment} puan
              </p>
            )}
            {score.aiCommentary && (
              <p className={`mt-1 whitespace-pre-wrap text-xs leading-5 ${dark ? "text-amber-100" : "text-amber-900"}`}>
                {score.aiCommentary}
              </p>
            )}
            {aiSignals.map((s, i) => (
              <p key={i} className={`mt-1 text-xs leading-5 ${dark ? "text-amber-100" : "text-amber-900"}`}>
                <SignalLine signal={s} />
              </p>
            ))}
            {score.model && (
              <p className={`mt-1 text-[11px] ${dark ? "text-slate-400" : "text-amber-700"}`}>
                Model: {score.model}
              </p>
            )}
            {!dark && (
              <div className="mt-2">
                <AiDisclaimer text="AI düzeltmesi bir ÖNERİDİR; bandı tek başına değiştiremez. Katılmıyorsanız gerekçeli olarak elle düzeltebilirsiniz." />
              </div>
            )}
          </div>
        )}

        {score.computedAt && (
          <p className={`text-[11px] ${dark ? "text-slate-400" : "text-slate-400"}`}>
            Hesap zamanı: {fmtDateTime(score.computedAt)}
          </p>
        )}
      </div>
    </Disclosure>
  );
}

function SignalLine({ signal }: { signal: RiskSignal }) {
  const source = String(signal.source ?? "KURAL").toUpperCase();
  const points =
    typeof signal.points === "number"
      ? `${signal.points > 0 ? "+" : ""}${signal.points}`
      : null;
  return (
    <>
      <span className="font-semibold">
        [{labelOf(RISK_SIGNAL_SOURCE_LABELS, source)}
        {points ? ` ${points}` : ""}]
      </span>{" "}
      {signal.reason ?? signal.code ?? "Gerekçe belirtilmedi"}
    </>
  );
}

// ------------------------------------------------------------ ezme modalı

function OverrideModal({
  caseId,
  dimension,
  current,
  onClose,
  onSaved,
}: {
  caseId: string;
  dimension: string | null;
  current: RiskScore | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [band, setBand] = useState<string>("ORTA");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dimension) return;
    setBand(String(current?.band ?? riskBandOf(current?.score)));
    setReason("");
    setError(null);
  }, [dimension, current]);

  if (!dimension) return null;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!dimension) return;
    setBusy(true);
    setError(null);
    try {
      await overrideRiskBand(caseId, dimension, band, reason);
      await onSaved();
    } catch (err) {
      setError(errText(err, "Elle düzeltme kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={`${labelOf(RISK_DIMENSION_LABELS, dimension)} — Elle Düzelt`}
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        <p className="rounded-lg bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
          Elle düzeltme, yeni bir olay tetiklemesine kadar otomatik hesapla ezilmez ve
          kartta &quot;elle düzeltildi&quot; rozetiyle görünür. <strong>Gerekçe zorunludur</strong>
          — denetim izine yazılır.
        </p>
        <Field label="Bant">
          <Select value={band} onChange={(e) => setBand(e.target.value)}>
            {RISK_BANDS.map((b) => (
              <option key={b} value={b}>
                {labelOf(RISK_BAND_LABELS, b)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Gerekçe">
          <Textarea
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Örn. Tebliğ mazbatasındaki tarih düzeltildi; süre riski kural tabanı artık geçerli değil."
            required
          />
        </Field>
        {error && <ErrorBox message={error} />}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" variant="gold" disabled={busy || reason.trim().length < 10}>
            {busy ? "Kaydediliyor…" : "Düzeltmeyi Kaydet"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
