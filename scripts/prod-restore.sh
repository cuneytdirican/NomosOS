#!/usr/bin/env bash
# =============================================================================
# NomosOS — üretim GERİ YÜKLEME (Faz 4). prod-backup.sh / backup konteyneri
# çıktısından PostgreSQL (+ isteğe bağlı MinIO) geri yükler.
#
# KULLANIM
#   ./scripts/prod-restore.sh --dump /var/backups/nomosos/postgres/20260906T031500Z.dump \
#        [--minio /var/backups/nomosos/minio-nomosos-belgeler.tar.gz] [--yes]
#
#   --dump    pg_dump özel biçim dosyası (ZORUNLU). .gpg ise önce çözer (gpg gerekir).
#   --minio   mc mirror tar.gz'i (isteğe bağlı)
#   --yes     onay sorusunu atla (tatbikat/CI)
#   --target-db  farklı bir DB adına yükle (tatbikat: üretim DB'sine dokunmadan dene)
#
# NE YAPAR (sırayla; biri başarısızsa durur)
#   1) api/web/admin/portal durur (veri yazılırken geri yükleme yapılmaz)
#   2) mevcut DB'nin GÜVENLİK YEDEĞİ alınır (geri yükleme kendisi de risklidir)
#   3) DB düşürülüp yeniden yaratılır, pg_restore --no-owner --no-privileges
#   4) (varsa) MinIO kovası mc mirror --overwrite
#   5) migrate deploy (yedek sonrası eklenen göçler) + servisler kalkar
#   6) /health/ready 200 dönene kadar bekler (90 sn)
#
# TATBİKAT: --target-db nomosos_tatbikat ile üretim DB'sine dokunmadan geri
# yükleyip `psql -c 'SELECT count(*) FROM "Tenant"'` ile sayıları doğrulayın;
# docs/uretim-dagitimi.md §5.4 tatbikat kaydı zorunludur (RTO ölçümü).
# =============================================================================
set -euo pipefail

REPO_KOK="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_KOK"

ENV_FILE="${ENV_FILE:-.env.prod.local}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
DUMP=""; MINIO_TAR=""; YES=0; TARGET_DB=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dump) DUMP="$2"; shift 2;;
    --minio) MINIO_TAR="$2"; shift 2;;
    --yes) YES=1; shift;;
    --target-db) TARGET_DB="$2"; shift 2;;
    *) echo "Bilinmeyen parametre: $1"; exit 2;;
  esac
done
[ -n "$DUMP" ] || { echo "--dump zorunlu"; exit 2; }
[ -f "$DUMP" ] || { echo "Döküm bulunamadı: $DUMP"; exit 2; }
[ -f "$ENV_FILE" ] || { echo "$ENV_FILE yok"; exit 2; }

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a
DB="${TARGET_DB:-$POSTGRES_DB}"
DC=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")

if [[ "$DUMP" == *.gpg ]]; then
  echo "GPG çözülüyor…"; gpg --decrypt "$DUMP" > "${DUMP%.gpg}"; DUMP="${DUMP%.gpg}"
fi

echo "Geri yüklenecek: $DUMP → veritabanı '$DB' (sunucu: postgres konteyneri)"
if [ "$YES" -ne 1 ]; then
  read -r -p "Bu işlem '$DB' veritabanını SİLİP yeniden yükler. Devam? (evet/hayır): " cevap
  [ "$cevap" = "evet" ] || { echo "İptal."; exit 1; }
fi

BASLANGIC=$(date +%s)
if [ -z "$TARGET_DB" ]; then
  echo "1) Uygulamalar durduruluyor…"
  "${DC[@]}" stop api web admin portal >/dev/null
  echo "2) Güvenlik yedeği alınıyor…"
  GUVENLIK="/tmp/nomosos-guvenlik-$(date -u +%Y%m%dT%H%M%SZ).dump"
  "${DC[@]}" exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$GUVENLIK"
  echo "   $GUVENLIK"
fi

echo "3) Veritabanı yeniden yaratılıyor ve yükleniyor…"
"${DC[@]}" exec -T postgres psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DB' AND pid<>pg_backend_pid();" \
  -c "DROP DATABASE IF EXISTS \"$DB\";" -c "CREATE DATABASE \"$DB\";" >/dev/null
"${DC[@]}" exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$DB" --no-owner --no-privileges --exit-on-error < "$DUMP"
SAYI=$("${DC[@]}" exec -T postgres psql -U "$POSTGRES_USER" -d "$DB" -tAc 'SELECT count(*) FROM "Tenant"')
echo "   Tenant sayısı: $SAYI"

if [ -n "$MINIO_TAR" ]; then
  echo "4) MinIO kovası geri yükleniyor…"
  "${DC[@]}" exec -T minio sh -c '
    mc alias set geri http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
    rm -rf /tmp/geri && mkdir -p /tmp/geri && tar -C /tmp/geri -xzf -
    mc mirror --overwrite /tmp/geri/'"$S3_BUCKET"' geri/'"$S3_BUCKET"' && rm -rf /tmp/geri
  ' < "$MINIO_TAR"
fi

if [ -z "$TARGET_DB" ]; then
  echo "5) Göçler ve servisler…"
  "${DC[@]}" up -d postgres redis minio >/dev/null
  SKIP_BACKUP=1 ./scripts/prod-migrate.sh
  "${DC[@]}" up -d api web admin portal >/dev/null
  echo "6) Readiness bekleniyor…"
  for i in $(seq 1 18); do
    if "${DC[@]}" exec -T api wget -q -O - http://127.0.0.1:3001/api/v1/health/ready 2>/dev/null | grep -q '"ready"'; then
      echo "   API hazır."; break
    fi
    [ "$i" -eq 18 ] && { echo "   API 90 sn içinde hazır olmadı; günlükleri inceleyin."; exit 1; }
    sleep 5
  done
fi
BITIS=$(date +%s)
echo "GERİ YÜKLEME TAMAM — süre $((BITIS - BASLANGIC)) sn (RTO kaydı için tatbikat defterine yazın)."
[ -z "$TARGET_DB" ] || echo "Tatbikat DB'si: $DB (işiniz bitince DROP DATABASE ile temizleyin)."
