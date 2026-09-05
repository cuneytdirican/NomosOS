"use client";

/**
 * Ayarlar → Veri göçü (Faz 8E): dosya / duruşma CSV ve belge ZIP içe aktarma sihirbazı.
 * Adımlar: 1) tür + şablon 2) CSV/ZIP seç 3) önizleme (dry-run — hiçbir şey yazılmaz) 4) çalıştır.
 * Yalnız ADMIN/PARTNER (API tarafında ONAY rolü kapısı).
 */

import { useState } from "react";
import { ApiError, api, getToken } from "@/lib/api";
import {
  IMPORT_COLUMNS,
  IMPORT_KINDS,
  IMPORT_KIND_LABELS,
  IMPORT_ROUTES,
  importTemplateCsv,
  type ImportKind,
  type ImportPreviewResult,
  type ImportRunResult,
} from "@nomosos/shared";
import { Badge, Button, Card, ErrorBox, SuccessBox, Textarea } from "@/components/ui";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

const ACTION_TONE = { EKLE: "green", ATLA: "yellow", HATA: "red" } as const;

function uploadZip(file: File, dryRun: boolean): Promise<ImportRunResult> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file, file.name);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/api/v1${IMPORT_ROUTES.zip}?dryRun=${dryRun ? "1" : "0"}`);
    xhr.withCredentials = true;
    const token = getToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as ImportRunResult);
      else reject(new Error((data as { message?: string } | null)?.message ?? `Yükleme başarısız (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Ağ hatası"));
    xhr.send(form);
  });
}

export default function VeriGocuPage() {
  const [kind, setKind] = useState<ImportKind>("dosyalar");
  const [csv, setCsv] = useState("");
  const [zip, setZip] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [result, setResult] = useState<ImportRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setPreview(null);
    setResult(null);
    setError(null);
  }

  async function readFile(file: File) {
    const text = await file.text();
    setCsv(text);
    reset();
  }

  async function doPreview() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      if (kind === "belgeler") {
        if (!zip) throw new Error("ZIP seçin.");
        setPreview(await uploadZip(zip, true));
      } else {
        setPreview(await api<ImportPreviewResult>(IMPORT_ROUTES.preview, { method: "POST", body: { kind, csv } }));
      }
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Önizleme başarısız.");
    } finally {
      setBusy(false);
    }
  }

  async function doRun() {
    if (!preview || preview.ekle === 0) return;
    if (!window.confirm(`${preview.ekle} kayıt eklenecek, ${preview.atla} atlanacak, ${preview.hata} hatalı satır yazılmayacak. Devam edilsin mi?`)) return;
    setBusy(true);
    setError(null);
    try {
      const r = kind === "belgeler" ? await uploadZip(zip!, false) : await api<ImportRunResult>(IMPORT_ROUTES.run, { method: "POST", body: { kind, csv } });
      setResult(r);
      setPreview(null);
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "İçe aktarma başarısız.");
    } finally {
      setBusy(false);
    }
  }

  function downloadTemplate() {
    const blob = new Blob([`\uFEFF${importTemplateCsv(kind)}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nomosos-${kind}-sablon.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const table = preview ?? result;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Veri göçü</h1>
        <p className="mt-1 text-sm text-slate-500">Eski yazılımdan dosya, duruşma ve belgelerinizi taşıyın. Önce önizleme: hiçbir şey yazılmaz; satır satır ne olacağını görürsünüz. Müvekkil listesi için Müvekkiller sayfasındaki CSV aktarımını kullanın.</p>
      </div>
      {error && <ErrorBox message={error} />}
      {result && <SuccessBox message={`Tamamlandı: ${result.created} kayıt eklendi · ${result.atla} atlandı · ${result.failed + result.hata} hata.`} />}

      <Card title="1. Ne aktarılacak?">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Aktarım türü">
          {IMPORT_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => {
                setKind(k);
                reset();
              }}
              className={`rounded-lg border px-3 py-2 text-sm ${kind === k ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
              data-testid={`gocu-tur-${k}`}
            >
              {IMPORT_KIND_LABELS[k]}
            </button>
          ))}
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1 pr-3">Kolon</th>
                <th className="py-1 pr-3">Zorunlu</th>
                <th className="py-1 pr-3">Açıklama</th>
                <th className="py-1 pr-3">Örnek</th>
              </tr>
            </thead>
            <tbody>
              {IMPORT_COLUMNS[kind].map((c) => (
                <tr key={c.key} className="border-t border-slate-100">
                  <td className="py-1 pr-3 font-mono">{c.key}</td>
                  <td className="py-1 pr-3">{c.required ? "evet" : ""}</td>
                  <td className="py-1 pr-3 text-slate-600">{c.description}</td>
                  <td className="py-1 pr-3 text-slate-500">{c.example}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3">
          <Button size="sm" variant="secondary" onClick={downloadTemplate}>
            Şablon CSV indir
          </Button>
        </div>
      </Card>

      <Card title={kind === "belgeler" ? "2. ZIP seç" : "2. CSV yapıştır ya da seç"}>
        {kind === "belgeler" ? (
          <div className="space-y-2 text-sm text-slate-600">
            <p>ZIP içinde klasör adı esas numarası olabilir (ör. <span className="font-mono">2025-1234/vekaletname.pdf</span>) ya da kök dizine <span className="font-mono">belgeler.csv</span> koyarak her dosyayı esas no / dosya başlığıyla eşleyin. Her belge normal yükleme hattından geçer (tür/boyut kapısı, kota, kopya kontrolü, otomatik sınıflandırma).</p>
            <input
              type="file"
              accept=".zip,application/zip"
              onChange={(e) => {
                setZip(e.target.files?.[0] ?? null);
                reset();
              }}
              data-testid="gocu-zip"
            />
          </div>
        ) : (
          <div className="space-y-2">
            <input type="file" accept=".csv,text/csv,.txt" onChange={(e) => e.target.files?.[0] && void readFile(e.target.files[0])} data-testid="gocu-csv-dosya" />
            <Textarea rows={8} value={csv} onChange={(e) => { setCsv(e.target.value); reset(); }} placeholder={importTemplateCsv(kind)} className="font-mono text-xs" data-testid="gocu-csv" />
          </div>
        )}
        <div className="mt-3 flex gap-2">
          <Button onClick={() => void doPreview()} disabled={busy || (kind === "belgeler" ? !zip : !csv.trim())} data-testid="gocu-onizle">
            {busy && !preview ? "İnceleniyor…" : "3. Önizle (yazmaz)"}
          </Button>
          {preview && (
            <Button variant="gold" onClick={() => void doRun()} disabled={busy || preview.ekle === 0} data-testid="gocu-calistir">
              {busy ? "Aktarılıyor…" : `4. ${preview.ekle} kaydı aktar`}
            </Button>
          )}
        </div>
      </Card>

      {table && (
        <Card
          title={result ? "Sonuç" : "Önizleme"}
          action={
            <div className="flex gap-2">
              <Badge tone="green">{table.ekle} ekle</Badge>
              <Badge tone="yellow">{table.atla} atla</Badge>
              <Badge tone="red">{table.hata} hata</Badge>
            </div>
          }
        >
          {table.missingRequired.length > 0 && <ErrorBox message={`Zorunlu kolon eksik: ${table.missingRequired.join(", ")}`} />}
          {table.unknownHeaders.length > 0 && <p className="mb-2 text-xs text-slate-500">Yok sayılan başlıklar: {table.unknownHeaders.join(", ")}</p>}
          <div className="max-h-[28rem] overflow-auto">
            <table className="min-w-full text-xs" data-testid="gocu-satirlar">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-1 pr-3">Satır</th>
                  <th className="py-1 pr-3">İşlem</th>
                  <th className="py-1 pr-3">Kayıt</th>
                  <th className="py-1 pr-3">Notlar</th>
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r) => (
                  <tr key={r.row} className="border-t border-slate-100 align-top">
                    <td className="py-1 pr-3 tabular-nums">{r.row}</td>
                    <td className="py-1 pr-3">
                      <Badge tone={ACTION_TONE[r.action]}>{r.action}</Badge>
                    </td>
                    <td className="py-1 pr-3 text-slate-800">{r.label}</td>
                    <td className="py-1 pr-3 text-slate-600">{r.notes.join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
