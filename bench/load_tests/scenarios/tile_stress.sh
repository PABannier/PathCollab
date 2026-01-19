#!/usr/bin/env bash
#
# tile_stress.sh - HTTP load test for tile serving endpoints
#
# This script hammers the tile serving endpoint to measure:
# - Latency percentiles (p50, p90, p95, p99, p99.9)
# - Throughput (requests/second)
# - Error rates
#
# Prerequisites:
#   - oha: cargo install oha
#   - Running PathCollab server with slides available
#
# Usage:
#   ./tile_stress.sh [OPTIONS]
#
# Options:
#   -u, --url        Base URL (default: http://127.0.0.1:8080)
#   -s, --slide      Slide ID to test (default: auto-detect from /api/slides)
#   -c, --concurrent Concurrent connections (default: 10)
#   -d, --duration   Test duration in seconds (default: 30)
#   -r, --rate       Requests per second limit, 0=unlimited (default: 0)
#   -o, --output     Output file for JSON results (optional)
#   -q, --quick      Quick mode: 5 connections, 10 seconds
#   -h, --help       Show this help message

set -euo pipefail

# Default configuration
BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
SLIDE_ID=""
CONCURRENT=10
DURATION=30
RATE=0
OUTPUT_FILE=""
QUICK_MODE=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
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
            shift 2
            ;;
        -s|--slide)
            SLIDE_ID="$2"
            shift 2
            ;;
        -c|--concurrent)
            CONCURRENT="$2"
            shift 2
            ;;
        -d|--duration)
            DURATION="$2"
            shift 2
            ;;
        -r|--rate)
            RATE="$2"
            shift 2
            ;;
        -o|--output)
            OUTPUT_FILE="$2"
            shift 2
            ;;
        -q|--quick)
            QUICK_MODE=true
            shift
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

# Quick mode overrides
if [[ "$QUICK_MODE" == "true" ]]; then
    CONCURRENT=5
    DURATION=10
    log_info "Quick mode enabled: $CONCURRENT connections, ${DURATION}s duration"
fi

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

# Auto-detect slide if not specified
if [[ -z "$SLIDE_ID" ]]; then
    log_info "Auto-detecting slide ID..."
    SLIDES_JSON=$(curl -sf "$BASE_URL/api/slides" 2>/dev/null || echo "[]")
    SLIDE_ID=$(echo "$SLIDES_JSON" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")

    if [[ -z "$SLIDE_ID" ]]; then
        # Try default slide endpoint
        DEFAULT_JSON=$(curl -sf "$BASE_URL/api/slides/default" 2>/dev/null || echo "{}")
        SLIDE_ID=$(echo "$DEFAULT_JSON" | grep -o '"slide_id":"[^"]*"' | cut -d'"' -f4 || echo "")
    fi

    if [[ -z "$SLIDE_ID" ]]; then
        log_error "No slides found. Ensure slides are configured or use --slide"
        exit 1
    fi
fi
log_success "Using slide: $SLIDE_ID"

# Get slide metadata to determine valid tile coordinates
log_info "Fetching slide metadata..."
METADATA=$(curl -sf "$BASE_URL/api/slide/$SLIDE_ID" 2>/dev/null || echo "{}")
NUM_LEVELS=$(echo "$METADATA" | grep -o '"num_levels":[0-9]*' | cut -d':' -f2 || echo "10")
TILE_SIZE=$(echo "$METADATA" | grep -o '"tile_size":[0-9]*' | cut -d':' -f2 || echo "256")
WIDTH=$(echo "$METADATA" | grep -o '"width":[0-9]*' | cut -d':' -f2 || echo "10000")
HEIGHT=$(echo "$METADATA" | grep -o '"height":[0-9]*' | cut -d':' -f2 || echo "10000")

# Calculate a level that has meaningful tiles (around 10-50 tiles across)
# DZI: level 0 = 1x1, level (N-1) = full resolution
# At level L, width = original_width / 2^(N-1-L)
# We want level where width / tile_size gives us ~20 tiles
# Test at level (NUM_LEVELS - 4) which is 1/8th of full resolution
TEST_LEVEL=$((NUM_LEVELS - 4))
if [[ $TEST_LEVEL -lt 8 ]]; then
    TEST_LEVEL=8
fi
if [[ $TEST_LEVEL -ge $NUM_LEVELS ]]; then
    TEST_LEVEL=$((NUM_LEVELS - 1))
fi

# Calculate tiles at this level
SCALE_FACTOR=$((1 << (NUM_LEVELS - 1 - TEST_LEVEL)))
LEVEL_WIDTH=$((WIDTH / SCALE_FACTOR))
LEVEL_HEIGHT=$((HEIGHT / SCALE_FACTOR))
MAX_TILE_X=$(( (LEVEL_WIDTH + TILE_SIZE - 1) / TILE_SIZE - 1 ))
MAX_TILE_Y=$(( (LEVEL_HEIGHT + TILE_SIZE - 1) / TILE_SIZE - 1 ))

log_info "Slide: ${WIDTH}x${HEIGHT}, $NUM_LEVELS levels"
log_info "Testing at level $TEST_LEVEL (${LEVEL_WIDTH}x${LEVEL_HEIGHT}px, tiles: 0-${MAX_TILE_X} x 0-${MAX_TILE_Y})"

# Build tile URL template
# We'll test a range of tile coordinates to simulate viewport panning
TILE_URL="$BASE_URL/api/slide/$SLIDE_ID/tile/$TEST_LEVEL/{x}/{y}"

echo ""
echo "=========================================="
echo " Tile Stress Test Configuration"
echo "=========================================="
echo " URL:         $BASE_URL"
echo " Slide:       $SLIDE_ID"
echo " Level:       $TEST_LEVEL"
echo " Concurrent:  $CONCURRENT"
echo " Duration:    ${DURATION}s"
echo " Rate limit:  ${RATE:-unlimited} req/s"
echo "=========================================="
echo ""

# Generate tile URLs file for oha (simulate viewport panning)
URLS_FILE=$(mktemp)
trap "rm -f $URLS_FILE" EXIT

# Generate a grid of tile coordinates from center of slide
CENTER_X=$((MAX_TILE_X / 2))
CENTER_Y=$((MAX_TILE_Y / 2))
START_X=$((CENTER_X > 5 ? CENTER_X - 5 : 0))
START_Y=$((CENTER_Y > 5 ? CENTER_Y - 5 : 0))
END_X=$((START_X + 9 < MAX_TILE_X ? START_X + 9 : MAX_TILE_X))
END_Y=$((START_Y + 9 < MAX_TILE_Y ? START_Y + 9 : MAX_TILE_Y))

for x in $(seq $START_X $END_X); do
    for y in $(seq $START_Y $END_Y); do
        echo "$BASE_URL/api/slide/$SLIDE_ID/tile/$TEST_LEVEL/$x/$y" >> "$URLS_FILE"
    done
done

log_info "Generated $(wc -l < "$URLS_FILE") tile URLs (tiles $START_X-$END_X x $START_Y-$END_Y)"
log_info "Starting load test..."
echo ""

# Build oha command
OHA_CMD="oha"
OHA_CMD="$OHA_CMD -c $CONCURRENT"
OHA_CMD="$OHA_CMD -z ${DURATION}s"
OHA_CMD="$OHA_CMD --no-tui"

if [[ $RATE -gt 0 ]]; then
    OHA_CMD="$OHA_CMD -q $RATE"
fi

# Add JSON output if requested
if [[ -n "$OUTPUT_FILE" ]]; then
    OHA_CMD="$OHA_CMD --output-format json -o $OUTPUT_FILE"
fi

# Run the load test with URL file
# oha doesn't support URL files directly, so we use a workaround with random selection
# Instead, we'll test a single representative tile URL at the center
TEST_TILE_URL="$BASE_URL/api/slide/$SLIDE_ID/tile/$TEST_LEVEL/$CENTER_X/$CENTER_Y"

log_info "Testing tile: $TEST_TILE_URL"

if [[ -n "$OUTPUT_FILE" ]]; then
    $OHA_CMD "$TEST_TILE_URL" 2>&1
    log_success "Results saved to $OUTPUT_FILE"

    # Also print summary
    echo ""
    echo "=========================================="
    echo " Results Summary (from JSON)"
    echo "=========================================="
    if command -v jq &> /dev/null && [[ -f "$OUTPUT_FILE" ]]; then
        jq -r '
            "Duration:     \(.summary.total | floor)s",
            "Requests:     \(.statusCodeDistribution | to_entries | map(.value) | add)",
            "Successful:   \(.summary.successRate * 100 | floor)%",
            "Req/sec:      \(.summary.requestsPerSec | floor)",
            "",
            "Latency:",
            "  P50:        \(.latencyPercentiles.p50 * 1000 | floor)ms",
            "  P90:        \(.latencyPercentiles.p90 * 1000 | floor)ms",
            "  P95:        \(.latencyPercentiles.p95 * 1000 | floor)ms",
            "  P99:        \(.latencyPercentiles.p99 * 1000 | floor)ms",
            "  P99.9:      \(.latencyPercentiles."p99.9" * 1000 | floor)ms"
        ' "$OUTPUT_FILE" 2>/dev/null || cat "$OUTPUT_FILE"
    else
        cat "$OUTPUT_FILE" 2>/dev/null || echo "(output file not available)"
    fi
else
    $OHA_CMD "$TEST_TILE_URL"
fi

echo ""
log_success "Tile stress test completed"
