FROM rust:1.90-bookworm AS build
WORKDIR /src
COPY crates/agent ./crates/agent
RUN cargo build --release --manifest-path crates/agent/Cargo.toml

FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/crates/agent/target/release/lighttier-agent /usr/local/bin/lighttier-agent
ENV LT_BIND=0.0.0.0:17800 \
    LT_DATA_DIR=/data \
    LT_WEB_DIR=/opt/lighttier/web
EXPOSE 17800
VOLUME ["/data"]
ENTRYPOINT ["/usr/local/bin/lighttier-agent", "serve"]