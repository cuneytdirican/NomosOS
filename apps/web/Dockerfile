# NomosOS Web — referans amaçlı basit imaj.
# Monorepo kökünden build edilmelidir:
#   docker build -f apps/web/Dockerfile -t nomosos-web .
FROM node:22-alpine

WORKDIR /repo

RUN corepack enable

# Tüm monorepo kopyalanır (basitlik için; üretimde çok aşamalı build önerilir).
COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @nomosos/shared build && pnpm --filter @nomosos/web build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["pnpm", "--filter", "@nomosos/web", "start"]
