/**
 * SÖZLEŞME ANALİZİ KURAL ÇEKİRDEĞİ — şerh durum geçişleri ve izin matrisi.
 *
 * NEDEN AYRI DOSYA: kurallar saf fonksiyon olarak kalır ki (a) koşulsuz
 * birim test edilebilsinler, (b) servis gövdesü "kuralı uygulayan" değil
 * "kuralı çağıran" yer olsun — contract-state-machine.ts ile aynı desen.
 *
 * İZİN MATRİSİ (plans/sozlesme-analiz-ve-simulasyon-modulu-plani.md):
 *   analiz (ILK/REVIZYON), şerh kapatma, sürüm yükleme → OPERASYON rolleri
 *   (STAJYER hariç); nihai analiz + müvekkil bildirimi → HUKUKI roller;
 *   otomatik bildirim açma → PARTNER+ (ROLE_SETS.ONAY).
 */

import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { ContractAnalysisMode, ContractAnnotationStatus } from "@nomosos/db";
import { ROLE_LABELS, ROLE_SETS, assertRole } from "../common/roles";
import type { AuthUser } from "../common/types";

/** Şerhin kapatılabileceği durumlar — SUPERSEDED şerh bir daha dokunulmaz. */
export const CLOSEABLE_ANNOTATION_STATUSES: readonly ContractAnnotationStatus[] = ["ACIK", "KAPALI"];

/** Şerh durumu geçiş tablosu: mevcut durum → izin verilen durumlar. */
export const ANNOTATION_TRANSITIONS: Record<ContractAnnotationStatus, readonly ContractAnnotationStatus[]> = {
  ACIK: ["KAPALI"],
  KAPALI: [],
  SUPERSEDED: [],
};

export function canCloseAnnotation(status: ContractAnnotationStatus): boolean {
  return ANNOTATION_TRANSITIONS[status].includes("KAPALI");
}

/**
 * Şerh kapatma geçişini zorlar. Geçersiz geçiş ANLAMLI mesajla reddedilir:
 * "zaten kapalı" ile "revizyonda geçersizleşti" farklı durumlardır ve kullanıcı
 * yanıttan hangisini öğrenebilmelidir.
 */
export function assertCloseAnnotation(status: ContractAnnotationStatus): void {
  if (status === "KAPALI") {
    throw new BadRequestException("Şerh zaten kapalı.");
  }
  if (status === "SUPERSEDED") {
    throw new BadRequestException(
      "Bu şerh yeni bir revizyon analizinde geçersizleşmiş (SUPERSEDED); kapatma işlemi anlamsızdır. " +
        "Gerekirse güncel sürüm üzerinde yeni analiz çalıştırın.",
    );
  }
  if (!canCloseAnnotation(status)) {
    throw new BadRequestException(
      `"${status}" durumundaki şerh kapatılamaz. Kapatılabilir durumlar: ACIK.`,
    );
  }
}

/** Nihai analiz imza öncesi kontroldür — HUKUKİ rollere aittir. */
export function assertCanRunAnalysis(user: AuthUser, mode: ContractAnalysisMode): void {
  if (mode === "NIHAI") {
    assertRole(user, ROLE_SETS.HUKUKI, "nihai sözleşme analizi çalıştırma");
    return;
  }
  // ILK / REVIZYON: OPERASYON rolleri (STAJYER hariç).
  assertRole(user, ROLE_SETS.OPERASYON, "sözleşme analizi çalıştırma");
}

/** Şerh kapatma — revizyon işi, OPERASYON rolleri. */
export function assertCanCloseAnnotation(user: AuthUser): void {
  assertRole(user, ROLE_SETS.OPERASYON, "sözleşme şerhi kapatma");
}

/** Müvekkile kritik şerh bildirimi — büro adına çıkan hukuki metindir. */
export function assertCanNotifyClient(user: AuthUser): void {
  assertRole(user, ROLE_SETS.HUKUKI, "müvekkile kritik şerh bildirimi gönderme");
}

/** Otomatik bildirim kipini açma — büro politikası kararı, PARTNER+. */
export function assertCanSetNotifyMode(user: AuthUser): void {
  assertRole(user, ROLE_SETS.ONAY, "otomatik müvekkil bildirimi açma");
}

/**
 * İKİ ANALİZ ARASINDA KİŞİSEL VERİ / ANLAŞMAZLIK KAPISI YOKTUR: skor ve
 * şerh durumları deterministiktir; avukatın açık komutu olmadan hiçbir şey
 * yazılmaz. Bu yardımcı yalnız testlerde kullanılan imza denetimidir.
 */
export function analysisPermissionOf(
  user: AuthUser,
  action: "analyze" | "analyze-final" | "close-annotation" | "notify-client" | "set-notify-mode",
): boolean {
  try {
    switch (action) {
      case "analyze":
        assertCanRunAnalysis(user, "ILK");
        return true;
      case "analyze-final":
        assertCanRunAnalysis(user, "NIHAI");
        return true;
      case "close-annotation":
        assertCanCloseAnnotation(user);
        return true;
      case "notify-client":
        assertCanNotifyClient(user);
        return true;
      case "set-notify-mode":
        assertCanSetNotifyMode(user);
        return true;
    }
  } catch (err) {
    if (err instanceof ForbiddenException) return false;
    throw err;
  }
}

/** Rol etiketi — denetim izinde "kim" sorusunun okunur cevabı. */
export function actorLabel(user: AuthUser): string {
  return `${ROLE_LABELS[user.role] ?? user.role} (${user.userId})`;
}
