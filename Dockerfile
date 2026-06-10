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
FROM rust:1.89-slim-bookworm AS backend-builder

WORKDIR /app

RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    libopenslide-dev \
    libclang-dev \
    && rm -rf /var/lib/apt/lists/*

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
FROM debian:bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    libopenslide0 \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /var/cache/apt/*

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
