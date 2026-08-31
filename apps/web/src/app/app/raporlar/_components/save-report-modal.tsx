"use client";

/**
 * "Bu raporu kaydet" — SavedReport TANIMI oluşturur.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ KAYDEDİLEN ŞEY SONUÇ DEĞİL, SORUDUR.                                     ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * `SavedReport` yalnız rapor anahtarını, dönemi ve filtreleri saklar; rakamlar
 * saklanmaz. Kayıtlı rapor bir sonraki açılışta yeniden hesaplanır — böylece
 * "kayıtlı rapor" dünkü fotoğrafı değil, bugünkü gerçeği gösterir.
 *
 * `scope = BURO` GÖRÜNÜRLÜKTÜR, YETKİ DEĞİLDİR: tanımı büroyla paylaşmak,
 * onu açacak kişiye finans/kârlılık yetkisi VERMEZ. Rol kısıtı sunucuda
 * uygulanır ve BURO kapsamı onu geçersiz kılmaz. Bu cümle formda yazılıdır ki
 * kimse paylaşımı bir yetki devri sansın.
 */

import { useState } from "react";
import { Button, Field, Input, Modal, Select } from "@/components/ui";
import { REPORT_SCOPE_HINTS, REPORT_SCOPE_LABELS, periodLabel } from "@/lib/labels";
import type { ReportParams, ReportScope } from "../../_lib/faz6-types";

export function SaveReportModal({
  open,
  onClose,
  defaultName,
  params,
  saving,
  error,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  defaultName: string;
  params: ReportParams;
  saving: boolean;
  error: string | null;
  onSave: (name: string, scope: ReportScope) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [scope, setScope] = useState<ReportScope>("KISISEL");

  return (
    <Modal open={open} title="Bu raporu kaydet" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Rapor adı" hint="Listede bu adla görünür.">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={defaultName}
            maxLength={120}
          />
        </Field>

        <Field label="Görünürlük">
          <Select value={scope} onChange={(e) => setScope(e.target.value as ReportScope)}>
            {(["KISISEL", "BURO"] as const).map((s) => (
              <option key={s} value={s}>
                {REPORT_SCOPE_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-600">
          {REPORT_SCOPE_HINTS[scope]}
        </p>

        <div className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600">
          <p className="font-semibold text-slate-700">Kaydedilecek tanım</p>
          {params.from && params.to && (
            <p className="mt-1">Dönem: {periodLabel(params.from, params.to)}</p>
          )}
          <p className="mt-0.5">
            Karşılaştırma: {params.compare ? "önceki dönemle" : "yok"}
          </p>
          {Object.entries(params.filters ?? {}).filter(([, v]) => v).length > 0 && (
            <p className="mt-0.5">
              Filtreler:{" "}
              {Object.entries(params.filters ?? {})
                .filter(([, v]) => v)
                .map(([k, v]) => `${k}=${v}`)
                .join(", ")}
            </p>
          )}
          <p className="mt-1.5 text-[11px] text-slate-500">
            Rakamlar saklanmaz — rapor her açılışta yeniden hesaplanır.
          </p>
        </div>

        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Vazgeç
          </Button>
          <Button
            variant="gold"
            disabled={saving || name.trim().length === 0}
            onClick={() => onSave(name.trim() || defaultName, scope)}
          >
            {saving ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
