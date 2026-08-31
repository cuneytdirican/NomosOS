"use client";

/**
 * Fatura detayı — Modül 09.
 *
 * GET  /billing/invoices/:id                — künye, satırlar, ödemeler
 * POST /billing/invoices/:id/finalize       — KESİNLEŞTİR (numara sunucuda atanır)
 * POST /billing/invoices/:id/e-invoice/send — e-Fatura (entegratör yoksa bilgilendirir)
 * POST /billing/invoices/:id/cancel         — iptal
 * POST /billing/payments                    — ödeme kaydı (clientId + invoiceId gövdede)
 *
 * PDF DÜĞMESİ YOKTUR: `/billing/invoices/:id/pdf` ucu API'de bulunmuyor ve
 * düğme 404 alıyordu (denetim bulgusu 12). Olmayan bir yeteneği düğme olarak
 * göstermek, kullanıcıya yanlış beyanda bulunmaktır — uç açıldığında geri gelir.
 *
 * PARA: satır tutarları, ara toplam, KDV ve genel toplam SUNUCUDAN gelir ve
 * OLDUĞU GİBİ basılır. Kalan bakiye sunucu göndermezse tamsayı kuruş
 * aritmetiğiyle "ödemeler toplamı" gösterilir ve ayrıca işaretlenir.
 */

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ApiError } from "@/lib/api";
import { errText, isMissingEndpoint } from "@/lib/faz2";
import {
  approveInvoice,
  cancelInvoice,
  createInvoicePayment,
  getInvoice,
  linesOf,
  sendInvoice,
} from "@/lib/billing";
import type { EInvoiceSendResult, Invoice } from "@/lib/faz3-types";
import {
  Badge,
  Button,
  Card,
  DataRow,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  SuccessBox,
  Textarea,
} from "@/components/ui";
import { FeatureUnavailable, ToastStack, useToasts } from "@/components/ai-ui";
import { fmtAmount, fmtKurus, fmtRate, sumKurus, toKurus } from "@/lib/money";
import {
  E_INVOICE_STATUS_LABELS,
  E_INVOICE_STATUS_TONES,
  INVOICE_LINE_SOURCE_LABELS,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_TONES,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  fmtDate,
  labelOf,
  toIsoDate,
} from "@/lib/labels";

export default function FaturaDetayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<EInvoiceSendResult | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const { toasts, push, dismiss } = useToasts();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setInvoice(await getInvoice(id));
      setMissing(false);
    } catch (err) {
      if (isMissingEndpoint(err)) setMissing(true);
      else setError(errText(err, "Fatura yüklenemedi."));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const lines = linesOf(invoice);
  const payments = useMemo(() => invoice?.payments ?? [], [invoice]);
  const currency = invoice?.currency ?? "TRY";

  /**
   * Kalan bakiye. Sunucu `remaining` gönderdiyse O KULLANILIR. Göndermediyse
   * ödemeleri toplayıp toplamdan düşeriz — tamsayı kuruş aritmetiğiyle — ve
   * bunu ekranda "arayüz hesabı" olarak İŞARETLERİZ.
   */
  const remaining = useMemo(() => {
    if (!invoice) return { value: null as bigint | null, serverProvided: false };
    const server = toKurus(invoice.remaining);
    if (server !== null) return { value: server, serverProvided: true };
    const total = toKurus(invoice.total);
    if (total === null) return { value: null, serverProvided: false };
    const paid = toKurus(invoice.paidTotal) ?? sumKurus(payments.map((p) => p.amount));
    return { value: total - paid, serverProvided: false };
  }, [invoice, payments]);

  async function act(key: string, fn: () => Promise<unknown>, okText: string) {
    setBusy(key);
    try {
      await fn();
      push(okText);
      await load();
    } catch (err) {
      push(err instanceof ApiError ? err.message : "İşlem başarısız oldu.", "error");
    } finally {
      setBusy(null);
    }
  }

  async function handleSend() {
    setBusy("send");
    setSendResult(null);
    try {
      const res = await sendInvoice(id);
      setSendResult(res);
      await load();
    } catch (err) {
      push(err instanceof ApiError ? err.message : "e-Fatura gönderilemedi.", "error");
    } finally {
      setBusy(null);
    }
  }

  if (missing) {
    return (
      <FeatureUnavailable
        title="Faturalama modülü henüz yayında değil"
        detail="/api/v1/billing/invoices yayına alındığında bu ekran otomatik çalışacak."
        onRetry={() => void load()}
      />
    );
  }
  if (loading) return <Spinner label="Fatura yükleniyor…" />;
  if (error) return <ErrorBox message={error} />;
  if (!invoice) return <EmptyState message="Fatura bulunamadı." />;

  const isDraft = invoice.status === "TASLAK";
  const canPay = invoice.status !== "TASLAK" && invoice.status !== "IPTAL";

  return (
    <div className="space-y-6">
      <Link href="/app/faturalar" className="text-xs text-slate-500 hover:text-amber-600">
        ← Faturalar
      </Link>

      <div className="rounded-xl border border-slate-200 bg-slate-900 p-6 text-white">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-bold">
                {invoice.invoiceNo ?? "Numarasız Taslak"}
              </h1>
              <Badge tone={INVOICE_STATUS_TONES[invoice.status] ?? "gray"}>
                {labelOf(INVOICE_STATUS_LABELS, invoice.status)}
              </Badge>
              <Badge tone={E_INVOICE_STATUS_TONES[invoice.eInvoiceStatus ?? "YOK"] ?? "gray"}>
                {labelOf(E_INVOICE_STATUS_LABELS, invoice.eInvoiceStatus ?? "YOK")}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-slate-300">
              {invoice.client ? (
                <Link
                  href={`/app/muvekkiller/${invoice.client.id}`}
                  className="hover:text-amber-400"
                >
                  {invoice.client.name}
                </Link>
              ) : (
                "—"
              )}
              {invoice.client?.taxNumber ? ` · VKN ${invoice.client.taxNumber}` : ""}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Düzenleme: {fmtDate(invoice.issueDate)}
              {invoice.dueDate ? ` · Vade: ${fmtDate(invoice.dueDate)}` : ""}
              {invoice.eInvoiceUuid ? ` · UUID: ${invoice.eInvoiceUuid}` : ""}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-slate-500">Genel Toplam</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {fmtAmount(invoice.total, currency)}
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          {isDraft && (
            <Button
              size="sm"
              variant="gold"
              disabled={busy !== null}
              onClick={() =>
                void act("approve", () => approveInvoice(id), "Fatura kesinleştirildi; numara atandı.")
              }
            >
              {busy === "approve" ? "Kesinleştiriliyor…" : "Kesinleştir"}
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            disabled={busy !== null || isDraft}
            onClick={() => void handleSend()}
          >
            {busy === "send" ? "Gönderiliyor…" : "e-Fatura Gönder"}
          </Button>
          {canPay && (
            <Button size="sm" variant="secondary" onClick={() => setPaymentOpen(true)}>
              Ödeme Kaydet
            </Button>
          )}
          {invoice.status !== "IPTAL" && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => {
                const reason = window.prompt("İptal gerekçesi:");
                if (reason && reason.trim()) {
                  void act("cancel", () => cancelInvoice(id, reason.trim()), "Fatura iptal edildi.");
                }
              }}
              className="text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              İptal Et
            </Button>
          )}
        </div>
      </div>

      {/* e-Fatura gönderim sonucu — sahte "gönderildi" GÖSTERİLMEZ. */}
      {sendResult && (
        <div
          className={`rounded-xl border px-5 py-4 ${
            sendResult.configured === false
              ? "border-amber-300 bg-amber-50"
              : "border-slate-200 bg-white"
          }`}
        >
          <p className="text-sm font-semibold text-slate-900">
            {sendResult.configured === false
              ? "e-Fatura entegratörü yapılandırılmamış"
              : "e-Fatura gönderim sonucu"}
          </p>
          <p className="mt-1.5 text-xs leading-5 text-slate-600">
            {sendResult.message ??
              (sendResult.configured === false
                ? "Bu kurulumda GİB'e bağlanan bir özel entegratör tanımlı değildir; fatura TASLAK durumunda bırakıldı ve hiçbir belge gönderilmedi. Entegratör hesabı tanımlanana kadar faturayı GİB portalı üzerinden düzenlemeniz gerekir."
                : "Sunucu bir açıklama döndürmedi.")}
          </p>
          {sendResult.adapter && (
            <p className="mt-1 text-[11px] text-slate-500">Adaptör: {sendResult.adapter}</p>
          )}
          {sendResult.warnings?.map((w, i) => (
            <p key={i} className="mt-1 text-[11px] text-amber-800">
              {w}
            </p>
          ))}
        </div>
      )}

      {/* Satırlar */}
      <Card title="Fatura Satırları">
        {lines.length === 0 ? (
          <EmptyState message="Bu faturada satır yok." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-4 font-medium">Açıklama</th>
                  <th className="py-2 pr-4 font-medium">Kaynak</th>
                  <th className="py-2 pr-4 text-right font-medium">Miktar</th>
                  <th className="py-2 pr-4 text-right font-medium">Birim Fiyat</th>
                  <th className="py-2 pr-4 text-right font-medium">KDV</th>
                  <th className="py-2 text-right font-medium">Satır Tutarı</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((l, i) => (
                  <tr key={l.id ?? i}>
                    <td className="py-3 pr-4 text-slate-800">{l.description}</td>
                    <td className="py-3 pr-4">
                      {l.sourceType ? (
                        <Badge tone="gray">
                          {labelOf(INVOICE_LINE_SOURCE_LABELS, l.sourceType)}
                        </Badge>
                      ) : (
                        <span className="text-xs text-slate-500">—</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-right tabular-nums text-slate-600">
                      {fmtKurus(toKurus(l.quantity), "")}
                    </td>
                    <td className="py-3 pr-4 text-right tabular-nums text-slate-700">
                      {fmtAmount(l.unitPrice, currency)}
                    </td>
                    <td className="py-3 pr-4 text-right tabular-nums text-slate-500">
                      {fmtRate(l.vatRate)}
                    </td>
                    <td className="py-3 text-right font-medium tabular-nums text-slate-900">
                      {fmtAmount(l.lineTotal, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-5 ml-auto max-w-sm space-y-1 border-t border-slate-200 pt-4 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-600">Ara toplam</span>
            <span className="font-medium tabular-nums text-slate-900">
              {fmtAmount(invoice.subtotal, currency)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">KDV</span>
            <span className="font-medium tabular-nums text-slate-900">
              {fmtAmount(invoice.vatAmount, currency)}
            </span>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-1.5">
            <span className="font-semibold text-slate-800">Genel toplam</span>
            <span className="text-base font-bold tabular-nums text-slate-900">
              {fmtAmount(invoice.total, currency)}
            </span>
          </div>
          <div className="flex justify-between pt-1">
            <span className="text-slate-600">
              Kalan
              {!remaining.serverProvided && remaining.value !== null && (
                <span className="ml-1 text-[10px] uppercase text-amber-600">arayüz hesabı</span>
              )}
            </span>
            <span className="font-semibold tabular-nums text-amber-700">
              {fmtKurus(remaining.value, currency)}
            </span>
          </div>
        </div>

        <p className="mt-4 text-[11px] leading-5 text-slate-500">
          Ara toplam, KDV ve genel toplam sunucuda hesaplanır ve burada olduğu gibi gösterilir.
          &quot;Kalan&quot; sunucudan gelmediğinde tamsayı kuruş aritmetiğiyle türetilir ve bu
          durumda ayrıca işaretlenir.
        </p>
      </Card>

      {/* Ödemeler */}
      <Card
        title="Ödemeler"
        action={
          canPay ? (
            <Button size="sm" variant="gold" onClick={() => setPaymentOpen(true)}>
              + Ödeme Kaydet
            </Button>
          ) : undefined
        }
      >
        {payments.length === 0 ? (
          <EmptyState message="Bu faturaya kaydedilmiş ödeme yok." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {fmtAmount(p.amount, currency)}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {fmtDate(p.date)} · {labelOf(PAYMENT_METHOD_LABELS, p.method)}
                    {p.reference ? ` · ${p.reference}` : ""}
                  </p>
                </div>
                {p.note && <span className="text-xs text-slate-500">{p.note}</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-[11px] leading-5 text-slate-500">
          Her ödeme aynı işlemde bir TAHSILAT finans hareketi üretir; toplam ödemeler genel
          toplama ulaştığında fatura durumunu sunucu ÖDENDİ yapar.
        </p>
      </Card>

      {invoice.note && (
        <Card title="Fatura Notu">
          <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{invoice.note}</p>
        </Card>
      )}

      <Card title="Künye">
        <div className="divide-y divide-slate-100">
          <DataRow label="Fatura No">{invoice.invoiceNo ?? "Kesinleştirilince atanır"}</DataRow>
          <DataRow label="Durum">{labelOf(INVOICE_STATUS_LABELS, invoice.status)}</DataRow>
          <DataRow label="e-Fatura">
            {labelOf(E_INVOICE_STATUS_LABELS, invoice.eInvoiceStatus ?? "YOK")}
          </DataRow>
          <DataRow label="Para birimi">{currency}</DataRow>
          <DataRow label="Oluşturma">{fmtDate(invoice.createdAt)}</DataRow>
        </div>
        {isDraft && (
          <SuccessBox message="Taslak faturalar numara tüketmez. Numara yalnızca 'Kesinleştir' ile ve sunucuda atanır." />
        )}
      </Card>

      <PaymentModal
        open={paymentOpen}
        invoiceId={id}
        clientId={invoice.clientId ?? invoice.client?.id ?? null}
        currency={currency}
        suggested={remaining.value}
        onClose={() => setPaymentOpen(false)}
        onSaved={() => {
          setPaymentOpen(false);
          push("Ödeme kaydedildi.");
          void load();
        }}
      />

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

// ---------- Ödeme kaydı ----------

function PaymentModal({
  open,
  invoiceId,
  clientId,
  currency,
  suggested,
  onClose,
  onSaved,
}: {
  open: boolean;
  invoiceId: string;
  /** Tahsilat ucu müvekkil kimliği ister; fatura künyesinden okunur. */
  clientId: string | null;
  currency: string;
  suggested: bigint | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(toIsoDate(new Date()));
  const [method, setMethod] = useState("HAVALE");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * FAZLA ÖDEME İKİNCİ TURU.
   *
   * Sunucu, tutar kalan bakiyeyi aşarsa YAZMAZ; 400 + `remaining` /
   * `overpaymentAmount` döndürür. Farkı avans olarak kabul etmek AVUKATIN
   * KARARIDIR — bu yüzden istemci sessizce `allowOverpayment` göndermez,
   * önce farkı gösterip AÇIK onay ister.
   */
  const [overpayment, setOverpayment] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setOverpayment(null);
    setAmount("");
    setReference("");
    setNote("");
  }, [open]);

  async function save(allowOverpayment: boolean) {
    if (!clientId) {
      setError(
        "Faturanın müvekkil bilgisi okunamadı; tahsilat kaydedilemez. Sayfayı yenileyin.",
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createInvoicePayment(invoiceId, clientId, {
        amount: amount.trim().replace(",", "."),
        date,
        method: method as "HAVALE",
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
        ...(allowOverpayment ? { allowOverpayment: true } : {}),
      });
      onSaved();
    } catch (err) {
      // Sunucu fazla ödemeyi ayrıntılı bildirir; kullanıcıya farkı göster ve
      // bilinçli onay iste.
      const data = err instanceof ApiError ? (err.data as Record<string, unknown> | null) : null;
      const excess = data && typeof data.overpaymentAmount === "string" ? data.overpaymentAmount : null;
      if (excess && !allowOverpayment) {
        setOverpayment(excess);
        setError(err instanceof ApiError ? err.message : null);
      } else {
        setError(err instanceof ApiError ? err.message : "Ödeme kaydedilemedi.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await save(false);
  }

  return (
    <Modal open={open} title="Ödeme Kaydet" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={`Tutar (${currency})`}
            hint={suggested !== null ? `Kalan bakiye: ${fmtKurus(suggested, currency)}` : undefined}
          >
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </Field>
          <Field label="Ödeme tarihi">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Yöntem">
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {labelOf(PAYMENT_METHOD_LABELS, m)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Referans / dekont no">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
        </div>
        <Field label="Not">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {error && <ErrorBox message={error} />}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          {overpayment ? (
            // Fazla ödeme AÇIK onayla kaydedilir; tutar sessizce geçilmez.
            <Button variant="gold" disabled={saving} onClick={() => void save(true)}>
              {saving
                ? "Kaydediliyor…"
                : `Farkı avans olarak kabul et (${overpayment} ${currency})`}
            </Button>
          ) : (
            <Button type="submit" disabled={saving}>
              {saving ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  );
}
