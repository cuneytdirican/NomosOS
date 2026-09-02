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
 *
 * Faz 3 sekmeleri:
 * Finans             → /finance/clients/:id/summary + /finance/entries (ClientFinanceTab)
 * Ücret Sözleşmeleri → /billing/fee-agreements (FeeAgreementsTab)
 *
 * PARA: müvekkil bakiyesi bu sayfada HESAPLANMAZ; deterministik sunucu özeti
 * Finans sekmesinde gösterilir.
 */

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ApiError, api, fetchPaged, SERVER_MAX_PAGE_SIZE } from "@/lib/api";
import type { CaseSummary, Client, ClientContact } from "@/lib/types";
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
  TruncationNotice,
  StatCard,
  SuccessBox,
  Tabs,
  tabPanelProps,
  Textarea,
} from "@/components/ui";
import {
  CASE_STATUS_LABELS,
  CASE_STATUS_TONES,
  CASE_TYPE_LABELS,
  CLIENT_CATEGORIES,
  CLIENT_TYPE_LABELS,
  fmtDate,
  labelOf,
} from "@/lib/labels";
import { ClientFinanceTab } from "@/components/client-finance-tab";
import { FeeAgreementsTab } from "@/components/fee-agreements-tab";
import { ToastStack, useToasts } from "@/components/ai-ui";
import { CLIENT_TYPES, type ClientType } from "@nomosos/shared";
// ---- Faz 5: portal, vekaletname, sözleşme, iletişim ----
import { CommScopeTab } from "../../_components/comm-scope-tab";
import { ContractsTab } from "../../_components/contracts-tab";
import { PoaTab } from "../../_components/poa-tab";
import { PortalTab } from "../../_components/portal-tab";

const TABS = [
  { key: "genel", label: "Genel" },
  { key: "dosyalar", label: "Dosyalar" },
  { key: "kisiler", label: "İlgili Kişiler" },
  { key: "finans", label: "Finans" },
  { key: "sozlesmeler", label: "Ücret Sözleşmeleri" },
  { key: "iletisim", label: "İletişim Geçmişi" },
  // ---- Faz 5 ----
  { key: "portal", label: "Portal" },
  { key: "vekaletname", label: "Vekaletnameler" },
  // İ-45: etiket ayrımı — bunlar VAKA sözleşmeleridir (Modül 20, sürüm +
  // e-imza); "Ücret Sözleşmeleri" ise parasal ücret anlaşmasıdır. İkisinin
  // adı aynı olduğunda kullanıcı hangisinin ne olduğunu bilemiyordu.
  { key: "sozlesmeler5", label: "Vaka Sözleşmeleri (İmza)" },
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
  const [casesTruncated, setCasesTruncated] = useState(false);
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
  const { toasts, push, dismiss } = useToasts();

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

  /**
   * KVKK m.11 — tam veri dışa aktarma (F2 · A1). Sunucu TÜM kategorileri
   * (K1-K7) tek JSON'da toplar; indirme denetim kaydına yazılır. Dosya
   * tarayıcıda kaydedilir (JSON, makine-okunur — veri özne talebine ek olarak
   * iletilir).
   */
  const [exporting, setExporting] = useState(false);
  const exportClientData = useCallback(async () => {
    setExporting(true);
    try {
      const res = await api<Record<string, unknown>>(`/clients/${id}/export`);
      const blob = new Blob([JSON.stringify(res, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName = (client?.name ?? "mustery").replace(/[\\/:*?"<>|]/g, "_");
      a.download = `kvkk-aktarma-${safeName}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      push("KVKK veri dışa aktarma indirildi (denetim kaydına yazıldı).", "success");
    } catch (err) {
      push(
        err instanceof ApiError ? err.message : "Dışa aktarma başarısız.",
        "error",
      );
    } finally {
      setExporting(false);
    }
  }, [id, client?.name, push]);

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
          // Zarf okunur; `total` atılmaz (denetim bulgusu K-15). Bir müvekkilin
          // dosya sayısı üst sınırı aşarsa ekranda görünür uyarı çıkar.
          const res = await fetchPaged<CaseSummary>("/cases", {
            query: { clientId: id },
            page: 1,
            limit: SERVER_MAX_PAGE_SIZE,
          });
          // API clientId filtresini yok sayarsa istemci tarafında süz.
          setCases(res.items.filter((c) => !c.client || c.client.id === id));
          setCasesTruncated(res.hasMore || res.truncated);
        } catch {
          setCases([]);
          setCasesTruncated(false);
        }
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
            <p className="mt-1 text-xs text-slate-500">
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
          <div className="text-right text-xs text-slate-500">
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
        {/* Bekleyen bakiye artık BURADA HESAPLANMAZ. Tutar, avans mahsubunu da
            içeren deterministik sunucu hesabıyla Finans sekmesinde gösterilir;
            iki farklı yerde iki farklı yöntemle hesaplanan bakiye, tutarsız
            rakam üretme riskidir. */}
        <StatCard
          label="Bekleyen Bakiye"
          value="Finans sekmesi"
          tone="gold"
          hint="Bakiye sunucuda deterministik hesaplanır"
        />
      </div>

      {/* KVKK m.11 — veri özne erişim hakkı: tam dışa aktarma (F2 · A1).
          Rol kapısı sunucudadır (ADMIN/PARTNER); her indirme denetim kaydına
          yazılır. Politika matrisi: docs/kvkk-politika-matrisi.md */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void exportClientData()}
          disabled={exporting}
          className="text-xs font-medium text-slate-500 underline decoration-dotted hover:text-slate-800 disabled:opacity-50"
          title="Müvekkil hakkında büronun tuttuğu tüm veriyi KVKK m.11 kapsamında JSON olarak indirir. İndirme denetim kaydına yazılır."
        >
          {exporting ? "Hazırlanıyor…" : "KVKK veri dışa aktarma (JSON)"}
        </button>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} ariaLabel="Müvekkil sekmeleri" idPrefix="musteri" />

      {/* F2-Ö-25: sekme paneli WCAG 4.1.2. */}
      <div {...tabPanelProps("musteri", tab)} className="mt-6">

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
          {/* Sessiz kırpma yasak (denetim bulgusu K-15). */}
          {casesTruncated && <TruncationNotice shown={cases.length} noun="dosya" />}
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

      {/* Faz 3: özet artık /finance/clients/:id/summary ucundan (SUNUCU hesabı) gelir;
          istemci tarafında toplama yapılmaz. */}
      {tab === "finans" && <ClientFinanceTab clientId={id} />}

      {tab === "sozlesmeler" && (
        <FeeAgreementsTab clientId={id} onNotify={(t) => push(t)} />
      )}

      {/* ---------- Faz 5 ---------- */}

      {tab === "iletisim" && (
        <CommScopeTab
          clientId={id}
          clients={[{ id, name: client.name }]}
          cases={cases.map((c) => ({
            id: c.id,
            title: c.title,
            fileNumber: c.fileNumber ?? null,
            status: c.status ?? null,
          }))}
          onNotify={push}
        />
      )}

      {tab === "portal" && (
        <PortalTab clientId={id} clientName={client.name} onNotify={push} />
      )}

      {tab === "vekaletname" && <PoaTab clientId={id} cases={cases} onNotify={push} />}

      {tab === "sozlesmeler5" && (
        <ContractsTab clientId={id} cases={cases} onNotify={push} />
      )}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
      </div>
      {/* /tabpanel F2-Ö-25 */}
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
        <p className="mt-4 text-[11px] leading-5 text-slate-500">
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
