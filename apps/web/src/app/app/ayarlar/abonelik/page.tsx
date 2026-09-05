"use client";

/**
 * ABONELİK (Faz 3 — gelir hattı): plan, dönem, sonraki fatura önizlemesi, platform
 * faturaları (öde / PDF), kupon, faturalama aralığı, plan modülleri.
 * Ödeme: SIMULASYON anında; iyzico ödeme sayfasına yönlendirir ve `?odeme=` ile döner.
 */

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, ApiError, getStoredUser } from "@/lib/api";
import { Badge, Button, Card, EmptyState, ErrorBox, Input, Spinner, SuccessBox } from "@/components/ui";
import type { BadgeTone } from "@/lib/labels";

interface Summary {
  abonelik: {
    id: string;
    planKey: string;
    status: string;
    seats: number;
    billingInterval: "AYLIK" | "YILLIK";
    couponCode: string | null;
    couponGecerli: boolean;
    trialEndsAt: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
  } | null;
  plan: { key: string; name: string; monthlyPricePerUser: string | null; annualPricePerUser: string | null; maxUsers: number | null } | null;
  moduller: string[];
  byoIndirimi: boolean;
  byoIndirimYuzdesi: number;
  sonrakiFatura: { listAmount: string; discountAmount: string; discountReason: string | null; amount: string; vatAmount: string; total: string; periodStart: string | null } | null;
  acikFatura: number;
  odemeSaglayici: "SIMULASYON" | "IYZICO" | "YOK";
}

interface InvoiceDto {
  id: string;
  number: string | null;
  type: "ABONELIK" | "KREDI_PAKETI" | "PLAN_FARKI";
  description: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  discountAmount: string;
  amount: string;
  vatAmount: string;
  total: string;
  issueDate: string;
  dueDate: string | null;
  paidAt: string | null;
  status: string;
  odenebilir: boolean;
}

const STATUS_LABEL: Record<string, string> = { TASLAK: "Taslak", GONDERILDI: "Ödeme bekliyor", KISMI_ODENDI: "Kısmen ödendi", ODENDI: "Ödendi", IPTAL: "İptal", IADE: "İade" };
const STATUS_TONE: Record<string, BadgeTone> = { TASLAK: "gray", GONDERILDI: "yellow", KISMI_ODENDI: "yellow", ODENDI: "green", IPTAL: "red", IADE: "red" };
const SUB_STATUS: Record<string, string> = { TRIAL: "Deneme", ACTIVE: "Aktif", PAST_DUE: "Ödeme gecikmiş", SUSPENDED: "Askıda", CANCELED: "İptal" };
const TYPE_LABEL: Record<InvoiceDto["type"], string> = { ABONELIK: "Dönem faturası", KREDI_PAKETI: "Kredi paketi", PLAN_FARKI: "Plan farkı" };
const MODULE_LABEL: Record<string, string> = { dosya: "Dosya", sure: "Süre", gorev: "Görev", ai: "AI asistan", icra: "İcra", finans: "Finans", faturalama: "Faturalama", sso: "SSO", "ozel-model": "Özel model" };

const money = (v: string | null | undefined) => (v === null || v === undefined ? "-" : `${Number(v).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ₺`);
const date = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString("tr-TR") : "-");

function AbonelikIcerik() {
  const params = useSearchParams();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [invoices, setInvoices] = useState<InvoiceDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [coupon, setCoupon] = useState("");
  const role = getStoredUser()?.role ?? "";
  const yonetici = role === "ADMIN" || role === "PARTNER";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await api<Summary>("/subscription");
      setSummary(s);
      if (yonetici) {
        const inv = await api<{ items: InvoiceDto[] }>("/subscription/invoices");
        setInvoices(inv.items);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Abonelik bilgisi yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [yonetici]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const odeme = params.get("odeme");
    if (odeme === "basarili") setNotice("Ödemeniz alındı; fatura ödendi olarak işaretlendi.");
    else if (odeme === "basarisiz") setError(`Ödeme tamamlanamadı${params.get("neden") ? `: ${params.get("neden")}` : "."}`);
    else if (odeme === "bekliyor") setNotice("Ödeme sağlayıcıdan sonuç bekleniyor; kısa süre sonra yenileyin.");
  }, [params]);

  async function pay(id: string) {
    setBusy(id);
    setError(null);
    try {
      const res = await api<{ odendi: boolean; odemeSayfasi: string | null; mesaj: string }>(`/subscription/invoices/${id}/pay`, { method: "POST", body: {} });
      if (!res.odendi && res.odemeSayfasi) {
        window.location.href = res.odemeSayfasi;
        return;
      }
      setNotice(res.mesaj);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ödeme başlatılamadı.");
    } finally {
      setBusy(null);
    }
  }

  async function applyCoupon() {
    setBusy("kupon");
    setError(null);
    try {
      const res = await api<{ mesaj: string }>("/subscription/coupon", { method: "PUT", body: { code: coupon } });
      setNotice(res.mesaj);
      setCoupon("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Kupon uygulanamadı.");
    } finally {
      setBusy(null);
    }
  }

  async function setInterval(v: "AYLIK" | "YILLIK") {
    setBusy("aralik");
    try {
      const res = await api<{ mesaj: string }>("/subscription/interval", { method: "PUT", body: { billingInterval: v } });
      setNotice(res.mesaj);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Aralık değiştirilemedi.");
    } finally {
      setBusy(null);
    }
  }

  if (loading && !summary) return <Spinner label="Abonelik yükleniyor…" />;
  const sub = summary?.abonelik;

  return (
    <div className="space-y-6" data-testid="abonelik-sayfasi">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Abonelik</h1>
        <p className="mt-1 text-sm text-slate-600">Planınız, dönem faturalarınız ve ödemeler. Faturalar dönem bitiminden 7 gün önce kesilir.</p>
      </header>
      {error && <ErrorBox message={error} />}
      {notice && <SuccessBox message={notice} />}

      {!sub ? (
        <EmptyState message="Büronuz için abonelik kaydı bulunmuyor; platform ekibiyle iletişime geçin." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Plan">
            <div className="space-y-2 text-sm">
              <p className="text-xl font-semibold text-slate-900">{summary?.plan?.name ?? sub.planKey}</p>
              <p>
                Durum: <Badge tone={sub.status === "ACTIVE" ? "green" : sub.status === "PAST_DUE" ? "red" : "yellow"}>{SUB_STATUS[sub.status] ?? sub.status}</Badge>
              </p>
              <p>Koltuk: <strong>{sub.seats}</strong>{summary?.plan?.maxUsers ? ` / en fazla ${summary.plan.maxUsers}` : ""}</p>
              <p>Kullanıcı başına: {money(summary?.plan?.monthlyPricePerUser)} / ay{summary?.plan?.annualPricePerUser ? ` · ${money(summary.plan.annualPricePerUser)} / yıl` : ""}</p>
              <p>Dönem: {date(sub.currentPeriodStart)} – {date(sub.currentPeriodEnd)}</p>
              {sub.trialEndsAt && <p className="text-amber-700">Deneme bitişi: {date(sub.trialEndsAt)}</p>}
              <div className="flex flex-wrap gap-1 pt-2">
                {(summary?.moduller ?? []).map((m) => (
                  <Badge key={m} tone="blue">{MODULE_LABEL[m] ?? m}</Badge>
                ))}
              </div>
            </div>
          </Card>

          <Card title="Sonraki dönem faturası (önizleme)">
            {summary?.sonrakiFatura ? (
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between"><dt>Liste tutarı</dt><dd className="tabular-nums">{money(summary.sonrakiFatura.listAmount)}</dd></div>
                {Number(summary.sonrakiFatura.discountAmount) > 0 && (
                  <div className="flex justify-between text-emerald-700"><dt>İndirim{summary.sonrakiFatura.discountReason ? ` (${summary.sonrakiFatura.discountReason})` : ""}</dt><dd className="tabular-nums">- {money(summary.sonrakiFatura.discountAmount)}</dd></div>
                )}
                <div className="flex justify-between"><dt>KDV %20</dt><dd className="tabular-nums">{money(summary.sonrakiFatura.vatAmount)}</dd></div>
                <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold"><dt>Toplam</dt><dd className="tabular-nums">{money(summary.sonrakiFatura.total)}</dd></div>
                <p className="pt-2 text-xs text-slate-500">Dönem başlangıcı: {date(summary.sonrakiFatura.periodStart)}. {summary?.byoIndirimi ? `Kendi AI sağlayıcınızı kullandığınız için %${summary.byoIndirimYuzdesi} BYO-LLM indirimi otomatik uygulanır.` : `Kendi LLM sunucunuzu tanımlarsanız abonelik %${summary?.byoIndirimYuzdesi ?? 30} indirimli olur.`}</p>
              </dl>
            ) : (
              <EmptyState message="Plan fiyatı tanımlı değil." />
            )}
          </Card>

          <Card title="Faturalama tercihleri">
            <div className="space-y-3 text-sm">
              <div>
                <p className="font-medium text-slate-800">Aralık</p>
                <div className="mt-1 flex gap-2">
                  {(["AYLIK", "YILLIK"] as const).map((v) => (
                    <Button key={v} size="sm" variant={sub.billingInterval === v ? "primary" : "secondary"} disabled={!yonetici || busy === "aralik"} onClick={() => void setInterval(v)}>
                      {v === "AYLIK" ? "Aylık" : "Yıllık (peşin)"}
                    </Button>
                  ))}
                </div>
              </div>
              <div>
                <p className="font-medium text-slate-800">Kupon {sub.couponCode && <Badge tone={sub.couponGecerli ? "green" : "gray"}>{sub.couponCode}{sub.couponGecerli ? "" : " (geçersiz)"}</Badge>}</p>
                <div className="mt-1 flex gap-2">
                  <Input placeholder="KUPON-KODU" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} disabled={!yonetici} />
                  <Button size="sm" disabled={!yonetici || !coupon || busy === "kupon"} onClick={() => void applyCoupon()}>Uygula</Button>
                </div>
              </div>
              <p className="text-xs text-slate-500">
                Çevrimiçi ödeme: {summary?.odemeSaglayici === "IYZICO" ? "kartla (iyzico)" : summary?.odemeSaglayici === "SIMULASYON" ? "simülasyon (test ortamı)" : "kapalı — havale/EFT ile ödeyip dekontu iletin"}.
              </p>
            </div>
          </Card>
        </div>
      )}

      {yonetici && (
        <Card title="Platform faturaları" action={<span className="text-xs text-slate-500">{summary?.acikFatura ?? 0} açık fatura</span>}>
          {invoices.length === 0 ? (
            <EmptyState message="Henüz fatura yok." />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr><th className="py-2 pr-3">No</th><th className="py-2 pr-3">Tür</th><th className="py-2 pr-3">Açıklama</th><th className="py-2 pr-3">Tarih</th><th className="py-2 pr-3">Vade</th><th className="py-2 pr-3 text-right">Toplam</th><th className="py-2 pr-3">Durum</th><th className="py-2"></th></tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="border-t border-slate-100" data-testid="fatura-satiri">
                      <td className="py-2 pr-3 font-mono text-xs">{inv.number ?? "—"}</td>
                      <td className="py-2 pr-3">{TYPE_LABEL[inv.type]}</td>
                      <td className="max-w-md py-2 pr-3 text-slate-600">{inv.description}</td>
                      <td className="py-2 pr-3">{date(inv.issueDate)}</td>
                      <td className="py-2 pr-3">{date(inv.dueDate)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{money(inv.total)}</td>
                      <td className="py-2 pr-3"><Badge tone={STATUS_TONE[inv.status] ?? "gray"}>{STATUS_LABEL[inv.status] ?? inv.status}</Badge></td>
                      <td className="py-2 text-right">
                        <div className="flex justify-end gap-2">
                          <a href={`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/api/v1/subscription/invoices/${inv.id}/pdf`} target="_blank" rel="noreferrer" className="text-xs text-slate-600 underline">PDF</a>
                          {inv.odenebilir && (
                            <Button size="sm" variant="gold" disabled={busy === inv.id} onClick={() => void pay(inv.id)}>
                              {busy === inv.id ? "…" : "Öde"}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

/** `useSearchParams` statik derlemede Suspense sınırı ister (Next.js). */
export default function AbonelikPage() {
  return (
    <Suspense fallback={<Spinner label="Abonelik yükleniyor…" />}>
      <AbonelikIcerik />
    </Suspense>
  );
}
