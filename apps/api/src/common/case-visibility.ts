/**
 * GİZLİ DOSYA — DOSYA BAZLI ERİŞİM KISITI (Enterprise++).
 *
 * Büyük bürolarda "bu dosyayı yalnız atanan avukatlar görsün" (çıkar çatışması
 * duvarı, hassas müvekkil, ortaklar arası ayrım) kurumsal bir zorunluluktur.
 * Kural TEK YERDE tanımlanır ve her yerden aynı biçimde uygulanır:
 *
 *   - ADMIN / PARTNER: büronun tüm dosyalarını görür (yönetim sorumluluğu).
 *   - Diğer roller: `isConfidential=false` dosyalar + sorumlusu olduğu dosyalar
 *     + `CaseMember` ile üye yapıldığı gizli dosyalar.
 *
 * UYGULAMA NOKTALARI:
 *   1. `CaseAccessGuard` (global): istekte `caseId` (rota/sorgu/gövde) ya da
 *      `/cases/:id` geçiyorsa görünürlüğü doğrular; görünmeyen dosya 404'tür
 *      (varlığı sızdırılmaz).
 *   2. Liste süzgeçleri: dosya listesi doğrudan, ilişkili listeler (duruşma,
 *      süre, görev, belge, ajanda) `relatedCaseVisibilityWhere` ile.
 *
 * Bilinçli sınır: dosyaya bağlı olmayan kayıtlar (caseId=null) kısıta girmez.
 */

import type { Prisma } from "@nomosos/db";
import type { AuthUser } from "./types";

/** Tüm dosyaları gören roller. */
export const CASE_ALL_ACCESS_ROLES = ["ADMIN", "PARTNER"] as const;

export function seesAllCases(user: Pick<AuthUser, "role">): boolean {
  return (CASE_ALL_ACCESS_ROLES as readonly string[]).includes(user.role);
}

/** Dosya sorgusuna eklenecek görünürlük süzgeci (boş nesne = kısıt yok). */
export function caseVisibilityWhere(user: AuthUser): Prisma.CaseWhereInput {
  if (seesAllCases(user)) return {};
  return {
    OR: [
      { isConfidential: false },
      { responsibleUserId: user.userId },
      { members: { some: { userId: user.userId } } },
    ],
  };
}

/** Dosyası ZORUNLU kayıtlar (Hearing, Deadline) için süzgeç. */
export type RequiredCaseVisibility = { AND?: Array<{ case: Prisma.CaseWhereInput }> };
/** Dosyası İSTEĞE BAĞLI kayıtlar (Task, Document) için süzgeç: dosyasız kayıt serbest. */
export type OptionalCaseVisibility = {
  AND?: Array<{ OR: Array<{ caseId: null } | { case: Prisma.CaseWhereInput }> }>;
};

/**
 * Dosyaya bağlı kayıtlar için görünürlük süzgeci. `AND` altına konur —
 * çağıranın kendi `OR`'unu EZMEZ (kiracı sızıntısı dersi: aynı nesnede iki `OR` olmaz).
 */
export function relatedCaseVisibilityWhere(user: AuthUser): RequiredCaseVisibility;
export function relatedCaseVisibilityWhere(user: AuthUser, opts: { optionalCase: true }): OptionalCaseVisibility;
export function relatedCaseVisibilityWhere(
  user: AuthUser,
  opts?: { optionalCase?: boolean },
): RequiredCaseVisibility | OptionalCaseVisibility {
  if (seesAllCases(user)) return {};
  const visibility = caseVisibilityWhere(user);
  if (opts?.optionalCase) {
    return { AND: [{ OR: [{ caseId: null }, { case: visibility }] }] };
  }
  return { AND: [{ case: visibility }] };
}

/** Gizlilik ayarını / üye listesini kim değiştirebilir? */
export function canManageCaseConfidentiality(
  user: AuthUser,
  caseRow: { responsibleUserId: string | null },
): boolean {
  return seesAllCases(user) || caseRow.responsibleUserId === user.userId;
}
