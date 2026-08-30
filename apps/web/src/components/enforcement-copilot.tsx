"use client";

/**
 * İcra AI Copilot paneli — 6 hazır komut.
 *
 * ÜRÜN İLKELERİ (arayüzde görünür biçimde uygulanır):
 *  - Her çıktı ÖNERİDİR: kartın üstünde AiDisclaimer şeridi sabittir.
 *  - Kaynak gösterme zorunlu: dosyadaki hangi kayda dayandığı listelenir;
 *    kaynağı olmayan çıktı "kaynak gösterilmedi" uyarısıyla işaretlenir.
 *  - Tahsilat ihtimali skoru KURAL SİNYALLERİNDEN gelir; AI yalnızca yorum
 *    yazar. Skor kartında sinyaller açıkça listelenir ve "AI yorumu" ayrı bir
 *    blokta, skordan görsel olarak ayrılmış biçimde gösterilir.
 *  - KVKK: sunucu 409 `requiresPiiApproval` dönerse maskeli önizleme gösterilir
 *    ve kullanıcı onaylamadan istek TEKRARLANMAZ.
 *  - Copilot hiçbir kaydı doğrudan yazmaz; çıktı ekranda kalır.
 */

import { useState } from "react";
import { Badge, Button, Card, EmptyState, ErrorBox } from "@/components/ui";
import { AiDisclaimer, PiiApprovalBox, ReasoningBlock, SourceQuote } from "@/components/ai-ui";
import { errText, extractPii, type PiiPrompt } from "@/lib/faz2";
import { copilotText, ruleSignalsOf, runCopilot } from "@/lib/enforcement";
import type { CollectionScore, CopilotCommand, CopilotResult, RuleSignal } from "@/lib/faz3-types";
import {
  COPILOT_COMMANDS,
  SCORE_BAND_LABELS,
  SCORE_BAND_TONES,
  fmtDate,
  fmtDateTime,
  labelOf,
} from "@/lib/labels";

export function EnforcementCopilot({
  enforcementId,
  latestScore,
  onScoreUpdated,
}: {
  enforcementId: string;
  latestScore: CollectionScore | null;
  onScoreUpdated?: (score: CollectionScore) => void;
}) {
  const [active, setActive] = useState<CopilotCommand | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CopilotResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pii, setPii] = useState<PiiPrompt | null>(null);
  const [pendingCommand, setPendingCommand] = useState<CopilotCommand | null>(null);

  async function run(command: CopilotCommand, piiApproved = false) {
    setBusy(true);
    setError(null);
    if (!piiApproved) {
      setResult(null);
      setPii(null);
    }
    setActive(command);
    try {
      const res = await runCopilot(enforcementId, { command, piiApproved });
      setResult(res);
      setPii(null);
      setPendingCommand(null);
      if (res.score && onScoreUpdated) onScoreUpdated(res.score);
    } catch (err) {
      const prompt = extractPii(err);
      if (prompt) {
        setPii(prompt);
        setPendingCommand(command);
      } else {
        setError(errText(err, "Copilot komutu çalıştırılamadı."));
      }
    } finally {
      setBusy(false);
    }
  }

  const text = copilotText(result);
  const items = result?.items ?? [];
  const sources = result?.sources ?? result?.citations ?? [];
  const score = result?.score ?? null;

  return (
    <div className="space-y-5">
      <Card title="İcra Copilot">
        <AiDisclaimer text="İcra Copilot çıktıları ÖNERİDİR. Hiçbir işlem, görev veya süre kaydı bu komutlarla otomatik oluşturulmaz; kararı avukat verir." />

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {COPILOT_COMMANDS.map((c) => (
            <button
              key={c.key}
              type="button"
              disabled={busy}
              onClick={() => void run(c.key as CopilotCommand)}
              className={`rounded-lg border px-4 py-3 text-left transition-colors disabled:opacity-60 ${
                active === c.key
                  ? "border-amber-400 bg-amber-50"
                  : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              <p className="text-sm font-semibold text-slate-900">{c.label}</p>
              <p className="mt-1 text-[11px] leading-4 text-slate-500">{c.hint}</p>
            </button>
          ))}
        </div>

        {busy && (
          <p className="mt-4 text-sm text-slate-500">
            Komut çalışıyor… (dosya verisi maskeleme hattından geçiriliyor)
          </p>
        )}
      </Card>

      {pii && pendingCommand && (
        <PiiApprovalBox
          prompt={pii}
          busy={busy}
          onApprove={() => void run(pendingCommand, true)}
          onCancel={() => {
            setPii(null);
            setPendingCommand(null);
          }}
        />
      )}

      {error && <ErrorBox message={error} />}

      {result && (
        <Card
          title={
            <span className="flex items-center gap-2">
              {labelOf(
                Object.fromEntries(COPILOT_COMMANDS.map((c) => [c.key, c.label])),
                active ?? "",
              )}
              <Badge tone="gold">Öneri</Badge>
            </span>
          }
          action={
            result.model ? (
              <span className="text-[11px] text-slate-400">Model: {result.model}</span>
            ) : undefined
          }
        >
          {score && <ScoreBlock score={score} extraSignals={result.ruleSignals} />}

          {text ? (
            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-800">{text}</p>
          ) : items.length === 0 && !score ? (
            <EmptyState message="Komut boş bir sonuç döndürdü." />
          ) : null}

          {items.length > 0 && (
            <ul className="mt-4 space-y-2">
              {items.map((it, i) => (
                <li key={i} className="rounded-lg border border-slate-200 bg-slate-50/60 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-900">
                      {it.title ?? it.label ?? `Madde ${i + 1}`}
                    </span>
                    {it.priority && <Badge tone="yellow">{it.priority}</Badge>}
                    {it.status && <Badge tone="gray">{it.status}</Badge>}
                    {it.dueDate && (
                      <span className="text-[11px] text-slate-500">
                        Son gün: {fmtDate(it.dueDate)}
                      </span>
                    )}
                  </div>
                  {(it.detail ?? it.description) && (
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      {it.detail ?? it.description}
                    </p>
                  )}
                  {it.legalBasis && (
                    <p className="mt-1 text-[11px] font-medium text-slate-500">
                      Dayanak: {it.legalBasis}
                    </p>
                  )}
                  {it.note && <p className="mt-1 text-[11px] text-slate-500">{it.note}</p>}
                </li>
              ))}
            </ul>
          )}

          <ReasoningBlock text={result.reasoning} />

          {result.warnings && result.warnings.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {result.warnings.map((w, i) => (
                <li
                  key={i}
                  className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
                >
                  {w}
                </li>
              ))}
            </ul>
          )}

          {/* Kaynak gösterme zorunlu — kaynağı olmayan çıktı işaretlenir. */}
          <div className="mt-4 border-t border-slate-100 pt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Kaynaklar
            </p>
            {sources.length === 0 ? (
              <p className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Bu çıktı için dosya kaydı kaynağı gösterilmedi. Kaynaksız çıktıya dayanarak işlem
                yapmayın; ilgili safahat ve belgeleri kendiniz doğrulayın.
              </p>
            ) : (
              <ul className="mt-1.5 space-y-2">
                {sources.map((s, i) => (
                  <li key={i} className="text-xs text-slate-600">
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone={s.verified === false ? "yellow" : "navy"}>
                        {s.kind ?? "KAYIT"}
                      </Badge>
                      <span className="font-medium text-slate-800">{s.label ?? s.refId ?? "—"}</span>
                      {s.date && <span className="text-slate-400">{fmtDate(s.date)}</span>}
                      {s.verified === false && (
                        <span className="text-[11px] font-medium text-amber-700">
                          TEYİT EDİLMEDİ
                        </span>
                      )}
                    </span>
                    <SourceQuote quote={s.quote} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      )}

      {!result && latestScore && (
        <Card title="Son Hesaplanan Tahsilat Skoru">
          <ScoreBlock score={latestScore} />
        </Card>
      )}
    </div>
  );
}

// ---------- Skor bloğu ----------

function ScoreBlock({
  score,
  extraSignals,
}: {
  score: CollectionScore;
  extraSignals?: RuleSignal[];
}) {
  const signals = ruleSignalsOf(score).length > 0 ? ruleSignalsOf(score) : (extraSignals ?? []);
  const tone = SCORE_BAND_TONES[score.band] ?? "gray";
  const bar =
    tone === "green" ? "bg-emerald-500" : tone === "yellow" ? "bg-amber-500" : "bg-red-500";

  return (
    <div className="mb-5 rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-3xl font-bold tabular-nums text-slate-900">{score.score}</span>
          <span className="text-sm text-slate-400">/ 100</span>
          <Badge tone={tone}>{labelOf(SCORE_BAND_LABELS, score.band)} ihtimal</Badge>
          {score.stale && (
            <Badge tone="yellow">Skor güncel değil — yeni işlem girildi</Badge>
          )}
        </div>
        {score.computedAt && (
          <span className="text-[11px] text-slate-400">
            Hesaplama: {fmtDateTime(score.computedAt)}
          </span>
        )}
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full rounded-full ${bar}`}
          style={{ width: `${Math.max(0, Math.min(100, score.score))}%` }}
        />
      </div>

      <p className="mt-3 text-[11px] leading-5 text-slate-500">
        Skorun kendisi <strong className="font-semibold">kural sinyallerinden</strong> deterministik
        olarak üretilir. AI yalnızca aşağıdaki yorumu yazar; skoru değiştiremez ve parasal karar
        veremez. Skor bir tahmindir, hukuki garanti değildir.
      </p>

      <div className="mt-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Kural sinyalleri (skorun kaynağı)
        </p>
        {signals.length === 0 ? (
          <p className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Sunucu kural sinyallerini döndürmedi. Gerekçesi görünmeyen bir skora dayanarak
            müvekkile beklenti vermeyin.
          </p>
        ) : (
          <ul className="mt-1.5 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {signals.map((s, i) => (
              <li key={i} className="flex flex-wrap items-start justify-between gap-3 px-3 py-2">
                <div>
                  <p className="text-xs font-medium text-slate-800">
                    {s.label ?? s.name ?? s.key ?? `Sinyal ${i + 1}`}
                  </p>
                  {s.note && <p className="mt-0.5 text-[11px] text-slate-500">{s.note}</p>}
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {s.value !== undefined && s.value !== null && (
                    <span className="font-medium tabular-nums text-slate-700">
                      {String(s.value)}
                    </span>
                  )}
                  {typeof s.weight === "number" && (
                    <Badge tone={s.weight >= 0 ? "green" : "red"}>
                      {s.weight >= 0 ? "+" : ""}
                      {s.weight}
                    </Badge>
                  )}
                  {s.direction && !s.weight && (
                    <Badge tone={s.direction === "NEGATIF" ? "red" : "green"}>{s.direction}</Badge>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {score.aiCommentary && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
            AI yorumu (skoru belirlemez)
          </p>
          <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-700">
            {score.aiCommentary}
          </p>
          {score.model && (
            <p className="mt-1.5 text-[11px] text-amber-700">Model: {score.model}</p>
          )}
        </div>
      )}
    </div>
  );
}
