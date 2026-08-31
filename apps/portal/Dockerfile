# NomosOS Müvekkil Portalı (apps/portal) — üretim imajı
#
# Monorepo KÖKÜNDEN build edilmelidir (bağlam = depo kökü):
#   docker build -f apps/portal/Dockerfile -t nomosos-portal .
#
# apps/admin/Dockerfile desenini izler; farkları:
#   - Port 3003 (apps/portal/package.json > start: next start -p 3003)
#   - Portal'ın workspace bağımlılığı YOKTUR; yalnız kendi paketi build edilir.
#
# !!! NEXT_PUBLIC_* HAKKINDA KRİTİK NOT
# Next.js, NEXT_PUBLIC_ ile başlayan değişkenleri BUILD ANINDA tarayıcı paketine
# gömer. Çalışma anındaki `environment:` girdisi bu değeri DEĞİŞTİRMEZ.
# Gerçek API adresi imaj üretilirken --build-arg ile verilmelidir:
#   docker build -f apps/portal/Dockerfile \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.ornek-buro.com \
#     -t nomosos-portal .

# ---------------------------------------------------------------------------
# 1) Build aşaması
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build

RUN corepack enable
WORKDIR /repo

# Tüm monorepo kopyalanır; gereksiz dosyaları kökteki .dockerignore eler.
COPY . .

RUN pnpm install --frozen-lockfile

# Portalın API adresi tarayıcı paketine burada gömülür.
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm --filter @nomosos/portal build

# ---------------------------------------------------------------------------
# 2) Çalışma aşaması
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime

# tini: PID 1 olarak sinyalleri doğru iletir.
RUN apk add --no-cache tini

WORKDIR /repo

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3003
ENV HOME=/home/node

COPY --from=build --chown=node:node /repo /repo

USER node
WORKDIR /repo/apps/portal

EXPOSE 3003

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3003/giris || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node_modules/.bin/next", "start", "-p", "3003"]
