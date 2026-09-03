"use client";

/**
 * YARGI & NOTER KATALOĞU — platform yönetimi.
 *
 * GET  /judicial/bodies         — arama + liste (q/type/il)
 * POST /judicial/bodies         — yeni organ (katalogda eksik olanı ekle)
 * PATCH /judicial/bodies/:id    — düzeltme / pasifleştirme
 * POST /judicial/notaries + PATCH /judicial/notaries/:id
 * PUT  /judicial/sync/settings  — senkron kaynağı + aralık
 * POST /judicial/sync           — senkronu şimdi çalıştır
 * GET  /judicial/sync/logs      — son denemeler
 *
 * DÜRÜSTLÜK: katalog SEED'ten gelir ve YAKLAŞIKTIR; eksik/yanlış kayıt
 * buradan düzeltilir. Senkron kaynağı TANIMLIYSA periyodik güncelleme çalışır;
 * tanımsızsa zamanlayıcı kurulmaz ve elle tetikleme ATLANDI yazar.
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
  PageHeader,
  Select,
  Table,
  type Column,
} from "@/components/ui";

interface JudicialBodyRow {
  id: string;
  type: string;
  category: string;
  name: string;
  il: string;
  ilce: string | null;
  isActive: boolean;
  source: string;
}

interface SyncLogRow {
  id: string;
  kind: string;
  status: string;
  added: number;
  updated: number;
  detail: string | null;
  triggeredBy: string | null;
  createdAt: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  ASLIYE_HUKUK: "Asliye Hukuk",
  ASLIYE_CEZA: "Ağır Ceza",
  SULH_HUKUK: "Sulh Hukuk",
  SULH_CEZA: "Sulh Ceza",
  IS: "İş",
  AILE: "Aile",
  TUKETICI: "Tüketici",
  KADASTRO: "Kadastro",
  ICRA_HUKUK: "İcra Hukuk",
  FIKRI_SINAI: "Fikrî ve Sınai Haklar",
  ISTINAF: "İstinaf",
  ICRA: "İcra Dairesi",
};

export default function YargiKatalogPage() {
  return (
    <PageGate action="judicial.view">
      <YargiKatalog />
    </PageGate>
  );
}

function YargiKatalog() {
  const { role } = useAdminSession();
  const canManage = can(role, "judicial.manage");

  const [rows, setRows] = useState<JudicialBodyRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const [syncUrl, setSyncUrl] = useState("");
  const [intervalHours, setIntervalHours] = useState("168");
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [logs, setLogs] = useState<SyncLogRow[]>([]);

  const [newName, setNewName] = useState("");
  const [newIl, setNewIl] = useState("");
  const [newType, setNewType] = useState("MAHKEME");
  const [newCategory, setNewCategory] = useState("ASLIYE_HUKUK");
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [notaryName, setNotaryName] = useState("");
  const [notaryIl, setNotaryIl] = useState("");
  const [notaryBusy, setNotaryBusy] = useState(false);

  // D7 — vergi dairesi kataloğu
  const [taxOffices, setTaxOffices] = useState<Array<{ id: string; name: string; il: string; isActive: boolean }>>([]);
  const [taxOfficeName, setTaxOfficeName] = useState("");
  const [taxOfficeIl, setTaxOfficeIl] = useState("");
  const [taxBusy, setTaxBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi<{ items: JudicialBodyRow[]; total: number }>(EP.judicial.bodies, {
        query: { ...(q ? { q } : {}), ...(typeFilter ? { type: typeFilter } : {}), limit: "200" },
      });
      setRows(res.items ?? []);
      setTotal(res.total ?? 0);
    } catch (err) {
      setError(errorMessage(err, "Katalog yüklenemedi."));
    } finally {
      setLoading(false);
    }
  }, [q, typeFilter]);

  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const loadSync = useCallback(async () => {
    try {
      const [settings, logRows] = await Promise.all([
        adminApi<{ url: string | null; intervalHours: number }>(EP.judicial.syncSettings),
        adminApi<SyncLogRow[]>(EP.judicial.syncLogs),
      ]);
      setSyncUrl(settings.url ?? "");
      setIntervalHours(String(settings.intervalHours));
      setLogs(Array.isArray(logRows) ? logRows : []);
    } catch {
      /* senkron bilgisi yüklenmezse sayfa yine çalışır */
    }
  }, []);

  useEffect(() => {
    void loadSync();
  }, [loadSync]);

  // D7 — vergi dairesi kataloğu: sayfa açılışında bir kez.
  useEffect(() => {
    void loadTaxOffices();
  }, []);

  async function saveSettings() {
    setSyncBusy(true);
    setSyncMsg(null);
    try {
      await adminApi(EP.judicial.syncSettings, {
        method: "PUT",
        body: {
          url: syncUrl.trim() || null,
          intervalHours: parseInt(intervalHours, 10) || 168,
        },
      });
      setSyncMsg("Senkron ayarı kaydedildi.");
      await loadSync();
    } catch (err) {
      setSyncMsg(errorMessage(err, "Ayar kaydedilemedi."));
    } finally {
      setSyncBusy(false);
    }
  }

  async function runSync() {
    setSyncBusy(true);
    setSyncMsg(null);
    try {
      const res = await adminApi<{ status: string; added: number; updated: number; detail: string }>(
        EP.judicial.syncNow,
        { method: "POST" },
      );
      setSyncMsg(`${res.status}: ${res.detail}`);
      await Promise.all([loadSync(), load()]);
    } catch (err) {
      setSyncMsg(errorMessage(err, "Senkron çalıştırılamadı."));
    } finally {
      setSyncBusy(false);
    }
  }

  async function addBody() {
    setAddBusy(true);
    setAddError(null);
    try {
      await adminApi(EP.judicial.bodies, {
        method: "POST",
        body: {
          type: newType,
          category: newType === "ICRA_DAIRESI" ? "ICRA" : newCategory,
          name: newName.trim(),
          il: newIl.trim(),
        },
      });
      setNewName("");
      setNewIl("");
      await load();
    } catch (err) {
      setAddError(errorMessage(err, "Kayıt eklenemedi."));
    } finally {
      setAddBusy(false);
    }
  }

  async function addNotary() {
    setNotaryBusy(true);
    try {
      await adminApi(EP.judicial.notaries, {
        method: "POST",
        body: { name: notaryName.trim(), il: notaryIl.trim() },
      });
      setNotaryName("");
      setNotaryIl("");
    } catch (err) {
      setSyncMsg(errorMessage(err, "Noter eklenemedi."));
    } finally {
      setNotaryBusy(false);
    }
  }

  // ---- D7: vergi dairesi kataloğu yönetimi --------------------------------
  async function loadTaxOffices() {
    try {
      const rows = await adminApi<Array<{ id: string; name: string; il: string; isActive: boolean }>>(
        EP.judicial.taxOffices,
        { query: { limit: "300" } },
      );
      setTaxOffices(Array.isArray(rows) ? rows : []);
    } catch {
      setTaxOffices([]);
    }
  }

  async function addTaxOffice() {
    setTaxBusy(true);
    try {
      await adminApi(EP.judicial.taxOffices, {
        method: "POST",
        body: { name: taxOfficeName.trim(), il: taxOfficeIl.trim() },
      });
      setTaxOfficeName("");
      setTaxOfficeIl("");
      await loadTaxOffices();
    } catch (err) {
      setSyncMsg(errorMessage(err, "Vergi dairesi eklenemedi."));
    } finally {
      setTaxBusy(false);
    }
  }

  async function toggleTaxOffice(row: { id: string; isActive: boolean }) {
    try {
      await adminApi(EP.judicial.taxOffice(row.id), {
        method: "PATCH",
        body: { isActive: !row.isActive },
      });
      await loadTaxOffices();
    } catch (err) {
      setSyncMsg(errorMessage(err, "Vergi dairesi güncellenemedi."));
    }
  }

  async function toggleActive(row: JudicialBodyRow) {
    try {
      await adminApi(EP.judicial.body(row.id), {
        method: "PATCH",
        body: { isActive: !row.isActive },
      });
      await load();
    } catch (err) {
      setError(errorMessage(err, "Kayıt güncellenemedi."));
    }
  }

  const columns: Column<JudicialBodyRow>[] = [
    {
      key: "name",
      header: "Ad",
      render: (r) => (
        <span>
          <span className={r.isActive ? "" : "line-through opacity-60"}>{r.name}</span>
          <span className="ml-2 text-[10px] text-slate-400">{r.source}</span>
        </span>
      ),
    },
    {
      key: "type",
      header: "Tür",
      render: (r) => (r.type === "ICRA_DAIRESI" ? "İcra Dairesi" : "Mahkeme"),
    },
    {
      key: "category",
      header: "Kategori",
      render: (r) => CATEGORY_LABELS[r.category] ?? r.category,
    },
    { key: "il", header: "İl", render: (r) => r.il },
    {
      key: "status",
      header: "Durum",
      render: (r) =>
        canManage ? (
          <Button variant="secondary" onClick={() => void toggleActive(r)}>
            {r.isActive ? "Pasifleştir" : "Aktifleştir"}
          </Button>
        ) : (
          <Badge tone={r.isActive ? "green" : "gray"}>{r.isActive ? "Aktif" : "Pasif"}</Badge>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Yargı & Noter Kataloğu"
        description="Mahkeme, icra dairesi ve noterlik referans listesi — büro formlarında buradan seçilir."
      />

      <div className="mt-6 space-y-6">
        <Card>
          <p className="p-4 text-xs leading-5 text-slate-500">
            Katalog kurulumdan gelen yaklaşık bir listedir; eksik/yanlış kayıtları buradan
            düzeltebilirsiniz. Senkron kaynağı tanımlarsanız liste periyodik güncellenir.
          </p>
        </Card>

        {canManage && (
          <Card>
            <p className="p-4 pb-0 text-sm font-semibold text-slate-700">Eksik kayıt ekle</p>
            <div className="grid gap-3 p-4 sm:grid-cols-4">
              <Field label="Tür">
                <Select
                  value={newType}
                  onChange={(e) => {
                    setNewType(e.target.value);
                    if (e.target.value === "ICRA_DAIRESI") setNewCategory("ICRA");
                    else if (newCategory === "ICRA") setNewCategory("ASLIYE_HUKUK");
                  }}
                >
                  <option value="MAHKEME">Mahkeme</option>
                  <option value="ICRA_DAIRESI">İcra Dairesi</option>
                </Select>
              </Field>
              {newType === "MAHKEME" ? (
                <Field label="Kategori">
                  <Select value={newCategory} onChange={(e) => setNewCategory(e.target.value)}>
                    {Object.entries(CATEGORY_LABELS)
                      .filter(([k]) => k !== "ICRA")
                      .map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                  </Select>
                </Field>
              ) : (
                <Field label="Kategori">
                  <Input value="İcra" disabled />
                </Field>
              )}
              <Field label="İl">
                <Input value={newIl} onChange={(e) => setNewIl(e.target.value)} placeholder="İstanbul" />
              </Field>
              <Field label="Ad">
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="İstanbul 13. Asliye Hukuk Mahkemesi"
                />
              </Field>
            </div>
            {addError && <p className="px-4 pb-2 text-xs text-red-700">{addError}</p>}
            <div className="flex justify-end p-4 pt-0">
              <Button disabled={addBusy || !newName.trim() || !newIl.trim()} onClick={() => void addBody()}>
                {addBusy ? "Ekleniyor…" : "Ekle"}
              </Button>
            </div>

            <div className="grid gap-3 border-t border-slate-100 p-4 sm:grid-cols-3">
              <Field label="Noter adı">
                <Input
                  value={notaryName}
                  onChange={(e) => setNotaryName(e.target.value)}
                  placeholder="İstanbul 96. Noterliği"
                />
              </Field>
              <Field label="İl">
                <Input value={notaryIl} onChange={(e) => setNotaryIl(e.target.value)} placeholder="İstanbul" />
              </Field>
              <div className="flex items-end">
                <Button
                  variant="secondary"
                  disabled={notaryBusy || !notaryName.trim() || !notaryIl.trim()}
                  onClick={() => void addNotary()}
                >
                  {notaryBusy ? "Ekleniyor…" : "Noter Ekle"}
                </Button>
              </div>
            </div>

            {/* D7 — vergi dairesi kataloğu: müvekkil kartında SEÇİLEN liste.
                TEMSİLÎ seed'den büyür: eksik daire buradan eklenir (MANUAL) ya
                da resmî liste SYNC kaynağıyla gelir. */}
            <div className="grid gap-3 border-t border-slate-100 p-4 sm:grid-cols-3">
              <Field label="Vergi dairesi adı">
                <Input
                  value={taxOfficeName}
                  onChange={(e) => setTaxOfficeName(e.target.value)}
                  placeholder="İstanbul Beyoğlu V.D."
                />
              </Field>
              <Field label="İl">
                <Input value={taxOfficeIl} onChange={(e) => setTaxOfficeIl(e.target.value)} placeholder="İstanbul" />
              </Field>
              <div className="flex items-end">
                <Button
                  variant="secondary"
                  disabled={taxBusy || !taxOfficeName.trim() || !taxOfficeIl.trim()}
                  onClick={() => void addTaxOffice()}
                >
                  {taxBusy ? "Ekleniyor…" : "Vergi Dairesi Ekle"}
                </Button>
              </div>
            </div>
            {taxOffices.length > 0 && (
              <div className="border-t border-slate-100 p-4">
                <p className="mb-2 text-xs font-semibold text-slate-500">
                  Vergi daireleri ({taxOffices.length}) — temsilî liste; eksikleri ekleyin
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {taxOffices.map((t) => (
                    <span
                      key={t.id}
                      className={[
                        "rounded-full border px-2.5 py-1 text-[11px]",
                        t.isActive
                          ? "border-slate-300 bg-slate-50 text-slate-700"
                          : "border-slate-200 bg-slate-100 text-slate-400 line-through",
                      ].join(" ")}
                      title={t.il}
                    >
                      {t.name}
                      <button
                        type="button"
                        className="ml-2 text-red-700 hover:underline"
                        onClick={() => void toggleTaxOffice(t)}
                        title={t.isActive ? "Pasifleştir" : "Aktifleştir"}
                      >
                        {t.isActive ? "×" : "↺"}
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Card>
        )}

        {canManage && (
          <Card>
            <p className="p-4 pb-0 text-sm font-semibold text-slate-700">Senkron</p>
            <div className="grid gap-3 p-4 sm:grid-cols-3">
              <Field label="Kaynak URL (JSON)">
                <Input
                  value={syncUrl}
                  onChange={(e) => setSyncUrl(e.target.value)}
                  placeholder="https://…/yargi-katalog.json"
                />
              </Field>
              <Field label="Aralık (saat)">
                <Input
                  type="number"
                  min={1}
                  max={720}
                  value={intervalHours}
                  onChange={(e) => setIntervalHours(e.target.value)}
                />
              </Field>
              <div className="flex items-end gap-2">
                <Button variant="secondary" disabled={syncBusy} onClick={() => void saveSettings()}>
                  Ayarı Kaydet
                </Button>
                <Button disabled={syncBusy} onClick={() => void runSync()}>
                  {syncBusy ? "Çalışıyor…" : "Şimdi Senkronize Et"}
                </Button>
              </div>
            </div>
            {syncMsg && <p className="px-4 pb-4 text-xs text-slate-600">{syncMsg}</p>}
            {logs.length > 0 && (
              <div className="border-t border-slate-100 p-4 text-xs text-slate-600">
                <p className="mb-1.5 font-semibold text-slate-700">Son denemeler</p>
                <ul className="space-y-1">
                  {logs.slice(0, 5).map((l) => (
                    <li key={l.id}>
                      <Badge tone={l.status === "BASARILI" ? "green" : l.status === "ATLANDI" ? "gray" : "red"}>
                        {l.status}
                      </Badge>{" "}
                      {new Date(l.createdAt).toLocaleString("tr-TR")} — {l.detail ?? "-"}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        )}

        <Card>
          <div className="flex flex-wrap items-end gap-3 p-4">
            <div className="min-w-64 flex-1">
              <Field label="Ara">
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Ad veya il ara…"
                />
              </Field>
            </div>
            <Field label="Tür">
              <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="">Tümü</option>
                <option value="MAHKEME">Mahkeme</option>
                <option value="ICRA_DAIRESI">İcra Dairesi</option>
              </Select>
            </Field>
          </div>
          {loading ? (
            <p className="p-4 text-sm text-slate-500">Yükleniyor…</p>
          ) : error ? (
            <p className="p-4 text-sm text-red-700">{error}</p>
          ) : (
            <>
              <Table
                columns={columns}
                rows={rows}
                rowKey={(r) => r.id}
                dense
                empty="Kayıt yok."
              />
              {total > rows.length && (
                <p className="px-4 pb-4 text-xs text-slate-500">
                  İlk {rows.length} kayıt / toplam {total} — aramayla daraltın.
                </p>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
