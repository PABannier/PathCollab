# PathCollab renders through the fovea WebGPU engine (vendored as a git submodule
# at vendor/fovea). The build has four stages: build the fovea WASM module, build
# the @fovea/viewer TS wrapper, build the frontend against it, and build the Rust
# backend (which forwards rendering data to fovea-pack).

# ---- Stage 1: fovea WASM module (Rust -> wasm-bindgen) ----
FROM rust:1.89-slim-bookworm AS wasm-builder

WORKDIR /fovea

RUN rustup target add wasm32-unknown-unknown \
    && cargo install wasm-bindgen-cli --version 0.2.108 --locked

# Only the fovea crate sources are needed to build the wasm viewer.
COPY vendor/fovea/Cargo.toml vendor/fovea/Cargo.lock ./
COPY vendor/fovea/crates ./crates

RUN cargo build --release --target wasm32-unknown-unknown -p fovea-viewer \
    && wasm-bindgen --target web \
        --out-dir packages/fovea-js/pkg --out-name fovea_viewer \
        target/wasm32-unknown-unknown/release/fovea_viewer.wasm

# ---- Stage 2: @fovea/viewer TypeScript wrapper (-> dist/) ----
FROM oven/bun:1.3-alpine AS fovea-ts

WORKDIR /fovea/packages/fovea-js

COPY vendor/fovea/packages/fovea-js/package.json ./
RUN bun install
COPY vendor/fovea/packages/fovea-js/ ./
COPY --from=wasm-builder /fovea/packages/fovea-js/pkg ./pkg
RUN bun run build

# ---- Stage 3: frontend (Vite) ----
FROM oven/bun:1.3-alpine AS frontend-builder

WORKDIR /app/web

# web depends on @fovea/viewer via file:../vendor/fovea/packages/fovea-js
COPY --from=fovea-ts /fovea/packages/fovea-js /app/vendor/fovea/packages/fovea-js

COPY web/package.json web/bun.lock* ./
RUN bun install --frozen-lockfile

COPY web/ ./
RUN bun run build

# ---- Stage 4: backend (Rust Axum + fovea-pack path dependency) ----
# fovea-pack enables openslide-rs's openslide4 feature, so OpenSlide 4 is needed.
# It only exists in the OpenSlide team PPA (every Debian/Ubuntu repo ships 3.4.1),
# so build on Ubuntu 24.04 with the PPA. openslide.pc lists its deps as public
# Requires, so each one's -dev package must be present for pkg-config to resolve.
FROM ubuntu:24.04 AS backend-builder

WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \
        software-properties-common curl ca-certificates build-essential \
    && add-apt-repository -y ppa:openslide/openslide \
    && apt-get update && apt-get install -y \
        pkg-config libssl-dev libopenslide-dev libclang-dev \
        libglib2.0-dev libcairo2-dev libdicom-dev \
        libjpeg-dev libpng-dev libtiff-dev libopenjp2-7-dev \
    && rm -rf /var/lib/apt/lists/*

# Rust toolchain via rustup, pinned to match the wasm-builder stage.
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
        | sh -s -- -y --default-toolchain 1.89.0 --profile minimal

COPY Cargo.toml Cargo.lock* ./
COPY server/Cargo.toml ./server/
# fovea-pack is a path dependency of the server.
COPY vendor/fovea/Cargo.toml vendor/fovea/Cargo.lock ./vendor/fovea/
COPY vendor/fovea/crates ./vendor/fovea/crates

# Cache dependency builds with dummy server sources.
RUN mkdir -p server/src \
    && echo "fn main() {}" > server/src/main.rs \
    && echo "" > server/src/lib.rs

RUN cargo build --release --package pathcollab-server
RUN rm -rf server/src

COPY server/src ./server/src
RUN touch server/src/main.rs server/src/lib.rs \
    && cargo build --release --package pathcollab-server

# ---- Stage 5: runtime ----
# Ubuntu 24.04 + the OpenSlide PPA to match the OpenSlide 4 the backend links
# against (the 4.x runtime lib is libopenslide1, not libopenslide0).
FROM ubuntu:24.04

WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \
        software-properties-common ca-certificates curl \
    && add-apt-repository -y ppa:openslide/openslide \
    && apt-get update && apt-get install -y libopenslide1 \
    && apt-get purge -y software-properties-common \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/*

COPY --from=backend-builder /app/target/release/pathcollab /usr/local/bin/pathcollab
COPY --from=frontend-builder /app/web/dist /app/static

RUN useradd -r -s /bin/false pathcollab \
    && mkdir -p /slides /overlays \
    && chown -R pathcollab:pathcollab /app /slides /overlays

USER pathcollab

EXPOSE 8080

# Sensible defaults for zero-config startup
ENV RUST_LOG=pathcollab=info,tower_http=info \
    HOST=0.0.0.0 \
    PORT=8080 \
    SLIDES_DIR=/slides \
    OVERLAY_DIR=/overlays \
    STATIC_FILES_DIR=/app/static \
    SLIDE_SOURCE=local

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

VOLUME ["/slides", "/overlays"]

CMD ["pathcollab"]
