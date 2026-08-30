"use client";

/**
 * Çakışma Kontrolü — `/app/cakisma` (Modül 11).
 *
 * Arama kutusu, sonuç kartları (eşleşme tipi rozetleri + benzerlik yüzdesi),
 * karar verme (Devam / Reddet / Beklemede + not) ve geçmiş taramalar.
 *
 * MODÜLÜN TAVRI ENGELLEME DEĞİL UYARIDIR: hiçbir sonuç bir akışı durdurmaz.
 * Tarama, kararın ve gerekçesinin kalıcı kaydını üretir — ileride "bu müvekkili
 * alırken çatışmayı biliyor muyduk?" sorusunun denetim kanıtı budur.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import { FeatureUnavailable, ToastStack, useToasts } from "@/components/ai-ui";
import { errText, isFeatureMissing } from "@/lib/faz2";
import {
  CONFLICT_DECISIONS,
  CONFLICT_DECISION_LABELS,
  CONFLICT_DECISION_TONES,
  CONFLICT_RESULT_DOTS,
  CONFLICT_RESULT_LABELS,
  CONFLICT_RESULT_TONES,
  fmtDateTime,
  labelOf,
} from "@/lib/labels";
import { ConflictResultCard } from "../_components/conflict-result";
import {
  decideConflictCheck,
  getConflictCheck,
  listConflictChecks,
  runConflictCheck,
} from "../_lib/faz4";
import type { ConflictCheck } from "../_lib/faz4-types";

export default function CakismaPage() {
  const [query, setQuery] = useState("");
  const [context, setContext] = useState("");
  const [current, setCurrent] = useState<ConflictCheck | null>(null);
  const [history, setHistory] = useState<ConflictCheck[]>([]);
  const [scanning, setScanning] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toasts, push, dismiss } = useToasts();

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      setHistory(await listConflictChecks(50));
      setMissing(false);
    } catch (err) {
      if (isFeatureMissing(err)) setMissing(true);
      else setError(errText(err, "Tarama geçmişi yüklenemedi."));
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  async function scan(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setScanning(true);
    setError(null);
    try {
      const res = await runConflictCheck(query, context);
      setCurrent(res);
      await loadHistory();
    } catch (err) {
      if (isFeatureMissing(err)) setMissing(true);
      else setError(errText(err, "Tarama yapılamadı."));
    } finally {
      setScanning(false);
    }
  }

  async function openCheck(id: string) {
    try {
      setCurrent(await getConflictCheck(id));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      push(errText(err, "Tarama açılamadı."), "error");
    }
  }

  async function decide(decision: string, note: string) {
    if (!current) return;
    try {
      const res = await decideConflictCheck(current.id, decision, note);
      setCurrent(res);
      push("Karar kaydedildi ve denetim izine yazıldı.", "success");
      await loadHistory();
    } catch (err) {
      push(errText(err, "Karar kaydedilemedi."), "error");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Çakışma Kontrolü</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Yeni bir iş kabul etmeden önce adı büro geçmişinde tarayın: mevcut müvekkil,
          karşı taraf, eski müvekkil, bağlı şirket ve dosyalarda geçen taraflar
          karşılaştırılır. <strong>Sonuç bir uyarıdır; karar sizindir.</strong>
        </p>
      </div>

      {missing ? (
        <FeatureUnavailable
          title="Çakışma taraması henüz hazır değil"
          detail="Çatışma kontrolü uçları yayına alındığında bu ekran otomatik olarak çalışacak."
          onRetry={() => void loadHistory()}
        />
      ) : (
        <>
          {error && <ErrorBox message={error} />}

          <Card title="Yeni Tarama">
            <form onSubmit={scan} className="grid gap-4 sm:grid-cols-[2fr_2fr_auto] sm:items-end">
              <Field label="Ad / unvan">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Örn. XYZ Gıda San. ve Tic. A.Ş."
                  required
                />
              </Field>
              <Field label="Bağlam" hint="Sektör, dosya konusu ya da bilinen bağlantı (isteğe bağlı).">
                <Input
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  placeholder="Örn. gıda toptan ticareti"
                />
              </Field>
              <Button type="submit" variant="gold" disabled={scanning || query.trim().length < 3}>
                {scanning ? "Taranıyor…" : "Tara"}
              </Button>
            </form>
            <p className="mt-3 text-[11px] leading-5 text-slate-400">
              Tarama anlık verilerle çalışır ve o anın fotoğrafı olarak saklanır; aynı ad
              için yeni tarama yeni bir kayıt açar, eski rapor değişmez.
            </p>
          </Card>

          {current && (
            <ConflictResultCard check={current}>
              <DecisionForm check={current} onDecide={decide} />
            </ConflictResultCard>
          )}

          <Card title="Geçmiş Taramalar">
            {loadingHistory ? (
              <Spinner />
            ) : history.length === 0 ? (
              <EmptyState message="Henüz tarama kaydı yok." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                      <th className="py-2 pr-4 font-medium">Aranan ad</th>
                      <th className="py-2 pr-4 font-medium">Sonuç</th>
                      <th className="py-2 pr-4 font-medium">Bulgu</th>
                      <th className="py-2 pr-4 font-medium">Karar</th>
                      <th className="py-2 pr-4 font-medium">Tarih</th>
                      <th className="py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {history.map((c) => {
                      const result = String(c.result ?? "TEMIZ");
                      const decision = c.decision ? String(c.decision) : null;
                      return (
                        <tr key={c.id} className="hover:bg-slate-50">
                          <td className="py-3 pr-4 font-medium text-slate-900">{c.query}</td>
                          <td className="py-3 pr-4">
                            <Badge tone={CONFLICT_RESULT_TONES[result] ?? "gray"}>
                              {CONFLICT_RESULT_DOTS[result] ?? ""}{" "}
                              {labelOf(CONFLICT_RESULT_LABELS, result)}
                            </Badge>
                          </td>
                          <td className="py-3 pr-4 text-slate-600">
                            {c.hitCount ?? c.hits?.length ?? 0}
                          </td>
                          <td className="py-3 pr-4">
                            {decision ? (
                              <Badge tone={CONFLICT_DECISION_TONES[decision] ?? "gray"}>
                                {labelOf(CONFLICT_DECISION_LABELS, decision)}
                              </Badge>
                            ) : (
                              <span className="text-xs text-slate-400">Karar verilmedi</span>
                            )}
                          </td>
                          <td className="py-3 pr-4 text-slate-500">{fmtDateTime(c.createdAt)}</td>
                          <td className="py-3">
                            <Button size="sm" variant="secondary" onClick={() => void openCheck(c.id)}>
                              Aç
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

function DecisionForm({
  check,
  onDecide,
}: {
  check: ConflictCheck;
  onDecide: (decision: string, note: string) => Promise<void>;
}) {
  const [decision, setDecision] = useState<string>(String(check.decision ?? "DEVAM"));
  const [note, setNote] = useState(check.decisionNote ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDecision(String(check.decision ?? "DEVAM"));
    setNote(check.decisionNote ?? "");
  }, [check.id, check.decision, check.decisionNote]);

  const needsNote = decision === "REDDEDILDI" || String(check.result) === "CAKISMA";

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await onDecide(decision, note);
        setBusy(false);
      }}
      className="rounded-lg border border-white/60 bg-white px-4 py-3"
    >
      <p className="text-xs font-semibold text-slate-700">Kararınız</p>
      {check.decision && (
        <p className="mt-1 text-xs text-slate-500">
          Mevcut karar:{" "}
          <Badge tone={CONFLICT_DECISION_TONES[String(check.decision)] ?? "gray"}>
            {labelOf(CONFLICT_DECISION_LABELS, String(check.decision))}
          </Badge>
        </p>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,14rem)_1fr_auto] sm:items-end">
        <Field label="Karar">
          <Select value={decision} onChange={(e) => setDecision(e.target.value)}>
            {CONFLICT_DECISIONS.map((d) => (
              <option key={d} value={d}>
                {labelOf(CONFLICT_DECISION_LABELS, d)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Gerekçe"
          hint={needsNote ? "Bu kararda gerekçe zorunludur." : "İsteğe bağlı."}
        >
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Button type="submit" disabled={busy || (needsNote && note.trim().length < 10)}>
          {busy ? "Kaydediliyor…" : "Kararı Kaydet"}
        </Button>
      </div>
    </form>
  );
}
