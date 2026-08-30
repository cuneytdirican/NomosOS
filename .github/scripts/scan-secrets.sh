#!/usr/bin/env bash
#
# NomosOS — depoya kazara commit edilmiş sır taraması.
#
# Yalnızca GIT TARAFINDAN İZLENEN dosyaları tarar (node_modules, dist, .next
# vb. zaten izlenmez). Bulgu varsa çıkış kodu 1'dir.
#
# Yerelde çalıştırmak için:
#   bash .github/scripts/scan-secrets.sh
#
# Hariç tutulanlar ve gerekçeleri:
#   .env.example        → şablon; içindeki değerler kasıtlı örnektir
#   docs/**             → dokümantasyondaki örnek ayar blokları (yalnızca
#                         "atama" kontrolünde hariç; gerçek anahtar biçimleri
#                         dokümanlarda da aranır)
#   pnpm-lock.yaml      → integrity karmaları sır değildir, gürültü üretir
#   .github/scripts/**  → bu betiğin kendi desenleri
#   *.example, *.sample → şablon dosyalar
#
set -uo pipefail

KOK="$(git rev-parse --show-toplevel)"
cd "$KOK"

bulgu_sayisi=0
RAPOR="$(mktemp)"
trap 'rm -f "$RAPOR"' EXIT

kaydet() { # kaydet <baslik> <satirlar>
  bulgu_sayisi=$((bulgu_sayisi + 1))
  {
    echo "### $1"
    echo ""
    echo '```'
    printf '%s\n' "$2"
    echo '```'
    echo ""
  } >> "$RAPOR"
  echo "::error::$1"
  printf '%s\n' "$2" | sed 's/^/    /'
}

# ---------------------------------------------------------------------------
# 0) .env benzeri dosyalar hiç izlenmemeli
# ---------------------------------------------------------------------------
izlenen_env="$(git ls-files \
  | grep -E '(^|/)\.env($|\.)' \
  | grep -vE '(^|/)\.env\.(example|sample|template)$' \
  || true)"

if [ -n "$izlenen_env" ]; then
  kaydet "Sır içerebilecek .env dosyaları sürüm kontrolünde izleniyor" "$izlenen_env"
fi

# ---------------------------------------------------------------------------
# 1) Dolu değerli ortam değişkeni atamaları
#    (MASTER_ENCRYPTION_KEY=..., JWT_SECRET=... vb.)
# ---------------------------------------------------------------------------
ATAMA_HARIC=(
  ':(exclude).env.example'
  ':(exclude)pnpm-lock.yaml'
  ':(exclude,glob)docs/**'
  ':(exclude,glob).github/scripts/**'
  ':(exclude,glob).github/workflows/*.md'
  ':(exclude,glob)**/*.example'
  ':(exclude,glob)**/*.sample'
  ':(exclude,glob)**/*.md.tmpl'
)

ANAHTARLAR='MASTER_ENCRYPTION_KEY|JWT_SECRET|PLATFORM_JWT_SECRET|PLATFORM_2FA_ENCRYPTION_KEY|S3_SECRET_KEY|POSTGRES_PASSWORD'

ham_atamalar="$(git grep -nIE "(^|[^A-Za-z0-9_])(${ANAHTARLAR})[[:space:]]*=[[:space:]]*[\"']?[^[:space:]\"'#]{8,}" \
  -- . "${ATAMA_HARIC[@]}" 2>/dev/null || true)"

# Yer tutucu / şablon / kod referansı olan satırları ele
atama_bulgulari=""
while IFS= read -r satir; do
  [ -z "$satir" ] && continue

  # Satırın SON "<ANAHTAR>=" eşleşmesinden sonrasını al, sonra değeri
  # sonlandıran ilk tırnak / ters tırnak / noktalama / boşlukta kes.
  deger="$(printf '%s' "$satir" \
    | sed -E "s/.*(${ANAHTARLAR})[[:space:]]*=[[:space:]]*//" \
    | sed -E 's/^[`"'"'"']//' \
    | sed -E 's/[`"'"'"',;)#].*$//' \
    | sed -E 's/[[:space:]].*$//')"

  # a) Başka bir değişkene atıf (ör. PLATFORM_JWT_SECRET=JWT_SECRET)
  if printf '%s' "$deger" | grep -qE '^[A-Z][A-Z0-9_]*$'; then continue; fi
  # b) Kabuk / compose / kod içi enterpolasyon
  if printf '%s' "$deger" | grep -qE '^(\$|\$\{|<|«|process\.env|env\(|getenv|os\.environ|config\.)'; then continue; fi
  # c) Bilinen yer tutucu ifadeler
  if printf '%s' "$deger" | grep -qiE '(degistir|değiştir|change|placeholder|example|ornek|örnek|your[-_]|dummy|fake|sahte|redacted|xxxx|todo|test[-_]|ci[-_]|sample|secret[-_]?here|\.\.\.)'; then continue; fi
  # d) Tek karakterin tekrarı (0000..., aaaa...)
  if printf '%s' "$deger" | grep -qE '^(.)\1{7,}$'; then continue; fi

  atama_bulgulari+="${satir}"$'\n'
done <<< "$ham_atamalar"

atama_bulgulari="$(printf '%s' "$atama_bulgulari" | sed '/^$/d')"
if [ -n "$atama_bulgulari" ]; then
  kaydet "Dolu değerli sır ataması bulundu (.env.example dışında)" "$atama_bulgulari"
fi

# ---------------------------------------------------------------------------
# 2) Sağlayıcı anahtarı ve özel anahtar blokları
#    Bu kontrol dokümanları da tarar: gerçek biçimli bir anahtar hiçbir yerde
#    bulunmamalıdır.
# ---------------------------------------------------------------------------
TOKEN_HARIC=(
  ':(exclude)pnpm-lock.yaml'
  ':(exclude,glob).github/scripts/**'
  ':(exclude,glob).github/workflows/*.md'
)

# Desenler, betiğin kendisi taranırsa bile eşleşmesin diye parça parça kurulur.
P_ANTHROPIC='sk-''ant-[A-Za-z0-9_-]{20,}'
P_OPENAI_PROJ='sk-''proj-[A-Za-z0-9_-]{20,}'
P_OPENAI_ESKI='sk-[A-Za-z0-9]{32,}'
P_GOOGLE='AI''za[0-9A-Za-z_-]{35}'
P_PRIVATE_KEY='-----BEGIN [A-Z ]*PRIVATE KEY-----'
P_AWS='AKIA''[0-9A-Z]{16}'
P_GITHUB_PAT='gh[pousr]_''[A-Za-z0-9]{36,}'

for ikili in \
  "Anthropic API anahtarı|$P_ANTHROPIC" \
  "OpenAI proje anahtarı|$P_OPENAI_PROJ" \
  "OpenAI (eski biçim) API anahtarı|$P_OPENAI_ESKI" \
  "Google API anahtarı|$P_GOOGLE" \
  "Özel anahtar (PEM) bloğu|$P_PRIVATE_KEY" \
  "AWS erişim anahtarı kimliği|$P_AWS" \
  "GitHub kişisel erişim jetonu|$P_GITHUB_PAT" \
; do
  baslik="${ikili%%|*}"
  desen="${ikili#*|}"
  # -e şart: desenler "-----BEGIN" ile başlayabilir, aksi hâlde seçenek sanılır.
  vurus="$(git grep -nIE -e "$desen" -- . "${TOKEN_HARIC[@]}" 2>/dev/null || true)"
  if [ -n "$vurus" ]; then
    kaydet "$baslik depoda bulundu" "$vurus"
  fi
done

# ---------------------------------------------------------------------------
# Rapor
# ---------------------------------------------------------------------------
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "## Sır taraması"
    echo ""
    if [ "$bulgu_sayisi" -eq 0 ]; then
      echo "Bulgu yok. İzlenen dosyalarda sır biçimine uyan içerik bulunmadı."
      echo ""
      echo "_Hariç tutulanlar: \`.env.example\`, \`docs/**\` (yalnız atama kontrolünde), \`pnpm-lock.yaml\`, \`.github/scripts/**\`, \`*.example\`, \`*.sample\`._"
    else
      echo "**$bulgu_sayisi bulgu türü** tespit edildi. Aşağıdaki değerler geçersiz kılınmalı (rotate) ve geçmişten temizlenmelidir."
      echo ""
      cat "$RAPOR"
    fi
  } >> "$GITHUB_STEP_SUMMARY"
fi

if [ "$bulgu_sayisi" -gt 0 ]; then
  echo ""
  echo "Sır taraması BAŞARISIZ: $bulgu_sayisi bulgu türü."
  echo "Bulunan her değeri sağlayıcısında geçersiz kılın; dosyayı silmek yeterli değildir."
  exit 1
fi

echo "Sır taraması temiz."
exit 0
