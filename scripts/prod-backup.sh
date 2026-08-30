#!/usr/bin/env bash
# =============================================================================
# NomosOS — üretim yedeği (PostgreSQL + MinIO)
# =============================================================================
#
# NE YEDEKLER
#   1) PostgreSQL  — pg_dump ile mantıksal döküm (özel biçim, sıkıştırılmış)
#   2) MinIO       — mc mirror ile belge kovasının tam kopyası
#   3) Şema parmak izi — hangi göç sürümünde alındığını gösteren metin
#
# NE YEDEKLEMEZ (ve NEDEN)
#   MASTER_ENCRYPTION_KEY. Bu anahtar bilinçli olarak yedeğe KONMAZ: veri ve
#   anahtar aynı yerde durursa tek bir diskin çalınması her ikisini birden
#   verir. Anahtarı ayrı bir kasada saklayın (bkz. docker-compose.prod.env.example).
#
#   >>> ANAHTARSIZ YEDEK, AI SAĞLAYICI ANAHTARLARINI GERİ GETİRMEZ. <<<
#   Bu betiğin ürettiği veritabanı dökümündeki sağlayıcı anahtarları
#   MASTER_ENCRYPTION_KEY olmadan ÇÖZÜLEMEZ. Yedek + anahtar birlikte
#   gereklidir; ikisi ayrı yerlerde, ikisi de kayıp olmadan.
#
# KULLANIM (Linux/macOS ya da Windows'ta Git Bash)
#   chmod +x scripts/prod-backup.sh
#   ./scripts/prod-backup.sh
#
#   Gecelik zamanlama (sunucuda crontab -e):
#     15 3 * * *  cd /srv/nomosos && ./scripts/prod-backup.sh >> /var/log/nomosos-yedek.log 2>&1
#
# ORTAM (değerler .env.prod.local'dan da okunur)
#   BACKUP_DIR              yedeklerin yazılacağı dizin (vars. /var/backups/nomosos)
#   BACKUP_RETENTION_DAYS   kaç gün saklansın (vars. 30)
#   BACKUP_GPG_RECIPIENT    doluysa yedekler GPG ile şifrelenir
#   ENV_FILE / COMPOSE_FILE
#
# GERİ YÜKLEME — aşağıda "GERİ YÜKLEME" bölümüne bakınız.
# =============================================================================

set -euo pipefail

REPO_KOK="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_KOK"

ENV_FILE="${ENV_FILE:-.env.prod.local}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

bilgi() { printf '\033[1;34m[yedek]\033[0m %s\n' "$*"; }
uyar()  { printf '\033[1;33m[uyarı]\033[0m %s\n' "$*"; }
hata()  { printf '\033[1;31m[HATA]\033[0m %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || hata "docker bulunamadı."
[ -f "$COMPOSE_FILE" ] || hata "$COMPOSE_FILE yok."
[ -f "$ENV_FILE" ] || hata "$ENV_FILE yok."

# .env.prod.local'u oku (yalnız betiğin ihtiyacı olan değişkenler için).
# set -a: dosyadaki atamalar dışa aktarılır. Sırlar bu kabuğun içinde kalır.
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

BACKUP_DIR="${BACKUP_DIR:-/var/backups/nomosos}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
BACKUP_GPG_RECIPIENT="${BACKUP_GPG_RECIPIENT:-}"

DC=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")

DAMGA="$(date -u +%Y%m%d-%H%M%S)"
HEDEF="$BACKUP_DIR/$DAMGA"
mkdir -p "$HEDEF"
# Yedek klasörü müvekkil verisi içerir: yalnız sahibi okusun.
chmod 700 "$BACKUP_DIR" "$HEDEF" 2>/dev/null || true

bilgi "Yedek dizini: $HEDEF"

# Yarıda kalan yedek "başarılı" sanılmasın: hata olursa klasör işaretlenir.
temizle_hata() {
  uyar "Yedek YARIM KALDI: $HEDEF (klasör .BASARISIZ olarak işaretlendi)"
  mv "$HEDEF" "${HEDEF}.BASARISIZ" 2>/dev/null || true
}
trap temizle_hata ERR

# ---------------------------------------------------------------------------
# 1) PostgreSQL
# ---------------------------------------------------------------------------
# -Fc  : özel (custom) biçim — pg_restore ile seçmeli/paralel geri yükleme
# -Z 6 : dahili sıkıştırma
# Döküm konteynerin İÇİNDE üretilip stdout'tan host'a akıtılır; ara dosya
# konteynerin read-only kök dosya sistemine yazılmaz.
bilgi "PostgreSQL dökümü alınıyor..."
"${DC[@]}" exec -T \
  -e PGPASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD .env.prod.local icinde tanimli olmali}" \
  postgres \
  pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -Fc -Z 6 --no-owner --no-privileges \
  > "$HEDEF/postgres.dump"

BOYUT_PG="$(wc -c < "$HEDEF/postgres.dump" | tr -d ' ')"
[ "$BOYUT_PG" -gt 1024 ] || hata "PostgreSQL dökümü şüpheli derecede küçük ($BOYUT_PG bayt)."
bilgi "PostgreSQL dökümü: $BOYUT_PG bayt"

# Uygulanmış göçlerin listesi — geri yüklerken hangi kod sürümüne döneceğinizi
# bilmeniz gerekir. Şema ile kod uyuşmazsa uygulama açılmaz.
"${DC[@]}" exec -T \
  -e PGPASSWORD="${POSTGRES_PASSWORD}" postgres \
  psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -At \
  -c 'SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY finished_at' \
  > "$HEDEF/gocler.txt" 2>/dev/null || uyar "Göç listesi okunamadı (tablo yok olabilir)."

# ---------------------------------------------------------------------------
# 2) MinIO (belgeler)
# ---------------------------------------------------------------------------
# mc mirror kovanın tamamını konteyner içi geçici dizine kopyalar, sonra host'a
# tar ile akıtılır. /tmp konteynerde tmpfs olabilir — büyük kovalarda bunun
# yerine MinIO'nun kendi `mc mirror`'ını uzak bir S3 hedefine kurmayı düşünün.
bilgi "MinIO kovası (${S3_BUCKET}) yedekleniyor..."
"${DC[@]}" exec -T minio sh -c "
  set -e
  mc alias set yedek http://127.0.0.1:9000 '${MINIO_ROOT_USER}' '${MINIO_ROOT_PASSWORD}' >/dev/null
  rm -rf /tmp/yedek && mkdir -p /tmp/yedek
  mc mirror --quiet --overwrite yedek/${S3_BUCKET} /tmp/yedek/${S3_BUCKET} >/dev/null
  tar -C /tmp/yedek -cf - .
  rm -rf /tmp/yedek
" | gzip -9 > "$HEDEF/minio-${S3_BUCKET}.tar.gz"

BOYUT_S3="$(wc -c < "$HEDEF/minio-${S3_BUCKET}.tar.gz" | tr -d ' ')"
bilgi "MinIO arşivi: $BOYUT_S3 bayt"

# ---------------------------------------------------------------------------
# 3) Künye + bütünlük özetleri
# ---------------------------------------------------------------------------
{
  echo "NomosOS yedeği"
  echo "tarih_utc=$DAMGA"
  echo "compose=$COMPOSE_FILE"
  echo "veritabani=${POSTGRES_DB}"
  echo "kova=${S3_BUCKET}"
  echo "imaj_etiketi=${IMAGE_TAG:-latest}"
  echo ""
  echo "UYARI: MASTER_ENCRYPTION_KEY bu yedekte YOKTUR ve bilinçli olarak"
  echo "yedeklenmez. Şifreli AI sağlayıcı anahtarlarını çözmek için o anahtarın"
  echo "AYRI saklanan kopyası gerekir. Anahtar kayıpsa bu yedek onları GERİ"
  echo "GETİREMEZ."
} > "$HEDEF/KUNYE.txt"

( cd "$HEDEF" && sha256sum ./* > SHA256SUMS 2>/dev/null ) \
  || uyar "sha256sum yok; bütünlük özeti üretilmedi."

# ---------------------------------------------------------------------------
# 4) İsteğe bağlı GPG şifreleme
# ---------------------------------------------------------------------------
# Yedek dosyaları müvekkil kimlik/sağlık/mali verisi içerir. Sunucu dışına
# çıkacaksa (uzak depo, harici disk) ŞİFRELİ çıkmalıdır.
if [ -n "$BACKUP_GPG_RECIPIENT" ]; then
  if command -v gpg >/dev/null 2>&1; then
    bilgi "Yedek GPG ile şifreleniyor (alıcı: $BACKUP_GPG_RECIPIENT)..."
    for DOSYA in "$HEDEF/postgres.dump" "$HEDEF/minio-${S3_BUCKET}.tar.gz"; do
      [ -f "$DOSYA" ] || continue
      gpg --batch --yes --trust-model always \
          --recipient "$BACKUP_GPG_RECIPIENT" --encrypt "$DOSYA"
      shred -u "$DOSYA" 2>/dev/null || rm -f "$DOSYA"
    done
  else
    uyar "gpg bulunamadı — yedek ŞİFRESİZ bırakıldı."
  fi
else
  uyar "BACKUP_GPG_RECIPIENT boş — yedek ŞİFRESİZ. Sunucu dışına taşımadan önce şifreleyin."
fi

trap - ERR

# ---------------------------------------------------------------------------
# 5) Eski yedekleri temizle
# ---------------------------------------------------------------------------
bilgi "$BACKUP_RETENTION_DAYS günden eski yedekler siliniyor..."
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime "+$BACKUP_RETENTION_DAYS" \
  -exec rm -rf {} + 2>/dev/null || true

bilgi "Yedek tamamlandı: $HEDEF"
du -sh "$HEDEF" 2>/dev/null || true

# =============================================================================
# GERİ YÜKLEME (elle, bilerek otomatikleştirilmemiştir)
# =============================================================================
# 0) GPG kullandıysanız önce çözün:
#      gpg --decrypt postgres.dump.gpg > postgres.dump
#
# 1) Uygulamaları durdurun (veri yazılırken geri yükleme yapılmaz):
#      docker compose -f docker-compose.prod.yml --env-file .env.prod.local stop api web admin
#
# 2) PostgreSQL geri yükleme — veritabanını YENİDEN OLUŞTURUR:
#      docker compose ... exec -T postgres \
#        psql -U "$POSTGRES_USER" -d postgres \
#        -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\"; CREATE DATABASE \"$POSTGRES_DB\";"
#      docker compose ... exec -T postgres \
#        pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges \
#        < postgres.dump
#
# 3) MinIO geri yükleme:
#      docker compose ... exec -T minio sh -c '
#        mc alias set geri http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
#        mkdir -p /tmp/geri && tar -C /tmp/geri -xzf -
#        mc mirror --overwrite /tmp/geri/'"$S3_BUCKET"' geri/'"$S3_BUCKET"'
#        rm -rf /tmp/geri
#      ' < minio-$S3_BUCKET.tar.gz
#
# 4) .env.prod.local içindeki MASTER_ENCRYPTION_KEY'in yedek alındığı andaki değerle
#    AYNI olduğunu doğrulayın. Farklıysa AI sağlayıcı anahtarları çözülemez ve
#    her kiracının anahtarını yeniden girmesi gerekir.
#
# 5) Kod sürümünü gocler.txt'teki son göçle uyumlu etikete getirin, sonra:
#      ./scripts/prod-migrate.sh
#      docker compose -f docker-compose.prod.yml --env-file .env.prod.local up -d
#
# 6) TATBİKAT: Geri yükleme prosedürü DENENMEDİKÇE yedek sayılmaz.
#    Ayda bir, ayrı bir makinede geri yükleyip API'nin /api/v1/health uçlarını
#    ve rastgele bir belgenin indirilebildiğini doğrulayın.
# =============================================================================
