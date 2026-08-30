"use client";

/**
 * İstemci tarafı CSV üretimi ve indirme — harici kütüphane yoktur.
 *
 * - Ayraç `;` (Türkçe Excel'in varsayılan liste ayracı).
 * - BOM eklenir; aksi hâlde Excel Türkçe karakterleri bozar.
 * - Sayılar Türkçe ondalık ayracıyla değil, HAM değerle yazılır (veri kaybı olmasın);
 *   biçimlendirme tabloda yapılır, dışa aktarımda ham değer korunur.
 * - Formül enjeksiyonuna karşı `=`, `+`, `-`, `@` ile başlayan hücreler tırnaklanır ve
 *   başına tek tırnak konur.
 */

export interface CsvColumn<T> {
  key: string;
  header: string;
  value: (row: T) => string | number | null | undefined;
}

const SEP = ";";

function escapeCell(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return "";
  let text = String(raw);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  if (text.includes('"') || text.includes(SEP) || text.includes("\n") || text.includes("\r")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv<T>(rows: readonly T[], columns: ReadonlyArray<CsvColumn<T>>): string {
  const head = columns.map((c) => escapeCell(c.header)).join(SEP);
  const body = rows.map((r) => columns.map((c) => escapeCell(c.value(r))).join(SEP));
  return [head, ...body].join("\r\n");
}

/** Tarayıcıda dosya indirir. */
export function downloadCsv(filename: string, csv: string): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** `nomosos-ai-kullanim-2026-08-30.csv` biçiminde ad üretir. */
export function csvFileName(prefix: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `nomosos-${prefix}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.csv`;
}

export function exportCsv<T>(
  prefix: string,
  rows: readonly T[],
  columns: ReadonlyArray<CsvColumn<T>>,
): void {
  downloadCsv(csvFileName(prefix), toCsv(rows, columns));
}
