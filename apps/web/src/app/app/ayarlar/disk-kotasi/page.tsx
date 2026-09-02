"use client";

/**
 * DİSK KOTASI — büronun depolama durumu ve paket satın alma.
 * Kredi cüzdanıyla aynı deneyim: durum + paket seç + satın al (fatura düşer).
 */

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, EmptyState, ErrorBox, Spinner } from "@/components/ui";

interface QuotaStatus {
  includedBytes: string;
  purchasedBytes: string;
  usedBytes: string;
  totalBytes: string;
  availableBytes: string;
  usedPercent: number;
  includedGbLabel: string;
}

interface DiskPackage {
  key: string;
  gb: number;
  bytes: string;
  price: string;
  currency: string;
}

function gb(bytes: string | number): string {
  const n = typeof bytes === "string" ? Number(bytes) : bytes;
  return `${(n / 1024 ** 3).toFixed(n < 10 * 1024 ** 3 ? 1 : 0)} GB`;
}

export default function DiskKotasiPage() {
  const [status, setStatus] = useState<QuotaStatus | null>(null);
  const [packages, setPackages] = useState<DiskPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const [buyResult, setBuyResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, p] = await Promise.all([
        api<QuotaStatus>("/disk-quota"),
        api<unknown>("/disk-quota/packages"),
      ]);
      setStatus(s);
      setPackages(Array.isArray(p) ? (p as DiskPackage[]) : []);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Kota bilgisi yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function buy(pkg: DiskPackage) {
    setBuying(pkg.key);
    setBuyResult(null);
    try {
      const res = await api<{ fatura: { id: string; total: string; currency: string } }>(
        "/disk-quota/purchase",
        { method: "POST", body: { packageKey: pkg.key } },
      );
      setBuyResult(
        `${pkg.gb} GB ek kota eklendi. Platform faturası düzenlendi: ${res.fatura.total} ${res.fatura.currency} (KDV dâhil).`,
      );
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Satın alma tamamlanamadı.");
    } finally {
      setBuying(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Disk Kotası</h1>
        <p className="mt-1 text-sm text-slate-500">
          Planınıza dahil depolama ve satın aldığınız ek kota. Yüklenen her belge ve mesaj eki buradan düşer.
        </p>
      </div>

      {loading ? (
        <Spinner label="Kota bilgisi yükleniyor…" />
      ) : error ? (
        <ErrorBox message={error} />
      ) : status ? (
        <>
          <Card>
            <div className="space-y-3 p-5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-slate-700">
                  {gb(status.usedBytes)} / {gb(status.totalBytes)} kullanıldı
                </span>
                <Badge tone={status.usedPercent > 90 ? "danger" : status.usedPercent > 75 ? "yellow" : "green"}>
                  %{status.usedPercent}
                </Badge>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full transition-all ${
                    status.usedPercent > 90 ? "bg-red-500" : status.usedPercent > 75 ? "bg-amber-500" : "bg-emerald-500"
                  }`}
                  style={{ width: `${Math.min(100, status.usedPercent)}%` }}
                />
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-slate-500">Plan dahili</dt>
                  <dd className="font-medium text-slate-800">{gb(status.includedBytes)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Satın alınan</dt>
                  <dd className="font-medium text-slate-800">{gb(status.purchasedBytes)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Kullanılan</dt>
                  <dd className="font-medium text-slate-800">{gb(status.usedBytes)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Boş</dt>
                  <dd className="font-medium text-slate-800">{gb(status.availableBytes)}</dd>
                </div>
              </dl>
              <p className="text-[11px] text-slate-500">
                Satın alınan kota süresizdir ve devreder. {status.includedGbLabel}.
              </p>
            </div>
          </Card>

          <Card>
            <p className="p-4 text-sm font-semibold text-slate-700">Ek disk paketleri</p>
            {packages.length === 0 ? (
              <div className="pb-5">
                <EmptyState message="Satılabilir disk paketi bulunamadı." />
              </div>
            ) : (
              <div className="grid gap-3 p-4 pt-0 sm:grid-cols-3">
                {packages.map((p) => (
                  <div key={p.key} className="rounded-lg border border-slate-200 p-4">
                    <p className="text-lg font-bold text-slate-900">{p.gb} GB</p>
                    <p className="mt-1 text-sm text-slate-600">
                      {p.price} {p.currency}
                    </p>
                    <Button
                      variant="gold"
                      className="mt-3 w-full"
                      disabled={buying !== null}
                      onClick={() => void buy(p)}
                    >
                      {buying === p.key ? "Satın alınıyor…" : "Satın Al"}
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {buyResult && (
              <p className="mx-4 mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                {buyResult}
              </p>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
