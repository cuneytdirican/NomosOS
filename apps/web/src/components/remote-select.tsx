"use client";

/**
 * SUNUCU TARAFI ARAMALI SEÇİCİ (denetim bulguları K-15, K-16).
 *
 * Açılır liste besleyen çağrı noktaları önceden `limit: 200` ile tek atışta
 * kayıt çekip `<select>` dolduruyordu. Sonuç: 201. kayıt (müvekkil ucunda
 * sunucu tavanı 100 olduğu için 101. kayıt) HİÇ SEÇİLEMİYORDU ve kullanıcıya
 * bunu söyleyen tek bir işaret yoktu.
 *
 * Bu bileşen bunun yerine sunucudaki `q` süzgecini kullanır: kullanıcı yazar,
 * 300 ms sonra sunucuya `?q=…&page=1&limit=20` gider, gelen zarftaki `total`
 * okunur ve "N kayıttan ilk M'i" bilgisi ekranda gösterilir. Böylece hiçbir
 * kayıt erişilemez hâle gelmez ve kırpma görünür olur.
 *
 * Not: `/clients` ucunun sunucu tavanı 100'dür (`clients.service.ts:71`
 * `resolvePage` kullanmıyor). Bu istemciden düzeltilemez; burada zarftaki
 * gerçek `limit`/`total` okunarak tolere edilir.
 *
 * denetim bulgusu K-15 · denetim bulgusu K-16
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { fetchPaged, ApiError } from "@/lib/api";

export interface RemoteOption {
  id: string;
  label: string;
  hint?: string;
}

/** Açılır listede aynı anda gösterilen kayıt sayısı. */
const PAGE_SIZE = 20;

export function RemoteSelect<T>({
  path,
  query,
  toOption,
  value,
  onChange,
  selectedLabel,
  placeholder = "Aramak için yazın…",
  emptyMessage = "Eşleşen kayıt yok.",
  disabled = false,
  ariaLabel,
}: {
  /** Sayfalı liste ucu — ör. "/cases", "/clients". */
  path: string;
  /** Ek süzgeçler (clientId, type …). `q`, `page`, `limit` bileşen tarafından eklenir. */
  query?: Record<string, string | number | boolean | undefined | null>;
  toOption: (item: T) => RemoteOption;
  value: string;
  /** `item`: seçilen kaydın HAM gövdesi (tür, müvekkil vb. yan alanlar için). */
  onChange: (id: string, option: RemoteOption | null, item: T | null) => void;
  /** Dışarıdan bilinen seçili etiket (düzenleme ekranları için). */
  selectedLabel?: string;
  placeholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<RemoteOption[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [chosen, setChosen] = useState<RemoteOption | null>(
    value && selectedLabel ? { id: value, label: selectedLabel } : null,
  );

  const boxRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();
  const queryKey = JSON.stringify(query ?? {});
  const toOptionRef = useRef(toOption);
  toOptionRef.current = toOption;
  /** Seçenek kimliği → ham kayıt; `onChange` bunu geri verir. */
  const rawRef = useRef<Map<string, T>>(new Map());

  useEffect(() => {
    if (!value) {
      setChosen(null);
    } else if (selectedLabel) {
      setChosen({ id: value, label: selectedLabel });
    }
  }, [value, selectedLabel]);

  const search = useCallback(
    async (q: string) => {
      setLoading(true);
      setError(null);
      try {
        const extra = JSON.parse(queryKey) as Record<string, string | undefined>;
        const res = await fetchPaged<T>(path, {
          query: { ...extra, q: q.trim() || undefined },
          page: 1,
          limit: PAGE_SIZE,
        });
        const mapped = res.items.map((item) => ({ opt: toOptionRef.current(item), item }));
        rawRef.current = new Map(mapped.map(({ opt, item }) => [opt.id, item]));
        setOptions(mapped.map(({ opt }) => opt));
        setTotal(res.total);
        setHighlight(0);
      } catch (err) {
        setOptions([]);
        setTotal(0);
        setError(err instanceof ApiError ? err.message : "Liste yüklenemedi.");
      } finally {
        setLoading(false);
      }
    },
    [path, queryKey],
  );

  // Yazarken her tuşta istek atmamak için 300 ms gecikme (muvekkiller deseni).
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => void search(term), term ? 300 : 0);
    return () => clearTimeout(timer);
  }, [open, term, search]);

  // Dışarı tıklandığında kapan.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function pick(opt: RemoteOption) {
    setChosen(opt);
    onChange(opt.id, opt, rawRef.current.get(opt.id) ?? null);
    setOpen(false);
    setTerm("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setHighlight((h) => Math.min(options.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      const opt = options[highlight];
      if (open && opt) {
        // Formun erken gönderilmesini engelle — Enter burada "seç" demektir.
        e.preventDefault();
        pick(opt);
      }
    } else if (e.key === "Escape") {
      if (open) {
        // Modal kapanmasın; önce açılır liste kapansın.
        e.stopPropagation();
        setOpen(false);
      }
    }
  }

  const hiddenCount = Math.max(0, total - options.length);
  const inputValue = open ? term : (chosen?.label ?? "");

  return (
    <div ref={boxRef} className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        autoComplete="off"
        disabled={disabled}
        value={inputValue}
        placeholder={chosen ? chosen.label : placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200 disabled:bg-slate-50 disabled:text-slate-400"
      />
      {chosen && !open && (
        <button
          type="button"
          aria-label="Seçimi temizle"
          onClick={() => {
            setChosen(null);
            onChange("", null, null);
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          ×
        </button>
      )}

      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          <ul id={listId} role="listbox" className="max-h-60 overflow-y-auto">
            {loading && <li className="px-3 py-2 text-sm text-slate-400">Aranıyor…</li>}
            {!loading && error && <li className="px-3 py-2 text-sm text-red-600">{error}</li>}
            {!loading && !error && options.length === 0 && (
              <li className="px-3 py-2 text-sm text-slate-500">{emptyMessage}</li>
            )}
            {!loading &&
              !error &&
              options.map((opt, i) => (
                <li
                  key={opt.id}
                  role="option"
                  aria-selected={opt.id === value}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(opt);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  className={`cursor-pointer px-3 py-2 text-sm ${
                    i === highlight ? "bg-amber-50 text-slate-900" : "text-slate-700"
                  }`}
                >
                  {opt.label}
                  {opt.hint && <span className="ml-2 text-xs text-slate-400">{opt.hint}</span>}
                </li>
              ))}
          </ul>
          {/* Kırpma SESSİZ olmaz: kaç kaydın dışarıda kaldığı yazılır. */}
          {!loading && hiddenCount > 0 && (
            <p className="border-t border-slate-100 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {total} kayıttan ilk {options.length} tanesi gösteriliyor · {hiddenCount} kayıt daha
              var, aramayı daraltın.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
