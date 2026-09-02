"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, asList, ApiError } from "@/lib/api";
import type { AiProvider, AiTaskRoute } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import { AI_PROVIDER_TYPE_LABELS, labelOf } from "@/lib/labels";
// Modül 26 — kredi modu rozeti ("Limitsiz mod aktif" / kalan kota).
import { useWallet } from "@/components/credits";
import {
  AI_PROVIDER_TYPES,
  AI_TASK_TYPES,
  AI_TASK_TYPE_LABELS,
  type AiProviderType,
  type AiTaskType,
} from "@nomosos/shared";

interface ProviderForm {
  name: string;
  type: AiProviderType;
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  headersJson: string;
  mappingJson: string;
}

const EMPTY_FORM: ProviderForm = {
  name: "",
  type: "ANTHROPIC",
  apiKey: "",
  baseUrl: "",
  defaultModel: "",
  headersJson: "",
  mappingJson: "",
};

/** Tip başına hangi alanlar gösterilir. */
const FIELD_RULES: Record<AiProviderType, { apiKey: boolean; baseUrl: boolean; custom: boolean }> = {
  ANTHROPIC: { apiKey: true, baseUrl: false, custom: false },
  OPENAI_COMPAT: { apiKey: true, baseUrl: true, custom: false },
  OLLAMA: { apiKey: false, baseUrl: true, custom: false },
  GEMINI: { apiKey: true, baseUrl: false, custom: false },
  CUSTOM: { apiKey: true, baseUrl: true, custom: true },
};

const MODEL_PLACEHOLDERS: Record<AiProviderType, string> = {
  ANTHROPIC: "örn. claude-sonnet-4-5",
  OPENAI_COMPAT: "örn. gpt-4o-mini",
  OLLAMA: "örn. llama3.1:70b",
  GEMINI: "örn. gemini-2.0-flash",
  CUSTOM: "Endpoint'inizin model adı",
};

type TestState = { status: "idle" | "busy" | "ok" | "fail"; message?: string };

export default function AiSaglayiciPage() {
  const { wallet } = useWallet();
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  /** D1.3 — BYO izni yoksa kilitli görünüm verisi. */
  const [platformStatus, setPlatformStatus] = useState<{
    byoAllowed: boolean;
    platformProvider: { name: string; type: string; defaultModel: string } | null;
    note?: string;
  } | null>(null);
  /** D1.3b — sağlayıcıdan çekilen model listesi (form seçici için). */
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<ProviderForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Görev tipi → model eşleme
  const [routes, setRoutes] = useState<Record<string, AiTaskRoute>>({});
  const [routesLoading, setRoutesLoading] = useState(true);
  const [routesError, setRoutesError] = useState<string | null>(null);
  const [routesSaving, setRoutesSaving] = useState(false);
  const [routesSaved, setRoutesSaved] = useState(false);

  const loadProviders = useCallback(async () => {
    setLoading(true);
    setError(null);
    // D1.3 — BYO plan yetkisi: platform durumu her açılışta sorgulanır.
    try {
      const status = await api<{
        byoAllowed: boolean;
        platformProvider: { name: string; type: string; defaultModel: string } | null;
        note?: string;
      } | null>("/ai/platform-status");
      if (status && status.byoAllowed === false) {
        setPlatformStatus(status);
        setLoading(false);
        return;
      }
      setPlatformStatus(null);
    } catch {
      /* durum alınamazsa yönetim görünümü denemeye devam eder */
    }
    try {
      const data = await api<unknown>("/ai/providers");
      setProviders(asList<AiProvider>(data));
    } catch (err) {
      // İ-38: 403 ayrımı — AVUKAT/SEKRETER buraya doğrudan URL yazarak gelirse
      // "yüklenemedi" değil rol kartı görür (ai-kullanim deseni).
      if (err instanceof ApiError && err.status === 403) {
        setForbidden(true);
      } else {
        setError(err instanceof ApiError ? err.message : "Sağlayıcılar yüklenemedi.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRoutes = useCallback(async () => {
    setRoutesLoading(true);
    setRoutesError(null);
    try {
      const data = await api<unknown>("/ai/task-routes");
      const map: Record<string, AiTaskRoute> = {};
      for (const r of asList<AiTaskRoute>(data)) {
        map[r.taskType] = r;
      }
      setRoutes(map);
    } catch (err) {
      setRoutesError(err instanceof ApiError ? err.message : "Görev eşlemeleri yüklenemedi.");
    } finally {
      setRoutesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProviders();
    void loadRoutes();
  }, [loadProviders, loadRoutes]);

  const rules = FIELD_RULES[form.type];

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);

    // CUSTOM için JSON alanlarını önden doğrula.
    for (const [label, value] of [
      ["Ek header'lar", form.headersJson],
      ["Alan eşlemesi", form.mappingJson],
    ] as const) {
      if (rules.custom && value.trim()) {
        try {
          JSON.parse(value);
        } catch {
          setSaveError(`${label} alanı geçerli JSON olmalı.`);
          setSaving(false);
          return;
        }
      }
    }

    try {
      await api("/ai/providers", {
        method: "POST",
        body: {
          name: form.name.trim(),
          type: form.type,
          apiKey: rules.apiKey && form.apiKey.trim() ? form.apiKey.trim() : undefined,
          baseUrl: rules.baseUrl && form.baseUrl.trim() ? form.baseUrl.trim() : undefined,
          defaultModel: form.defaultModel.trim(),
          headersJson: rules.custom && form.headersJson.trim() ? form.headersJson.trim() : undefined,
          mappingJson: rules.custom && form.mappingJson.trim() ? form.mappingJson.trim() : undefined,
        },
      });
      setModalOpen(false);
      setForm(EMPTY_FORM);
      void loadProviders();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Sağlayıcı kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(id: string) {
    setTests((prev) => ({ ...prev, [id]: { status: "busy" } }));
    try {
      const res = await api<{ ok?: boolean; success?: boolean; message?: string; model?: string }>(
        `/ai/providers/${id}/test`,
        { method: "POST" },
      );
      const ok = res.ok ?? res.success ?? true;
      setTests((prev) => ({
        ...prev,
        [id]: {
          status: ok ? "ok" : "fail",
          message: res.message ?? (ok ? "Bağlantı başarılı" : "Bağlantı başarısız"),
        },
      }));
    } catch (err) {
      setTests((prev) => ({
        ...prev,
        [id]: {
          status: "fail",
          message: err instanceof ApiError ? err.message : "Bağlantı testi başarısız.",
        },
      }));
    }
  }

  async function handleDelete(provider: AiProvider) {
    if (typeof window !== "undefined" && !window.confirm(`"${provider.name}" silinsin mi?`)) return;
    try {
      await api(`/ai/providers/${provider.id}`, { method: "DELETE" });
      void loadProviders();
      void loadRoutes();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sağlayıcı silinemedi.");
    }
  }

  function updateRoute(taskType: AiTaskType, patch: Partial<AiTaskRoute>) {
    setRoutesSaved(false);
    setRoutes((prev) => {
      const current = prev[taskType] ?? { taskType, providerConfigId: "", model: "" };
      const next = { ...current, ...patch };
      // Sağlayıcı değişince modeli sağlayıcının varsayılanına çek.
      if (patch.providerConfigId !== undefined && patch.model === undefined) {
        const p = providers.find((x) => x.id === patch.providerConfigId);
        next.model = p?.defaultModel ?? "";
      }
      return { ...prev, [taskType]: next };
    });
  }

  /** D1.3b — kaydetmeden model önizleme: formdaki tür/anahtar/adresle sağlayıcıdan model listesi. */
  async function fetchModels() {
    setModelsBusy(true);
    setModelsError(null);
    try {
      const res = await api<{ models: string[] }>("/ai/providers/models-preview", {
        method: "POST",
        body: {
          type: form.type,
          ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
          ...(form.baseUrl.trim() ? { baseUrl: form.baseUrl.trim() } : {}),
        },
      });
      if (res.models.length === 0) {
        setModelsError("Sağlayıcı model listesi döndürmedi.");
      } else {
        setModelOptions(res.models);
      }
    } catch (err) {
      setModelsError(err instanceof ApiError ? err.message : "Model listesi alınamadı.");
    } finally {
      setModelsBusy(false);
    }
  }

  async function handleSaveRoutes() {
    setRoutesSaving(true);
    setRoutesError(null);
    setRoutesSaved(false);
    try {
      const payload = Object.values(routes).filter((r) => r.providerConfigId && r.model);
      await api("/ai/task-routes", { method: "PUT", body: { routes: payload } });
      setRoutesSaved(true);
      void loadRoutes();
    } catch (err) {
      setRoutesError(err instanceof ApiError ? err.message : "Eşlemeler kaydedilemedi.");
    } finally {
      setRoutesSaving(false);
    }
  }

  // D1.3 — BYO PLAN KISIDI: plan kendi sağlayıcı tanımlamayı kapsamıyorsa
  // bu ekran YÖNETİM ekranı değildir; yalnız platform sağlayıcı bilgisi görünür.
  if (platformStatus && platformStatus.byoAllowed === false) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">AI Sağlayıcı Ayarları</h1>
          <p className="mt-1 text-sm text-slate-500">
            BYO-LLM: kendi modelinizi bağlayın. Ollama veya özel endpoint seçerseniz verileriniz
            büronuzdan çıkmaz.
          </p>
        </div>
        <Card>
          <div className="space-y-3 p-6">
            <p className="text-sm font-semibold text-slate-800">
              Planınız kendi AI sağlayıcınızı tanımlamayı kapsamıyor
            </p>
            <p className="text-sm leading-6 text-slate-600">
              AI görevleriniz NomosOS platform sağlayıcılarından yürütülür — anahtar yönetimi,
              güncelleme ve maliyet NomosOS tarafındadır.
            </p>
            {platformStatus.platformProvider ? (
              <dl className="grid grid-cols-3 gap-3 text-sm">
                <div className="rounded-lg border border-slate-200 p-3">
                  <dt className="text-xs text-slate-500">Kullanılan sağlayıcı</dt>
                  <dd className="mt-1 font-semibold text-slate-800">{platformStatus.platformProvider.name}</dd>
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <dt className="text-xs text-slate-500">Tür</dt>
                  <dd className="mt-1 font-semibold text-slate-800">{platformStatus.platformProvider.type}</dd>
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <dt className="text-xs text-slate-500">Varsayılan model</dt>
                  <dd className="mt-1 font-semibold text-slate-800">{platformStatus.platformProvider.defaultModel}</dd>
                </div>
              </dl>
            ) : (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                {platformStatus.note ?? "Platform sağlayıcısı henüz atanmamış; destek ile görüşün."}
              </p>
            )}
            <p className="text-xs text-slate-500">
              Kendi sağlayıcınızı bağlamak için paketinizi{" "}
              <Link href="/app/ayarlar/ai-kullanim" className="underline">
                AI Kullanımı
              </Link>{" "}
              üzerinden veya satış ekibimizle görüşün.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  // İ-38: yetkisiz rol için açık rol kartı — ham hata metni yerine.
  if (forbidden) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">AI Sağlayıcı Ayarları</h1>
          <p className="mt-1 text-sm text-slate-500">
            BYO-LLM: kendi modelinizi bağlayın. Ollama veya özel endpoint seçerseniz verileriniz
            büronuzdan çıkmaz.
          </p>
        </div>
        <Card>
          <p className="p-5 text-sm text-slate-600">
            Sağlayıcı yapılandırması <strong>Ortak</strong> ve <strong>Yönetici</strong>{" "}
            rollerine açıktır — API anahtarları bütçe ve veri akışı kararıdır.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">AI Sağlayıcı Ayarları</h1>
          <p className="mt-1 text-sm text-slate-500">
            BYO-LLM: kendi modelinizi bağlayın. Ollama veya özel endpoint seçerseniz verileriniz
            büronuzdan çıkmaz.
          </p>
        </div>
        <Button variant="gold" onClick={() => setModalOpen(true)}>
          + Yeni Sağlayıcı
        </Button>
      </div>

      {/* ---------- Kredi modu (Modül 26) ---------- */}
      {wallet &&
        (wallet.limitsiz ? (
          <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            <p className="font-semibold">
              <span aria-hidden="true">∞</span> Limitsiz mod aktif — abonelikte %30 indirim
              uygulanıyor
            </p>
            <p className="mt-1">
              Kendi API anahtarınızı kullandığınız için <strong>kredi kotası uygulanmaz</strong>.
              AI maliyeti kendi sağlayıcı hesabınızdadır; NomosOS yalnızca kullanım kaydı
              (görev, model, token) tutar.
            </p>
          </div>
        ) : (
          wallet.cuzdan && (
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
              <p>
                Yönetilen AI modundasınız: bu dönem{" "}
                <strong className="tabular-nums">{wallet.cuzdan.kullanilabilir}</strong> krediniz
                kaldı.{" "}
                {/* İ-42: iç gezinmede next/link — düz <a> tüm istemci
                    durumunu boşaltıp tam sayfa yeniden yüklemeye zorluyordu. */}
                <Link
                  href="/app/ayarlar/ai-kullanim"
                  className="font-medium text-slate-900 underline underline-offset-2"
                >
                  Kullanım dökümü
                </Link>
              </p>
              <p className="mt-1 text-slate-500">
                Aşağıdan kendi API anahtarınızı bağlarsanız kredi limitleri tamamen kalkar ve
                abonelikte %30 indirim uygulanır. Değişiklik, büronuz için platform tarafında
                kaydedilir.
              </p>
            </div>
          )
        ))}

      {/* Sağlayıcı listesi */}
      <Card title="Tanımlı Sağlayıcılar">
        {loading ? (
          <Spinner />
        ) : error ? (
          <ErrorBox message={error} />
        ) : providers.length === 0 ? (
          <EmptyState message="Henüz AI sağlayıcı tanımlanmadı. AI özellikleri için bir sağlayıcı ekleyin." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {providers.map((p) => {
              const test = tests[p.id] ?? { status: "idle" as const };
              return (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900">{p.name}</p>
                      <Badge tone="navy">{labelOf(AI_PROVIDER_TYPE_LABELS, p.type)}</Badge>
                      {p.isActive === false && <Badge tone="gray">Pasif</Badge>}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Varsayılan model: <code>{p.defaultModel}</code>
                      {p.baseUrl ? ` · ${p.baseUrl}` : ""}
                    </p>
                    {test.status === "ok" && (
                      <p className="mt-1 text-xs font-medium text-emerald-600">✓ {test.message}</p>
                    )}
                    {test.status === "fail" && (
                      <p className="mt-1 text-xs font-medium text-red-600">✗ {test.message}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={test.status === "busy"}
                      onClick={() => void handleTest(p.id)}
                    >
                      {test.status === "busy" ? "Test ediliyor…" : "Bağlantıyı Test Et"}
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => void handleDelete(p)}>
                      Sil
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Görev tipi → model eşlemesi */}
      <Card
        title="Görev Tipi → Model Eşlemesi"
        action={
          <div className="flex items-center gap-3">
            {routesSaved && <span className="text-xs font-medium text-emerald-600">Kaydedildi ✓</span>}
            <Button size="sm" disabled={routesSaving || providers.length === 0} onClick={() => void handleSaveRoutes()}>
              {routesSaving ? "Kaydediliyor…" : "Eşlemeleri Kaydet"}
            </Button>
          </div>
        }
      >
        <p className="mb-4 text-xs text-slate-500">
          Her AI görevi için farklı sağlayıcı ve model seçebilirsiniz — örneğin dilekçe taslağını
          güçlü bir modele, belge sınıflandırmayı hızlı ve ekonomik bir modele yönlendirin.
          Eşlenmemiş görevler sağlayıcının varsayılan modelini kullanır.
        </p>
        {routesLoading ? (
          <Spinner />
        ) : routesError ? (
          <ErrorBox message={routesError} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-4 font-medium">Görev Tipi</th>
                  <th className="py-2 pr-4 font-medium">Sağlayıcı</th>
                  <th className="py-2 font-medium">Model</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {AI_TASK_TYPES.map((taskType) => {
                  const route = routes[taskType];
                  return (
                    <tr key={taskType} className="hover:bg-slate-50">
                      <td className="py-2.5 pr-4">
                        <p className="font-medium text-slate-900">{AI_TASK_TYPE_LABELS[taskType]}</p>
                        <p className="text-[11px] text-slate-500">{taskType}</p>
                      </td>
                      <td className="py-2.5 pr-4">
                        <div className="w-56">
                          <Select
                            value={route?.providerConfigId ?? ""}
                            onChange={(e) => updateRoute(taskType, { providerConfigId: e.target.value })}
                            className="!py-1.5 text-xs"
                            aria-label={`${AI_TASK_TYPE_LABELS[taskType]} sağlayıcısı`}
                          >
                            <option value="">— Eşleme yok —</option>
                            {providers.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </Select>
                        </div>
                      </td>
                      <td className="py-2.5">
                        <div className="w-56">
                          <Input
                            value={route?.model ?? ""}
                            onChange={(e) => updateRoute(taskType, { model: e.target.value })}
                            placeholder="Model adı"
                            disabled={!route?.providerConfigId}
                            className="!py-1.5 text-xs"
                            aria-label={`${AI_TASK_TYPE_LABELS[taskType]} modeli`}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Yeni sağlayıcı modalı */}
      <Modal open={modalOpen} title="Yeni AI Sağlayıcı" onClose={() => setModalOpen(false)} wide>
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Ad" hint='Örn. "Büro Claude hesabı"'>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </Field>
            <Field label="Tip">
              <Select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as AiProviderType })}
              >
                {AI_PROVIDER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {labelOf(AI_PROVIDER_TYPE_LABELS, t)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {rules.apiKey && (
            <Field label="API Anahtarı" hint="AES-256-GCM ile şifrelenerek saklanır.">
              <Input
                type="password"
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                placeholder="sk-…"
                autoComplete="off"
                required={form.type !== "CUSTOM"}
              />
            </Field>
          )}

          {rules.baseUrl && (
            <Field
              label="Base URL"
              hint={
                form.type === "OLLAMA"
                  ? "Örn. http://localhost:11434"
                  : form.type === "OPENAI_COMPAT"
                    ? "Boş bırakılırsa OpenAI; Azure/OpenRouter/Groq/vLLM için endpoint girin."
                    : "Modelinizin HTTP endpoint adresi"
              }
            >
              <Input
                type="url"
                value={form.baseUrl}
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                placeholder="https://…"
                required={form.type === "OLLAMA" || form.type === "CUSTOM"}
              />
            </Field>
          )}

          <Field
            label="Varsayılan Model"
            hint="Model adını elle yazmayın — sağlayıcıdan çekin ve listeden seçin."
          >
            {/* D1.3b — model listesi SAĞLAYICIDAN çekilir; seçim listesi sunulur. */}
            {modelOptions.length > 0 ? (
              <Select
                value={form.defaultModel}
                onChange={(e) => setForm({ ...form, defaultModel: e.target.value })}
                required
              >
                <option value="">Model seçin…</option>
                {modelOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                value={form.defaultModel}
                onChange={(e) => setForm({ ...form, defaultModel: e.target.value })}
                placeholder={MODEL_PLACEHOLDERS[form.type]}
                required
              />
            )}
            <Button
              variant="secondary"
              className="mt-2"
              disabled={modelsBusy || (!rules.apiKey && !rules.baseUrl)}
              onClick={() => void fetchModels()}
            >
              {modelsBusy ? "Modeller çekiliyor…" : "Modelleri Sağlayıcıdan Çek"}
            </Button>
            {modelsError && <p className="mt-1 text-[11px] text-red-700">{modelsError}</p>}
          </Field>

          {rules.custom && (
            <>
              <Field label="Ek Header'lar (JSON)" hint='Örn. {"X-Api-Key": "…", "X-Tenant": "buro-1"}'>
                <Textarea
                  rows={3}
                  value={form.headersJson}
                  onChange={(e) => setForm({ ...form, headersJson: e.target.value })}
                  placeholder='{ "Authorization": "Bearer …" }'
                  className="font-mono text-xs"
                />
              </Field>
              <Field
                label="İstek/Yanıt Alan Eşlemesi (JSON)"
                hint='Örn. {"request": {"prompt": "input.text"}, "response": {"text": "output.answer"}}'
              >
                <Textarea
                  rows={4}
                  value={form.mappingJson}
                  onChange={(e) => setForm({ ...form, mappingJson: e.target.value })}
                  placeholder='{ "request": { … }, "response": { … } }'
                  className="font-mono text-xs"
                />
              </Field>
            </>
          )}

          {saveError && <ErrorBox message={saveError} />}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Vazgeç
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
