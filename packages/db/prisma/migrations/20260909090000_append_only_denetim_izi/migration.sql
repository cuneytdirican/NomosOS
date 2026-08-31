-- denetim bulgusu Ö-27: denetim izi ve zincirleme kayıtlar APPEND-ONLY olmalıdır.
-- Tetikleyici her rol için geçerlidir; INSERT serbest, UPDATE HER ZAMAN reddedilir.
-- Tek istisna: dört-göz onaylı veri imhası (Ö-28) transaction'ında
-- SET LOCAL "nomosos.purge" = 'on' yazılıysa DELETE geçer.
CREATE OR REPLACE FUNCTION nomosos_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND coalesce(current_setting('nomosos.purge', true), '') = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Bu tablo append-only''dir: % islemi reddedildi (tablo: %).',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "PlatformAuditLog_append_only" ON "PlatformAuditLog";
CREATE TRIGGER "PlatformAuditLog_append_only"
  BEFORE UPDATE OR DELETE ON "PlatformAuditLog"
  FOR EACH ROW EXECUTE FUNCTION nomosos_append_only();

DROP TRIGGER IF EXISTS "RiskScoreHistory_append_only" ON "RiskScoreHistory";
CREATE TRIGGER "RiskScoreHistory_append_only"
  BEFORE UPDATE OR DELETE ON "RiskScoreHistory"
  FOR EACH ROW EXECUTE FUNCTION nomosos_append_only();

DROP TRIGGER IF EXISTS "CreditTransaction_append_only" ON "CreditTransaction";
CREATE TRIGGER "CreditTransaction_append_only"
  BEFORE UPDATE OR DELETE ON "CreditTransaction"
  FOR EACH ROW EXECUTE FUNCTION nomosos_append_only();
