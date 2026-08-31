/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ APPEND-ONLY GARANTİSİ — denetim bulgusu Ö-27                             ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Modül 25 §Veri Modeli ve İş kuralı 6 şunu ister: *"uygulama DB rolünde
 * UPDATE/DELETE yetkisi yoktur; zincirlenmiş hash veya WORM kopya"*; kabul
 * kriteri 9 bunun VERİTABANI SEVİYESİNDE test edilmesini şart koşar.
 *
 * Denetimde bulunan durum: şemada hiçbir kısıt, 13 migration'da hiçbir
 * trigger/rol/RLS tanımı yoktu. Append-only YALNIZCA bir kod yorumuydu — yani
 * denetim izi tablosuna yazılacak bir sonraki toplu silme çağrısı garantiyi
 * sessizce bitirebilirdi.
 *
 * BURADAKİ İKİ KAT
 * ----------------
 * 1. **Servis katmanı (bu turda uygulandı).** Tek yazma yolu
 *    `PlatformAuditService.log()`tur ve repoda `platformAuditLog` üzerinde
 *    hiçbir `update/delete/upsert` çağrısı bulunmadığı `append-only.test.ts`
 *    tarafından KAYNAK TARAMASIYLA kanıtlanır. Test, yeni bir silme çağrısı
 *    eklendiği anda kırılır.
 *
 * 2. **Veritabanı katmanı (migration gerekir).** Aşağıdaki SQL, UPDATE ve
 *    DELETE'i tetikleyici düzeyinde reddeder. Migration klasörü `packages/db`
 *    B ajanının alanıdır; bu yüzden SQL burada HAZIR ve TEST EDİLEBİLİR bir
 *    sabit olarak durur, uygulanması B'ye/entegrasyona bırakılır.
 *
 * TRIGGER MI, ROL MÜ: rol tabanlı çözüm (`REVOKE UPDATE, DELETE`) daha
 * güçlüdür ama uygulama rolünün migration çalıştırma yetkisiyle çakışır
 * (Prisma migrate aynı rolü kullanır). Tetikleyici her rol için geçerlidir ve
 * migration'ı engellemez; süper kullanıcı gerekli bir bakım işi için trigger
 * geçici olarak devre dışı bırakılabilir ve bu, denetlenebilir bir işlemdir.
 */

/**
 * Append-only'i zorlayan tablolar.
 *
 * ÜÇÜNÜN İKİSİ KİRACIYA BAĞLIDIR: `RiskScoreHistory` ve `CreditTransaction`
 * `tenantId` taşır, yani Ö-28'in veri imhası (`TENANT_DELETE`) bu satırları
 * SİLMEK ZORUNDADIR — KVKK'nın silme yükümlülüğü, hiçbir zaman silinemeyen bir
 * tabloyla bağdaşmaz. Koşulsuz bir tetikleyici, dört-göz onaylı imhayı
 * sessizce kırardı (entegrasyon turunda yakalandı: `buildTenantPurgePlan`
 * `tenantId` taşıyan HER tabloyu siler, bu ikisi dâhil).
 *
 * Bu yüzden tetikleyici tek bir kaçış deliği tanır: oturum değişkeni
 * `nomosos.purge = 'on'` iken DELETE geçer. Değişkeni YALNIZCA imha
 * transaction'ı `SET LOCAL` ile açar (bkz. `PURGE_ESCAPE_HATCH_GUC`,
 * `platform-approval-executor.service.ts`); `SET LOCAL` transaction bitince
 * kendiliğinden düşer ve `PlatformAuditLog` zaten imha kapsamı dışındadır.
 * UPDATE hiçbir koşulda geçmez.
 */
export const APPEND_ONLY_TABLES: readonly string[] = [
  "PlatformAuditLog",
  // Modül 17 KK5 ve Modül 26: aynı gerekçe, aynı desen.
  "RiskScoreHistory",
  "CreditTransaction",
];

/**
 * İmha transaction'ının açtığı oturum değişkeni. Tek `SET LOCAL` yeri
 * `deleteTenant`'tır; başka yerde açılmadığı `append-only.test.ts` içindeki
 * kaynak taramasıyla kanıtlanır.
 */
export const PURGE_ESCAPE_HATCH_GUC = "nomosos.purge";

/**
 * Migration SQL'i. `packages/db/prisma/migrations/<zaman>_append_only_audit/
 * migration.sql` içine olduğu gibi konur.
 */
export function appendOnlyMigrationSql(
  tables: readonly string[] = APPEND_ONLY_TABLES
): string {
  const header = `-- denetim bulgusu Ö-27: denetim izi ve zincirleme kayıtlar APPEND-ONLY olmalıdır.
-- Tetikleyici her rol için geçerlidir; INSERT serbest, UPDATE HER ZAMAN reddedilir.
-- Tek istisna: dört-göz onaylı veri imhası (Ö-28) transaction'ında
-- SET LOCAL "${PURGE_ESCAPE_HATCH_GUC}" = 'on' yazılıysa DELETE geçer.
CREATE OR REPLACE FUNCTION nomosos_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND coalesce(current_setting('${PURGE_ESCAPE_HATCH_GUC}', true), '') = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Bu tablo append-only''dir: % islemi reddedildi (tablo: %).',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;`;

  const triggers = tables
    .map(
      (table) => `
DROP TRIGGER IF EXISTS "${table}_append_only" ON "${table}";
CREATE TRIGGER "${table}_append_only"
  BEFORE UPDATE OR DELETE ON "${table}"
  FOR EACH ROW EXECUTE FUNCTION nomosos_append_only();`
    )
    .join("\n");

  return `${header}\n${triggers}\n`;
}
