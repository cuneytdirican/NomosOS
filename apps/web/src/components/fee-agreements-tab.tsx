"use client";

/**
 * Müvekkil kartı → Ücret Sözleşmeleri sekmesi (Modül 09).
 *
 * GET/POST /billing/fee-agreements
 * PATCH    /billing/fee-agreements/:id   (durum değişimi: aktifleştir / feshet)
 *
 * Form TİPE GÖRE değişir:
 *   SABIT / DOSYA_BAZLI / AYLIK_DANISMANLIK → tutar
 *   SAATLIK                                 → saatlik ücret
 *   BASARI_PRIMI                            → başarı oranı (%)
 *   KARMA                                   → tutar + saatlik + oran birlikte
 *
 * KDV: `vatRate` alanı SÖZLEŞMEDE tutulur ve varsayılanı %20'dir; oran koda
 * gömülmez, kullanıcı değiştirebilir ve faturalamada bu kayıttan okunur.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ApiError } from "@/lib/api";
import { RemoteSelect } from "@/components/remote-select";
import { errText, isMissingEndpoint } from "@/lib/faz2";
import {
  DEFAULT_VAT_RATE,
  createFeeAgreement,
  listFeeAgreements,
  updateFeeAgreement,
} from "@/lib/billing";
import type { AgreementStatus, FeeAgreement, FeeType } from "@/lib/faz3-types";
import type { CaseSummary } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import { FeatureUnavailable } from "@/components/ai-ui";
import { fmtAmount, fmtRate } from "@/lib/money";
import {
  AGREEMENT_STATUSES,
  AGREEMENT_STATUS_LABELS,
  AGREEMENT_STATUS_TONES,
  FEE_TYPES,
  FEE_TYPE_LABELS,
  fmtDate,
  labelOf,
  toIsoDate,
} from "@/lib/labels";

/** Hangi tipte hangi alanın DOLDURULACAĞI. */
function fieldsFor(type: FeeType): { amount: boolean; hourly: boolean; percent: boolean } {
  switch (type) {
    case "SAATLIK":
      return { amount: false, hourly: true, percent: false };
    case "BASARI_PRIMI":
      return { amount: false, hourly: false, percent: true };
    case "KARMA":
      return { amount: true, hourly: true, percent: true };
    default:
      return { amount: true, hourly: false, percent: false };
  }
}

export function FeeAgreementsTab({
  clientId,
  onNotify,
}: {
  clientId: string;
  onNotify?: (text: string, tone?: "success" | "error" | "info") => void;
}) {
  const [items, setItems] = useState<FeeAgreement[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listFeeAgreements({ clientId }));
      setMissing(false);
    } catch (err) {
      if (isMissingEndpoint(err)) {
        setMissing(true);
        setItems([]);
      } else {
        setError(errText(err, "Ücret sözleşmeleri yüklenemedi."));
      }
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeStatus(a: FeeAgreement, status: AgreementStatus) {
    setBusyId(a.id);
    try {
      await updateFeeAgreement(a.id, { status });
      onNotify?.(`Sözleşme durumu ${labelOf(AGREEMENT_STATUS_LABELS, status)} olarak güncellendi.`);
      await load();
    } catch (err) {
      onNotify?.(
        err instanceof ApiError ? err.message : "Sözleşme durumu güncellenemedi.",
        "error",
      );
    } finally {
      setBusyId(null);
    }
  }

  if (missing) {
    return (
      <FeatureUnavailable
        title="Faturalama modülü henüz yayında değil"
        detail="/api/v1/billing/fee-agreements yayına alındığında bu sekme dolacak."
        onRetry={() => void load()}
      />
    );
  }

  return (
    <Card
      title="Ücret Sözleşmeleri"
      action={
        <Button size="sm" variant="gold" onClick={() => setOpen(true)}>
          + Sözleşme Ekle
        </Button>
      }
    >
      {loading ? (
        <Spinner label="Sözleşmeler yükleniyor…" />
      ) : error ? (
        <ErrorBox message={error} />
      ) : items.length === 0 ? (
        <EmptyState message="Bu müvekkille yapılmış ücret sözleşmesi kaydı yok. Faturalama kuralları sözleşmeden türetilir." />
      ) : (
        <ul className="space-y-3">
          {items.map((a) => (
            <li key={a.id} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">
                      {labelOf(FEE_TYPE_LABELS, a.type)}
                    </span>
                    <Badge tone={AGREEMENT_STATUS_TONES[a.status] ?? "gray"}>
                      {labelOf(AGREEMENT_STATUS_LABELS, a.status)}
                    </Badge>
                    {a.case && (
                      <Link
                        href={`/app/dosyalar/${a.case.id}`}
                        className="text-xs text-slate-500 hover:text-amber-600"
                      >
                        {a.case.title}
                      </Link>
                    )}
                  </div>
                  <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                    {a.amount !== undefined && a.amount !== null && (
                      <span>Bedel: {fmtAmount(a.amount, a.currency ?? "TRY")}</span>
                    )}
                    {a.hourlyRate !== undefined && a.hourlyRate !== null && (
                      <span>Saatlik: {fmtAmount(a.hourlyRate, a.currency ?? "TRY")}</span>
                    )}
                    {a.successPercent !== undefined && a.successPercent !== null && (
                      <span>Başarı primi: {fmtRate(a.successPercent)}</span>
                    )}
                    <span>KDV: {fmtRate(a.vatRate)}</span>
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {fmtDate(a.startDate)} – {a.endDate ? fmtDate(a.endDate) : "süresiz"}
                  </p>
                  {a.terms && (
                    <p className="mt-1.5 whitespace-pre-wrap text-xs leading-5 text-slate-500">
                      {a.terms}
                    </p>
                  )}
                </div>
                <div className="w-40">
                  <Select
                    value={a.status}
                    disabled={busyId === a.id}
                    onChange={(e) => void changeStatus(a, e.target.value as AgreementStatus)}
                    aria-label="Sözleşme durumu"
                    className="!py-1 text-xs"
                  >
                    {AGREEMENT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {labelOf(AGREEMENT_STATUS_LABELS, s)}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <NewAgreementModal
        open={open}
        clientId={clientId}
        onClose={() => setOpen(false)}
        onCreated={() => {
          setOpen(false);
          onNotify?.("Ücret sözleşmesi kaydedildi.");
          void load();
        }}
      />
    </Card>
  );
}

// ---------- Sözleşme formu ----------

function NewAgreementModal({
  open,
  clientId,
  onClose,
  onCreated,
}: {
  open: boolean;
  clientId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [caseLabel, setCaseLabel] = useState("");
  const [form, setForm] = useState({
    type: "SAATLIK" as FeeType,
    caseId: "",
    amount: "",
    hourlyRate: "",
    successPercent: "",
    vatRate: DEFAULT_VAT_RATE,
    startDate: toIsoDate(new Date()),
    endDate: "",
    terms: "",
    status: "TASLAK" as AgreementStatus,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setCaseLabel("");
  }, [open, clientId]);

  const show = fieldsFor(form.type);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createFeeAgreement({
        clientId,
        caseId: form.caseId || undefined,
        type: form.type,
        // Tipe uymayan alanlar GÖNDERİLMEZ: sunucu doğrulaması bunları reddeder
        // ve gönderilse bile kayıt yanıltıcı olurdu.
        amount: show.amount && form.amount.trim() ? form.amount.trim().replace(",", ".") : undefined,
        hourlyRate:
          show.hourly && form.hourlyRate.trim()
            ? form.hourlyRate.trim().replace(",", ".")
            : undefined,
        successPercent:
          show.percent && form.successPercent.trim()
            ? form.successPercent.trim().replace(",", ".")
            : undefined,
        vatRate: form.vatRate.trim() ? form.vatRate.trim().replace(",", ".") : undefined,
        startDate: form.startDate,
        endDate: form.endDate || undefined,
        terms: form.terms.trim() || undefined,
        status: form.status,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sözleşme kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} title="Yeni Ücret Sözleşmesi" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Sözleşme tipi" hint="Seçime göre aşağıdaki alanlar değişir.">
            <Select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as FeeType })}
            >
              {FEE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {labelOf(FEE_TYPE_LABELS, t)}
                </option>
              ))}
            </Select>
          </Field>
          {/*
            Dosya SUNUCUDA aranır (denetim bulguları K-15, K-16). Önceden
            `/cases?clientId=…&limit=200` ile tek atışta çekiliyordu; 201.
            dosya bu açılır listede HİÇ seçilemiyordu.
          */}
          <Field label="Dosya (isteğe bağlı)">
            <RemoteSelect<CaseSummary>
              path="/cases"
              query={{ clientId }}
              value={form.caseId}
              selectedLabel={caseLabel}
              onChange={(id, opt) => {
                setForm({ ...form, caseId: id });
                setCaseLabel(opt?.label ?? "");
              }}
              toOption={(c) => ({ id: c.id, label: c.title, hint: c.fileNumber ?? undefined })}
              placeholder="Müvekkil geneli — aramak için yazın…"
              emptyMessage="Eşleşen dosya yok."
              ariaLabel="Dosya ara ve seç"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {show.amount && (
            <Field
              label={form.type === "AYLIK_DANISMANLIK" ? "Aylık bedel (₺)" : "Sözleşme bedeli (₺)"}
            >
              <Input
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </Field>
          )}
          {show.hourly && (
            <Field label="Saatlik ücret (₺)">
              <Input
                inputMode="decimal"
                value={form.hourlyRate}
                onChange={(e) => setForm({ ...form, hourlyRate: e.target.value })}
                placeholder="4500.00"
              />
            </Field>
          )}
          {show.percent && (
            <Field label="Başarı primi oranı (%)">
              <Input
                inputMode="decimal"
                value={form.successPercent}
                onChange={(e) => setForm({ ...form, successPercent: e.target.value })}
                placeholder="10.00"
              />
            </Field>
          )}
          <Field
            label="KDV oranı (%)"
            hint="Kayıttan okunur; koda gömülü değildir."
          >
            <Input
              inputMode="decimal"
              value={form.vatRate}
              onChange={(e) => setForm({ ...form, vatRate: e.target.value })}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Başlangıç">
            <Input
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              required
            />
          </Field>
          <Field label="Bitiş" hint="Boş = süresiz">
            <Input
              type="date"
              value={form.endDate}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })}
            />
          </Field>
          <Field label="Durum">
            <Select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as AgreementStatus })}
            >
              {AGREEMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {labelOf(AGREEMENT_STATUS_LABELS, s)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Sözleşme şartları / notlar">
          <Textarea
            rows={3}
            value={form.terms}
            onChange={(e) => setForm({ ...form, terms: e.target.value })}
          />
        </Field>

        {error && <ErrorBox message={error} />}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
