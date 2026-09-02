# FinTwin on a single Node process: static app + API + SQLite.
FROM node:24-slim AS build
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN pnpm install --frozen-lockfile
COPY . .
ENV NEXT_PUBLIC_API_URL=""
RUN pnpm build && node scripts/bundle-worker.mjs sites-worker/dist/index.mjs

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=7860 FINTWIN_IDENTITY=cookie FINTWIN_DB=/data/fintwin.sqlite
COPY --from=build /app /app
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 7860
CMD ["node", "scripts/dev-api.mjs"]
