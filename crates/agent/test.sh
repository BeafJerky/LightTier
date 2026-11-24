#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e CARGO_HOME=/app/.cargo-home \
  -v "$PWD:/app" \
  -w /app \
  rust:1.90-bookworm \
  cargo test "$@"