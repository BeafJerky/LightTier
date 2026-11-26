# syntax=docker/dockerfile:1
#
# M3 image: the web UI baked from frontend/, the Rust agent, and one EasyTier
# kernel version. The build context is the repository root (`context: ../..`
# in compose.yaml); source/.dockerignore whitelists only what each stage needs.

# ---- web: build the Vue/Vite frontend -------------------------------------
FROM node:22-bookworm AS web
WORKDIR /src
# The lockfile is pnpm v9 (`lockfileVersion 9.0`). The image ships whatever
# corepack resolves, so install the same pnpm the host lockfile came from.
RUN npm i -g pnpm@9.12.2
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY frontend ./frontend
# Bundled themes and the theme guide are inlined by useExternalThemes.ts
# (`import.meta.glob('../../../../src-tauri/resource/themes/*')`), so that
# subtree must exist at build time or the web UI ships without them.
COPY src-tauri/resource/themes ./src-tauri/resource/themes
# Root script: vite build --config frontend/vite.config.ts --mode pro, then the
# release-bundle guard. It only needs the frontend tree plus that one script;
# no Tauri or Rust crates are involved.
COPY scripts/check-release-bundle.mjs ./scripts/
RUN pnpm build

# ---- agent: build the Rust server -----------------------------------------
FROM rust:1.90-bookworm AS agent
WORKDIR /app
# crates/agent is its own workspace (`[workspace]` in its Cargo.toml), so the
# whole directory (including its Cargo.lock) is the build input.
COPY crates/agent ./crates/agent
RUN cd crates/agent && cargo build --release

# ---- runtime: agent + web UI + baked kernel -------------------------------
FROM debian:bookworm-slim AS runtime

# Baked kernel: BUILTIN_CORE_DIR (`/opt/lighttier/core`) in the agent. The
# defaults mirror crates/agent/src/packages/manifest.rs (stable v2.6.4).
#
# `LT_CORE_VERSION` and `LT_CORE_ZIP_SHA` describe the same archive and must
# be overridden together; the digest is the build-time trust anchor, so a
# version bump without its sha256 fails the build instead of shipping a
# different kernel. For v2.7.1 (prerelease) use:
#   --build-arg LT_CORE_VERSION=v2.7.1
#   --build-arg LT_CORE_ZIP_SHA=8dc4f8576c7a4978c1f000630014b75ec88d172f6cb10935e72092ddd5ec7a9a
ARG LT_CORE_VERSION=v2.6.4
# Plain prefix mirror, e.g. https://mirror.example/easytier; the download URL
# is `${LT_CORE_MIRROR}/<official GitHub URL>`. Empty means direct GitHub.
# A trailing slash in the value is tolerated (normalized below).
ARG LT_CORE_MIRROR=""
ARG LT_CORE_ZIP_SHA=61b659eaedba658fa66fe47d17e1426cdd77e5d02fa15fed447bb4357c09dfd6

# curl/unzip are build-time helpers only: the agent unzips future installs in
# Rust, so they are purged before the layer is committed (same RUN = one layer).
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl unzip; \
    mirror="${LT_CORE_MIRROR%/}"; \
    mkdir -p "/opt/lighttier/core/${LT_CORE_VERSION}" /tmp/core/unpack; \
    curl -fsSL --retry 3 -o /tmp/core/core.zip \
      "${mirror:+${mirror}/}https://github.com/EasyTier/EasyTier/releases/download/${LT_CORE_VERSION}/easytier-linux-x86_64-${LT_CORE_VERSION}.zip"; \
    echo "${LT_CORE_ZIP_SHA}  /tmp/core/core.zip" | sha256sum -c -; \
    unzip -o -j /tmp/core/core.zip -d /tmp/core/unpack; \
    test -f /tmp/core/unpack/easytier-core; \
    test -f /tmp/core/unpack/easytier-cli; \
    install -m 755 /tmp/core/unpack/easytier-core "/opt/lighttier/core/${LT_CORE_VERSION}/easytier-core"; \
    install -m 755 /tmp/core/unpack/easytier-cli "/opt/lighttier/core/${LT_CORE_VERSION}/easytier-cli"; \
    rm -rf /tmp/core; \
    apt-get purge -y --auto-remove curl unzip; \
    rm -rf /var/lib/apt/lists/*

COPY --from=agent /app/crates/agent/target/release/lighttier-agent /usr/local/bin/lighttier-agent
COPY --from=web /src/frontend/dist /opt/lighttier/web

ENV LT_BIND=0.0.0.0:17800 \
    LT_DATA_DIR=/data \
    LT_WEB_DIR=/opt/lighttier/web
EXPOSE 17800
VOLUME ["/data"]
ENTRYPOINT ["/usr/local/bin/lighttier-agent", "serve"]