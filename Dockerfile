# Frontend
FROM oven/bun:1.3-alpine AS frontend-builder

WORKDIR /app/web

COPY web/package.json web/bun.lock* ./

RUN bun install --frozen-lockfile

COPY web/ ./

RUN bun run build

# Backend
FROM rust:1.87-slim-bookworm AS backend-builder

WORKDIR /app

RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    libopenslide-dev \
    libclang-dev \
    && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock* ./
COPY server/Cargo.toml ./server/

# Create dummy source files to cache dependencies
RUN mkdir -p server/src \
    && echo "fn main() {}" > server/src/main.rs \
    && echo "" > server/src/lib.rs

RUN cargo build --release --package pathcollab-server
RUN rm -rf server/src

COPY server/src ./server/src
RUN touch server/src/main.rs server/src/lib.rs \
    && cargo build --release --package pathcollab-server

# Runtime
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
    && mkdir -p /slides \
    && chown -R pathcollab:pathcollab /app /slides

USER pathcollab

EXPOSE 8080

# Sensible defaults for zero-config startup
ENV RUST_LOG=pathcollab=info,tower_http=info \
    HOST=0.0.0.0 \
    PORT=8080 \
    SLIDES_DIR=/slides \
    STATIC_FILES_DIR=/app/static \
    SLIDE_SOURCE=local

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

VOLUME ["/slides"]

CMD ["pathcollab"]
