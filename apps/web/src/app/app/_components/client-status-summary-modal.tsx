"use client";

/**
 * "Müvekkil durum özeti (AI)" — Faz 7F: dosya için sade dilli TASLAK. Mesaj kaydı açmaz;
 * avukat okur, kopyalar, mesaj/portal notu olarak kendisi kullanır. Kaynak: sade bağlam
 * (strateji/risk/iç not modele gitmez).
 */

import { useState } from "react";
import { ApiError, api } from "@/lib/api";
import { PORTAL_TODO_ROUTES } from "@nomosos/shared";
import { Button, ErrorBox, Field, Modal, Select, Textarea } from "@/components/ui";

interface SummaryResult {
  message: string;
  glossary: Array<{ term: string; explanation: string }>;
  nextStepForClient: string | null;
  meta: Record<string, unknown>;
}

export function ClientStatusSummaryModal({ open, caseId, onClose }: { open: boolean; caseId: string; onClose: () => void }) {
  const [channel, setChannel] = useState<"PORTAL" | "EMAIL" | "WHATSAPP" | "SMS">("PORTAL");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SummaryResult | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await api<SummaryResult>(PORTAL_TODO_ROUTES.clientStatusSummary, { method: "POST", body: { caseId, channel, instruction: instruction.trim() || null } });
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Özet üretilemedi.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.message + (result.nextStepForClient ? `\n\nSizden beklenen: ${result.nextStepForClient}` : ""));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Modal open={open} title="Müvekkil durum özeti (AI taslak)" onClose={onClose} wide>
      <div className="space-y-4">
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">Bu metin yapay zekâ tarafından üretilmiş bir ÖNERİDİR; bağlayıcı değildir, göndermeden önce kontrol edin. Strateji, risk ve iç notlar modele gitmez.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Hedef kanal" hint="SMS: 2–3 cümle; diğerleri kısa paragraf.">
            <Select value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}>
              <option value="PORTAL">Portal notu</option>
              <option value="EMAIL">E-posta</option>
              <option value="WHATSAPP">WhatsApp</option>
              <option value="SMS">SMS</option>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Ek talimat (isteğe bağlı)">
              <Textarea rows={2} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Ör. Bilirkişi raporunu vurgula; duruşma tarihini hatırlat" />
            </Field>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="gold" disabled={busy} onClick={() => void generate()} data-testid="ozet-uret">
            {busy ? "Üretiliyor…" : result ? "Yeniden üret" : "Özeti üret"}
          </Button>
          {result && (
            <Button variant="secondary" onClick={() => void copy()}>
              {copied ? "Kopyalandı" : "Panoya kopyala"}
            </Button>
          )}
        </div>
        {error && <ErrorBox message={error} />}
        {result && (
          <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-800" data-testid="ozet-metin">
              {result.message}
            </p>
            {result.nextStepForClient && (
              <p className="text-sm text-slate-700">
                <strong>Müvekkilden beklenen:</strong> {result.nextStepForClient}
              </p>
            )}
            {result.glossary.length > 0 && (
              <ul className="text-xs text-slate-600">
                {result.glossary.map((g) => (
                  <li key={g.term}>
                    <strong>{g.term}:</strong> {g.explanation}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-slate-500">Bu bir taslaktır; onaysız hiçbir metin müvekkile gitmez. Göndermek için İletişim sekmesinden mesaj oluşturun ya da portal yayın notuna yapıştırın.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
