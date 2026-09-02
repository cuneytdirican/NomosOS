"use client";

/**
 * UYAP KÖPRÜSÜ — büro tarafı yönetim ekranı.
 *
 * Eklenti, Chrome Web Mağazası yerine BURADAN indirilir (kendi sunucumuz):
 * ZIP'i açın → chrome://extensions → Geliştirici modu → "Paketlenmemiş
 * yükle" → açılan klasörü seçin. Ardından aşağıdaki eşleştirme koduyla
 * büronuza bağlayın.
 *
 * UÇLAR (web tarafı — kiracı JWT'si):
 *   POST /uyap/pairing-code        — 10 dk ömürlü eşleştirme kodu üret
 *   GET  /uyap/ozet                — izlenen dosya, son senkron, cihazlar
 *   POST /uyap/devices/:id/revoke  — cihazı iptal et
 *   GET  /uyap/match-queue         — eşleşmeyen UYAP dosyaları
 *   POST /uyap/match-queue/:id/resolve — UYAP dosyasını NomosOS dosyasına bağla
 *
 * ÜRÜN İLKESİ: eklenti OKUR — UYAP'a hiçbir şey GÖNDERMEZ. "UYAP'ın yerine
 * geçmez; üzerine bir operasyon katmanı kurar."
 */

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, EmptyState, ErrorBox, Select, Spinner } from "@/components/ui";

/* ------------------------------- Tipler ------------------------------- */

interface UyapDevice {
  id: string;
  deviceName: string;
  extensionVersion: string;
  lastUsedAt: string | null;
  createdAt: string;
}

interface UyapSummary {
  watchedFileCount: number;
  lastSyncAt: string | null;
  pendingMatchCount: number;
  devices: UyapDevice[];
}

interface MatchQueueRow {
  id: string;
  uyapDosyaNo: string;
  birim: string | null;
  dosyaTuru: string | null;
  durum: string | null;
  updatedAt: string;
}

interface CaseOption {
  id: string;
  title: string;
  fileNumber: string | null;
  clientName?: string;
}

/** İndirilebilir eklenti sürümü — public/downloads sabit adı. */
const EXTENSION_VERSION = "0.1.0";
const EXTENSION_ZIP = `/downloads/nomosos-uyap-koprusu-v${EXTENSION_VERSION}.zip`;

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("tr-TR");
}

export default function UyapEklentisiPage() {
  const [summary, setSummary] = useState<UyapSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [code, setCode] = useState<string | null>(null);
  const [codeBusy, setCodeBusy] = useState(false);

  const [queue, setQueue] = useState<MatchQueueRow[]>([]);
  const [cases, setCases] = useState<CaseOption[]>([]);
  const [resolveBusy, setResolveBusy] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolveNotice, setResolveNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sum, q] = await Promise.all([
        api<UyapSummary>("/uyap/ozet"),
        api<unknown>("/uyap/match-queue"),
      ]);
      setSummary(sum);
      setQueue(Array.isArray(q) ? (q as MatchQueueRow[]) : []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "UYAP durumu yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  // Eşleştirme kuyruğu için dosya listesi (yalnız kuyruk doluysa çek).
  useEffect(() => {
    if (queue.length === 0 || cases.length > 0) return;
    void (async () => {
      try {
        const res = await api<unknown>("/cases", { query: { limit: "200" } });
        const items = (Array.isArray(res) ? res : ((res as { items?: unknown[] }).items ?? [])) as Array<{
          id: string;
          title: string;
          fileNumber: string | null;
          client?: { name?: string };
        }>;
        setCases(
          items.map((c) => ({
            id: c.id,
            title: c.title,
            fileNumber: c.fileNumber,
            clientName: c.client?.name,
          })),
        );
      } catch {
        /* dosya listesi gelmezse kuyruk çözümü çalışmaz; hata eşleşme anında görünür */
      }
    })();
  }, [queue.length, cases.length]);

  async function generateCode() {
    setCodeBusy(true);
    setCode(null);
    try {
      const res = await api<{ code: string; expiresInSeconds: number }>("/uyap/pairing-code", {
        method: "POST",
      });
      setCode(res.code);
      // Kod 10 dk ömürlü — süre sayacı göster; kapanışta temizle.
      setTimeout(() => setCode(null), res.expiresInSeconds * 1000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Eşleştirme kodu üretilemedi.");
    } finally {
      setCodeBusy(false);
    }
  }

  async function revoke(deviceId: string) {
    try {
      await api(`/uyap/devices/${deviceId}/revoke`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Cihaz iptal edilemedi.");
    }
  }

  async function resolve(matchId: string, caseId: string) {
    if (!caseId) return;
    setResolveBusy(matchId);
    setResolveError(null);
    try {
      const res = await api<{ replayed?: number }>(`/uyap/match-queue/${matchId}/resolve`, {
        method: "POST",
        body: { caseId },
      });
      // D5 / M6 — eşleşme anında sahnelenmiş olaylar işlendi; sayı kullanıcıya
      // görünür (0 ise "bekleyen olay yoktu" bilgi değeri taşır).
      setResolveNotice(
        typeof res?.replayed === "number"
          ? res.replayed > 0
            ? `Eşleştirme yapıldı; ${res.replayed} bekleyen UYAP olayı dosyaya işlendi (safahat → zaman çizelgesi, duruşma → ajanda).`
            : "Eşleştirme yapıldı; bekleyen UYAP olayı yoktu."
          : "Eşleştirme yapıldı."
      );
      await load();
    } catch (err) {
      setResolveError(err instanceof ApiError ? err.message : "Eşleştirme yapılamadı.");
    } finally {
      setResolveBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">UYAP Köprüsü</h1>
        <p className="mt-1 text-sm text-slate-500">
          Tarayıcı eklentisiyle UYAP dosya listesi, safahat ve evrak aktarımı. Eklenti OKUR;
          UYAP'a hiçbir şey göndermez.
        </p>
      </div>

      {/* 1) Eklenti kurulumu — kendi sunucumuzdan indirme */}
      <Card>
        <div className="space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-800">Eklentiyi kurun</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Sürüm {EXTENSION_VERSION} · Chrome Web Mağazası yerine NomosOS sunucusundan indirilir.
              </p>
            </div>
            <a href={EXTENSION_ZIP} download>
              <Button variant="gold">Eklentiyi indir (ZIP)</Button>
            </a>
          </div>
          <ol className="list-inside list-decimal space-y-1 text-xs leading-5 text-slate-600">
            <li>ZIP dosyasını indirin ve bilgisayarınızda KALICI bir klasöre açın (uzantı klasörü silinirse eklenti kalkar).</li>
            <li>
              Chrome'da <code className="rounded bg-slate-100 px-1">chrome://extensions</code> adresine gidin, sağ üstten{" "}
              <strong>Geliştirici modu</strong>nu açın.
            </li>
            <li>
              <strong>Paketlenmemiş yükle</strong> düğmesiyle açtığınız klasörü (içinde manifest.json olan) seçin.
            </li>
            <li>Chrome araç çubuğunda NomosOS simgesini tıklayın; aşağıdaki eşleştirme kodunu girin.</li>
          </ol>
        </div>
      </Card>

      {/* 2) Eşleştirme */}
      <Card>
        <div className="space-y-3 p-5">
          <h2 className="text-base font-semibold text-slate-800">Büronuzla eşleştirin</h2>
          {loading ? (
            <Spinner />
          ) : code ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-center">
              <p className="text-xs text-amber-800">Eklenti popup'ına girin — 10 dakika geçerli:</p>
              <p className="mt-2 font-mono text-3xl font-bold tracking-widest text-amber-900">{code}</p>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button disabled={codeBusy} onClick={() => void generateCode()}>
                {codeBusy ? "Üretiliyor…" : "Eşleştirme Kodu Üret"}
              </Button>
              <p className="text-xs text-slate-500">
                Kod tek kullanımlıktır; eklenti girer girmez geçersiz olur.
              </p>
            </div>
          )}
          {summary && summary.devices.length > 0 && (
            <div className="mt-2 space-y-2">
              <p className="text-xs font-medium text-slate-600">Eşleştirilmiş tarayıcılar</p>
              {summary.devices.map((d) => (
                <div
                  key={d.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-800">{d.deviceName}</p>
                    <p className="text-[11px] text-slate-500">
                      eklenti v{d.extensionVersion} · eşleştirme {fmtDateTime(d.createdAt)} · son kullanım{" "}
                      {fmtDateTime(d.lastUsedAt)}
                    </p>
                  </div>
                  <Button variant="secondary" onClick={() => void revoke(d.id)}>
                    İptal et
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* 3) Durum */}
      <Card>
        <div className="space-y-3 p-5">
          <h2 className="text-base font-semibold text-slate-800">Senkron durumu</h2>
          {loading && !summary ? (
            <Spinner />
          ) : summary ? (
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
              <div className="rounded-lg border border-slate-200 p-3">
                <dt className="text-xs text-slate-500">İzlenen dosya</dt>
                <dd className="mt-1 text-xl font-bold text-slate-800">{summary.watchedFileCount}</dd>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <dt className="text-xs text-slate-500">Son senkron</dt>
                <dd className="mt-1 text-sm font-semibold text-slate-800">{fmtDateTime(summary.lastSyncAt)}</dd>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <dt className="text-xs text-slate-500">Bekleyen eşleşme</dt>
                <dd className="mt-1 text-xl font-bold text-slate-800">{summary.pendingMatchCount}</dd>
              </div>
            </dl>
          ) : (
            <EmptyState message="Durum yüklenemedi." />
          )}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
            <p className="font-semibold text-slate-700">UYAP dosyası nasıl eşleşir?</p>
            <p className="mt-1">
              Eklenti UYAP dosya listesini senkronladığında dosya numarası (örn. 2026/145) büronuzdaki dosyaların
              esas numarasıyla karşılaştırılır. Birebir tutan dosyalar otomatik bağlanır; tutmayanlar bu kuyruğa düşer.
            </p>
          </div>
        </div>
      </Card>

      {/* 4) Eşleştirme kuyruğu */}
      <Card>
        <div className="space-y-3 p-5">
          <h2 className="text-base font-semibold text-slate-800">Eşleştirme kuyruğu</h2>
          {error && <ErrorBox message={error} />}
          {queue.length === 0 ? (
            <EmptyState message="Bekleyen eşleşme yok — tüm senkronize dosyalar NomosOS dosyalarına bağlı." />
          ) : (
            <div className="space-y-2">
              {queue.map((row) => (
                <div key={row.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-semibold text-slate-800">{row.uyapDosyaNo}</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {row.birim ?? "birim bilinmiyor"}
                        {row.dosyaTuru ? ` · ${row.dosyaTuru}` : ""}
                        {row.durum ? ` · ${row.durum}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {cases.length > 0 ? (
                        <>
                          <div className="w-72">
                            <Select
                              aria-label="Dosya seç"
                              defaultValue=""
                              disabled={resolveBusy === row.id}
                              onChange={(e) => {
                                if (e.target.value) void resolve(row.id, e.target.value);
                              }}
                            >
                              <option value="">NomosOS dosyası seçin…</option>
                              {cases.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.title}
                                  {c.fileNumber ? ` (${c.fileNumber})` : ""}
                                  {c.clientName ? ` — ${c.clientName}` : ""}
                                </option>
                              ))}
                            </Select>
                          </div>
                          {resolveBusy === row.id && <Badge tone="blue">bağlanıyor…</Badge>}
                        </>
                      ) : (
                        <span className="text-xs text-slate-500">dosya listesi yükleniyor…</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {resolveError && <ErrorBox message={resolveError} />}
              {resolveNotice && !resolveError && (
                <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                  {resolveNotice}
                </p>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
