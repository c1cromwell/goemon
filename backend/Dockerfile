# syntax=docker/dockerfile:1
# Goemon backend — multi-stage production image.
#   build stage: install all deps, compile TS → dist/ (build script also copies SQL migrations)
#   runtime stage: prod deps only, non-root, health-checked
#
# Migrations are NOT run at container start (config: production runs `migrate` as a
# deploy step). Use `node dist/db/migrate.js` as a one-shot Job / init step.

# ---- build ----
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime ----
FROM node:20-slim AS runtime
ENV NODE_ENV=production \
    PORT=3001 \
    NODE_OPTIONS=--enable-source-maps
WORKDIR /app

# Prod dependencies only (includes @google-cloud/kms; excludes tsx/vitest/etc.)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Compiled app + SQL migrations (copied into dist by the build script)
COPY --from=build /app/dist ./dist

# Drop privileges
RUN useradd --system --uid 10001 --home-dir /app goemon \
    && mkdir -p /app/data && chown -R goemon:goemon /app
USER goemon

EXPOSE 3001

# Uses Node's built-in fetch (Node 18+). Passes when /api/health returns 2xx.
HEALTHCHECK --interval=30s --timeout=4s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
