"use client";

/**
 * Dilekçe Stüdyosu → "Büro şablonları" kartı (Faz 7D).
 * Sistem şablonları salt-okunur; büro kendi şablonunu (1) UDF/.txt yükleyerek içe aktarır,
 * (2) bölüm listesi yazarak oluşturur; siler. Bölüm satırı biçimi: "BAŞLIK | ipucu | zorunlu".
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE, ApiError, api, getToken } from "@/lib/api";
import { PETITION_TEMPLATE_ROUTES } from "@nomosos/shared";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Select, SuccessBox, Textarea } from "@/components/ui";

interface TemplateRow {
  id: string;
  key: string;
  name: string;
  petitionType: string;
  isSystem: boolean;
  readOnly?: boolean;
  sections?: Array<{ title: string; hint?: string | null; required?: boolean }>;
}

const TYPES = ["DAVA_DILEKCESI", "CEVAP", "CEVABA_CEVAP", "IKINCI_CEVAP", "ISTINAF", "TEMYIZ", "ITIRAZ", "DELIL_LISTESI", "ISLAH", "BILIRKISI_ITIRAZ", "ICRA_TAKIP_TALEBI", "SIKAYET", "BEYAN", "DIGER"] as const;

export function PetitionTemplatesCard({ onChanged }: { onChanged?: () => void }) {
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("DIGER");
  const [sectionsText, setSectionsText] = useState("KONU | Dilekçenin konusu | zorunlu\nAÇIKLAMALAR | Vakıalar tarih sırasıyla | zorunlu\nHUKUKİ NEDENLER | İlgili mevzuat\nDELİLLER | Delil listesi\nSONUÇ VE İSTEM | Talep | zorunlu");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api<TemplateRow[]>(PETITION_TEMPLATE_ROUTES.list);
      setRows(Array.isArray(list) ? list : []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Şablonlar yüklenemedi.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function parseSections(text: string) {
    return text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [title, hint, req] = l.split("|").map((x) => x.trim());
        return { title, hint: hint || null, required: /zorunlu|evet|1|true/i.test(req ?? "") };
      })
      .filter((s) => s.title.length >= 2);
  }

  async function create() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const sections = parseSections(sectionsText);
      if (sections.length === 0) throw new ApiError("En az bir bölüm satırı yazın.", 400, null);
      await api(PETITION_TEMPLATE_ROUTES.create, { method: "POST", body: { name: name.trim(), petitionType: type, sections } });
      setNotice(`"${name.trim()}" şablonu oluşturuldu (${sections.length} bölüm).`);
      setName("");
      setOpen(false);
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Şablon oluşturulamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File) {
    if (!name.trim()) {
      setError("Önce şablon adını yazın; sonra dosyayı seçin.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      form.append("name", name.trim());
      form.append("petitionType", type);
      const token = getToken();
      const res = await fetch(`${API_BASE}/api/v1${PETITION_TEMPLATE_ROUTES.importUdf}`, { method: "POST", body: form, credentials: "include", headers: token ? { Authorization: `Bearer ${token}` } : {} });
      const data = (await res.json().catch(() => null)) as { message?: string; sections?: unknown[]; importedParagraphs?: number } | null;
      if (!res.ok) throw new ApiError(data?.message ?? `İçe aktarım başarısız (HTTP ${res.status}).`, res.status, data);
      setNotice(`"${name.trim()}" içe aktarıldı: ${data?.importedParagraphs ?? "?"} paragraftan ${data?.sections?.length ?? "?"} bölüm çıkarıldı. Bölümleri kontrol edin.`);
      setName("");
      setOpen(false);
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "İçe aktarım başarısız.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: TemplateRow) {
    if (!window.confirm(`"${row.name}" büro şablonu silinsin mi? Bu şablondan açılmış dilekçeler etkilenmez.`)) return;
    setBusy(true);
    try {
      await api(PETITION_TEMPLATE_ROUTES.remove(row.id), { method: "DELETE" });
      setNotice("Şablon silindi.");
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Silinemedi.");
    } finally {
      setBusy(false);
    }
  }

  const tenantRows = rows.filter((r) => !r.isSystem && !r.readOnly);
  const systemRows = rows.filter((r) => r.isSystem || r.readOnly);

  return (
    <Card
      title="Şablon kütüphanesi"
      action={
        <Button size="sm" variant="secondary" onClick={() => setOpen((v) => !v)} data-testid="sablon-ekle">
          {open ? "Kapat" : "+ Büro şablonu"}
        </Button>
      }
    >
      {notice && <SuccessBox message={notice} />}
      {error && <ErrorBox message={error} />}
      {open && (
        <div className="mb-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Şablon adı">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ör. Büro cevap dilekçesi" />
            </Field>
            <Field label="Dilekçe türü">
              <Select value={type} onChange={(e) => setType(e.target.value)}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Bölümler" hint="Her satır: BAŞLIK | ipucu | zorunlu. UDF yüklerseniz bölümler dosyadan çıkarılır; künye/taraf satırları şablona girmez.">
            <Textarea value={sectionsText} onChange={(e) => setSectionsText(e.target.value)} rows={6} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button variant="gold" size="sm" disabled={busy || name.trim().length < 3} onClick={() => void create()}>
              Bölümlerden oluştur
            </Button>
            <Button variant="secondary" size="sm" disabled={busy || name.trim().length < 3} onClick={() => fileRef.current?.click()}>
              UDF / metin dosyasından içe aktar
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".udf,.txt,.md"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importFile(f);
                e.target.value = "";
              }}
            />
          </div>
        </div>
      )}
      {tenantRows.length === 0 ? (
        <EmptyState message="Henüz büro şablonu yok. Sistem şablonları aşağıda; kendi şablonunuzu UDF'den içe aktarabilir ya da bölüm listesiyle yazabilirsiniz." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {tenantRows.map((r) => (
            <li key={r.id} className="py-2" data-testid="buro-sablonu">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button type="button" className="text-left text-sm font-medium text-slate-900 hover:text-amber-600" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                  {r.name} <span className="font-mono text-[11px] text-slate-500">{r.key}</span>
                </button>
                <span className="flex items-center gap-2">
                  <Badge tone="blue">{r.petitionType}</Badge>
                  <Badge tone="gray">{r.sections?.length ?? 0} bölüm</Badge>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove(r)}>
                    Sil
                  </Button>
                </span>
              </div>
              {expanded === r.id && (
                <ol className="mt-2 space-y-1 pl-4 text-xs text-slate-600">
                  {(r.sections ?? []).map((s, i) => (
                    <li key={i}>
                      <strong>{s.title}</strong>
                      {s.required ? " (zorunlu)" : ""}
                      {s.hint ? ` — ${s.hint.slice(0, 140)}` : ""}
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-slate-500">Sistem şablonları ({systemRows.length}): {systemRows.map((r) => r.name).join(" · ")}</p>
    </Card>
  );
}
