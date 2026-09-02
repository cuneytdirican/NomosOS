"use client";

/**
 * Tenant listesi — GET /api/admin/v1/tenants?q=&status=&plan=
 * Filtreleme SUNUCUDA yapılır; panel yalnız sorgu parametresi geçirir.
 *
 * ANALYST_READONLY (🔒) için tenant listesi maskelidir: büro adı, e-posta ve tekil
 * sayaçlar gösterilmez; yalnız plan/durum agregatı görünür.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useListResource } from "@/lib/useResource";
import { useDebounced } from "@/lib/useDebounced";
import { useAdminSession } from "@/lib/session";
import { adminApi, errorMessage } from "@/lib/api";
import { EP } from "@/lib/endpoints";
import { isMasked } from "@/lib/rbac";
import { PageGate } from "@/components/RoleGate";
import {
  PLAN_LABELS,
  PLAN_TONES,
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_STATUS_LABELS,
  SUBSCRIPTION_STATUS_TONES,
  fmtBytes,
  fmtCompact,
  fmtDateTime,
  fmtMoney,
  fmtNumber,
  labelOf,
  toneOf,
} from "@/lib/labels";
import { exportCsv } from "@/lib/csv";
import type { AdminTenantRow } from "@/lib/types";
import {
  Badge,
  BarList,
  Button,
  Card,
  Field,
  InfoBox,
  Input,
  Modal,
  PageHeader,
  ResourceView,
  Select,
  Table,
  type Column,
} from "@/components/ui";

const KNOWN_PLANS = ["SOLO", "BURO", "ENTERPRISE"];

/**
 * YENİ KİRAÇI AÇMA (D5 / M2) — dört-göz TENANT_CREATE talebi.
 * Kiracı + ilk ADMIN kullanıcı + TRIAL abonelik İKİNCİ İMZA ile kurulur;
 * burada yalnızca talep açılır. Parola talep anında sunucuda hash'lenir.
 */
function CreateTenantButton() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    planKey: "BURO",
    seats: "3",
    adminEmail: "",
    adminFullName: "",
    password: "",
    reason: "",
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await adminApi(EP.tenants.create, {
        method: "POST",
        body: {
          name: form.name.trim(),
          planKey: form.planKey,
          seats: Number(form.seats) || 1,
          adminEmail: form.adminEmail.trim(),
          adminFullName: form.adminFullName.trim(),
          password: form.password,
          reason: form.reason.trim(),
        },
      });
      setOk(
        "Talep açıldı. Kiracı, ilk yönetici ve TRIAL abonelik İKİNCİ İMZA ile kurulur — Onaylar sayfasını izleyin."
      );
      setOpen(false);
      setForm({ name: "", planKey: "BURO", seats: "3", adminEmail: "", adminFullName: "", password: "", reason: "" });
    } catch (e) {
      setErr(errorMessage(e, "Talep açılamadı."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {ok ? (
        <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          {ok}
        </p>
      ) : null}
      <Button onClick={() => setOpen(true)}>Yeni Kiracı</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Yeni Kiracı Aç (dört-göz)">
        {err ? (
          <p className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{err}</p>
        ) : null}
        <div className="space-y-3">
          <p className="text-xs text-steel-400">
            Bu işlem tek imzayla tamamlanmaz: talep Onaylar kuyruğuna düşer, ikinci yetkili onaylayınca
            büro + ilk yönetici + 14 günlik TRIAL abonelik TEK İŞLEMDE kurulur. Parolayı büroya iletmek
            talebi açan yöneticinin sorumluluğudur.
          </p>
          <Field label="Büro adı">
            <Input value={form.name} onChange={set("name")} placeholder="Örn. Yılmaz Hukuk Bürosu" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Plan">
              <Select value={form.planKey} onChange={set("planKey")}>
                {KNOWN_PLANS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Koltuk sayısı">
              <Input type="number" min={1} value={form.seats} onChange={set("seats")} />
            </Field>
          </div>
          <Field label="İlk yönetici — ad soyad">
            <Input value={form.adminFullName} onChange={set("adminFullName")} placeholder="Örn. Ayşe Yılmaz" />
          </Field>
          <Field label="İlk yönetici — e-posta">
            <Input type="email" value={form.adminEmail} onChange={set("adminEmail")} placeholder="ayse@ornekburo.com" />
          </Field>
          <Field label="İlk parola" hint="En az 10 karakter; talepte hash'lenir, düz metin saklanmaz.">
            <Input type="password" value={form.password} onChange={set("password")} />
          </Field>
          <Field label="Gerekçe (denetim izine yazılır)">
            <Input value={form.reason} onChange={set("reason")} placeholder="En az 10 karakter" />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Vazgeç
            </Button>
            <Button onClick={() => void submit()} disabled={busy}>
              {busy ? "Gönderiliyor…" : "Talebi Aç"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export default function TenantlarPage() {
  return (
    <PageGate action="tenant.view">
      <TenantList />
    </PageGate>
  );
}

function TenantList() {
  const { role } = useAdminSession();
  const masked = isMasked(role, "tenant.view");

  const [search, setSearch] = useState("");
  const [plan, setPlan] = useState("");
  const [status, setStatus] = useState("");
  const q = useDebounced(search);

  const res = useListResource<AdminTenantRow>(EP.tenants.list, {
    query: { q: q || undefined, plan: plan || undefined, status: status || undefined },
  });

  const planOptions = useMemo(() => {
    const set = new Set<string>(KNOWN_PLANS);
    for (const t of res.data) if (t.planKey) set.add(t.planKey);
    return [...set];
  }, [res.data]);

  const columns: Array<Column<AdminTenantRow>> = [
    {
      key: "name",
      header: "Büro",
      render: (t) => (
        <div>
          <Link
            href={`/tenantlar/${t.id}`}
            className="font-medium text-steel-50 hover:text-accent-300"
          >
            {t.name}
          </Link>
          <p className="font-mono text-[11px] text-steel-600">{t.id}</p>
        </div>
      ),
    },
    {
      key: "plan",
      header: "Plan / Durum",
      render: (t) => (
        <div className="flex flex-wrap gap-1.5">
          {t.planKey ? (
            <Badge tone={toneOf(PLAN_TONES, t.planKey)}>{labelOf(PLAN_LABELS, t.planKey)}</Badge>
          ) : (
            <span className="text-xs text-steel-600">abonelik yok</span>
          )}
          {t.status && (
            <Badge tone={toneOf(SUBSCRIPTION_STATUS_TONES, t.status)}>
              {labelOf(SUBSCRIPTION_STATUS_LABELS, t.status)}
            </Badge>
          )}
        </div>
      ),
    },
    { key: "seats", header: "Koltuk", align: "right", render: (t) => fmtNumber(t.seats) },
    { key: "users", header: "Kullanıcı", align: "right", render: (t) => fmtNumber(t.userCount) },
    { key: "cases", header: "Dosya", align: "right", render: (t) => fmtNumber(t.caseCount) },
    { key: "storage", header: "Depo", align: "right", render: (t) => fmtBytes(t.storageBytes) },
    {
      key: "ai",
      header: "AI çağrısı",
      align: "right",
      render: (t) => <span className="font-mono text-steel-200">{fmtCompact(t.aiCallCount)}</span>,
    },
    { key: "mrr", header: "MRR", align: "right", render: (t) => fmtMoney(t.mrr) },
    {
      key: "last",
      header: "Son aktivite",
      render: (t) => (
        <span className="text-xs text-steel-400">{fmtDateTime(t.lastActivityAt)}</span>
      ),
    },
  ];

  if (masked) return <MaskedTenantView state={res} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tenantlar"
        description="Hukuk bürolarının platform kaydı. Panel yalnız sayaç ve üstveri görür; müvekkil, dosya ve belge içeriğine erişimi yoktur."
        action={
          <div className="flex items-center gap-2">
            <CreateTenantButton />
            <Button
              variant="secondary"
              disabled={res.data.length === 0}
            onClick={() =>
              exportCsv("tenantlar", res.data, [
                { key: "id", header: "Tenant ID", value: (t) => t.id },
                { key: "name", header: "Büro", value: (t) => t.name },
                { key: "plan", header: "Plan", value: (t) => t.planKey ?? "" },
                { key: "status", header: "Durum", value: (t) => t.status ?? "" },
                { key: "seats", header: "Koltuk", value: (t) => t.seats ?? "" },
                { key: "users", header: "Kullanıcı", value: (t) => t.userCount ?? "" },
                { key: "cases", header: "Dosya", value: (t) => t.caseCount ?? "" },
                { key: "storage", header: "Depolama (bayt)", value: (t) => String(t.storageBytes ?? "") },
                { key: "ai", header: "AI çağrısı", value: (t) => t.aiCallCount ?? "" },
                { key: "mrr", header: "MRR", value: (t) => String(t.mrr ?? "") },
              ])
            }
          >
            CSV dışa aktar
          </Button>
          </div>
        }
      />

      <Card bodyClassName="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Arama" hint="Sunucuya ?q= olarak gönderilir.">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Büro adı veya tenant kimliği"
            />
          </Field>
          <Field label="Plan">
            <Select value={plan} onChange={(e) => setPlan(e.target.value)}>
              <option value="">Tümü</option>
              {planOptions.map((p) => (
                <option key={p} value={p}>
                  {labelOf(PLAN_LABELS, p)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Abonelik durumu">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Tümü</option>
              {SUBSCRIPTION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {SUBSCRIPTION_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <Button
              variant="secondary"
              onClick={() => {
                setSearch("");
                setPlan("");
                setStatus("");
              }}
            >
              Filtreleri temizle
            </Button>
          </div>
        </div>
      </Card>

      <Card
        title={res.loaded ? `${res.data.length} tenant` : "Tenantlar"}
        subtitle="Büro adına tıklayarak detay sekmelerine geçebilirsiniz."
      >
        <ResourceView
          loading={res.loading}
          missing={res.missing}
          forbidden={res.forbidden}
          error={res.error}
          empty={res.empty}
          endpoint={EP.tenants.list}
          what="Tenant listesi"
          emptyMessage="Filtrelere uyan tenant bulunamadı."
        >
          <Table columns={columns} rows={res.data} rowKey={(t) => t.id} dense />
        </ResourceView>
      </Card>
    </div>
  );
}

/** 🔒 ANALYST_READONLY görünümü — büro adı, e-posta ve tekil sayaç yoktur. */
function MaskedTenantView({
  state,
}: {
  state: ReturnType<typeof useListResource<AdminTenantRow>>;
}) {
  const byPlan = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of state.data) map.set(t.planKey ?? "—", (map.get(t.planKey ?? "—") ?? 0) + 1);
    return [...map.entries()].map(([plan, count]) => ({ plan, count }));
  }, [state.data]);

  const byStatus = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of state.data) map.set(t.status ?? "—", (map.get(t.status ?? "—") ?? 0) + 1);
    return [...map.entries()].map(([status, count]) => ({ status, count }));
  }, [state.data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tenant Dağılımı"
        description="Analist rolünde tenant listesi maskelidir: yalnız plan ve durum agregatı gösterilir."
      />
      <InfoBox title="Maskeli görünüm (🔒)">
        Büro adı, e-posta, müvekkil ve dosya verisi bu rolde <strong>hiçbir koşulda</strong>{" "}
        gösterilmez; sunucu da bu alanları döndürmez. Bu rolde hiçbir yazma düğmesi render edilmez
        ve mutasyon uçları 403 verir.
      </InfoBox>
      <ResourceView
        loading={state.loading}
        missing={state.missing}
        forbidden={state.forbidden}
        error={state.error}
        empty={state.empty}
        endpoint={EP.tenants.list}
        what="Tenant dağılımı"
        emptyMessage="Gösterilecek tenant kaydı yok."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Plan dağılımı">
            <BarList
              items={byPlan.map((p) => ({
                label: labelOf(PLAN_LABELS, p.plan),
                value: p.count,
                hint: `${p.count} tenant`,
              }))}
            />
          </Card>
          <Card title="Abonelik durumu dağılımı">
            <BarList
              items={byStatus.map((s) => ({
                label: labelOf(SUBSCRIPTION_STATUS_LABELS, s.status),
                value: s.count,
                hint: `${s.count} tenant`,
                tone: "green" as const,
              }))}
            />
          </Card>
        </div>
      </ResourceView>
    </div>
  );
}
