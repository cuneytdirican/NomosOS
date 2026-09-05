"use client";

/**
 * Rızalar — KVKK aydınlatma (okudum beyanı), açık rıza, e-posta/SMS bilgilendirme izinleri.
 * Her karar sürümlü metne bağlı, geri çekilebilir olanlar geri çekilebilir; kayıt ekleme-yalnızdır.
 */

import { useState } from "react";
import { EP } from "@/lib/endpoints";
import { errorMessage, portalApi } from "@/lib/api";
import { useResource } from "@/lib/useResource";
import { Badge, Button, Card, Disclosure, ErrorBox, InfoBox, PageHeader, PrivacyNote, ResourceView, SuccessBox } from "@/components/ui";

interface ConsentItem {
  kind: string;
  version: string;
  title: string;
  required: boolean;
  withdrawable: boolean;
  text: string;
  accepted: boolean;
  decidedAt: string | null;
  outdated: boolean;
}

interface ConsentStatus {
  items: ConsentItem[];
  missingRequired: string[];
}

export default function RizalarPage() {
  const status = useResource<ConsentStatus>(EP.consents);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function decide(item: ConsentItem, accepted: boolean) {
    setBusy(item.kind);
    setError(null);
    setNotice(null);
    try {
      await portalApi(EP.consents, { method: "POST", body: { kind: item.kind, version: item.version, accepted } });
      setNotice(accepted ? `"${item.title}" kaydedildi.` : `"${item.title}" geri çekildi.`);
      status.reload();
    } catch (err) {
      setError(errorMessage(err, "Kaydedilemedi."));
    } finally {
      setBusy(null);
    }
  }

  const items = status.data?.items ?? [];

  return (
    <div>
      <PageHeader title="Rızalar ve İzinler" description="Kişisel verilerinizin işlenmesine ilişkin bilgilendirme ve iletişim tercihleriniz. Her karar tarih, sürüm ve cihaz bilgisiyle kayıt altına alınır." />
      {notice && <SuccessBox>{notice}</SuccessBox>}
      {error && <ErrorBox message={error} />}
      <ResourceView
        loading={status.loading}
        missing={status.missing}
        forbidden={status.forbidden}
        error={status.error}
        empty={false}
        endpoint={status.endpoint}
        onRetry={status.reload}
        loadingLabel="Rıza kayıtları getiriliyor…"
        emptyMessage=""
      >
        <div className="space-y-4">
          {(status.data?.missingRequired.length ?? 0) > 0 && (
            <InfoBox>Portalı kullanmaya devam etmek için lütfen KVKK Aydınlatma Metni&apos;ni okuyup onaylayın.</InfoBox>
          )}
          {items.map((item) => (
            <Card key={item.kind} title={<span data-testid="riza-karti">{item.title}</span>} subtitle={item.required ? "Bilgilendirme (okudum beyanı)" : item.withdrawable ? "İsteğe bağlı — geri çekilebilir" : ""}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={item.accepted ? "good" : item.outdated ? "warn" : "neutral"}>
                  {item.accepted ? "Onaylı" : item.outdated ? "Metin güncellendi — yeniden onay gerekli" : "Onaylanmadı"}
                </Badge>
                {item.decidedAt && <span className="text-xs text-slate-500">Son karar: {new Date(item.decidedAt).toLocaleString("tr-TR")}</span>}
                <span className="text-xs text-slate-500">Sürüm {item.version}</span>
              </div>
              <div className="mt-3">
                <Disclosure summary="Metni oku">
                  <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.text}</p>
                </Disclosure>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {!item.accepted && (
                  <Button disabled={busy === item.kind} onClick={() => void decide(item, true)}>
                    {item.required ? "Okudum, anladım" : "Onaylıyorum"}
                  </Button>
                )}
                {item.accepted && item.withdrawable && (
                  <Button variant="secondary" disabled={busy === item.kind} onClick={() => void decide(item, false)}>
                    Geri çek
                  </Button>
                )}
              </div>
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
