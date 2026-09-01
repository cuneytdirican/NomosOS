# NomosOS API — monorepo workspace kurulumu
#
# NOT: apps/api tüm iş paketlerine bağımlıdır (shared, ai, db, legal-core,
# legal-ai, udf, e-signature). Derleme sırası bağımlılık yönünü izler:
# shared -> ai/legal-core -> legal-ai -> db -> api. Yeni bir paket eklenirse
# BURAYA DA eklenmelidir; aksi hâlde imaj derlenir ama çalışma anında
# "Cannot find module '@nomosos/...'/dist" ile düşer.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-workspace.yaml ./
COPY pnpm-lock.yaml* ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api

# F2-Ö-39: `|| pnpm install` geri düşüşü kilit dosyasıyla uyumsuz imaj üretir.
# Kilit bozuksa DERHAL düş — sessizce serbest çözümleme yapılmaz.
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @nomosos/db exec prisma generate
RUN pnpm --filter @nomosos/shared build \
 && pnpm --filter @nomosos/ai build \
 && pnpm --filter @nomosos/legal-core build \
 && pnpm --filter @nomosos/legal-ai build \
 && pnpm --filter @nomosos/udf build \
 && pnpm --filter @nomosos/e-signature build \
 && pnpm --filter @nomosos/db build \
 && pnpm --filter @nomosos/api build

FROM node:22-alpine
RUN corepack enable
# Sağlık kontrolü ve migration betikleri için
RUN apk add --no-cache curl
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo ./
WORKDIR /repo/apps/api
EXPOSE 3001
CMD ["node", "dist/main.js"]
