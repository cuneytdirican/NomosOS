"use client";

/**
 * Ayarlar → AI Kullanımı (Modül 26 §Arayüz).
 *
 * Dönemsel tüketim, görev tipi ve kullanıcı kırılımı, hareket dökümü,
 * ek paket satın alma, otomatik yükleme anahtarı.
 *
 * BURADA GÖSTERİLEN SAYI KREDİDİR, TOKEN DEĞİLDİR. Avukata token göstermek
 * ürünün temel tasarım kararına aykırıdır (spec: "kullanıcıya token değil
 * KREDİ satılır"). Sağlayıcı maliyeti (USD) bu ekranda hiç geçmez; o iç
 * muhasebedir ve yalnız platform panelinde görünür.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ApiError } from "@/lib/api";
import {
  CREDIT_TX_LABELS,
  fetchPackages,
  fetchTransactions,
  fetchUsage,
  meterTone,
  notifyCreditsChanged,
  purchasePackage,
  setAutoTopUp,
  type CreditPackageDto,
  type CreditTransactionDto,
  type CreditUsageBreakdown,
} from "@/lib/credits";
import { CreditBadge, useCreditCosts, useWallet } from "@/components/credits";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Modal,
  Spinner,
  StatCard,
  SuccessBox,
} from "@/components/ui";

const TONE_BAR = { green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-red-600" } as const;

export default function AiKullanimPage() {
  const { wallet, loading: walletLoading, reload: reloadWallet } = useWallet();
  const { costs, tavan } = useCreditCosts();

  const [usage, setUsage] = useState<CreditUsageBreakdown | null>(null);
  const [packages, setPackages] = useState<CreditPackageDto[]>([]);
  const [txs, setTxs] = useState<CreditTransactionDto[]>([]);
  const [txPage, setTxPage] = useState(1);
  const [txTotalPages, setTxTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [buyKey, setBuyKey] = useState<string | null>(null);
  /** Erişim yetkisi olmayan roller (AVUKAT/STAJYER/SEKRETER) için. */
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, p, t] = await Promise.all([
        fetchUsage(),
        fetchPackages().catch(() => [] as CreditPackageDto[]),
        fetchTransactions({ page: txPage, limit: 25 }),
      ]);
      setUsage(u);
      setPackages(p);
      setTxs(t.items);
      setTxTotalPages(t.totalPages);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setForbidden(true);
      } else if (err instanceof ApiError && (err.status === 404 || err.status === 0)) {
        setError(
          "Kredi hattı bu kurulumda henüz yayında değil. AI işlemleriniz kotasız çalışıyor.",
        );
      } else {
        setError(err instanceof Error ? err.message : "Kullanım verisi alınamadı.");
      }
    } finally {
      setLoading(false);
    }
  }, [txPage]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handlePurchase(key: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await purchasePackage(key);
      setNotice(res.mesaj);
      setBuyKey(null);
      notifyCreditsChanged();
      reloadWallet();
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Satın alma tamamlanamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAutoTopUp(key: string | null) {
    setBusy(true);
    setError(null);
    try {
      const res = await setAutoTopUp(key);
      setNotice(res.mesaj);
      notifyCreditsChanged();
      reloadWallet();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ayar kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  }

  if (walletLoading || (loading && !usage && !forbidden && !error)) {
    return <Spinner label="AI kullanımı yükleniyor…" />;
  }

  if (forbidden) {
    return (
      <div className="space-y-4">
        <Header />
        <Card>
          <p className="p-5 text-sm text-slate-600">
            Kredi tüketim dökümü ve paket yönetimi <strong>Ortak</strong> ve{" "}
            <strong>Yönetici</strong> rollerine açıktır. Kalan kredinizi üst çubuktaki
            göstergeden görebilirsiniz.
          </p>
        </Card>
      </div>
    );
  }

  const c = wallet?.cuzdan ?? null;
  const limitsiz = wallet?.limitsiz ?? false;
  const total = c ? c.dahilKota + c.satinAlinan : 0;
  const tone = c ? meterTone(c.kullanimYuzdesi) : "green";

  const maxDaily = Math.max(1, ...(usage?.gunluk.map((g) => g.kredi) ?? [1]));
  const maxTask = Math.max(1, ...(usage?.gorevTipineGore.map((g) => g.kredi) ?? [1]));

  return (
    <div className="space-y-6">
      <Header />

      {error && <ErrorBox message={error} />}
      {notice && <SuccessBox message={notice} />}

      {/* ---------------- Limitsiz mod ---------------- */}
      {limitsiz && (
        <Card>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-800">
                <span aria-hidden="true">∞</span> Limitsiz mod aktif
              </span>
              <Badge tone="gray">{wallet?.mod}</Badge>
            </div>
            <p className="mt-3 text-sm text-slate-600">{wallet?.aciklama}</p>
            <p className="mt-2 text-sm text-slate-600">
              Kendi API anahtarınızı kullandığınız için <strong>kredi kotası uygulanmaz</strong> ve
              abonelikte %30 indirim geçerlidir. AI kullanım kaydı (hangi görev, hangi model, kaç
              token) yine tutulur — sağlayıcı maliyeti sizin hesabınızdadır.
            </p>
            <p className="mt-3">
              <Link
                href="/app/ayarlar/ai-saglayici"
                className="text-sm font-medium text-slate-900 underline underline-offset-2"
              >
                AI Sağlayıcı ayarlarına git
              </Link>
            </p>
          </div>
        </Card>
      )}

      {/* ---------------- Cüzdan ---------------- */}
      {c && !limitsiz && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Kalan kredi"
              value={c.kullanilabilir.toLocaleString("tr-TR")}
              hint={`toplam ${total.toLocaleString("tr-TR")} · %${c.kullanimYuzdesi} kullanıldı`}
              tone={tone === "red" ? "red" : tone === "amber" ? "gold" : "navy"}
            />
            <StatCard
              label="Dahil kota"
              value={`${(c.dahilKota - c.dahilTuketilen).toLocaleString("tr-TR")} / ${c.dahilKota.toLocaleString("tr-TR")}`}
              hint="dönem sonunda sıfırlanır, devretmez"
            />
            <StatCard
              label="Satın alınan"
              value={c.satinAlinan.toLocaleString("tr-TR")}
              hint="devreder, süresi dolmaz"
            />
            <StatCard
              label="Belge hattı"
              value={`${c.belgeKullanilan.toLocaleString("tr-TR")} / ${c.belgeKotasi.toLocaleString("tr-TR")}`}
              hint="belge sınıflandırma ücretsizdir, adetle sınırlıdır"
            />
          </div>

          <Card title="Dönem">
            <div className="space-y-3">
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full rounded-full ${TONE_BAR[tone]}`}
                  style={{ width: `${Math.min(100, c.kullanimYuzdesi)}%` }}
                />
              </div>
              <p className="text-sm text-slate-600">
                {c.donemBaslangic.slice(0, 10)} → {c.donemBitis.slice(0, 10)} ·{" "}
                {c.rezerve > 0 && (
                  <>
                    <strong>{c.rezerve} kredi</strong> devam eden çağrılar için rezerve edilmiş
                    durumda ·{" "}
                  </>
                )}
                Tüketim sırası: önce dahil kota, sonra satın alınan krediler.
              </p>
              {c.kullanimYuzdesi >= 80 && (
                <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Kota dolduğunda <strong>yalnızca kredili AI işlemleri durur.</strong> Dosya,
                  müvekkil, duruşma, süre, görev ve belge akışları — süre hesabı ve belge
                  sınıflandırma dâhil — çalışmaya devam eder.
                </p>
              )}
            </div>
          </Card>
        </>
      )}

      {/* ---------------- Dönemsel tüketim ---------------- */}
      {usage && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card
            title="Günlük tüketim"
            action={
              <span className="text-xs text-slate-500">
                dönem toplamı {usage.toplamTuketim.toLocaleString("tr-TR")} kredi
              </span>
            }
          >
            <div>
              {usage.gunluk.length === 0 ? (
                <EmptyState message="Bu dönemde henüz kredi tüketimi yok." />
              ) : (
                <div className="flex h-40 items-end gap-1" aria-label="Günlük kredi tüketimi">
                  {usage.gunluk.map((g) => (
                    <div key={g.tarih} className="flex flex-1 flex-col items-center gap-1">
                      <div
                        className="w-full rounded-t bg-slate-800"
                        style={{ height: `${Math.max(3, (g.kredi / maxDaily) * 100)}%` }}
                        title={`${g.tarih}: ${g.kredi} kredi`}
                      />
                      <span className="text-[9px] text-slate-500">{g.tarih.slice(8, 10)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card title="Görev tipine göre">
            <div className="space-y-2">
              {usage.gorevTipineGore.length === 0 ? (
                <EmptyState message="Henüz kredili işlem yapılmadı." />
              ) : (
                usage.gorevTipineGore.map((g) => (
                  <div key={g.taskType}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="flex items-center gap-2 truncate text-slate-700">
                        {g.taskType}
                        <CreditBadge taskType={g.taskType} costs={costs} />
                      </span>
                      <span className="shrink-0 tabular-nums text-slate-900">
                        {g.kredi.toLocaleString("tr-TR")}{" "}
                        <span className="text-xs text-slate-500">({g.adet} çağrı)</span>
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-amber-500"
                        style={{ width: `${(g.kredi / maxTask) * 100}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      )}

      {/* ---------------- Kullanıcı kırılımı ---------------- */}
      {usage && usage.kullaniciyaGore.length > 0 && (
        <Card title="Kullanıcıya göre">
          <div className="-mx-5 -mt-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-2 font-medium">Kullanıcı</th>
                  <th className="px-5 py-2 font-medium">Rol</th>
                  <th className="px-5 py-2 text-right font-medium">Çağrı</th>
                  <th className="px-5 py-2 text-right font-medium">Kredi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {usage.kullaniciyaGore.map((u) => (
                  <tr key={u.userId}>
                    <td className="px-5 py-2 text-slate-800">{u.ad}</td>
                    <td className="px-5 py-2 text-slate-500">{u.rol ?? "—"}</td>
                    <td className="px-5 py-2 text-right tabular-nums text-slate-600">{u.adet}</td>
                    <td className="px-5 py-2 text-right font-semibold tabular-nums text-slate-900">
                      {u.kredi.toLocaleString("tr-TR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ---------------- Paketler ---------------- */}
      {!limitsiz && packages.length > 0 && (
        <Card
          title="Ek kredi paketleri"
          action={<span className="text-xs text-slate-500">Satın alınan krediler devreder</span>}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            {packages.map((p) => (
              <div key={p.key} className="rounded-lg border border-slate-200 p-4">
                <p className="text-2xl font-bold tabular-nums text-slate-900">
                  {p.credits.toLocaleString("tr-TR")}
                </p>
                <p className="text-xs uppercase tracking-wide text-slate-500">kredi</p>
                <p className="mt-3 text-lg font-semibold tabular-nums text-slate-800">
                  {Number(p.price).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} {p.currency}
                </p>
                <p className="text-xs text-slate-500">
                  kredi başına {Number(p.birimFiyat).toLocaleString("tr-TR", { maximumFractionDigits: 3 })}{" "}
                  {p.currency}
                </p>
                <Button
                  variant="gold"
                  size="sm"
                  className="mt-4 w-full"
                  disabled={busy}
                  onClick={() => setBuyKey(p.key)}
                >
                  Satın al
                </Button>
              </div>
            ))}
          </div>
          <p className="-mx-5 -mb-5 mt-0 border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
            Satın alma bir <strong>fatura taslağı</strong> oluşturur; e-Fatura akışına muhasebe
            tarafından gönderilir. Krediler ödemeyi beklemeden anında kullanılabilir.
          </p>
        </Card>
      )}

      {/* ---------------- Otomatik yükleme ---------------- */}
      {c && !limitsiz && (
        <Card title="Otomatik yükleme">
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Açıksa, bakiyeniz bittiğinde seçtiğiniz paket <strong>otomatik satın alınır</strong> ve
              faturalandırılır. Varsayılan olarak <strong>kapalıdır</strong>.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={c.otomatikYuklemePaketi ? "secondary" : "primary"}
                disabled={busy || !c.otomatikYuklemePaketi}
                onClick={() => void handleAutoTopUp(null)}
              >
                Kapalı
              </Button>
              {packages.map((p) => (
                <Button
                  key={p.key}
                  size="sm"
                  variant={c.otomatikYuklemePaketi === p.key ? "gold" : "secondary"}
                  disabled={busy}
                  onClick={() => void handleAutoTopUp(p.key)}
                >
                  {p.credits.toLocaleString("tr-TR")} kredi
                </Button>
              ))}
            </div>
            {c.otomatikYuklemePaketi && (
              <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Otomatik yükleme <strong>açık</strong>: “{c.otomatikYuklemePaketi}” paketi bakiye
                bittiğinde sizin adınıza satın alınacaktır.
              </p>
            )}
          </div>
        </Card>
      )}

      {/* ---------------- Fiyat listesi ---------------- */}
      <Card
        title="Kredi fiyat listesi"
        action={<span className="text-xs text-slate-500">istek başına en fazla {tavan} kredi</span>}
      >
        <div className="-mx-5 -mt-5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2 font-medium">İşlem</th>
                <th className="px-5 py-2 font-medium">Açıklama</th>
                <th className="px-5 py-2 text-right font-medium">Kredi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...costs.values()]
                .sort((a, b) => Number(a.isFree) - Number(b.isFree) || a.credits - b.credits)
                .map((cost) => (
                  <tr key={cost.taskType} className={cost.isFree ? "bg-emerald-50/40" : undefined}>
                    <td className="px-5 py-2 font-mono text-xs text-slate-700">{cost.taskType}</td>
                    <td className="px-5 py-2 text-slate-500">{cost.description ?? "—"}</td>
                    <td className="px-5 py-2 text-right">
                      {cost.isFree ? (
                        <Badge tone="green">ücretsiz</Badge>
                      ) : (
                        <span className="font-semibold tabular-nums text-slate-900">
                          {cost.credits}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="-mx-5 -mb-5 mt-0 border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
          Yeşil satırlar kredi tüketmez: süre hesabı, belge sınıflandırma, belgeden veri çıkarma,
          süre tespiti, içtihat atıf teyidi ve RAG indeksleme. <strong>Avukatın süre kaçırmasına yol
          açabilecek hiçbir işlem krediye bağlanmaz.</strong>
        </p>
      </Card>

      {/* ---------------- Hareket dökümü ---------------- */}
      <Card
        title="Hareket dökümü"
        action={
          txTotalPages > 1 ? (
            <div className="flex items-center gap-2 text-xs">
              <Button
                size="sm"
                variant="ghost"
                disabled={txPage <= 1}
                onClick={() => setTxPage((p) => Math.max(1, p - 1))}
              >
                ‹
              </Button>
              <span className="tabular-nums text-slate-500">
                {txPage} / {txTotalPages}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={txPage >= txTotalPages}
                onClick={() => setTxPage((p) => p + 1)}
              >
                ›
              </Button>
            </div>
          ) : undefined
        }
      >
        {txs.length === 0 ? (
          <div>
            <EmptyState message="Henüz kredi hareketi yok." />
          </div>
        ) : (
          <div className="-mx-5 -mt-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-2 font-medium">Tarih</th>
                  <th className="px-5 py-2 font-medium">Tip</th>
                  <th className="px-5 py-2 font-medium">İşlem</th>
                  <th className="px-5 py-2 font-medium">Kullanıcı</th>
                  <th className="px-5 py-2 text-right font-medium">Kredi</th>
                  <th className="px-5 py-2 text-right font-medium">Bakiye</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {txs.map((t) => (
                  <tr key={t.id}>
                    <td className="whitespace-nowrap px-5 py-2 text-slate-500">
                      {new Date(t.tarih).toLocaleString("tr-TR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-5 py-2">
                      <Badge tone={t.miktar < 0 ? "gray" : "green"}>
                        {CREDIT_TX_LABELS[t.tip] ?? t.tip}
                      </Badge>
                    </td>
                    <td className="px-5 py-2 font-mono text-xs text-slate-600" title={t.not ?? ""}>
                      {t.taskType ?? "—"}
                    </td>
                    <td className="px-5 py-2 text-slate-600">{t.kullanici ?? "—"}</td>
                    <td
                      className={`px-5 py-2 text-right font-semibold tabular-nums ${
                        t.miktar < 0 ? "text-slate-900" : "text-emerald-700"
                      }`}
                    >
                      {t.miktar > 0 ? "+" : ""}
                      {t.miktar.toLocaleString("tr-TR")}
                    </td>
                    <td className="px-5 py-2 text-right tabular-nums text-slate-500">
                      {t.bakiyeSonrasi.toLocaleString("tr-TR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ---------------- Ajan koşu izleri (F2 · E1) ---------------- */}
      <AgentRunsCard />

      {/* ---------------- Satın alma onayı ---------------- */}
      <Modal
        open={buyKey !== null}
        title="Kredi paketi satın alma"
        onClose={() => setBuyKey(null)}
      >
        {(() => {
          const p = packages.find((x) => x.key === buyKey);
          if (!p) return null;
          return (
            <div className="space-y-3 text-sm text-slate-700">
              <p>
                <strong>{p.credits.toLocaleString("tr-TR")} kredi</strong> ·{" "}
                {Number(p.price).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} {p.currency}{" "}
                (KDV hariç)
              </p>
              <p>
                Krediler cüzdanınıza <strong>anında</strong> eklenir ve{" "}
                <strong>süresi dolmaz</strong>. İşlem için bir fatura taslağı oluşturulur; ödeme
                muhasebe akışında tamamlanır.
              </p>
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <Button variant="secondary" onClick={() => setBuyKey(null)} disabled={busy}>
                  Vazgeç
                </Button>
                <Button
                  variant="gold"
                  disabled={busy}
                  onClick={() => void handlePurchase(p.key)}
                >
                  {busy ? "İşleniyor…" : "Satın al"}
                </Button>
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}

function Header() {
  return (
    <header>
      <h1 className="text-2xl font-bold text-slate-900">AI Kullanımı</h1>
      <p className="mt-1 text-sm text-slate-600">
        Dönemsel kredi tüketiminiz, kırılımlar, hareket dökümü ve ek paketler. Kredi tüketmeyen
        işlemler aşağıdaki fiyat listesinde yeşil işaretlidir.
      </p>
    </header>
  );
}

/* ------------------------------------------------------------------ *
 * AJAN KOŞU İZLERİ (F2 · E1 — GET /ai/agent-runs)
 *
 * "Hangi ajan ne zaman ne yaptı" sorusunun görünümü. İçerik DEĞİL ÖZET
 * saklanır (KVKK): girdi özeti maskelenmiş kısa alıntı taşır, tam metin
 * hiçbir koşulda kayda girmez. Rol kapısı yoktur — iz KİRACININDIR.
 * ------------------------------------------------------------------ */

interface AgentRunRow {
  id: string;
  agentKey: string;
  taskType: string;
  status: string;
  model: string | null;
  providerType: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
  piiMasked: boolean;
  errorMessage: string | null;
  createdAt: string;
}

const AGENT_RUN_STATUS: Record<string, { label: string; tone: "green" | "red" | "gray" }> = {
  BASARILI: { label: "Başarılı", tone: "green" },
  BASARISIZ: { label: "Sağlayıcı arızası", tone: "red" },
  REDDEDILDI: { label: "Çıktı reddedildi", tone: "gray" },
};

const AGENT_LABELS: Record<string, string> = {
  DOSYA_ASISTANI: "Dosya Asistanı",
  BELGE_HATTI: "Belge → Aksiyon Hattı",
  DURUSMA_HAZIRLIK: "Duruşma Hazırlığı",
  ICRA_COPILOT: "İcra Copilot",
  DILEKCE_STUDYO: "Dilekçe Stüdyosu",
  ICTIHAT_ARASTIRMA: "İçtihat Araştırma",
  MUVEKKIL_ILETISIM: "Müvekkil İletişimi",
  CAKISMA_KONTROL: "Çıkar Çatışması Kontrolü",
  Vekaletname: "Vekaletname Kapsam Analizi",
  VEKALETNAME: "Vekaletname Kapsam Analizi",
  BILIRKISI: "Bilirkişi Karşılaştırma",
  DELIL_MATRIS: "Delil Matrisi",
  STRATEJI_SIMULASYON: "Strateji ve Simülasyon",
  RISK_DEGERLENDIRME: "Risk Değerlendirmesi",
  FINANS_OZET: "Müvekkil Finans Özeti",
  SOZLESME_INCELEME: "Sözleşme İnceleme",
  RAPOR_YORUM: "Rapor Yorumu",
  GENEL: "Genel",
};

function AgentRunsCard() {
  const [rows, setRows] = useState<AgentRunRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { api } = await import("@/lib/api");
      const res = await api<{ rows: AgentRunRow[]; total: number }>(
        `/ai/agent-runs?take=25${statusFilter ? `&status=${statusFilter}` : ""}`,
      );
      setRows(res.rows);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ajan izleri yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card
      title="Ajan koşu izleri"
      action={
        <div className="flex items-center gap-2">
          <select
            aria-label="İz durumu süz"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1 text-xs"
          >
            <option value="">Tümü</option>
            <option value="BASARILI">Başarılı</option>
            <option value="BASARISIZ">Sağlayıcı arızası</option>
            <option value="REDDEDILDI">Çıktı reddedildi</option>
          </select>
          <span className="text-xs text-slate-500">{total} kayıt</span>
        </div>
      }
    >
      <p className="-mx-5 -mt-5 mb-4 border-b border-slate-100 px-5 py-2.5 text-xs text-slate-500">
        Her AI çağrısının izi: ajan, görev, süre ve durum. Girdi yalnız{" "}
        <strong>maskelenmiş özet</strong> olarak kaydedilir — belge ve yazışma
        metinleri izlere yazılmaz (KVKK).
      </p>
      {loading ? (
        <p className="py-6 text-center text-sm text-slate-500">Yükleniyor…</p>
      ) : error ? (
        <ErrorBox message={error} />
      ) : !rows || rows.length === 0 ? (
        <EmptyState message="Henüz ajan koşusu kaydı yok. Bir AI işlemi başlattığınızda izler burada listelenir." />
      ) : (
        <div className="-mx-5 -mb-5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2 font-medium">Ajan</th>
                <th className="px-5 py-2 font-medium">Durum</th>
                <th className="px-5 py-2 font-medium">Model</th>
                <th className="px-5 py-2 text-right font-medium">Süre</th>
                <th className="px-5 py-2 font-medium">PII maskesi</th>
                <th className="px-5 py-2 font-medium">Zaman</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const st = AGENT_RUN_STATUS[r.status] ?? { label: r.status, tone: "gray" as const };
                return (
                  <tr key={r.id}>
                    <td className="px-5 py-2">
                      <p className="font-medium text-slate-800">
                        {AGENT_LABELS[r.agentKey] ?? r.agentKey}
                      </p>
                      <p className="font-mono text-[11px] text-slate-500">{r.taskType}</p>
                    </td>
                    <td className="px-5 py-2">
                      <Badge tone={st.tone}>{st.label}</Badge>
                      {r.errorMessage && (
                        <p className="mt-0.5 max-w-xs truncate text-[11px] text-slate-500" title={r.errorMessage}>
                          {r.errorMessage}
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-2 font-mono text-[11px] text-slate-600">
                      {r.model ?? "—"}
                    </td>
                    <td className="px-5 py-2 text-right tabular-nums text-slate-600">
                      {r.durationMs === null ? "—" : `${(r.durationMs / 1000).toFixed(1)} sn`}
                    </td>
                    <td className="px-5 py-2">
                      <Badge tone={r.piiMasked ? "blue" : "gray"}>
                        {r.piiMasked ? "maskeli gönderim" : "maske gerekmedi"}
                      </Badge>
                    </td>
                    <td className="px-5 py-2 text-xs text-slate-500">
                      {new Date(r.createdAt).toLocaleString("tr-TR")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
