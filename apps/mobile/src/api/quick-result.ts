/**
 * D2 A7 — MOBİL DURUŞMA HIZLI SONUÇ.
 *
 * Sunucudaki `PATCH /hearings/:id/result` sözleşmesini kullanır:
 *   status: YAPILDI | ERTELENDI | IPTAL
 *   note: zorunlu (>=3 karakter)
 *   nextDate: ERTELENDI'de zorunlu (yeni duruşma kaydı açar)
 *
 * GÜVENLİK (ekranın başındaki eski karara saygı): sonuç kaydı dosyayı
 * değiştirir — bu yüzden mobilde ÜÇ emniyet vardır:
 *   1. Yalnız PLANLANDI durumundaki duruşmaya sonuç girilebilir.
 *   2. Rol kapısı: OPERASYON_ROLES (sunucu ROLE_SETS.OPERASYON ile aynı).
 *   3. İki adımlı onay: form doldurulur, özet gösterilir, ayrıca onaylanır.
 */

import { api } from "./client";
import type { Hearing } from "./types";

export interface QuickResultInput {
  status: "YAPILDI" | "ERTELENDI" | "IPTAL";
  note: string;
  /** ISO tarih — yalnız ERTELENDI'de zorunlu. */
  nextDate?: string;
  nextCourtroom?: string;
}

export function saveHearingResult(id: string, input: QuickResultInput): Promise<Hearing> {
  return api<Hearing>(`/hearings/${id}/result`, {
    method: "PATCH",
    body: {
      status: input.status,
      note: input.note,
      ...(input.nextDate ? { nextDate: input.nextDate } : {}),
      ...(input.nextCourtroom ? { nextCourtroom: input.nextCourtroom } : {}),
    },
  });
}
