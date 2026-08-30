"use client";

/**
 * Kredi & Fiyatlar (Modül 26 §Arayüz — Admin paneli).
 *
 * Dört sekme:
 *   1. Tenantlar   — kota / tüketim / mod (GET /credits/tenants)
 *   2. Marj        — maliyet / gelir / marj (GET /credits/margin)  ← İÇ MUHASEBE
 *   3. Fiyat listesi (AiTaskCost)  — kod dağıtımı gerektirmeden değişir
 *   4. Model fiyatları (ModelPrice) — İÇ MALİYET, geçmiş fiyatlar korunur
 *
 * İKİ KURAL, HER SEKMEDE:
 *   • Manuel kredi tahsisi DÖRT-GÖZDÜR: bu ekran işlemi yapmaz, ONAY TALEBİ açar.
 *   • Marj hesaplanamıyorsa (kur/birim fiyat yok) SAYI UYDURULMAZ; uyarı gösterilir.
 *
 * TEMSİLİ VERİ YOKTUR. Uç yanıt vermiyorsa "bu uç henüz hazır değil" denir.
 */

import { useMemo, useState } from "react";
import { useListResource, useResource } from "@/lib/useResource";
import { useMutation } from "@/lib/useMutation";
import { useAdminSession } from "@/lib/session";
import { EP } from "@/lib/endpoints";
import { can, canMutate, isMasked } from "@/lib/rbac";
import { PageGate } from "@/components/RoleGate";
import {
  AI_PROVIDER_TYPE_LABELS,
  AI_TASK_TYPE_LABELS,
  daysAgo,
  fmtCompact,
  fmtMoney,
  fmtNumber,
  fmtPercent,
  labelOf,
  toDateInput,
} from "@/lib/labels";
import { exportCsv } from "@/lib/csv";
import type {
  AdminCreditTenantRow,
  AdminMarginReport,
  AdminModelPrice,
  AdminTaskCost,
} from "@/lib/types";
import {
  Badge,
  BarList,
  Button,
  Card,
  ErrorBox,
  Field,
  InfoBox,
  Input,
  Modal,
  PageHeader,
  ResourceView,
  Select,
  StatCard,
  SuccessBox,
  Table,
  Tabs,
  Textarea,
  WarningBox,
  type Column,
} from "@/components/ui";

type TabKey = "tenants" | "margin" | "costs" | "models";

export default function KredilerPage() {
  return (
    <PageGate action="credits.tenant.view">
      <Credits />
    </PageGate>
  );
}

function Credits() {
  const { role } = useAdminSession();
  const [tab, setTab] = useState<TabKey>("tenants");

  const seeMargin = can(role, "credits.margin.view");
  const seePricing = can(role, "credits.pricing.view");

  const tabs = [
    { key: "tenants" as const, label: "Tenantlar" },
    ...(seeMargin ? [{ key: "margin" as const, label: "Maliyet / Marj" }] : []),
    ...(seePricing ? [{ key: "costs" as const, label: "Kredi fiyat listesi" }] : []),
    ...(seePricing ? [{ key: "models" as const, label: "Model fiyatları" }] : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kredi & Fiyatlar"
        description="Modül 26 — AI kota ve kredi sistemi. Kredi fiyatları ve model maliyet tablosu buradan yönetilir; kod dağıtımı gerekmez."
      />
      <Tabs tabs={tabs} active={tab} onChange={setTab} ariaLabel="Kredi bölümleri" />
      {tab === "tenants" && <TenantsTab />}
      {tab === "margin" && seeMargin && <MarginTab />}
      {tab === "costs" && seePricing && <CostsTab />}
      {tab === "models" && seePricing && <ModelPricesTab />}
    </div>
  );
}

// ===========================================================================
// 1. Tenantlar
// ===========================================================================

function TenantsTab() {
  const { role } = useAdminSession();
  const masked = isMasked(role, "credits.tenant.view");
  const mayAdjust = canMutate(role, "credits.tenant.adjust");

  const [mode, setMode] = useState("");
  const [q, setQ] = useState("");
  const [target, setTarget] = useState<AdminCreditTenantRow | null>(null);

  const rows = useListResource<AdminCreditTenantRow>(EP.credits.tenants, {
    query: { mode, q },
  });

  const totals = useMemo(() => {
    const acc = { tenants: 0, quota: 0, used: 0, purchased: 0, byo: 0 };
    for (const r of rows.data) {
      acc.tenants += 1;
      acc.quota += r.dahilKota;
      acc.used += r.dahilTuketilen;
      acc.purchased += r.satinAlinan;
      if (r.mod !== "YONETILEN") acc.byo += 1;
    }
    return acc;
  }, [rows.data]);

  const columns: Array<Column<AdminCreditTenantRow>> = [
    {
      key: "tenant",
      header: "Büro",
      render: (r) => <span className="text-steel-100">{r.tenantAdi}</span>,
    },
    {
      key: "mod",
      header: "Mod",
      render: (r) =>
        r.mod === "YONETILEN" ? (
          <Badge tone="steel">Yönetilen AI</Badge>
        ) : (
          <Badge tone="green">{r.mod === "BYO_LLM" ? "BYO-LLM (muaf)" : "Sayaçsız"}</Badge>
        ),
    },
    { key: "plan", header: "Plan", render: (r) => r.plan ?? "—" },
    {
      key: "quota",
      header: "Dahil kota",
      align: "right",
      render: (r) => (
        <span className="font-mono">
          {fmtNumber(r.dahilTuketilen)} / {fmtNumber(r.dahilKota)}
        </span>
      ),
    },
    {
      key: "purchased",
      header: "Satın alınan",
      align: "right",
      render: (r) => <span className="font-mono">{fmtNumber(r.satinAlinan)}</span>,
    },
    {
      key: "reserved",
      header: "Rezerve",
      align: "right",
      render: (r) =>
        r.rezerve > 0 ? (
          <Badge tone="yellow">{fmtNumber(r.rezerve)}</Badge>
        ) : (
          <span className="text-steel-600">—</span>
        ),
    },
    {
      key: "left",
      header: "Kalan",
      align: "right",
      render: (r) => (
        <span
          className={`font-mono font-semibold ${
            r.kullanilabilir <= 0
              ? "text-red-300"
              : r.kullanimYuzdesi >= 80
                ? "text-yellow-300"
                : "text-steel-100"
          }`}
        >
          {fmtNumber(r.kullanilabilir)}
        </span>
      ),
    },
    {
      key: "pct",
      header: "Kullanım",
      align: "right",
      render: (r) => (r.mod === "YONETILEN" ? fmtPercent(r.kullanimYuzdesi, 0) : "—"),
    },
    {
      key: "docs",
      header: "Belge hattı",
      align: "right",
      render: (r) => (
        <span className="font-mono text-xs">
          {fmtNumber(r.belgeKullanilan)} / {fmtNumber(r.belgeKotasi)}
        </span>
      ),
    },
    {
      key: "auto",
      header: "Oto. yükleme",
      render: (r) =>
        r.otomatikYukleme ? (
          <Badge tone="yellow">{r.otomatikYukleme}</Badge>
        ) : (
          <span className="text-steel-600">kapalı</span>
        ),
    },
    ...(mayAdjust && !masked
      ? [
          {
            key: "act",
            header: "",
            align: "right" as const,
            render: (r: AdminCreditTenantRow) => (
              <Button size="sm" variant="secondary" onClick={() => setTarget(r)} disabled={!r.tenantId}>
                Düzelt
              </Button>
            ),
          } satisfies Column<AdminCreditTenantRow>,
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Cüzdanlı büro" value={rows.loaded ? fmtNumber(totals.tenants) : "—"} />
        <StatCard label="Toplam dahil kota" value={rows.loaded ? fmtCompact(totals.quota) : "—"} hint="dönem başı tahsis" />
        <StatCard
          label="Dönemde tüketilen"
          value={rows.loaded ? fmtCompact(totals.used) : "—"}
          hint="dahil kotadan"
        />
        <StatCard
          label="Limitsiz mod"
          value={rows.loaded ? fmtNumber(totals.byo) : "—"}
          tone={totals.byo > 0 ? "green" : "steel"}
          hint="BYO-LLM / sayaçsız büro"
        />
      </div>

      <Card bodyClassName="p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Mod">
            <Select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="">Tümü</option>
              <option value="YONETILEN">Yönetilen AI</option>
              <option value="BYO_LLM">BYO-LLM (muaf)</option>
            </Select>
          </Field>
          <Field label="Büro adı" hint={masked ? "Takma adlı görünümde arama kapalıdır." : undefined}>
            <Input value={q} onChange={(e) => setQ(e.target.value)} disabled={masked} placeholder="Ara…" />
          </Field>
          <div className="flex items-end">
            <Button
              variant="secondary"
              disabled={rows.data.length === 0}
              onClick={() =>
                exportCsv("kredi-tenantlar", rows.data, [
                  { key: "tenant", header: "Büro", value: (r) => r.tenantAdi },
                  { key: "mod", header: "Mod", value: (r) => r.mod },
                  { key: "plan", header: "Plan", value: (r) => r.plan ?? "" },
                  { key: "dahilKota", header: "Dahil kota", value: (r) => r.dahilKota },
                  { key: "dahilTuketilen", header: "Tüketilen", value: (r) => r.dahilTuketilen },
                  { key: "satinAlinan", header: "Satın alınan", value: (r) => r.satinAlinan },
                  { key: "rezerve", header: "Rezerve", value: (r) => r.rezerve },
                  { key: "kalan", header: "Kalan", value: (r) => r.kullanilabilir },
                  { key: "belge", header: "Belge kullanılan", value: (r) => r.belgeKullanilan },
                ])
              }
            >
              CSV dışa aktar
            </Button>
          </div>
        </div>
      </Card>

      <WarningBox title="Kota dolduğunda hizmet KESİLMEZ">
        %100&apos;e ulaşan büroda <strong>yalnızca kredili AI işlemleri durur</strong>. Dosya,
        müvekkil, duruşma, süre, görev ve belge akışları — süre hesabı ve belge sınıflandırma
        dâhil — çalışmaya devam eder. Anormal tüketimde <strong>yavaşlatma</strong> uygulanır,
        kesme yapılmaz.
      </WarningBox>

      <Card title="Kredi cüzdanları" subtitle="Kaynak: GET /credits/tenants">
        <ResourceView
          loading={rows.loading}
          missing={rows.missing}
          forbidden={rows.forbidden}
          error={rows.error}
          empty={rows.empty}
          endpoint={EP.credits.tenants}
          what="Kredi cüzdanları"
          emptyMessage="Kredi cüzdanı tanımlı büro yok."
        >
          <Table columns={columns} rows={rows.data} rowKey={(r, i) => r.tenantId ?? String(i)} dense />
        </ResourceView>
      </Card>

      {target && (
        <AdjustModal row={target} onClose={() => setTarget(null)} onDone={() => rows.reload()} />
      )}
    </div>
  );
}

/**
 * Manuel kredi tahsisi / kota düzeltmesi.
 *
 * DÖRT-GÖZ: bu form işlemi UYGULAMAZ, onay talebi açar. Talebi açan kişi kendi
 * talebini onaylayamaz; uygulama farklı bir yetkilinin onayından sonra olur.
 */
function AdjustModal({
  row,
  onClose,
  onDone,
}: {
  row: AdminCreditTenantRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const m = useMutation();
  const [delta, setDelta] = useState("");
  const [included, setIncluded] = useState("");
  const [docs, setDocs] = useState("");
  const [byo, setByo] = useState<"" | "true" | "false">("");
  const [renew, setRenew] = useState(false);
  const [reason, setReason] = useState("");

  const reasonOk = reason.trim().length >= 10;
  const hasChange =
    delta.trim() !== "" || included.trim() !== "" || docs.trim() !== "" || byo !== "" || renew;

  async function submit() {
    if (!row.tenantId) return;
    const body: Record<string, unknown> = { reason: reason.trim() };
    if (delta.trim() !== "") body.deltaCredits = Number(delta);
    if (included.trim() !== "") body.includedCredits = Number(included);
    if (docs.trim() !== "") body.documentQuota = Number(docs);
    if (byo !== "") body.byoLlm = byo === "true";
    if (renew) body.renewPeriod = true;

    const ok = await m.run(EP.credits.adjust(row.tenantId), { method: "PATCH", body });
    if (ok) onDone();
  }

  return (
    <Modal open title={`Kredi düzeltmesi — ${row.tenantAdi}`} onClose={onClose} wide>
      <div className="space-y-4">
        <InfoBox title="Dört-göz onayı gerekir">
          Bu form işlemi <strong>uygulamaz</strong>; bir onay talebi açar. Talep,{" "}
          <strong>sizden farklı</strong> bir yetkili tarafından onaylanana kadar hiçbir kredi
          yazılmaz. Talep 72 saatte düşer. Uygulanan her düzeltme{" "}
          <strong>PlatformAuditLog</strong>&apos;a ve büronun kredi hareket defterine yazılır.
        </InfoBox>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Kredi ekle / çıkar"
            hint="Satın alınmış bakiyeye eklenir. Negatif değer düşer; bakiye negatife çekilemez."
          >
            <Input
              type="number"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              placeholder="örn. 2000 veya -500"
            />
          </Field>
          <Field label="Dahil kota (dönemlik)" hint={`Şu an ${fmtNumber(row.dahilKota)} kredi. Enterprise sözleşmeleri için.`}>
            <Input
              type="number"
              value={included}
              onChange={(e) => setIncluded(e.target.value)}
              placeholder={String(row.dahilKota)}
            />
          </Field>
          <Field label="Belge hattı kotası" hint={`Şu an ${fmtNumber(row.belgeKotasi)} belge.`}>
            <Input
              type="number"
              value={docs}
              onChange={(e) => setDocs(e.target.value)}
              placeholder={String(row.belgeKotasi)}
            />
          </Field>
          <Field
            label="BYO-LLM muafiyeti"
            hint="Açıldığında kredi kapısı bu büroda TAMAMEN devre dışı kalır; AI maliyeti büroya geçer."
          >
            <Select value={byo} onChange={(e) => setByo(e.target.value as "" | "true" | "false")}>
              <option value="">Değiştirme (şu an: {row.mod})</option>
              <option value="true">Açık — limitsiz mod</option>
              <option value="false">Kapalı — yönetilen AI</option>
            </Select>
          </Field>
        </div>

        <label className="flex items-start gap-2 text-sm text-steel-300">
          <input
            type="checkbox"
            checked={renew}
            onChange={(e) => setRenew(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Dönemi yenile — <strong>dahil kota sıfırlanır ve devretmez</strong>; satın alınan
            bakiye korunur.
          </span>
        </label>

        <Field label="Gerekçe (zorunlu, en az 10 karakter)" hint="Denetim izine bu metin yazılır.">
          <Textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Örn. Kesinti telafisi olarak 2.000 kredi tahsisi — destek kaydı #1234."
          />
        </Field>

        {m.error && <ErrorBox message={m.error} />}
        {m.success && <SuccessBox message={m.success} />}

        <div className="flex justify-end gap-2 border-t border-steel-800 pt-4">
          <Button variant="secondary" onClick={onClose}>
            Kapat
          </Button>
          <Button onClick={() => void submit()} disabled={m.loading || !reasonOk || !hasChange}>
            {m.loading ? "Gönderiliyor…" : "Onay talebi oluştur"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ===========================================================================
// 2. Maliyet / Marj
// ===========================================================================

function MarginTab() {
  const [from, setFrom] = useState(toDateInput(daysAgo(29)));
  const [to, setTo] = useState(toDateInput(new Date()));

  const report = useResource<AdminMarginReport>(EP.credits.margin, {
    query: { from, to },
  });
  const data = report.data;

  const columns: Array<Column<AdminMarginReport["items"][number]>> = [
    { key: "tenant", header: "Büro", render: (r) => <span className="text-steel-100">{r.tenantAdi}</span> },
    {
      key: "mod",
      header: "Mod",
      render: (r) =>
        r.mod === "YONETILEN" ? <Badge tone="steel">Yönetilen</Badge> : <Badge tone="green">BYO-LLM</Badge>,
    },
    { key: "calls", header: "Çağrı", align: "right", render: (r) => fmtNumber(r.cagri) },
    {
      key: "unpriced",
      header: "Fiyatlanamayan",
      align: "right",
      render: (r) =>
        r.fiyatlanamayanCagri > 0 ? (
          <Badge tone="yellow">{fmtNumber(r.fiyatlanamayanCagri)}</Badge>
        ) : (
          <span className="text-steel-600">—</span>
        ),
    },
    {
      key: "tokens",
      header: "Token (g/ç)",
      align: "right",
      render: (r) => (
        <span className="font-mono text-xs">
          {fmtCompact(r.girdiToken)} / {fmtCompact(r.ciktiToken)}
        </span>
      ),
    },
    {
      key: "cost",
      header: "Maliyet (USD)",
      align: "right",
      render: (r) => <span className="font-mono">{fmtMoney(r.maliyetUsd, "USD")}</span>,
    },
    {
      key: "credits",
      header: "Tahsil edilen kredi",
      align: "right",
      render: (r) => fmtNumber(r.tahsilEdilenKredi),
    },
    {
      key: "revenue",
      header: "Gelir (TL)",
      align: "right",
      render: (r) => (r.gelirTl ? fmtMoney(r.gelirTl, "TRY") : <span className="text-steel-600">—</span>),
    },
    {
      key: "margin",
      header: "Marj",
      align: "right",
      render: (r) =>
        r.marjTl === null ? (
          <span className="text-steel-600">—</span>
        ) : (
          <span className={Number(r.marjTl) < 0 ? "text-red-300" : "text-green-300"}>
            {fmtMoney(r.marjTl, "TRY")}
            {r.marjYuzde && <span className="ml-1 text-xs text-steel-500">({r.marjYuzde}%)</span>}
          </span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <WarningBox title="İÇ MUHASEBE — kullanıcıya gösterilmez">
        Modül 25&apos;in &quot;panel token sayar, fiyatlamaz&quot; ilkesi{" "}
        <strong>yalnızca BYO-LLM büroları</strong> için geçerlidir. Yönetilen AI modunda maliyet
        NomosOS&apos;undur ve görünür olmalıdır. BYO-LLM satırlarında maliyet büronun kendi
        sağlayıcı hesabındadır; o satırlarda <strong>marj hesaplanmaz</strong>.
      </WarningBox>

      <Card bodyClassName="p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Başlangıç">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Bitiş">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <div className="flex items-end">
            <Button
              variant="secondary"
              onClick={() => {
                setFrom(toDateInput(daysAgo(29)));
                setTo(toDateInput(new Date()));
              }}
            >
              Son 30 gün
            </Button>
          </div>
        </div>
      </Card>

      <ResourceView
        loading={report.loading}
        missing={report.missing}
        forbidden={report.forbidden}
        error={report.error}
        empty={report.loaded && (data?.items.length ?? 0) === 0}
        endpoint={EP.credits.margin}
        what="Marj raporu"
        emptyMessage="Seçili aralıkta AI kullanımı yok."
      >
        {data && (
          <div className="space-y-4">
            {!data.marjHesaplanabilir && data.marjUyarisi && (
              <ErrorBox message={data.marjUyarisi} />
            )}

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Toplam maliyet" value={fmtMoney(data.toplam.maliyetUsd, "USD")} hint="ModelPrice üzerinden" />
              <StatCard label="Tahsil edilen kredi" value={fmtCompact(data.toplam.tahsilEdilenKredi)} />
              <StatCard
                label="Gelir"
                value={data.toplam.gelirTl ? fmtMoney(data.toplam.gelirTl, "TRY") : "—"}
                hint={
                  data.parametreler.krediBirimFiyati
                    ? `kredi başına ${data.parametreler.krediBirimFiyati} ${data.parametreler.paraBirimi}`
                    : "birim fiyat tanımlı değil"
                }
              />
              <StatCard
                label="Marj"
                value={data.toplam.marjTl ? fmtMoney(data.toplam.marjTl, "TRY") : "—"}
                tone={data.toplam.marjTl && Number(data.toplam.marjTl) < 0 ? "red" : "green"}
                hint={data.parametreler.usdTryKuru ? `USD/TRY ${data.parametreler.usdTryKuru}` : "kur tanımlı değil"}
              />
            </div>

            <InfoBox title="Hesap parametreleri">
              {data.parametreler.kaynak} — kredi birim fiyatı{" "}
              <strong>{data.parametreler.krediBirimFiyati ?? "tanımsız"}</strong>{" "}
              {data.parametreler.paraBirimi}, USD/TRY{" "}
              <strong>{data.parametreler.usdTryKuru ?? "tanımsız"}</strong>. Maliyet USD, gelir TL
              cinsindedir; <strong>kur olmadan iki para birimi toplanmaz</strong>.
            </InfoBox>

            {data.items.length > 0 && (
              <BarList
                items={data.items.slice(0, 10).map((r, i) => ({
                  label: r.tenantAdi,
                  value: Number(r.maliyetUsd),
                  hint: fmtMoney(r.maliyetUsd, "USD"),
                  tone: (i === 0 ? "accent" : "steel") as "accent" | "steel",
                }))}
              />
            )}

            <Card title="Tenant kırılımı" subtitle="Maliyete göre azalan">
              <Table
                columns={columns}
                rows={data.items}
                rowKey={(r, i) => r.tenantId ?? `${r.tenantAdi}-${i}`}
                dense
              />
            </Card>

            <p className="text-xs text-steel-500">{data.not}</p>
          </div>
        )}
      </ResourceView>
    </div>
  );
}

// ===========================================================================
// 3. Kredi fiyat listesi (AiTaskCost)
// ===========================================================================

function CostsTab() {
  const { role } = useAdminSession();
  const mayWrite = canMutate(role, "credits.pricing.write");
  const m = useMutation();

  const rows = useListResource<AdminTaskCost>(EP.credits.costs);
  const [edit, setEdit] = useState<AdminTaskCost | null>(null);
  const [credits, setCredits] = useState("0");
  const [isFree, setIsFree] = useState(false);
  const [description, setDescription] = useState("");

  function open(row: AdminTaskCost) {
    setEdit(row);
    setCredits(String(row.credits));
    setIsFree(row.isFree);
    setDescription(row.description ?? "");
    m.reset();
  }

  async function save() {
    if (!edit) return;
    const ok = await m.run(
      EP.credits.costs,
      {
        method: "PATCH",
        body: {
          taskType: edit.taskType,
          credits: Number(credits) || 0,
          isFree,
          description: description.trim() || undefined,
        },
      },
      { successMessage: "Fiyat güncellendi ve anında yürürlüğe girdi." },
    );
    if (ok) {
      rows.reload();
      setEdit(null);
    }
  }

  const columns: Array<Column<AdminTaskCost>> = [
    {
      key: "task",
      header: "Görev",
      render: (r) => (
        <div>
          <p className="text-steel-100">{labelOf(AI_TASK_TYPE_LABELS, r.taskType)}</p>
          <p className="font-mono text-xs text-steel-500">{r.taskType}</p>
        </div>
      ),
    },
    { key: "desc", header: "Açıklama", render: (r) => <span className="text-steel-400">{r.description ?? "—"}</span> },
    {
      key: "credits",
      header: "Kredi",
      align: "right",
      render: (r) =>
        r.isFree ? <Badge tone="green">ücretsiz</Badge> : <span className="font-mono font-semibold">{r.credits}</span>,
    },
    ...(mayWrite
      ? [
          {
            key: "act",
            header: "",
            align: "right" as const,
            render: (r: AdminTaskCost) => (
              <Button size="sm" variant="secondary" onClick={() => open(r)}>
                Düzenle
              </Button>
            ),
          } satisfies Column<AdminTaskCost>,
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <InfoBox title="Ücretsiz liste koda gömülü DEĞİLDİR">
        Kredi motoru <code>AiTaskCost.isFree</code> alanını okur (iş kuralı 3). Bir satırı ücretsize
        çevirmek o görevi anında bedava yapar; kod dağıtımı gerekmez.{" "}
        <strong>Fiyat değişikliği geriye dönük uygulanmaz</strong> — geçmiş hareketler eski
        fiyatla kalır.
      </InfoBox>

      <WarningBox title="Ücretsiz kalması gerekenler">
        Belge sınıflandırma, belgeden veri çıkarma, süre tespiti, atıf doğrulama ve gömme/RAG
        indeksleme kredi tüketmemelidir. <strong>Avukatın süre kaçırmasına yol açabilecek hiçbir
        işlem krediye bağlanmaz</strong>; belge hattını ücretlendirmek büroyu belge yüklemekten
        kaçındırır ve belge→otomatik aksiyon döngüsünü öldürür.
      </WarningBox>

      <Card title="Görev başına kredi fiyatı" subtitle="Kaynak: GET /credits/costs (AiTaskCost)">
        <ResourceView
          loading={rows.loading}
          missing={rows.missing}
          forbidden={rows.forbidden}
          error={rows.error}
          empty={rows.empty}
          endpoint={EP.credits.costs}
          what="Kredi fiyat listesi"
          emptyMessage="Fiyat satırı yok."
        >
          <Table columns={columns} rows={rows.data} rowKey={(r) => r.taskType} dense />
        </ResourceView>
      </Card>

      {edit && (
        <Modal open title={`Fiyat — ${edit.taskType}`} onClose={() => setEdit(null)}>
          <div className="space-y-4">
            <Field label="Kredi" hint="isFree açıkken bu değer yok sayılır ve 0 yazılır.">
              <Input
                type="number"
                value={credits}
                onChange={(e) => setCredits(e.target.value)}
                disabled={isFree}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm text-steel-300">
              <input type="checkbox" checked={isFree} onChange={(e) => setIsFree(e.target.checked)} />
              Ücretsiz (kredi tüketmez)
            </label>
            <Field label="Açıklama">
              <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            {m.error && <ErrorBox message={m.error} />}
            {m.success && <SuccessBox message={m.success} />}
            <div className="flex justify-end gap-2 border-t border-steel-800 pt-4">
              <Button variant="secondary" onClick={() => setEdit(null)}>
                Kapat
              </Button>
              <Button onClick={() => void save()} disabled={m.loading}>
                {m.loading ? "Kaydediliyor…" : "Kaydet"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ===========================================================================
// 4. Model fiyat tablosu (ModelPrice)
// ===========================================================================

const PROVIDER_OPTIONS = ["ANTHROPIC", "OPENAI_COMPAT", "GEMINI", "OLLAMA", "CUSTOM"] as const;

function ModelPricesTab() {
  const { role } = useAdminSession();
  const mayWrite = canMutate(role, "credits.pricing.write");
  const m = useMutation();

  const rows = useListResource<AdminModelPrice>(EP.modelPrices);
  const [open, setOpen] = useState(false);
  const [providerType, setProviderType] = useState<string>("ANTHROPIC");
  const [model, setModel] = useState("");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [effectiveFrom, setEffectiveFrom] = useState(toDateInput(new Date()));

  async function save() {
    const ok = await m.run(
      EP.modelPrices,
      {
        method: "POST",
        body: {
          providerType,
          model: model.trim(),
          inputPricePer1M: input.trim(),
          outputPricePer1M: output.trim(),
          currency,
          effectiveFrom: new Date(`${effectiveFrom}T00:00:00.000Z`).toISOString(),
        },
      },
      { successMessage: "Model fiyatı kaydedildi. Geçmiş satırlar korundu." },
    );
    if (ok) {
      rows.reload();
      setOpen(false);
    }
  }

  const columns: Array<Column<AdminModelPrice>> = [
    {
      key: "provider",
      header: "Sağlayıcı",
      render: (r) => <Badge tone="steel">{labelOf(AI_PROVIDER_TYPE_LABELS, r.providerType)}</Badge>,
    },
    { key: "model", header: "Model", render: (r) => <span className="font-mono text-xs">{r.model}</span> },
    {
      key: "in",
      header: "Girdi / 1M",
      align: "right",
      render: (r) => <span className="font-mono">{fmtMoney(r.inputPricePer1M, r.currency)}</span>,
    },
    {
      key: "out",
      header: "Çıktı / 1M",
      align: "right",
      render: (r) => <span className="font-mono">{fmtMoney(r.outputPricePer1M, r.currency)}</span>,
    },
    {
      key: "from",
      header: "Yürürlük",
      render: (r) => (
        <span className="text-steel-400">{new Date(r.effectiveFrom).toLocaleDateString("tr-TR")}</span>
      ),
    },
    {
      key: "now",
      header: "Durum",
      render: (r) =>
        r.yururlukte ? <Badge tone="green">yürürlükte</Badge> : <span className="text-steel-600">geçmiş / ileri tarihli</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <WarningBox title="İÇ MALİYET tablosu — kullanıcıya gösterilmez">
        Bu fiyatlar <strong>NomosOS&apos;un sağlayıcıya ödediği</strong> bedeldir; büro arayüzünde
        hiçbir yerde geçmez. Fiyat değişikliği <strong>geriye dönük uygulanmaz</strong>: yeni fiyat
        yeni bir yürürlük satırı olarak eklenir, eski satır korunur ve geçmiş çağrıların maliyeti
        kendi tarihindeki fiyatla hesaplanmış kalır (iş kuralı 10).
      </WarningBox>

      <Card
        title="Model fiyatları"
        subtitle="Kaynak: GET /model-prices (ModelPrice)"
        action={
          mayWrite ? (
            <Button
              onClick={() => {
                m.reset();
                setOpen(true);
              }}
            >
              + Yeni fiyat satırı
            </Button>
          ) : undefined
        }
      >
        <ResourceView
          loading={rows.loading}
          missing={rows.missing}
          forbidden={rows.forbidden}
          error={rows.error}
          empty={rows.empty}
          endpoint={EP.modelPrices}
          what="Model fiyat tablosu"
          emptyMessage="Fiyat satırı yok."
        >
          <Table columns={columns} rows={rows.data} rowKey={(r) => r.id} dense />
        </ResourceView>
      </Card>

      {open && (
        <Modal open title="Model fiyatı ekle / güncelle" onClose={() => setOpen(false)}>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Sağlayıcı">
                <Select value={providerType} onChange={(e) => setProviderType(e.target.value)}>
                  {PROVIDER_OPTIONS.map((p) => (
                    <option key={p} value={p}>
                      {labelOf(AI_PROVIDER_TYPE_LABELS, p)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Model" hint="AiUsageLog.model ile birebir aynı yazılmalıdır.">
                <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="claude-sonnet-5" />
              </Field>
              <Field label="Girdi fiyatı / 1M token" hint="En fazla 4 ondalık hane.">
                <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="2.0000" />
              </Field>
              <Field label="Çıktı fiyatı / 1M token">
                <Input value={output} onChange={(e) => setOutput(e.target.value)} placeholder="10.0000" />
              </Field>
              <Field label="Para birimi">
                <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="TRY">TRY</option>
                </Select>
              </Field>
              <Field label="Yürürlük tarihi" hint="Geçmiş satırlar SİLİNMEZ; bu tarihten itibaren geçerli olur.">
                <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
              </Field>
            </div>
            {m.error && <ErrorBox message={m.error} />}
            {m.success && <SuccessBox message={m.success} />}
            <div className="flex justify-end gap-2 border-t border-steel-800 pt-4">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Kapat
              </Button>
              <Button
                onClick={() => void save()}
                disabled={m.loading || !model.trim() || !input.trim() || !output.trim()}
              >
                {m.loading ? "Kaydediliyor…" : "Kaydet"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
