import { SetMetadata, applyDecorators } from "@nestjs/common";

export const PORTAL_AUDIT_ACTION_KEY = "portalAuditAction";
export const PORTAL_AUDIT_RESOURCE_KEY = "portalAuditResourceType";

/**
 * Portal denetim eylemi adı — `PortalAuditInterceptor` bu adı `PortalAuditLog`
 * satırına yazar (spec §İş Kuralları 7: PORTAL_* aksiyon tipleri).
 *
 * `resourceType` İKİNCİ PARAMETREDİR ve KVKK dökümü için önemlidir: interceptor
 * `resourceId`'yi yol parametresinden çıkarabiliyordu ama TÜRÜ bilemiyordu, bu
 * yüzden satırların çoğunda `resourceType` null kalıyordu — "hangi KAYDA
 * erişildi?" sorusunun cevabı tam olarak bu alandır (denetim bulgusu 16).
 *
 * Dekoratör YOKSA istek yine kaydedilir (yol ve yöntemden türetilmiş jenerik
 * bir adla); "unutulursa iz kalmaz" hatası mümkün değildir.
 */
export const PortalAudit = (action: string, resourceType?: string) =>
  applyDecorators(
    SetMetadata(PORTAL_AUDIT_ACTION_KEY, action),
    SetMetadata(PORTAL_AUDIT_RESOURCE_KEY, resourceType ?? null),
  );
