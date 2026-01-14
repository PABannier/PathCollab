import { type ReactNode } from 'react'

interface StatusBarProps {
  /** Left side content (logo, slide name) */
  left?: ReactNode
  /** Center content (optional) */
  center?: ReactNode
  /** Right side content (connection status, actions) */
  right?: ReactNode
}

/**
 * Fixed status bar at the top of the viewer.
 * Uses design token: --statusbar-height (48px)
 */
export function StatusBar({ left, center, right }: StatusBarProps) {
  return (
    <header
      className="flex items-center justify-between px-4 flex-shrink-0"
      style={{
        height: 'var(--statusbar-height)',
        backgroundColor: 'var(--statusbar-bg)',
        borderBottom: '1px solid var(--statusbar-border)',
      }}
    >
      <div className="flex items-center gap-4">{left}</div>
      {center && <div className="flex items-center">{center}</div>}
      <div className="flex items-center gap-2">{right}</div>
    </header>
  )
}

interface ConnectionBadgeProps {
  status: 'connected' | 'connecting' | 'reconnecting' | 'disconnected' | 'solo'
}

/**
 * Connection status indicator badge.
 */
export function ConnectionBadge({ status }: ConnectionBadgeProps) {
  const colors = {
    connected: 'bg-green-500',
    connecting: 'bg-yellow-500 animate-pulse',
    reconnecting: 'bg-yellow-500 animate-pulse',
    disconnected: 'bg-red-500',
    solo: 'bg-purple-500',
  }

  const labels = {
    connected: 'Connected',
    connecting: 'Connecting',
    reconnecting: 'Reconnecting',
    disconnected: 'Disconnected',
    solo: 'Solo Mode',
  }

  return (
    <span className="flex items-center gap-1.5 text-sm text-gray-400">
      <span className={`h-2 w-2 rounded-full ${colors[status]}`} />
      <span className="sr-only">{labels[status]}</span>
    </span>
  )
}
