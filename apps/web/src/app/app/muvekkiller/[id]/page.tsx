"use client";

/**
 * Müvekkil kartı — Modül 01 (Faz 1 kesiti).
 *
 * GET    /clients/:id                       — kart detayı (contacts/cases gömülü gelebilir)
 * PATCH  /clients/:id                       — Genel sekmesi formu
 * POST   /clients/:id/contacts              — ilgili kişi ekle
 * PATCH  /clients/:id/contacts/:contactId   — ilgili kişi güncelle
 * DELETE /clients/:id/contacts/:contactId   — ilgili kişi sil
 * GET    /cases?clientId=                   — Dosyalar sekmesi (gömülü gelmezse)
 * GET    /clients/:id/summary               — Finans özeti (varsa; yoksa yerel toplam)
 */

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ApiError, api, asList } from "@/lib/api";
import type { CaseSummary, Client, ClientContact, ClientSummary, FinancialEntry } from "@/lib/types";
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
  StatCard,
  SuccessBox,
  Tabs,
  Textarea,
} from "@/components/ui";
import {
  CASE_STATUS_LABELS,
  CASE_STATUS_TONES,
  CASE_TYPE_LABELS,
  CLIENT_CATEGORIES,
  CLIENT_TYPE_LABELS,
  fmtDate,
  fmtMoney,
  labelOf,
} from "@/lib/labels";
import { CLIENT_TYPES, type ClientType } from "@nomosos/shared";

const TABS = [
  { key: "genel", label: "Genel" },
  { key: "dosyalar", label: "Dosyalar" },
  { key: "kisiler", label: "İlgili Kişiler" },
  { key: "finans", label: "Finans" },
  { key: "iletisim", label: "İletişim Geçmişi" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

interface ClientForm {
  type: ClientType;
  name: string;
  email: string;
  phone: string;
  tckn: string;
  taxNumber: string;
  taxOffice: string;
  address: string;
  iban: string;
  category: string;
  referenceCode: string;
  notes: string;
}

function toForm(c: Client): ClientForm {
  return {
    type: c.type,
    name: c.name ?? "",
    email: c.email ?? "",
    phone: c.phone ?? "",
    // Ham TCKN sunucudan gelmez; alan boş başlar ve boş bırakılırsa
    // mevcut kayıt DEĞİŞTİRİLMEZ (bkz. kaydetme gövdesi).
    tckn: "",
    taxNumber: c.taxNumber ?? "",
    taxOffice: c.taxOffice ?? "",
    address: c.address ?? "",
    iban: c.iban ?? "",
    category: c.category ?? "",
    referenceCode: c.referenceCode ?? "",
    notes: c.notes ?? "",
  };
}

export default function MuvekkilDetayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [client, setClient] = useState<Client | null>(null);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [summary, setSummary] = useState<ClientSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("genel");
  /**
   * KVKK: ham TCKN artık liste/detay yanıtında GELMEZ; sunucu yalnızca
   * `tcknMasked` döndürür. "Göster" düğmesi yetkilendirilmiş
   * `GET /clients/:id/tckn` ucuna gider ve o çağrı denetim günlüğüne yazılır
   * (denetim bulgusu 6). Yetkisiz rol 403 alır.
   */
  const [revealedTckn, setRevealedTckn] = useState<string | null>(null);
  const [tcknLoading, setTcknLoading] = useState(false);
  const [tcknError, setTcknError] = useState<string | null>(null);

  const revealTckn = useCallback(async () => {
    if (revealedTckn) {
      setRevealedTckn(null);
      return;
    }
    setTcknLoading(true);
    setTcknError(null);
    try {
      const res = await api<{ tckn: string | null }>(`/clients/${id}/tckn`);
      setRevealedTckn(res.tckn ?? "—");
    } catch (err) {
      setTcknError(
        err instanceof ApiError ? err.message : "TCKN görüntülenemedi.",
      );
    } finally {
      setTcknLoading(false);
    }
  }, [id, revealedTckn]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<Client>(`/clients/${id}`);
      setClient(data);

      if (data.cases && data.cases.length > 0) {
        setCases(data.cases);
      } else {
        try {
          const list = await api<unknown>("/cases", { query: { clientId: id, limit: "200" } });
          const all = asList<CaseSummary>(list);
          // API clientId filtresini yok sayarsa istemci tarafında süz.
          setCases(all.filter((c) => !c.client || c.client.id === id));
        } catch {
          setCases([]);
        }
      }

      try {
        const s = await api<ClientSummary>(`/clients/${id}/summary`);
        setSummary(s);
      } catch {
        setSummary(null);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Müvekkil yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const contacts = client?.contacts ?? [];

  const caseCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of cases) {
      const key = c.type ?? "DIGER";
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [cases]);

  const openCases = useMemo(
    () => cases.filter((c) => c.status !== "KAPANDI" && c.status !== "ARSIV").length,
    [cases],
  );

  const finance = useMemo(() => computeFinance(summary, client?.financialEntries), [summary, client]);

  if (loading) return <Spinner label="Müvekkil kartı yükleniyor…" />;
  if (error) return <ErrorBox message={error} />;
  if (!client) return <EmptyState message="Müvekkil bulunamadı." />;

  const isLegal = client.type === "TUZEL_KISI";

  return (
    <div className="space-y-6">
      <Link href="/app/muvekkiller" className="text-xs text-slate-500 hover:text-amber-600">
        ← Müvekkiller
      </Link>

      {/* Kart başlığı */}
      <div className="rounded-xl border border-slate-200 bg-slate-900 p-6 text-white">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-bold">{client.name}</h1>
              <Badge tone={isLegal ? "gold" : "blue"}>
                {labelOf(CLIENT_TYPE_LABELS, client.type)}
              </Badge>
              {client.category && <Badge tone="navy">{client.category}</Badge>}
              {client.isActive === false && <Badge tone="gray">Pasif</Badge>}
            </div>
            <p className="mt-2 text-sm text-slate-300">
              {client.referenceCode ? `Ref: ${client.referenceCode}` : ""}
              {client.email ? ` · ${client.email}` : ""}
              {client.phone ? ` · ${client.phone}` : ""}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {isLegal ? (
                <>
                  VKN: {client.taxNumber ?? "—"}
                  {client.taxOffice ? ` · ${client.taxOffice} V.D.` : ""}
                </>
              ) : (
                <span className="inline-flex items-center gap-2">
                  TCKN: {revealedTckn ?? client.tcknMasked ?? "—"}
                  {client.tcknMasked && (
                    <button
                      type="button"
                      onClick={() => void revealTckn()}
                      disabled={tcknLoading}
                      title="Ham TCKN görüntüleme yetkisi gerektirir ve denetim kaydı bırakır."
                      className="rounded border border-slate-600 px-1.5 py-0.5 text-[11px] text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                    >
                      {tcknLoading ? "…" : revealedTckn ? "Gizle" : "Göster"}
                    </button>
                  )}
                  {tcknError && <span className="text-[11px] text-red-300">{tcknError}</span>}
                </span>
              )}
            </p>
          </div>
          <div className="text-right text-xs text-slate-400">
            <p>Kayıt: {fmtDate(client.createdAt)}</p>
            <p className="mt-1">
              {cases.length} dosya · {openCases} açık
            </p>
          </div>
        </div>
      </div>

      {/* Sayaçlar */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Toplam Dosya" value={cases.length} tone="navy" />
        <StatCard label="Açık Dosya" value={openCases} tone="slate" />
        <StatCard label="İlgili Kişi" value={contacts.length} tone="slate" />
        <StatCard
          label="Bekleyen Bakiye"
          value={finance ? fmtMoney(finance.balance, finance.currency) : "—"}
          tone="gold"
          hint={finance ? "Tahakkuk − Tahsilat" : "Finans verisi Faz 3'te bağlanır"}
        />
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} ariaLabel="Müvekkil sekmeleri" />

      {tab === "genel" && (
        <GeneralTab client={client} onSaved={load} />
      )}

      {tab === "dosyalar" && (
        <Card
          title="Dosyalar"
          action={
            <Link
              href="/app/dosyalar"
              className="text-xs font-medium text-amber-600 hover:text-amber-500"
            >
              Tüm dosyalar →
            </Link>
          }
        >
          {Object.keys(caseCounts).length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {Object.entries(caseCounts).map(([type, count]) => (
                <Badge key={type} tone="gray">
                  {labelOf(CASE_TYPE_LABELS, type)}: {count}
                </Badge>
              ))}
            </div>
          )}
          {cases.length === 0 ? (
            <EmptyState message="Bu müvekkile bağlı dosya yok." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-4 font-medium">Dosya</th>
                    <th className="py-2 pr-4 font-medium">Tür</th>
                    <th className="py-2 pr-4 font-medium">Mahkeme / Daire</th>
                    <th className="py-2 pr-4 font-medium">Esas No</th>
                    <th className="py-2 font-medium">Durum</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {cases.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="py-3 pr-4">
                        <Link
                          href={`/app/dosyalar/${c.id}`}
                          className="font-medium text-slate-900 hover:text-amber-600"
                        >
                          {c.title}
                        </Link>
                      </td>
                      <td className="py-3 pr-4 text-slate-600">
                        {labelOf(CASE_TYPE_LABELS, c.type)}
                      </td>
                      <td className="py-3 pr-4 text-slate-600">{c.courtName ?? "—"}</td>
                      <td className="py-3 pr-4 text-slate-600">{c.fileNumber ?? "—"}</td>
                      <td className="py-3">
                        <Badge tone={CASE_STATUS_TONES[c.status ?? ""] ?? "gray"}>
                          {labelOf(CASE_STATUS_LABELS, c.status)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "kisiler" && <ContactsTab clientId={id} contacts={contacts} onChanged={load} />}

      {tab === "finans" && (
        <Card title="Finans Özeti">
          {finance ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label="Tahakkuk"
                  value={fmtMoney(finance.accrued, finance.currency)}
                  tone="slate"
                />
                <StatCard
                  label="Tahsilat"
                  value={fmtMoney(finance.collected, finance.currency)}
                  tone="green"
                />
                <StatCard
                  label="Bekleyen"
                  value={fmtMoney(finance.balance, finance.currency)}
                  tone="gold"
                />
                <StatCard
                  label="Masraf"
                  value={fmtMoney(finance.expenses, finance.currency)}
                  tone="slate"
                />
              </div>
              <p className="mt-4 text-xs text-slate-400">
                Detaylı finans hareketleri, fatura ve masraf yönetimi Faz 3&apos;te açılır.
              </p>
            </>
          ) : (
            <EmptyState message="Bu müvekkil için finansal hareket kaydı yok. Detaylı finans modülü Faz 3'te açılır." />
          )}
        </Card>
      )}

      {tab === "iletisim" && (
        <Card title="İletişim Geçmişi">
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
            <p className="text-sm font-medium text-slate-700">Bu bölüm Faz 5&apos;te açılacak</p>
            <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-slate-500">
              Telefon, e-posta, toplantı ve WhatsApp kayıtları müvekkil kartına işlenecek; her kayıt
              ilgili dosyanın safahat akışında da görünecek.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------- Genel sekmesi ----------

function GeneralTab({ client, onSaved }: { client: Client; onSaved: () => Promise<void> | void }) {
  const [form, setForm] = useState<ClientForm>(toForm(client));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    setForm(toForm(client));
  }, [client]);

  const isLegal = form.type === "TUZEL_KISI";

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setOk(false);
    try {
      await api(`/clients/${client.id}`, {
        method: "PATCH",
        body: {
          type: form.type,
          name: form.name.trim(),
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          // Boş bırakıldıysa alanı hiç gönderme: aksi hâlde kayıtlı TCKN
          // sessizce silinirdi (ham değer artık formda ön-dolu gelmiyor).
          ...(isLegal
            ? { tckn: null }
            : form.tckn.trim()
              ? { tckn: form.tckn.trim() }
              : {}),
          taxNumber: isLegal ? form.taxNumber.trim() || null : null,
          taxOffice: isLegal ? form.taxOffice.trim() || null : null,
          address: form.address.trim() || null,
          iban: form.iban.trim() || null,
          category: form.category.trim() || null,
          referenceCode: form.referenceCode.trim() || null,
          notes: form.notes.trim() || null,
        },
      });
      setOk(true);
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Müvekkil güncellenemedi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card title="Müvekkil Bilgileri" className="lg:col-span-2">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Müvekkil türü">
              <Select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as ClientType })}
              >
                {CLIENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {labelOf(CLIENT_TYPE_LABELS, t)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={isLegal ? "Ticaret unvanı" : "Ad soyad"}>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </Field>
          </div>

          {isLegal ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Vergi numarası (VKN)" hint="10 hane">
                <Input
                  value={form.taxNumber}
                  onChange={(e) => setForm({ ...form, taxNumber: e.target.value })}
                  inputMode="numeric"
                />
              </Field>
              <Field label="Vergi dairesi">
                <Input
                  value={form.taxOffice}
                  onChange={(e) => setForm({ ...form, taxOffice: e.target.value })}
                />
              </Field>
            </div>
          ) : (
            <Field
              label="TCKN"
              hint="KVKK: kayıtlı değer güvenlik gereği burada gösterilmez. Boş bırakırsanız mevcut TCKN korunur."
            >
              <Input
                value={form.tckn}
                onChange={(e) => setForm({ ...form, tckn: e.target.value })}
                inputMode="numeric"
                maxLength={11}
              />
            </Field>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="E-posta">
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label="Telefon">
              <Input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Segment / Kategori">
              <Input
                list="client-categories"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="Kurumsal / Bireysel"
              />
              <datalist id="client-categories">
                {CLIENT_CATEGORIES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <Field label="Büro referans kodu" hint="Örn. MV-2026-001">
              <Input
                value={form.referenceCode}
                onChange={(e) => setForm({ ...form, referenceCode: e.target.value })}
              />
            </Field>
          </div>

          <Field label="Adres">
            <Textarea
              rows={2}
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </Field>

          <Field label="IBAN">
            <Input
              value={form.iban}
              onChange={(e) => setForm({ ...form, iban: e.target.value })}
              placeholder="TR.. .... .... .... .... .... .."
            />
          </Field>

          <Field label="Notlar">
            <Textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>

          {error && <ErrorBox message={error} />}
          {ok && <SuccessBox message="Müvekkil bilgileri güncellendi." />}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setForm(toForm(client))}>
              Değişiklikleri geri al
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </div>
        </form>
      </Card>

      <Card title="Kart Özeti">
        <div className="divide-y divide-slate-100">
          <DataRow label="Tür">{labelOf(CLIENT_TYPE_LABELS, client.type)}</DataRow>
          <DataRow label="Kategori">{client.category ?? "—"}</DataRow>
          <DataRow label="Referans">{client.referenceCode ?? "—"}</DataRow>
          <DataRow label="Kimlik">
            {client.type === "TUZEL_KISI" ? (client.taxNumber ?? "—") : (client.tcknMasked ?? "—")}
          </DataRow>
          <DataRow label="E-posta">{client.email ?? "—"}</DataRow>
          <DataRow label="Telefon">{client.phone ?? "—"}</DataRow>
          <DataRow label="IBAN">{client.iban ?? "—"}</DataRow>
          <DataRow label="Kayıt">{fmtDate(client.createdAt)}</DataRow>
        </div>
        <p className="mt-4 text-[11px] leading-5 text-slate-400">
          KVKK: kimlik ve IBAN alanları hassas veridir; ekranda maskeli gösterilir ve erişimler
          denetim kaydına yazılır.
        </p>
      </Card>
    </div>
  );
}

// ---------- İlgili kişiler sekmesi ----------

interface ContactForm {
  fullName: string;
  title: string;
  email: string;
  phone: string;
  notes: string;
}

const EMPTY_CONTACT: ContactForm = { fullName: "", title: "", email: "", phone: "", notes: "" };

function ContactsTab({
  clientId,
  contacts,
  onChanged,
}: {
  clientId: string;
  contacts: ClientContact[];
  onChanged: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ClientContact | null>(null);
  const [form, setForm] = useState<ContactForm>(EMPTY_CONTACT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  function openNew() {
    setEditing(null);
    setForm(EMPTY_CONTACT);
    setError(null);
    setOpen(true);
  }

  function openEdit(c: ClientContact) {
    setEditing(c);
    setForm({
      fullName: c.fullName ?? "",
      title: c.title ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      notes: c.notes ?? "",
    });
    setError(null);
    setOpen(true);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      fullName: form.fullName.trim(),
      title: form.title.trim() || undefined,
      email: form.email.trim() || undefined,
      phone: form.phone.trim() || undefined,
      notes: form.notes.trim() || undefined,
    };
    try {
      if (editing) {
        await api(`/clients/${clientId}/contacts/${editing.id}`, { method: "PATCH", body });
      } else {
        await api(`/clients/${clientId}/contacts`, { method: "POST", body });
      }
      setOpen(false);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "İlgili kişi kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(c: ClientContact) {
    if (!window.confirm(`${c.fullName} kaydı silinsin mi?`)) return;
    setListError(null);
    try {
      await api(`/clients/${clientId}/contacts/${c.id}`, { method: "DELETE" });
      await onChanged();
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : "İlgili kişi silinemedi.");
    }
  }

  return (
    <Card
      title="İlgili Kişiler / Yetkililer"
      action={
        <Button size="sm" variant="gold" onClick={openNew}>
          + Kişi Ekle
        </Button>
      }
    >
      {listError && (
        <div className="mb-4">
          <ErrorBox message={listError} />
        </div>
      )}
      {contacts.length === 0 ? (
        <EmptyState message="Kayıtlı ilgili kişi yok. Tebligat ve iletişimin karışmaması için yetkilileri ekleyin." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {contacts.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div>
                <p className="text-sm font-medium text-slate-900">
                  {c.fullName}
                  {c.title && <span className="ml-2 text-xs text-slate-500">{c.title}</span>}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {c.email ?? "—"} · {c.phone ?? "—"}
                </p>
                {c.notes && <p className="mt-1 text-xs text-slate-500">{c.notes}</p>}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => openEdit(c)}>
                  Düzenle
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void remove(c)}>
                  Sil
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={open}
        title={editing ? "İlgili Kişiyi Düzenle" : "Yeni İlgili Kişi"}
        onClose={() => setOpen(false)}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Ad soyad">
            <Input
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              required
            />
          </Field>
          <Field label="Görev / Unvan">
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Örn. Hukuk Müşaviri"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="E-posta">
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label="Telefon">
              <Input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Not">
            <Textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>

          {error && <ErrorBox message={error} />}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Vazgeç
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}

// ---------- Finans yardımcıları ----------

interface FinanceTotals {
  accrued: number;
  collected: number;
  balance: number;
  expenses: number;
  currency: string;
}

function computeFinance(
  summary: ClientSummary | null,
  entries: FinancialEntry[] | undefined,
): FinanceTotals | null {
  if (summary?.finance) {
    const f = summary.finance;
    const accrued = f.accrued ?? 0;
    const collected = f.collected ?? 0;
    return {
      accrued,
      collected,
      balance: f.balance ?? accrued - collected,
      expenses: f.expenses ?? 0,
      currency: f.currency ?? "TRY",
    };
  }
  if (!entries || entries.length === 0) return null;

  let accrued = 0;
  let collected = 0;
  let expenses = 0;
  for (const e of entries) {
    const amount = typeof e.amount === "number" ? e.amount : Number(e.amount);
    if (Number.isNaN(amount)) continue;
    if (e.type === "TAHAKKUK" || e.type === "VEKALET_UCRETI" || e.type === "DANISMANLIK") {
      accrued += amount;
    } else if (e.type === "TAHSILAT" || e.type === "AVANS") {
      collected += amount;
    } else if (e.type === "MASRAF" || e.type === "HARC") {
      expenses += amount;
    }
  }
  return {
    accrued,
    collected,
    balance: accrued - collected,
    expenses,
    currency: entries[0]?.currency ?? "TRY",
  };
}
