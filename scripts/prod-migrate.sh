#!/usr/bin/env bash
# =============================================================================
# NomosOS — üretim veritabanı göçü (prisma migrate deploy)
# =============================================================================
#
# NE YAPAR
#   Çalışan üretim yığınındaki api konteynerinin içinde `prisma migrate deploy`
#   çalıştırır. Bu komut YALNIZCA bekleyen göç dosyalarını uygular:
#     - Yeni göç ÜRETMEZ (migrate dev gibi davranmaz)
#     - Veritabanını SIFIRLAMAZ, tabloyu DÜŞÜRMEZ
#     - Etkileşimli soru sormaz — CI/üretim için doğru komut budur
#
# KULLANIM (Linux/macOS ya da Windows'ta Git Bash)
#   chmod +x scripts/prod-migrate.sh
#   ./scripts/prod-migrate.sh
#
# ORTAM
#   ENV_FILE     (vars.) .env.prod.local         — compose ortam dosyası
#   COMPOSE_FILE (vars.) docker-compose.prod.yml
#   SKIP_BACKUP  (vars.) 0 — 1 yapılırsa göç öncesi yedek atlanır (ÖNERİLMEZ)
#
# ÖNEMLİ: Göç geri alınamaz. Betik varsayılan olarak önce prod-backup.sh
# çalıştırır; yedek alınamazsa göç YAPILMAZ.
# =============================================================================

set -euo pipefail

REPO_KOK="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_KOK"

ENV_FILE="${ENV_FILE:-.env.prod.local}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
SKIP_BACKUP="${SKIP_BACKUP:-0}"

bilgi() { printf '\033[1;34m[göç]\033[0m %s\n' "$*"; }
hata()  { printf '\033[1;31m[HATA]\033[0m %s\n' "$*" >&2; exit 1; }

# --- Ön koşullar ------------------------------------------------------------
command -v docker >/dev/null 2>&1 || hata "docker bulunamadı."
docker compose version >/dev/null 2>&1 || hata "'docker compose' (v2) gerekli."
[ -f "$COMPOSE_FILE" ] || hata "$COMPOSE_FILE yok."
[ -f "$ENV_FILE" ] || hata "$ENV_FILE yok. docker-compose.prod.env.example dosyasını kopyalayıp doldurun."

DC=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")

# Prisma'yı api konteynerinde çalıştırmak için ortak seçenekler.
#   -w  : packages/db (schema.prisma ve migrations/ burada)
#   HOME=/tmp          : kök dosya sistemi read-only; Prisma ev dizinine yazamasın
#   CHECKPOINT_DISABLE : Prisma'nın dış sürüm kontrolü çağrısını kapatır
#                        (kapalı ağda takılmasın, veri dışarı sızmasın)
PRISMA=(exec -T -w /repo/packages/db -e HOME=/tmp -e CHECKPOINT_DISABLE=1 api ./node_modules/.bin/prisma)

# api servisi ayakta mı? Göç, uygulamanın kullandığı Prisma sürümüyle
# çalışsın diye kasıtlı olarak api konteynerinin İÇİNDE koşturulur.
if ! "${DC[@]}" ps --status running --services 2>/dev/null | grep -qx api; then
  hata "api servisi çalışmıyor. Önce: ${DC[*]} up -d api"
fi

# --- Göç öncesi yedek -------------------------------------------------------
# Bir göç veri kaybettirirse tek dönüş yolu budur.
if [ "$SKIP_BACKUP" != "1" ]; then
  bilgi "Göç öncesi yedek alınıyor..."
  if [ -x "$REPO_KOK/scripts/prod-backup.sh" ]; then
    ENV_FILE="$ENV_FILE" COMPOSE_FILE="$COMPOSE_FILE" "$REPO_KOK/scripts/prod-backup.sh" \
      || hata "Yedek alınamadı — göç YAPILMADI."
  else
    bash "$REPO_KOK/scripts/prod-backup.sh" || hata "Yedek alınamadı — göç YAPILMADI."
  fi
else
  bilgi "UYARI: SKIP_BACKUP=1 — göç öncesi yedek ATLANDI."
fi

# --- Bekleyen göçleri göster ------------------------------------------------
bilgi "Göç durumu okunuyor..."
"${DC[@]}" "${PRISMA[@]}" migrate status || true
# migrate status bekleyen göç varken sıfırdan farklı çıkış kodu verir; bu
# beklenen durumdur, o yüzden "|| true".

# --- Uygula -----------------------------------------------------------------
bilgi "prisma migrate deploy çalıştırılıyor..."
"${DC[@]}" "${PRISMA[@]}" migrate deploy

bilgi "Göçler uygulandı."

# --- Doğrula ----------------------------------------------------------------
bilgi "Son durum:"
"${DC[@]}" "${PRISMA[@]}" migrate status

# --- API'yi sağlıklı hâle getir ---------------------------------------------
# Şema değiştiyse Prisma istemcisinin yeniden yüklenmesi için API yeniden başlar.
bilgi "API yeniden başlatılıyor..."
"${DC[@]}" restart api

bilgi "Sağlık kontrolü bekleniyor..."
for i in $(seq 1 30); do
  DURUM="$("${DC[@]}" ps --format '{{.Service}} {{.Health}}' 2>/dev/null | awk '$1=="api"{print $2}')"
  if [ "$DURUM" = "healthy" ]; then
    bilgi "API sağlıklı. Göç tamamlandı."
    exit 0
  fi
  sleep 5
done

hata "API 150 sn içinde sağlıklı olmadı. Kayıtlar: ${DC[*]} logs --tail=100 api"
