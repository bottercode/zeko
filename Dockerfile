FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 ZEKO_HOSTED=1 ZEKO_CHROME=/usr/bin/chromium PORT=10000
RUN apt-get update && apt-get install -y --no-install-recommends chromium chromium-sandbox fonts-liberation ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && install -d -o node -g node .zeko
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --chown=node:node scripts/hosted-preview.mjs ./hosted-preview.mjs
USER node
EXPOSE 10000
CMD ["node", "--env-file-if-exists=/etc/secrets/zeko.env", "--env-file-if-exists=/etc/secrets/zeko-auth.env", "hosted-preview.mjs"]
