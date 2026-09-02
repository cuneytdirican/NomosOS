"use client";

/**
 * PLATFORM AI SAĞLAYICILARI (D1.3) — NomosOS'un işlettiği sağlayıcılar.
 *
 * BYO izni olmayan planlardaki kiracılar bu sağlayıcıları kullanır.
 * Model listesi SAĞLAYICIDAN ÇEKİLİR (elle yazılmaz).
 */

import { useCallback, useEffect, useState } from "react";
import { adminApi, errorMessage } from "@/lib/api";
import { EP } from "@/lib/endpoints";
import { can } from "@/lib/rbac";
import { useAdminSession } from "@/lib/session";
import { PageGate } from "@/components/RoleGate";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
} from "@/components/ui";

interface ProviderRow {
  id: string;
  name: string;
  type: string;
  baseUrl: string | null;
  defaultModel: string;
  hasApiKey: boolean;
  isDefault: boolean;
  isActive: boolean;
  notes: string | null;
}

const TYPES = ["ANTHROPIC", "OPENAI_COMPAT", "GEMINI", "OLLAMA", "CUSTOM"] as const;
const TYPE_LABELS: Record<string, string> = {
  ANTHROPIC: "Anthropic",
  OPENAI_COMPAT: "OpenAI-uyumlu (GLM, GPT, DeepSeek…)",
  GEMINI: "Google Gemini",
  OLLAMA: "Ollama (yerel)",
  CUSTOM: "Özel (alan eşlemeli)",
};

export default function PlatformAiPage() {
  return (
    <PageGate action="aiProvider.view">
      <PlatformAi />
    </PageGate>
  );
}

function PlatformAi() {
  const { role } = useAdminSession();
  const canManage = can(role, "aiProvider.manage");

  const [rows, setRows] = useState<ProviderRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    type: "OPENAI_COMPAT",
    apiKey: "",
    baseUrl: "",
    defaultModel: "",
    isDefault: false,
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [modelsOf, setModelsOf] = useState<Record<string, string[]>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminApi<ProviderRow[]>(EP.platformAi.list);
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(errorMessage(err, "Sağlayıcılar yüklenemedi."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditId(null);
    setForm({ name: "", type: "OPENAI_COMPAT", apiKey: "", baseUrl: "", defaultModel: "", isDefault: rows.length === 0, notes: "" });
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(row: ProviderRow) {
    setEditId(row.id);
    setForm({
      name: row.name,
      type: row.type,
      apiKey: "",
      baseUrl: row.baseUrl ?? "",
      defaultModel: row.defaultModel,
      isDefault: row.isDefault,
      notes: row.notes ?? "",
    });
    setFormError(null);
    setFormOpen(true);
  }

  async function save() {
    setBusy(true);
    setFormError(null);
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        type: form.type,
        ...(form.baseUrl.trim() ? { baseUrl: form.baseUrl.trim() } : {}),
        defaultModel: form.defaultModel.trim(),
        isDefault: form.isDefault,
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      };
      // Anahtar yalnız DOLDURULDUĞUNDA gönderilir (düzenlemede boş = dokunma).
      if (form.apiKey.trim()) body.apiKey = form.apiKey.trim();
      if (editId) {
        await adminApi(EP.platformAi.item(editId), { method: "PATCH", body });
      } else {
        if (!form.apiKey.trim() && form.type !== "OLLAMA" && form.type !== "CUSTOM") {
          throw new Error("Bu sağlayıcı türü için API anahtarı zorunludur.");
        }
        await adminApi(EP.platformAi.create, { method: "POST", body });
      }
      setFormOpen(false);
      setNotice(editId ? "Sağlayıcı güncellendi." : "Sağlayıcı eklendi.");
      await load();
    } catch (err) {
      setFormError(errorMessage(err, "Kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(row: ProviderRow) {
    try {
      await adminApi(EP.platformAi.item(row.id), { method: "PATCH", body: { isActive: !row.isActive } });
      await load();
    } catch (err) {
      setError(errorMessage(err, "Güncellenemedi."));
    }
  }

  async function makeDefault(row: ProviderRow) {
    try {
      await adminApi(EP.platformAi.item(row.id), { method: "PATCH", body: { isDefault: true } });
      setNotice(`${row.name} varsayılan yapıldı.`);
      await load();
    } catch (err) {
      setError(errorMessage(err, "Varsayılan yapılamadı."));
    }
  }

  async function test(row: ProviderRow) {
    setTesting(row.id);
    setNotice(null);
    setError(null);
    try {
      const res = await adminApi<{ ok: boolean; message: string }>(EP.platformAi.test(row.id), { method: "POST" });
      setNotice(`${row.name}: ${res.message}`);
    } catch (err) {
      setError(errorMessage(err, "Test başarısız."));
    } finally {
      setTesting(null);
    }
  }

  /** Model listesini sağlayıcıdan ÇEK — elle yazım yok (D1.3b). */
  async function fetchModels(row: ProviderRow) {
    setTesting(row.id);
    setError(null);
    try {
      const res = await adminApi<{ models: string[] }>(EP.platformAi.models(row.id), { method: "POST" });
      setModelsOf((prev) => ({ ...prev, [row.id]: res.models }));
    } catch (err) {
      setError(errorMessage(err, "Model listesi alınamadı."));
    } finally {
      setTesting(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Platform AI Sağlayıcıları"
        description="NomosOS tarafından işletilen AI sağlayıcıları — BYO izni olmayan planlardaki kiracılar bunları kullanır."
      />

      <div className="mt-6 space-y-6">
        <Card>
          <p className="p-4 text-xs leading-5 text-slate-500">
            Planında kendi LLM tanımlama yetkisi (allowBYOLLM) olmayan kiracıların AI görevleri buradaki
            sağlayıcılardan yürütülür. Öncelik: planın atadığı sağlayıcı → varsayılan işaretli → ilk aktif.
            API anahtarları AES-256-GCM ile şifreli saklanır ve ASLA listeye dönmez.
          </p>
        </Card>

        {notice && (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">{notice}</p>
        )}
        {error && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>}

        <Card>
          <div className="flex items-center justify-between p-4">
            <p className="text-sm font-semibold text-slate-700">Sağlayıcılar ({rows.length})</p>
            {canManage && (
              <Button onClick={openCreate}>+ Yeni Sağlayıcı</Button>
            )}
          </div>
          {loading ? (
            <p className="p-4 text-sm text-slate-500">Yükleniyor…</p>
          ) : rows.length === 0 ? (
            <p className="px-4 pb-5 text-sm text-slate-500">
              Henüz platform sağlayıcısı tanımlı değil. BYO izni olmayan kiracıların AI görevleri
              çalışmaz — en az bir sağlayıcı ekleyin.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {rows.map((row) => (
                <div key={row.id} className="space-y-2 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        {row.name}
                        {row.isDefault && <Badge tone="green">Varsayılan</Badge>}
                        <Badge tone={row.isActive ? "blue" : "gray"}>{row.isActive ? "Aktif" : "Pasif"}</Badge>
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {TYPE_LABELS[row.type] ?? row.type} · model: {row.defaultModel} · anahtar:{" "}
                        {row.hasApiKey ? "tanımlı" : "yok"}
                        {row.baseUrl ? ` · ${row.baseUrl}` : ""}
                      </p>
                    </div>
                    {canManage && (
                      <div className="flex flex-wrap gap-1">
                        <Button variant="secondary" disabled={testing === row.id} onClick={() => void test(row)}>
                          {testing === row.id ? "…" : "Test"}
                        </Button>
                        <Button variant="secondary" disabled={testing === row.id} onClick={() => void fetchModels(row)}>
                          Modelleri Çek
                        </Button>
                        <Button variant="secondary" onClick={() => openEdit(row)}>
                          Düzenle
                        </Button>
                        {!row.isDefault && (
                          <Button variant="secondary" onClick={() => void makeDefault(row)}>
                            Varsayılan Yap
                          </Button>
                        )}
                        <Button variant="secondary" onClick={() => void toggleActive(row)}>
                          {row.isActive ? "Pasifleştir" : "Aktifleştir"}
                        </Button>
                      </div>
                    )}
                  </div>
                  {modelsOf[row.id] && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
                      <p className="mb-1 font-semibold">{modelsOf[row.id].length} model bulundu:</p>
                      <p className="leading-5">{modelsOf[row.id].slice(0, 30).join(" · ")}{modelsOf[row.id].length > 30 ? " …" : ""}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editId ? "Sağlayıcıyı Düzenle" : "Yeni Platform AI Sağlayıcısı"}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Ad">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="NomosOS GLM" />
            </Field>
            <Field label="Tür">
              <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field
            label="API Anahtarı"
            hint={editId ? "Boş bırakılırsa mevcut anahtar KORUNUR." : "AES-256-GCM ile şifreli saklanır."}
          >
            <Input
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              placeholder="sk-…"
            />
          </Field>
          <Field label="Base URL" hint="Boş: türün varsayılan adresi kullanılır.">
            <Input
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              placeholder="https://open.bigmodel.cn/api/paas/v4"
            />
          </Field>
          <Field label="Varsayılan Model">
            <Input
              value={form.defaultModel}
              onChange={(e) => setForm({ ...form, defaultModel: e.target.value })}
              placeholder="glm-4.6"
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
              className="h-4 w-4 accent-amber-600"
            />
            Varsayılan sağlayıcı (plan atamamış kiracılar bunu kullanır)
          </label>
          <Field label="Not">
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Maliyet kodu, sözleşme no…" />
          </Field>
          {formError && <p className="text-xs text-red-700">{formError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setFormOpen(false)}>
              Vazgeç
            </Button>
            <Button
              disabled={busy || !form.name.trim() || form.defaultModel.trim().length < 2}
              onClick={() => void save()}
            >
              {busy ? "Kaydediliyor…" : editId ? "Güncelle" : "Ekle"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
