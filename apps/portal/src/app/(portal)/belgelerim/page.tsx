"use client";

/**
 * Belgelerim — avukatın portala yayınladığı belgeler, dosyaya göre gruplanır.
 *
 * Gruplama ekranın kendi işidir: API düz liste döndürse de müvekkil belgeleri
 * "hangi dosyaya ait" diye arar. Dosya bilgisi taşımayan belgeler sonda
 * "Dosyadan bağımsız belgeler" başlığı altında toplanır.
 */

import { EP } from "@/lib/endpoints";
import { useListResource } from "@/lib/useResource";
import { caseHeadline } from "@/lib/labels";
import type { PortalDocument } from "@/lib/types";
import { Button, Card, ErrorBox, Field, PageHeader, PrivacyNote, ResourceView, SuccessBox } from "@/components/ui";
import { useListResource as useCases } from "@/lib/useResource";
import { API_BASE, PORTAL_API_PREFIX, errorMessage, getToken } from "@/lib/api";
import { useRef, useState } from "react";
import type { PortalCase } from "@/lib/types";
import { DocumentRow } from "@/components/rows";

const UNGROUPED = "__ungrouped__";

export default function DocumentsPage() {
  const documents = useListResource<PortalDocument>(EP.documents);
  const groups = groupByCase(documents.data);

  return (
    <div>
      <PageHeader
        title="Belgelerim"
        description="Avukatınızın sizinle paylaştığı belgeleri buradan görüntüleyebilir ve indirebilirsiniz."
      />

      <UploadForm onUploaded={() => documents.reload()} />

      <ResourceView
        loading={documents.loading}
        missing={documents.missing}
        forbidden={documents.forbidden}
        error={documents.error}
        empty={documents.empty}
        endpoint={documents.endpoint}
        onRetry={documents.reload}
        loadingLabel="Belgeleriniz getiriliyor…"
        emptyMessage="Avukatınız henüz sizinle bir belge paylaşmadı."
        emptyHint="Bir belge paylaşıldığında burada listelenir ve indirebilirsiniz."
      >
        <div className="space-y-6">
          {groups.map((g) => (
            <Card
              key={g.key}
              title={g.title}
              subtitle={`${g.items.length} belge`}
            >
              {g.items.map((d) => (
                <DocumentRow key={d.id} doc={d} showCase={false} />
              ))}
            </Card>
          ))}
        </div>
      </ResourceView>

      <div className="mt-8">
        <PrivacyNote />
      </div>
    </div>
  );
}

interface Group {
  key: string;
  title: string;
  items: PortalDocument[];
}

/** Belgeleri dosyaya göre gruplar; dosyasız olanlar en sona alınır. */
function groupByCase(rows: PortalDocument[]): Group[] {
  const map = new Map<string, Group>();

  for (const doc of rows) {
    const key = doc.caseId ?? UNGROUPED;
    const existing = map.get(key);
    if (existing) {
      existing.items.push(doc);
      continue;
    }
    map.set(key, {
      key,
      title:
        key === UNGROUPED
          ? "Dosyadan bağımsız belgeler"
          : caseHeadline({
              fileNumber: doc.caseFileNumber,
              title: doc.caseTitle,
            }),
      items: [doc],
    });
  }

  const groups = [...map.values()];
  groups.sort((a, b) => {
    if (a.key === UNGROUPED) return 1;
    if (b.key === UNGROUPED) return -1;
    return a.title.localeCompare(b.title, "tr-TR");
  });
  return groups;
}

/**
 * Faz 7F — müvekkil belge yükleme: yalnız portalda yayında olan dosyalara; büro hattından geçer
 * (OCR/sınıflandırma) ve büro bilgilendirilir. Cihazda kopya kalmaz.
 */
function UploadForm({ onUploaded }: { onUploaded: () => void }) {
  const cases = useCases<PortalCase>(EP.cases);
  const [caseId, setCaseId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function upload(file: File) {
    if (!caseId) {
      setError("Önce belgenin ait olduğu dosyayı seçin.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      form.append("caseId", caseId);
      if (note.trim()) form.append("note", note.trim());
      const token = getToken();
      const res = await fetch(`${API_BASE}${PORTAL_API_PREFIX}${EP.documentUpload}`, {
        method: "POST",
        body: form,
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = (await res.json().catch(() => null)) as { message?: string; name?: string } | null;
      if (!res.ok) throw new Error(data?.message ?? `Yükleme başarısız (HTTP ${res.status}).`);
      setNotice(`${data?.name ?? file.name}: ${data?.message ?? "yüklendi."}`);
      setNote("");
      onUploaded();
    } catch (err) {
      setError(errorMessage(err, "Yükleme başarısız."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Belge gönder" subtitle="Avukatınızın istediği bir belgeyi (PDF, görüntü, Word) dosyanıza yükleyin.">
      {notice && <SuccessBox>{notice}</SuccessBox>}
      {error && <ErrorBox message={error} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Dosya">
          <select className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" value={caseId} onChange={(e) => setCaseId(e.target.value)} data-testid="portal-yukle-dosya">
            <option value="">Seçiniz…</option>
            {cases.data.map((c) => (
              <option key={c.id} value={c.id}>
                {caseHeadline({ fileNumber: c.fileNumber, title: c.title })}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Not (isteğe bağlı)">
          <input className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ör. İstenen kira sözleşmesi" maxLength={500} />
        </Field>
      </div>
      <div className="mt-3">
        <Button disabled={busy || !caseId} onClick={() => fileRef.current?.click()}>
          {busy ? "Yükleniyor…" : "Dosya seç ve yükle"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.docx,.udf,.txt"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = "";
          }}
        />
      </div>
      <p className="mt-2 text-xs text-slate-500">En fazla 25 MB. Yüklediğiniz belge büro hattında işlenir ve dosyanızda görünür; büronuz bilgilendirilir.</p>
    </Card>
  );
}
