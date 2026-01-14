#!/bin/bash
# =============================================================================
# PathCollab Development Quick Start
# =============================================================================
#
# Start PathCollab in development mode with a single command.
# No external services required - uses local OpenSlide for slide rendering.
#
# CANONICAL PORTS (do not change without updating all config files):
#   - 3000: Frontend (Vite dev server) - Vite uses 5173 by default, we set 3000
#   - 8080: Backend (Rust Axum server)
#
# See also: docker-compose.yml, .env.example, server/src/config.rs, web/vite.config.ts
#
# Usage:
#   ./scripts/dev-local.sh [slides_dir]
#
# Example:
#   ./scripts/dev-local.sh                    # Uses default ./data/slides
#   ./scripts/dev-local.sh /data/wsi_slides   # Custom slides directory

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "================================================"
echo "  PathCollab Development Quick Start"
echo "================================================"
echo ""

# Check dependencies
echo "Checking dependencies..."

if ! command -v cargo &> /dev/null; then
    echo "ERROR: Rust/Cargo not found"
    echo "Install from: https://rustup.rs"
    exit 1
fi
echo "  [OK] Rust/Cargo"

if ! command -v bun &> /dev/null; then
    echo "ERROR: Bun not found"
    echo "Install from: https://bun.sh"
    exit 1
fi
echo "  [OK] Bun"

# Default slides directory (matches config.rs default)
SLIDES_DIR="${1:-$PROJECT_ROOT/data/slides}"

# Ensure data directories exist
echo ""
echo "Setting up directories..."
mkdir -p "$PROJECT_ROOT/data/slides"
mkdir -p "$PROJECT_ROOT/data/overlays"
echo "  [OK] data/slides"
echo "  [OK] data/overlays"

# Check for slides (warn if empty, don't fail)
if [ -d "$SLIDES_DIR" ]; then
    SLIDE_COUNT=$(ls -1 "$SLIDES_DIR"/*.{svs,ndpi,tiff,tif,mrxs,scn,vms} 2>/dev/null | wc -l || echo "0")
    if [ "$SLIDE_COUNT" -eq "0" ]; then
        echo ""
        echo "NOTE: No slide files found in $SLIDES_DIR"
        echo "      Place .svs, .ndpi, .tiff files there to view real slides."
        echo "      Demo mode will use placeholder tiles."
    else
        echo "  Found $SLIDE_COUNT slide(s)"
    fi
else
    echo ""
    echo "NOTE: Slides directory not found: $SLIDES_DIR"
    echo "      Demo mode will use placeholder tiles."
fi

# Set environment variables
export RUST_LOG="${RUST_LOG:-pathcollab=debug,tower_http=info}"
export SLIDE_SOURCE=local
export SLIDES_DIR="$SLIDES_DIR"
export SLIDE_TILE_SIZE=256
export SLIDE_JPEG_QUALITY=85
export HOST=0.0.0.0
export PORT=8080

echo ""
echo "Configuration:"
echo "  SLIDES_DIR:  $SLIDES_DIR"
echo "  Backend:     http://localhost:8080"
echo "  Frontend:    http://localhost:3000"
echo ""

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "Shutting down..."
    kill $SERVER_PID $WEB_PID 2>/dev/null || true
    wait $SERVER_PID $WEB_PID 2>/dev/null || true
    echo "Done."
}
trap cleanup EXIT INT TERM

# Build and start the backend
echo "Building backend..."
cd "$PROJECT_ROOT/server"
cargo build --release 2>&1 | tail -3

echo "Starting backend..."
cargo run --release &
SERVER_PID=$!

# Wait for backend to be ready
echo "Waiting for backend to be ready..."
for i in {1..30}; do
    if curl -s http://localhost:8080/health > /dev/null 2>&1; then
        echo "  [OK] Backend is ready"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "  [WARN] Backend health check timeout (may still be starting)"
    fi
    sleep 1
done

# Start the frontend
echo ""
echo "Starting frontend..."
cd "$PROJECT_ROOT/web"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing frontend dependencies..."
    bun install
fi

# Start the Vite dev server
bun run dev --port 3000 &
WEB_PID=$!

# Wait a moment for Vite to start
sleep 2

echo ""
echo "================================================"
echo "  PathCollab is running!"
echo "================================================"
echo ""
echo "  Open in browser:  http://localhost:3000"
echo ""
echo "  API endpoints:"
echo "    Health:   http://localhost:8080/health"
echo "    Slides:   http://localhost:8080/api/slides"
echo "    Metrics:  http://localhost:8080/metrics"
echo ""
echo "  Press Ctrl+C to stop"
echo "================================================"
echo ""

# Wait for processes
wait $SERVER_PID $WEB_PID
