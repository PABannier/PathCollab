#!/bin/bash
# Smoke test script for PathCollab
# Verifies that the full stack is running and responding correctly

set -e

# Configuration (override with environment variables)
BASE_URL=${BASE_URL:-http://localhost:8080}
FRONTEND_URL=${FRONTEND_URL:-http://localhost:3000}
TIMEOUT=${TIMEOUT:-5}

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== PathCollab Smoke Test ===${NC}"
echo -e "Backend:  ${BASE_URL}"
echo -e "Frontend: ${FRONTEND_URL}"
echo ""

FAILED=0

# Helper function for checks
check() {
    local name="$1"
    local result="$2"
    local expected="$3"

    if [[ "$result" == *"$expected"* ]]; then
        echo -e "${GREEN}✓${NC} $name"
        return 0
    else
        echo -e "${RED}✗${NC} $name"
        FAILED=1
        return 1
    fi
}

warn() {
    local name="$1"
    local message="$2"
    echo -e "${YELLOW}⚠${NC} $name - $message"
}

# 1. Check backend health endpoint
echo -e "${BLUE}[1/5] Checking backend health...${NC}"
HEALTH=$(curl -sf --max-time "$TIMEOUT" "$BASE_URL/health" 2>/dev/null || echo 'connection_failed')
if [[ "$HEALTH" == "connection_failed" ]]; then
    echo -e "${RED}✗${NC} Backend not reachable at $BASE_URL"
    FAILED=1
elif [[ "$HEALTH" == *'healthy'* ]] || [[ "$HEALTH" == *'ok'* ]] || [[ "$HEALTH" == *'OK'* ]]; then
    echo -e "${GREEN}✓${NC} Backend health check passed"
else
    # If no health endpoint, just check if server responds
    HTTP_CODE=$(curl -sf -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT" "$BASE_URL/" 2>/dev/null || echo '000')
    if [[ "$HTTP_CODE" -ge 200 && "$HTTP_CODE" -lt 500 ]]; then
        echo -e "${GREEN}✓${NC} Backend responding (HTTP $HTTP_CODE)"
    else
        echo -e "${RED}✗${NC} Backend not healthy"
        FAILED=1
    fi
fi

# 2. Check slides API
echo -e "${BLUE}[2/5] Checking slides API...${NC}"
SLIDES=$(curl -sf --max-time "$TIMEOUT" "$BASE_URL/api/slides" 2>/dev/null || echo 'failed')
if [[ "$SLIDES" == 'failed' ]]; then
    echo -e "${RED}✗${NC} Slides API not responding"
    FAILED=1
elif [[ "$SLIDES" == '['* ]]; then
    # Count slides (rough estimate)
    SLIDE_COUNT=$(echo "$SLIDES" | grep -o '"id"' | wc -l || echo 0)
    echo -e "${GREEN}✓${NC} Slides API responding ($SLIDE_COUNT slides found)"
else
    warn "Slides API" "Unexpected response format"
fi

# 3. Check default slide endpoint
echo -e "${BLUE}[3/5] Checking default slide endpoint...${NC}"
DEFAULT=$(curl -sf --max-time "$TIMEOUT" "$BASE_URL/api/slides/default" 2>/dev/null || echo 'failed')
if [[ "$DEFAULT" == 'failed' ]]; then
    warn "Default slide" "Not available (may be expected if no slides configured)"
elif [[ "$DEFAULT" == *'"slide_id"'* ]]; then
    echo -e "${GREEN}✓${NC} Default slide endpoint working"
else
    warn "Default slide" "Unexpected response"
fi

# 4. Check frontend
echo -e "${BLUE}[4/5] Checking frontend...${NC}"
FRONTEND=$(curl -sf --max-time "$TIMEOUT" "$FRONTEND_URL/" 2>/dev/null || echo 'failed')
if [[ "$FRONTEND" == 'failed' ]]; then
    # Frontend might be served by the backend in production
    FRONTEND=$(curl -sf --max-time "$TIMEOUT" "$BASE_URL/" 2>/dev/null || echo 'failed')
fi

if [[ "$FRONTEND" == *'<html'* ]] || [[ "$FRONTEND" == *'<!DOCTYPE'* ]] || [[ "$FRONTEND" == *'<!doctype'* ]]; then
    echo -e "${GREEN}✓${NC} Frontend is serving HTML"
else
    echo -e "${RED}✗${NC} Frontend not responding with HTML"
    FAILED=1
fi

# 5. Check WebSocket endpoint (basic connectivity)
echo -e "${BLUE}[5/5] Checking WebSocket endpoint...${NC}"
WS_CODE=$(curl -sf -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT" \
    -H 'Upgrade: websocket' \
    -H 'Connection: Upgrade' \
    -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
    -H 'Sec-WebSocket-Version: 13' \
    "$BASE_URL/ws" 2>/dev/null || echo '000')

if [[ "$WS_CODE" == '101' ]]; then
    echo -e "${GREEN}✓${NC} WebSocket upgrade successful"
elif [[ "$WS_CODE" == '400' ]] || [[ "$WS_CODE" == '426' ]]; then
    echo -e "${GREEN}✓${NC} WebSocket endpoint available (upgrade required)"
elif [[ "$WS_CODE" == '000' ]]; then
    warn "WebSocket" "Connection failed"
else
    warn "WebSocket" "Unexpected response (HTTP $WS_CODE)"
fi

# Summary
echo ""
if [[ $FAILED -eq 0 ]]; then
    echo -e "${GREEN}=== Smoke Test Passed ===${NC}"
    exit 0
else
    echo -e "${RED}=== Smoke Test Failed ===${NC}"
    exit 1
fi
