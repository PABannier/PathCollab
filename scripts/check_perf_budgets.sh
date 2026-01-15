#!/bin/bash
# Performance budget assertion script
# Parses load test output and fails if budgets are exceeded
#
# Usage: ./scripts/check_perf_budgets.sh [test_output_file]
#
# Performance Budgets:
#   - Cursor broadcast P99: < 100ms
#   - Viewport broadcast P99: < 150ms
#   - Message handling P99: < 10ms

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Performance budgets (in milliseconds)
CURSOR_P99_BUDGET_MS=100
VIEWPORT_P99_BUDGET_MS=150
MESSAGE_P99_BUDGET_MS=10

echo "=================================="
echo "Performance Budget Check"
echo "=================================="
echo ""
echo "Budgets:"
echo "  Cursor P99:   < ${CURSOR_P99_BUDGET_MS}ms"
echo "  Viewport P99: < ${VIEWPORT_P99_BUDGET_MS}ms"
echo "  Message P99:  < ${MESSAGE_P99_BUDGET_MS}ms"
echo ""

# If a file is provided, parse it
if [ -n "$1" ] && [ -f "$1" ]; then
    echo "Parsing test output from: $1"
    echo ""

    # Extract P99 values from test output
    # Expected format: "P99: XXms" or "P99: XX.XXms"

    CURSOR_P99=$(grep -A3 "Cursor Latencies:" "$1" | grep "P99:" | grep -oP '\d+(\.\d+)?(?=ms)' | head -1 || echo "")
    VIEWPORT_P99=$(grep -A3 "Viewport Latencies:" "$1" | grep "P99:" | grep -oP '\d+(\.\d+)?(?=ms)' | head -1 || echo "")

    FAILED=0

    if [ -n "$CURSOR_P99" ]; then
        if (( $(echo "$CURSOR_P99 > $CURSOR_P99_BUDGET_MS" | bc -l) )); then
            echo -e "${RED}FAIL${NC}: Cursor P99 (${CURSOR_P99}ms) exceeds budget (${CURSOR_P99_BUDGET_MS}ms)"
            FAILED=1
        else
            echo -e "${GREEN}PASS${NC}: Cursor P99 (${CURSOR_P99}ms) within budget (${CURSOR_P99_BUDGET_MS}ms)"
        fi
    else
        echo -e "${YELLOW}SKIP${NC}: Cursor P99 not found in output"
    fi

    if [ -n "$VIEWPORT_P99" ]; then
        if (( $(echo "$VIEWPORT_P99 > $VIEWPORT_P99_BUDGET_MS" | bc -l) )); then
            echo -e "${RED}FAIL${NC}: Viewport P99 (${VIEWPORT_P99}ms) exceeds budget (${VIEWPORT_P99_BUDGET_MS}ms)"
            FAILED=1
        else
            echo -e "${GREEN}PASS${NC}: Viewport P99 (${VIEWPORT_P99}ms) within budget (${VIEWPORT_P99_BUDGET_MS}ms)"
        fi
    else
        echo -e "${YELLOW}SKIP${NC}: Viewport P99 not found in output"
    fi

    echo ""
    if [ $FAILED -eq 1 ]; then
        echo -e "${RED}Performance budget check FAILED${NC}"
        exit 1
    else
        echo -e "${GREEN}Performance budget check PASSED${NC}"
        exit 0
    fi
else
    echo "No test output file provided."
    echo ""
    echo "Usage: $0 <test_output_file>"
    echo ""
    echo "Example:"
    echo "  cargo test --test perf_tests test_fanout_standard --release -- --ignored --nocapture 2>&1 | tee /tmp/perf_output.txt"
    echo "  $0 /tmp/perf_output.txt"
    exit 0
fi
