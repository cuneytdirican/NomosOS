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
import { Card, PageHeader, PrivacyNote, ResourceView } from "@/components/ui";
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
