#!/usr/bin/env bash
#
# combined_load.sh - Combined HTTP tile + WebSocket session load test
#
# This script simulates realistic production load by running:
# - HTTP tile requests (simulating viewport navigation)
# - WebSocket sessions with cursor/viewport updates (using Rust load tests)
#
# This captures the combined effect of both workloads on server performance.
#
# Prerequisites:
#   - oha: cargo install oha
#   - Built Rust server and tests
#
# Usage:
#   ./combined_load.sh [OPTIONS]
#
# Options:
#   -u, --url         Base URL (default: http://127.0.0.1:8080)
#   -s, --slide       Slide ID (default: auto-detect)
#   --tile-concurrent Concurrent tile requests (default: 10)
#   --ws-sessions     Number of WebSocket sessions (default: 3)
#   --ws-followers    Followers per session (default: 10)
#   -d, --duration    Test duration in seconds (default: 30)
#   -o, --output      Output directory (default: bench/load_tests/results)
#   -h, --help        Show this help message

set -euo pipefail

# Default configuration
BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
WS_URL="${WS_URL:-ws://127.0.0.1:8080/ws}"
SLIDE_ID=""
TILE_CONCURRENT=10
WS_SESSIONS=3
WS_FOLLOWERS=10
DURATION=30
OUTPUT_DIR="bench/load_tests/results"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

usage() {
    grep '^#' "$0" | grep -v '#!/' | cut -c3-
    exit 0
}

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -u|--url)
            BASE_URL="$2"
            WS_URL="ws://${2#http://}/ws"
            WS_URL="${WS_URL/https:/wss:}"
            shift 2
            ;;
        -s|--slide)
            SLIDE_ID="$2"
            shift 2
            ;;
        --tile-concurrent)
            TILE_CONCURRENT="$2"
            shift 2
            ;;
        --ws-sessions)
            WS_SESSIONS="$2"
            shift 2
            ;;
        --ws-followers)
            WS_FOLLOWERS="$2"
            shift 2
            ;;
        -d|--duration)
            DURATION="$2"
            shift 2
            ;;
        -o|--output)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        -h|--help)
            usage
            ;;
        *)
            log_error "Unknown option: $1"
            usage
            ;;
    esac
done

# Ensure we're in the project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# Create output directory
mkdir -p "$OUTPUT_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Check for oha
if ! command -v oha &> /dev/null; then
    log_error "oha is not installed. Install with: cargo install oha"
    exit 1
fi

# Check server health
log_info "Checking server health at $BASE_URL..."
if ! curl -sf "$BASE_URL/health" > /dev/null 2>&1; then
    log_error "Server not responding at $BASE_URL"
    exit 1
fi
log_success "Server is healthy"

# Auto-detect slide
if [[ -z "$SLIDE_ID" ]]; then
    SLIDES_JSON=$(curl -sf "$BASE_URL/api/slides" 2>/dev/null || echo "[]")
    SLIDE_ID=$(echo "$SLIDES_JSON" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")

    if [[ -z "$SLIDE_ID" ]]; then
        DEFAULT_JSON=$(curl -sf "$BASE_URL/api/slides/default" 2>/dev/null || echo "{}")
        SLIDE_ID=$(echo "$DEFAULT_JSON" | grep -o '"slide_id":"[^"]*"' | cut -d'"' -f4 || echo "demo")
    fi
fi
log_success "Using slide: $SLIDE_ID"

# Get slide metadata
METADATA=$(curl -sf "$BASE_URL/api/slide/$SLIDE_ID" 2>/dev/null || echo "{}")
NUM_LEVELS=$(echo "$METADATA" | grep -o '"num_levels":[0-9]*' | cut -d':' -f2 || echo "10")
TEST_LEVEL=$((NUM_LEVELS / 2))
[[ $TEST_LEVEL -lt 5 ]] && TEST_LEVEL=5

TEST_URL="$BASE_URL/api/slide/$SLIDE_ID/tile/$TEST_LEVEL/10/10"

echo ""
echo "=========================================="
echo " Combined Load Test"
echo "=========================================="
echo " HTTP Base URL:     $BASE_URL"
echo " WebSocket URL:     $WS_URL"
echo " Slide:             $SLIDE_ID"
echo " Tile concurrent:   $TILE_CONCURRENT"
echo " WS sessions:       $WS_SESSIONS"
echo " WS followers/sess: $WS_FOLLOWERS"
echo " Duration:          ${DURATION}s"
echo "=========================================="
echo ""

# Prepare output files
TILE_OUTPUT="$OUTPUT_DIR/combined_${TIMESTAMP}_tiles.json"
WS_OUTPUT="$OUTPUT_DIR/combined_${TIMESTAMP}_websocket.txt"
SUMMARY_FILE="$OUTPUT_DIR/combined_${TIMESTAMP}_summary.txt"

# Collect initial metrics from server
log_info "Collecting baseline metrics..."
BASELINE_METRICS=$(curl -sf "$BASE_URL/metrics" 2>/dev/null || echo "{}")
BASELINE_CONNECTIONS=$(echo "$BASELINE_METRICS" | grep -o '"total_connections":[0-9]*' | cut -d':' -f2 || echo "0")

# Start tile load test in background
log_info "Starting HTTP tile load test ($TILE_CONCURRENT concurrent)..."
oha -c "$TILE_CONCURRENT" -z "${DURATION}s" --json "$TEST_URL" > "$TILE_OUTPUT" 2>&1 &
TILE_PID=$!

# Start WebSocket load test in background (using Rust tests)
log_info "Starting WebSocket load test ($WS_SESSIONS sessions, $WS_FOLLOWERS followers each)..."

# Create a temporary test file for custom configuration
# We use environment variables to configure the Rust test
export LOAD_TEST_WS_URL="$WS_URL"
export LOAD_TEST_SESSIONS="$WS_SESSIONS"
export LOAD_TEST_FOLLOWERS="$WS_FOLLOWERS"
export LOAD_TEST_DURATION="$DURATION"

# Run the Rust WebSocket test (if compiled)
if [[ -f "$PROJECT_ROOT/target/release/deps/perf_tests"* ]]; then
    cd "$PROJECT_ROOT"
    cargo test --test perf_tests test_fanout_minimal --release -- --ignored --nocapture > "$WS_OUTPUT" 2>&1 &
    WS_PID=$!
else
    log_warn "WebSocket tests not compiled (run: cargo build --release --tests)"
    log_info "Running tile-only load test..."
    WS_PID=""
fi

# Wait for tests to complete
log_info "Tests running... waiting ${DURATION}s + buffer"

# Monitor progress
ELAPSED=0
while [[ $ELAPSED -lt $DURATION ]]; do
    sleep 5
    ELAPSED=$((ELAPSED + 5))
    CURRENT_METRICS=$(curl -sf "$BASE_URL/metrics" 2>/dev/null || echo "{}")
    CURRENT_CONNECTIONS=$(echo "$CURRENT_METRICS" | grep -o '"total_connections":[0-9]*' | cut -d':' -f2 || echo "?")
    echo -e "  [${ELAPSED}s/${DURATION}s] Active connections: $CURRENT_CONNECTIONS"
done

# Wait for background jobs
log_info "Waiting for test completion..."
wait $TILE_PID || true
if [[ -n "${WS_PID:-}" ]]; then
    wait $WS_PID || true
fi

# Collect final metrics
FINAL_METRICS=$(curl -sf "$BASE_URL/metrics" 2>/dev/null || echo "{}")

echo ""
echo "=========================================="
echo " Combined Test Results"
echo "=========================================="

# Parse tile results
echo ""
echo "--- HTTP Tile Results ---"
if [[ -f "$TILE_OUTPUT" ]] && command -v jq &> /dev/null; then
    TILE_RPS=$(jq -r '.summary.requestsPerSec // 0 | floor' "$TILE_OUTPUT")
    TILE_P50=$(jq -r '(.latencyPercentiles.p50 // 0) * 1000 | floor' "$TILE_OUTPUT")
    TILE_P95=$(jq -r '(.latencyPercentiles.p95 // 0) * 1000 | floor' "$TILE_OUTPUT")
    TILE_P99=$(jq -r '(.latencyPercentiles.p99 // 0) * 1000 | floor' "$TILE_OUTPUT")
    TILE_SUCCESS=$(jq -r '(.summary.successRate // 1) * 100 | floor' "$TILE_OUTPUT")

    echo "  Throughput:   $TILE_RPS req/s"
    echo "  P50 latency:  ${TILE_P50}ms"
    echo "  P95 latency:  ${TILE_P95}ms"
    echo "  P99 latency:  ${TILE_P99}ms"
    echo "  Success rate: ${TILE_SUCCESS}%"
else
    echo "  (Results file not found or jq not available)"
    TILE_RPS=0
    TILE_P99=0
fi

# Parse WebSocket results
echo ""
echo "--- WebSocket Results ---"
if [[ -f "$WS_OUTPUT" ]]; then
    if grep -q "PASS" "$WS_OUTPUT"; then
        echo "  Status: PASS"
    elif grep -q "FAIL" "$WS_OUTPUT"; then
        echo "  Status: FAIL"
    fi

    # Extract P99 from output
    WS_CURSOR_P99=$(grep "Cursor.*P99:" "$WS_OUTPUT" | grep -o '[0-9.]*ms' | head -1 || echo "N/A")
    WS_VIEWPORT_P99=$(grep "Viewport.*P99:" "$WS_OUTPUT" | grep -o '[0-9.]*ms' | head -1 || echo "N/A")
    WS_SENT=$(grep "Messages sent:" "$WS_OUTPUT" | grep -o '[0-9]*' || echo "N/A")
    WS_RECV=$(grep "Messages received:" "$WS_OUTPUT" | grep -o '[0-9]*' || echo "N/A")

    echo "  Cursor P99:    $WS_CURSOR_P99"
    echo "  Viewport P99:  $WS_VIEWPORT_P99"
    echo "  Messages sent: $WS_SENT"
    echo "  Messages recv: $WS_RECV"
else
    echo "  (WebSocket test not run)"
fi

# Generate summary
{
    echo "Combined Load Test Summary"
    echo "=========================="
    echo ""
    echo "Test Configuration:"
    echo "  Duration: ${DURATION}s"
    echo "  Tile concurrent: $TILE_CONCURRENT"
    echo "  WS sessions: $WS_SESSIONS × $WS_FOLLOWERS followers"
    echo ""
    echo "HTTP Tile Results:"
    echo "  Throughput: ${TILE_RPS:-N/A} req/s"
    echo "  P99 latency: ${TILE_P99:-N/A}ms"
    echo ""
    echo "WebSocket Results:"
    echo "  Cursor P99: ${WS_CURSOR_P99:-N/A}"
    echo "  Viewport P99: ${WS_VIEWPORT_P99:-N/A}"
    echo ""
    echo "Files:"
    echo "  Tile results: $TILE_OUTPUT"
    echo "  WebSocket results: $WS_OUTPUT"
} > "$SUMMARY_FILE"

echo ""
log_success "Results saved to $OUTPUT_DIR"
