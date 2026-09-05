/**
 * WEBHOOK OLAY KATALOĞU (Enterprise++ entegrasyonlar).
 *
 * Olaylar UYDURULMAZ: her biri, ilgili serviste zaten yazılan bir denetim izi
 * eylemidir (`AuditService.log({ action })`). Webhook hattı denetim izini
 * DİNLER; bu yüzden yeni bir olay eklemek = katalogda gerçek bir eylem adı
 * yazmak. Katalog dışı eylemler (giriş, AI çağrısı, güvenlik…) dışarı SIZMAZ.
 */

export interface WebhookEventDef {
  /** AuditLog.action ile birebir. */
  action: string;
  label: string;
  group: "Dosya" | "Duruşma" | "Süre" | "Belge" | "Görev" | "Müvekkil" | "Fatura" | "Randevu";
}

export const WEBHOOK_EVENTS: readonly WebhookEventDef[] = [
  { action: "CASE_CREATE", label: "Dosya açıldı", group: "Dosya" },
  { action: "CASE_UPDATE", label: "Dosya künyesi güncellendi", group: "Dosya" },
  { action: "CASE_STATUS_CHANGE", label: "Dosya durumu değişti", group: "Dosya" },
  { action: "HEARING_CREATE", label: "Duruşma eklendi", group: "Duruşma" },
  { action: "HEARING_UPDATE", label: "Duruşma güncellendi", group: "Duruşma" },
  { action: "HEARING_RESULT", label: "Duruşma sonucu girildi", group: "Duruşma" },
  { action: "DEADLINE_CREATE", label: "Süre eklendi", group: "Süre" },
  { action: "DEADLINE_CREATE_FROM_RULE", label: "Kuraldan süre üretildi", group: "Süre" },
  { action: "DEADLINE_STATUS_UPDATE", label: "Süre durumu değişti", group: "Süre" },
  { action: "DOCUMENT_UPLOAD", label: "Belge yüklendi", group: "Belge" },
  { action: "DOCUMENT_DELETE", label: "Belge silindi", group: "Belge" },
  { action: "TASK_CREATE", label: "Görev açıldı", group: "Görev" },
  { action: "TASK_STATUS_UPDATE", label: "Görev durumu değişti", group: "Görev" },
  { action: "CLIENT_CREATE", label: "Müvekkil eklendi", group: "Müvekkil" },
  { action: "CLIENT_UPDATE", label: "Müvekkil güncellendi", group: "Müvekkil" },
  { action: "INVOICE_CREATE", label: "Fatura taslağı oluşturuldu", group: "Fatura" },
  { action: "INVOICE_FINALIZE", label: "Fatura kesinleşti", group: "Fatura" },
  { action: "PAYMENT_CREATE", label: "Tahsilat kaydedildi", group: "Fatura" },
  { action: "RANDEVU_CREATE", label: "Randevu oluşturuldu", group: "Randevu" },
];

export const WEBHOOK_EVENT_ACTIONS = new Set(WEBHOOK_EVENTS.map((e) => e.action));

/** Test teslimatı — katalog dışı, yalnız "Test gönder" düğmesiyle üretilir. */
export const WEBHOOK_TEST_EVENT = "WEBHOOK_TEST";

/** API anahtarı kapsamları → izin verilen yol önekleri (yalnız GET). */
export const API_KEY_SCOPES: Record<string, { label: string; prefixes: string[] }> = {
  "cases:read": { label: "Dosyalar (okuma)", prefixes: ["/api/v1/cases"] },
  "clients:read": { label: "Müvekkiller (okuma)", prefixes: ["/api/v1/clients"] },
  "hearings:read": { label: "Duruşmalar (okuma)", prefixes: ["/api/v1/hearings"] },
  "deadlines:read": { label: "Süreler (okuma)", prefixes: ["/api/v1/deadlines"] },
  "tasks:read": { label: "Görevler (okuma)", prefixes: ["/api/v1/tasks"] },
  "documents:read": { label: "Belgeler (okuma)", prefixes: ["/api/v1/documents"] },
  "agenda:read": { label: "Ajanda (okuma)", prefixes: ["/api/v1/agenda"] },
};

/** Yol, verilen kapsam kümesinde mi? */
export function pathAllowedByScopes(path: string, scopes: readonly string[]): boolean {
  for (const scope of scopes) {
    const def = API_KEY_SCOPES[scope];
    if (!def) continue;
    if (def.prefixes.some((p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`))) return true;
  }
  return false;
}
