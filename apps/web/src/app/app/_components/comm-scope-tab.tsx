"use client";

/**
 * Bağlam içi iletişim sekmesi — müvekkil kartında ve dosya detayında.
 *
 * İletişim Merkezi'nin dar kapsamlı hâlidir: aynı kronoloji, aynı onay akışı,
 * ama yalnız o müvekkile / o dosyaya ait satırlar. Bileşenin tek kopya olması
 * bilinçlidir — onay kapısı iki ayrı yerde iki ayrı biçimde uygulanırsa
 * birinde unutulur.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, ErrorBox, Spinner } from "@/components/ui";
import { FeatureUnavailable } from "@/components/ai-ui";
import { errText } from "@/lib/faz2";
import { CommTimeline } from "./comm-timeline";
import { ComposeMessageModal } from "./compose-message-modal";
import { isFeatureMissing, listChannelStatus, listTimeline, type ChannelStatus } from "../_lib/faz5";
import type { CaseRef, ClientRef, CommEntry } from "../_lib/faz5-types";

type Notify = (text: string, tone?: "success" | "error" | "info") => void;

export function CommScopeTab({
  clientId,
  caseId,
  clients,
  cases,
  onNotify,
}: {
  /** Müvekkil kapsamı. Dosya kapsamında da doldurulursa yeni mesaj hedefi olur. */
  clientId?: string;
  /** Dosya kapsamı — verilirse liste bu dosyayla sınırlanır. */
  caseId?: string;
  clients: ClientRef[];
  cases: CaseRef[];
  onNotify: Notify;
}) {
  const [entries, setEntries] = useState<CommEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [editing, setEditing] = useState<CommEntry | null>(null);
  const [channelStatus, setChannelStatus] = useState<ChannelStatus[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMissing(false);
    try {
      // Birleşik kronoloji: giden taslaklar ve gelen mesajlar da bu uçtan gelir
      // (`GET /communications` yalnız elle kaydedilmiş görüşmeleri döndürür).
      setEntries(await listTimeline({ caseId, clientId: caseId ? undefined : clientId }));
    } catch (err) {
      if (isFeatureMissing(err)) setMissing(true);
      else setError(errText(err, "İletişim kayıtları yüklenemedi."));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [caseId, clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let alive = true;
    listChannelStatus()
      .then((s) => {
        if (alive) setChannelStatus(s);
      })
      .catch(() => {
        if (alive) setChannelStatus([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return <Spinner label="Yazışmalar yükleniyor…" />;
  if (missing) {
    return (
      <FeatureUnavailable
        title="İletişim Merkezi henüz hazır değil"
        detail="İletişim uçları yayına alındığında bu sekme otomatik olarak çalışacak."
        onRetry={() => void load()}
      />
    );
  }

  const canCompose = Boolean(clientId);

  return (
    <div className="space-y-4">
      {error && <ErrorBox message={error} />}

      <CommTimeline
        entries={entries}
        title={caseId ? "Bu Dosyaya Ait Yazışmalar" : "İletişim Geçmişi"}
        showCase={!caseId}
        showClient={!clientId}
        emptyMessage={
          caseId
            ? "Bu dosyaya bağlı yazışma yok. Yeni mesaj oluşturduğunuzda burada görünür."
            : "Bu müvekkille kayıtlı yazışma yok."
        }
        onOpen={(e) => {
          setEditing(e);
          setComposeOpen(true);
        }}
        action={
          <div className="flex items-center gap-3">
            <Link
              href="/app/iletisim"
              className="text-xs font-medium text-amber-600 hover:text-amber-500"
            >
              İletişim Merkezi →
            </Link>
            {canCompose && (
              <Button
                size="sm"
                variant="gold"
                onClick={() => {
                  setEditing(null);
                  setComposeOpen(true);
                }}
              >
                + Yeni Mesaj
              </Button>
            )}
          </div>
        }
      />

      {!canCompose && (
        <p className="text-xs text-slate-500">
          Bu dosyanın müvekkili okunamadığı için yeni mesaj oluşturulamıyor; İletişim
          Merkezi&apos;nden gönderebilirsiniz.
        </p>
      )}

      <ComposeMessageModal
        open={composeOpen}
        existing={editing}
        clients={clients}
        cases={cases}
        fixedClientId={clientId}
        fixedCaseId={caseId}
        channelStatus={channelStatus}
        onNotify={onNotify}
        onClose={() => setComposeOpen(false)}
        onSaved={load}
      />
    </div>
  );
}
