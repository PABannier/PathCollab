import { ConnectionBadge } from '../layout/StatusBar'
import type { ConnectionStatus } from '../../hooks/useWebSocket'

export interface SessionConnectionStatusProps {
  /** Current connection status */
  status: ConnectionStatus
  /** Whether the current user is the presenter */
  isPresenter: boolean
}

/**
 * Connection status display for the sidebar.
 * Shows connection badge and descriptive text about the user's role.
 */
export function SessionConnectionStatus({ status, isPresenter }: SessionConnectionStatusProps) {
  const statusText = getStatusText(status, isPresenter)

  return (
    <div className="mb-4 flex items-center gap-2">
      <ConnectionBadge status={status} />
      <span className="text-gray-400 italic text-sm">{statusText}</span>
    </div>
  )
}

function getStatusText(status: ConnectionStatus, isPresenter: boolean): string {
  switch (status) {
    case 'connected':
      return isPresenter ? 'You are presenting' : 'You are following'
    case 'connecting':
      return 'Connecting...'
    case 'reconnecting':
      return 'Reconnecting...'
    case 'disconnected':
      return 'Disconnected'
    case 'solo':
      return 'Solo mode'
    default:
      return ''
  }
}
