"use client";

/**
 * PORTAL ÖDEME SAYFASI (public) — /odeme/[token]
 *
 * Bağlantı TOKEN'ININ kendisi yetkidir: kimlik istenmez, oturum açılmaz.
 * Sayfa: fatura bilgisi (GET /portal/odeme/:token) + ÖDE düğmesi
 * (POST /portal/odeme/:token/ode).
 *
 * DÜRÜSTLÜK: ödeme sağlayıcısı yapılandırılmamışsa 503 döner ve sayfa bunu
 * AÇIKÇA söyler — "ödeme alındı" asla uydurulmaz (vaat kısıtı ilkesi).
 * SIMULASYON modunda ödeme kaydı gerçekten düşer (test yığını bu modda).
 */

import { useCallback, useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";

interface OdemeBilgisi {
  faturaNo: string | null;
  musteriAdi: string;
  faturaDurumu: string;
  tutar: string;
  paraBirimi: string;
  baglantiDurumu: string;
  kalanBakiye: string;
}

interface OdemeSonucu {
  ok: boolean;
  odemeTutari: string;
  paraBirimi: string;
  referans: string;
  faturaDurumu: string | null;
}

function fmt(tutar: string, para: string): string {
  const n = Number(tutar);
  if (!Number.isFinite(n)) return `${tutar} ${para}`;
  return `${n.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${para}`;
}

export default function PortalOdemePage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState<string | null>(null);
  const [bilgi, setBilgi] = useState<OdemeBilgisi | null>(null);
  const [sonuc, setSonuc] = useState<OdemeSonucu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    void params.then((p) => setToken(p.token));
  }, [params]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/portal/odeme/${token}`);
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(data?.message ?? "Ödeme bağlantısı bulunamadı veya süresi dolmuş.");
        setBilgi(null);
        return;
      }
      setBilgi((await res.json()) as OdemeBilgisi);
    } catch {
      setError("Bağlantı kurulamadı. Lütfen tekrar deneyin.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function ode() {
    if (!token) return;
    setPaying(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/portal/odeme/${token}/ode`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => null)) as
        | (OdemeSonucu & { message?: string })
        | null;
      if (!res.ok || !data?.ok) {
        setError(
          data?.message ??
            (res.status === 503
              ? "Ödeme sağlayıcısı yapılandırılmamış. Tahsilat yapılmadı; lütfen büronuzla iletişime geçin."
              : "Ödeme alınamadı."),
        );
        return;
      }
      setSonuc(data);
    } catch {
      setError(
        "Ödeme sırasında bağlantı hatası. Tahsilat yapılıp yapılmadığını öğrenmek için büronuzla görüşün.",
      );
    } finally {
      setPaying(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--paper)] px-4 py-10">
      <div className="w-full max-w-md">
        <div className="rounded-[6px] border border-[var(--rule)] bg-white p-7">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
            NomosOS · Ödeme
          </p>

          {loading && (
            <p className="mt-6 text-sm text-[var(--ink-soft)]">Bağlantı bilgisi yükleniyor…</p>
          )}

          {!loading && error && (
            <div className="mt-6">
              <h1 className="serif text-[1.15rem] font-semibold text-[var(--ink)]">
                Ödeme alınamıyor
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">{error}</p>
            </div>
          )}

          {!loading && !error && sonuc && (
            <div>
              <h1 className="serif mt-3 text-[1.3rem] font-semibold text-[var(--ink)]">
                Ödemeniz alındı
              </h1>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">
                {fmt(sonuc.odemeTutari, sonuc.paraBirimi)} tahsil edildi.
              </p>
              <dl className="mt-5 space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--ink-soft)]">Referans</dt>
                  <dd className="font-medium text-[var(--ink)]">{sonuc.referans}</dd>
                </div>
                {bilgi?.faturaNo && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-[var(--ink-soft)]">Fatura</dt>
                    <dd className="font-medium text-[var(--ink)]">{bilgi.faturaNo}</dd>
                  </div>
                )}
                {sonuc.faturaDurumu && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-[var(--ink-soft)]">Fatura durumu</dt>
                    <dd className="font-medium text-[var(--ink)]">{sonuc.faturaDurumu}</dd>
                  </div>
                )}
              </dl>
              <p className="mt-5 border-t border-[var(--rule)] pt-4 text-xs text-[var(--ink-soft)]">
                Bu makbuzu saklayın; referans numarası ödemenizin kaydıdır.
              </p>
            </div>
          )}

          {!loading && !error && !sonuc && bilgi && (
            <div>
              <h1 className="serif mt-3 text-[1.3rem] font-semibold text-[var(--ink)]">
                {bilgi.musteriAdi}
              </h1>
              <dl className="mt-5 space-y-2.5 text-sm">
                {bilgi.faturaNo && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-[var(--ink-soft)]">Fatura no</dt>
                    <dd className="font-medium text-[var(--ink)]">{bilgi.faturaNo}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--ink-soft)]">Ödenecek tutar</dt>
                  <dd className="serif text-[1.1rem] font-semibold text-[var(--ink)]">
                    {fmt(bilgi.kalanBakiye, bilgi.paraBirimi)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--ink-soft)]">Bağlantı durumu</dt>
                  <dd className="font-medium text-[var(--ink)]">
                    {bilgi.baglantiDurumu === "AKTIF" ? "Aktif" : bilgi.baglantiDurumu}
                  </dd>
                </div>
              </dl>

              {bilgi.baglantiDurumu !== "AKTIF" ? (
                <p className="mt-5 rounded-[4px] border border-[var(--rule)] bg-[var(--paper-alt)] p-4 text-sm text-[var(--ink-soft)]">
                  Bu ödeme bağlantısı artık aktif değil. Yeni bir bağlantı için büronuzla
                  görüşün.
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => void ode()}
                  disabled={paying}
                  className="mt-6 w-full rounded-[4px] bg-[var(--ink)] px-6 py-3 text-sm font-semibold text-[var(--paper)] transition-colors hover:bg-[#16264a] disabled:opacity-60"
                >
                  {paying ? "Ödeme işleniyor…" : "Öde"}
                </button>
              )}
              <p className="mt-4 text-[11px] leading-4 text-[var(--ink-soft)]">
                Ödeme, büronuzun sanal POS/ödeme kuruluşu üzerinden alınır. Ödeme sağlayıcısı
                yapılandırılmamışsa bu sayfa size dürüstçe bildirir — tahsilat yapılmadan
                &quot;ödendi&quot; denmez.
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
