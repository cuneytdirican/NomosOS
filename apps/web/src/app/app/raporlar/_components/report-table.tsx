"use client";

/**
 * Rapor sonuç tablosu — sıralanabilir, hizalı, yazdırılabilir.
 *
 * RAKAMLAR `tabular-nums` İLE HİZALANIR: orantısız rakam genişliği, alt alta
 * duran tutarların basamaklarını kaydırır ve gözle karşılaştırmayı imkânsız
 * kılar. Sayısal sütunlar ayrıca sağa yaslanır.
 *
 * SIRALAMA İSTEMCİDEDİR ama TOPLAM SATIRI SUNUCUDANDIR: kullanıcı sütuna
 * tıklayınca satırların yeri değişir, toplam değişmez. İstemcide toplam
 * hesaplansaydı, sunucunun süzdüğü (rol kısıtı) veya sayfaladığı bir kesitin
 * toplamı "büro toplamı" gibi görünürdü.
 */

import { useMemo, useState } from "react";
import { EmptyState, SortHeader } from "@/components/ui";
import { isNumericColumnType } from "@/lib/labels";
import { formatValue, sortRows } from "../../_lib/faz6-format";
import type { ReportColumn, ReportRow } from "../../_lib/faz6-types";

/**
 * Hücrenin para birimi: önce sütunun sabit birimi, sonra SATIRIN kendi birim
 * hücresi (`currencyKey`). İkisi de yoksa `null` döner ve biçimlendirici
 * SEMBOL BASMAZ — bilinmeyen birimi ₺ ile doldurmak, USD alacağı TL sanmaya
 * yol açıyordu (denetim bulgusu 10).
 */
function cellCurrency(column: ReportColumn, row: ReportRow | null): string | null {
  if (column.currency) return column.currency;
  if (!column.currencyKey || !row) return null;
  const value = row[column.currencyKey];
  return typeof value === "string" && value.trim() !== "" && value !== "—" ? value : null;
}

export function ReportTable({
  columns,
  rows,
  totals,
}: {
  columns: ReportColumn[];
  rows: ReportRow[];
  totals: ReportRow | null;
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [descending, setDescending] = useState(true);

  const sortColumn = useMemo(
    () => columns.find((c) => c.key === sortKey) ?? null,
    [columns, sortKey],
  );
  const sorted = useMemo(
    () => sortRows(rows, sortColumn, descending),
    [rows, sortColumn, descending],
  );

  if (columns.length === 0) {
    return <EmptyState message="Bu rapor tablo döndürmüyor; yukarıdaki özet ve grafiklere bakın." />;
  }
  if (rows.length === 0) {
    return <EmptyState message="Seçilen dönemde kayıt bulunamadı. Dönemi veya filtreleri genişletmeyi deneyin." />;
  }

  function toggle(key: string) {
    if (sortKey === key) {
      setDescending((d) => !d);
      return;
    }
    setSortKey(key);
    // İlk tıklamada sayısal sütun BÜYÜKTEN küçüğe açılır: "en çok hangi
    // avukatta" sorusu, "en az" sorusundan çok daha sık sorulur.
    const col = columns.find((c) => c.key === key);
    setDescending(isNumericColumnType(col?.type));
  }

  return (
    <div className="overflow-x-auto print:overflow-visible">
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <thead>
          <tr>
            {columns.map((c) => (
              <SortHeader
                key={c.key}
                label={c.label}
                numeric={isNumericColumnType(c.type)}
                active={sortKey === c.key}
                descending={descending}
                onClick={() => toggle(c.key)}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={i} className="even:bg-slate-50/60">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`border-b border-slate-100 px-3 py-2 ${
                    isNumericColumnType(c.type)
                      ? "text-right tabular-nums text-slate-900"
                      : "text-slate-700"
                  }`}
                >
                  {formatValue(row[c.key], c.type, cellCurrency(c, row))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot>
            <tr className="bg-slate-100 font-semibold">
              {columns.map((c, i) => (
                <td
                  key={c.key}
                  className={`border-t-2 border-slate-300 px-3 py-2 ${
                    isNumericColumnType(c.type)
                      ? "text-right tabular-nums text-slate-900"
                      : "text-slate-700"
                  }`}
                >
                  {i === 0 && totals[c.key] === undefined
                    ? "TOPLAM"
                    : totals[c.key] === undefined
                      ? ""
                      : formatValue(totals[c.key], c.type, cellCurrency(c, totals))}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
