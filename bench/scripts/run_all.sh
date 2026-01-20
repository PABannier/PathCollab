#!/usr/bin/env bash
#
# run_all.sh - Orchestrate the complete benchmark suite
#
# This script runs all benchmarks in sequence and generates a comprehensive report.
# It handles server startup (optional), warmup, test execution, and cleanup.
#
# Usage:
#   ./run_all.sh [OPTIONS]
#
# Options:
#   --server-cmd CMD    Command to start the server (default: auto-detect)
#   --server-url URL    Server URL (default: http://127.0.0.1:8080)
#   --skip-micro        Skip Criterion micro-benchmarks
#   --skip-load         Skip HTTP load tests
#   --skip-websocket    Skip WebSocket load tests
#   --quick             Quick mode: shorter durations, fewer iterations
#   --compare-baseline  Compare results to baseline and fail on regression
#   --save-baseline     Save results as new baseline
#   -o, --output        Output directory (default: bench/load_tests/results)
#   -h, --help          Show this help message

set -euo pipefail

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BENCH_DIR="$PROJECT_ROOT/bench"

# Default configuration
SERVER_CMD=""
SERVER_URL="${SERVER_URL:-http://127.0.0.1:8080}"
SKIP_MICRO=false
SKIP_LOAD=false
SKIP_WEBSOCKET=false
QUICK_MODE=false
COMPARE_BASELINE=false
SAVE_BASELINE=false
OUTPUT_DIR="$BENCH_DIR/load_tests/results"
SERVER_PID=""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

usage() {
    grep '^#' "$0" | grep -v '#!/' | cut -c3-
    exit 0
}

log_header() {
    echo ""
    echo -e "${BOLD}${CYAN}════════════════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}${CYAN} $1${NC}"
    echo -e "${BOLD}${CYAN}════════════════════════════════════════════════════════════${NC}"
    echo ""
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

cleanup() {
    if [[ -n "${SERVER_PID:-}" ]]; then
        log_info "Stopping server (PID: $SERVER_PID)..."
        kill "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
}

trap cleanup EXIT

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --server-cmd)
            SERVER_CMD="$2"
            shift 2
            ;;
        --server-url)
            SERVER_URL="$2"
            shift 2
            ;;
        --skip-micro)
            SKIP_MICRO=true
            shift
            ;;
        --skip-load)
            SKIP_LOAD=true
            shift
            ;;
        --skip-websocket)
            SKIP_WEBSOCKET=true
            shift
            ;;
        --quick)
            QUICK_MODE=true
            shift
            ;;
        --compare-baseline)
            COMPARE_BASELINE=true
            shift
            ;;
        --save-baseline)
            SAVE_BASELINE=true
            shift
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

# Create output directory
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RUN_DIR="$OUTPUT_DIR/run_$TIMESTAMP"
mkdir -p "$RUN_DIR"

log_header "PathCollab Benchmark Suite"

echo "Configuration:"
echo "  Project root:    $PROJECT_ROOT"
echo "  Server URL:      $SERVER_URL"
echo "  Output:          $RUN_DIR"
echo "  Quick mode:      $QUICK_MODE"
echo "  Skip micro:      $SKIP_MICRO"
echo "  Skip load:       $SKIP_LOAD"
echo "  Skip WebSocket:  $SKIP_WEBSOCKET"
echo ""

# Check if server is running, or start it
log_info "Checking server status..."
if curl -sf "$SERVER_URL/health" > /dev/null 2>&1; then
    log_success "Server is already running at $SERVER_URL"
else
    if [[ -n "$SERVER_CMD" ]]; then
        log_info "Starting server with: $SERVER_CMD"
        $SERVER_CMD &
        SERVER_PID=$!

        # Wait for server to be ready
        for i in {1..30}; do
            if curl -sf "$SERVER_URL/health" > /dev/null 2>&1; then
                log_success "Server is ready"
                break
            fi
            if [[ $i -eq 30 ]]; then
                log_error "Server failed to start within 30 seconds"
                exit 1
            fi
            sleep 1
        done
    else
        log_error "Server not running at $SERVER_URL"
        log_info "Either start the server manually or use --server-cmd"
        exit 1
    fi
fi

# Warmup
log_header "Warmup Phase"
log_info "Sending warmup requests..."
for i in {1..10}; do
    curl -sf "$SERVER_URL/health" > /dev/null 2>&1 || true
    curl -sf "$SERVER_URL/api/slides" > /dev/null 2>&1 || true
done
log_success "Warmup complete"

# Track overall results
LOAD_PASSED=true
WS_PASSED=true

# Phase 1: HTTP load tests
if [[ "$SKIP_LOAD" != "true" ]]; then
    log_header "Phase 1: HTTP Load Tests"

    cd "$PROJECT_ROOT"

    if ! command -v oha &> /dev/null; then
        log_warn "oha not installed, skipping HTTP load tests"
        log_info "Install with: cargo install oha"
    else
        # Tile stress test
        log_info "Running tile stress test..."
        if [[ "$QUICK_MODE" == "true" ]]; then
            bash "$BENCH_DIR/load_tests/scenarios/tile_stress.sh" \
                --url "$SERVER_URL" \
                --quick \
                --output "$RUN_DIR/tile_stress.json" 2>&1 | tee "$RUN_DIR/tile_stress.txt" || LOAD_PASSED=false
        else
            bash "$BENCH_DIR/load_tests/scenarios/tile_stress.sh" \
                --url "$SERVER_URL" \
                --concurrent 20 \
                --duration 30 \
                --output "$RUN_DIR/tile_stress.json" 2>&1 | tee "$RUN_DIR/tile_stress.txt" || LOAD_PASSED=false
        fi

        # Overlay stress test
        log_info "Running overlay stress test..."
        if [[ "$QUICK_MODE" == "true" ]]; then
            bash "$BENCH_DIR/load_tests/scenarios/overlay_stress.sh" \
                --url "$SERVER_URL" \
                --quick \
                --output "$RUN_DIR/overlay_stress.json" 2>&1 | tee "$RUN_DIR/overlay_stress.txt" || LOAD_PASSED=false
        else
            bash "$BENCH_DIR/load_tests/scenarios/overlay_stress.sh" \
                --url "$SERVER_URL" \
                --concurrent 20 \
                --duration 30 \
                --output "$RUN_DIR/overlay_stress.json" 2>&1 | tee "$RUN_DIR/overlay_stress.txt" || LOAD_PASSED=false
        fi

        if [[ "$LOAD_PASSED" == "true" ]]; then
            log_success "HTTP load tests complete"
        else
            log_warn "HTTP load tests had issues"
        fi
    fi
else
    log_info "Skipping HTTP load tests (--skip-load)"
fi

# Phase 2: WebSocket load tests
if [[ "$SKIP_WEBSOCKET" != "true" ]]; then
    log_header "Phase 2: WebSocket Load Tests"

    cd "$PROJECT_ROOT/server"

    log_info "Running WebSocket load tests..."
    if [[ "$QUICK_MODE" == "true" ]]; then
        cargo test --test perf_tests test_fanout_minimal --release -- --ignored --nocapture 2>&1 | tee "$RUN_DIR/websocket_load.txt" || WS_PASSED=false
    else
        cargo test --test perf_tests test_fanout_standard --release -- --ignored --nocapture 2>&1 | tee "$RUN_DIR/websocket_load.txt" || WS_PASSED=false
    fi

    if [[ "$WS_PASSED" == "true" ]]; then
        log_success "WebSocket load tests complete"
    else
        log_warn "WebSocket load tests had issues"
    fi
else
    log_info "Skipping WebSocket load tests (--skip-websocket)"
fi

# Phase 3: Collect metrics
log_header "Phase 3: Collecting Metrics"

log_info "Fetching server metrics..."
curl -sf "$SERVER_URL/metrics" > "$RUN_DIR/server_metrics.json" 2>/dev/null || true
curl -sf "$SERVER_URL/metrics/prometheus" > "$RUN_DIR/prometheus_metrics.txt" 2>/dev/null || true
log_success "Metrics collected"

# Phase 4: Generate report
log_header "Phase 4: Generating Report"

python3 "$BENCH_DIR/scripts/generate_report.py" \
    --input-dir "$RUN_DIR" \
    --output "$RUN_DIR/REPORT.md" 2>&1 || log_warn "Report generation had issues"

if [[ -f "$RUN_DIR/REPORT.md" ]]; then
    log_success "Report generated: $RUN_DIR/REPORT.md"
fi

# Phase 5: Baseline comparison (if requested)
if [[ "$COMPARE_BASELINE" == "true" ]] && [[ -f "$RUN_DIR/tile_stress.json" ]]; then
    log_header "Phase 5: Baseline Comparison"

    BASELINE_FILE="$BENCH_DIR/baselines/tile_baseline.json"

    if [[ -f "$BASELINE_FILE" ]]; then
        python3 "$BENCH_DIR/scripts/compare_baseline.py" \
            --current "$RUN_DIR/tile_stress.json" \
            --baseline "$BASELINE_FILE" \
            --threshold 10 2>&1 | tee "$RUN_DIR/baseline_comparison.txt"

        if [[ ${PIPESTATUS[0]} -ne 0 ]]; then
            LOAD_PASSED=false
        fi
    else
        log_warn "No baseline found at $BASELINE_FILE"
        log_info "Create baseline with: --save-baseline"
    fi
fi

# Save baseline (if requested)
if [[ "$SAVE_BASELINE" == "true" ]] && [[ -f "$RUN_DIR/tile_stress.json" ]]; then
    log_info "Saving new baseline..."
    python3 "$BENCH_DIR/scripts/compare_baseline.py" \
        --save-baseline "$RUN_DIR/tile_stress.json" \
        --output "$BENCH_DIR/baselines/tile_baseline.json" \
        --description "Baseline from run $TIMESTAMP"
fi

# Summary
log_header "Summary"

echo "Results saved to: $RUN_DIR"
echo ""
echo "Test Results:"
echo "  HTTP load tests:  $([ "$LOAD_PASSED" == "true" ] && echo "✅ PASS" || echo "❌ FAIL")"
echo "  WebSocket tests:  $([ "$WS_PASSED" == "true" ] && echo "✅ PASS" || echo "⚠️  ISSUES")"
echo ""

# Create symlink to latest run
ln -sfn "run_$TIMESTAMP" "$OUTPUT_DIR/latest"
echo "Latest results linked: $OUTPUT_DIR/latest"

# Exit with appropriate code
if [[ "$LOAD_PASSED" == "true" ]] && [[ "$WS_PASSED" == "true" ]]; then
    log_success "All benchmarks passed!"
    exit 0
else
    log_error "Some benchmarks failed"
    exit 1
fi
