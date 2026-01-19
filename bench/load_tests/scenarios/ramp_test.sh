#!/usr/bin/env bash
#
# ramp_test.sh - Gradual load increase test to find breaking point
#
# This script increases concurrent connections gradually to identify:
# - Maximum sustainable throughput
# - Breaking point where latency degrades significantly
# - Error threshold (when errors start appearing)
#
# Prerequisites:
#   - oha: cargo install oha
#   - Running PathCollab server with slides available
#
# Usage:
#   ./ramp_test.sh [OPTIONS]
#
# Options:
#   -u, --url         Base URL (default: http://127.0.0.1:8080)
#   -s, --slide       Slide ID to test (default: auto-detect)
#   --start           Starting concurrent connections (default: 1)
#   --end             Maximum concurrent connections (default: 100)
#   --step            Concurrency increase per stage (default: 10)
#   --stage-duration  Duration per stage in seconds (default: 10)
#   -o, --output      Output directory for results (default: bench/load_tests/results)
#   -h, --help        Show this help message

set -euo pipefail

# Default configuration
BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
SLIDE_ID=""
START_CONCURRENCY=1
END_CONCURRENCY=100
STEP=10
STAGE_DURATION=10
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

log_stage() {
    echo -e "${CYAN}[STAGE]${NC} $1"
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
        --start)
            START_CONCURRENCY="$2"
            shift 2
            ;;
        --end)
            END_CONCURRENCY="$2"
            shift 2
            ;;
        --step)
            STEP="$2"
            shift 2
            ;;
        --stage-duration)
            STAGE_DURATION="$2"
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

# Check for oha
if ! command -v oha &> /dev/null; then
    log_error "oha is not installed. Install with: cargo install oha"
    exit 1
fi

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Check server health
log_info "Checking server health at $BASE_URL..."
if ! curl -sf "$BASE_URL/health" > /dev/null 2>&1; then
    log_error "Server not responding at $BASE_URL"
    exit 1
fi
log_success "Server is healthy"

# Auto-detect slide if not specified
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

# Prepare results file
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RESULTS_FILE="$OUTPUT_DIR/ramp_${TIMESTAMP}.csv"
SUMMARY_FILE="$OUTPUT_DIR/ramp_${TIMESTAMP}_summary.txt"

echo ""
echo "=========================================="
echo " Ramp-Up Load Test"
echo "=========================================="
echo " URL:             $BASE_URL"
echo " Slide:           $SLIDE_ID"
echo " Level:           $TEST_LEVEL"
echo " Start:           $START_CONCURRENCY connections"
echo " End:             $END_CONCURRENCY connections"
echo " Step:            +$STEP per stage"
echo " Stage duration:  ${STAGE_DURATION}s"
echo " Output:          $RESULTS_FILE"
echo "=========================================="
echo ""

# CSV header
echo "concurrency,requests,success_rate,rps,p50_ms,p90_ms,p95_ms,p99_ms,errors" > "$RESULTS_FILE"

# Track best performance
BEST_RPS=0
BEST_CONCURRENCY=0
BREAKING_POINT=0

# Run stages
CURRENT=$START_CONCURRENCY
STAGE=1

while [[ $CURRENT -le $END_CONCURRENCY ]]; do
    log_stage "Stage $STAGE: $CURRENT concurrent connections"

    # Run oha and capture JSON output
    STAGE_OUTPUT=$(oha -c "$CURRENT" -z "${STAGE_DURATION}s" --json "$TEST_URL" 2>/dev/null || echo "{}")

    # Parse results (using grep/sed for portability, jq if available)
    if command -v jq &> /dev/null; then
        REQUESTS=$(echo "$STAGE_OUTPUT" | jq -r '.summary.total // 0')
        SUCCESS_RATE=$(echo "$STAGE_OUTPUT" | jq -r '(.summary.successRate // 1) * 100 | floor')
        RPS=$(echo "$STAGE_OUTPUT" | jq -r '.summary.requestsPerSec // 0 | floor')
        P50=$(echo "$STAGE_OUTPUT" | jq -r '(.latencyPercentiles.p50 // 0) * 1000 | floor')
        P90=$(echo "$STAGE_OUTPUT" | jq -r '(.latencyPercentiles.p90 // 0) * 1000 | floor')
        P95=$(echo "$STAGE_OUTPUT" | jq -r '(.latencyPercentiles.p95 // 0) * 1000 | floor')
        P99=$(echo "$STAGE_OUTPUT" | jq -r '(.latencyPercentiles.p99 // 0) * 1000 | floor')
        ERRORS=$(echo "$STAGE_OUTPUT" | jq -r '.statusCodeDistribution | to_entries | map(select(.key | startswith("5") or startswith("4"))) | map(.value) | add // 0')
    else
        # Fallback parsing
        REQUESTS=$(echo "$STAGE_OUTPUT" | grep -o '"total":[0-9]*' | cut -d':' -f2 || echo "0")
        SUCCESS_RATE="100"
        RPS=$(echo "$STAGE_OUTPUT" | grep -o '"requestsPerSec":[0-9.]*' | cut -d':' -f2 | cut -d'.' -f1 || echo "0")
        P50="0"
        P90="0"
        P95="0"
        P99="0"
        ERRORS="0"
    fi

    # Record to CSV
    echo "$CURRENT,$REQUESTS,$SUCCESS_RATE,$RPS,$P50,$P90,$P95,$P99,$ERRORS" >> "$RESULTS_FILE"

    # Print stage summary
    echo "    Requests: $REQUESTS | RPS: $RPS | P99: ${P99}ms | Success: ${SUCCESS_RATE}%"

    # Track best RPS
    if [[ $RPS -gt $BEST_RPS ]]; then
        BEST_RPS=$RPS
        BEST_CONCURRENCY=$CURRENT
    fi

    # Detect breaking point (P99 > 500ms or success rate drops)
    if [[ $P99 -gt 500 || $SUCCESS_RATE -lt 95 ]]; then
        if [[ $BREAKING_POINT -eq 0 ]]; then
            BREAKING_POINT=$CURRENT
            log_warn "Performance degradation detected at $CURRENT connections"
        fi
    fi

    # Next stage
    CURRENT=$((CURRENT + STEP))
    STAGE=$((STAGE + 1))

    # Brief pause between stages
    sleep 1
done

echo ""
echo "=========================================="
echo " Ramp-Up Test Complete"
echo "=========================================="

# Generate summary
{
    echo "Ramp-Up Load Test Summary"
    echo "========================="
    echo ""
    echo "Test Parameters:"
    echo "  URL: $BASE_URL"
    echo "  Slide: $SLIDE_ID"
    echo "  Duration per stage: ${STAGE_DURATION}s"
    echo ""
    echo "Results:"
    echo "  Best throughput: $BEST_RPS req/s at $BEST_CONCURRENCY connections"
    if [[ $BREAKING_POINT -gt 0 ]]; then
        echo "  Breaking point: $BREAKING_POINT connections"
    else
        echo "  Breaking point: Not reached (max: $END_CONCURRENCY)"
    fi
    echo ""
    echo "Full results: $RESULTS_FILE"
} | tee "$SUMMARY_FILE"

echo ""
log_success "Results saved to $OUTPUT_DIR"
