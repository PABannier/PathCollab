# Testing Guide

This document describes the testing infrastructure and how to run tests for PathCollab.

## Test Overview

PathCollab has three levels of testing:

| Type | Tool | Location | Count |
|------|------|----------|-------|
| Backend Unit Tests | Cargo test | `server/src/**/*.rs` | 14 |
| Backend Integration Tests | Cargo test | `server/tests/*.rs` | 24 |
| Frontend Unit Tests | Vitest | `web/src/**/*.test.ts` | 34 |
| E2E Tests | Playwright | `web/e2e/*.spec.ts` | Scaffolded |

**Total: 72+ tests**

## Running Tests

### Backend Tests

```bash
# Run all backend tests
cd server
cargo test

# Run with verbose output
cargo test --verbose

# Run specific test
cargo test test_create_session

# Run tests with logging
RUST_LOG=debug cargo test -- --nocapture
```

### Frontend Tests

```bash
# Run all frontend tests
cd web
bun run test:run

# Run in watch mode
bun run test

# Run with coverage
bun run test:coverage

# Run with UI
bun run test:ui
```

### E2E Tests

```bash
# Install Playwright browsers (first time only)
cd web
bun run test:e2e:install

# Run E2E tests (requires servers running)
bun run test:e2e

# Run with UI
bun run test:e2e:ui
```

## Test Structure

### Backend

```
server/
├── src/
│   ├── session/
│   │   ├── state.rs         # Unit tests for session state
│   │   └── manager.rs       # Unit tests for session manager
│   ├── overlay/
│   │   ├── parser.rs        # Unit tests for protobuf parsing
│   │   ├── index.rs         # Unit tests for spatial index
│   │   └── derive.rs        # Unit tests for tile derivation
│   └── lib.rs               # Library exports
└── tests/
    ├── common/mod.rs        # Shared test utilities
    └── integration.rs       # Integration tests
```

### Frontend

```
web/
├── src/
│   ├── hooks/
│   │   ├── useWebSocket.test.ts  # WebSocket hook tests
│   │   └── useSession.test.ts    # Session hook tests
│   └── test/
│       ├── setup.ts              # Vitest setup
│       ├── fixtures.ts           # Test data factories
│       └── utils.tsx             # Test utilities
└── e2e/
    ├── smoke.spec.ts             # Smoke tests
    └── session.spec.ts           # Session flow tests
```

## Test Utilities

### Backend

The `server/tests/common/mod.rs` module provides:

- `create_test_app()` - Creates a test router with all routes
- `create_test_slide_info()` - Creates mock slide data
- `init_test_logging()` - Enables test logging

### Frontend

The `web/src/test/utils.tsx` module provides:

- `renderWithProviders()` - Renders components with Router context
- `installMockWebSocket()` - Mocks WebSocket for testing
- `installMockFetch()` - Mocks fetch API
- `createMockWebSocket()` - Creates controllable WebSocket mock
- Event helpers for pointer, mouse, and keyboard events

The `web/src/test/fixtures.ts` module provides:

- `mockSession`, `mockPresenter`, `mockFollower1/2` - Session fixtures
- `mockViewport`, `mockLayerVisibility` - State fixtures
- `mockCursors`, `mockCellClasses` - Overlay fixtures
- Factory functions for creating custom test data

## Writing Tests

### Backend Unit Test Example

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_example() {
        let result = my_function(42);
        assert_eq!(result, expected_value);
    }

    #[tokio::test]
    async fn test_async_example() {
        let result = my_async_function().await;
        assert!(result.is_ok());
    }
}
```

### Frontend Unit Test Example

```typescript
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMyHook } from './useMyHook'

describe('useMyHook', () => {
  it('should return expected value', () => {
    const { result } = renderHook(() => useMyHook())
    expect(result.current.value).toBe('expected')
  })
})
```

### E2E Test Example

```typescript
import { test, expect } from '@playwright/test'

test('user can create session', async ({ page }) => {
  await page.goto('http://localhost:5173')
  await page.click('[data-testid="create-session"]')
  await expect(page).toHaveURL(/\/session\//)
})
```

## CI/CD

Tests run automatically on:
- Push to `main` or `develop`
- Pull requests to `main` or `develop`

The CI workflow (`.github/workflows/test.yml`) runs:
1. Backend tests with clippy linting
2. Frontend tests with coverage
3. E2E tests with Playwright
4. ESLint for code quality

## Coverage

### Backend Coverage

```bash
cargo install cargo-tarpaulin
cargo tarpaulin --out html
```

### Frontend Coverage

```bash
bun run test:coverage
# Report generated in web/coverage/
```

## Debugging Tests

### Backend

```bash
# Run with full backtrace
RUST_BACKTRACE=full cargo test

# Run single test with output
cargo test test_name -- --nocapture
```

### Frontend

```bash
# Run with browser debugging
bun run test:ui

# Run specific test file
bunx vitest run src/hooks/useSession.test.ts
```

### E2E

```bash
# Run with headed browser
bunx playwright test --headed

# Run with debug mode
bunx playwright test --debug

# Run specific test
bunx playwright test smoke.spec.ts
```

## Best Practices

1. **Isolate tests**: Each test should be independent
2. **Use fixtures**: Reuse test data from fixtures
3. **Mock external deps**: Mock WebSocket, fetch, etc.
4. **Test behavior**: Focus on user-facing behavior
5. **Keep tests fast**: Use unit tests for logic, E2E for critical paths
6. **Document skipped tests**: Add comments for `test.skip()`
