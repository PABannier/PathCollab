/**
 * CursorLayer Component Tests
 *
 * Tests for Phase 2 (Collaboration MVP) requirements from IMPLEMENTATION_PLAN.md.
 * Tests are written against the SPECIFICATION, not the implementation.
 * If a test fails, the implementation has a bug (not the test).
 *
 * Phase 2 Requirements Tested:
 * - Cursor rendering (Week 3, Day 1-2)
 * - Cursor position calculation (slide to screen coords)
 * - Presenter indicator (star symbol)
 * - Current user cursor filtered out
 * - Cursors outside viewport not shown
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CursorLayer } from './CursorLayer'

// Mock DOMRect-like object for tests (DOMRect is not available in jsdom)
const createMockDOMRect = (
  x: number,
  y: number,
  width: number,
  height: number
): DOMRect => ({
  x,
  y,
  width,
  height,
  top: y,
  left: x,
  right: x + width,
  bottom: y + height,
  toJSON: () => ({ x, y, width, height }),
})

// Test viewport and bounds
const testViewerBounds = createMockDOMRect(0, 0, 800, 600)
const testViewport = { centerX: 0.5, centerY: 0.5, zoom: 1 }

// Test cursors
const testCursors = [
  {
    participant_id: 'user-1',
    name: 'Alice',
    color: '#EF4444',
    is_presenter: true,
    x: 5000,
    y: 5000,
  },
  {
    participant_id: 'user-2',
    name: 'Bob',
    color: '#10B981',
    is_presenter: false,
    x: 7500,
    y: 2500,
  },
]

describe('CursorLayer', () => {
  /**
   * Phase 2 spec: Cursors are rendered for remote participants
   * Reference: IMPLEMENTATION_PLAN.md Week 3, Day 1-2
   */
  it('renders cursor SVG elements for each participant', () => {
    const { container } = render(
      <CursorLayer
        cursors={testCursors}
        viewerBounds={testViewerBounds}
        viewport={testViewport}
        slideWidth={10000}
        slideHeight={10000}
      />
    )

    // Should render SVG
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()

    // Should render cursor groups for each participant
    const cursorGroups = container.querySelectorAll('g[transform]')
    // Filter to get only top-level cursor groups (those with translate)
    const cursors = Array.from(cursorGroups).filter((g) =>
      g.getAttribute('transform')?.includes('translate(')
    )
    expect(cursors.length).toBeGreaterThanOrEqual(2)
  })

  /**
   * Phase 2 spec: Participant names shown with cursor
   * Reference: IMPLEMENTATION_PLAN.md Week 3, Day 1-2
   */
  it('shows participant names next to cursors', () => {
    render(
      <CursorLayer
        cursors={testCursors}
        viewerBounds={testViewerBounds}
        viewport={testViewport}
        slideWidth={10000}
        slideHeight={10000}
      />
    )

    // Should show participant names
    expect(screen.getByText('Alice', { exact: false })).toBeTruthy()
    expect(screen.getByText('Bob')).toBeTruthy()
  })

  /**
   * Phase 2 spec: Presenter cursor has special indicator
   * Reference: IMPLEMENTATION_PLAN.md Week 3 (presenter identification)
   */
  it('shows presenter indicator (star) for presenter cursor', () => {
    render(
      <CursorLayer
        cursors={testCursors}
        viewerBounds={testViewerBounds}
        viewport={testViewport}
        slideWidth={10000}
        slideHeight={10000}
      />
    )

    // Presenter Alice should have star indicator
    expect(screen.getByText(/★.*Alice/)).toBeTruthy()
    // Non-presenter Bob should not have star
    const bobText = screen.getByText('Bob')
    expect(bobText.textContent).not.toContain('★')
  })

  /**
   * Phase 2 spec: Current user's cursor not shown
   * Reference: IMPLEMENTATION_PLAN.md Week 3
   */
  it('filters out current user cursor', () => {
    render(
      <CursorLayer
        cursors={testCursors}
        viewerBounds={testViewerBounds}
        viewport={testViewport}
        slideWidth={10000}
        slideHeight={10000}
        currentUserId="user-1"
      />
    )

    // Alice (current user) should be filtered out
    expect(screen.queryByText(/Alice/)).toBeNull()
    // Bob should still be shown
    expect(screen.getByText('Bob')).toBeTruthy()
  })

  /**
   * Phase 2 spec: Cursors use participant color
   * Reference: IMPLEMENTATION_PLAN.md Section 4.4
   */
  it('uses participant color for cursor styling', () => {
    const { container } = render(
      <CursorLayer
        cursors={[testCursors[1]]} // Just Bob
        viewerBounds={testViewerBounds}
        viewport={testViewport}
        slideWidth={10000}
        slideHeight={10000}
      />
    )

    // Find cursor path and check fill color
    const path = container.querySelector('path')
    expect(path).toBeTruthy()
    expect(path?.getAttribute('fill')).toBe('#10B981')
  })

  /**
   * Phase 2 spec: Cursors outside viewport not rendered
   * Reference: IMPLEMENTATION_PLAN.md Week 3 (performance)
   */
  it('does not render cursors outside viewport', () => {
    const outsideCursor = {
      participant_id: 'user-3',
      name: 'Charlie',
      color: '#F59E0B',
      is_presenter: false,
      x: 1000, // At 0.1 normalized - outside viewport centered at 0.5
      y: 1000,
    }

    // Viewport with zoom=2 means viewport width = 0.5
    // centerX=0.5 means viewport covers 0.25 to 0.75
    // Cursor at x=1000 = 0.1 normalized is outside
    render(
      <CursorLayer
        cursors={[outsideCursor]}
        viewerBounds={testViewerBounds}
        viewport={{ centerX: 0.5, centerY: 0.5, zoom: 2 }}
        slideWidth={10000}
        slideHeight={10000}
      />
    )

    // Charlie should not be visible
    expect(screen.queryByText('Charlie')).toBeNull()
  })

  /**
   * Phase 2 spec: Returns null when no viewer bounds
   * Reference: IMPLEMENTATION_PLAN.md (graceful handling)
   */
  it('returns null when viewerBounds is null', () => {
    const { container } = render(
      <CursorLayer
        cursors={testCursors}
        viewerBounds={null}
        viewport={testViewport}
        slideWidth={10000}
        slideHeight={10000}
      />
    )

    expect(container.firstChild).toBeNull()
  })

  /**
   * Phase 2 spec: Handles empty cursors array
   * Reference: IMPLEMENTATION_PLAN.md (no participants)
   */
  it('renders empty SVG with no cursors', () => {
    const { container } = render(
      <CursorLayer
        cursors={[]}
        viewerBounds={testViewerBounds}
        viewport={testViewport}
        slideWidth={10000}
        slideHeight={10000}
      />
    )

    // SVG should still render but be empty
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    expect(svg?.children.length).toBe(0)
  })

  /**
   * Phase 2 spec: Invalid zoom handled gracefully
   * Reference: IMPLEMENTATION_PLAN.md (edge cases)
   */
  it('handles zero or negative zoom gracefully', () => {
    const { container } = render(
      <CursorLayer
        cursors={testCursors}
        viewerBounds={testViewerBounds}
        viewport={{ centerX: 0.5, centerY: 0.5, zoom: 0 }}
        slideWidth={10000}
        slideHeight={10000}
      />
    )

    // Should not crash, should render empty
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    expect(svg?.querySelectorAll('g[transform]').length).toBe(0)
  })
})

describe('CursorLayer coordinate calculations', () => {
  /**
   * Phase 2 spec: Cursor at center of viewport is centered on screen
   * Reference: IMPLEMENTATION_PLAN.md Week 3 (coordinate systems)
   */
  it('positions cursor at center when in center of viewport', () => {
    const centerCursor = {
      participant_id: 'user-1',
      name: 'Center',
      color: '#3B82F6',
      is_presenter: false,
      x: 5000, // 0.5 normalized in 10000 width slide
      y: 5000, // 0.5 normalized in 10000 height slide
    }

    const { container } = render(
      <CursorLayer
        cursors={[centerCursor]}
        viewerBounds={testViewerBounds} // 800x600
        viewport={{ centerX: 0.5, centerY: 0.5, zoom: 1 }}
        slideWidth={10000}
        slideHeight={10000}
      />
    )

    // Find the cursor group with transform
    const groups = container.querySelectorAll('g[transform]')
    const cursorGroup = Array.from(groups).find((g) => {
      const transform = g.getAttribute('transform')
      return transform?.startsWith('translate(')
    })

    expect(cursorGroup).toBeTruthy()

    // Parse transform to get position
    const transform = cursorGroup?.getAttribute('transform') || ''
    const match = transform.match(/translate\(([^,]+),\s*([^)]+)\)/)

    if (match) {
      const x = parseFloat(match[1])
      const y = parseFloat(match[2])
      // Should be approximately centered (400, 300 for 800x600 bounds)
      expect(x).toBeCloseTo(400, 0)
      expect(y).toBeCloseTo(300, 0)
    }
  })

  /**
   * Phase 2 spec: Cursor position updates with viewport zoom
   * Reference: IMPLEMENTATION_PLAN.md Week 3 (zoom affects visible cursors)
   */
  it('cursor visible at different zoom levels', () => {
    const cursor = {
      participant_id: 'user-1',
      name: 'Test',
      color: '#3B82F6',
      is_presenter: false,
      x: 6000, // 0.6 normalized
      y: 5000, // 0.5 normalized
    }

    // At zoom=1, cursor at 0.6 is within viewport (0-1)
    const { rerender } = render(
      <CursorLayer
        cursors={[cursor]}
        viewerBounds={testViewerBounds}
        viewport={{ centerX: 0.5, centerY: 0.5, zoom: 1 }}
        slideWidth={10000}
        slideHeight={10000}
      />
    )

    expect(screen.getByText('Test')).toBeTruthy()

    // At zoom=4, viewport is 0.25 wide, centered at 0.5 = 0.375 to 0.625
    // Cursor at 0.6 is within this range
    rerender(
      <CursorLayer
        cursors={[cursor]}
        viewerBounds={testViewerBounds}
        viewport={{ centerX: 0.5, centerY: 0.5, zoom: 4 }}
        slideWidth={10000}
        slideHeight={10000}
      />
    )

    expect(screen.getByText('Test')).toBeTruthy()
  })

  /**
   * Phase 2 spec: Aspect ratio preserved in coordinate calculation
   * Reference: IMPLEMENTATION_PLAN.md (slide dimensions)
   */
  it('handles non-square aspect ratios correctly', () => {
    const cursor = {
      participant_id: 'user-1',
      name: 'AspectTest',
      color: '#3B82F6',
      is_presenter: false,
      x: 10000, // Right side of a wide slide
      y: 2500, // Center height
    }

    render(
      <CursorLayer
        cursors={[cursor]}
        viewerBounds={testViewerBounds}
        viewport={{ centerX: 0.5, centerY: 0.5, zoom: 0.5 }} // Wide viewport
        slideWidth={20000} // Wide slide
        slideHeight={5000}
      />
    )

    // Cursor at normalized (0.5, 0.5) should be visible
    expect(screen.getByText('AspectTest')).toBeTruthy()
  })
})
