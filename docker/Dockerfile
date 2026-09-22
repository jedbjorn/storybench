# Storybench app and agent-worker images (spec #11 Runtime Contract, decisions #39/#40).
# Build from the repository root; the root .dockerignore is an allowlist so no
# credentials, data roots or local state can enter the build context.
#
#   docker build -f docker/Dockerfile --target app    -t storybench-app    .
#   docker build -f docker/Dockerfile --target worker -t storybench-worker .
#
# Both images run as container root. On the rootless Docker seat container root
# maps to the invoking host user, which is what keeps durable files host-owned.
# Neither image is run privileged and neither receives the Docker socket.

ARG NODE_IMAGE=node:24-trixie-slim@sha256:8ec5d7557396cfe32d21c3f9c13072355ceab22b584578ca4bb28af31120cffe
ARG DEBIAN_SNAPSHOT=20260922T000000Z

FROM ${NODE_IMAGE} AS base
ARG DEBIAN_SNAPSHOT
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8
RUN printf 'Types: deb\nURIs: http://snapshot.debian.org/archive/debian/%s/\nSuites: trixie trixie-updates\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n\nTypes: deb\nURIs: http://snapshot.debian.org/archive/debian-security/%s/\nSuites: trixie-security\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n' "$DEBIAN_SNAPSHOT" "$DEBIAN_SNAPSHOT" > /etc/apt/sources.list.d/debian.sources \
 && apt-get -o Acquire::Check-Valid-Until=false update \
 && apt-get install -y --no-install-recommends \
      ca-certificates ffmpeg fontconfig fonts-dejavu-core fonts-noto-core fonts-liberation2 \
      poppler-utils python3 python3-pil resvg procps \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/storybench/app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src
COPY public ./public
COPY agent ./agent

FROM base AS app
ENV NODE_ENV=production STORYBENCH_BIND_HOST=0.0.0.0
LABEL io.storybench.image-role=app
CMD ["node", "src/server.js", "--data-root", "/storybench/data"]

FROM base AS worker
RUN apt-get -o Acquire::Check-Valid-Until=false update \
 && apt-get install -y --no-install-recommends git ripgrep bash coreutils \
 && rm -rf /var/lib/apt/lists/*
COPY docker/harness/package.json docker/harness/package-lock.json /opt/storybench/harness/
ENV PATH=/opt/storybench/harness/node_modules/.bin:$PATH
RUN cd /opt/storybench/harness && npm ci --omit=dev --ignore-scripts \
 && node node_modules/@anthropic-ai/claude-code/install.cjs && npm cache clean --force \
 && codex --version && claude --version
# Harness state and auth are mounted at runtime, never baked in.
ENV CODEX_HOME=/storybench/session/codex \
    CLAUDE_CONFIG_DIR=/storybench/session/claude \
    HOME=/storybench/home \
    IS_SANDBOX=1 \
    DISABLE_AUTOUPDATER=1 \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
LABEL io.storybench.image-role=worker
CMD ["node", "/opt/storybench/app/src/runtime/worker/agent.mjs"]
