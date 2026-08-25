# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

ARG NODE_IMAGE=node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd

FROM ${NODE_IMAGE} AS build
WORKDIR /build/app
COPY app/package.json app/package-lock.json ./
RUN npm ci
COPY app/ ./
COPY design-tokens/ /build/design-tokens/
# AGPL section 13: the built frontend embeds the exact revision it was built
# from and the URL of its corresponding source. There is no .git inside the
# build context, so both arrive as build arguments; HAUSER_RELEASE=1 turns a
# missing or unusable value into a build failure instead of a published image
# that claims a source it cannot back. Declared after `npm ci` so a new
# revision does not invalidate the dependency layer.
ARG HAUSER_REVISION=""
ARG HAUSER_SOURCE_URL=""
ARG HAUSER_RELEASE=""
ENV HAUSER_REVISION=${HAUSER_REVISION} \
    HMI_SOURCE_URL=${HAUSER_SOURCE_URL} \
    HAUSER_RELEASE=${HAUSER_RELEASE}
RUN npm run build && \
    ./node_modules/.bin/tsc \
      --ignoreConfig \
      src/lib/config/build-info.ts \
      src/lib/config/household-config.ts \
      src/lib/config/household-config-migration.ts \
      src/lib/config/household-runtime-data.ts \
      src/lib/config/hotel-mode-policy.ts \
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
      --noEmitOnError true && \
    ./node_modules/.bin/tsc \
      --ignoreConfig \
      src/lib/room-images/room-image-transform-policy-v1.ts \
      src/lib/room-images/room-image-prompt-policy-v1.ts \
      --outDir /build/room-image-contract \
      --rootDir src/lib/room-images \
      --module nodenext \
      --moduleResolution nodenext \
      --target es2022 \
      --skipLibCheck \
      --rewriteRelativeImportExtensions true \
      --declaration false \
      --sourceMap false \
      --noEmitOnError true && \
    npm prune --omit=dev

FROM ${NODE_IMAGE} AS runtime
ARG HAUSER_VERSION=0.4.0-beta.7
ARG HAUSER_REVISION=""
ARG HAUSER_SOURCE_URL=""
LABEL org.opencontainers.image.title="Hauser" \
      org.opencontainers.image.description="Local-first smart home control surface" \
      org.opencontainers.image.source="https://github.com/ralleur/hauser" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.version="${HAUSER_VERSION}" \
      org.opencontainers.image.revision="${HAUSER_REVISION}"

ENV NODE_ENV=production \
    HMI_HOST=0.0.0.0 \
    HMI_PORT=4173 \
    HMI_REVISION=${HAUSER_REVISION} \
    HMI_SOURCE_URL=${HAUSER_SOURCE_URL} \
    HMI_AI_CUSTOMIZING_ENABLED=0 \
    HMI_HOUSEHOLD_CONFIG_PATH=/config/household.json \
    HMI_HOUSEHOLD_CONFIG_MODE=active \
    HMI_CONFIG_PATH=/data/config.json \
    HMI_FAMILY_DATA_PATH=/data/family-data.json \
    HMI_SONG_LIBRARY_DIR=/data/songs \
    HMI_REQUIRED_WRITABLE_DIRS=/config,/data,/assets \
    HMI_SERVER_CONTRACT=compiled

WORKDIR /opt/hauser
COPY --from=build --chown=node:node /build/app/dist ./dist
COPY --from=build --chown=node:node /build/app/node_modules ./node_modules
COPY --from=build --chown=node:node /build/server-contract ./server-contract
COPY --from=build --chown=node:node /build/room-image-contract ./room-image-contract
COPY --chown=node:node app/server.mjs app/package.json ./
COPY --chown=node:node container/healthcheck.mjs container/start.mjs ./container/
RUN mkdir -p /config /data/songs /assets && chown -R node:node /opt/hauser /config /data /assets

VOLUME ["/config", "/data", "/assets"]
EXPOSE 4173
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "container/healthcheck.mjs"]
# Entrypoint, not `node server.mjs`: bind-mounted volumes arrive owned by the
# host (root under Home Assistant OS) and replace the ownership set above. The
# entrypoint repairs that as root and drops to `node` before serving. Run the
# container with `--user node` to keep it unprivileged end to end — the
# entrypoint then skips the preparation.
CMD ["node", "container/start.mjs"]
