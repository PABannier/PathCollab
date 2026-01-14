#!/bin/bash
# Lint both frontend and backend

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Running lint checks...${NC}"
echo

# Frontend lint
echo -e "${BLUE}[1/2] Linting frontend (TypeScript/React)...${NC}"
cd "$PROJECT_ROOT/web"
if bun run lint; then
    echo -e "${GREEN}Frontend lint passed${NC}"
else
    echo -e "${RED}Frontend lint failed${NC}"
    exit 1
fi
echo

# Backend lint
echo -e "${BLUE}[2/2] Linting backend (Rust)...${NC}"
cd "$PROJECT_ROOT/server"
if cargo clippy -- -D warnings 2>&1; then
    echo -e "${GREEN}Backend lint passed${NC}"
else
    echo -e "${RED}Backend lint failed${NC}"
    exit 1
fi
echo

echo -e "${GREEN}All lint checks passed!${NC}"
