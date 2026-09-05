"use client";

/**
 * VEKALET ÜCRETİ HESAP ARACI (D7 — rakip analizi).
 *
 * Web'de serbest erişimli hızlı hesap aracı. MOTOR SUNUCUDADIR (legal-core
 * vekalet-ucreti.ts); bu sayfa HESAP YAPMAZ — yalnızca
 * POST /vekalet-ucreti/hesapla ucunu çağırır ve İZ'İ gösterir.
 *
 * VAAT KISITLARI:
 *  - Bu araç BİLGİLENDİRİR; hukuki danışmanlık değildir.
 *  - Tarife rakamları büronun GİRİŞİDİR (RG'den, yılda bir); motor uydurmaz.
 *  - Tarife girilmemiş yıl için hesap 404 döner ve kullanıcıya tarife
 *    girmesi istenir.
 */

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

interface HesapSonucu {
  yil: number;
  davaDegeriKurus: string;
  maktuKurus: string;
  nispiKurus: string;
  onerilenBrutKurus: string;
  rejim: "MAKTU" | "NISPI";
  kdvKurus: string;
  toplamKurus: string;
  iz: string[];
  not: string;
  /** BURO = büronun girişi; PLATFORM = platformun RG'den girdiği resmî tarife. */
  tarifeKaynagi?: "BURO" | "PLATFORM";
  rgKunye?: string | null;
}

interface Tarife {
  yil: number;
  kademeler: { limitKurus: string | null; ucretKurus: string }[];
  tekrar: { esikKurus: string; birimKurus: string; ucretKurus: string } | null;
  nispiOranYuzde: string;
  kdvOrani: string;
  kaynak?: "BURO" | "PLATFORM";
  rgKunye?: string | null;
}

const kurusToTr = (kurus: string): string => {
  const n = Number(kurus);
  if (!Number.isFinite(n)) return kurus;
  return (n / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function VekaletUcretiAraciPage() {
  const [davaDegeri, setDavaDegeri] = useState("");
  const [yil, setYil] = useState(new Date().getFullYear());
  const [sonuc, setSonuc] = useState<HesapSonucu | null>(null);
  const [tarife, setTarife] = useState<Tarife | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tarifeGerekli, setTarifeGerekli] = useState(false);

  // Tarifeyi oku (varsa) — hesap öncesi "tarife girilmemiş" durumunu göstermek için.
  const loadTarife = useCallback(async () => {
    try {
      const t = await api<Tarife>(`/vekalet-ucreti/tarife/${yil}`);
      setTarife(t);
      setTarifeGerekli(false);
    } catch {
      setTarife(null);
      setTarifeGerekli(true);
    }
  }, [yil]);

  useEffect(() => {
    void loadTarife();
  }, [loadTarife]);

  async function hesapla() {
    // Girdi: TL → kuruş (motor kuruş bekler).
    const tl = Number(davaDegeri.replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(tl) || tl < 0) {
      setError("Geçerli bir dava değeri girin (örn. 250000 veya 1.500.000,50).");
      return;
    }
    const kurus = Math.round(tl * 100).toString();

    setBusy(true);
    setError(null);
    try {
      const r = await api<HesapSonucu>("/vekalet-ucreti/hesapla", {
        method: "POST",
        body: { davaDegeri: kurus, yil },
      });
      setSonuc(r);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setTarifeGerekli(true);
        setError(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : "Hesap yapılamadı.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Vekalet Ücreti Hesap Aracı</h1>
        <p className="mt-2 text-sm text-slate-600">
          AAÜT asgari ücret tarifesi üzerinden maktu/nispi hesaplama. Hesap{" "}
          <strong>girilen tarife</strong> üzerinden yapılır; sonuç{" "}
          <strong>bilgilendirme amaçlıdır</strong> ve hukuki danışmanlık yerine geçmez.
        </p>
      </header>

      {tarifeGerekli && (
        <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800" role="status">
          <p>
            <strong>{yil}</strong> yılı için AAÜT tarifesi bulunamadı: büronuz girmemiş ve platformun
            resmî tarife kaydı da henüz yayımlanmamış. Hesap yapabilmek için büronuzda
            (Ayarlar → Vekalet Ücreti Tarifesi) yılın tarife rakamlarını Resmî Gazete'den girmeniz gerekir.
          </p>
          <p className="mt-2 text-xs">
            Tarife girildiğinde bu araç otomatik olarak hesaplama yapabilir.
          </p>
        </div>
      )}

      {tarife && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          <strong>{yil} tarifesi:</strong> {tarife.kademeler.length} kademe · nispi %
          {tarife.nispiOranYuzde} · KDV %{tarife.kdvOrani}
          {tarife.tekrar && ` · tekrar dilimi: her ${kurusToTr(tarife.tekrar.birimKurus)} TL için ${kurusToTr(tarife.tekrar.ucretKurus)} TL`}
          <p className="mt-1">
            {tarife.kaynak === "PLATFORM" ? (
              <>
                Kaynak: <strong>platformun Resmî Gazete'den girdiği resmî tarife</strong>
                {tarife.rgKunye ? ` (${tarife.rgKunye})` : ""}. Büronuz kendi tarifesini girerse o kullanılır.
              </>
            ) : (
              <>Kaynak: büronuzun girdiği tarife.</>
            )}
          </p>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void hesapla();
        }}
        className="mt-6 space-y-4 rounded-lg border border-slate-200 bg-white p-6"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="davaDegeri" className="block text-sm font-medium text-slate-700">
              Dava değeri (TL)
            </label>
            <input
              id="davaDegeri"
              type="text"
              inputMode="decimal"
              value={davaDegeri}
              onChange={(e) => setDavaDegeri(e.target.value)}
              placeholder="örn. 250000"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
              required
            />
          </div>
          <div>
            <label htmlFor="tarifeYili" className="block text-sm font-medium text-slate-700">
              Tarife yılı
            </label>
            <select
              id="tarifeYili"
              value={yil}
              onChange={(e) => setYil(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
            >
              {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>
        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || tarifeGerekli}
          className="w-full rounded-md bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
        >
          {busy ? "Hesaplanıyor…" : "Hesapla"}
        </button>
      </form>

      {sonuc && (
        <div className="mt-8 space-y-6">
          <div className="rounded-lg border border-slate-200 bg-white p-6">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Hesap Sonucu</h2>
              <span className="rounded-full bg-slate-100 px-3 py-0.5 text-xs font-medium text-slate-700">
                {sonuc.rejim === "NISPI" ? "Nispi oran uygulandı" : "Maktu ücret uygulandı"}
              </span>
            </div>
            <dl className="mt-4 space-y-3">
              <div className="flex justify-between gap-4 border-b border-slate-100 pb-2">
                <dt className="text-sm text-slate-600">Maktu ücret (KDV hariç)</dt>
                <dd className="text-sm font-medium text-slate-900">{kurusToTr(sonuc.maktuKurus)} TL</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-slate-100 pb-2">
                <dt className="text-sm text-slate-600">Nispi ücret (KDV hariç)</dt>
                <dd className="text-sm font-medium text-slate-900">{kurusToTr(sonuc.nispiKurus)} TL</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-slate-100 pb-2">
                <dt className="text-sm text-slate-600">
                  Önerilen brüt ücret (AAÜT m.2/4: büyük olan)
                </dt>
                <dd className="text-lg font-bold text-slate-900">{kurusToTr(sonuc.onerilenBrutKurus)} TL</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-slate-100 pb-2">
                <dt className="text-sm text-slate-600">KDV</dt>
                <dd className="text-sm font-medium text-slate-900">{kurusToTr(sonuc.kdvKurus)} TL</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-sm font-semibold text-slate-700">Toplam (KDV dahil)</dt>
                <dd className="text-xl font-bold text-amber-600">{kurusToTr(sonuc.toplamKurus)} TL</dd>
              </div>
            </dl>
            <p className="mt-4 border-t border-slate-200 pt-3 text-xs text-slate-500">{sonuc.not}</p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-6">
            <h3 className="text-sm font-semibold text-slate-700">Hesabın İzi</h3>
            <ol className="mt-3 space-y-2">
              {sonuc.iz.map((adim, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-slate-600">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[11px] font-bold text-slate-600">
                    {i + 1}
                  </span>
                  <span>{adim}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}

      <p className="mt-8 text-center text-xs text-slate-500">
        Bu araç NomosOS'un deterministik vekalet ücreti motorunu kullanır. Hesap, girilen
        tarife rakamlarına dayanır; AAÜT her yıl Resmî Gazete ile yayımlanır ve rakamlar
        büronuz tarafından girilir.
      </p>
    </div>
  );
}
