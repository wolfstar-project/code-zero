# syntax=docker/dockerfile:1

# Container image for the single deployable app, `apps/dashboard`.
#
# The build stage installs the workspace with the pinned aube version and builds the dashboard
# (and the workspace packages it depends on) through Turborepo, with the self-hosted `node`
# ViteHub preset. That emits Nitro's self-contained `.output/` bundle, which is the only thing
# the runtime stage copies: no workspace sources, no dev dependencies, no package manager.
#
# The image listens on `$PORT` (default 3000), so it runs unchanged on Docker, Railway, and any
# other container platform that injects the port it routes to.

ARG NODE_VERSION=24.19.0

FROM node:${NODE_VERSION}-bookworm-slim AS build

ARG AUBE_VERSION=1.41.0

# Build metadata published under `runtimeConfig.public.buildInfo` (see packages/build-env). The
# checkout's `.git` is not part of the build context, so CI passes these in explicitly.
ARG CODE_ZERO_BUILD_COMMIT=""
ARG CODE_ZERO_BUILD_BRANCH=""
ARG CODE_ZERO_BUILD_URL=""
ARG CODE_ZERO_BUILD_PRODUCTION_URL=""
ARG CODE_ZERO_BUILD_ENV=""

# `CI=true` skips the Husky install in the `prepare` script and keeps tools non-interactive.
ENV CI=true \
    HUSKY=0 \
    NITRO_PRESET=node-server \
    CODE_ZERO_BUILD_COMMIT=${CODE_ZERO_BUILD_COMMIT} \
    CODE_ZERO_BUILD_BRANCH=${CODE_ZERO_BUILD_BRANCH} \
    CODE_ZERO_BUILD_URL=${CODE_ZERO_BUILD_URL} \
    CODE_ZERO_BUILD_PRODUCTION_URL=${CODE_ZERO_BUILD_PRODUCTION_URL} \
    CODE_ZERO_BUILD_ENV=${CODE_ZERO_BUILD_ENV}

RUN npm install --global --ignore-scripts=false "@endevco/aube@${AUBE_VERSION}"

WORKDIR /workspace

COPY . .

RUN aube ci \
    && aube exec turbo run build --filter=@code-zero/dashboard

FROM node:${NODE_VERSION}-bookworm-slim AS runtime

# The runner boundary clones and inspects target repositories, so the image ships git and the CA
# bundle it needs for HTTPS remotes.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates git tini \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

WORKDIR /app

COPY --from=build --chown=node:node /workspace/apps/dashboard/.output ./.output

# `fs-lite` KV keeps task history under `.data/kv` relative to the working directory. Mount a
# volume at /app/.data to keep it across restarts. No `VOLUME` instruction on purpose: Railway
# rejects images that declare one and attaches its own volumes instead.
RUN mkdir -p /app/.data && chown node:node /app/.data

USER node

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", ".output/server/index.mjs"]
