# NomosOS Platform Yönetim Paneli (apps/admin) — üretim imajı
#
# Monorepo KÖKÜNDEN build edilmelidir (bağlam = depo kökü):
#   docker build -f apps/admin/Dockerfile -t nomosos-admin .
#
# apps/web/Dockerfile desenini izler; farkları:
#   - Çok aşamalı build (build araçları çalışma imajına taşınmaz)
#   - Kök olmayan kullanıcı (node, uid 1000) ile çalışır
#   - Port 3002 (apps/admin/package.json > start: next start -p 3002)
#   - NEXT_PUBLIC_* değişkenleri BUILD ARG'dır (aşağıdaki nota bakınız)
#
# !!! NEXT_PUBLIC_* HAKKINDA KRİTİK NOT
# Next.js, NEXT_PUBLIC_ ile başlayan değişkenleri BUILD ANINDA tarayıcı paketine
# gömer. Çalışma anındaki `environment:` girdisi bu değeri DEĞİŞTİRMEZ.
# Bu yüzden gerçek panel adresi imaj üretilirken --build-arg ile verilmelidir:
#   docker build -f apps/admin/Dockerfile \
#     --build-arg NEXT_PUBLIC_ADMIN_API_URL=https://api.ornek-buro.com \
#     -t nomosos-admin .
# (docker-compose.prod.yml bunu `build.args` altında otomatik yapar.)

# ---------------------------------------------------------------------------
# 1) Build aşaması
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build

RUN corepack enable
WORKDIR /repo

# Tüm monorepo kopyalanır; gereksiz dosyaları kökteki .dockerignore eler
# (node_modules, .next, dist, .turbo, .git, *.log, .env — sırlar imaja SIZMAZ).
COPY . .

# Kilit dosyasına birebir sadık kurulum: yeniden üretilebilir imaj.
RUN pnpm install --frozen-lockfile

# Panelin API adresi tarayıcı paketine burada gömülür.
ARG NEXT_PUBLIC_ADMIN_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_ADMIN_API_URL=$NEXT_PUBLIC_ADMIN_API_URL

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm --filter @nomosos/shared build \
 && pnpm --filter @nomosos/admin build

# ---------------------------------------------------------------------------
# 2) Çalışma aşaması
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime

# tini: PID 1 olarak sinyalleri doğru iletir; `docker stop` sonrası zombi kalmaz.
RUN apk add --no-cache tini

WORKDIR /repo

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3002
# HOME kök olmayan kullanıcıya ait olmalı; read-only kök dosya sisteminde
# bu yol tmpfs ile bağlanır (docker-compose.prod.yml).
ENV HOME=/home/node

# next start için node_modules gereklidir (bu proje `output: "standalone"`
# kullanmıyor — next.config.ts değiştirilmeden standalone'a geçilemez).
COPY --from=build --chown=node:node /repo /repo

USER node
WORKDIR /repo/apps/admin

EXPOSE 3002

# Sağlık kontrolü compose tarafında da tanımlıdır; imajın kendi başına
# çalıştırılması hâlinde burası devreye girer.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3002/ || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
# pnpm yerine doğrudan next ikilisi: çalışma anında corepack/pnpm'in yazma
# ihtiyacı olmaz, bu da read-only kök dosya sistemiyle sorunsuz çalışır.
CMD ["node_modules/.bin/next", "start", "-p", "3002"]
