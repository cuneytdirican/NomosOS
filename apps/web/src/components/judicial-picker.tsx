"use client";

/**
 * YARGI ORGANI / NOTER SEÇİCİ — il → kayıt kademeli seçim.
 *
 * Liste referans katalogdur (/judicial/bodies, /judicial/notaries) ve
 * YAKLAŞIK olabilir: katalogda olmayan bir daire/noter için "Listede yok,
 * elle yazacağım" düğmesi serbest metin girişi açar (çalışma DURMAMALI).
 */

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Input, Select } from "@/components/ui";

interface BodyRow {
  id: string;
  type: string;
  category: string;
  name: string;
  il: string;
  ilce: string | null;
}

interface NotaryRow {
  id: string;
  name: string;
  il: string;
  ilce: string | null;
}

/** İller + seçilen ile ait kayıtlar; il seçilmeden kayıtlar çekilmez. */
function useIller() {
  const [iller, setIller] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    void api<unknown>("/judicial/iller")
      .then((data) => {
        if (alive && Array.isArray(data)) setIller(data as string[]);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return iller;
}

/**
 * Yargı organı seçici.
 *
 * @param type   "MAHKEME" (dosya açarken) | "ICRA_DAIRESI" (icra dosyası açarken)
 * @param value  seçilen organın TAM ADI (var olan API sözleşmesi korunur — officeName/courtName dize kalır)
 */
export function JudicialBodyPicker({
  type,
  value,
  onChange,
  label,
}: {
  type: "MAHKEME" | "ICRA_DAIRESI";
  value: string;
  onChange: (name: string) => void;
  label?: string;
}) {
  const iller = useIller();
  const [il, setIl] = useState<string>("");
  const [rows, setRows] = useState<BodyRow[]>([]);
  const [manual, setManual] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!il) {
      setRows([]);
      return;
    }
    let alive = true;
    setLoading(true);
    void api<unknown>("/judicial/bodies", { query: { type, il, limit: "500" } })
      .then((data) => {
        if (alive) setRows(Array.isArray(data) ? (data as BodyRow[]) : []);
      })
      .catch(() => {
        if (alive) setRows([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [il, type]);

  const selectedInList = useMemo(
    () => rows.some((r) => r.name === value),
    [rows, value],
  );

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">{label ? `${label} — il` : "İl"}</span>
          <Select value={il} onChange={(e) => setIl(e.target.value)}>
            <option value="">İl seçin…</option>
            {iller.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            {type === "ICRA_DAIRESI" ? "İcra dairesi" : "Mahkeme"}
          </span>
          {manual ? (
            <Input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="Örn. İstanbul 9. İcra Dairesi"
            />
          ) : (
            <Select
              value={selectedInList ? value : ""}
              onChange={(e) => onChange(e.target.value)}
              disabled={!il || loading}
            >
              <option value="">
                {loading ? "Yükleniyor…" : il ? "Seçin…" : "Önce il seçin"}
              </option>
              {rows.map((r) => (
                <option key={r.id} value={r.name}>
                  {r.name}
                </option>
              ))}
            </Select>
          )}
        </label>
      </div>
      <button
        type="button"
        className="text-[11px] font-medium text-amber-700 underline"
        onClick={() => {
          setManual((m) => !m);
          if (!manual) onChange("");
        }}
      >
        {manual
          ? "Listeden seç"
          : "Listede yok mu? Elle yazacağım"}
      </button>
    </div>
  );
}

/** Noter seçici — vekaletname kaydında. */
export function NotaryPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (name: string) => void;
}) {
  const iller = useIller();
  const [il, setIl] = useState<string>("");
  const [rows, setRows] = useState<NotaryRow[]>([]);
  const [manual, setManual] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!il) {
      setRows([]);
      return;
    }
    let alive = true;
    setLoading(true);
    void api<unknown>("/judicial/notaries", { query: { il, limit: "500" } })
      .then((data) => {
        if (alive) setRows(Array.isArray(data) ? (data as NotaryRow[]) : []);
      })
      .catch(() => {
        if (alive) setRows([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [il]);

  const selectedInList = useMemo(
    () => rows.some((r) => r.name === value),
    [rows, value],
  );

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Noterin ili</span>
          <Select value={il} onChange={(e) => setIl(e.target.value)}>
            <option value="">İl seçin…</option>
            {iller.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Noterlik</span>
          {manual ? (
            <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Örn. İstanbul 5. Noterliği" />
          ) : (
            <Select
              value={selectedInList ? value : ""}
              onChange={(e) => onChange(e.target.value)}
              disabled={!il || loading}
            >
              <option value="">{loading ? "Yükleniyor…" : il ? "Seçin…" : "Önce il seçin"}</option>
              {rows.map((r) => (
                <option key={r.id} value={r.name}>
                  {r.name}
                </option>
              ))}
            </Select>
          )}
        </label>
      </div>
      <button
        type="button"
        className="text-[11px] font-medium text-amber-700 underline"
        onClick={() => {
          setManual((m) => !m);
          if (!manual) onChange("");
        }}
      >
        {manual ? "Listeden seç" : "Listede yok mu? Elle yazacağım"}
      </button>
    </div>
  );
}
