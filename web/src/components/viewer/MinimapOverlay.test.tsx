/**
 * MinimapOverlay Component Tests
 *
 * Tests for Phase 1 (Core Viewing) requirements from IMPLEMENTATION_PLAN.md.
 * Tests are written against the SPECIFICATION, not the implementation.
 * If a test fails, the implementation has a bug (not the test).
 *
 * Phase 1 Requirements Tested:
 * - Navigator overlay (bottom-right position) - IMPLEMENTATION_PLAN.md Week 1, Day 5
 * - Current viewport indicator
 * - Presenter viewport rectangle for followers
 * - Cursor dots on minimap
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MinimapOverlay } from './MinimapOverlay'

// Test viewport data
const testPresenterViewport = {
  centerX: 0.5,
  centerY: 0.5,
  zoom: 2.0,
}

const testCurrentViewport = {
  centerX: 0.3,
  centerY: 0.4,
  zoom: 1.5,
}

const testPresenterInfo = {
  id: 'presenter-1',
  name: 'Dr. Smith',
  color: '#3B82F6',
}

const testCursors = [
  { participant_id: 'user-1', name: 'Alice', color: '#EF4444', x: 0.3, y: 0.4 },
  { participant_id: 'user-2', name: 'Bob', color: '#10B981', x: 0.7, y: 0.6 },
]

describe('MinimapOverlay', () => {
  /**
   * Phase 1 spec: Followers see presenter's viewport on minimap
   * Reference: IMPLEMENTATION_PLAN.md Week 1, Day 5 (viewport indicator)
   */
  it('renders presenter viewport rectangle for followers', () => {
    render(
      <MinimapOverlay
        presenterViewport={testPresenterViewport}
        presenterInfo={testPresenterInfo}
        currentViewport={testCurrentViewport}
        minimapWidth={200}
        minimapHeight={200}
        slideAspectRatio={1}
        isPresenter={false}
      />
    )

    // Should show "Presenter" label
    expect(screen.getByText('Presenter')).toBeTruthy()
  })

  /**
   * Phase 1 spec: Presenter does NOT see their own viewport rectangle
   * Reference: IMPLEMENTATION_PLAN.md Week 1, Day 5
   */
  it('does not render viewport rectangle when isPresenter is true', () => {
    render(
      <MinimapOverlay
        presenterViewport={testPresenterViewport}
        presenterInfo={testPresenterInfo}
        currentViewport={testCurrentViewport}
        minimapWidth={200}
        minimapHeight={200}
        slideAspectRatio={1}
        isPresenter={true}
      />
    )

    // Should NOT show "Presenter" label since they are the presenter
    expect(screen.queryByText('Presenter')).toBeNull()
  })

  /**
   * Phase 1 spec: Viewport rectangle position is calculated correctly
   * Reference: IMPLEMENTATION_PLAN.md Week 1, Day 5 (real-time updates)
   */
  it('calculates correct viewport rectangle coordinates', () => {
    // With zoom=2, viewport width = 1/2 = 0.5
    // With center at (0.5, 0.5), left edge = 0.25, top edge = 0.25
    // In 200px minimap: x = 50, y = 50, width = 100, height = 100
    const { container } = render(
      <MinimapOverlay
        presenterViewport={testPresenterViewport}
        presenterInfo={testPresenterInfo}
        currentViewport={testCurrentViewport}
        minimapWidth={200}
        minimapHeight={200}
        slideAspectRatio={1}
        isPresenter={false}
      />
    )

    // Find the viewport rectangle (has border-2 class)
    const rect = container.querySelector('.border-2')
    expect(rect).toBeTruthy()

    // Check computed styles
    const style = rect?.getAttribute('style') || ''
    expect(style).toContain('left: 50')
    expect(style).toContain('top: 50')
    expect(style).toContain('width: 100')
    expect(style).toContain('height: 100')
  })

  /**
   * Phase 1 spec: Viewport rectangle uses presenter's color
   * Reference: IMPLEMENTATION_PLAN.md Section 4.4 (12-color palette)
   */
  it('uses presenter color for viewport rectangle', () => {
    const { container } = render(
      <MinimapOverlay
        presenterViewport={testPresenterViewport}
        presenterInfo={{ ...testPresenterInfo, color: '#EF4444' }}
        currentViewport={testCurrentViewport}
        minimapWidth={200}
        minimapHeight={200}
        slideAspectRatio={1}
        isPresenter={false}
      />
    )

    const rect = container.querySelector('.border-2')
    const style = rect?.getAttribute('style') || ''
    expect(style).toContain('border-color: rgb(239, 68, 68)') // #EF4444
  })

  /**
   * Phase 1 spec: Cursor dots shown on minimap
   * Reference: IMPLEMENTATION_PLAN.md Week 2 (cursor sync)
   */
  it('renders cursor dots for participants', () => {
    const { container } = render(
      <MinimapOverlay
        presenterViewport={null}
        currentViewport={testCurrentViewport}
        minimapWidth={200}
        minimapHeight={200}
        slideAspectRatio={1}
        isPresenter={true}
        cursors={testCursors}
      />
    )

    // Find cursor dots (rounded-full class)
    const cursorDots = container.querySelectorAll('.rounded-full')
    expect(cursorDots.length).toBe(2)
  })

  /**
   * Phase 1 spec: Current user's cursor is filtered out
   * Reference: IMPLEMENTATION_PLAN.md (don't show own cursor)
   */
  it('filters out current user cursor from minimap', () => {
    const { container } = render(
      <MinimapOverlay
        presenterViewport={null}
        currentViewport={testCurrentViewport}
        minimapWidth={200}
        minimapHeight={200}
        slideAspectRatio={1}
        isPresenter={true}
        cursors={testCursors}
        currentUserId="user-1" // Alice should be filtered
      />
    )

    // Only Bob's cursor should be shown
    const cursorDots = container.querySelectorAll('.rounded-full')
    expect(cursorDots.length).toBe(1)

    // Bob's title should be present
    const bobCursor = container.querySelector('[title="Bob"]')
    expect(bobCursor).toBeTruthy()
  })

  /**
   * Phase 1 spec: Cursor positions mapped to minimap coordinates
   * Reference: IMPLEMENTATION_PLAN.md Week 2 (coordinate systems)
   */
  it('calculates correct cursor positions in minimap', () => {
    // Cursor at (0.3, 0.4) normalized should be at (60, 80) in 200x200 minimap
    const { container } = render(
      <MinimapOverlay
        presenterViewport={null}
        currentViewport={testCurrentViewport}
        minimapWidth={200}
        minimapHeight={200}
        slideAspectRatio={1}
        isPresenter={true}
        cursors={[testCursors[0]]} // Just Alice
      />
    )

    const cursor = container.querySelector('[title="Alice"]')
    expect(cursor).toBeTruthy()

    const style = cursor?.getAttribute('style') || ''
    expect(style).toContain('left: 60')
    expect(style).toContain('top: 80')
  })

  /**
   * Phase 1 spec: Nothing renders when no data to show
   * Reference: IMPLEMENTATION_PLAN.md (performance)
   */
  it('returns null when nothing to display', () => {
    const { container } = render(
      <MinimapOverlay
        presenterViewport={null}
        currentViewport={testCurrentViewport}
        minimapWidth={200}
        minimapHeight={200}
        slideAspectRatio={1}
        isPresenter={true}
        cursors={[]}
      />
    )

    // Container should have no children (component returns null)
    expect(container.firstChild).toBeNull()
  })

  /**
   * Phase 1 spec: Minimap container has correct dimensions
   * Reference: IMPLEMENTATION_PLAN.md Week 1, Day 5
   */
  it('container matches specified minimap dimensions', () => {
    const { container } = render(
      <MinimapOverlay
        presenterViewport={testPresenterViewport}
        presenterInfo={testPresenterInfo}
        currentViewport={testCurrentViewport}
        minimapWidth={150}
        minimapHeight={100}
        slideAspectRatio={1.5}
        isPresenter={false}
      />
    )

    // Find the overlay container
    const overlay = container.firstChild as HTMLElement
    expect(overlay).toBeTruthy()
    expect(overlay.style.width).toBe('150px')
    expect(overlay.style.height).toBe('100px')
  })

  /**
   * Phase 1 spec: Aspect ratio affects viewport calculation
   * Reference: IMPLEMENTATION_PLAN.md (slide dimensions)
   */
  it('accounts for slide aspect ratio in viewport calculation', () => {
    // With aspectRatio=2, viewport height = width / 2
    // zoom=2 -> vpWidth=0.5, vpHeight=0.25
    // centerY=0.5 -> top = 0.375, in 200px = 75px
    const { container } = render(
      <MinimapOverlay
        presenterViewport={{ centerX: 0.5, centerY: 0.5, zoom: 2 }}
        presenterInfo={testPresenterInfo}
        currentViewport={testCurrentViewport}
        minimapWidth={200}
        minimapHeight={200}
        slideAspectRatio={2}
        isPresenter={false}
      />
    )

    const rect = container.querySelector('.border-2')
    const style = rect?.getAttribute('style') || ''

    // Height should be half of width due to aspect ratio
    expect(style).toContain('height: 50')
    expect(style).toContain('width: 100')
  })
})

describe('MinimapOverlay coordinate calculations', () => {
  /**
   * Phase 1 spec: Viewport at edge cases
   * Reference: IMPLEMENTATION_PLAN.md (viewport constraints)
   */
  it('handles viewport at top-left edge', () => {
    const { container } = render(
      <MinimapOverlay
        presenterViewport={{ centerX: 0.25, centerY: 0.25, zoom: 2 }}
        presenterInfo={testPresenterInfo}
        currentViewport={testCurrentViewport}
        minimapWidth={200}
        minimapHeight={200}
        slideAspectRatio={1}
        isPresenter={false}
      />
    )

    const rect = container.querySelector('.border-2')
    const style = rect?.getAttribute('style') || ''
    // left = 0.25 - 0.25 = 0, should be clamped to 0
    expect(style).toContain('left: 0')
    expect(style).toContain('top: 0')
  })

  /**
   * Phase 1 spec: Minimap shows participant names on hover
   * Reference: IMPLEMENTATION_PLAN.md (participant info)
   */
  it('cursor dots have title attribute with participant name', () => {
    render(
      <MinimapOverlay
        presenterViewport={null}
        currentViewport={testCurrentViewport}
        minimapWidth={200}
        minimapHeight={200}
        slideAspectRatio={1}
        isPresenter={true}
        cursors={testCursors}
      />
    )

    // Check title attributes
    expect(screen.getByTitle('Alice')).toBeTruthy()
    expect(screen.getByTitle('Bob')).toBeTruthy()
  })

  /**
   * Phase 1 spec: Viewport rectangle has presenter name tooltip
   * Reference: IMPLEMENTATION_PLAN.md (presenter info)
   */
  it('viewport rectangle has presenter name in title', () => {
    const { container } = render(
      <MinimapOverlay
        presenterViewport={testPresenterViewport}
        presenterInfo={testPresenterInfo}
        currentViewport={testCurrentViewport}
        minimapWidth={200}
        minimapHeight={200}
        slideAspectRatio={1}
        isPresenter={false}
      />
    )

    const rect = container.querySelector('[title*="Dr. Smith"]')
    expect(rect).toBeTruthy()
  })
})
