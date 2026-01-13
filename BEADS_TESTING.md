# PathCollab Testing Beads

## Executive Summary

Current test coverage is critically incomplete:
- **Backend:** 11 unit tests across 5 modules (55% module coverage), no integration tests
- **Frontend:** Zero tests, no test framework installed

This document defines comprehensive testing beads to achieve rock-solid coverage before Phase 4 polish.

---

## Bead Dependency Graph

```
                                    ┌─────────────────────────────────────┐
                                    │     BEAD-T0: Test Infrastructure    │
                                    │         (Foundation Layer)          │
                                    └─────────────────┬───────────────────┘
                                                      │
                          ┌───────────────────────────┼───────────────────────────┐
                          │                           │                           │
                          ▼                           ▼                           ▼
              ┌───────────────────┐      ┌───────────────────┐      ┌───────────────────┐
              │   BEAD-T1        │      │   BEAD-T2        │      │   BEAD-T3        │
              │ Backend Unit     │      │ Frontend Unit    │      │ Test Fixtures    │
              │   Tests          │      │   Tests          │      │ & Utilities      │
              └────────┬──────────┘      └────────┬──────────┘      └────────┬──────────┘
                       │                          │                          │
                       │                          │                          │
                       ▼                          ▼                          │
              ┌───────────────────┐      ┌───────────────────┐               │
              │   BEAD-T4        │      │   BEAD-T5        │               │
              │ Backend          │      │ Frontend         │               │
              │ Integration      │◄─────│ Component        │◄──────────────┘
              │   Tests          │      │   Tests          │
              └────────┬──────────┘      └────────┬──────────┘
                       │                          │
                       │                          │
                       └──────────┬───────────────┘
                                  │
                                  ▼
                       ┌───────────────────┐
                       │   BEAD-T6        │
                       │ End-to-End       │
                       │   Tests          │
                       └────────┬──────────┘
                                │
                                ▼
                       ┌───────────────────┐
                       │   BEAD-T7        │
                       │ CI/CD Pipeline   │
                       │   Integration    │
                       └──────────────────┘
```

---

## BEAD-T0: Test Infrastructure Foundation

**Priority:** P0 (Blocker for all other test beads)
**Estimated Effort:** 4-6 hours
**Dependencies:** None

### Description
Set up the foundational test infrastructure for both backend and frontend. This includes
installing test frameworks, configuring test runners, and establishing project conventions.

### Subtasks

#### T0.1: Frontend Test Framework Setup
**File:** `web/package.json`, `web/vitest.config.ts`
```
# Install Vitest (fastest for Vite projects) + React Testing Library + jsdom
# Why Vitest: Native Vite integration, same config, fast HMR for tests
# Why jsdom: Lightweight DOM simulation for component tests
# Why React Testing Library: Best practices for testing React components

Dependencies to add:
- vitest (test runner)
- @testing-library/react (component testing)
- @testing-library/jest-dom (DOM matchers)
- @testing-library/user-event (user interaction simulation)
- jsdom (browser environment simulation)
- @vitest/coverage-v8 (coverage reporting)
```

**Acceptance Criteria:**
- [ ] `bun run test` executes Vitest
- [ ] `bun run test:coverage` generates coverage report
- [ ] Vitest configured with jsdom environment
- [ ] React Testing Library available for imports
- [ ] Test files pattern: `**/*.test.{ts,tsx}`

#### T0.2: Backend Test Utilities Module
**File:** `server/src/test_utils.rs`
```
# Create centralized test utilities module
# Why: Avoid duplication across test files, ensure consistent test data

Contents:
- TestContext struct (holds test fixtures)
- Async test helpers for WebSocket testing
- HTTP client helpers for route testing
- Logging configuration for test output
```

**Acceptance Criteria:**
- [ ] `test_utils` module compiles
- [ ] Exported via `#[cfg(test)]` only
- [ ] Documentation for each helper function

#### T0.3: Test Logging Configuration
**Files:** `server/src/test_utils.rs`, `web/vitest.setup.ts`
```
# Configure detailed logging for test runs
# Why: Essential for debugging test failures, especially in CI

Backend:
- Use tracing-subscriber with TEST filter
- Output to stdout with timestamps
- Include span context for async tests

Frontend:
- Console mocking for clean output
- Error boundary logging
- Network request logging for debugging
```

**Acceptance Criteria:**
- [ ] Test output shows clear pass/fail with context
- [ ] Failed tests show relevant debug info
- [ ] Logging doesn't pollute successful test output

#### T0.4: CI Pipeline Test Integration Skeleton
**File:** `.github/workflows/ci.yml`
```
# Add test execution steps (initially may fail until tests written)
# Why: Ensure tests run on every PR from the start

Add steps:
- Backend: cargo test --all-features
- Frontend: bun run test
- Coverage: upload to codecov (optional)
```

**Acceptance Criteria:**
- [ ] CI runs backend tests
- [ ] CI runs frontend tests (once T0.1 complete)
- [ ] Test failures block PR merge

---

## BEAD-T1: Backend Unit Tests

**Priority:** P1
**Estimated Effort:** 8-12 hours
**Dependencies:** BEAD-T0

### Description
Complete unit test coverage for all Rust modules. Focus on testing logic in isolation
without external dependencies (no network, no filesystem).

### Current Coverage Gaps

| Module | Current Tests | Missing Tests |
|--------|---------------|---------------|
| `overlay/parser.rs` | 2 | Edge cases, error paths |
| `overlay/derive.rs` | 2 | Color mapping, empty data |
| `overlay/index.rs` | 3 | Edge cases, large datasets |
| `overlay/types.rs` | 0 | Error Display, conversions |
| `overlay/routes.rs` | 0 | Request validation |
| `session/state.rs` | 4 | State transitions |
| `session/manager.rs` | 3 | Cleanup, timeouts |
| `protocol/messages.rs` | 0 | Serialization |
| `server/websocket.rs` | 0 | Message routing |

### Subtasks

#### T1.1: Overlay Parser Edge Cases
**File:** `server/src/overlay/parser.rs`
```
# Additional tests for parser robustness
# Why: Parser handles untrusted input - must be bulletproof

New tests:
- test_parse_empty_file() - Empty input handling
- test_parse_oversized_file() - Exceeds MAX_OVERLAY_SIZE_BYTES
- test_parse_too_many_cells() - Exceeds MAX_CELLS limit
- test_parse_too_many_tiles() - Exceeds MAX_TILES limit
- test_parse_invalid_protobuf() - Malformed protobuf data
- test_parse_missing_required_fields() - Partial protobuf
- test_parse_cell_class_bounds() - Class IDs 0-14 only
- test_parse_tissue_class_bounds() - Class IDs 0-7 only
```

**Acceptance Criteria:**
- [ ] All error paths have dedicated tests
- [ ] Tests verify exact error types returned
- [ ] No panics on malformed input

#### T1.2: Overlay Derive Pipeline Tests
**File:** `server/src/overlay/derive.rs`
```
# Tests for tile generation and color mapping
# Why: Raster tiles must be pixel-perfect for correct visualization

New tests:
- test_derive_empty_input() - No cells/tiles produces empty output
- test_tissue_color_mapping() - Each class ID maps to correct RGB
- test_cell_color_mapping() - Each class ID maps to correct RGB
- test_raster_tile_boundaries() - Cells at tile edges handled correctly
- test_vector_chunk_cell_distribution() - Cells assigned to correct chunks
- test_manifest_accuracy() - Manifest counts match actual data
- test_content_hash_determinism() - Same input = same SHA256
```

**Acceptance Criteria:**
- [ ] Color mapping is exact (test RGB values)
- [ ] Tile boundaries don't cause off-by-one errors
- [ ] SHA256 is deterministic

#### T1.3: Overlay Index Spatial Queries
**File:** `server/src/overlay/index.rs`
```
# Tests for spatial query correctness
# Why: Incorrect queries = missing or duplicate cells in viewer

New tests:
- test_viewport_query_empty() - Empty index returns empty results
- test_viewport_query_partial_overlap() - Cells partially in viewport
- test_viewport_query_exact_boundary() - Cell exactly on viewport edge
- test_viewport_query_large_dataset() - 100K+ cells, verify performance
- test_tile_query_nonexistent_level() - Query invalid pyramid level
- test_tile_query_out_of_bounds() - Tile coordinates beyond grid
- test_query_limit_enforcement() - Respects max results limit
```

**Acceptance Criteria:**
- [ ] Boundary conditions explicitly tested
- [ ] Large dataset test completes in < 100ms
- [ ] No cells missed or duplicated

#### T1.4: Protocol Message Serialization
**File:** `server/src/protocol/messages.rs` (add tests module)
```
# Tests for JSON serialization round-trips
# Why: Protocol messages are the contract between client/server

New tests:
- test_client_message_deserialize_*() - Each ClientMessage variant
- test_server_message_serialize_*() - Each ServerMessage variant
- test_unknown_message_type() - Graceful handling of unknown types
- test_missing_required_field() - Each message with missing fields
- test_extra_fields_ignored() - Forward compatibility
- test_special_characters_escaped() - Unicode in names, etc.
```

**Acceptance Criteria:**
- [ ] Every message type has serialize/deserialize test
- [ ] Malformed JSON doesn't panic
- [ ] Round-trip preserves all data

#### T1.5: Session State Machine Tests
**File:** `server/src/session/state.rs`
```
# Tests for session lifecycle state transitions
# Why: State bugs cause session corruption, user confusion

New tests:
- test_state_active_to_presenter_disconnected()
- test_state_presenter_disconnected_timeout()
- test_state_presenter_reconnect_within_grace()
- test_state_expired_cannot_transition()
- test_participant_add_at_max_capacity()
- test_participant_remove_presenter()
- test_color_assignment_wraparound() - More than 12 participants
- test_name_uniqueness() - No duplicate names in session
```

**Acceptance Criteria:**
- [ ] All state transitions explicitly tested
- [ ] Invalid transitions return errors (not panic)
- [ ] Grace period timing is accurate

#### T1.6: Session Manager Lifecycle Tests
**File:** `server/src/session/manager.rs`
```
# Tests for session CRUD and cleanup
# Why: Memory leaks, orphan sessions if cleanup fails

New tests:
- test_create_session_generates_unique_ids()
- test_create_session_concurrent() - Race condition safety
- test_join_session_after_expiry()
- test_join_session_while_locked()
- test_cleanup_expired_sessions()
- test_cleanup_preserves_active_sessions()
- test_get_session_not_found()
- test_broadcast_to_nonexistent_session()
```

**Acceptance Criteria:**
- [ ] Concurrent operations don't corrupt state
- [ ] Cleanup removes only expired sessions
- [ ] All error conditions have tests

#### T1.7: WebSocket Message Handler Tests
**File:** `server/src/server/websocket.rs` (add tests module)
```
# Tests for message routing and validation
# Why: WebSocket is the critical path - bugs affect all users

New tests:
- test_handle_cursor_update_valid()
- test_handle_cursor_update_out_of_bounds()
- test_handle_viewport_update_valid()
- test_handle_viewport_update_invalid_zoom()
- test_handle_create_session()
- test_handle_join_session_success()
- test_handle_join_session_wrong_secret()
- test_handle_presenter_only_action_as_follower()
- test_rate_limiting() - Exceeds message rate
- test_malformed_json_message()
```

**Note:** These tests will use mock connections (channels) rather than real WebSockets.
The integration tests (BEAD-T4) will test real WebSocket connections.

**Acceptance Criteria:**
- [ ] All message types have handler tests
- [ ] Authorization checks verified
- [ ] Rate limiting enforced

#### T1.8: HTTP Route Handler Tests
**File:** `server/src/overlay/routes.rs` (add tests module)
```
# Tests for HTTP endpoints (unit level - no real HTTP)
# Why: API contract must be stable and well-defined

New tests:
- test_upload_overlay_success()
- test_upload_overlay_no_session()
- test_upload_overlay_too_large()
- test_upload_overlay_invalid_protobuf()
- test_get_manifest_success()
- test_get_manifest_not_found()
- test_get_raster_tile_success()
- test_get_raster_tile_not_found()
- test_get_vector_chunk_success()
- test_get_vector_chunk_not_found()
- test_query_viewport_success()
- test_query_viewport_invalid_params()
```

**Note:** Use axum::test helpers for request/response testing without HTTP server.

**Acceptance Criteria:**
- [ ] All endpoints have success and error tests
- [ ] Response formats match API spec
- [ ] Content-Type headers correct

---

## BEAD-T2: Frontend Unit Tests

**Priority:** P1
**Estimated Effort:** 10-14 hours
**Dependencies:** BEAD-T0

### Description
Unit tests for React hooks and utility functions. These tests run in isolation
with mocked dependencies (WebSocket, fetch, etc.).

### Subtasks

#### T2.1: useWebSocket Hook Tests
**File:** `web/src/hooks/useWebSocket.test.ts`
```
# Tests for WebSocket connection management
# Why: WebSocket is foundation of all real-time features

Tests:
- test_connects_on_mount()
- test_disconnects_on_unmount()
- test_reconnects_on_close()
- test_exponential_backoff()
- test_max_reconnect_attempts()
- test_sends_message_when_connected()
- test_queues_message_when_disconnected()
- test_flushes_queue_on_reconnect()
- test_calls_onMessage_handler()
- test_calls_onStatusChange_handler()
- test_ping_pong_keepalive()

Mocking:
- Mock WebSocket class
- Mock timers for backoff testing
```

**Acceptance Criteria:**
- [ ] All connection states tested
- [ ] Reconnection logic verified
- [ ] Message queue behavior correct

#### T2.2: useSession Hook Tests
**File:** `web/src/hooks/useSession.test.ts`
```
# Tests for session state management
# Why: Session hook orchestrates all collaboration features

Tests:
- test_initial_state()
- test_create_session_sends_message()
- test_join_session_sends_message()
- test_handles_session_created()
- test_handles_session_joined()
- test_handles_participant_joined()
- test_handles_participant_left()
- test_handles_presence_delta()
- test_handles_presenter_viewport()
- test_handles_layer_state()
- test_handles_overlay_loaded()
- test_handles_session_error()
- test_handles_session_ended()
- test_update_cursor_sends_message()
- test_update_viewport_sends_message()
- test_snap_to_presenter()

Mocking:
- Mock useWebSocket return value
```

**Acceptance Criteria:**
- [ ] All message handlers tested
- [ ] State updates are correct
- [ ] No stale closures

#### T2.3: usePresence Hook Tests
**File:** `web/src/hooks/usePresence.test.ts`
```
# Tests for cursor tracking and coordinate conversion
# Why: Incorrect coordinates = cursors in wrong positions

Tests:
- test_starts_tracking_on_enable()
- test_stops_tracking_on_disable()
- test_throttles_cursor_updates()
- test_converts_screen_to_slide_coords()
- test_converts_slide_to_screen_coords()
- test_handles_viewport_changes()
- test_respects_cursor_update_hz()
- test_cleanup_on_unmount()

Mocking:
- Mock window events
- Mock requestAnimationFrame
```

**Acceptance Criteria:**
- [ ] Coordinate conversion is accurate
- [ ] Throttling works correctly
- [ ] No memory leaks (event listeners cleaned up)

#### T2.4: Utility Function Tests
**File:** `web/src/lib/*.test.ts`
```
# Tests for pure utility functions
# Why: Utilities are used everywhere - bugs cascade

Tests for colors.ts (if exists):
- test_hex_to_rgba()
- test_participant_color_assignment()

Tests for any coordinate utils:
- test_normalize_viewport()
- test_viewport_to_tile_coords()
```

**Acceptance Criteria:**
- [ ] All exported functions tested
- [ ] Edge cases covered (zero, negative, very large values)

---

## BEAD-T3: Test Fixtures & Utilities

**Priority:** P1
**Estimated Effort:** 4-6 hours
**Dependencies:** BEAD-T0

### Description
Create reusable test data and helper functions to reduce duplication
and ensure consistent test scenarios.

### Subtasks

#### T3.1: Backend Test Fixtures
**File:** `server/src/test_utils/fixtures.rs`
```
# Reusable test data for Rust tests
# Why: Consistent test data makes tests readable and maintainable

Fixtures:
- VALID_SESSION_ID: &str = "k3m9p2qdx7"
- VALID_JOIN_SECRET: &str (128-bit hex)
- VALID_PRESENTER_KEY: &str (192-bit hex)
- create_test_session() -> Session
- create_test_participant(role: Role) -> Participant
- create_test_slide() -> SlideInfo
- create_test_overlay_data(cells: usize, tiles: usize) -> ParsedOverlayData
- create_test_protobuf_bytes() -> Vec<u8>
- create_test_viewport(zoom: f32) -> Viewport
```

**Acceptance Criteria:**
- [ ] All fixtures documented
- [ ] Fixtures produce valid data (pass validation)
- [ ] Easy to customize for specific tests

#### T3.2: Frontend Test Fixtures
**File:** `web/src/test/fixtures.ts`
```
# Reusable test data for React tests
# Why: Same reasons as backend - consistency and readability

Fixtures:
- mockSession: SessionState
- mockParticipant: Participant
- mockCursors: CursorWithParticipant[]
- mockSlide: SlideInfo
- mockViewport: Viewport
- mockCellClasses: CellClass[]
- mockTissueClasses: TissueClass[]
- mockOverlayCells: CellPolygon[]

Factory functions:
- createMockSession(overrides?)
- createMockParticipant(overrides?)
- createMockWebSocket()
```

**Acceptance Criteria:**
- [ ] TypeScript types are correct
- [ ] Factories allow easy customization
- [ ] Mock WebSocket supports spy/assertion

#### T3.3: Frontend Test Utilities
**File:** `web/src/test/utils.tsx`
```
# Helper functions for React component tests
# Why: Reduce boilerplate, ensure proper test setup

Utilities:
- renderWithProviders(ui, options) - Wraps in Router, etc.
- createMockWebSocketContext()
- mockFetch(responses) - Setup fetch mock
- waitForWebSocket() - Wait for WS connection in tests
- mockViewerBounds() - Standard DOMRect
- mockPointerEvent(x, y) - Create pointer events
```

**Acceptance Criteria:**
- [ ] Works with React Testing Library
- [ ] Reduces test boilerplate significantly
- [ ] Properly cleans up after each test

#### T3.4: Test Data Generators
**File:** `server/src/test_utils/generators.rs`, `web/src/test/generators.ts`
```
# Functions to generate randomized but valid test data
# Why: Property-based testing, fuzzing, stress tests

Backend generators:
- generate_random_cells(count: usize) -> Vec<Cell>
- generate_random_protobuf(size: usize) -> Vec<u8>
- generate_random_session_id() -> String

Frontend generators:
- generateRandomCells(count: number): CellPolygon[]
- generateRandomViewport(): Viewport
- generateRandomCursors(count: number): Cursor[]
```

**Acceptance Criteria:**
- [ ] Generated data passes validation
- [ ] Reproducible with seed (for debugging)
- [ ] Configurable parameters

---

## BEAD-T4: Backend Integration Tests

**Priority:** P2
**Estimated Effort:** 12-16 hours
**Dependencies:** BEAD-T1, BEAD-T3

### Description
Integration tests that verify complete workflows with real components
(actual WebSocket connections, HTTP requests, in-memory state).

### Subtasks

#### T4.1: WebSocket Integration Test Harness
**File:** `server/tests/websocket_integration.rs`
```
# Test harness for WebSocket integration tests
# Why: Need to test actual WebSocket behavior, not just message handling

Harness components:
- TestServer: Spawns actual server on random port
- TestClient: Connects via WebSocket, sends/receives messages
- Assertions: Helper methods for common assertions
- Cleanup: Automatic server shutdown after test

# Example usage:
#[tokio::test]
async fn test_session_workflow() {
    let server = TestServer::spawn().await;
    let client = server.connect().await;

    client.send(CreateSession { slide_id: "demo" }).await;
    let response = client.receive::<SessionCreated>().await;

    assert!(response.session.id.len() == 10);
}
```

**Acceptance Criteria:**
- [ ] Server starts/stops cleanly
- [ ] Clients connect reliably
- [ ] Tests are isolated (no port conflicts)

#### T4.2: Session Lifecycle Integration Tests
**File:** `server/tests/session_lifecycle.rs`
```
# End-to-end session workflow tests
# Why: Verify complete user journeys work correctly

Tests:
- test_create_and_join_session()
  1. Client A creates session
  2. Client A receives session_created with secrets
  3. Client B joins with join_secret
  4. Client B receives session_joined
  5. Client A receives participant_joined

- test_presenter_disconnect_grace_period()
  1. Create session
  2. Join as follower
  3. Presenter disconnects
  4. Verify followers receive notification
  5. Presenter reconnects within 30s
  6. Verify session continues

- test_session_expiry()
  1. Create session
  2. Wait for expiry (mock time)
  3. Verify session cleaned up
  4. Verify join fails after expiry

- test_max_participants()
  1. Create session
  2. Join 20 followers
  3. 21st join attempt rejected
```

**Acceptance Criteria:**
- [ ] All lifecycle states tested
- [ ] Timing-dependent tests use mocked time
- [ ] Concurrent operations tested

#### T4.3: Presence System Integration Tests
**File:** `server/tests/presence_integration.rs`
```
# Tests for cursor and viewport synchronization
# Why: Presence is core feature - must work correctly

Tests:
- test_cursor_broadcast()
  1. Create session with 3 participants
  2. Participant A sends cursor update
  3. Participants B and C receive presence_delta
  4. Verify cursor position in delta

- test_viewport_broadcast_presenter_only()
  1. Create session
  2. Presenter sends viewport update
  3. Followers receive presenter_viewport
  4. Follower sends viewport update
  5. Verify presenter doesn't receive it

- test_cursor_throttling()
  1. Send 100 cursor updates rapidly
  2. Verify server throttles appropriately
  3. Verify latest position is correct
```

**Acceptance Criteria:**
- [ ] Broadcast reaches all participants
- [ ] Throttling works correctly
- [ ] No message loss under load

#### T4.4: Overlay Upload Integration Tests
**File:** `server/tests/overlay_integration.rs`
```
# Tests for overlay upload and serving
# Why: Overlay is primary differentiator - must work end-to-end

Tests:
- test_upload_and_serve_overlay()
  1. Create session
  2. Upload valid protobuf via HTTP POST
  3. Verify overlay_loaded broadcast
  4. Fetch manifest via HTTP GET
  5. Fetch raster tile via HTTP GET
  6. Fetch vector chunk via HTTP GET
  7. Verify data integrity

- test_upload_invalid_protobuf()
  1. Create session
  2. Upload invalid data
  3. Verify error response
  4. Verify no overlay_loaded broadcast

- test_upload_to_invalid_session()
  1. Upload without session
  2. Verify rejection

- test_concurrent_uploads()
  1. Upload 2 overlays simultaneously
  2. Verify both succeed
  3. Verify correct overlay IDs
```

**Acceptance Criteria:**
- [ ] Full upload-to-serve workflow tested
- [ ] Error cases handled gracefully
- [ ] Data integrity verified (SHA256)

#### T4.5: HTTP API Integration Tests
**File:** `server/tests/http_integration.rs`
```
# Tests for HTTP endpoints with real HTTP client
# Why: Verify API contract works over actual HTTP

Tests:
- test_health_endpoint()
- test_overlay_routes_require_valid_session()
- test_cors_headers()
- test_content_type_headers()
- test_error_response_format()
- test_large_payload_handling()
```

**Acceptance Criteria:**
- [ ] All routes return correct status codes
- [ ] Headers are correct
- [ ] Error responses follow spec

---

## BEAD-T5: Frontend Component Tests

**Priority:** P2
**Estimated Effort:** 14-18 hours
**Dependencies:** BEAD-T2, BEAD-T3

### Description
Component tests using React Testing Library. Focus on user interactions
and component behavior, not implementation details.

### Subtasks

#### T5.1: SlideViewer Component Tests
**File:** `web/src/components/viewer/SlideViewer.test.tsx`
```
# Tests for OpenSeadragon wrapper
# Why: Core viewing component - must render correctly

Tests:
- test_renders_without_crashing()
- test_initializes_openseadragon()
- test_loads_tile_source_from_props()
- test_calls_onViewportChange()
- test_shows_loading_indicator()
- test_shows_tile_error_count()
- test_keyboard_shortcuts_work()
- test_minimap_visibility()
- test_cleanup_on_unmount()

Challenges:
- OpenSeadragon creates canvas - may need to mock
- Test viewport events without real mouse input
```

**Acceptance Criteria:**
- [ ] Component renders without errors
- [ ] Props are passed to OpenSeadragon
- [ ] Callbacks fire correctly

#### T5.2: OverlayCanvas Component Tests
**File:** `web/src/components/viewer/OverlayCanvas.test.tsx`
```
# Tests for WebGL cell rendering
# Why: Complex WebGL code - easy to introduce regressions

Tests:
- test_renders_when_enabled()
- test_hidden_when_disabled()
- test_creates_webgl_context()
- test_handles_webgl_not_supported()
- test_updates_on_cells_change()
- test_updates_on_viewport_change()
- test_respects_visible_classes()
- test_applies_opacity()
- test_cleans_up_webgl_resources()

Challenges:
- WebGL context may need mocking in jsdom
- Consider using @vitest/browser for real WebGL tests
```

**Acceptance Criteria:**
- [ ] Renders without WebGL errors
- [ ] Properly cleans up GPU resources
- [ ] Respects visibility settings

#### T5.3: LayerPanel Component Tests
**File:** `web/src/components/viewer/LayerPanel.test.tsx`
```
# Tests for layer control UI
# Why: User-facing controls - must be intuitive and correct

Tests:
- test_renders_collapsed_by_default()
- test_expands_on_click()
- test_tissue_toggle_calls_callback()
- test_tissue_opacity_slider()
- test_tissue_class_checkboxes()
- test_cell_toggle_calls_callback()
- test_cell_opacity_slider()
- test_cell_class_checkboxes()
- test_select_all_classes()
- test_select_none_classes()
- test_hover_toggle()

Using:
- @testing-library/user-event for interactions
```

**Acceptance Criteria:**
- [ ] All controls work correctly
- [ ] Callbacks receive correct values
- [ ] Accessible (keyboard navigation)

#### T5.4: CursorLayer Component Tests
**File:** `web/src/components/viewer/CursorLayer.test.tsx`
```
# Tests for cursor rendering
# Why: Cursors show presence - must be accurate

Tests:
- test_renders_cursors_for_other_users()
- test_excludes_current_user_cursor()
- test_positions_cursors_correctly()
- test_shows_participant_names()
- test_uses_participant_colors()
- test_hides_cursors_outside_viewport()
- test_updates_on_cursor_change()
```

**Acceptance Criteria:**
- [ ] Cursors render at correct positions
- [ ] Colors and names are correct
- [ ] Performance with many cursors

#### T5.5: CellTooltip Component Tests
**File:** `web/src/components/viewer/CellTooltip.test.tsx`
```
# Tests for cell hover tooltip
# Why: Interactive feature - must be responsive and accurate

Tests:
- test_shows_tooltip_on_hover_near_cell()
- test_hides_tooltip_when_not_near_cell()
- test_displays_correct_class_name()
- test_displays_confidence_percentage()
- test_positions_tooltip_correctly()
- test_respects_enabled_prop()
- test_updates_on_mouse_move()
- test_performance_with_many_cells()
```

**Acceptance Criteria:**
- [ ] Tooltip appears within 50ms
- [ ] Shows correct cell information
- [ ] Doesn't cause performance issues

#### T5.6: OverlayUploader Component Tests
**File:** `web/src/components/upload/OverlayUploader.test.tsx`
```
# Tests for file upload UI
# Why: Data entry point - must handle all cases

Tests:
- test_renders_upload_button()
- test_opens_file_picker_on_click()
- test_accepts_pb_files_only()
- test_rejects_oversized_files()
- test_shows_progress_during_upload()
- test_shows_success_state()
- test_shows_error_state()
- test_calls_onUploadComplete()
- test_calls_onError()
- test_drag_and_drop_works()

Mocking:
- Mock fetch for upload request
- Mock FileReader for file reading
```

**Acceptance Criteria:**
- [ ] File validation works
- [ ] Progress updates correctly
- [ ] Error handling is user-friendly

#### T5.7: Session Page Integration Tests
**File:** `web/src/pages/Session.test.tsx`
```
# Tests for main session page
# Why: Orchestrates all components - must integrate correctly

Tests:
- test_renders_slide_viewer()
- test_shows_connection_status()
- test_shows_create_session_button_when_not_in_session()
- test_hides_create_button_when_in_session()
- test_shows_share_button_in_session()
- test_shows_participant_count()
- test_shows_presenter_badge_when_presenter()
- test_shows_snap_to_presenter_for_followers()
- test_shows_upload_button_for_presenter()
- test_shows_layer_panel_when_overlay_loaded()
```

**Acceptance Criteria:**
- [ ] All conditional rendering works
- [ ] Components receive correct props
- [ ] No console errors

---

## BEAD-T6: End-to-End Tests

**Priority:** P2
**Estimated Effort:** 16-20 hours
**Dependencies:** BEAD-T4, BEAD-T5

### Description
Full end-to-end tests using Playwright. Test complete user journeys
in real browsers with real network requests.

### Subtasks

#### T6.1: Playwright Setup
**Files:** `web/playwright.config.ts`, `web/package.json`
```
# Configure Playwright for E2E testing
# Why: Real browser testing catches issues unit tests miss

Configuration:
- Browsers: Chromium, Firefox, WebKit
- Base URL: http://localhost:5173 (dev) or test server
- Screenshots on failure
- Video recording for debugging
- Trace collection for debugging
- Parallel execution for speed
```

**Acceptance Criteria:**
- [ ] `bun run test:e2e` executes Playwright
- [ ] Tests run in CI (headless)
- [ ] Artifacts saved on failure

#### T6.2: Test Server Setup
**File:** `web/e2e/setup/test-server.ts`
```
# Script to start backend + frontend for E2E tests
# Why: E2E tests need full stack running

Setup:
- Start Rust backend on test port
- Start Vite dev server (or preview build)
- Wait for servers to be ready
- Teardown after tests complete
```

**Acceptance Criteria:**
- [ ] Servers start reliably
- [ ] Ports don't conflict with dev
- [ ] Clean shutdown

#### T6.3: Session Creation E2E Test
**File:** `web/e2e/session-creation.spec.ts`
```
# Test complete session creation flow
# Why: Core user journey - must work flawlessly

Steps:
1. Navigate to home page
2. Click "Create Session" or navigate to /s/new
3. Wait for session to be created
4. Verify URL contains session ID
5. Verify presenter badge visible
6. Verify share button enabled
7. Copy share link
8. Verify link format is correct

Assertions:
- Session ID in URL matches format
- WebSocket connected (green indicator)
- Can pan/zoom slide
```

**Acceptance Criteria:**
- [ ] Test passes in all browsers
- [ ] Takes < 10 seconds
- [ ] Screenshots on failure

#### T6.4: Session Join E2E Test
**File:** `web/e2e/session-join.spec.ts`
```
# Test follower joining session
# Why: Collaboration requires joining - must be seamless

Steps:
1. Create session in browser A
2. Copy share link
3. Open link in browser B (new context)
4. Wait for session join
5. Verify follower sees slide
6. Verify follower sees "Follow Presenter" button
7. Verify presenter sees participant count increase

Assertions:
- Both browsers connected
- Same slide visible
- Participant list accurate
```

**Acceptance Criteria:**
- [ ] Multi-browser test works
- [ ] Join is < 3 seconds
- [ ] No race conditions

#### T6.5: Cursor Presence E2E Test
**File:** `web/e2e/cursor-presence.spec.ts`
```
# Test cursor synchronization
# Why: Presence is key differentiator

Steps:
1. Create session, join with second browser
2. Move cursor in browser A
3. Verify cursor appears in browser B
4. Verify cursor has correct color
5. Verify cursor has correct name label
6. Move cursor in browser B
7. Verify cursor appears in browser A

Assertions:
- Cursor latency < 200ms
- Position is accurate (within 5px)
- Name and color match
```

**Acceptance Criteria:**
- [ ] Cursors sync bidirectionally
- [ ] Latency is acceptable
- [ ] Visual appearance correct

#### T6.6: Viewport Sync E2E Test
**File:** `web/e2e/viewport-sync.spec.ts`
```
# Test viewport synchronization
# Why: Following presenter is core feature

Steps:
1. Create session, join with follower
2. Presenter zooms in
3. Verify presenter viewport indicator on follower's minimap
4. Click "Follow Presenter" in follower
5. Verify follower viewport matches presenter
6. Presenter pans
7. Verify follower viewport indicator updates

Assertions:
- Viewport indicator appears on minimap
- Snap animation is smooth
- Viewport matches after snap
```

**Acceptance Criteria:**
- [ ] Viewport indicator visible
- [ ] Snap works correctly
- [ ] Animation is smooth

#### T6.7: Overlay Upload E2E Test
**File:** `web/e2e/overlay-upload.spec.ts`
```
# Test overlay upload and rendering
# Why: Primary feature - must work end-to-end

Prerequisites:
- Test protobuf file in e2e/fixtures/

Steps:
1. Create session as presenter
2. Click upload button
3. Select test protobuf file
4. Wait for upload to complete
5. Verify success notification
6. Verify layer panel appears
7. Verify cells visible on slide
8. Toggle cell visibility
9. Verify cells hide/show
10. Join as follower
11. Verify follower sees overlay

Assertions:
- Upload completes without error
- Cells render correctly
- Visibility syncs to followers
```

**Acceptance Criteria:**
- [ ] Upload works with test file
- [ ] Rendering is correct
- [ ] Sync works for followers

#### T6.8: Layer Controls E2E Test
**File:** `web/e2e/layer-controls.spec.ts`
```
# Test layer panel functionality
# Why: User controls must be intuitive

Steps:
1. Create session with overlay
2. Expand layer panel
3. Toggle tissue heatmap
4. Adjust tissue opacity
5. Toggle individual tissue classes
6. Toggle cell polygons
7. Adjust cell opacity
8. Toggle individual cell classes
9. Toggle cell hover
10. Hover over cell
11. Verify tooltip appears

Assertions:
- All toggles work
- Opacity changes visual
- Hover tooltip shows
```

**Acceptance Criteria:**
- [ ] All controls functional
- [ ] Changes are immediate
- [ ] Tooltip works

#### T6.9: Error Handling E2E Test
**File:** `web/e2e/error-handling.spec.ts`
```
# Test graceful error handling
# Why: Users must not see crashes

Steps:
1. Navigate to invalid session ID
2. Verify error message shown
3. Navigate to expired session
4. Verify appropriate message
5. Simulate network disconnect
6. Verify reconnection attempt
7. Verify reconnection success
8. Upload invalid file
9. Verify error message

Assertions:
- No uncaught exceptions
- User-friendly messages
- Recovery works
```

**Acceptance Criteria:**
- [ ] All error cases handled
- [ ] No console errors
- [ ] Recovery is automatic

#### T6.10: Performance E2E Test
**File:** `web/e2e/performance.spec.ts`
```
# Test performance under load
# Why: Must handle real-world usage

Steps:
1. Create session with large overlay
2. Pan/zoom rapidly
3. Measure frame rate
4. Create session with 10 participants
5. All move cursors simultaneously
6. Measure cursor update latency
7. Verify no dropped frames

Assertions:
- Frame rate > 30fps during pan
- Cursor latency < 150ms
- No memory leaks (heap growth)

Note: Use Playwright's tracing and metrics APIs
```

**Acceptance Criteria:**
- [ ] Performance budgets met
- [ ] No regressions vs baseline
- [ ] Memory stable over time

---

## BEAD-T7: CI/CD Pipeline Integration

**Priority:** P2
**Estimated Effort:** 4-6 hours
**Dependencies:** BEAD-T4, BEAD-T6

### Description
Integrate all tests into CI/CD pipeline with proper reporting,
caching, and failure handling.

### Subtasks

#### T7.1: Backend CI Configuration
**File:** `.github/workflows/ci.yml`
```yaml
# Enhanced backend test job
backend-test:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4

    - name: Setup Rust
      uses: dtolnay/rust-toolchain@stable

    - name: Cache cargo
      uses: Swatinem/rust-cache@v2

    - name: Run unit tests
      run: cargo test --lib --all-features
      working-directory: server

    - name: Run integration tests
      run: cargo test --test '*' --all-features
      working-directory: server

    - name: Generate coverage report
      run: cargo tarpaulin --out Xml
      working-directory: server

    - name: Upload coverage
      uses: codecov/codecov-action@v3
```

**Acceptance Criteria:**
- [ ] All tests run in CI
- [ ] Coverage reported
- [ ] Failures block merge

#### T7.2: Frontend CI Configuration
**File:** `.github/workflows/ci.yml`
```yaml
# Frontend test job
frontend-test:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4

    - name: Setup Bun
      uses: oven-sh/setup-bun@v1

    - name: Install dependencies
      run: bun install --frozen-lockfile
      working-directory: web

    - name: Run unit tests
      run: bun run test --coverage
      working-directory: web

    - name: Upload coverage
      uses: codecov/codecov-action@v3
```

**Acceptance Criteria:**
- [ ] Unit tests run in CI
- [ ] Coverage reported
- [ ] Caching works

#### T7.3: E2E CI Configuration
**File:** `.github/workflows/ci.yml`
```yaml
# E2E test job (runs after unit tests pass)
e2e-test:
  needs: [backend-test, frontend-test]
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4

    - name: Setup Bun
      uses: oven-sh/setup-bun@v1

    - name: Setup Rust
      uses: dtolnay/rust-toolchain@stable

    - name: Build backend
      run: cargo build --release
      working-directory: server

    - name: Install frontend deps
      run: bun install --frozen-lockfile
      working-directory: web

    - name: Install Playwright browsers
      run: bunx playwright install --with-deps
      working-directory: web

    - name: Run E2E tests
      run: bun run test:e2e
      working-directory: web

    - name: Upload test artifacts
      uses: actions/upload-artifact@v3
      if: failure()
      with:
        name: playwright-report
        path: web/playwright-report/
```

**Acceptance Criteria:**
- [ ] E2E tests run after unit tests
- [ ] Artifacts uploaded on failure
- [ ] Reasonable timeout (< 15 min)

#### T7.4: Test Reporting
**File:** `.github/workflows/ci.yml`
```yaml
# Add test result reporting
- name: Publish Test Results
  uses: dorny/test-reporter@v1
  if: always()
  with:
    name: Test Results
    path: '**/test-results.xml'
    reporter: java-junit
```

**Acceptance Criteria:**
- [ ] Test results visible in PR
- [ ] Failed tests highlighted
- [ ] History tracked

---

## Summary

### Total Estimated Effort

| Bead | Effort | Priority |
|------|--------|----------|
| T0: Infrastructure | 4-6 hrs | P0 |
| T1: Backend Unit | 8-12 hrs | P1 |
| T2: Frontend Unit | 10-14 hrs | P1 |
| T3: Fixtures | 4-6 hrs | P1 |
| T4: Backend Integration | 12-16 hrs | P2 |
| T5: Frontend Component | 14-18 hrs | P2 |
| T6: E2E Tests | 16-20 hrs | P2 |
| T7: CI/CD | 4-6 hrs | P2 |
| **Total** | **72-98 hrs** | |

### Execution Order

```
Week 1: Foundation (P0 + P1)
├── T0: Test Infrastructure (4-6 hrs)
├── T1: Backend Unit Tests (8-12 hrs)
├── T2: Frontend Unit Tests (10-14 hrs)
└── T3: Test Fixtures (4-6 hrs)

Week 2: Integration (P2)
├── T4: Backend Integration Tests (12-16 hrs)
├── T5: Frontend Component Tests (14-18 hrs)
└── T7.1-T7.2: Basic CI (2-3 hrs)

Week 3: E2E + Polish (P2)
├── T6: E2E Tests (16-20 hrs)
└── T7.3-T7.4: Full CI (2-3 hrs)
```

### Success Metrics

- **Backend Coverage:** > 80% line coverage
- **Frontend Coverage:** > 70% line coverage
- **E2E Coverage:** All critical user journeys
- **CI Time:** < 15 minutes total
- **Flakiness:** < 1% flaky test rate
