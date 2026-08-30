"use client";

/**
 * Dosya detayı → BİLİRKİŞİ sekmesi (Modül 13).
 *
 * İçerik:
 *  - rapor listesi (kök / ek / uzman mütalaası) ve tebliğ tarihi girişi,
 *  - tebliğ tarihi girilince SÜRE ÖNERİSİ kartı,
 *  - iki raporu seçip AI ile "Karşılaştır" → madde madde fark tablosu
 *    (her farkta iki rapordan alıntı),
 *  - "İtiraz dilekçesi taslağı oluştur" → taslak metin, avukat düzenleyip kaydeder.
 *
 * SÜRE HESABI TARAYICIDA YAPILMAZ. İtiraz süresi deterministik süre motorunun
 * işidir; bu ekran yalnızca sunucudan gelen öneriyi gösterir ve avukatı süre
 * sihirbazına yönlendirir. (Ekranda gün saymak, motorun tatil/adli tatil
 * kurallarını sessizce atlamak olurdu.)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Disclosure,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import { AiDisclaimer, FeatureUnavailable, PiiApprovalBox } from "@/components/ai-ui";
import { errText, isFeatureMissing } from "@/lib/faz2";
import {
  DIFF_DIRECTION_LABELS,
  DIFF_DIRECTION_TONES,
  EXPERT_REPORT_TYPES,
  EXPERT_REPORT_TYPE_LABELS,
  EXPERT_REPORT_TYPE_TONES,
  OBJECTION_STATUS_LABELS,
  OBJECTION_STATUS_TONES,
  fmtDate,
  labelOf,
  toIsoDate,
} from "@/lib/labels";
import {
  compareExpertReports,
  createExpertReport,
  draftExpertObjection,
  expertDiffItems,
  listExpertReports,
  listExperts,
  objectionDraftText,
  saveExpertObjection,
  setExpertReportServedAt,
} from "../_lib/faz4";
import type {
  DeadlineSuggestion,
  Expert,
  ExpertReport,
  ExpertReportDiff,
  ObjectionDraft,
} from "../_lib/faz4-types";
import { useAiCall } from "../_lib/use-ai-call";

type Notify = (text: string, tone?: "success" | "error" | "info") => void;

export function ExpertTab({
  caseId,
  onNotify,
  onOpenDeadlineWizard,
}: {
  caseId: string;
  onNotify: Notify;
  /** Süre sihirbazını açar (süre kaydını avukat oluşturur). */
  onOpenDeadlineWizard?: () => void;
}) {
  const [reports, setReports] = useState<ExpertReport[]>([]);
  const [experts, setExperts] = useState<Expert[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const [baseId, setBaseId] = useState("");
  const [compareId, setCompareId] = useState("");
  const [suggestion, setSuggestion] = useState<{
    reportId: string;
    value: DeadlineSuggestion | null;
  } | null>(null);
  const [draftReport, setDraftReport] = useState<ExpertReport | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMissing(false);
    try {
      const list = await listExpertReports(caseId);
      setReports(list);
    } catch (err) {
      if (isFeatureMissing(err)) setMissing(true);
      else setError(errText(err, "Bilirkişi raporları yüklenemedi."));
      setReports([]);
    } finally {
      setLoading(false);
    }
    // Bilirkişi dizini opsiyoneldir; yoksa rapor kaydı elle isim olmadan da açılır.
    listExperts()
      .then(setExperts)
      .catch(() => setExperts([]));
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(
    () => [...reports].sort((a, b) => (a.receivedAt < b.receivedAt ? -1 : 1)),
    [reports],
  );

  // ---- AI: rapor karşılaştırma
  const compareFn = useCallback(
    (piiApproved: boolean) => compareExpertReports(caseId, baseId, compareId, piiApproved),
    [caseId, baseId, compareId],
  );
  const compareAi = useAiCall<ExpertReportDiff>(compareFn, "Raporlar karşılaştırılamadı.");

  const diffRows = useMemo(() => expertDiffItems(compareAi.data), [compareAi.data]);

  async function handleServedAt(report: ExpertReport, value: string) {
    try {
      const res = await setExpertReportServedAt(report.id, new Date(value).toISOString());
      onNotify("Tebliğ tarihi kaydedildi.", "success");
      setSuggestion({ reportId: report.id, value: res.deadlineSuggestion ?? null });
      await load();
    } catch (err) {
      onNotify(errText(err, "Tebliğ tarihi kaydedilemedi."), "error");
    }
  }

  if (loading) return <Spinner label="Bilirkişi süreci yükleniyor…" />;
  if (missing) {
    return (
      <FeatureUnavailable
        title="Bilirkişi modülü henüz hazır değil"
        detail="Bilirkişi rapor uçları yayına alındığında bu ekran otomatik olarak çalışacak."
        onRetry={() => void load()}
      />
    );
  }

  return (
    <div className="space-y-6">
      {error && <ErrorBox message={error} />}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3.5">
        <p className="max-w-xl text-xs leading-5 text-slate-600">
          Bilirkişi raporları, tebliğ tarihleri ve itirazlar. Tebliğ tarihi girildiğinde
          itiraz süresi <strong>öneri</strong> olarak gösterilir; süre kaydını süre
          motorundan siz oluşturursunuz.
        </p>
        <Button size="sm" variant="gold" onClick={() => setFormOpen(true)}>
          + Rapor Kaydet
        </Button>
      </div>

      {/* ---------- Rapor listesi ---------- */}
      <Card title={`Raporlar (${sorted.length})`}>
        {sorted.length === 0 ? (
          <EmptyState message="Bu dosyada bilirkişi raporu kaydı yok." />
        ) : (
          <ol className="relative space-y-4 border-l border-slate-200 pl-5">
            {sorted.map((r) => (
              <li key={r.id} className="relative">
                <span className="absolute -left-[26px] top-2 h-2.5 w-2.5 rounded-full bg-amber-500" />
                <div className="rounded-lg border border-slate-200 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                        <Badge tone={EXPERT_REPORT_TYPE_TONES[r.reportType] ?? "gray"}>
                          {labelOf(EXPERT_REPORT_TYPE_LABELS, r.reportType)}
                        </Badge>
                        {r.expert?.fullName ?? "Bilirkişi belirtilmedi"}
                        {r.expert?.specialty ? (
                          <span className="text-xs font-normal text-slate-500">
                            · {r.expert.specialty}
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Rapor tarihi: {fmtDate(r.receivedAt)} · Tebliğ:{" "}
                        {r.servedAt ? fmtDate(r.servedAt) : "girilmedi"}
                      </p>
                      {r.summary && (
                        <p className="mt-2 text-xs leading-5 text-slate-600">{r.summary}</p>
                      )}
                      {r.conclusionText && (
                        <Disclosure summary="Sonuç bölümü" className="mt-2">
                          <p className="whitespace-pre-wrap text-xs leading-5 text-slate-700">
                            {r.conclusionText}
                          </p>
                        </Disclosure>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      {!r.servedAt && (
                        <label className="text-right text-[11px] text-slate-500">
                          Tebliğ tarihi
                          <Input
                            type="date"
                            max={toIsoDate(new Date())}
                            onChange={(e) => {
                              if (e.target.value) void handleServedAt(r, e.target.value);
                            }}
                            className="mt-1 w-40"
                          />
                        </label>
                      )}
                      <Button size="sm" variant="secondary" onClick={() => setDraftReport(r)}>
                        İtiraz taslağı üret
                      </Button>
                    </div>
                  </div>

                  {(r.objections ?? []).length > 0 && (
                    <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3">
                      {(r.objections ?? []).map((o) => (
                        <li key={o.id} className="flex items-start gap-2 text-xs text-slate-600">
                          <Badge tone={OBJECTION_STATUS_TONES[o.status] ?? "gray"}>
                            {labelOf(OBJECTION_STATUS_LABELS, o.status)}
                          </Badge>
                          <span className="min-w-0 flex-1 whitespace-pre-wrap">{o.points}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {suggestion?.reportId === r.id && (
                    <DeadlineSuggestionCard
                      suggestion={suggestion.value}
                      onOpenWizard={onOpenDeadlineWizard}
                      onDismiss={() => setSuggestion(null)}
                    />
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {/* ---------- Karşılaştırma ---------- */}
      {sorted.length >= 2 && (
        <Card title="Rapor Karşılaştırma">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label="Temel rapor">
              <Select value={baseId} onChange={(e) => setBaseId(e.target.value)}>
                <option value="">Seçin…</option>
                {sorted.map((r) => (
                  <option key={r.id} value={r.id}>
                    {labelOf(EXPERT_REPORT_TYPE_LABELS, r.reportType)} · {fmtDate(r.receivedAt)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Karşılaştırılacak rapor">
              <Select value={compareId} onChange={(e) => setCompareId(e.target.value)}>
                <option value="">Seçin…</option>
                {sorted.map((r) => (
                  <option key={r.id} value={r.id}>
                    {labelOf(EXPERT_REPORT_TYPE_LABELS, r.reportType)} · {fmtDate(r.receivedAt)}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              variant="gold"
              disabled={compareAi.busy || !baseId || !compareId || baseId === compareId}
              onClick={() => void compareAi.run()}
            >
              {compareAi.busy ? "Karşılaştırılıyor…" : "Karşılaştır"}
            </Button>
          </div>

          {baseId !== "" && baseId === compareId && (
            <p className="mt-2 text-xs text-red-600">İki farklı rapor seçmelisiniz.</p>
          )}

          <div className="mt-4 space-y-3">
            {compareAi.pii && (
              <PiiApprovalBox
                prompt={compareAi.pii}
                busy={compareAi.busy}
                onApprove={() => void compareAi.approvePii()}
                onCancel={compareAi.cancelPii}
              />
            )}
            {compareAi.missing && (
              <FeatureUnavailable detail="Rapor karşılaştırma ucu henüz yayında değil." />
            )}
            {compareAi.error && !compareAi.missing && <ErrorBox message={compareAi.error} />}

            {diffRows.length > 0 && (
              <>
                <AiDisclaimer text="Fark tablosu bir AI ÖNERİSİDİR. Her satırdaki alıntıyı raporun kendisinden doğrulayın." />
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                        <th className="py-2 pr-4 font-medium">Konu</th>
                        <th className="py-2 pr-4 font-medium">Temel rapor</th>
                        <th className="py-2 pr-4 font-medium">Karşılaştırılan rapor</th>
                        <th className="py-2 font-medium">Değişim</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 align-top">
                      {diffRows.map((row, i) => (
                        <tr key={i}>
                          <td className="py-3 pr-4 font-medium text-slate-900">
                            {row.topic ?? "—"}
                          </td>
                          <td className="py-3 pr-4 text-slate-700">
                            <p className="text-xs leading-5">{row.baseFinding ?? "—"}</p>
                            {row.baseQuote && (
                              <blockquote className="mt-1 border-l-2 border-slate-300 pl-2 text-[11px] italic leading-5 text-slate-500">
                                “{row.baseQuote}”
                              </blockquote>
                            )}
                          </td>
                          <td className="py-3 pr-4 text-slate-700">
                            <p className="text-xs leading-5">{row.compareFinding ?? "—"}</p>
                            {row.compareQuote && (
                              <blockquote className="mt-1 border-l-2 border-slate-300 pl-2 text-[11px] italic leading-5 text-slate-500">
                                “{row.compareQuote}”
                              </blockquote>
                            )}
                          </td>
                          <td className="py-3">
                            {row.direction ? (
                              <Badge
                                tone={
                                  DIFF_DIRECTION_TONES[String(row.direction).toUpperCase()] ??
                                  "gray"
                                }
                              >
                                {labelOf(
                                  DIFF_DIRECTION_LABELS,
                                  String(row.direction).toUpperCase(),
                                )}
                              </Badge>
                            ) : (
                              "—"
                            )}
                            {row.note && (
                              <p className="mt-1 text-[11px] text-slate-500">{row.note}</p>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {compareAi.data && diffRows.length === 0 && !compareAi.busy && (
              <EmptyState message="AI iki rapor arasında maddeleştirilebilir fark bulamadı." />
            )}
          </div>
        </Card>
      )}

      <ReportFormModal
        open={formOpen}
        caseId={caseId}
        experts={experts}
        onClose={() => setFormOpen(false)}
        onSaved={async () => {
          setFormOpen(false);
          onNotify("Bilirkişi raporu kaydedildi.", "success");
          await load();
        }}
      />

      <ObjectionDraftModal
        report={draftReport}
        onClose={() => setDraftReport(null)}
        onSaved={async () => {
          setDraftReport(null);
          onNotify("İtiraz noktaları taslak olarak kaydedildi.", "success");
          await load();
        }}
        onNotify={onNotify}
      />
    </div>
  );
}

// -------------------------------------------------------- süre öneri kartı

function DeadlineSuggestionCard({
  suggestion,
  onOpenWizard,
  onDismiss,
}: {
  suggestion: DeadlineSuggestion | null;
  onOpenWizard?: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
      <p className="text-sm font-semibold text-amber-900">İtiraz süresi önerisi</p>
      {suggestion?.dueDate ? (
        <p className="mt-1 text-xs leading-5 text-amber-900">
          {suggestion.title ?? "Bilirkişi raporuna itiraz"} —{" "}
          <strong>{fmtDate(suggestion.dueDate)}</strong>
          {suggestion.legalBasis ? ` · ${suggestion.legalBasis}` : ""}
        </p>
      ) : (
        <p className="mt-1 text-xs leading-5 text-amber-900">
          Tebliğ tarihi kaydedildi. İtiraz süresi <strong>otomatik oluşmaz</strong>: hesabı
          süre motorundan yaptırıp kaydı onaylamanız gerekir.
        </p>
      )}
      {suggestion?.note && (
        <p className="mt-1 text-[11px] text-amber-800">{suggestion.note}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {onOpenWizard && (
          <Button size="sm" variant="gold" onClick={onOpenWizard}>
            Kuraldan süre oluştur
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={onDismiss}>
          Kapat
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ modallar

function ReportFormModal({
  open,
  caseId,
  experts,
  onClose,
  onSaved,
}: {
  open: boolean;
  caseId: string;
  experts: Expert[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [form, setForm] = useState({
    reportType: "ASIL",
    expertId: "",
    receivedAt: toIsoDate(new Date()),
    servedAt: "",
    summary: "",
    conclusionText: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm({
      reportType: "ASIL",
      expertId: "",
      receivedAt: toIsoDate(new Date()),
      servedAt: "",
      summary: "",
      conclusionText: "",
    });
    setError(null);
  }, [open]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createExpertReport(caseId, {
        reportType: form.reportType,
        expertId: form.expertId || undefined,
        receivedAt: new Date(form.receivedAt).toISOString(),
        servedAt: form.servedAt ? new Date(form.servedAt).toISOString() : undefined,
        summary: form.summary.trim() || undefined,
        conclusionText: form.conclusionText.trim() || undefined,
      });
      await onSaved();
    } catch (err) {
      setError(errText(err, "Rapor kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="Bilirkişi Raporu Kaydet" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Rapor türü">
            <Select
              value={form.reportType}
              onChange={(e) => setForm({ ...form, reportType: e.target.value })}
            >
              {EXPERT_REPORT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {labelOf(EXPERT_REPORT_TYPE_LABELS, t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Bilirkişi" hint={experts.length === 0 ? "Dizin boş — sonra bağlanabilir." : undefined}>
            <Select
              value={form.expertId}
              onChange={(e) => setForm({ ...form, expertId: e.target.value })}
            >
              <option value="">Belirtilmedi</option>
              {experts.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.fullName}
                  {x.specialty ? ` · ${x.specialty}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Rapor tarihi">
            <Input
              type="date"
              value={form.receivedAt}
              onChange={(e) => setForm({ ...form, receivedAt: e.target.value })}
              required
            />
          </Field>
          <Field label="Tebliğ tarihi" hint="Sonra da girebilirsiniz.">
            <Input
              type="date"
              value={form.servedAt}
              onChange={(e) => setForm({ ...form, servedAt: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Özet">
          <Textarea
            rows={3}
            value={form.summary}
            onChange={(e) => setForm({ ...form, summary: e.target.value })}
          />
        </Field>
        <Field label="Sonuç bölümü">
          <Textarea
            rows={4}
            value={form.conclusionText}
            onChange={(e) => setForm({ ...form, conclusionText: e.target.value })}
            placeholder="Raporun sonuç ve kanaat kısmı"
          />
        </Field>
        {error && <ErrorBox message={error} />}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ObjectionDraftModal({
  report,
  onClose,
  onSaved,
  onNotify,
}: {
  report: ExpertReport | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  onNotify: Notify;
}) {
  const [instruction, setInstruction] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const reportId = report?.id ?? "";

  const draftFn = useCallback(
    (piiApproved: boolean) => draftExpertObjection(reportId, instruction, piiApproved),
    [reportId, instruction],
  );
  const draftAi = useAiCall<ObjectionDraft>(draftFn, "İtiraz taslağı üretilemedi.");

  useEffect(() => {
    if (!report) return;
    setInstruction("");
    setText("");
    draftAi.reset();
    // draftAi kimliği her render'da değişmez (useCallback + useState); rapor
    // değiştiğinde durumu sıfırlamak yeterlidir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.id]);

  async function generate() {
    const res = await draftAi.run();
    if (res) setText(objectionDraftText(res));
  }

  async function approvePii() {
    const res = await draftAi.approvePii();
    if (res) setText(objectionDraftText(res));
  }

  async function save() {
    if (!report) return;
    setSaving(true);
    try {
      await saveExpertObjection(report.id, text);
      await onSaved();
    } catch (err) {
      onNotify(errText(err, "İtiraz kaydedilemedi."), "error");
    } finally {
      setSaving(false);
    }
  }

  if (!report) return null;

  return (
    <Modal open title="İtiraz Dilekçesi Taslağı" onClose={onClose} wide>
      <div className="space-y-4">
        <p className="rounded-lg bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
          {labelOf(EXPERT_REPORT_TYPE_LABELS, report.reportType)} · Rapor tarihi{" "}
          {fmtDate(report.receivedAt)}
          {report.servedAt ? ` · Tebliğ ${fmtDate(report.servedAt)}` : ""}
        </p>

        <Field label="Ek talimat" hint="Örn. 'hesaplama yöntemine ve veri setine odaklan'">
          <Input value={instruction} onChange={(e) => setInstruction(e.target.value)} />
        </Field>

        {draftAi.pii ? (
          <PiiApprovalBox
            prompt={draftAi.pii}
            busy={draftAi.busy}
            onApprove={() => void approvePii()}
            onCancel={draftAi.cancelPii}
          />
        ) : draftAi.missing ? (
          <FeatureUnavailable detail="İtiraz taslağı ucu henüz yayında değil." />
        ) : (
          <>
            {draftAi.error && <ErrorBox message={draftAi.error} />}
            <Button variant="gold" disabled={draftAi.busy} onClick={() => void generate()}>
              {draftAi.busy ? "Taslak üretiliyor…" : "AI ile taslak üret"}
            </Button>
          </>
        )}

        {(text || draftAi.data) && (
          <>
            <AiDisclaimer text="Taslak bir ÖNERİDİR: itiraz noktalarını rapordan doğrulayın, atıfları teyit ettirmeden dilekçeye aktarmayın." />
            {(draftAi.data?.warnings ?? []).length > 0 && (
              <ul className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                {(draftAi.data?.warnings ?? []).map((w, i) => (
                  <li key={i}>• {w}</li>
                ))}
              </ul>
            )}
            <Field label="İtiraz noktaları">
              <Textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
          </>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Kapat
          </Button>
          <Button disabled={saving || !text.trim()} onClick={() => void save()}>
            {saving ? "Kaydediliyor…" : "Taslak olarak kaydet"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
