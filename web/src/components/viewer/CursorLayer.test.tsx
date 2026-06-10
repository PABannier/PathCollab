/**
 * CursorLayer Component Tests
 *
 * CursorLayer now projects slide-pixel coords to screen via an injected
 * `slideToScreen` (fovea's camera transform), so these tests drive a mock
 * transform rather than the old OpenSeadragon-normalized math.
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CursorLayer } from './CursorLayer'

// Mock DOMRect-like object for tests (DOMRect is not available in jsdom)
const createMockDOMRect = (x: number, y: number, width: number, height: number): DOMRect => ({
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

const testViewerBounds = createMockDOMRect(0, 0, 800, 600)
const testViewport = { centerX: 0.5, centerY: 0.5, zoom: 1 }

// Linear mock transform: slide (5000,5000) -> screen (400,300) (center of 800x600).
const mockSlideToScreen = (x: number, y: number) => ({ x: x * 0.08, y: y * 0.06 })

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
  it('renders cursor SVG elements for each participant', () => {
    const { container } = render(
      <CursorLayer
        cursors={testCursors}
        viewerBounds={testViewerBounds}
        viewport={testViewport}
        slideToScreen={mockSlideToScreen}
      />
    )

    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()

    const cursorGroups = Array.from(container.querySelectorAll('g[transform]')).filter((g) =>
      g.getAttribute('transform')?.includes('translate(')
    )
    expect(cursorGroups.length).toBeGreaterThanOrEqual(2)
  })

  it('shows participant names next to cursors', () => {
    render(
      <CursorLayer
        cursors={testCursors}
        viewerBounds={testViewerBounds}
        viewport={testViewport}
        slideToScreen={mockSlideToScreen}
      />
    )

    expect(screen.getByText('Alice', { exact: false })).toBeTruthy()
    expect(screen.getByText('Bob')).toBeTruthy()
  })

  it('shows presenter indicator (star) for presenter cursor', () => {
    render(
      <CursorLayer
        cursors={testCursors}
        viewerBounds={testViewerBounds}
        viewport={testViewport}
        slideToScreen={mockSlideToScreen}
      />
    )

    expect(screen.getByText(/★.*Alice/)).toBeTruthy()
    expect(screen.getByText('Bob').textContent).not.toContain('★')
  })

  it('filters out current user cursor', () => {
    render(
      <CursorLayer
        cursors={testCursors}
        viewerBounds={testViewerBounds}
        viewport={testViewport}
        slideToScreen={mockSlideToScreen}
        currentUserId="user-1"
      />
    )

    expect(screen.queryByText(/Alice/)).toBeNull()
    expect(screen.getByText('Bob')).toBeTruthy()
  })

  it('uses participant color for cursor styling', () => {
    const { container } = render(
      <CursorLayer
        cursors={[testCursors[1]]}
        viewerBounds={testViewerBounds}
        viewport={testViewport}
        slideToScreen={mockSlideToScreen}
      />
    )

    const path = container.querySelector('path')
    expect(path?.getAttribute('fill')).toBe('#10B981')
  })

  it('does not render cursors projected outside the canvas', () => {
    const outsideCursor = {
      participant_id: 'user-3',
      name: 'Charlie',
      color: '#F59E0B',
      is_presenter: false,
      x: 20000, // -> screen x = 1600, well beyond 800 + margin
      y: 0,
    }

    render(
      <CursorLayer
        cursors={[outsideCursor]}
        viewerBounds={testViewerBounds}
        viewport={testViewport}
        slideToScreen={mockSlideToScreen}
      />
    )

    expect(screen.queryByText('Charlie')).toBeNull()
  })

  it('does not render cursors when slideToScreen returns null (engine not ready)', () => {
    render(
      <CursorLayer
        cursors={testCursors}
        viewerBounds={testViewerBounds}
        viewport={testViewport}
        slideToScreen={() => null}
      />
    )

    expect(screen.queryByText('Bob')).toBeNull()
  })

  it('returns null when viewerBounds is null', () => {
    const { container } = render(
      <CursorLayer
        cursors={testCursors}
        viewerBounds={null}
        viewport={testViewport}
        slideToScreen={mockSlideToScreen}
      />
    )

    expect(container.firstChild).toBeNull()
  })

  it('renders empty SVG with no cursors', () => {
    const { container } = render(
      <CursorLayer
        cursors={[]}
        viewerBounds={testViewerBounds}
        viewport={testViewport}
        slideToScreen={mockSlideToScreen}
      />
    )

    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    expect(svg?.children.length).toBe(0)
  })
})

describe('CursorLayer coordinate calculations', () => {
  it('positions cursor at the screen point returned by slideToScreen', () => {
    const centerCursor = {
      participant_id: 'user-1',
      name: 'Center',
      color: '#3B82F6',
      is_presenter: false,
      x: 5000,
      y: 5000,
    }

    const { container } = render(
      <CursorLayer
        cursors={[centerCursor]}
        viewerBounds={testViewerBounds}
        viewport={testViewport}
        slideToScreen={mockSlideToScreen}
      />
    )

    const cursorGroup = Array.from(container.querySelectorAll('g[transform]')).find((g) =>
      g.getAttribute('transform')?.startsWith('translate(')
    )
    const transform = cursorGroup?.getAttribute('transform') || ''
    const match = transform.match(/translate\(([^,]+),\s*([^)]+)\)/)
    expect(match).toBeTruthy()
    if (match) {
      expect(parseFloat(match[1])).toBeCloseTo(400, 0)
      expect(parseFloat(match[2])).toBeCloseTo(300, 0)
    }
  })
})
