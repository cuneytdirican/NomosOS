"use client";

/**
 * Ayarlar → Sözleşmeler (Faz 8B): Hizmet/EULA, DPA, SLA, Mesafeli satış metinleri; büro adına kabul
 * (ADMIN/PARTNER). Kabul kaydı sürüm + özet + IP ile tutulur; metin değişince yeniden kabul istenir.
 */

import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { CONTRACT_DOCS, TERMS_ROUTES, type ContractDoc } from "@nomosos/shared";
import { Badge, Button, Card, ErrorBox, SuccessBox } from "@/components/ui";
import { fmtDateTime } from "@/lib/labels";

interface TermsItem {
  key: string;
  slug: string;
  title: string;
  version: string;
  required: boolean;
  updatedAt: string;
  accepted: boolean;
  outdated: boolean;
  acceptedAt: string | null;
  acceptedBy: { id: string; fullName: string; email: string } | null;
  acceptedVersion: string | null;
}

export default function SozlesmelerPage() {
  const [items, setItems] = useState<TermsItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ items: TermsItem[] }>(TERMS_ROUTES.status);
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sözleşme durumu alınamadı.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function accept(item: TermsItem) {
    if (!window.confirm(`"${item.title}" (sürüm ${item.version}) metnini büro adına kabul ediyor musunuz? Kayıt tarih, kullanıcı ve IP ile saklanır.`)) return;
    setBusy(item.key);
    setError(null);
    try {
      await api(TERMS_ROUTES.accept, { method: "POST", body: { docKey: item.key, version: item.version } });
      setNotice(`${item.title} kabul edildi.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Kabul kaydedilemedi.");
    } finally {
      setBusy(null);
    }
  }

  const doc = (key: string): ContractDoc | undefined => CONTRACT_DOCS.find((d) => d.key === key);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Sözleşmeler</h1>
        <p className="mt-1 text-sm text-slate-500">Hizmet sözleşmesi, veri işleme protokolü, hizmet seviyesi taahhüdü ve mesafeli satış sözleşmesi. Zorunlu metinler büro adına yönetici/ortak tarafından kabul edilir.</p>
      </div>
      {notice && <SuccessBox message={notice} />}
      {error && <ErrorBox message={error} />}
      {items.map((item) => {
        const d = doc(item.key);
        return (
          <Card
            key={item.key}
            title={item.title}
            action={
              <div className="flex items-center gap-2">
                {item.required && <Badge tone="gray">zorunlu</Badge>}
                <Badge tone={item.accepted ? "green" : item.outdated ? "yellow" : "red"}>{item.accepted ? `Kabul edildi (${item.version})` : item.outdated ? `Güncellendi — yeniden kabul (${item.acceptedVersion} → ${item.version})` : "Kabul edilmedi"}</Badge>
              </div>
            }
          >
            <p className="text-sm text-slate-600">{d?.lead}</p>
            {d?.draftNotice && <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{d.draftNotice}</p>}
            {item.acceptedAt && (
              <p className="mt-2 text-xs text-slate-500">
                Son kabul: {fmtDateTime(item.acceptedAt)} · {item.acceptedBy?.fullName ?? "—"} ({item.acceptedBy?.email ?? ""})
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setOpen(open === item.key ? null : item.key)}>
                {open === item.key ? "Metni gizle" : "Metni oku"}
              </Button>
              <a href={`/sozlesmeler/${item.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center text-xs text-slate-500 underline underline-offset-2">
                Yeni sekmede aç
              </a>
              {!item.accepted && (
                <Button size="sm" variant="gold" disabled={busy === item.key} onClick={() => void accept(item)} data-testid={`sozlesme-kabul-${item.key}`}>
                  {busy === item.key ? "Kaydediliyor…" : "Büro adına kabul et"}
                </Button>
              )}
            </div>
            {open === item.key && d && (
              <ol className="mt-4 max-h-96 space-y-3 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                {d.sections.map((s, i) => (
                  <li key={s.id}>
                    <p className="font-semibold text-slate-900">
                      {i + 1}. {s.title}
                    </p>
                    {s.paragraphs.map((p) => (
                      <p key={p} className="mt-1">
                        {p}
                      </p>
                    ))}
                    {s.bullets && (
                      <ul className="mt-1 list-disc pl-5">
                        {s.bullets.map((b) => (
                          <li key={b}>{b}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        );
      })}
    </div>
  );
}
