# Build stage
FROM rust:1.84-slim-bookworm AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

# Copy workspace files
COPY Cargo.toml Cargo.lock* ./
COPY server/Cargo.toml ./server/

# Create dummy main.rs to cache dependencies
RUN mkdir -p server/src && echo "fn main() {}" > server/src/main.rs
RUN cargo build --release --package pathcollab-server
RUN rm -rf server/src

# Copy actual source code
COPY server/src ./server/src

# Build the actual application
RUN touch server/src/main.rs && cargo build --release --package pathcollab-server

# Runtime stage
FROM debian:bookworm-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y ca-certificates curl && rm -rf /var/lib/apt/lists/*

# Copy binary from builder
COPY --from=builder /app/target/release/pathcollab /usr/local/bin/pathcollab

# Create non-root user
RUN useradd -r -s /bin/false pathcollab
USER pathcollab

EXPOSE 8080

ENV RUST_LOG=pathcollab=info,tower_http=info

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

CMD ["pathcollab"]
