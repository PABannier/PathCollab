/**
 * StatusBar and ConnectionBadge Component Tests
 *
 * Tests for Phase 2 (Collaboration MVP) requirements from IMPLEMENTATION_PLAN.md.
 * Tests are written against the SPECIFICATION, not the implementation.
 * If a test fails, the implementation has a bug (not the test).
 *
 * Phase 2 Requirements Tested:
 * - Connection status indicator (Week 4, Day 3-4)
 * - Status bar layout (left, center, right)
 * - Reconnecting state feedback
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBar, ConnectionBadge } from './StatusBar'

describe('StatusBar', () => {
  /**
   * Phase 2 spec: Status bar with left, center, right sections
   * Reference: IMPLEMENTATION_PLAN.md Week 4 (UI polish)
   */
  it('renders left, center, and right sections', () => {
    render(
      <StatusBar
        left={<span data-testid="left">Left Content</span>}
        center={<span data-testid="center">Center Content</span>}
        right={<span data-testid="right">Right Content</span>}
      />
    )

    expect(screen.getByTestId('left')).toBeTruthy()
    expect(screen.getByTestId('center')).toBeTruthy()
    expect(screen.getByTestId('right')).toBeTruthy()
  })

  /**
   * Phase 2 spec: Center section is optional
   * Reference: IMPLEMENTATION_PLAN.md (layout flexibility)
   */
  it('renders without center section', () => {
    render(
      <StatusBar
        left={<span data-testid="left">Left</span>}
        right={<span data-testid="right">Right</span>}
      />
    )

    expect(screen.getByTestId('left')).toBeTruthy()
    expect(screen.getByTestId('right')).toBeTruthy()
    expect(screen.queryByTestId('center')).toBeNull()
  })

  /**
   * Phase 2 spec: Status bar is a header element
   * Reference: IMPLEMENTATION_PLAN.md (accessibility)
   */
  it('renders as header element', () => {
    const { container } = render(<StatusBar left={<span>Test</span>} />)

    const header = container.querySelector('header')
    expect(header).toBeTruthy()
  })

  /**
   * Phase 2 spec: Status bar uses design token height
   * Reference: IMPLEMENTATION_PLAN.md Section 4.1 (design tokens)
   */
  it('uses CSS variable for height', () => {
    const { container } = render(<StatusBar left={<span>Test</span>} />)

    const header = container.querySelector('header')
    expect(header?.style.height).toBe('var(--statusbar-height)')
  })
})

describe('ConnectionBadge', () => {
  /**
   * Phase 2 spec: Shows connected state with green indicator
   * Reference: IMPLEMENTATION_PLAN.md Week 4 (connection status)
   */
  it('shows green indicator when connected', () => {
    const { container } = render(<ConnectionBadge status="connected" />)

    const indicator = container.querySelector('.bg-green-500')
    expect(indicator).toBeTruthy()

    // Screen reader label
    expect(screen.getByText('Connected')).toBeTruthy()
  })

  /**
   * Phase 2 spec: Shows connecting state with pulsing yellow indicator
   * Reference: IMPLEMENTATION_PLAN.md Week 4 (connecting feedback)
   */
  it('shows pulsing yellow indicator when connecting', () => {
    const { container } = render(<ConnectionBadge status="connecting" />)

    const indicator = container.querySelector('.bg-yellow-500')
    expect(indicator).toBeTruthy()
    expect(indicator?.classList.contains('animate-pulse')).toBe(true)

    expect(screen.getByText('Connecting')).toBeTruthy()
  })

  /**
   * Phase 2 spec: Shows reconnecting state with pulsing yellow indicator
   * Reference: IMPLEMENTATION_PLAN.md Week 4 (reconnection feedback)
   */
  it('shows pulsing yellow indicator when reconnecting', () => {
    const { container } = render(<ConnectionBadge status="reconnecting" />)

    const indicator = container.querySelector('.bg-yellow-500')
    expect(indicator).toBeTruthy()
    expect(indicator?.classList.contains('animate-pulse')).toBe(true)

    expect(screen.getByText('Reconnecting')).toBeTruthy()
  })

  /**
   * Phase 2 spec: Shows disconnected state with red indicator
   * Reference: IMPLEMENTATION_PLAN.md Week 4 (error feedback)
   */
  it('shows red indicator when disconnected', () => {
    const { container } = render(<ConnectionBadge status="disconnected" />)

    const indicator = container.querySelector('.bg-red-500')
    expect(indicator).toBeTruthy()

    expect(screen.getByText('Disconnected')).toBeTruthy()
  })

  /**
   * Phase 2 spec: Shows solo mode with purple indicator
   * Reference: IMPLEMENTATION_PLAN.md Week 4 (solo viewing)
   */
  it('shows purple indicator for solo mode', () => {
    const { container } = render(<ConnectionBadge status="solo" />)

    const indicator = container.querySelector('.bg-purple-500')
    expect(indicator).toBeTruthy()

    expect(screen.getByText('Solo Mode')).toBeTruthy()
  })

  /**
   * Phase 2 spec: Status labels are accessible via screen reader
   * Reference: IMPLEMENTATION_PLAN.md (accessibility)
   */
  it('includes screen reader accessible labels', () => {
    const { rerender, container } = render(<ConnectionBadge status="connected" />)

    // Label should have sr-only class
    const label = container.querySelector('.sr-only')
    expect(label).toBeTruthy()
    expect(label?.textContent).toBe('Connected')

    rerender(<ConnectionBadge status="reconnecting" />)
    expect(container.querySelector('.sr-only')?.textContent).toBe('Reconnecting')
  })

  /**
   * Phase 2 spec: Indicator dot is visible
   * Reference: IMPLEMENTATION_PLAN.md (visual feedback)
   */
  it('renders circular indicator dot', () => {
    const { container } = render(<ConnectionBadge status="connected" />)

    const dot = container.querySelector('.rounded-full')
    expect(dot).toBeTruthy()
    // Should have width and height
    expect(dot?.classList.contains('h-2')).toBe(true)
    expect(dot?.classList.contains('w-2')).toBe(true)
  })

  /**
   * Phase 2 spec: All status types render without error
   * Reference: IMPLEMENTATION_PLAN.md (robustness)
   */
  it('handles all status types', () => {
    const statuses: Array<'connected' | 'connecting' | 'reconnecting' | 'disconnected' | 'solo'> = [
      'connected',
      'connecting',
      'reconnecting',
      'disconnected',
      'solo',
    ]

    statuses.forEach((status) => {
      const { container, unmount } = render(<ConnectionBadge status={status} />)

      // Should render without error
      expect(container.querySelector('span')).toBeTruthy()

      unmount()
    })
  })
})

describe('ConnectionBadge animation', () => {
  /**
   * Phase 2 spec: Pulse animation for transitional states only
   * Reference: IMPLEMENTATION_PLAN.md Week 4 (visual feedback)
   */
  it('only animates transitional states', () => {
    const animatedStatuses = ['connecting', 'reconnecting']
    const staticStatuses = ['connected', 'disconnected', 'solo']

    animatedStatuses.forEach((status) => {
      const { container, unmount } = render(
        <ConnectionBadge status={status as 'connecting' | 'reconnecting'} />
      )

      const dot = container.querySelector('.animate-pulse')
      expect(dot).toBeTruthy()

      unmount()
    })

    staticStatuses.forEach((status) => {
      const { container, unmount } = render(
        <ConnectionBadge status={status as 'connected' | 'disconnected' | 'solo'} />
      )

      const dot = container.querySelector('.animate-pulse')
      expect(dot).toBeNull()

      unmount()
    })
  })
})
