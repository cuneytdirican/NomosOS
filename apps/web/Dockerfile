# NomosOS Web — pazarlama sitesi + büro paneli
# Monorepo KÖKÜNDEN derlenir:
#   docker build -f apps/web/Dockerfile -t nomosos-web .
#
# NEXT_PUBLIC_* değişkenleri Next.js tarafından DERLEME ANINDA gömülür.
# Çalışma anında environment vermek YETMEZ; bu yüzden ARG olarak alınır.
# Değer, tarayıcının API'ye ulaşabildiği DIŞ adres olmalıdır — konteyner içi
# servis adı ("http://api:3001") tarayıcıdan çözülemez.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo

ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# Demo giriş sayfası: 1 = derlemede kapalı (üretim). Varsayılan 0 (test yığını).
ARG NEXT_PUBLIC_DISABLE_DEMO=0
ENV NEXT_PUBLIC_DISABLE_DEMO=$NEXT_PUBLIC_DISABLE_DEMO
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json pnpm-workspace.yaml ./
COPY pnpm-lock.yaml* ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web

# F2-Ö-39: `|| pnpm install` geri düşüşü kilit dosyasıyla uyumsuz imaj üretir.
RUN pnpm install --frozen-lockfile
# apps/web, shared'ın yanında legal-core'a da bağımlıdır (süre etiketleri).
RUN pnpm --filter @nomosos/shared build \
 && pnpm --filter @nomosos/legal-core build \
 && pnpm --filter @nomosos/web build

FROM node:22-alpine
RUN corepack enable
WORKDIR /repo
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build /repo ./
# F2-Ö-40: root kullanıcıyla koşma — gereksiz ayrıcalık yüzeyi (admin/portal deseni).
USER node
EXPOSE 3000
CMD ["pnpm", "--filter", "@nomosos/web", "start"]
