# API image for Railway (DEPLOY.md). It runs exactly the steps rehearsed from a
# clean checkout: Node 24, `npm ci` at the workspace root, then the start
# command in railway.json. Railpack could not plan this npm-workspaces monorepo
# ("failed to prepare the build"), so the build is spelled out. DECISIONS D-6.
FROM node:24-bookworm-slim

# Toolchain only as a fallback: better-sqlite3 and sharp ship prebuilt
# linux-x64 binaries, so this is normally unused.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .
RUN npm ci

ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "-c", "node --import tsx apps/api/src/scripts/seed.ts --if-empty --no-enrich ; node --import tsx apps/api/src/scripts/backfill.ts ; node --import tsx apps/api/src/index.ts"]
