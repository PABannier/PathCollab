/**
 * MinimapOverlay Component Tests
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

    // Check computed styles - uses transform for GPU-accelerated positioning
    const style = rect?.getAttribute('style') || ''
    expect(style).toContain('transform: translate(50px, 50px)')
    expect(style).toContain('width: 100')
    expect(style).toContain('height: 100')
  })

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

  it('calculates correct cursor positions in minimap', () => {
    // Cursor at (0.3, 0.4) normalized should be at (60, 80) in 200x200 minimap
    // With centering offset of -4px: translate(56px, 76px)
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

    // Uses transform for GPU-accelerated positioning (with -4px centering offset)
    const style = cursor?.getAttribute('style') || ''
    expect(style).toContain('transform: translate(56px, 76px)')
  })

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
    // Uses transform for GPU-accelerated positioning
    expect(style).toContain('transform: translate(0px, 0px)')
  })

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
