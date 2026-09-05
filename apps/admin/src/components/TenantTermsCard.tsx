"use client";

/**
 * FAZ 8B — kiracı sözleşme kabul geçmişi (Hizmet/EULA, DPA, SLA, Mesafeli satış).
 * Salt üstveri: sürüm, kabul eden, tarih, IP. Metin içermez; sözleşme metinleri paylaşılan pakette.
 */

import { useResource } from "@/lib/useResource";
import { EP } from "@/lib/endpoints";
import { Badge, Card, DataRow, EmptyState } from "@/components/ui";

interface TermsHistoryRow {
  id: string;
  docKey: string;
  version: string;
  at: string;
  by: string;
  email: string | null;
  ip: string | null;
}

interface TermsHistoryResponse {
  current: { key: string; title: string; version: string; required: boolean; accepted: boolean; outdated: boolean; acceptedAt: string | null }[];
  missingRequired: string[];
  history: TermsHistoryRow[];
}

const DOC_LABEL: Record<string, string> = {
  HIZMET_SOZLESMESI: "Hizmet sözleşmesi",
  DPA: "Veri işleme protokolü",
  SLA: "Hizmet seviyesi",
  MESAFELI_SATIS: "Mesafeli satış",
};

export function TenantTermsCard({ tenantId }: { tenantId: string }) {
  const res = useResource<TermsHistoryResponse>(tenantId ? EP.tenants.terms(tenantId) : null);
  const data = res.data;
  return (
    <Card title="Sözleşmeler" subtitle="Büro adına kabul edilen metinler (sürüm + kabul eden + tarih). Eksik zorunlu metin, kiracı uygulamasında şerit olarak görünür.">
      {res.error ? (
        <p className="text-sm text-rose-700">{res.error}</p>
      ) : !data ? (
        <p className="text-sm text-slate-500">Yükleniyor…</p>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {data.current.map((it) => (
              <DataRow key={it.key} label={it.title}>
                <span className="inline-flex items-center gap-2">
                  <Badge tone={it.accepted ? "green" : it.required ? "red" : "gray"}>{it.accepted ? `Kabul (${it.version})` : it.outdated ? "Yeniden kabul gerekli" : it.required ? "Eksik (zorunlu)" : "Eksik"}</Badge>
                </span>
              </DataRow>
            ))}
          </div>
          {data.history.length === 0 ? (
            <EmptyState message="Henüz kabul kaydı yok." />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-1 pr-3">Metin</th>
                    <th className="py-1 pr-3">Sürüm</th>
                    <th className="py-1 pr-3">Kabul eden</th>
                    <th className="py-1 pr-3">Tarih</th>
                    <th className="py-1 pr-3">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {data.history.map((h) => (
                    <tr key={h.id} className="border-t border-slate-100">
                      <td className="py-1 pr-3">{DOC_LABEL[h.docKey] ?? h.docKey}</td>
                      <td className="py-1 pr-3 tabular-nums">{h.version}</td>
                      <td className="py-1 pr-3">{h.email ? `${h.by} (${h.email})` : h.by}</td>
                      <td className="py-1 pr-3 tabular-nums">{new Date(h.at).toLocaleString("tr-TR")}</td>
                      <td className="py-1 pr-3 tabular-nums">{h.ip ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
