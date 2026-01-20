#!/usr/bin/env bash
#
# overlay_stress.sh - HTTP load test for cell overlay endpoints
#
# This script hammers the cell overlay endpoint to measure:
# - Latency percentiles (p50, p90, p95, p99, p99.9)
# - Throughput (requests/second)
# - Error rates
#
# Prerequisites:
#   - oha: cargo install oha
#   - Running PathCollab server with slides and overlays available
#
# Usage:
#   ./overlay_stress.sh [OPTIONS]
#
# Options:
#   -u, --url           Base URL (default: http://127.0.0.1:8080)
#   -s, --slide         Slide ID to test (default: auto-detect from /api/slides)
#   -c, --concurrent    Concurrent connections (default: 10)
#   -d, --duration      Test duration in seconds (default: 30)
#   -r, --rate          Requests per second limit, 0=unlimited (default: 0)
#   -v, --viewport-size Viewport size in pixels (default: 512)
#   -o, --output        Output file for JSON results (optional)
#   -q, --quick         Quick mode: 5 connections, 10 seconds
#   -h, --help          Show this help message

set -euo pipefail

# Default configuration
BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
SLIDE_ID=""
CONCURRENT=10
DURATION=30
RATE=0
VIEWPORT_SIZE=512
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
        -v|--viewport-size)
            VIEWPORT_SIZE="$2"
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

# Check overlay availability with retry for loading state
log_info "Checking overlay availability..."
OVERLAY_READY=false
for i in {1..10}; do
    OVERLAY_RESPONSE=$(curl -sf -w "\n%{http_code}" "$BASE_URL/api/slide/$SLIDE_ID/overlay/metadata" 2>/dev/null || echo -e "\n000")
    HTTP_CODE=$(echo "$OVERLAY_RESPONSE" | tail -1)

    if [[ "$HTTP_CODE" == "200" ]]; then
        OVERLAY_READY=true
        break
    elif [[ "$HTTP_CODE" == "202" ]]; then
        log_info "Overlay still loading, waiting... (attempt $i/10)"
        sleep 1
    elif [[ "$HTTP_CODE" == "404" ]]; then
        log_error "No overlay available for slide $SLIDE_ID"
        exit 1
    else
        log_warn "Unexpected response code: $HTTP_CODE (attempt $i/10)"
        sleep 1
    fi
done

if [[ "$OVERLAY_READY" != "true" ]]; then
    log_error "Overlay not ready after 10 attempts"
    exit 1
fi
log_success "Overlay is ready"

# Get slide dimensions
log_info "Fetching slide metadata..."
METADATA=$(curl -sf "$BASE_URL/api/slide/$SLIDE_ID" 2>/dev/null || echo "{}")
WIDTH=$(echo "$METADATA" | grep -o '"width":[0-9]*' | cut -d':' -f2 || echo "10000")
HEIGHT=$(echo "$METADATA" | grep -o '"height":[0-9]*' | cut -d':' -f2 || echo "10000")

log_info "Slide dimensions: ${WIDTH}x${HEIGHT}"

# Calculate center and viewport regions
CENTER_X=$((WIDTH / 2))
CENTER_Y=$((HEIGHT / 2))

echo ""
echo "=========================================="
echo " Overlay Stress Test Configuration"
echo "=========================================="
echo " URL:           $BASE_URL"
echo " Slide:         $SLIDE_ID"
echo " Viewport:      ${VIEWPORT_SIZE}x${VIEWPORT_SIZE}"
echo " Concurrent:    $CONCURRENT"
echo " Duration:      ${DURATION}s"
echo " Rate limit:    ${RATE:-unlimited} req/s"
echo "=========================================="
echo ""

# Generate viewport region URLs file for reference (3x3 grid around center)
URLS_FILE=$(mktemp)
trap "rm -f $URLS_FILE" EXIT

log_info "Generating viewport regions (3x3 grid around center)..."
for dx in -$VIEWPORT_SIZE 0 $VIEWPORT_SIZE; do
    for dy in -$VIEWPORT_SIZE 0 $VIEWPORT_SIZE; do
        x=$((CENTER_X + dx))
        y=$((CENTER_Y + dy))
        # Clamp to bounds
        if [[ $x -lt 0 ]]; then x=0; fi
        if [[ $y -lt 0 ]]; then y=0; fi
        if [[ $x -gt $((WIDTH - VIEWPORT_SIZE)) ]]; then x=$((WIDTH - VIEWPORT_SIZE)); fi
        if [[ $y -gt $((HEIGHT - VIEWPORT_SIZE)) ]]; then y=$((HEIGHT - VIEWPORT_SIZE)); fi
        echo "$BASE_URL/api/slide/$SLIDE_ID/overlay/cells?x=$x&y=$y&width=$VIEWPORT_SIZE&height=$VIEWPORT_SIZE" >> "$URLS_FILE"
    done
done

log_info "Generated $(wc -l < "$URLS_FILE") viewport region URLs"

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

# Test a representative center region URL
# oha doesn't support URL files directly, so we test the center viewport
TEST_URL="$BASE_URL/api/slide/$SLIDE_ID/overlay/cells?x=$CENTER_X&y=$CENTER_Y&width=$VIEWPORT_SIZE&height=$VIEWPORT_SIZE"

log_info "Testing overlay cells endpoint: $TEST_URL"
log_info "Starting load test..."
echo ""

if [[ -n "$OUTPUT_FILE" ]]; then
    $OHA_CMD "$TEST_URL" 2>&1
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
    $OHA_CMD "$TEST_URL"
fi

echo ""
log_success "Overlay stress test completed"
