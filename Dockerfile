FROM node:24-slim AS builder

WORKDIR /app

COPY package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/tsconfig.json ./packages/shared/
COPY apps/server/package.json apps/server/tsconfig.json ./apps/server/
COPY apps/web/package.json apps/web/tsconfig.json ./apps/web/

RUN npm install --workspace=@jadwal-adb/shared --workspace=@jadwal-adb/server --workspace=@jadwal-adb/web

COPY packages/shared/src ./packages/shared/src
COPY apps/server/src ./apps/server/src
COPY apps/web/index.html apps/web/vite.config.ts ./apps/web/
COPY apps/web/src ./apps/web/src

RUN npm run build

FROM node:24-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000
ENV HOST=0.0.0.0
ENV APP_TIMEZONE=Asia/Jakarta
ENV DB_PATH=/app/data/jadwal-adb.db

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/server/package.json ./apps/server/package.json
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/web/dist ./apps/web/dist

RUN mkdir -p /app/data

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/server/dist/index.js"]
