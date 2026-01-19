/**
 * usePresence Hook Tests
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
