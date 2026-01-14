#!/usr/bin/env bash
#
# Health check script for PathCollab services
# Usage: ./scripts/check-health.sh [--wait]
#
# Options:
#   --wait    Wait for services to become healthy (with timeout)
#
set -euo pipefail

# Configuration
BACKEND_URL="${BACKEND_URL:-http://localhost:8080}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:5173}"
MAX_WAIT_SECONDS="${MAX_WAIT_SECONDS:-30}"
CHECK_INTERVAL=2

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

check_backend() {
    local response
    local status_code

    if ! response=$(curl -sf "$BACKEND_URL/health" 2>/dev/null); then
        return 1
    fi

    # Check if status is healthy
    echo "$response" | grep -q '"status":"healthy"'
}

check_frontend() {
    curl -sf "$FRONTEND_URL" > /dev/null 2>&1
}

print_status() {
    local name=$1
    local status=$2

    if [ "$status" = "ok" ]; then
        echo -e "  ${GREEN}✓${NC} $name"
    else
        echo -e "  ${RED}✗${NC} $name"
    fi
}

check_all() {
    local backend_ok="fail"
    local frontend_ok="fail"
    local all_ok=true

    echo "Checking PathCollab services..."
    echo ""

    if check_backend; then
        backend_ok="ok"
    else
        all_ok=false
    fi
    print_status "Backend ($BACKEND_URL/health)" "$backend_ok"

    if check_frontend; then
        frontend_ok="ok"
    else
        all_ok=false
    fi
    print_status "Frontend ($FRONTEND_URL)" "$frontend_ok"

    echo ""

    if $all_ok; then
        echo -e "${GREEN}All services healthy!${NC}"
        return 0
    else
        echo -e "${RED}Some services unavailable${NC}"
        return 1
    fi
}

wait_for_services() {
    local elapsed=0

    echo -e "${YELLOW}Waiting for services to become healthy (timeout: ${MAX_WAIT_SECONDS}s)...${NC}"
    echo ""

    while [ $elapsed -lt $MAX_WAIT_SECONDS ]; do
        if check_all 2>/dev/null; then
            return 0
        fi

        echo -e "  Retrying in ${CHECK_INTERVAL}s... (${elapsed}s elapsed)"
        sleep $CHECK_INTERVAL
        elapsed=$((elapsed + CHECK_INTERVAL))
    done

    echo -e "${RED}Timeout waiting for services${NC}"
    check_all
    return 1
}

# Parse arguments
WAIT_MODE=false
for arg in "$@"; do
    case $arg in
        --wait)
            WAIT_MODE=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [--wait]"
            echo ""
            echo "Options:"
            echo "  --wait    Wait for services to become healthy (with timeout)"
            echo ""
            echo "Environment variables:"
            echo "  BACKEND_URL         Backend URL (default: http://localhost:8080)"
            echo "  FRONTEND_URL        Frontend URL (default: http://localhost:5173)"
            echo "  MAX_WAIT_SECONDS    Max wait time in --wait mode (default: 30)"
            exit 0
            ;;
        *)
            ;;
    esac
done

# Run checks
if $WAIT_MODE; then
    wait_for_services
else
    check_all
fi
