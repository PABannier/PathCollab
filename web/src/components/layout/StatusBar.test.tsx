/**
 * StatusBar and ConnectionBadge Component Tests
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBar, ConnectionBadge } from './StatusBar'

describe('StatusBar', () => {
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

  it('renders as header element', () => {
    const { container } = render(<StatusBar left={<span>Test</span>} />)

    const header = container.querySelector('header')
    expect(header).toBeTruthy()
  })

  it('uses CSS variable for height', () => {
    const { container } = render(<StatusBar left={<span>Test</span>} />)

    const header = container.querySelector('header')
    expect(header?.style.height).toBe('var(--statusbar-height)')
  })
})

describe('ConnectionBadge', () => {
  it('shows green indicator when connected', () => {
    const { container } = render(<ConnectionBadge status="connected" />)

    const indicator = container.querySelector('.bg-green-500')
    expect(indicator).toBeTruthy()

    // Screen reader label
    expect(screen.getByText('Connected')).toBeTruthy()
  })

  it('shows pulsing yellow indicator when connecting', () => {
    const { container } = render(<ConnectionBadge status="connecting" />)

    const indicator = container.querySelector('.bg-yellow-500')
    expect(indicator).toBeTruthy()
    expect(indicator?.classList.contains('animate-pulse')).toBe(true)

    expect(screen.getByText('Connecting')).toBeTruthy()
  })

  it('shows pulsing yellow indicator when reconnecting', () => {
    const { container } = render(<ConnectionBadge status="reconnecting" />)

    const indicator = container.querySelector('.bg-yellow-500')
    expect(indicator).toBeTruthy()
    expect(indicator?.classList.contains('animate-pulse')).toBe(true)

    expect(screen.getByText('Reconnecting')).toBeTruthy()
  })

  it('shows red indicator when disconnected', () => {
    const { container } = render(<ConnectionBadge status="disconnected" />)

    const indicator = container.querySelector('.bg-red-500')
    expect(indicator).toBeTruthy()

    expect(screen.getByText('Disconnected')).toBeTruthy()
  })

  it('shows purple indicator for solo mode', () => {
    const { container } = render(<ConnectionBadge status="solo" />)

    const indicator = container.querySelector('.bg-purple-500')
    expect(indicator).toBeTruthy()

    expect(screen.getByText('Solo Mode')).toBeTruthy()
  })

  it('includes screen reader accessible labels', () => {
    const { rerender, container } = render(<ConnectionBadge status="connected" />)

    // Label should have sr-only class
    const label = container.querySelector('.sr-only')
    expect(label).toBeTruthy()
    expect(label?.textContent).toBe('Connected')

    rerender(<ConnectionBadge status="reconnecting" />)
    expect(container.querySelector('.sr-only')?.textContent).toBe('Reconnecting')
  })

  it('renders circular indicator dot', () => {
    const { container } = render(<ConnectionBadge status="connected" />)

    const dot = container.querySelector('.rounded-full')
    expect(dot).toBeTruthy()
    // Should have width and height
    expect(dot?.classList.contains('h-2')).toBe(true)
    expect(dot?.classList.contains('w-2')).toBe(true)
  })

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
