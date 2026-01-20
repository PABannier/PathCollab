import { memo } from 'react'
import type { SessionState } from '../../hooks/useSession'
import type { ConnectionStatus } from '../../hooks/useWebSocket'

export interface SessionFooterProps {
  /** Current session state (null if no session) */
  session: SessionState | null
  /** WebSocket connection status */
  connectionStatus: ConnectionStatus
  /** Round-trip latency in milliseconds */
  latency: number | null
  /** Current viewport state */
  currentViewport: { centerX: number; centerY: number; zoom: number }
  /** Current cursor position in slide coordinates (null when not hovering) */
  footerCursorPos: { x: number; y: number } | null
  /** Whether cell overlays are currently loading */
  isLoadingCells?: boolean
}

/**
 * VS Code-style footer bar showing session metrics.
 *
 * Displays:
 * - Session ID (truncated)
 * - Participant count
 * - Latency indicator (color-coded by speed)
 * - Zoom level
 * - Cursor coordinates
 */
export const SessionFooter = memo(function SessionFooter({
  session,
  connectionStatus,
  latency,
  currentViewport,
  footerCursorPos,
  isLoadingCells,
}: SessionFooterProps) {
  return (
    <footer
      className="flex items-center h-6 text-xs border-t"
      style={{ backgroundColor: 'var(--footer-bg)', borderColor: 'var(--footer-border)' }}
    >
      {/* Left section with VS Code blue accent */}
      <div
        className="flex items-center gap-1.5 px-2 h-full"
        style={{ backgroundColor: 'var(--footer-accent)' }}
      >
        {/* Connection icon */}
        <svg
          stroke="currentColor"
          fill="currentColor"
          strokeWidth="0"
          viewBox="0 0 16 16"
          focusable="false"
          className="text-white"
          height="1em"
          width="1em"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M12.904 9.57L8.928 5.596l3.976-3.976-.619-.62L8 5.286v.619l4.285 4.285.62-.618zM3 5.62l4.072 4.07L3 13.763l.619.618L8 10v-.619L3.619 5 3 5.619z"
          />
        </svg>
        <span className="text-white font-medium">
          {session ? session.id.slice(0, 8) : 'No Session'}
        </span>
      </div>

      {/* Right section: Metrics */}
      <div className="flex-1 flex items-center justify-end gap-8 px-3 text-gray-400">
        {/* Participant count */}
        {session && (
          <span>
            {session.followers.length + 1} participant
            {session.followers.length !== 0 ? 's' : ''}
          </span>
        )}

        {/* Loading polygons indicator */}
        {isLoadingCells && (
          <span className="flex items-center gap-1.5 text-blue-400">
            <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Loading polygons
          </span>
        )}

        {/* Latency indicator */}
        {latency !== null && connectionStatus === 'connected' && (
          <span
            className="flex items-center gap-1 font-mono"
            style={{
              color:
                latency < 50
                  ? 'var(--color-success)'
                  : latency < 150
                    ? 'var(--color-warning)'
                    : 'var(--color-error)',
            }}
          >
            {/* Broadcast/signal icon */}
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="currentColor"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M8 1a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 1zm0 10a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2a.5.5 0 0 1 .5-.5zm7-3.5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2a.5.5 0 0 1 .5.5zM4 8a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2A.5.5 0 0 1 4 8zm9.646-4.354a.5.5 0 0 1 0 .708l-1.414 1.414a.5.5 0 1 1-.708-.708l1.414-1.414a.5.5 0 0 1 .708 0zM4.476 11.524a.5.5 0 0 1 0 .708l-1.414 1.414a.5.5 0 1 1-.708-.708l1.414-1.414a.5.5 0 0 1 .708 0zm9.17 2.122a.5.5 0 0 1-.707 0l-1.414-1.414a.5.5 0 1 1 .707-.708l1.414 1.414a.5.5 0 0 1 0 .708zM4.476 4.476a.5.5 0 0 1-.708 0L2.354 3.062a.5.5 0 1 1 .708-.708l1.414 1.414a.5.5 0 0 1 0 .708zM8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" />
            </svg>
            {latency}ms
          </span>
        )}

        {/* Zoom level */}
        <span>Zoom: {Math.round(currentViewport.zoom * 100)}%</span>

        {/* Cursor coordinates (when hovering over slide) */}
        {footerCursorPos && (
          <span className="font-mono text-gray-500">
            x={Math.round(footerCursorPos.x)} y={Math.round(footerCursorPos.y)}
          </span>
        )}
      </div>
    </footer>
  )
})
