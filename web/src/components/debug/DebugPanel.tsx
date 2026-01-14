import { useState } from 'react'
import { type ConnectionStatus } from '../../hooks/useWebSocket'

interface DebugStats {
  connection: {
    status: ConnectionStatus
    retryCount: number
    messagesSent: number
    messagesReceived: number
  }
  tiles: {
    requested: number
    loaded: number
    errors: number
  }
  overlay: {
    id: string | null
    status: 'none' | 'loading' | 'loaded' | 'error'
    cellCount: number
  }
  session: {
    id: string | null
    role: 'presenter' | 'follower' | null
    participantCount: number
  }
}

interface DebugPanelProps {
  stats: DebugStats
  defaultCollapsed?: boolean
}

interface DebugItemProps {
  label: string
  value: string | number
  highlight?: 'success' | 'warning' | 'error'
  mono?: boolean
}

function DebugItem({ label, value, highlight, mono = true }: DebugItemProps) {
  const colorClass =
    highlight === 'success'
      ? 'text-green-400'
      : highlight === 'warning'
        ? 'text-yellow-400'
        : highlight === 'error'
          ? 'text-red-400'
          : 'text-gray-300'

  return (
    <div className="flex justify-between py-0.5 text-xs">
      <span className="text-gray-500">{label}</span>
      <span className={`${mono ? 'font-mono' : ''} ${colorClass}`}>{value}</span>
    </div>
  )
}

interface DebugSubsectionProps {
  title: string
  children: React.ReactNode
}

function DebugSubsection({ title, children }: DebugSubsectionProps) {
  return (
    <div className="mb-2">
      <h4 className="text-xs font-medium text-gray-400 mb-1">{title}</h4>
      <div className="pl-2 border-l border-gray-700">{children}</div>
    </div>
  )
}

/**
 * Debug panel for the sidebar showing connection, tile, overlay, and session stats.
 * Collapsed by default to not distract from main functionality.
 */
export function DebugPanel({ stats, defaultCollapsed = true }: DebugPanelProps) {
  const [isExpanded, setIsExpanded] = useState(!defaultCollapsed)

  const connectionStatusColor =
    stats.connection.status === 'connected'
      ? 'success'
      : stats.connection.status === 'connecting' || stats.connection.status === 'reconnecting'
        ? 'warning'
        : stats.connection.status === 'solo'
          ? 'warning'
          : 'error'

  return (
    <div className="border-t border-gray-700 pt-3 mt-3">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between text-xs font-semibold text-gray-400 uppercase tracking-wider hover:text-gray-300 transition-colors"
        aria-expanded={isExpanded}
      >
        <span className="flex items-center gap-2">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
            />
          </svg>
          Debug
        </span>
        <svg
          className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isExpanded && (
        <div className="mt-3 space-y-3">
          {/* Connection Stats */}
          <DebugSubsection title="Connection">
            <DebugItem
              label="Status"
              value={stats.connection.status}
              highlight={connectionStatusColor}
            />
            <DebugItem
              label="Retries"
              value={stats.connection.retryCount}
              highlight={stats.connection.retryCount > 0 ? 'warning' : undefined}
            />
            <DebugItem label="Sent" value={stats.connection.messagesSent} />
            <DebugItem label="Received" value={stats.connection.messagesReceived} />
          </DebugSubsection>

          {/* Tile Stats */}
          <DebugSubsection title="Tiles">
            <DebugItem label="Requested" value={stats.tiles.requested} />
            <DebugItem label="Loaded" value={stats.tiles.loaded} />
            <DebugItem
              label="Errors"
              value={stats.tiles.errors}
              highlight={stats.tiles.errors > 0 ? 'error' : undefined}
            />
          </DebugSubsection>

          {/* Overlay Stats */}
          <DebugSubsection title="Overlay">
            <DebugItem
              label="Status"
              value={stats.overlay.status}
              highlight={
                stats.overlay.status === 'loaded'
                  ? 'success'
                  : stats.overlay.status === 'error'
                    ? 'error'
                    : undefined
              }
            />
            {stats.overlay.id && (
              <DebugItem label="ID" value={stats.overlay.id.slice(0, 12) + '...'} />
            )}
            {stats.overlay.cellCount > 0 && (
              <DebugItem label="Cells" value={stats.overlay.cellCount.toLocaleString()} />
            )}
          </DebugSubsection>

          {/* Session Stats */}
          <DebugSubsection title="Session">
            <DebugItem label="ID" value={stats.session.id?.slice(0, 12) || 'None'} />
            <DebugItem label="Role" value={stats.session.role || 'N/A'} mono={false} />
            <DebugItem label="Participants" value={stats.session.participantCount} />
          </DebugSubsection>
        </div>
      )}
    </div>
  )
}

export type { DebugStats }
