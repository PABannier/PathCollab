import { useNetworkStatus } from '../../hooks/useNetworkStatus'
import { type ConnectionStatus } from '../../hooks/useWebSocket'

interface NetworkErrorBannerProps {
  /** WebSocket connection status */
  connectionStatus: ConnectionStatus
}

/**
 * Banner that displays network connectivity issues.
 * Shows when offline or when WebSocket connection is lost.
 */
export function NetworkErrorBanner({ connectionStatus }: NetworkErrorBannerProps) {
  const { isOnline } = useNetworkStatus()

  // Don't show banner if everything is fine
  // Also don't show in solo mode (deliberate offline mode)
  if (connectionStatus === 'solo') return null
  if (isOnline && connectionStatus === 'connected') return null

  // Determine the message and severity
  let message: string
  let severity: 'error' | 'warning'
  let showRetry = false

  if (!isOnline) {
    message = 'You appear to be offline. Check your internet connection.'
    severity = 'error'
    showRetry = true
  } else if (connectionStatus === 'connecting') {
    message = 'Connecting to server...'
    severity = 'warning'
  } else if (connectionStatus === 'reconnecting') {
    message = 'Connection lost. Reconnecting...'
    severity = 'warning'
  } else if (connectionStatus === 'disconnected') {
    message = 'Disconnected from server. Real-time features unavailable.'
    severity = 'error'
    showRetry = true
  } else {
    return null
  }

  const bgColor = severity === 'error' ? 'var(--color-error)' : 'var(--color-warning)'

  return (
    <div
      className="fixed top-0 left-0 right-0 text-white text-center py-2 text-sm flex items-center justify-center gap-4"
      style={{
        backgroundColor: bgColor,
        zIndex: 'var(--z-fixed)',
        animation: 'slideDown 0.3s ease-out',
      }}
      role="alert"
      aria-live="polite"
    >
      {/* Status icon */}
      {severity === 'warning' ? (
        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      )}

      <span>{message}</span>

      {showRetry && (
        <button
          onClick={() => window.location.reload()}
          className="underline hover:no-underline font-medium"
        >
          Retry
        </button>
      )}
    </div>
  )
}
