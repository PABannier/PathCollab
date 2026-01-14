#!/bin/bash
# Format both frontend and backend code

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
CHECK_ONLY=false
if [[ "$1" == "--check" ]]; then
    CHECK_ONLY=true
fi

if $CHECK_ONLY; then
    echo -e "${BLUE}Checking code formatting...${NC}"
else
    echo -e "${BLUE}Formatting code...${NC}"
fi
echo

# Frontend format
echo -e "${BLUE}[1/2] Frontend (TypeScript/React)...${NC}"
cd "$PROJECT_ROOT/web"
if $CHECK_ONLY; then
    if bun run format:check; then
        echo -e "${GREEN}Frontend format check passed${NC}"
    else
        echo -e "${RED}Frontend format check failed - run ./scripts/format.sh to fix${NC}"
        exit 1
    fi
else
    bun run format
    echo -e "${GREEN}Frontend formatted${NC}"
fi
echo

# Backend format
echo -e "${BLUE}[2/2] Backend (Rust)...${NC}"
cd "$PROJECT_ROOT/server"
if $CHECK_ONLY; then
    if cargo fmt -- --check; then
        echo -e "${GREEN}Backend format check passed${NC}"
    else
        echo -e "${RED}Backend format check failed - run ./scripts/format.sh to fix${NC}"
        exit 1
    fi
else
    cargo fmt
    echo -e "${GREEN}Backend formatted${NC}"
fi
echo

if $CHECK_ONLY; then
    echo -e "${GREEN}All format checks passed!${NC}"
else
    echo -e "${GREEN}All code formatted!${NC}"
fi
