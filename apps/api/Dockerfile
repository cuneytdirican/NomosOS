# NomosOS API — referans imaj (monorepo workspace kurulumu)
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-workspace.yaml ./
COPY pnpm-lock.yaml* ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api

RUN pnpm install --frozen-lockfile || pnpm install
RUN pnpm --filter @nomosos/db exec prisma generate
RUN pnpm --filter @nomosos/shared build \
 && pnpm --filter @nomosos/ai build \
 && pnpm --filter @nomosos/db build \
 && pnpm --filter @nomosos/api build

FROM node:22-alpine
RUN corepack enable
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo ./
WORKDIR /repo/apps/api
EXPOSE 3001
CMD ["node", "dist/main.js"]
