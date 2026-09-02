"use client";

/**
 * Süre Oluşturma Sihirbazı — Faz 1'in en kritik UX akışı.
 *
 * 1. Kural seç (GET /deadline-rules)
 * 2. Tetik tarihi + tebligat yöntemi gir
 * 3. POST /deadlines/compute → ÖNİZLEME: son gün + adım adım hesap izi + uyarılar
 * 4. "Onayla ve Kaydet" → POST /deadlines/from-rule (source=KURAL, status=ONAYLANDI)
 *
 * Hesap izinin gösterilmesi zorunludur: avukat neye güvendiğini görmelidir.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, api, asList } from "@/lib/api";
import type { CaseSummary, DeadlineComputationResult, DeadlineRule } from "@/lib/types";
import type { ServiceMethod } from "@/lib/types";
import {
  Badge,
  Button,
  ErrorBox,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import { RemoteSelect } from "@/components/remote-select";
import {
  DURATION_UNIT_LABELS,
  SERVICE_METHODS,
  SERVICE_METHOD_LABELS,
  daysUntil,
  fmtDate,
  labelOf,
  remainingLabel,
  toIsoDate,
  urgencyTone,
} from "@/lib/labels";

export function DeadlineWizard({
  open,
  caseId,
  caseType,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** Dosya detayından açıldığında sabittir; süreler sayfasından açıldığında seçtirilir. */
  caseId?: string;
  caseType?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rules, setRules] = useState<DeadlineRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [rulesError, setRulesError] = useState<string | null>(null);

  const [pickedCaseLabel, setPickedCaseLabel] = useState("");
  const [pickedCaseType, setPickedCaseType] = useState<string | undefined>(undefined);
  const [pickedCaseId, setPickedCaseId] = useState("");
  const [ruleKey, setRuleKey] = useState("");
  const [triggerDate, setTriggerDate] = useState(toIsoDate(new Date()));
  const [serviceMethod, setServiceMethod] = useState<ServiceMethod>("POSTA");
  const [title, setTitle] = useState("");

  const [preview, setPreview] = useState<DeadlineComputationResult | null>(null);
  const [computing, setComputing] = useState(false);
  const [computeError, setComputeError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadRules = useCallback(async () => {
    setRulesLoading(true);
    setRulesError(null);
    try {
      const data = await api<unknown>("/deadline-rules");
      setRules(asList<DeadlineRule>(data).filter((r) => r.isActive !== false));
    } catch (err) {
      setRulesError(err instanceof ApiError ? err.message : "Süre kuralları yüklenemedi.");
    } finally {
      setRulesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setComputeError(null);
    setSaveError(null);
    setPickedCaseId(caseId ?? "");
    setPickedCaseLabel("");
    setPickedCaseType(undefined);
    void loadRules();
  }, [open, caseId, loadRules]);

  const effectiveCaseId = caseId ?? pickedCaseId;
  const effectiveCaseType = caseType ?? pickedCaseType;

  /**
   * Dosya türüne uyan kurallar önce; caseTypes boşsa kural tüm türler için geçerlidir.
   * İ-51: hiç tür eşleşmesi yoksa eskiden SESSİCE tüm kurallar listeleniyordu —
   * kullanıcı, dosyasına uymayan bir kuralı seçebiliyordu. Artık açıkça
   * işaretlenir.
   */
  const applicableRules = useMemo(() => {
    if (!effectiveCaseType) return { rules, widened: false };
    const matches = rules.filter(
      (r) => !r.caseTypes || r.caseTypes.length === 0 || r.caseTypes.includes(effectiveCaseType),
    );
    return matches.length > 0
      ? { rules: matches, widened: false }
      : { rules, widened: true };
  }, [rules, effectiveCaseType]);

  const selectedRule = useMemo(
    () => applicableRules.rules.find((r) => r.key === ruleKey) ?? null,
    [applicableRules, ruleKey],
  );

  function pickRule(key: string) {
    setRuleKey(key);
    setPreview(null);
    setComputeError(null);
    const rule = rules.find((r) => r.key === key);
    if (rule) setTitle(rule.name);
  }

  async function handleCompute(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!ruleKey || !effectiveCaseId) return;
    setComputing(true);
    setComputeError(null);
    setSaveError(null);
    try {
      const res = await api<DeadlineComputationResult>("/deadlines/compute", {
        method: "POST",
        body: { caseId: effectiveCaseId, ruleKey, triggerDate, serviceMethod },
      });
      setPreview(res);
    } catch (err) {
      setComputeError(err instanceof ApiError ? err.message : "Süre hesaplanamadı.");
    } finally {
      setComputing(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      await api("/deadlines/from-rule", {
        method: "POST",
        body: {
          caseId: effectiveCaseId,
          ruleKey,
          triggerDate,
          serviceMethod,
          title: title.trim() || selectedRule?.name || "Süre",
        },
      });
      onSaved();
      onClose();
      resetAll();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Süre kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  function resetAll() {
    setPickedCaseId(caseId ?? "");
    setRuleKey("");
    setTitle("");
    setPreview(null);
    setComputeError(null);
    setSaveError(null);
    setTriggerDate(toIsoDate(new Date()));
    setServiceMethod("POSTA");
  }

  const days = preview ? daysUntil(preview.dueDate) : 0;

  return (
    <Modal open={open} title="Kuraldan Süre Oluştur" onClose={onClose} wide>
      <form onSubmit={handleCompute} className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
          Hesap <strong>deterministik kural motorunda</strong> yapılır — yapay zekâ kullanılmaz.
          Tebligat yöntemi, resmî tatil ve adli tatil kaydırmaları aşağıdaki hesap izinde adım adım
          gösterilir. Adli tatil rejimi (HMK m.104 / İYUK m.8/3 / CMK m.331/4){" "}
          <strong>kuraldan gelir</strong> ve ayrıca bir karara gerek olmaksızın uygulanır.
        </div>

        {rulesLoading ? (
          <Spinner label="Kurallar yükleniyor…" />
        ) : rulesError ? (
          <ErrorBox message={rulesError} />
        ) : (
          <>
            {/*
              Dosya seçimi SUNUCUDA aranır (denetim bulguları K-15, K-16).
                                            denetim bulgusu K-15 · denetim bulgusu K-16
              Önceden `/cases?limit=200` ile tek atışta çekiliyordu; 201. dosya
              bu açılır listede HİÇ seçilemiyor, o dosya için kuraldan süre hiç
              oluşturulamıyordu.
            */}
            {!caseId && (
              <Field label="Dosya" hint="Başlık veya esas no yazarak arayın">
                <RemoteSelect<CaseSummary>
                  path="/cases"
                  value={pickedCaseId}
                  selectedLabel={pickedCaseLabel}
                  onChange={(id, opt, item) => {
                    setPickedCaseId(id);
                    setPickedCaseLabel(opt?.label ?? "");
                    // Dosya türü kural süzgecinde kullanılır; seçimle gelir.
                    setPickedCaseType(item?.type ?? undefined);
                    setPreview(null);
                  }}
                  toOption={(c) => ({ id: c.id, label: c.title, hint: c.fileNumber ?? undefined })}
                  placeholder="Dosya arayın…"
                  emptyMessage="Eşleşen dosya yok."
                  ariaLabel="Dosya ara ve seç"
                />
              </Field>
            )}

            <Field label="1. Süre kuralı" hint="Sistem kuralları mevzuat dayanağıyla gelir.">
              {applicableRules.widened && (
                <p className="mb-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-4 text-amber-800">
                  Bu dosya türüne özel süre kuralı bulunamadı; TÜM kurallar listeleniyor —
                  seçtiğiniz kuralın dosya türünüze uygunluğunu kendiniz doğrulayın.
                </p>
              )}
              <Select value={ruleKey} onChange={(e) => pickRule(e.target.value)} required>
                <option value="" disabled>
                  Kural seçin…
                </option>
                {applicableRules.rules.map((r) => (
                  <option key={r.id ?? r.key} value={r.key}>
                    {r.name} — {r.durationValue}{" "}
                    {labelOf(DURATION_UNIT_LABELS, r.durationUnit)} ({r.legalBasis})
                  </option>
                ))}
              </Select>
            </Field>

            {selectedRule && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-sm font-semibold text-amber-900">{selectedRule.name}</p>
                <p className="mt-1 text-xs text-amber-800">
                  Süre: {selectedRule.durationValue}{" "}
                  {labelOf(DURATION_UNIT_LABELS, selectedRule.durationUnit)} · Dayanak:{" "}
                  {selectedRule.legalBasis}
                </p>
                {selectedRule.description && (
                  <p className="mt-1 text-xs text-amber-800">{selectedRule.description}</p>
                )}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="2. Tetik tarihi" hint="Tebliğ / karar / olay tarihi">
                <Input
                  type="date"
                  value={triggerDate}
                  onChange={(e) => {
                    setTriggerDate(e.target.value);
                    setPreview(null);
                  }}
                  required
                />
              </Field>
              <Field label="Tebligat yöntemi" hint="E-tebligatta başlangıç günü kayabilir.">
                <Select
                  value={serviceMethod}
                  onChange={(e) => {
                    setServiceMethod(e.target.value as ServiceMethod);
                    setPreview(null);
                  }}
                >
                  {SERVICE_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {labelOf(SERVICE_METHOD_LABELS, m)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <Field label="Süre başlığı" hint="Listelerde bu başlıkla görünür.">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Örn. Cevap dilekçesi son günü"
              />
            </Field>

            {computeError && <ErrorBox message={computeError} />}

            <div className="flex justify-end">
              <Button type="submit" disabled={!ruleKey || !effectiveCaseId || computing}>
                {computing ? "Hesaplanıyor…" : "3. Hesapla ve Önizle"}
              </Button>
            </div>
          </>
        )}
      </form>

      {/* ---------- Önizleme: son gün + hesap izi ---------- */}
      {preview && (
        <div className="mt-6 space-y-4 border-t border-slate-200 pt-6">
          <div className="rounded-xl bg-slate-900 px-6 py-5 text-white">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Hesaplanan son gün
            </p>
            <p className="mt-1 text-3xl font-bold text-amber-400">{fmtDate(preview.dueDate)}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge tone={urgencyTone(days)}>{remainingLabel(days)}</Badge>
              {preview.legalBasis && (
                <span className="text-xs text-slate-300">Dayanak: {preview.legalBasis}</span>
              )}
            </div>
          </div>

          <div>
            <h4 className="mb-2 text-sm font-semibold text-slate-900">Hesap izi</h4>
            {preview.steps && preview.steps.length > 0 ? (
              <ol className="relative space-y-3 border-l border-slate-200 pl-5">
                {preview.steps.map((s, i) => (
                  <li key={i} className="relative">
                    <span className="absolute -left-[26px] top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-slate-900 text-[9px] font-bold text-amber-400">
                      {i + 1}
                    </span>
                    <p className="text-sm font-medium text-slate-900">{s.step}</p>
                    <p className="text-xs text-slate-500">
                      {fmtDate(s.date)} — {s.explanation}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-xs text-slate-500">Hesap izi dönmedi.</p>
            )}
          </div>

          {preview.warnings && preview.warnings.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
              <p className="text-xs font-semibold text-amber-900">Uyarılar</p>
              <ul className="mt-1 space-y-1">
                {preview.warnings.map((w, i) => (
                  <li key={i} className="text-xs text-amber-800">
                    • {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-lg bg-slate-50 px-4 py-3">
            <Field label="Kayıt notu (isteğe bağlı önizleme)">
              <Textarea
                rows={2}
                readOnly
                value={`Tetik: ${fmtDate(triggerDate)} · ${labelOf(
                  SERVICE_METHOD_LABELS,
                  serviceMethod,
                )} · Kural: ${ruleKey}`}
                className="bg-white text-xs"
              />
            </Field>
          </div>

          {saveError && <ErrorBox message={saveError} />}

          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setPreview(null)}>
              Girdileri Düzelt
            </Button>
            <Button variant="gold" disabled={saving} onClick={() => void handleSave()}>
              {saving ? "Kaydediliyor…" : "Onayla ve Kaydet"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
