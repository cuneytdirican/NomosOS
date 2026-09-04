"use client";

/**
 * İÇTİHAT HAVUZ YÖNETİMİ (ai-egitim-stratejisi.md D1) — RAG'ın kamusal
 * tarafını (CaseLawDocument ortak havuzu) platform eliyle doldurma.
 *
 * İçerik güvenliği taahhütleri (sunucu tarafında uygulanır):
 *  - Biçimsiz künye havuza GİREMEZ (şema ön doğrulaması).
 *  - Büronun manuel kaydı (createdByTenantId != null) EZİLMEZ — atlanır.
 *  - İçe aktarılan her parti denetim izine düşer.
 *
 * Bu sayfa yalnız platform yönetimi (aiProvider.view/manage); büro
 * kullanıcıları (avukat/büro) bu uçlara erişemez — Türk hukuku "eğitimi"
 * Super Admin'in tekelidir.
 */

import { useCallback, useEffect, useState } from "react";
import { adminApi, errorMessage } from "@/lib/api";
import { EP } from "@/lib/endpoints";
import { PageGate } from "@/components/RoleGate";
import {
  Badge,
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
  Textarea,
  type Column,
} from "@/components/ui";

interface PoolStats {
  total: number;
  systemEntered: number;
  tenantEntered: number;
  bySource: { sourceAdapter: string; count: number }[];
  topCourts: { court: string; count: number }[];
}

interface PoolRecordRow {
  id: string;
  court: string;
  chamber: string | null;
  caseNumber: string;
  decisionNumber: string;
  decisionDate: string | null;
  sourceAdapter: string;
  createdByTenantId: string | null;
  fetchedAt: string;
}

interface ImportResult {
  index: number;
  court: string;
  caseNumber: string;
  decisionNumber: string;
  status: "EKLENDI" | "GUNCELLENDI" | "ATLANDI" | "REDDEDILDI";
  reason?: string;
}

const RESULT_TONES: Record<string, "green" | "blue" | "gray" | "red"> = {
  EKLENDI: "green",
  GUNCELLENDI: "blue",
  ATLANDI: "gray",
  REDDEDILDI: "red",
};

const SAMPLE_JSON = `[
  {
    "court": "Yargıtay 9. Hukuk Dairesi",
    "caseNumber": "2016/1234",
    "decisionNumber": "2017/5678",
    "decisionDate": "2017-06-15",
    "summary": "İş kazasında tazminat sorumluluğu…",
    "sourceUrl": "https://…"
  }
]`;

export default function HavuzPage() {
  return (
    <PageGate action="aiProvider.view">
      <Havuz />
    </PageGate>
  );
}

function Havuz() {
  const [stats, setStats] = useState<PoolStats | null>(null);
  const [records, setRecords] = useState<PoolRecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState("");

  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({ sourceAdapter: "PLATFORM_ICAKTARIM", sourceNote: "", json: "" });
  const [results, setResults] = useState<{ results: ImportResult[]; counts: Record<string, number> } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, r] = await Promise.all([
        adminApi<PoolStats>(EP.caseLawPool.stats),
        adminApi<{ items?: PoolRecordRow[] }>(EP.caseLawPool.records, {
          query: sourceFilter ? { sourceAdapter: sourceFilter } : undefined,
        }),
      ]);
      setStats(s);
      setRecords(r.items ?? []);
      setMissing(false);
    } catch (err) {
      setMissing(true);
      setError(errorMessage(err, "Havuz bilgileri yüklenemedi."));
    } finally {
      setLoading(false);
    }
  }, [sourceFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runImport() {
    setBusy(true);
    setFormError(null);
    try {
      const parsed = JSON.parse(form.json) as unknown[];
      if (!Array.isArray(parsed)) throw new Error("Kaynak veri bir JSON DİZİSİ olmalıdır.");
      const data = await adminApi<{ results: ImportResult[]; counts: Record<string, number> }>(EP.caseLawPool.import, {
        method: "POST",
        body: {
          sourceAdapter: form.sourceAdapter.trim(),
          ...(form.sourceNote.trim() ? { sourceNote: form.sourceNote.trim() } : {}),
          records: parsed,
        },
      });
      setResults(data);
      setNotice(
        `İçe aktarım tamamlandı: ${data.counts.added} eklendi, ${data.counts.updated} güncellendi, ` +
          `${data.counts.skipped} atlandı, ${data.counts.rejected} reddedildi.`,
      );
      await load();
    } catch (err) {
      setFormError(errorMessage(err, "İçe aktarılamadı. JSON'u ve künye biçimlerini kontrol edin."));
    } finally {
      setBusy(false);
    }
  }

  const recordColumns: Array<Column<PoolRecordRow>> = [
    {
      key: "citation",
      header: "Künye",
      render: (r) => (
        <div>
          <p className="font-medium text-steel-50">{r.court}</p>
          <p className="text-xs text-steel-500">
            E. {r.caseNumber} · K. {r.decisionNumber}
            {r.decisionDate ? ` · ${new Date(r.decisionDate).toLocaleDateString("tr-TR")}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "source",
      header: "Kaynak",
      render: (r) => (
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="steel">{r.sourceAdapter}</Badge>
          {r.createdByTenantId ? <Badge tone="yellow">büro kaydı</Badge> : <Badge tone="green">sistem</Badge>}
        </div>
      ),
    },
    {
      key: "fetchedAt",
      header: "Giriş",
      render: (r) => new Date(r.fetchedAt).toLocaleDateString("tr-TR"),
    },
  ];

  const resultColumns: Array<Column<ImportResult>> = [
    {
      key: "citation",
      header: "Künye",
      render: (r) => (
        <div>
          <p className="font-medium text-steel-50">{r.court}</p>
          <p className="text-xs text-steel-500">
            E. {r.caseNumber} · K. {r.decisionNumber}
          </p>
        </div>
      ),
    },
    { key: "status", header: "Sonuç", render: (r) => <Badge tone={RESULT_TONES[r.status] ?? "steel"}>{r.status}</Badge> },
    { key: "reason", header: "Açıklama", render: (r) => r.reason ?? "—" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="İçtihat Havuzu"
        description="RAG'ın kamusal tarafı: Yargıtay/Danıştay kararlarının ortak havuzu. Toplu içe aktarım (biçim ön doğrulamalı), havuz sağlığı ve son kayıtlar."
        action={
          <Button
            onClick={() => {
              setImportOpen(true);
              setResults(null);
              setFormError(null);
            }}
          >
            Toplu İçe Aktar
          </Button>
        }
      />

      <InfoBox title="İçerik güvenliği">
        Biçimsiz künye (esas/karar no) havuza GİREMEZ — reddedilir. Aynı künye bir büronun manuel
        kaydındaysa üzerine YAZILMAZ, kayıt atlanır. Her içe aktarma partisi denetim izine düşer.
        Bu sayfa yalnız platform yönetimine açıktır; büro kullanıcıları havuzu yalnızca ARAMA
        sonucu olarak görür.
      </InfoBox>

      {notice ? (
        <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{notice}</p>
      ) : null}
      {error ? <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p> : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card title="Havuz toplamı">
          <p className="text-3xl font-semibold text-steel-50">{stats?.total.toLocaleString("tr-TR") ?? "—"}</p>
          <p className="text-xs text-steel-500">ortak CaseLawDocument kaydı</p>
        </Card>
        <Card title="Sistem kaydı">
          <p className="text-3xl font-semibold text-steel-50">{stats?.systemEntered.toLocaleString("tr-TR") ?? "—"}</p>
          <p className="text-xs text-steel-500">içe aktarım + resmî kaynak (platform)</p>
        </Card>
        <Card title="Büro kaydı">
          <p className="text-3xl font-semibold text-steel-50">{stats?.tenantEntered.toLocaleString("tr-TR") ?? "—"}</p>
          <p className="text-xs text-steel-500">büroların elle girdiği kayıtlar</p>
        </Card>
      </div>

      {stats && stats.bySource.length > 0 ? (
        <Card title="Kaynak kırılımı">
          <div className="flex flex-wrap gap-2">
            {stats.bySource.map((s) => (
              <Badge key={s.sourceAdapter} tone="steel">
                {s.sourceAdapter}: {s.count.toLocaleString("tr-TR")}
              </Badge>
            ))}
          </div>
        </Card>
      ) : null}

      {stats && stats.topCourts.length > 0 ? (
        <Card title="En çok kayıt barındıran daireler (ilk 10)">
          <ul className="space-y-1 text-sm text-steel-300">
            {stats.topCourts.map((c) => (
              <li key={c.court} className="flex justify-between gap-3">
                <span>{c.court}</span>
                <span className="font-mono text-steel-500">{c.count.toLocaleString("tr-TR")}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card
        title="Son kayıtlar"
        action={
          <Select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            aria-label="Kaynak süzgeci"
            className="w-56"
          >
            <option value="">Tüm kaynaklar</option>
            {(stats?.bySource ?? []).map((s) => (
              <option key={s.sourceAdapter} value={s.sourceAdapter}>
                {s.sourceAdapter}
              </option>
            ))}
          </Select>
        }
      >
        <ResourceView
          loading={loading}
          missing={missing}
          forbidden={false}
          error={error}
          empty={records.length === 0}
          endpoint={EP.caseLawPool.records}
          what="Havuz kayıtları"
          emptyMessage="Havuz boş — toplu içe aktarma ile doldurun."
        >
          <Table columns={recordColumns} rows={records} rowKey={(r) => r.id} dense />
        </ResourceView>
      </Card>

      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Toplu İçe Aktarım">
        {formError ? (
          <p className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{formError}</p>
        ) : null}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Kaynak etiketi (BÜYÜK harf/rakam/_)">
              <Input value={form.sourceAdapter} onChange={(e) => setForm({ ...form, sourceAdapter: e.target.value })} />
            </Field>
            <Field label="Kaynak notu (isteğe bağlı)">
              <Input value={form.sourceNote} onChange={(e) => setForm({ ...form, sourceNote: e.target.value })} placeholder="örn. 2026-Q2 Lexpera dışa aktarımı" />
            </Field>
          </div>
          <Field label="Kayıtlar (JSON dizisi)">
            <Textarea
              rows={10}
              value={form.json}
              onChange={(e) => setForm({ ...form, json: e.target.value })}
              placeholder={SAMPLE_JSON}
            />
          </Field>
          <p className="text-xs text-steel-400">
            Alanlar: court, chamber?, caseNumber, decisionNumber, decisionDate? (YYYY-MM-DD),
            summary?, fullText?, sourceUrl?. Partide en fazla 500 kayıt; biçimsiz künye reddedilir,
            tek kayıt hatası partiyi düşürmez.
          </p>
          {results ? (
            <div className="max-h-64 overflow-y-auto rounded-lg border border-steel-800">
              <Table columns={resultColumns} rows={results.results} rowKey={(r) => `${r.index}`} dense />
            </div>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setImportOpen(false)}>
              Kapat
            </Button>
            <Button onClick={() => void runImport()} disabled={busy || form.json.trim().length < 3 || form.sourceAdapter.trim().length < 2}>
              {busy ? "İçe aktarılıyor…" : "İçe Aktar"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
