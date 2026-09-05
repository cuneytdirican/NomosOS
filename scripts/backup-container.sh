#!/bin/sh
# =============================================================================
# NomosOS — yedek konteyneri döngüsü (Faz 4). docker-compose.prod.yml `backup`
# servisi bu betiği çalıştırır: her BACKUP_INTERVAL_HOURS saatte bir
#   1) pg_dump (özel biçim, sıkıştırılmış)  → /backups/postgres/<ts>.dump
#   2) şema parmak izi                      → /backups/postgres/<ts>.migrations.txt
#   3) BACKUP_RETENTION_DAYS'ten eski dosyaları siler
#   4) /backups/last-success.json yazar     → API `nomosos_backup_last_success_timestamp_seconds`
# MinIO kovası `backup-minio` servisiyle (mc mirror) ayrı yedeklenir.
# MASTER_ENCRYPTION_KEY BİLEREK YEDEĞE KONMAZ (bkz. scripts/prod-backup.sh).
# =============================================================================
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
INTERVAL_H="${BACKUP_INTERVAL_HOURS:-24}"
RETENTION_D="${BACKUP_RETENTION_DAYS:-30}"
PGHOST="${PGHOST:-postgres}"
export PGPASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD zorunlu}"
DB="${POSTGRES_DB:?POSTGRES_DB zorunlu}"
USER="${POSTGRES_USER:?POSTGRES_USER zorunlu}"

mkdir -p "$BACKUP_DIR/postgres"

yedek_al() {
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  hedef="$BACKUP_DIR/postgres/$ts.dump"
  echo "[$(date -u +%FT%TZ)] pg_dump başlıyor → $hedef"
  pg_dump -h "$PGHOST" -U "$USER" -d "$DB" -Fc -Z 6 -f "$hedef.tmp"
  mv "$hedef.tmp" "$hedef"
  psql -h "$PGHOST" -U "$USER" -d "$DB" -tAc 'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY finished_at' > "$BACKUP_DIR/postgres/$ts.migrations.txt" || true
  boyut="$(du -h "$hedef" | cut -f1)"
  find "$BACKUP_DIR/postgres" -type f -mtime +"$RETENTION_D" -delete
  printf '{"finishedAt":"%s","file":"%s","size":"%s","retentionDays":%s}\n' "$(date -u +%FT%TZ)" "$hedef" "$boyut" "$RETENTION_D" > "$BACKUP_DIR/last-success.json"
  echo "[$(date -u +%FT%TZ)] yedek tamam ($boyut); saklama $RETENTION_D gün"
}

if [ "${1:-}" = "--once" ]; then
  yedek_al
  exit 0
fi

while true; do
  if ! yedek_al; then
    echo "[$(date -u +%FT%TZ)] YEDEK BAŞARISIZ — last-success.json güncellenmedi (uyarı kuralı tetiklenir)"
  fi
  sleep "$((INTERVAL_H * 3600))"
done
