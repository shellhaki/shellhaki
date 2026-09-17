FROM oven/bun:1-alpine AS build

ARG REPO=shellhaki/shellhaki
ARG BRANCH=main

RUN apk add --no-cache git

ADD https://api.github.com/repos/${REPO}/git/refs/heads/${BRANCH} /tmp/version.json

RUN git clone --depth 1 --branch ${BRANCH} https://github.com/${REPO}.git /app

WORKDIR /app

RUN bun install --frozen-lockfile --production --omit=peer

FROM oven/bun:1-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY --from=build --chown=bun:bun /app/package.json /app/bun.lock /app/index.ts ./
COPY --from=build --chown=bun:bun /app/node_modules ./node_modules

USER bun

EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3002/health || exit 1

CMD ["bun", "run", "index.ts"]
