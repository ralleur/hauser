# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

ARG NODE_IMAGE=node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd

FROM ${NODE_IMAGE} AS build
WORKDIR /build/app
COPY app/package.json app/package-lock.json ./
RUN npm ci
COPY app/ ./
COPY design-tokens/ /build/design-tokens/
RUN npm run build && \
    ./node_modules/.bin/tsc \
      --ignoreConfig \
      src/lib/config/household-config.ts \
      src/lib/config/household-config-migration.ts \
      src/lib/config/household-runtime-data.ts \
      src/lib/config/legacy-household-config.ts \
      src/lib/config/legacy-household-data.ts \
      --outDir /build/server-contract \
      --rootDir src/lib/config \
      --module nodenext \
      --moduleResolution nodenext \
      --target es2022 \
      --skipLibCheck \
      --rewriteRelativeImportExtensions true \
      --declaration false \
      --sourceMap false \
      --noEmitOnError true

FROM ${NODE_IMAGE} AS runtime
ARG HAUSER_VERSION=0.4.0-beta.1
LABEL org.opencontainers.image.title="Hauser" \
      org.opencontainers.image.description="Local-first smart home control surface" \
      org.opencontainers.image.source="https://github.com/ralleur/hauser" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${HAUSER_VERSION}"

ENV NODE_ENV=production \
    HMI_HOST=0.0.0.0 \
    HMI_PORT=4173 \
    HMI_HOUSEHOLD_CONFIG_PATH=/config/household.json \
    HMI_HOUSEHOLD_CONFIG_MODE=active \
    HMI_CONFIG_PATH=/data/config.json \
    HMI_FAMILY_DATA_PATH=/data/family-data.json \
    HMI_SONG_LIBRARY_DIR=/data/songs \
    HMI_REQUIRED_WRITABLE_DIRS=/config,/data,/assets \
    HMI_SERVER_CONTRACT=compiled

WORKDIR /opt/hauser
COPY --from=build --chown=node:node /build/app/dist ./dist
COPY --from=build --chown=node:node /build/server-contract ./server-contract
COPY --chown=node:node app/server.mjs app/package.json ./
COPY --chown=node:node container/healthcheck.mjs ./container/healthcheck.mjs
RUN mkdir -p /config /data/songs /assets && chown -R node:node /opt/hauser /config /data /assets

VOLUME ["/config", "/data", "/assets"]
USER node
EXPOSE 4173
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "container/healthcheck.mjs"]
CMD ["node", "server.mjs"]
