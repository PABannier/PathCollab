/**
 * usePresence Hook Tests
 *
 * Tests for Phase 2 (Collaboration MVP) requirements from IMPLEMENTATION_PLAN.md.
 * Tests are written against the SPECIFICATION, not the implementation.
 * If a test fails, the implementation has a bug (not the test).
 *
 * Phase 2 Requirements Tested:
 * - Cursor tracking at 30Hz (Week 3, Day 1-2)
 * - Coordinate conversion (slide to screen and back)
 * - Throttled updates
 * - Start/stop tracking lifecycle
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePresence } from './usePresence'

// Mock DOMRect-like object for tests
const createMockDOMRect = (x: number, y: number, width: number, height: number): DOMRect =>
  ({
    x,
    y,
    width,
    height,
    top: y,
    left: x,
    right: x + width,
    bottom: y + height,
    toJSON: () => ({ x, y, width, height }),
  }) as DOMRect

describe('usePresence', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /**
   * Phase 2 spec: Default cursor update rate is 30Hz
   * Reference: IMPLEMENTATION_PLAN.md Week 3, Day 1-2
   */
  it('defaults to 30Hz cursor update rate', () => {
    const onCursorUpdate = vi.fn()

    const { result } = renderHook(() =>
      usePresence({
        slideWidth: 10000,
        slideHeight: 10000,
        onCursorUpdate,
      })
    )

    act(() => {
      result.current.startTracking()
      result.current.updateCursorPosition(100, 200)
    })

    // At 30Hz, interval is ~33.33ms
    // First update after ~33ms
    act(() => {
      vi.advanceTimersByTime(34)
    })

    expect(onCursorUpdate).toHaveBeenCalledWith(100, 200)

    // After 1 second, should have ~30 updates
    onCursorUpdate.mockClear()
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    // Allow some tolerance (29-31 updates in 1 second)
    expect(onCursorUpdate.mock.calls.length).toBeGreaterThanOrEqual(29)
    expect(onCursorUpdate.mock.calls.length).toBeLessThanOrEqual(31)

    act(() => {
      result.current.stopTracking()
    })
  })

  /**
   * Phase 2 spec: Custom cursor update rate can be specified
   * Reference: IMPLEMENTATION_PLAN.md Week 3 (configurable)
   */
  it('respects custom cursorUpdateHz setting', () => {
    const onCursorUpdate = vi.fn()

    const { result } = renderHook(() =>
      usePresence({
        slideWidth: 10000,
        slideHeight: 10000,
        onCursorUpdate,
        cursorUpdateHz: 10, // 10 updates per second = 100ms interval
      })
    )

    act(() => {
      result.current.startTracking()
      result.current.updateCursorPosition(100, 200)
    })

    // At 10Hz, interval is 100ms
    act(() => {
      vi.advanceTimersByTime(100)
    })

    expect(onCursorUpdate).toHaveBeenCalledTimes(1)

    // After 1 second at 10Hz, should have ~10 updates
    onCursorUpdate.mockClear()
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(onCursorUpdate.mock.calls.length).toBe(10)

    act(() => {
      result.current.stopTracking()
    })
  })

  /**
   * Phase 2 spec: Cursor updates are throttled
   * Reference: IMPLEMENTATION_PLAN.md Week 3 (performance)
   */
  it('throttles cursor updates to configured rate', () => {
    const onCursorUpdate = vi.fn()

    const { result } = renderHook(() =>
      usePresence({
        slideWidth: 10000,
        slideHeight: 10000,
        onCursorUpdate,
        cursorUpdateHz: 10,
      })
    )

    act(() => {
      result.current.startTracking()
    })

    // Rapid cursor position updates
    for (let i = 0; i < 100; i++) {
      act(() => {
        result.current.updateCursorPosition(i * 10, i * 10)
      })
    }

    // After 500ms at 10Hz, should have exactly 5 updates (throttled)
    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(onCursorUpdate.mock.calls.length).toBe(5)

    act(() => {
      result.current.stopTracking()
    })
  })

  /**
   * Phase 2 spec: Cursor position is latest when update is sent
   * Reference: IMPLEMENTATION_PLAN.md Week 3
   */
  it('sends latest cursor position on each update', () => {
    const onCursorUpdate = vi.fn()

    const { result } = renderHook(() =>
      usePresence({
        slideWidth: 10000,
        slideHeight: 10000,
        onCursorUpdate,
        cursorUpdateHz: 10,
      })
    )

    act(() => {
      result.current.startTracking()
      result.current.updateCursorPosition(100, 100)
    })

    // Wait for first update
    act(() => {
      vi.advanceTimersByTime(100)
    })

    expect(onCursorUpdate).toHaveBeenCalledWith(100, 100)

    // Update position multiple times before next send
    act(() => {
      result.current.updateCursorPosition(200, 200)
      result.current.updateCursorPosition(300, 300)
      result.current.updateCursorPosition(400, 400)
    })

    // Wait for next update
    act(() => {
      vi.advanceTimersByTime(100)
    })

    // Should send latest position (400, 400)
    expect(onCursorUpdate).toHaveBeenLastCalledWith(400, 400)

    act(() => {
      result.current.stopTracking()
    })
  })

  /**
   * Phase 2 spec: Tracking can be started and stopped
   * Reference: IMPLEMENTATION_PLAN.md Week 3
   */
  it('start/stop tracking lifecycle works correctly', () => {
    const onCursorUpdate = vi.fn()

    const { result } = renderHook(() =>
      usePresence({
        slideWidth: 10000,
        slideHeight: 10000,
        onCursorUpdate,
        cursorUpdateHz: 10,
      })
    )

    // Updates should not be sent before starting
    act(() => {
      result.current.updateCursorPosition(100, 100)
      vi.advanceTimersByTime(200)
    })

    expect(onCursorUpdate).not.toHaveBeenCalled()

    // Start tracking
    act(() => {
      result.current.startTracking()
      result.current.updateCursorPosition(100, 100)
      vi.advanceTimersByTime(100)
    })

    expect(onCursorUpdate).toHaveBeenCalled()
    onCursorUpdate.mockClear()

    // Stop tracking
    act(() => {
      result.current.stopTracking()
      result.current.updateCursorPosition(200, 200)
      vi.advanceTimersByTime(200)
    })

    expect(onCursorUpdate).not.toHaveBeenCalled()
  })

  /**
   * Phase 2 spec: No updates sent when disabled
   * Reference: IMPLEMENTATION_PLAN.md Week 3
   */
  it('does not send updates when enabled is false', () => {
    const onCursorUpdate = vi.fn()

    const { result, rerender } = renderHook(
      ({ enabled }) =>
        usePresence({
          slideWidth: 10000,
          slideHeight: 10000,
          onCursorUpdate,
          enabled,
        }),
      { initialProps: { enabled: false } }
    )

    act(() => {
      result.current.startTracking()
      result.current.updateCursorPosition(100, 100)
      vi.advanceTimersByTime(100)
    })

    expect(onCursorUpdate).not.toHaveBeenCalled()

    // Enable and check updates start
    rerender({ enabled: true })

    act(() => {
      vi.advanceTimersByTime(100)
    })

    expect(onCursorUpdate).toHaveBeenCalled()

    act(() => {
      result.current.stopTracking()
    })
  })

  /**
   * Phase 2 spec: Cleanup on unmount
   * Reference: IMPLEMENTATION_PLAN.md (memory management)
   */
  it('cleans up interval on unmount', () => {
    const onCursorUpdate = vi.fn()

    const { result, unmount } = renderHook(() =>
      usePresence({
        slideWidth: 10000,
        slideHeight: 10000,
        onCursorUpdate,
      })
    )

    act(() => {
      result.current.startTracking()
      result.current.updateCursorPosition(100, 100)
    })

    unmount()

    // After unmount, no more updates should be sent
    onCursorUpdate.mockClear()
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(onCursorUpdate).not.toHaveBeenCalled()
  })
})

describe('usePresence coordinate conversion', () => {
  /**
   * Phase 2 spec: Convert client coords to slide coords
   * Reference: IMPLEMENTATION_PLAN.md Week 3 (coordinate systems)
   */
  it('converts center of viewport to center of slide', () => {
    const { result } = renderHook(() =>
      usePresence({
        slideWidth: 10000,
        slideHeight: 10000,
      })
    )

    const viewerBounds = createMockDOMRect(0, 0, 800, 600)
    const viewport = { centerX: 0.5, centerY: 0.5, zoom: 1 }

    // Click at center of viewer (400, 300)
    const coords = result.current.convertToSlideCoords(400, 300, viewerBounds, viewport)

    expect(coords).not.toBeNull()
    // Should be center of slide (5000, 5000)
    expect(coords!.x).toBeCloseTo(5000, 0)
    expect(coords!.y).toBeCloseTo(5000, 0)
  })

  /**
   * Phase 2 spec: Zoom affects coordinate calculation
   * Reference: IMPLEMENTATION_PLAN.md Week 3
   */
  it('accounts for zoom level in coordinate conversion', () => {
    const { result } = renderHook(() =>
      usePresence({
        slideWidth: 10000,
        slideHeight: 10000,
      })
    )

    const viewerBounds = createMockDOMRect(0, 0, 800, 600)

    // At zoom=2, viewport shows half the slide
    // Centered at 0.5, shows 0.25 to 0.75 in X
    const viewport = { centerX: 0.5, centerY: 0.5, zoom: 2 }

    // Click at left edge of viewer
    const leftCoords = result.current.convertToSlideCoords(0, 300, viewerBounds, viewport)

    expect(leftCoords).not.toBeNull()
    // At zoom=2, left edge of viewport = 0.25 normalized = 2500 in slide coords
    expect(leftCoords!.x).toBeCloseTo(2500, 0)
  })

  /**
   * Phase 2 spec: Viewport offset affects coordinate calculation
   * Reference: IMPLEMENTATION_PLAN.md Week 3
   */
  it('accounts for viewport center offset', () => {
    const { result } = renderHook(() =>
      usePresence({
        slideWidth: 10000,
        slideHeight: 10000,
      })
    )

    const viewerBounds = createMockDOMRect(0, 0, 800, 600)

    // Viewport centered at 0.75, 0.75 (bottom-right quadrant)
    const viewport = { centerX: 0.75, centerY: 0.75, zoom: 1 }

    // Click at center of viewer
    const coords = result.current.convertToSlideCoords(400, 300, viewerBounds, viewport)

    expect(coords).not.toBeNull()
    // Should map to viewport center = 0.75 * 10000 = 7500
    expect(coords!.x).toBeCloseTo(7500, 0)
    expect(coords!.y).toBeCloseTo(7500, 0)
  })

  /**
   * Phase 2 spec: Coordinates clamped to slide bounds
   * Reference: IMPLEMENTATION_PLAN.md (edge handling)
   */
  it('clamps coordinates to slide bounds', () => {
    const { result } = renderHook(() =>
      usePresence({
        slideWidth: 10000,
        slideHeight: 10000,
      })
    )

    const viewerBounds = createMockDOMRect(0, 0, 800, 600)

    // Viewport at edge of slide - clicking outside might compute negative
    const viewport = { centerX: 0.1, centerY: 0.1, zoom: 1 }

    // Click at left edge of viewer (would be before slide start)
    const coords = result.current.convertToSlideCoords(0, 0, viewerBounds, viewport)

    expect(coords).not.toBeNull()
    // Should be clamped to 0
    expect(coords!.x).toBeGreaterThanOrEqual(0)
    expect(coords!.y).toBeGreaterThanOrEqual(0)
    expect(coords!.x).toBeLessThanOrEqual(10000)
    expect(coords!.y).toBeLessThanOrEqual(10000)
  })

  /**
   * Phase 2 spec: Returns null for invalid inputs
   * Reference: IMPLEMENTATION_PLAN.md (error handling)
   */
  it('returns null for invalid viewer bounds', () => {
    const { result } = renderHook(() =>
      usePresence({
        slideWidth: 10000,
        slideHeight: 10000,
      })
    )

    const viewport = { centerX: 0.5, centerY: 0.5, zoom: 1 }

    // Null bounds
    expect(
      result.current.convertToSlideCoords(400, 300, null as unknown as DOMRect, viewport)
    ).toBeNull()
  })

  /**
   * Phase 2 spec: Returns null for zero zoom
   * Reference: IMPLEMENTATION_PLAN.md (edge cases)
   */
  it('returns null for zero or negative zoom', () => {
    const { result } = renderHook(() =>
      usePresence({
        slideWidth: 10000,
        slideHeight: 10000,
      })
    )

    const viewerBounds = createMockDOMRect(0, 0, 800, 600)

    expect(
      result.current.convertToSlideCoords(400, 300, viewerBounds, {
        centerX: 0.5,
        centerY: 0.5,
        zoom: 0,
      })
    ).toBeNull()

    expect(
      result.current.convertToSlideCoords(400, 300, viewerBounds, {
        centerX: 0.5,
        centerY: 0.5,
        zoom: -1,
      })
    ).toBeNull()
  })

  /**
   * Phase 2 spec: Aspect ratio handled in conversion
   * Reference: IMPLEMENTATION_PLAN.md (slide dimensions)
   */
  it('handles non-square aspect ratios', () => {
    const { result } = renderHook(() =>
      usePresence({
        slideWidth: 20000, // Wide slide
        slideHeight: 10000,
      })
    )

    const viewerBounds = createMockDOMRect(0, 0, 800, 400) // Wide viewer
    const viewport = { centerX: 0.5, centerY: 0.5, zoom: 1 }

    // Click at center
    const coords = result.current.convertToSlideCoords(400, 200, viewerBounds, viewport)

    expect(coords).not.toBeNull()
    // Center of slide
    expect(coords!.x).toBeCloseTo(10000, 0)
    expect(coords!.y).toBeCloseTo(5000, 0)
  })
})
